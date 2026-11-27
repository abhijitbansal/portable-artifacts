// The walk lift reads as a lift (gate round 1) and keeps claim 1: while it is up the camera eases its zoom down so the card
// scales to at least 1.08 within the take's native pixels, the card rises, carries a clear shadow of the look's own, the
// scrim behind is darker, and the whole card stays inside the title-safe pad. Pure, on the committed take.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layeredCamera, pointThroughCamera } from '../../engine/graph/camera.mjs';
import { sample } from '../../engine/time/track.mjs';
import { LIFT_MOVES } from '../../engine/kinds/walk-time.mjs';
import { all } from './helpers/kinds.mjs';
import { committed, expandWalk, walkFilm, walkShot } from './helpers/walk.mjs';

const FPS = 30;
const GATE = () => walkShot({ stops: [{ to: 'step:tab' }, { to: 'step:hover' }, { to: 'step:add' }, { to: 'whole' }], lift: [{ step: 'hover' }] });
// a take at 2x (native zoom 1.4): its stops are capped by its pixels, so a lift has to bring the camera down
const LOWRES = () => ({ ...committed(), width: 1920, height: 1080, scale: 2 });
const outOf = (look, shot = GATE(), data = committed()) => expandWalk(walkFilm(shot, { look }), { w: data });
const byId = (out, id) => all(out.nodes).find((n) => n.id === id);
const nativeOf = (out) => out.data.width / out.boxes.image[2];

// the lift's seconds: the card is fully up from start + 0.4 to end - 0.4
function spanOf(out) {
  const { opacity } = byId(out, 'w.lift0').tracks;
  const on = opacity.points.filter((p) => p.v === 1).map((p) => p.t);
  const [start, end] = [on[0], on.at(-1)];
  return { start, end, peak: start + LIFT_MOVES / 2, back: end - LIFT_MOVES / 2 };
}

// the card's four corners on the canvas at t (the group's scale and the camera's every layer)
function cardRect(out, t) {
  const group = byId(out, 'w.lift0');
  const [x, y, s] = [group.props.x, sample(group.tracks.y, t), sample(group.tracks.scale, t)];
  const [w, h] = [out.boxes['step:hover'][2], out.boxes['step:hover'][3]];
  const cam = layeredCamera(out.camera, 'test')(t);
  const [l, top] = pointThroughCamera([x - (w * s) / 2, y - (h * s) / 2], cam, out.ctx.canvas);
  const [r, bottom] = pointThroughCamera([x + (w * s) / 2, y + (h * s) / 2], cam, out.ctx.canvas);
  return { l, top, r, bottom };
}

test('the lift scales the card to the look\'s scale, at least 1.08, within the take\'s native pixels', () => {
  for (const look of ['keynote', 'desk']) {
    const out = outOf(look);
    const { peak } = spanOf(out);
    const scale = sample(byId(out, 'w.lift0').tracks.scale, peak);
    assert.ok(scale >= 1.08, `${look}: the card scales to ${scale}`);
    const cam = layeredCamera(out.camera, 'test');
    assert.ok(cam(peak).zoom <= nativeOf(out) / scale + 1e-6, `${look}: camera zoom ${cam(peak).zoom} over native/scale ${nativeOf(out) / scale}`);
  }
});

test('the camera eases its zoom down for the lift: it is lower at the peak than at the stop before it (a take whose pixels cap its stops)', () => {
  for (const look of ['keynote', 'desk']) {
    const out = outOf(look, GATE(), LOWRES());
    const { start, peak } = spanOf(out);
    const cam = layeredCamera(out.camera, 'test');
    assert.ok(cam(peak).zoom < cam(start - 0.01).zoom - 0.05, `${look}: ${cam(peak).zoom} vs ${cam(start - 0.01).zoom}`);
    assert.ok(cam(start + 0.1).zoom < cam(start - 0.01).zoom, `${look}: the ease has begun with the card`);
  }
});

test('claim 1 holds at every film frame of the lift: camera zoom times the card\'s scale never passes the take\'s native zoom', () => {
  for (const [look, data] of [['keynote', committed()], ['desk', committed()], ['keynote', LOWRES()], ['desk', LOWRES()]]) {
    const out = outOf(look, GATE(), data);
    const { start, end } = spanOf(out);
    const cam = layeredCamera(out.camera, 'test');
    const group = byId(out, 'w.lift0');
    for (let k = Math.floor(start * FPS); k <= Math.ceil(end * FPS); k += 1) {
      const t = k / FPS;
      const drawn = cam(t).zoom * sample(group.tracks.scale, t);
      assert.ok(drawn <= nativeOf(out) + 1e-6, `${look} at ${t.toFixed(3)}: ${drawn} vs native ${nativeOf(out)}`);
    }
  }
});

test('the card rises: about 1.5% of the canvas height up at the peak, back to the box when it returns', () => {
  for (const look of ['keynote', 'desk']) {
    const out = outOf(look);
    const { start, peak, end } = spanOf(out);
    const group = byId(out, 'w.lift0');
    const [, by, , bh] = out.boxes['step:hover'];
    const centre = by + bh / 2;
    assert.ok(Math.abs(sample(group.tracks.y, start) - centre) < 1e-6, `${look}: on the box at the start`);
    assert.ok(Math.abs(centre - sample(group.tracks.y, peak) - 0.015 * out.ctx.canvas.h) < 1e-6, `${look}: risen at the peak`);
    assert.ok(Math.abs(sample(group.tracks.y, end) - centre) < 1e-6, `${look}: down at the end`);
  }
});

test('the card carries a clear shadow of the look\'s own: layers of the look\'s walk data, fading in with the card, in both looks', () => {
  for (const look of ['keynote', 'desk']) {
    const out = outOf(look);
    const { peak } = spanOf(out);
    const shadow = byId(out, 'w.lift0.shadow');
    assert.ok(shadow, `${look}: a shadow group`);
    const layers = out.ctx.look.kinds.walk.lift.layers;
    assert.ok(layers.length >= 2 && layers.every((l) => l.alpha > 0), `${look}: the look's own layers`);
    assert.equal(shadow.children.length, layers.length, `${look}: one soft shadow per layer`);
    assert.equal(sample(shadow.tracks.opacity, peak), 1);
    assert.equal(sample(shadow.tracks.opacity, 0), 0);
  }
});

const luminance = (hex) => [1, 3, 5].reduce((sum, i, k) => sum + parseInt(hex.slice(i, i + 2), 16) * [0.2126, 0.7152, 0.0722][k], 0);

test('the scrim behind is darker: the look\'s lift scrim colour (darker than its paper, which the focus device would use) at the look\'s lift dim', () => {
  for (const look of ['keynote', 'desk']) {
    const out = outOf(look);
    const { peak } = spanOf(out);
    const scrim = byId(out, 'w.lift0.focus');
    const data = out.ctx.look.kinds.walk.lift;
    assert.equal(scrim.props.fill, out.ctx.look.palette[data.scrim], `${look}: scrim colour`);
    assert.ok(luminance(scrim.props.fill) < luminance(out.ctx.look.palette.paper) / 2, `${look}: darker than the paper scrim`);
    assert.ok(Math.abs(sample(scrim.tracks.opacity, peak) - data.dim) < 1e-6, `${look}: at ${data.dim} while the lift is up`);
  }
});

test('the whole lifted card stays inside the title-safe pad for as long as it is up', () => {
  for (const look of ['keynote', 'desk']) {
    const out = outOf(look);
    const { peak, back } = spanOf(out);
    const pad = out.ctx.look.kinds.walk.pushPad * out.ctx.unit;
    const { w, h } = out.ctx.canvas;
    for (let t = peak; t <= back + 1e-9; t += 0.1) {
      const { l, top, r, bottom } = cardRect(out, t);
      assert.ok(l >= pad - 1 && top >= pad - 1 && r <= w - pad + 1 && bottom <= h - pad + 1, `${look} at ${t.toFixed(2)}: ${[l, top, r, bottom].map(Math.round)} inside ${pad}`);
    }
  }
});

test('a lift at the whole view keeps the look\'s scale and the camera where it is', () => {
  const out = outOf('keynote', walkShot({ lift: [{ step: 'tab' }] }));
  const { peak } = spanOf(out);
  assert.equal(sample(byId(out, 'w.lift0').tracks.scale, peak), out.ctx.look.kinds.walk.lift.scale);
  assert.ok(layeredCamera(out.camera, 'test')(peak).zoom < 1 + 1e-9);
});

test('a lift on a take whose pixels leave no room to zoom (native zoom under 1) leaves the camera where it is: no pan to re-centre the picture', () => {
  const out = outOf('keynote', walkShot({ lift: [{ step: 'tab' }] }), { ...committed(), width: 960, height: 540, scale: 1 });
  assert.equal(out.camera.length, 1, 'only the look\'s own drift');
  assert.equal(sample(byId(out, 'w.lift0').tracks.scale, spanOf(out).peak), 1, 'the card has no room to scale either');
});
