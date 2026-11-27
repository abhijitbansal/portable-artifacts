// What the review says about a walk shot (the kind's `review` hook; creative advice, never mechanical): page text too
// small at its stop, a stop that asks for more than the take's pixels carry, a step whose action leaves the frame, a take
// step the shot jumps across, and a stop that has no room to move or cannot land. It reads the same setup the expansion
// does (walk-layout.mjs walkSetup) from the prepared take, so it says nothing without one. Pure and DOM-free.
import { pointThroughCamera } from '../graph/camera.mjs';
import { unitOf } from '../units.mjs';
import { walkSetup } from './walk-layout.mjs';
import { walkCamera } from './walk-camera.mjs';

const READABLE_PX = 26; // page text at 1080 px of canvas height reads at this size or more
const REFERENCE_HEIGHT = 1080;
const RESOLUTION_SLACK = 1.01; // a push within 1% of the take's pixels is not reported
const SAMPLE_SECONDS = 0.1; // the camera is looked at this often over a step's action

const number = (n) => Number(n.toFixed(1));
const stopNumber = (s) => s.index + 1;

// Page text of a known size that shows under READABLE_PX at its step stop.
function textFindings(setup, canvas) {
  const [, , iw] = setup.geo.image;
  return setup.planned.stops.filter((s) => s.id !== undefined && !s.dropped).flatMap((s) => {
    const textPx = setup.data.steps.find((t) => t.id === s.id)?.textPx;
    if (!Number.isFinite(textPx)) return [];
    const shown = textPx * (iw / setup.geo.viewport.width) * s.zoom * (REFERENCE_HEIGHT / canvas.h);
    if (shown >= READABLE_PX) return [];
    return [{ path: `stops[${s.index}]`, at: s.land, message: `step "${s.id}": page text of ${textPx} px shows at ${number(shown)} px at its stop; push closer or lift it` }];
  });
}

// A push that asks for more than the take carries (the zoom stops at the take's own pixels).
const resolutionFindings = (setup) => setup.planned.stops
  .filter((s) => s.id !== undefined && !s.dropped && Number.isFinite(s.cap) && s.wanted > s.cap * RESOLUTION_SLACK)
  .map((s) => ({ path: `stops[${s.index}]`, at: s.land, message: `stop ${stopNumber(s)} wants ${number(s.wanted)}x; the take carries ${number(s.cap)}x` }));

const inside = ([x, y], canvas) => x >= 0 && y >= 0 && x <= canvas.w && y <= canvas.h;

// A step whose box centre, or whose pointer at its act, is outside the camera's view while it runs.
function leaveFindings(shot, setup, ctx) {
  const camera = walkCamera(ctx, setup.planned);
  const shown = (point, t) => inside(pointThroughCamera(point, camera(t), ctx.canvas), ctx.canvas);
  return shot.steps.flatMap(({ id }, i) => {
    const box = setup.geo.stepBoxes.get(id);
    const take = setup.data.steps.find((t) => t.id === id);
    const step = setup.plan.steps[i];
    if (!box || !take) return [];
    const centre = [box[0] + box[2] / 2, box[1] + box[3] / 2];
    const times = Array.from({ length: Math.floor((step.end - step.start) / SAMPLE_SECONDS) + 1 }, (_, k) => step.start + k * SAMPLE_SECONDS);
    const seen = [...times, step.end].every((t) => shown(centre, t)) && shown(setup.geo.mapPoint(take.pointer), step.act);
    return seen ? [] : [{ path: `steps[${i}]`, at: step.start, message: `step "${id}"'s action leaves the frame` }];
  });
}

// A take step between the shot's first and last that the shot does not play.
function jumpFindings(shot, data) {
  const played = new Set(shot.steps.map((s) => s.id));
  const order = shot.steps.map((s) => data.steps.findIndex((t) => t.id === s.id)).filter((k) => k >= 0);
  if (order.length === 0) return [];
  return data.steps.slice(Math.min(...order) + 1, Math.max(...order)).filter((t) => !played.has(t.id))
    .map((t) => ({ path: 'steps', at: 0, message: `take step "${t.id}" is not in this shot's steps: the film jumps across it` }));
}

// A stop that moves nothing, and one that cannot land before the next starts moving.
const stopFindings = (setup) => setup.planned.stops.flatMap((s) => {
  const path = `stops[${s.index}]`;
  if (s.flagged) return [{ path, at: s.land, message: `stop ${stopNumber(s)} has no room to move` }];
  if (s.dropped) return [{ path, at: s.start, message: `stop ${stopNumber(s)} cannot land before stop ${stopNumber(s) + 1} starts moving, so it is dropped: give the stops more time apart, or remove one` }];
  return [];
});

/** The findings of walk shot `shot` for review ctx `ctx` ({ look, canvas, timing, at, prepared, mode, viralInsets }): [{ path, at, message }]. */
export function walkReview(shot, ctx) {
  if (!ctx.prepared || !ctx.look?.kinds?.walk) return [];
  const full = { ...ctx, unit: unitOf(ctx.canvas), captions: false };
  const setup = walkSetup(shot, full);
  return [...textFindings(setup, ctx.canvas), ...resolutionFindings(setup), ...leaveFindings(shot, setup, full), ...jumpFindings(shot, ctx.prepared), ...stopFindings(setup)];
}
