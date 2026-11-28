// The walk shot's cursor and its click ripple: kind-internal nodes the take does not carry (its frames are page pictures
// without a pointer). The cursor is an arrow in the look's ink with a paper keyline, 5% of the canvas high. It is drawn from the
// shot's first frame, at rest on REST (a point of the page) until it travels to the first step that has a box and a pointer
// (no pointer in the whole take: no cursor). It travels to each such step on one quadratic curve from the previous pointer,
// over at least TRAVEL_MIN seconds before the step's act: the travel starts early, borrowing from the previous step's hold,
// but never before that step's act and never while a lift holds its card up (not until the card starts back down). At act
// it dips to 0.9, and a `click` step adds a ripple: a thin outline ring (the look's kinds.walk.ripple: ink on a paper keyline;
// the accent without it) that starts RIPPLE.from times the cursor's size and grows outward, fading, so the clicked label stays
// readable. Both nodes are top-level and `fixed` (the camera leaves them where they are put), so every position is the page
// point through the image map and then through the shot's own camera, keyed once per film frame; it is clamped to stay inside
// the frame. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { pointThroughCamera } from '../graph/camera.mjs';
import { track } from '../time/track.mjs';
import { ease } from '../time/ease.mjs';
import { circlePath } from '../devices/sun.mjs';
import { LIFT_MOVES } from './walk-time.mjs';

const HALF = 2;
const SIZE_SHARE = 0.05; // of the canvas height: the arrow's height
const ARROW = Object.freeze([[0, 0], [0, 0.9], [0.2, 0.72], [0.33, 1], [0.45, 0.95], [0.32, 0.68], [0.6, 0.68]]); // tip at the origin, height 1
const ARROW_WIDTH = Math.max(...ARROW.map(([x]) => x));
const KEYLINE = 0.08; // of the arrow's height: the paper keyline's stroke
const BEND = 0.2; // of the glide's length: how far the curve bows from the straight line
const GLIDE_EASE = 'inOutCubic';
const DIP = Object.freeze({ scale: 0.9, before: 0.04, hold: 0.12, after: 0.06 }); // s, around act
// the ring's diameter is `from` times the cursor's at the click and `to` times it after `seconds`; `width` (of the cursor's size) is its stroke
const RIPPLE = Object.freeze({ from: 1.6, to: 2.6, seconds: 0.4, width: 0.04, ease: 'outCubic' });
const KEYLINE_WIDEN = 2; // the ripple's paper keyline is this many times its ring's stroke
const EPSILON = 1e-9;

/** Where the cursor rests before its first pointer, as shares of the page (viewport) width and height. */
export const REST = Object.freeze({ x: 0.62, y: 0.7 });
/** The least seconds a travel to a click takes. */
export const TRAVEL_MIN = 0.6;

// The second the previous steps leave the cursor free to travel to step `index`: the previous step's act, and the second the
// card of a lift on an earlier step starts back down (its raised hold is over).
function freeFrom(index, act, { plan, lifts }) {
  const acted = index > 0 ? plan.steps[index - 1].act : 0;
  const cards = lifts.filter((l) => l.index < index).map((l) => l.end - LIFT_MOVES / HALF);
  return Math.max(acted, ...cards.filter((back) => back <= act));
}

// The steps the cursor goes to, in order: those with a box and a pointer in the take. A step with no box keeps the cursor
// where it was. `point` is the pointer on the drawn picture (before the camera), `from` the second its travel starts.
function targetsOf(shot, setup) {
  const { geo, plan, data } = setup;
  return shot.steps.flatMap(({ id }, index) => {
    const take = data.steps.find((s) => s.id === id);
    if (!take?.box || !take.pointer) return [];
    const { act } = plan.steps[index];
    return [{ index, point: geo.mapPoint(take.pointer), act, from: Math.max(act - TRAVEL_MIN, freeFrom(index, act, setup)), click: take.do === 'click' }];
  });
}

// The control point of the glide's curve: the chord's middle, pushed up (else sideways) by BEND of its length.
function bowOf(a, b) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(dx, dy);
  const mid = [(a[0] + b[0]) / HALF, (a[1] + b[1]) / HALF];
  if (length < EPSILON) return mid;
  const side = dx >= 0 ? 1 : -1;
  return [mid[0] + (side * dy * BEND), mid[1] - (side * dx * BEND)];
}

const quadratic = (a, c, b, u) => [0, 1].map((k) => (1 - u) ** 2 * a[k] + 2 * (1 - u) * u * c[k] + u ** 2 * b[k]);

// (t) => the pointer on the drawn picture at shot second t: `rest` before the first travel starts.
function pathOf(targets, rest) {
  const glide = ease(GLIDE_EASE);
  return (t) => {
    const j = targets.findLastIndex((g) => g.from <= t + EPSILON);
    if (j < 0) return rest;
    const g = targets[j];
    if (t >= g.act - EPSILON || g.act - g.from < EPSILON) return g.point;
    const prev = j === 0 ? rest : targets[j - 1].point;
    return quadratic(prev, bowOf(prev, g.point), g.point, glide((t - g.from) / (g.act - g.from)));
  };
}

// The shot seconds that get a key: `from` and `to`, every film frame between, and the `extra` seconds (each act).
function keyTimes(from, to, fps, extra) {
  const first = Math.ceil(from * fps - EPSILON), last = Math.floor(to * fps + EPSILON);
  const frames = Array.from({ length: Math.max(0, last - first + 1) }, (_, k) => (first + k) / fps);
  const times = [from, ...frames, to, ...extra].sort((a, b) => a - b);
  return times.filter((t, i) => i === 0 || t - times[i - 1] > EPSILON);
}

// The arrow's path at `size` px high, drawn from its tip.
const arrowPath = (size) => `M${ARROW.map(([x, y]) => `${Number((x * size).toFixed(2))} ${Number((y * size).toFixed(2))}`).join('L')}Z`;

// x and y tracks over `times`: where the pointer `path` stands on the canvas through the camera, kept inside the frame.
function positionTracks(times, path, cam, canvas, size) {
  const clamp = (v, max) => Math.min(max, Math.max(0, v));
  const spots = times.map((t) => {
    const [x, y] = pointThroughCamera(path(t), cam(t), canvas);
    return [clamp(x, canvas.w - ARROW_WIDTH * size), clamp(y, canvas.h - size)];
  });
  return { x: track(times.map((t, i) => ({ t, v: spots[i][0] }))), y: track(times.map((t, i) => ({ t, v: spots[i][1] }))), first: spots[0] };
}

// 1 until each act, dipping to DIP.scale from just before it until DIP.hold after it.
function dipTrack(targets) {
  const keys = [{ t: 0, v: 1 }];
  for (const { act } of targets) {
    keys.push({ t: Math.max(0, act - DIP.before), v: 1 }, { t: act, v: DIP.scale }, { t: act + DIP.hold, v: DIP.scale }, { t: act + DIP.hold + DIP.after, v: 1 });
  }
  return track(keys);
}

// A soft shadow under the arrow so it reads on white: the arrow's shape in the look's ink at low alpha, stacked at growing
// stroke widths (no blur filter), offset down and right.
const SHADOW = Object.freeze({ dx: 0.05, dy: 0.08, alpha: 0.07, widths: [0.34, 0.22, 0.1] }); // shares of the arrow's height

function shadowNodes(shot, { size, look }) {
  const d = arrowPath(size);
  return SHADOW.widths.map((width, i) => node('path', `${shot.id}.cursor.shadow${i}`, {
    d, fill: look.palette.ink, stroke: look.palette.ink, strokeWidth: width * size, opacity: SHADOW.alpha, x: SHADOW.dx * size, y: SHADOW.dy * size,
  }));
}

// On from the shot's first frame (no opacity track), keyed on every film frame so it follows the camera.
function cursorNode(shot, { targets, path, cam, ctx, size }) {
  const { look, canvas, timing, fps } = ctx;
  const times = keyTimes(0, timing.duration, fps, targets.map((g) => g.act));
  const { x, y, first: [x0, y0] } = positionTracks(times, path, cam, canvas, size);
  const arrow = node('path', `${shot.id}.cursor.arrow`, { d: arrowPath(size), fill: look.palette.ink, stroke: look.palette.paper, strokeWidth: KEYLINE * size });
  return node('group', `${shot.id}.cursor`, { fixed: true, x: x0, y: y0 }, { tracks: { x, y, scale: dipTrack(targets) }, children: [...shadowNodes(shot, { size, look }), arrow] });
}

// A thin ring at the click: drawn RIPPLE.from times the cursor's size across and scaled out to RIPPLE.to over RIPPLE.seconds,
// fading out, fixed on the point. The ring is outline only, so the label under it reads on the click frame.
function rippleNode(shot, { target, cam, ctx, size }) {
  const { look, canvas, fps } = ctx;
  const { act } = target;
  const end = act + RIPPLE.seconds;
  // on the click point, not on the cursor's path: the next travel may set off while the ring is still up
  const { x, y, first: [x0, y0] } = positionTracks(keyTimes(act, end, fps, []), () => target.point, cam, canvas, size);
  const id = `${shot.id}.ripple${target.index}`;
  const rippleLook = look.kinds?.walk?.ripple;
  const d = circlePath((RIPPLE.from * size) / HALF);
  const width = (rippleLook?.width ?? RIPPLE.width) * size;
  // the look's ripple data (ink, thin) on a wider paper keyline, so it reads on white UI and on a blue button; a look without
  // ripple data keeps the accent ring
  const ring = node('path', `${id}.ring`, { d, stroke: look.palette[rippleLook?.color ?? 'accent'], strokeWidth: width });
  const keyline = rippleLook === undefined ? [] : [node('path', `${id}.keyline`, { d, stroke: look.palette[rippleLook.keyline ?? 'paper'], strokeWidth: width * KEYLINE_WIDEN })];
  const tracks = {
    x, y,
    scale: track([{ t: act, v: 1 }, { t: end, v: RIPPLE.to / RIPPLE.from, ease: RIPPLE.ease }]),
    opacity: track([{ t: 0, v: 0 }, { t: act, v: 0 }, { t: act, v: 1 }, { t: end, v: 0 }]),
  };
  return node('group', id, { fixed: true, x: x0, y: y0 }, { tracks, children: [...keyline, ring] });
}

/**
 * The cursor and the ripples of a walk shot: [...ripple groups, cursor group], or [] when no step has a box and a pointer.
 * `setup` is walkSetup's, `cam` the shot's camera with every layer it has ((t) => { x, y, zoom, rotate }, layeredCamera), and
 * `ctx` a kind's ctx (look, canvas, timing, fps).
 */
export function cursorNodes(shot, ctx, setup, cam) {
  const targets = targetsOf(shot, setup);
  if (targets.length === 0) return [];
  const { viewport } = setup.geo;
  const rest = setup.geo.mapPoint({ x: REST.x * viewport.width, y: REST.y * viewport.height });
  const size = SIZE_SHARE * ctx.canvas.h;
  const place = { path: pathOf(targets, rest), cam, ctx, size };
  const ripples = targets.filter((g) => g.click).map((target) => rippleNode(shot, { ...place, target }));
  return [...ripples, cursorNode(shot, { ...place, targets })];
}
