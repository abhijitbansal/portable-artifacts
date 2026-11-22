// The layer cuts: crossfade, fade, wipe, iris, zoom, blur and flood. A layer cut does not move nodes; it composes two pictures,
// the outgoing shot (still moving, past its end; frozen at its end in a look drawn by hand) and the incoming shot live
// (engine/graph/film.mjs frameAt gives both inside its window). Its entry's layers({ p, direction, canvas }) is a pure recipe for that composition:
//   { under: 'from' | 'to', from: Pose, to: Pose, backdrop: 'from' | 'to' | null, flood: { color, circle: [cx, cy, r] } | null }
// `flood` (the flood cut only, null in the others) is a disc of one colour laid between the picture under and the one over.
// layers() also takes `grounds`, the two shots' background colours (the outgoing one's, then the incoming one's): the flood
// colour is the look's first cutFlood colour that is neither (floodColor).
//   Pose = { opacity, clip: { rect: [x, y, w, h] } | { circle: [cx, cy, r] } | null, scale (about `origin`), origin:
//            [x, y] | null (null: the canvas centre), blur (px), dim (0..1: black laid over the picture inside its clip) }
// An iris, a zoom and a flood may be given `at`, a canvas point (a cut's origin, engine/graph/film.mjs): they open from it.
// `under` is drawn first, `backdrop` names whose background colour is painted under both (null: none, the picture under
// covers the frame). The recipe eases p itself; at p 0 the composition is the outgoing picture exactly and at p 1 the
// incoming one. The page composes it in canvas 2D (engine/page/cut-pictures.mjs), so a layer cut is the same picture
// with or without WebGL. Registered by index.mjs. Pure and DOM-free.
import { ease } from '../time/ease.mjs';
import { ENTRY_EDGE } from './edges.mjs';

const LAYER_DUR = 0.4;
const FLOOD_DUR = 0.5; // two openings in turn (the colour, then the picture): a little longer than the one-step layer cuts
const LAYER_EASE = 'inOutCubic';
const ZOOM_FROM = Object.freeze({ in: 1.2, out: 0.8 }); // version 1's scales
const BLUR_SHARE = 24 / 1080; // version 1's 24 px blur on a 1080 px short side, as a share of the short side
const HALF = 2;
// The way the edge moves (edges.mjs); the default, right, uncovers from the left edge as the wipe always did.
const WIPE_EDGES = Object.freeze(['right', 'left', 'up', 'down']);
const IRIS_WAYS = Object.freeze(['in', 'out']);

const pose = (fields = {}) => Object.freeze({ opacity: 1, clip: null, scale: 1, origin: null, blur: 0, dim: 0, ...fields });
const UNTOUCHED = pose();
const recipe = (under, from, to, backdrop = null, flood = null) => Object.freeze({ under, from, to, backdrop, flood });
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, e) => a + (b - a) * e;
// How far the farthest corner of the canvas is from `centre`: the radius at which a circle about it covers the frame.
const cornerReach = (canvas, [cx, cy]) => Math.hypot(Math.max(cx, canvas.w - cx), Math.max(cy, canvas.h - cy));
// Where an iris opens when the look names no point (look.cutMotion.irisAt): the middle of the canvas.
const IRIS_CENTRE = Object.freeze([0.5, 0.5]);

// The part of the canvas the incoming picture has reached at eased progress e, growing from the edge `direction` enters
// by (edges.mjs: a wipe up grows from the bottom edge).
function wipeRect(direction, e, { w, h }) {
  const edge = ENTRY_EDGE[direction];
  if (edge === 'left') return [0, 0, w * e, h];
  if (edge === 'right') return [w - w * e, 0, w * e, h];
  if (edge === 'top') return [0, 0, w, h * e];
  return [0, h - h * e, w, h * e];
}

// The cuts that lay one whole picture over the other clear the outgoing one by the middle and bring the incoming one
// up after it, so the two sets of words never read at once (look review gate-cuts-1 PF3; lead ruling 3): the outgoing
// picture fades over p 0..CLEAR_OUT, the incoming one over ARRIVE_FROM..1, on the incoming background.
const CLEAR_OUT = 0.5;
const ARRIVE_FROM = 0.3;
// The iris dims the outgoing picture by this much once it opens, so the circle's edge reads on paper of one colour
// (gate-cuts-1 D8), reaching it at p DIM_BY.
const IRIS_DIM = 0.3;
const DIM_BY = 0.25;
const smoothstep = (lo, hi, v) => {
  const x = clamp01((v - lo) / (hi - lo));
  return x * x * (3 - 2 * x);
};
const leaving = (p) => 1 - smoothstep(0, CLEAR_OUT, p);
const arriving = (p) => smoothstep(ARRIVE_FROM, 1, p);

// The colours a flood may paint, as palette keys, when the look names none (look.cutFlood.colors).
const FLOOD_COLORS = Object.freeze(['accent']);

/**
 * The colour a flood paints between two grounds: the first of the look's flood colours (look.cutFlood.colors, else the
 * accent) that differs from every colour in `grounds` (the outgoing and the incoming shot's ground), so the disc never
 * paints a ground over itself; the last colour when each matches one. Hex case does not matter.
 */
export function floodColor(look, grounds = []) {
  const keys = look?.cutFlood?.colors ?? FLOOD_COLORS;
  const missing = keys.filter((key) => !Object.hasOwn(look?.palette ?? {}, key));
  if (missing.length > 0) throw new Error(`flood.layers: the look's palette has no ${missing.join(', ')}`);
  const colors = keys.map((key) => look.palette[key]);
  const taken = grounds.map((ground) => String(ground).toLowerCase());
  return colors.find((color) => !taken.includes(color.toLowerCase())) ?? colors.at(-1);
}

const LAYERS = Object.freeze({
  crossfade: (e, { p }) => recipe('from', pose({ opacity: leaving(p) }), pose({ opacity: arriving(p) })),
  // a dip: the outgoing shot fades to the incoming background over the first half, the incoming one up over the second
  fade: (e, { p }) => recipe('from', pose({ opacity: 1 - ease(LAYER_EASE)(clamp01(p * HALF)) }), pose({ opacity: ease(LAYER_EASE)(clamp01(p * HALF - 1)) }), 'to'),
  wipe: (e, { direction, canvas }) => recipe('from', UNTOUCHED, pose({ clip: { rect: wipeRect(direction, e, canvas) } })),
  iris: (e, { p, direction, canvas, look, at }) => {
    const [fx, fy] = look?.cutMotion?.irisAt ?? IRIS_CENTRE;
    const centre = at ?? [fx * canvas.w, fy * canvas.h], reach = cornerReach(canvas, centre);
    if (direction === 'in') return recipe('from', pose({ dim: IRIS_DIM * clamp01(p / DIM_BY) }), pose({ clip: { circle: [...centre, reach * e] } }));
    return recipe('to', pose({ clip: { circle: [...centre, reach * (1 - e)] } }), UNTOUCHED);
  },
  zoom: (e, { p, direction, at }) => recipe('from', pose({ opacity: leaving(p) }), pose({ opacity: arriving(p), scale: lerp(ZOOM_FROM[direction], 1, e), origin: at })),
  blur: (e, { p, canvas }) => recipe('from', pose({ opacity: leaving(p) }), pose({ opacity: arriving(p), blur: Math.max(0, BLUR_SHARE * Math.min(canvas.w, canvas.h) * (1 - e)) })),
  // the look's accent grows as a circle from the point over the outgoing picture (the first half), then the incoming
  // picture opens as a circle from the same point over the colour (the second); the colour is the whole frame at p 0.5
  flood: (e, { p, canvas, look, at, grounds }) => {
    const color = floodColor(look, grounds);
    const centre = at ?? [canvas.w / HALF, canvas.h / HALF], reach = cornerReach(canvas, centre);
    const eased = ease(LAYER_EASE);
    const grown = eased(clamp01(p * HALF)), opened = eased(clamp01(p * HALF - 1));
    return recipe('from', UNTOUCHED, pose({ clip: { circle: [...centre, reach * opened] } }), null, { color, circle: [...centre, reach * grown] });
  },
});

// A layer cut's registry entry (resolve.mjs reads family, dur, directions, smearable, incomingOnly, example).
function defineLayer(name, { directions = null, summary, example, origin = false, dur = LAYER_DUR }) {
  const build = LAYERS[name];
  return Object.freeze({
    family: 'layer', dur, summary, example, directions, smearable: false, incomingOnly: false,
    ...(origin ? { origin: true } : {}), // the cut may open from a point (`at`, resolve.mjs)
    layers({ p, direction, canvas, look = null, at = null, grounds = [] }) {
      if (!Number.isFinite(p)) throw new Error(`${name}.layers: p must be a finite number, got ${p}`);
      if (directions !== null && !directions.includes(direction)) throw new Error(`${name}.layers: direction must be one of ${directions.join(', ')}, got ${direction}`);
      const q = clamp01(p);
      return build(ease(LAYER_EASE)(q), { p: q, direction, canvas, look, at, grounds });
    },
  });
}

/** The seven layer cuts, as registry entries. */
export const LAYER_CUTS = Object.freeze({
  crossfade: defineLayer('crossfade', { example: 'crossfade', summary: 'The next shot fades in over the last one over 0.4 s.' }),
  fade: defineLayer('fade', { example: { type: 'fade', duration: 0.6 }, summary: 'The last shot fades to the next one\'s background, then the next one fades up, over 0.4 s.' }),
  wipe: defineLayer('wipe', { directions: WIPE_EDGES, example: { type: 'wipe', direction: 'up' }, summary: 'The next shot is uncovered by a straight line that moves the way the direction names: right (the default) starts at the left edge, left at the right edge, up at the bottom edge, down at the top edge, over 0.4 s.' }),
  iris: defineLayer('iris', { origin: true, directions: IRIS_WAYS, example: { type: 'iris', direction: 'out' }, summary: 'A circle opens on the next shot (in), or closes on the last one (out), over 0.4 s, about the point the look keeps clear of words (the centre unless it names one), or about a target of the last shot when the cut has "at".' }),
  zoom: defineLayer('zoom', { origin: true, directions: IRIS_WAYS, example: { type: 'zoom', direction: 'out' }, summary: 'The next shot fades in from 1.2 times its size (in) or 0.8 (out) over the last one, over 0.4 s, about the centre or about a target of the last shot when the cut has "at".' }),
  blur: defineLayer('blur', { example: 'blur', summary: 'The next shot fades in from a blur over the last one over 0.4 s.' }),
  flood: defineLayer('flood', { origin: true, dur: FLOOD_DUR, example: 'flood', summary: 'The look\'s accent colour floods the last shot as a circle that grows to fill the frame, then the next shot opens as a circle from the same point over the colour, over 0.5 s, from the centre or from a target of the last shot when the cut has "at".' }),
});
