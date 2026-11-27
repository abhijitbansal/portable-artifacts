// The `on` devices of a walk shot (shared.mjs onDevices builds them): a mark aimed at a step (`target: 'step:<id>'`) is drawn
// as the look's walk data styles it (kinds.walk.mark: the circle device's own keys over the look's, a `glow` stroke under it,
// `fit` the share of the box's width the circle is drawn on, so a hand circle stays inside a field beside a button) and
// is cleared: it fades out when the next played step starts, or MARK_SECONDS after it is drawn if that is sooner, and never
// stays up over a lift (it clears as the first lift after it starts). A mark aimed at `screen` is the device as built. Pure and
// DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { onDevices } from './shared.mjs';
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
  const marks = onDevices(shot, styled, { boxes: stepBoxes, defaultTarget: 'screen', skip: (item) => !onStep(item) });
  const ids = (shot.on ?? []).map((item, j) => [item, j]).filter(([item]) => onStep(item)).map(([, j]) => j);
  const cleared = marks.map((d, k) => {
    const index = shot.steps.findIndex((s) => `${STEP_PREFIX}${s.id}` === d.target);
    return clearing(d, `${shot.id}.on${ids[k]}`, { clear: clearSecond(d.at, index, { plan, lifts }), at: d.at, glow: data.mark?.glow });
  });
  return [...plain, ...cleared];
}
