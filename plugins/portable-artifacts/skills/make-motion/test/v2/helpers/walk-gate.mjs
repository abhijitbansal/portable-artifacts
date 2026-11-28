// The two gate films (references/examples/v2/gate-walk-keynote.json and gate-walk-desk.json) as the walk shot sees them: the
// real timeline of the film, the shot's expansion, its setup, and the measured text of the fixture page, for tests that look
// at every film frame of the tour. The text rectangles are in page px (960 x 540), measured on the take's settled frames.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { registries } from '../../../engine/registry.mjs';
import { buildTimeline } from '../../../engine/script/timing.mjs';
import { withFilmDefaults } from '../../../scripts/v2/spec.mjs';
import { prepareFilm } from '../../../scripts/v2/prepare/index.mjs';
import { layeredCamera } from '../../../engine/graph/camera.mjs';
import { shotContext } from '../../../engine/graph/film.mjs';
import { walkSetup } from '../../../engine/kinds/walk-layout.mjs';
import { loadFilm } from '../../../scripts/v2/pipeline.mjs';
import { canvasOf, measure, FPS } from './kinds.mjs';
import { EXAMPLES_DIR } from './walk.mjs';

export const PAGE = Object.freeze({ w: 960, h: 540 });

const CARD_TEXT = (x) => [x + 16, 288, 142, 98];
/** The text of the page before the add click, [x, y, w, h]. Index 8 is the lifted card's own text. */
export const PAGE_TEXT = Object.freeze([
  [32, 12, 90, 30], [815, 12, 115, 30], [32, 85, 92, 26], [32, 120, 300, 16], [46, 165, 220, 26], [32, 218, 280, 34], [324, 218, 105, 34],
  CARD_TEXT(32), CARD_TEXT(260), CARD_TEXT(488), [32, 420, 110, 25],
  [48, 463, 270, 22], [880, 463, 38, 22], [48, 503, 235, 22], [880, 503, 38, 22],
]);
export const LIFTED_TEXT = PAGE_TEXT[8];
/** The text the add click brings: card 4. */
export const ADDED_TEXT = Object.freeze([CARD_TEXT(716)]);

/** The stops and lift the gate films had before pushes were parked (kept so the push camera keeps its guards). */
export const PUSHED = Object.freeze({
  stops: Object.freeze([{ to: 'step:tab' }, { to: 'step:hover' }, { to: 'step:add' }, { to: 'whole' }]),
  lift: Object.freeze([{ step: 'hover' }]),
});

// The film as loadFilm builds it, but with the tour shot's stops and lift of PUSHED and no validation (the validator refuses a
// step stop now): defaults, the prepared take and the timeline, as loadFilm does them.
function loadPushed(file) {
  const specPath = path.join(EXAMPLES_DIR, file);
  const raw = JSON.parse(readFileSync(specPath, 'utf8'));
  const spec = { ...raw, shots: raw.shots.map((s) => (s.show === 'walk' ? { ...s, stops: [...PUSHED.stops], lift: [...PUSHED.lift] } : s)) };
  const film = withFilmDefaults(spec, registries);
  const { prepared } = prepareFilm(film, { filmDir: EXAMPLES_DIR, kinds: registries.kinds });
  return { film, prepared, timeline: buildTimeline(film, { fps: film.fps, modes: registries.modes, kinds: registries.kinds, prepared }) };
}

/** The tour shot of a gate film, expanded: { out, ctx, setup, shot, fps, window(t) }. `pushed` plays the old step stops. */
export function gateTour(file, { pushed = false } = {}) {
  const loaded = pushed ? loadPushed(file) : loadFilm(path.join(EXAMPLES_DIR, file));
  const index = loaded.film.shots.findIndex((s) => s.show === 'walk');
  const ctx = shotContext({ film: loaded.film, index, timeline: loaded.timeline, canvas: canvasOf(loaded.film.format), measure, assets: new Map(), prepared: loaded.prepared });
  const shot = loaded.film.shots[index];
  const out = registries.kinds.get('walk').expand(shot, ctx);
  const setup = walkSetup(shot, ctx);
  const cam = layeredCamera(out.camera, 'test');
  const { w, h } = ctx.canvas;
  const [ix, iy, iw, ih] = out.boxes.image;
  const page = (s, size, pan, origin, length, pagePx, zoom) => ((size / 2 + (s + pan - size / 2) / zoom - origin) / length) * pagePx;
  // the page rectangle the camera shows at shot second t, as [left, top, right, bottom] in page px
  const window = (t) => {
    const c = cam(t);
    return [page(0, w, c.x, ix, iw, PAGE.w, c.zoom), page(0, h, c.y, iy, ih, PAGE.h, c.zoom), page(w, w, c.x, ix, iw, PAGE.w, c.zoom), page(h, h, c.y, iy, ih, PAGE.h, c.zoom)];
  };
  return { out, ctx, setup, shot, cam, window, fps: FPS, duration: ctx.timing.duration };
}

/** Whether `box` ([l, t, r, b]) cuts the rectangle `rect` ([x, y, w, h]) in two: part of it in, part of it out. */
export const sliced = ([l, t, r, b], [x, y, w, h]) => {
  const inter = Math.max(0, Math.min(r, x + w) - Math.max(l, x)) * Math.max(0, Math.min(b, y + h) - Math.max(t, y));
  return inter > 1 && inter < w * h - 1;
};
