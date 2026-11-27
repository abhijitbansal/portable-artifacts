// Fixtures for the walk kind's tests: films on the committed fixture take (references/examples/v2/walk-take, five steps),
// a hand-made take whose steps are plain runs of distinct frames (so nothing is cut as idle and every time is simple), and
// walk shots expanded as buildFilm does, with the prepared data on both the timeline and the ctx (the shot stretches).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registries } from '../../../engine/registry.mjs';
import { buildTimeline } from '../../../engine/script/timing.mjs';
import { shotContext } from '../../../engine/graph/film.mjs';
import { walkPlan } from '../../../engine/kinds/walk-time.mjs';
import { liftsOf } from '../../../engine/kinds/walk-layout.mjs';
import { prepareFilm } from '../../../scripts/v2/prepare/index.mjs';
import { canvasOf, viralOf, measure, FPS } from './kinds.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The folder the committed take is in, as the film's folder. */
export const EXAMPLES_DIR = path.resolve(HERE, '../../../references/examples/v2');
export const STEPS = Object.freeze(['open', 'tab', 'search', 'hover', 'add']);
export const SAY5 = 'Open the page. Pick the tab. Type a word. Hover a card. Add it.';

/** A walk shot on the committed take: its five steps, one sentence each. */
export const walkShot = (extra = {}) => ({ id: 'w', show: 'walk', src: 'walk-take', say: SAY5, steps: STEPS.map((id) => ({ id })), ...extra });
export const walkFilm = (shot = walkShot(), { look = 'keynote', format = '16:9', ...rest } = {}) => ({ version: 2, mode: 'pro', look, format, fps: FPS, seed: 1, shots: [shot], ...rest });

/** The committed take's prepared data (the preparer's, so no path in it). */
export const committed = () => prepareFilm(walkFilm(), { filmDir: EXAMPLES_DIR }).prepared.w;

/**
 * A take of steps of `frames[i]` distinct frames each (names never repeat, so no run is idle), 960x540 at scale 3, each step
 * with its own box (spread across the page by `boxes`, [x, y, width, height] in page px) and act on its third frame.
 */
export function handTake(frames, boxes, { textPx = 14 } = {}) {
  const names = [];
  const steps = frames.map((n, i) => {
    const startIndex = names.length;
    for (let k = 0; k < n; k += 1) names.push(`f${names.length}`);
    const [x, y, width, height] = boxes[i];
    return { id: `s${i}`, do: 'click', startIndex, actIndex: startIndex + 2, settledIndex: names.length - 1, pointer: { x: x + width / 2, y: y + height / 2 }, box: { x, y, width, height }, textPx };
  });
  return { src: 'take', names, fps: 30, viewport: { width: 960, height: 540 }, scale: 3, width: 2880, height: 1620, signedIn: false, steps, distinct: names.length };
}
/** A walk shot over a hand take's steps, with no say (so it plays them back to back). */
export const handShot = (data, extra = {}) => ({ id: 'w', show: 'walk', src: 'take', hold: 5, steps: data.steps.map((s) => ({ id: s.id })), ...extra });

/** Shot 0 of `film` expanded with `prepared` ({ w: data }): { ...expand output, ctx, timing, plan, data }. */
export function expandWalk(film, prepared, { lifts } = {}) {
  const timeline = buildTimeline(film, { fps: FPS, prepared });
  const canvas = canvasOf(film.format);
  const ctx = shotContext({ film, index: 0, timeline, canvas, measure, assets: new Map(), viralInsets: viralOf(canvas), prepared });
  const shot = film.shots[0];
  const timing = timeline.shots[0];
  const plan = walkPlan(shot, timing, prepared.w, { lifts: lifts ?? liftsOf(shot, ctx.look) });
  return { ...registries.kinds.get('walk').expand(shot, ctx), ctx, timing, timeline, plan, data: prepared.w };
}

/** The review ctx the film review gives a kind (scripts/v2/review.mjs), for shot 0, with the prepared data. */
export function reviewCtx(film, prepared) {
  const { ctx, timing } = expandWalk(film, prepared);
  return { look: ctx.look, mode: ctx.mode, timing, at: ctx.at, canvas: ctx.canvas, viralInsets: ctx.viralInsets, asset: () => undefined, prepared: prepared.w };
}
