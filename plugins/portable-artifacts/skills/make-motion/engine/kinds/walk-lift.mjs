// The walk shot's lifts: a step's box cropped from its settled frame and brought forward. From its start (the lift's `at`,
// else LIFT_LEAD after the step ends) the crop, drawn exactly over the box it was cut from, scales up to the look's
// kinds.walk.lift.scale over LIFT_MOVES / 2 seconds on the look's elevated shadow, holds lift.hold, and returns over the
// same time to the same box. The rest of the picture dims with the `focus` device for as long as the lift is up. The crop is
// an image node on the take's frames (props.video) with a constant frame track and `clip` the box in the take's own
// pixels, so the lift shows the frame as stored, never a redrawn or upscaled one. Its seconds are walk-time's (`until`
// counts them: the next step waits for the lift). Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { registries } from '../registry.mjs';
import { elevatedShadow } from '../devices/card.mjs';
import { nativeZoom } from './screen-layout.mjs';
import { LIFT_LEAD, LIFT_MOVES, anchorOf } from './walk-time.mjs';

const HALF = 2;
const MOVE = LIFT_MOVES / HALF; // s, up and back
const MOVE_EASE = 'inOutCubic';
const COVER = 4; // the dim covers the canvas grown this much about its centre, so a camera push leaves no edge bare

// A track that is 1 from `from` to `to` and 0 outside; with `fall` it goes off over the `fall` seconds before `to`.
const windowTrack = (from, to, fall = 0) => track([
  { t: 0, v: 0 }, { t: from, v: 0 }, { t: from, v: 1 },
  ...(fall > 0 ? [{ t: to - fall, v: 1 }, { t: to, v: 0 }] : [{ t: to, v: 1 }, { t: to, v: 0 }]),
]);

// [x, y, w, h] on the drawn picture to the take's own pixels (clip): the picture is drawn at `image`, the take has `picture`.
const clipOf = ([x, y, w, h], image, picture) => {
  const [kx, ky] = [picture.width / image[2], picture.height / image[3]];
  return [(x - image[0]) * kx, (y - image[1]) * ky, w * kx, h * ky];
};

// The crop, up and back: a group at the box's centre scaling about it, the shadow fading with the scale, the image on top.
function cardNode(id, shot, { box, clip, take, data, look, ctx, start, end, scale }) {
  const [x, y, w, h] = box;
  const { hold } = look.lift;
  const peak = start + MOVE, back = peak + hold;
  const local = [-w / HALF, -h / HALF, w, h];
  const crop = node('image', `${id}.image`, { src: shot.src, w, h, x: local[0], y: local[1], clip, video: { count: data.names.length } }, { tracks: { frame: track([{ t: 0, v: take.settledIndex }]) } });
  const shadow = elevatedShadow(id, local, 0, ctx.look, ctx.unit, ctx.look.devices.card?.layers ?? []);
  const rise = track([{ t: 0, v: 0 }, { t: start, v: 0 }, { t: peak, v: 1 }, { t: back, v: 1 }, { t: end, v: 0 }]);
  const children = [...(shadow.length === 0 ? [] : [node('group', `${id}.shadow`, {}, { tracks: { opacity: rise }, children: shadow })]), crop];
  const sizing = track([{ t: 0, v: 1 }, { t: start, v: 1 }, { t: peak, v: scale, ease: MOVE_EASE }, { t: back, v: scale }, { t: end, v: 1, ease: MOVE_EASE }]);
  return node('group', id, { x: x + w / HALF, y: y + h / HALF }, { tracks: { scale: sizing, opacity: windowTrack(start, end) }, children });
}

// The rest dimmed: the focus device's scrim with the lifted card's place (the card at full scale) left clear, on while the
// lift is up and fading with its return.
function dimNode(id, { box, ctx, start, end, scale }) {
  const focus = registries.devices.get('focus');
  if (!focus.supports(ctx.look)) return [];
  const { canvas } = ctx;
  const [x, y, w, h] = box;
  const hole = [x + w / HALF - (w * scale) / HALF, y + h / HALF - (h * scale) / HALF, w * scale, h * scale];
  const cover = [-((COVER - 1) * canvas.w) / HALF, -((COVER - 1) * canvas.h) / HALF, COVER * canvas.w, COVER * canvas.h];
  const { nodes } = focus.build({ id: `${id}.focus`, box: hole, at: start + ctx.look.moves.draw.dur, look: ctx.look, unit: ctx.unit, seed: ctx.seed, cover });
  return [node('group', `${id}.dim`, {}, { tracks: { opacity: windowTrack(start, end, MOVE) }, children: nodes })];
}

// The lift's scale: the look's, held so the camera's zoom (the largest at the lift's keys) times it never passes the zoom at
// which the take shows one of its pixels per canvas pixel (claim 1: the lift never draws past the take's own pixels). Never
// under 1: a camera already past native (it cannot be, stops are capped there) leaves the crop on the box.
function liftScale(look, cam, [start, end], native) {
  const zoom = Math.max(...[start, start + MOVE, end - MOVE, end].map((t) => cam(t).zoom));
  return Math.max(1, Math.min(look.lift.scale, native / zoom));
}

/**
 * The nodes of the shot's lifts: for each `shot.lift` entry k, `<shot>.lift<k>.dim` (the focus scrim) then `<shot>.lift<k>`
 * (the card). `setup` is walkSetup's ({ geo, plan, data, look }), `ctx` a kind's ctx, `cam` the shot's camera with every
 * layer. A lift on a step with no box draws nothing (the preparer refuses it first: walkProblems).
 */
export function liftNodes(shot, ctx, { geo, plan, data, look }, cam) {
  const anchor = anchorOf(shot, ctx.timing);
  return (shot.lift ?? []).flatMap((lift, k) => {
    const index = shot.steps.findIndex((s) => s.id === lift.step);
    const box = geo.stepBoxes.get(lift.step);
    const take = data.steps.find((s) => s.id === lift.step);
    if (index < 0 || !box || !take || look.lift === undefined) return [];
    const start = lift.at === undefined ? plan.steps[index].end + LIFT_LEAD : anchor(lift.at);
    const end = start + LIFT_MOVES + look.lift.hold;
    const id = `${shot.id}.lift${k}`;
    const scale = liftScale(look, cam, [start, end], nativeZoom(geo.picture, geo.image));
    const parts = { box, look, ctx, start, end, scale };
    return [...dimNode(id, parts), cardNode(id, shot, { ...parts, clip: clipOf(box, geo.image, geo.picture), take, data })];
  });
}
