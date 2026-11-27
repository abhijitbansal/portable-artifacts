// The walk shot's camera: one layer of keys, on top of the look's own drift. A stop goes to `whole` (the whole picture) or to
// `step:<id>` (a context region round that step's box, as far as the take's own pixels carry it: walk-pose.mjs), and each
// lift eases the camera down to the zoom its card needs (walk-pose.mjs liftPose). Each move takes MOVE_SECONDS on the in-out
// cubic ease (a lift's, half of it, with the card) and lands on the stop's second: a step stop on its step's start (or its
// `at`), a whole stop RESULT_HOLD after the previous stop's step ends, then the move (walk-time.mjs wholeLanding). No move
// starts before ESTABLISH seconds after the shot's incoming cut ends (the whole picture is seen first), inside a step's
// hold ([end, end + HOLD_MIN)), during a scroll step or while a lift is up (until its card starts back); it starts later
// instead. A move that cannot land before the next stop starts moving is dropped; one that would move the camera nowhere
// moves nothing. planStops says what became of each stop, and the expansion and the review both read it. Pure and DOM-free.
import { layeredCamera } from '../graph/camera.mjs';
import { kindData } from '../looks/index.mjs';
import { cutEnd, defaultCamera } from './camera.mjs';
import { HOLD_MIN, LIFT_MOVES, MOVE_SECONDS, STEP_PREFIX, wholeLanding } from './walk-time.mjs';
import { WHOLE, liftPose, liftRise, stepPose } from './walk-pose.mjs';

export { MOVE_SECONDS, STEP_PREFIX };
/** The seconds of the whole picture the shot holds, after its incoming cut ends, before any stop moves the camera. */
export const ESTABLISH = 2;
const MOVE_EASE = 'inOutCubic';
const LIFT_HALF = LIFT_MOVES / 2; // s: a lift's card rises (and returns) in this long, and the camera with it
const EPSILON = 1e-9;
const SAME_ZOOM = 0.02; // a stop within this zoom and ...
const SAME_PAN = 0.01; // ... this share of the canvas of the camera it leaves moves nothing

const samePose = (a, b, canvas) => Math.abs(a.zoom - b.zoom) < SAME_ZOOM
  && Math.abs(a.x - b.x) < SAME_PAN * canvas.w && Math.abs(a.y - b.y) < SAME_PAN * canvas.h;

// Seconds in which a move may not start: after each step, while its last frame holds; during a scroll step; while a lift is
// up, until its card starts back.
function noStartWindows(plan, data, lifts) {
  const scrolls = new Set(data.steps.filter((s) => s.do === 'scroll').map((s) => s.id));
  return [
    ...plan.steps.flatMap((s) => [[s.end, s.end + HOLD_MIN], ...(scrolls.has(s.id) ? [[s.start, s.end]] : [])]),
    ...lifts.map((l) => [l.start, l.end - LIFT_HALF]),
  ];
}

// The first second at or after `t` that is in none of `windows`.
function outsideWindows(t, windows) {
  const holding = (at) => windows.find(([from, to]) => at >= from - EPSILON && at < to - EPSILON);
  let at = t;
  for (let hit = holding(at); hit !== undefined; hit = holding(at)) at = hit[1];
  return at;
}

// Each stop with the second it wants to land on and (for a step stop) its step.
function stopEvents(shot, ctx, plan) {
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  let settled = null;
  return (shot.stops ?? []).map((stop, index) => {
    const id = stop.to === 'whole' ? undefined : stop.to.slice(STEP_PREFIX.length);
    const step = id === undefined ? undefined : byId.get(id);
    if (id !== undefined && step === undefined) throw new RangeError(`stops[${index}].to: "${stop.to}" is not a step of the shot`);
    let land = 0;
    if (stop.at !== undefined) land = ctx.at(stop.at);
    else if (step !== undefined) land = step.start;
    else if (settled !== null) land = wholeLanding(settled);
    settled = step ?? { end: land, until: land };
    return { kind: 'stop', index, id, stop, land };
  });
}

// The stops and the lifts in the order the camera meets them: a lift goes before the first stop that lands after it starts.
function inOrder(stops, lifts) {
  const events = [...stops];
  for (const lift of lifts) {
    const at = events.findIndex((e) => e.kind === 'stop' && e.land > lift.start);
    events.splice(at < 0 ? events.length : at, 0, { kind: 'lift', lift });
  }
  return events;
}

// The context a step stop frames, as shares of the picture (look data `context`) and the pad it keeps (px): `width` and `height` and the
// look's `pushPad` for a step; `last` ({ width, height, pad? }) for the shot's last step, whose result can appear anywhere on the page and
// is held before the pull-back (its `pad`, in units, is smaller than the look's: the whole page width fills the frame, as large as the
// page's own margins allow, so its text still reads).
function sharesOf({ context, pushPad }, isLast, unit) {
  if (!isLast) return { share: context.width, heightShare: context.height, pad: pushPad * unit };
  return { share: context.last.width, heightShare: context.last.height, pad: (context.last.pad ?? pushPad) * unit };
}

const wishStart = (e) => (e.kind === 'lift' ? e.lift.start : e.land - MOVE_SECONDS);

const poseKey = (pose) => ({ x: pose.x, y: pose.y, zoom: pose.zoom });

function addKey(keys, key) {
  const last = keys.at(-1);
  const repeat = last !== undefined && Math.abs(last.t - key.t) < EPSILON && last.x === key.x && last.y === key.y && last.zoom === key.zoom;
  if (!repeat) keys.push(key);
}

// One stop's fate, from the camera it leaves (`was`) and the second the camera is free from (`free`): where its move starts
// and lands, or that it moves nothing (noRoom) or cannot land before the next event starts moving (dropped).
function stopFate(e, next, { pose, was, free, windows, canvas }) {
  const first = e.index === 0 && e.id === undefined && e.stop.at === undefined;
  if (samePose(pose, was, canvas)) return { land: e.land, start: e.land, zoom: was.zoom, noRoom: true, flagged: !first };
  const start = outsideWindows(Math.max(e.land - MOVE_SECONDS, free), windows);
  const land = start + MOVE_SECONDS;
  const dropped = next !== undefined && land > wishStart(next) + EPSILON;
  return { land, start, zoom: pose.zoom, dropped };
}

// The camera goes back to the pose it left for a lift: from the second its card starts back, in the card's own time.
function settleLift(keys, state) {
  const { lift, before, pose } = state.lift;
  addKey(keys, { t: lift.end - LIFT_HALF, ...poseKey(pose) });
  addKey(keys, { t: lift.end, ...poseKey(before), ease: MOVE_EASE });
  return { was: poseKey(before), free: lift.end };
}

// A lift's camera move: eased down (with its card) to the pose liftPose gives, from the second it is free to move.
function liftMove(keys, e, state, ctx, geo, look) {
  const { lift } = e;
  const box = geo.stepBoxes.get(lift.step);
  if (!box || look.lift === undefined) return state;
  const start = Math.max(lift.start, state.free);
  const pose = liftPose(ctx, geo, box, state.was, { scale: look.lift.scale, pad: look.pushPad * ctx.unit, snap: look.snap, rise: liftRise(look.lift, box, ctx.canvas.h), at: start + LIFT_HALF });
  if (samePose(pose, state.was, ctx.canvas)) return state;
  addKey(keys, { t: start, ...state.was });
  addKey(keys, { t: start + LIFT_HALF, ...poseKey(pose), ease: MOVE_EASE });
  return { was: poseKey(pose), free: lift.end - LIFT_HALF, lift: { lift, before: state.was, pose, zoom: pose.zoom } };
}

/**
 * What becomes of each of `shot.stops`: { layer, stops, lifts }. `layer` is the camera layer's keys (null when nothing moves
 * the camera); each stop is { index, to, id?, land, start, zoom, wanted, cap, dropped, noRoom, flagged }: `land` and `start`
 * the seconds the move ends and starts, `zoom` what it lands on, `wanted` and `cap` the zoom the stop's region asks for and
 * the take carries, `dropped` for a stop that cannot land before the next starts moving, `noRoom` for one that moves nothing
 * and `flagged` for the noRoom that is a finding (a first whole stop with no `at` is the shot start, not one). `lifts` is
 * the camera's zoom while each lift that moved it is up: [{ step, zoom }]. `lifts` in `setup` is liftSpans's, `data` the take.
 */
export function planStops(shot, ctx, { geo, plan, data, lifts = [] }) {
  const look = kindData(ctx.look, 'walk');
  const events = inOrder(stopEvents(shot, ctx, plan), lifts);
  const windows = noStartWindows(plan, data, lifts);
  const keys = [{ t: 0, ...WHOLE }];
  let state = { was: WHOLE, free: cutEnd(shot, ctx.timing) + ESTABLISH };
  const stops = [], held = [];
  events.forEach((e, i) => {
    if (e.kind === 'lift') {
      state = liftMove(keys, e, state, ctx, geo, look);
      if (state.lift?.lift === e.lift) held.push({ step: e.lift.step, zoom: state.lift.zoom });
      return;
    }
    if (state.lift !== undefined && e.land - MOVE_SECONDS > state.lift.lift.end + EPSILON) state = settleLift(keys, state);
    const box = e.id === undefined ? null : geo.stepBoxes.get(e.id) ?? null;
    const pose = box === null ? { ...WHOLE, wanted: 1, cap: Infinity } : stepPose(ctx, geo, box, { ...sharesOf(look, e.id === shot.steps.at(-1).id, ctx.unit), snap: look.snap, at: e.land });
    const fate = stopFate(e, events[i + 1], { pose, ...state, windows, canvas: ctx.canvas });
    if (fate.noRoom !== true && fate.dropped !== true) {
      addKey(keys, { t: fate.start, ...state.was });
      addKey(keys, { t: fate.land, ...poseKey(pose), ease: MOVE_EASE });
      state = { was: poseKey(pose), free: fate.land };
    }
    stops.push({ index: e.index, to: e.stop.to, ...(e.id === undefined ? {} : { id: e.id }), wanted: pose.wanted, cap: pose.cap, dropped: false, noRoom: false, flagged: false, ...fate });
  });
  if (state.lift !== undefined) settleLift(keys, state);
  return { layer: keys.length > 1 ? keys : null, stops, lifts: held };
}

/** The shot's camera as (t) => { x, y, zoom, rotate } in shot seconds: the look's drift and the stops' layer. */
export const walkCamera = (ctx, planned) => layeredCamera([...defaultCamera(ctx.look, ctx.timing, ctx.unit), ...(planned.layer === null ? [] : [planned.layer])], 'walk camera');
