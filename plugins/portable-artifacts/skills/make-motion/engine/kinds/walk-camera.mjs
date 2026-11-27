// The walk shot's camera: one layer of stops, on top of the look's own drift. A stop goes to `whole` (the whole picture)
// or to `step:<id>` (a push onto that step's box, as far as the take's own pixels carry it). Each move takes MOVE_SECONDS
// on the in-out cubic ease and lands on the stop's second: a step stop on its step's start (or its `at`), a whole stop
// HOLD_MIN after the previous stop's step ends (the shot start for a first one). A move never starts inside a step's hold
// ([end, end + HOLD_MIN)) or during a scroll step, so it starts later; one that cannot land before the next stop starts
// moving is dropped; one that would move the camera nowhere moves nothing. planStops says what became of each stop, and
// the expansion and the review both read it. Pure and DOM-free.
import { layeredCamera } from '../graph/camera.mjs';
import { defaultCamera, pushLayer, pushZoom } from './camera.mjs';
import { nativeZoom } from './screen-layout.mjs';
import { HOLD_MIN } from './walk-time.mjs';

/** The seconds a camera move takes. */
export const MOVE_SECONDS = 0.8;
const MOVE_EASE = 'inOutCubic';
export const STEP_PREFIX = 'step:';
const WHOLE = Object.freeze({ x: 0, y: 0, zoom: 1 });
const EPSILON = 1e-9;
const SAME_ZOOM = 0.02; // a stop within this zoom and ...
const SAME_PAN = 0.01; // ... this share of the canvas of the camera it leaves moves nothing

const samePose = (a, b, canvas) => Math.abs(a.zoom - b.zoom) < SAME_ZOOM
  && Math.abs(a.x - b.x) < SAME_PAN * canvas.w && Math.abs(a.y - b.y) < SAME_PAN * canvas.h;

// Seconds in which a move may not start: after each step, while its last frame holds; during a scroll step.
function noStartWindows(plan, data) {
  const scrolls = new Set(data.steps.filter((s) => s.do === 'scroll').map((s) => s.id));
  return plan.steps.flatMap((s) => [[s.end, s.end + HOLD_MIN], ...(scrolls.has(s.id) ? [[s.start, s.end]] : [])]);
}

// The first second at or after `t` that is in none of `windows`.
function outsideWindows(t, windows) {
  const holding = (at) => windows.find(([from, to]) => at >= from - EPSILON && at < to - EPSILON);
  let at = t;
  for (let hit = holding(at); hit !== undefined; hit = holding(at)) at = hit[1];
  return at;
}

// Each stop with the second it wants to land on and (for a step stop) its step; `settled` is the second the next whole
// stop counts HOLD_MIN from: its step's end, or its own landing.
function wishes(shot, ctx, plan) {
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  let settled = null;
  return (shot.stops ?? []).map((stop, index) => {
    const id = stop.to === 'whole' ? undefined : stop.to.slice(STEP_PREFIX.length);
    const step = id === undefined ? undefined : byId.get(id);
    if (id !== undefined && step === undefined) throw new RangeError(`stops[${index}].to: "${stop.to}" is not a step of the shot`);
    let land = 0;
    if (stop.at !== undefined) land = ctx.at(stop.at);
    else if (step !== undefined) land = step.start;
    else if (settled !== null) land = settled + HOLD_MIN;
    settled = step === undefined ? land : step.end;
    return { index, id, stop, land };
  });
}

// The camera pose of a stop (the whole picture, or a push onto the step's box within the take's pixels), with the zoom it
// wanted and the take can carry.
function poseOf(ctx, geo, box, land) {
  if (box === null) return { ...WHOLE, wanted: 1, cap: Infinity };
  const cap = nativeZoom(geo.picture, geo.image);
  const key = pushLayer(ctx, box, land, { max: cap })[1];
  return { x: key.x, y: key.y, zoom: key.zoom, wanted: pushZoom(ctx, box), cap };
}

const poseKey = (pose) => ({ x: pose.x, y: pose.y, zoom: pose.zoom });

function addKey(keys, key) {
  const last = keys.at(-1);
  const repeat = last !== undefined && Math.abs(last.t - key.t) < EPSILON && last.x === key.x && last.y === key.y && last.zoom === key.zoom;
  if (!repeat) keys.push(key);
}

// One stop's fate, from the camera it leaves (`was`) and the second the camera is free from (`free`): where its move starts
// and lands, or that it moves nothing (noRoom) or cannot land before the next stop starts moving (dropped).
function fateOf(w, i, wanted, { pose, was, free, windows, canvas }) {
  const first = i === 0 && w.id === undefined && w.stop.at === undefined;
  if (samePose(pose, was, canvas)) return { land: w.land, start: w.land, zoom: was.zoom, noRoom: true, flagged: !first };
  const start = outsideWindows(Math.max(w.land - MOVE_SECONDS, free), windows);
  const land = start + MOVE_SECONDS;
  const next = wanted[i + 1];
  const dropped = next !== undefined && land > next.land - MOVE_SECONDS + EPSILON;
  return { land, start, zoom: pose.zoom, dropped };
}

/**
 * What becomes of each of `shot.stops`: { layer, stops }. `layer` is the camera layer's keys (null when no stop moves the
 * camera); each stop is { index, to, id?, land, start, zoom, wanted, cap, dropped, noRoom, flagged }: `land` and `start`
 * the seconds the move ends and starts, `zoom` what it lands on, `wanted` and `cap` the push the box asks for and the take
 * carries, `dropped` for a stop that cannot land before the next starts moving, `noRoom` for one that moves nothing and
 * `flagged` for the noRoom that is a finding (a first whole stop with no `at` is the shot start, not one).
 */
export function planStops(shot, ctx, { geo, plan, data }) {
  const wanted = wishes(shot, ctx, plan);
  const windows = noStartWindows(plan, data);
  const keys = [{ t: 0, ...WHOLE }];
  let state = { was: WHOLE, free: 0 };
  const stops = wanted.map((w, i) => {
    const pose = poseOf(ctx, geo, w.id === undefined ? null : geo.stepBoxes.get(w.id) ?? null, w.land);
    const fate = fateOf(w, i, wanted, { pose, ...state, windows, canvas: ctx.canvas });
    if (fate.noRoom !== true && fate.dropped !== true) {
      addKey(keys, { t: fate.start, ...state.was });
      addKey(keys, { t: fate.land, ...poseKey(pose), ease: MOVE_EASE });
      state = { was: poseKey(pose), free: fate.land };
    }
    return { index: w.index, to: w.stop.to, ...(w.id === undefined ? {} : { id: w.id }), wanted: pose.wanted, cap: pose.cap, dropped: false, noRoom: false, flagged: false, ...fate };
  });
  return { layer: keys.length > 1 ? keys : null, stops };
}

/** The shot's camera as (t) => { x, y, zoom, rotate } in shot seconds: the look's drift and the stops' layer. */
export const walkCamera = (ctx, planned) => layeredCamera([...defaultCamera(ctx.look, ctx.timing, ctx.unit), ...(planned.layer === null ? [] : [planned.layer])], 'walk camera');
