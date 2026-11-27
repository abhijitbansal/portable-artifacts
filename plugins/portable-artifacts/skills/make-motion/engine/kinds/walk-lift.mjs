// The walk shot's lifts: a step's box cropped from its settled frame and brought forward. From its start (the lift's `at`,
// else LIFT_LEAD after the step ends: walk-time.mjs liftSpans) the crop, drawn exactly over the box it was cut from, scales up
// to the look's kinds.walk.lift.scale over LIFT_MOVES / 2 seconds and rises lift.rise of the canvas height, on the look's own
// shadow layers (lift.layers), holds lift.hold, and returns over the same time to the same box. The crop is drawn through a
// rounded rectangle of lift.radius (page px). The whole picture dims (no hole: the card covers its own slot), in the look's lift
// scrim colour and dim, for as long as the lift is up. The camera eases its zoom
// down with the card (walk-camera.mjs), so the card's scale, held at every film frame to the take's native zoom over the
// camera's, never draws past the take's own pixels (claim 1). The crop is an image node on the take's frames (props.video)
// with a constant frame track and `clip` the box in the take's own pixels, so the lift shows the frame as stored, never a
// redrawn or upscaled one. Its seconds are walk-time's (`until` counts them: the next step waits for the lift). Pure and
// DOM-free.
import { node } from '../graph/node.mjs';
import { track, sample } from '../time/track.mjs';
import { registries } from '../registry.mjs';
import { elevatedShadow } from '../devices/card.mjs';
import { paperScrim } from './shared.mjs';
import { nativeZoom } from './screen-layout.mjs';
import { LIFT_MOVES } from './walk-time.mjs';
import { liftRise } from './walk-pose.mjs';

const HALF = 2;
const MOVE = LIFT_MOVES / HALF; // s, up and back
const MOVE_EASE = 'inOutCubic';
const COVER = 4; // the dim covers the canvas grown this much about its centre, so a camera push leaves no edge bare
const EPSILON = 1e-9;
const DEFAULT_DIM = 0.6; // the focus device's own, when neither the look's lift nor its focus device names one

// A track that is 1 from `from` to `to` and 0 outside; with `fall` it goes off over the `fall` seconds before `to`.
const windowTrack = (from, to, fall = 0) => track([
  { t: 0, v: 0 }, { t: from, v: 0 }, { t: from, v: 1 },
  ...(fall > 0 ? [{ t: to - fall, v: 1 }, { t: to, v: 0 }] : [{ t: to, v: 1 }, { t: to, v: 0 }]),
]);

// A track from 0 to `peak` over MOVE seconds from `start`, held until `end` - MOVE, and back to 0 at `end`.
const upAndBack = (start, end, peak = 1) => track([{ t: 0, v: 0 }, { t: start, v: 0 }, { t: start + MOVE, v: peak, ease: MOVE_EASE }, { t: end - MOVE, v: peak }, { t: end, v: 0, ease: MOVE_EASE }]);

// [x, y, w, h] on the drawn picture to the take's own pixels (clip): the picture is drawn at `image`, the take has `picture`.
const clipOf = ([x, y, w, h], image, picture) => {
  const [kx, ky] = [picture.width / image[2], picture.height / image[3]];
  return [(x - image[0]) * kx, (y - image[1]) * ky, w * kx, h * ky];
};

// The card's scale at every film frame of the lift: the look's scale up and back, held to native / camera zoom (never under 1).
function scaleTrack({ start, end }, { scale, cam, native, fps }) {
  const ideal = track([{ t: 0, v: 1 }, { t: start, v: 1 }, { t: start + MOVE, v: scale, ease: MOVE_EASE }, { t: end - MOVE, v: scale }, { t: end, v: 1, ease: MOVE_EASE }]);
  const first = Math.ceil(start * fps - EPSILON), last = Math.floor(end * fps + EPSILON);
  const times = [start, ...Array.from({ length: Math.max(0, last - first + 1) }, (_, k) => (first + k) / fps), end, start + MOVE, end - MOVE];
  const keys = [...new Set(times)].sort((a, b) => a - b).map((t) => ({ t, v: Math.max(1, Math.min(sample(ideal, t), native / cam(t).zoom)) }));
  return track([{ t: 0, v: 1 }, ...keys]);
}

// The crop, up and back: a group at the box's centre scaling about it and rising, the shadow fading with it, the image on top.
function cardNode(id, shot, { box, clip, take, data, look, ctx, span, sizing, radius }) {
  const [x, y, w, h] = box;
  const { start, end } = span;
  const local = [-w / HALF, -h / HALF, w, h];
  // `round`: the crop is drawn through a rounded rectangle (the page's own card corners), so no square corner of the
  // frame shows round it; nothing outside the box is drawn
  const crop = node('image', `${id}.image`, { src: shot.src, w, h, x: local[0], y: local[1], clip, round: radius, video: { count: data.names.length } }, { tracks: { frame: track([{ t: 0, v: take.settledIndex }]) } });
  const shadow = elevatedShadow(id, local, radius, ctx.look, ctx.unit, look.lift.layers ?? ctx.look.devices.card?.layers ?? []);
  const children = [...(shadow.length === 0 ? [] : [node('group', `${id}.shadow`, {}, { tracks: { opacity: upAndBack(start, end) }, children: shadow })]), crop];
  const centre = y + h / HALF;
  const rise = liftRise(look.lift, box, ctx.canvas.h);
  const lifted = track([{ t: 0, v: centre }, { t: start, v: centre }, { t: start + MOVE, v: centre - rise, ease: MOVE_EASE }, { t: end - MOVE, v: centre - rise }, { t: end, v: centre, ease: MOVE_EASE }]);
  return node('group', id, { x: x + w / HALF, y: centre }, { tracks: { scale: sizing, y: lifted, opacity: windowTrack(start, end) }, children });
}

// The look with the lift's own scrim: the colour and dim kinds.walk.lift names, in place of the focus device's.
const scrimLook = (ctx, lift) => ({ ...ctx.look, devices: { ...ctx.look.devices, focus: { ...ctx.look.devices.focus, dim: lift.dim ?? ctx.look.devices.focus.dim, ...(lift.scrim === undefined ? {} : { scrim: lift.scrim }) } } });

// The rest dimmed: the focus device's scrim (the look's lift colour and dim) over the whole canvas, on while the lift is up
// and fading with its return. It has no hole: the card's own slot is dimmed too, and the raised card (which covers its slot,
// walk-pose.mjs liftRise) is drawn over it, so no outline of the slot shows round the card.
function dimNode(id, { ctx, span, look }) {
  if (!registries.devices.get('focus').supports(ctx.look)) return [];
  const { canvas } = ctx;
  const lift = scrimLook(ctx, look.lift);
  const [x, y, w, h] = [-((COVER - 1) * canvas.w) / HALF, -((COVER - 1) * canvas.h) / HALF, COVER * canvas.w, COVER * canvas.h];
  const scrim = paperScrim({ id: `${id}.focus`, cover: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]], at: span.start + MOVE, dur: ctx.look.moves.draw.dur, opacity: lift.devices.focus.dim ?? DEFAULT_DIM, look: lift });
  return [node('group', `${id}.dim`, {}, { tracks: { opacity: windowTrack(span.start, span.end, MOVE) }, children: [scrim] })];
}

/**
 * The nodes of the shot's lifts: for each `shot.lift` entry k, `<shot>.lift<k>.dim` (the focus scrim) then `<shot>.lift<k>`
 * (the card). `setup` is walkSetup's ({ geo, data, look, lifts }), `ctx` a kind's ctx, `cam` the shot's camera with every
 * layer. A lift on a step with no box draws nothing (the preparer refuses it first: walkProblems).
 */
export function liftNodes(shot, ctx, { geo, data, look, lifts }, cam) {
  const native = nativeZoom(geo.picture, geo.image);
  return lifts.flatMap((span) => {
    const box = geo.stepBoxes.get(span.step);
    const take = data.steps.find((s) => s.id === span.step);
    if (!box || !take || look.lift === undefined) return [];
    const id = `${shot.id}.lift${span.k}`;
    const sizing = scaleTrack(span, { scale: look.lift.scale, cam, native, fps: ctx.fps });
    const radius = (look.lift.radius ?? 0) * (geo.image[2] / geo.viewport.width); // the look's page px, in drawn px
    const parts = { box, look, ctx, span, sizing, radius };
    return [...dimNode(id, parts), cardNode(id, shot, { ...parts, clip: clipOf(box, geo.image, geo.picture), take, data })];
  });
}
