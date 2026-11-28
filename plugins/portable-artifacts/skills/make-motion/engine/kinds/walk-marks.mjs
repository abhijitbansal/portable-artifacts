// The `on` devices of a walk shot (shared.mjs onDevices builds them): a mark aimed at a step (`target: 'step:<id>'`) is drawn
// as the look's walk data styles it (kinds.walk.mark: the circle device's own keys over the look's, so keynote draws an ink
// ellipse where its own circle is a ruled box; `ellipse` { factor, clear } the ellipse's size). A `circle` on a step is an ellipse
// about the step box's centre with radii of half the box times `factor`, and at least `clear` units past each side of it (the
// device draws 1.25 of the box it is given, so it is given the box that makes the radii those). A mark never starts to draw
// before its step acts (its landing moves later so its first stroke is on the act), and is cleared: it fades out when the next
// played step starts, or MARK_SECONDS after it is drawn if that is sooner, and never stays up over a lift (it clears as the
// first lift after it starts). A mark aimed at `screen` is the device as built. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { CIRCLE_SCALE } from '../devices/marks.mjs';
import { buildDevice, onDevices } from './shared.mjs';
import { STEP_PREFIX } from './walk-time.mjs';

/** The seconds a mark on a step stays up, at most. */
export const MARK_SECONDS = 2;
const FADE = 0.2; // s: a mark fades out over this long, ending on its clear second
const HALF = 2;

// The device look: the look with its circle style given the walk's own keys.
const markLook = (look, mark) => (mark?.circle === undefined ? look : { ...look, devices: { ...look.devices, circle: { ...look.devices.circle, ...mark.circle } } });

// The box the circle device is given for an ellipse about the centre of `box` ([x, y, w, h]): radii of half the box times
// `factor`, at least `clear` units past each side.
function ellipseBox([x, y, w, h], { factor, clear }, unit) {
  const radius = (side) => Math.max((side / HALF) * factor, side / HALF + clear * unit);
  const [gw, gh] = [(HALF * radius(w)) / CIRCLE_SCALE, (HALF * radius(h)) / CIRCLE_SCALE];
  return [x + w / HALF - gw / HALF, y + h / HALF - gh / HALF, gw, gh];
}

// The seconds a mark drawn at `at` on step `index` clears: the next step's start, MARK_SECONDS on, or the first lift's start
// (never before it is drawn: a mark aimed later than the next step starts is gone as it lands).
function clearSecond(at, index, { plan, lifts }) {
  const next = plan.steps[index + 1]?.start ?? Infinity;
  const lift = lifts.filter((l) => l.start > at).reduce((first, l) => Math.min(first, l.start), Infinity);
  return Math.max(at, Math.min(next, at + MARK_SECONDS, lift));
}

// The mark's nodes in one group that is on until it clears and fades out ending on `clear`.
function clearing(device, id, { clear, at }) {
  const from = Math.max(at, clear - FADE);
  const opacity = track([{ t: 0, v: 1 }, { t: from, v: 1 }, { t: clear, v: 0 }]);
  return { ...device, nodes: [node('group', `${id}.clear`, {}, { tracks: { opacity }, children: device.nodes })] };
}

/**
 * The shot's `on` devices ({ nodes, before, camera, target, at } each, as onDevices gives them), the ones aimed at a step
 * styled and cleared as above. `setup` is walkSetup's ({ look, plan, lifts }), `boxes` the shot's boxes.
 */
export function walkDevices(shot, ctx, setup, boxes) {
  const { look: data, plan, lifts } = setup;
  const styled = { ...ctx, look: markLook(ctx.look, data.mark) };
  const onStep = (item) => (item.target ?? 'screen').startsWith(STEP_PREFIX);
  const plain = onDevices(shot, ctx, { boxes, defaultTarget: 'screen', skip: onStep });
  const indexOf = (item) => shot.steps.findIndex((s) => `${STEP_PREFIX}${s.id}` === item.target);
  const marks = (shot.on ?? []).flatMap((item, j) => {
    if (!onStep(item)) return [];
    const whole = boxes[item.target];
    if (!whole) throw new Error(`shot "${shot.id}": on[${j}] target "${item.target}" has no box (have: ${Object.keys(boxes).join(', ')})`);
    const box = item.do === 'circle' && data.mark?.ellipse !== undefined ? ellipseBox(whole, data.mark.ellipse, ctx.unit) : whole;
    const index = indexOf(item);
    // not before the step acts: the first stroke (the draw move before `at`) starts no earlier than its act
    const at = Math.max(ctx.at(item.at), (plan.steps[index]?.act ?? 0) + ctx.look.moves.draw.dur);
    const device = { ...buildDevice(shot, styled, { item, j, box, at }), before: null, target: item.target, at };
    return [clearing(device, `${shot.id}.on${j}`, { clear: clearSecond(at, index, { plan, lifts }), at })];
  });
  return [...plain, ...marks];
}
