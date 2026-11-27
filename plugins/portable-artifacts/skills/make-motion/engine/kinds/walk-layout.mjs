// How the `walk` kind lays out (walk.mjs registers it): a take drawn in the screen kind's browser chrome. The picture is one
// `image` node on the take's frames (props.video: { count }, its `frame` track the walk frame track), so every picture of
// the product is a frame of the take, drawn as stored. A page point maps onto the drawn picture by
// [ix + x / viewport.width * iw, iy + y / viewport.height * ih], and so does each step's box. walkSetup is what the
// expansion and the review both read: the look's data, the geometry, the plan in seconds and the camera stops. Pure and
// DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { kindData } from '../looks/index.mjs';
import { frameNodes, outerOf } from './screen-frame.mjs';
import { roomOf, fitFramed } from './screen-layout.mjs';
import { planStops } from './walk-camera.mjs';
import { walkPlan, walkFrameTrack, liftSpans } from './walk-time.mjs';

const HALF = 2;
const CHROME_FADE = 0.25; // s: the chrome texts leave as the first push begins, so none is cut at the frame's edge

/** The frame a walk shot is drawn in. */
export const walkFrame = (shot) => shot.frame ?? 'browser';

/** [{ step, at?, hold }]: the shot's lifts with the look's hold seconds, what `walkPlan` and `walkMinSeconds` take. */
export const liftsOf = (shot, look) => (shot.lift ?? []).map((l) => ({ step: l.step, at: l.at, hold: look?.kinds?.walk?.lift?.hold ?? 0 }));

// `box` ([x, y, w, h]) cut to `image`, or null when nothing of it is in the picture.
function cutTo(image, [x, y, w, h]) {
  const [left, top] = [Math.max(x, image[0]), Math.max(y, image[1])];
  const [right, bottom] = [Math.min(x + w, image[0] + image[2]), Math.min(y + h, image[1] + image[3])];
  return right > left && bottom > top ? [left, top, right - left, bottom - top] : null;
}

/**
 * The picture's place and the maps onto it: { frame, image, outer, picture, viewport, mapPoint, mapBox, stepBoxes }.
 * `image` is the drawn picture [x, y, w, h], as large as fits the room at the look's wide share; `outer` the frame around
 * it; `picture` the take's own pixel size; `mapPoint({ x, y })` a page point in canvas px; `mapBox({ x, y, width, height })`
 * a page box, cut to the picture; `stepBoxes` each of the shot's steps' mapped box (null for a step with none).
 * `ctx.data` is the look's data (look.kinds.walk).
 */
export function walkGeometry(shot, ctx, prepared) {
  const { unit, data } = ctx;
  const frame = walkFrame(shot);
  const room = roomOf(ctx);
  const space = { ...room, x: room.x + (room.w * (1 - data.wideShare)) / HALF, w: room.w * data.wideShare };
  const picture = { width: prepared.width, height: prepared.height };
  const image = fitFramed(frame, unit, picture, space);
  const { viewport } = prepared;
  const mapPoint = ({ x, y }) => [image[0] + (x / viewport.width) * image[2], image[1] + (y / viewport.height) * image[3]];
  const mapBox = (b) => cutTo(image, [...mapPoint(b), (b.width / viewport.width) * image[2], (b.height / viewport.height) * image[3]]);
  const takeSteps = new Map(prepared.steps.map((s) => [s.id, s]));
  const stepBoxes = new Map(shot.steps.map(({ id }) => [id, takeSteps.get(id)?.box ? mapBox(takeSteps.get(id).box) : null]));
  return { frame, image, outer: outerOf(frame, unit, image), picture, viewport, mapPoint, mapBox, stepBoxes };
}

/**
 * Everything a walk shot's expansion and review read: { data, look, geo, plan, lifts, planned }. `data` is the prepared
 * take, `look` the look's walk data, `geo` the geometry, `plan` the steps' seconds (walkPlan, the look's lifts included),
 * `lifts` the seconds each lift is up (liftSpans) and `planned` the camera stops (planStops). `ctx` is a kind's ctx (`prepared`: the take, `timing`, `at`, `look`, `canvas`, `unit`).
 */
export function walkSetup(shot, ctx) {
  const data = kindData(ctx.look, 'walk');
  const prepared = ctx.prepared;
  const plan = walkPlan(shot, ctx.timing, prepared, { lifts: liftsOf(shot, ctx.look) });
  const geo = walkGeometry(shot, { ...ctx, data }, prepared);
  const lifts = liftSpans(shot, ctx.timing, plan, liftsOf(shot, ctx.look));
  return { data: prepared, look: data, geo, plan, lifts, planned: planStops(shot, ctx, { geo, plan, data: prepared, lifts }) };
}

// The chrome texts (title, url) fading out over CHROME_FADE seconds from `from`.
function fadingChrome(shot, children, from) {
  if (from === undefined) return children;
  const opacity = track([{ t: 0, v: 1 }, { t: from, v: 1 }, { t: from + CHROME_FADE, v: 0 }]);
  return children.map((n) => (n.id === `${shot.id}.title` || n.id === `${shot.id}.url`
    ? node(n.type, n.id, n.props, { tracks: { ...n.tracks, opacity }, children: n.children }) : n));
}

/**
 * The shot's nodes and boxes: the framed screen (`${shot.id}.screen`, the browser chrome and the take's frames) and the
 * boxes `screen`, `image` and `step:<id>` (a step with no box of its own is the whole picture). Cursor and lift nodes
 * are not here yet: the expansion appends them after these.
 */
export function walkLayout(shot, ctx, { geo, plan, look, data, planned }) {
  const { frame, image } = geo;
  const content = node('image', `${shot.id}.screen.image`, { src: shot.src, w: image[2], h: image[3], x: image[0], y: image[1], video: { count: data.names.length } }, { tracks: { frame: walkFrameTrack(plan, data) } });
  const pushAt = planned.stops.find((s) => !s.dropped && !s.noRoom && s.zoom > 1)?.start;
  const children = fadingChrome(shot, frameNodes(shot, ctx, { frame, image, data: look, content }), pushAt);
  const boxes = { screen: geo.outer, image, ...Object.fromEntries([...geo.stepBoxes].map(([id, box]) => [`step:${id}`, box ?? image])) };
  return { nodes: [node('group', `${shot.id}.screen`, {}, { children })], boxes, camera: planned.layer === null ? [] : [planned.layer] };
}
