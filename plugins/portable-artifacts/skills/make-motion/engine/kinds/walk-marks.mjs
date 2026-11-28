// The `on` devices of a walk shot (shared.mjs onDevices builds them): a mark aimed at a step (`target: 'step:<id>'`) is drawn
// as the look's walk data styles it (kinds.walk.mark: `rounded`, a rounded rectangle outside the box by a small gap, or the
// circle device's own keys over the look's; a `glow` stroke under it; `fit` the share of the box's width the circle is drawn
// on, so a hand circle stays inside a field beside a button). A mark never starts to draw before its step acts (its landing
// moves later so its first stroke is on the act), and is cleared: it fades out when the next played step starts, or
// MARK_SECONDS after it is drawn if that is sooner, and never stays up over a lift (it clears as the first lift after it
// starts). A mark aimed at `screen` is the device as built. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { colourOf, landing, roundedRect } from '../devices/shared.mjs';
import { buildDevice, onDevices } from './shared.mjs';
import { STEP_PREFIX } from './walk-time.mjs';

/** The seconds a mark on a step stays up, at most. */
export const MARK_SECONDS = 2;
const FADE = 0.2; // s: a mark fades out over this long, ending on its clear second
const HALF = 2;

// The device look: the look with its circle style given the walk's own keys.
const markLook = (look, mark) => (mark?.circle === undefined ? look : { ...look, devices: { ...look.devices, circle: { ...look.devices.circle, ...mark.circle } } });

// `box` with its width cut to `fit` of itself about its centre.
const fitted = ([x, y, w, h], fit) => [x + (w * (1 - fit)) / HALF, y, w * fit, h];

// The seconds a mark drawn at `at` on step `index` clears: the next step's start, MARK_SECONDS on, or the first lift's start
// (never before it is drawn: a mark aimed later than the next step starts is gone as it lands).
function clearSecond(at, index, { plan, lifts }) {
  const next = plan.steps[index + 1]?.start ?? Infinity;
  const lift = lifts.filter((l) => l.start > at).reduce((first, l) => Math.min(first, l.start), Infinity);
  return Math.max(at, Math.min(next, at + MARK_SECONDS, lift));
}

// A wider, fainter stroke of each ring, drawn under it.
function withGlow(nodes, glow) {
  if (glow === undefined) return nodes;
  return nodes.flatMap((n) => (n.type === 'path' && n.props.stroke
    ? [node('path', `${n.id}.glow`, { ...n.props, strokeWidth: n.props.strokeWidth * glow.widen, opacity: glow.alpha }, { tracks: n.tracks, step: n.step }), n]
    : [n]));
}

// The mark's nodes in one group that is on until it clears and fades out ending on `clear`.
function clearing(device, id, { clear, at, glow }) {
  const from = Math.max(at, clear - FADE);
  const opacity = track([{ t: 0, v: 1 }, { t: from, v: 1 }, { t: clear, v: 0 }]);
  return { ...device, nodes: [node('group', `${id}.clear`, {}, { tracks: { opacity }, children: withGlow(device.nodes, glow) })] };
}

// The seconds a mark's draw-on takes: the look's `kinds.walk.mark.rounded.dur` when it names one, else the look's draw move.
const drawSeconds = (look, rounded) => rounded?.dur ?? look.moves.draw.dur;

// The rounded-rectangle mark (look data kinds.walk.mark.rounded: { color, width, gap, radius, dur }, sizes in units, `dur` in
// seconds): a stroke `gap` outside `box`, its corners concentric with a box corner of `radius`, revealed around its path over
// `dur` and landing on `at`.
function roundedMark(id, { box, at, look, unit, rounded }) {
  const [x, y, w, h] = box;
  const gap = rounded.gap * unit;
  const d = roundedRect(x - gap, y - gap, w + HALF * gap, h + HALF * gap, (rounded.radius + rounded.gap) * unit);
  const step = look.hand ? look.moves.draw.step : undefined;
  const move = { ...look.moves.draw, dur: drawSeconds(look, rounded) };
  return [node('path', id, { d, stroke: colourOf(look, rounded.color), strokeWidth: rounded.width * unit, lineJoin: 'round' }, { tracks: { draw: landing(at, move, 0, 1, step) }, step })];
}

// One step-aimed mark as a device: { nodes, target, at, before, camera }.
function stepMark(shot, ctx, { item, j, box, at, rounded }) {
  if (rounded !== undefined && item.do === 'circle') return { nodes: roundedMark(`${shot.id}.on${j}`, { box, at, look: ctx.look, unit: ctx.unit, rounded }), before: null, target: item.target, at };
  return { ...buildDevice(shot, ctx, { item, j, box, at }), before: null, target: item.target, at };
}

/**
 * The shot's `on` devices ({ nodes, before, camera, target, at } each, as onDevices gives them), the ones aimed at a step
 * styled and cleared as above. `setup` is walkSetup's ({ look, plan, lifts }), `boxes` the shot's boxes.
 */
export function walkDevices(shot, ctx, setup, boxes) {
  const { look: data, plan, lifts } = setup;
  const stepBoxes = data.mark?.fit === undefined ? boxes : Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, k.startsWith(STEP_PREFIX) ? fitted(b, data.mark.fit) : b]));
  const styled = { ...ctx, look: markLook(ctx.look, data.mark) };
  const onStep = (item) => (item.target ?? 'screen').startsWith(STEP_PREFIX);
  const plain = onDevices(shot, ctx, { boxes, defaultTarget: 'screen', skip: onStep });
  const indexOf = (item) => shot.steps.findIndex((s) => `${STEP_PREFIX}${s.id}` === item.target);
  const marks = (shot.on ?? []).flatMap((item, j) => {
    if (!onStep(item)) return [];
    const box = stepBoxes[item.target];
    if (!box) throw new Error(`shot "${shot.id}": on[${j}] target "${item.target}" has no box (have: ${Object.keys(stepBoxes).join(', ')})`);
    const index = indexOf(item);
    // not before the step acts: the first stroke (the draw move before `at`) starts no earlier than its act
    const at = Math.max(ctx.at(item.at), (plan.steps[index]?.act ?? 0) + drawSeconds(ctx.look, data.mark?.rounded));
    const device = stepMark(shot, styled, { item, j, box, at, rounded: data.mark?.rounded });
    return [clearing(device, `${shot.id}.on${j}`, { clear: clearSecond(at, index, { plan, lifts }), at, glow: data.mark?.glow })];
  });
  return [...plain, ...marks];
}
