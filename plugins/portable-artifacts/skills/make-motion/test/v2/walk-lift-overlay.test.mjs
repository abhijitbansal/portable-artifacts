// What the walk kind draws for a lift (the crop, its seconds, the dim, the scale it takes) and for an `on` device aimed at a
// step. Pure: the take is the committed fixture (test/v2/helpers/walk.mjs). The cursor and the ripple are in walk-overlay.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { layeredCamera } from '../../engine/graph/camera.mjs';
import { sample } from '../../engine/time/track.mjs';
import { HOLD_MIN, LIFT_LEAD, LIFT_MOVES } from '../../engine/kinds/walk-time.mjs';
import { walkSetup } from '../../engine/kinds/walk-layout.mjs';
import { LIFT_GROW } from '../../engine/kinds/walk-lift.mjs';
import { liftAt } from '../../engine/kinds/walk-pose.mjs';
import { all } from './helpers/kinds.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { EXAMPLES_DIR, committed, expandWalk, walkFilm, walkShot } from './helpers/walk.mjs';

const near = (actual, wanted, label, tolerance = 1e-6) => assert.ok(Math.abs(actual - wanted) < tolerance, `${label}: ${actual} is not ${wanted}`);
const byId = (out, id) => all(out.nodes).find((n) => n.id === id);

// ---- the lift ----

const LIFT_SHOT = (extra = {}) => walkShot({ lift: [{ step: 'tab' }], ...extra });

test('a lift crops the step\'s settled frame to its box in frame pixels, on a constant frame track', () => {
  const prepared = { w: committed() };
  const out = expandWalk(walkFilm(LIFT_SHOT()), prepared);
  const crop = byId(out, 'w.lift0.image');
  const tab = prepared.w.steps.find((s) => s.id === 'tab');
  assert.equal(crop.type, 'image');
  assert.equal(crop.props.src, 'walk-take');
  assert.deepEqual(crop.props.video, { count: prepared.w.names.length });
  // the box grown by LIFT_GROW page px on each side (clamped to the page), so the card's own border comes along
  const { viewport, scale } = prepared.w;
  const [gx, gy] = [Math.max(0, tab.box.x - LIFT_GROW), Math.max(0, tab.box.y - LIFT_GROW)];
  const [gr, gb] = [Math.min(viewport.width, tab.box.x + tab.box.width + LIFT_GROW), Math.min(viewport.height, tab.box.y + tab.box.height + LIFT_GROW)];
  assert.equal(LIFT_GROW, 3);
  assert.deepEqual(crop.props.clip.map((v) => Number(v.toFixed(6))), [gx, gy, gr - gx, gb - gy].map((v) => Number((v * scale).toFixed(6))));
  assert.deepEqual(crop.tracks.frame.points.map((p) => p.v), [tab.settledIndex]);
  const [bx, by, bw, bh] = out.boxes['step:tab'];
  const k = out.boxes.image[2] / viewport.width; // drawn px per page px
  near(crop.props.w, bw + 2 * LIFT_GROW * k, 'drawn as wide as the box and its margin', 1e-9);
  near(crop.props.h, bh + 2 * LIFT_GROW * k, 'drawn as high as the box and its margin', 1e-9);
  const group = out.nodes.find((n) => n.id === 'w.lift0');
  near(group.props.x, bx + bw / 2, 'centred on the box (x)');
  near(group.props.y, by + bh / 2, 'centred on the box (y)');
  assert.notEqual(group.props.fixed, true, 'it moves with the picture under the camera');
});

test('a box at the page\'s edge grows only as far as the page: the crop is clamped to the frame', () => {
  const prepared = { w: committed() };
  const edge = { ...prepared.w, steps: prepared.w.steps.map((s) => (s.id === 'tab' ? { ...s, box: { x: 0, y: 0, width: 120, height: 60 } } : s)) };
  const out = expandWalk(walkFilm(LIFT_SHOT()), { w: edge });
  const crop = byId(out, 'w.lift0.image');
  assert.deepEqual(crop.props.clip.map((v) => Number(v.toFixed(6))), [0, 0, (120 + LIFT_GROW) * edge.scale, (60 + LIFT_GROW) * edge.scale]);
});

test('the lift scales to the look\'s scale over 0.4 s, holds, and returns over 0.4 s to the same box', () => {
  const out = expandWalk(walkFilm(LIFT_SHOT()), { w: committed() });
  const { hold } = out.ctx.look.kinds.walk.lift;
  const { scale } = liftAt(out.ctx.look.kinds.walk.lift, 1); // the camera is at zoom 1 here: the whole view's scale
  const start = out.plan.steps[1].end + LIFT_LEAD;
  const group = out.nodes.find((n) => n.id === 'w.lift0');
  near(sample(group.tracks.scale, start), 1, 'starts at the box');
  near(sample(group.tracks.scale, start + 0.4), scale, 'up in 0.4 s');
  near(sample(group.tracks.scale, start + 0.4 + hold), scale, 'held');
  near(sample(group.tracks.scale, start + 0.8 + hold), 1, 'back on the same box');
  assert.equal(sample(group.tracks.opacity, start - 0.01), 0, 'not drawn before it starts');
  assert.equal(sample(group.tracks.opacity, start + 0.1), 1);
  assert.equal(sample(group.tracks.opacity, start + 0.8 + hold + 0.01), 0, 'not drawn after it returns');
});

test('its seconds are the ones walk-time counts in `until`, by default and with an at', () => {
  const prepared = { w: committed() };
  const { hold } = registries.looks.get('keynote').kinds.walk.lift;
  const plain = expandWalk(walkFilm(LIFT_SHOT()), prepared);
  const spanOf = (out, id) => {
    const { opacity } = out.nodes.find((n) => n.id === id).tracks;
    return [opacity.points.find((p) => p.v === 1).t, opacity.points.findLast((p) => p.v === 1).t];
  };
  const [from, to] = spanOf(plain, 'w.lift0');
  near(from, plain.plan.steps[1].end + LIFT_LEAD, 'default start');
  near(to, plain.plan.steps[1].until, 'ends where the step\'s until ends');
  near(to - from, LIFT_MOVES + hold, 'moves and hold');
  const end = plain.plan.steps[1].end;
  const later = expandWalk(walkFilm(LIFT_SHOT({ lift: [{ step: 'tab', at: end + 2 }] })), prepared);
  const [from2, to2] = spanOf(later, 'w.lift0');
  near(from2, end + 2, 'an at starts it there');
  near(to2, later.plan.steps[1].until, 'and the next step still waits for it');
  assert.ok(later.plan.steps[1].until > plain.plan.steps[1].until);
  assert.ok(HOLD_MIN < LIFT_LEAD + LIFT_MOVES + hold);
});

test('the rest dims with the look\'s lift scrim for as long as the lift is up', () => {
  const out = expandWalk(walkFilm(LIFT_SHOT()), { w: committed() });
  const { hold } = out.ctx.look.kinds.walk.lift;
  const start = out.plan.steps[1].end + LIFT_LEAD;
  const dim = out.nodes.find((n) => n.id === 'w.lift0.dim');
  assert.ok(dim, 'a dim group before the lift');
  assert.ok(out.nodes.indexOf(dim) < out.nodes.findIndex((n) => n.id === 'w.lift0'), 'drawn under the lifted card');
  const scrim = all([dim]).find((n) => n.id === 'w.lift0.focus');
  assert.ok(scrim && scrim.type === 'path', 'the focus device\'s scrim');
  assert.equal(sample(dim.tracks.opacity, start - 0.01), 0);
  assert.equal(sample(dim.tracks.opacity, start + 0.4 + hold / 2), 1);
  assert.equal(sample(dim.tracks.opacity, start + 0.8 + hold + 0.01), 0);
  assert.ok(sample(scrim.tracks.opacity, start + 0.4 + hold / 2) > 0, 'the scrim is up while the lift is');
  assert.equal(scrim.props.d.match(/M/g).length, 1, 'no hole: the card\'s own slot is dimmed too, and the raised card covers it');
});

test('the dim covers the page picture only, not the ground round the frame, and rises with the card', () => {
  for (const look of ['keynote', 'desk']) {
    const out = expandWalk(walkFilm(LIFT_SHOT(), { look }), { w: committed() });
    const { hold } = out.ctx.look.kinds.walk.lift;
    const start = out.plan.steps[1].end + LIFT_LEAD;
    const scrim = byId(out, 'w.lift0.focus');
    const nums = scrim.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const [xs, ys] = [nums.filter((_, i) => i % 2 === 0), nums.filter((_, i) => i % 2 === 1)];
    const [ix, iy, iw, ih] = out.boxes.image;
    const slack = 0.05;
    assert.ok(Math.min(...xs) >= ix - slack && Math.max(...xs) <= ix + iw + slack, `${look}: across, ${Math.min(...xs)}..${Math.max(...xs)} within the picture ${ix}..${ix + iw}`);
    assert.ok(Math.min(...ys) >= iy - slack && Math.max(...ys) <= iy + ih + slack, `${look}: down, ${Math.min(...ys)}..${Math.max(...ys)} within the picture ${iy}..${iy + ih}`);
    assert.ok(Math.min(...xs) <= ix + slack && Math.max(...xs) >= ix + iw - slack && Math.min(...ys) <= iy + slack && Math.max(...ys) >= iy + ih - slack, `${look}: and it reaches every side of the picture`);
    const dim = out.ctx.look.kinds.walk.lift.dim;
    assert.equal(sample(scrim.tracks.opacity, start), 0, `${look}: nothing dimmed before the card starts to rise`);
    assert.ok(sample(scrim.tracks.opacity, start + 0.1) > 0 && sample(scrim.tracks.opacity, start + 0.1) < dim, `${look}: coming up with the card`);
    near(sample(scrim.tracks.opacity, start + LIFT_MOVES / 2), dim, `${look}: full as the card tops out`);
    near(sample(scrim.tracks.opacity, start + LIFT_MOVES / 2 + hold / 2), dim, `${look}: and held`);
  }
});

test('a lift on a step the take has no box for is a preparer problem at the lift\'s step, not silent nodes', () => {
  const problems = prepareFilm(walkFilm(walkShot({ lift: [{ step: 'tab' }, { step: 'open' }] })), { filmDir: EXAMPLES_DIR }).problems.map((p) => `${p.path}: ${p.message}`);
  assert.deepEqual(problems, ['shots[0].lift[1].step: lift on step open: the take has no box for it']);
  assert.deepEqual(prepareFilm(walkFilm(walkShot({ lift: [{ step: 'tab' }] })), { filmDir: EXAMPLES_DIR }).problems, []);
});

// the lifted crop's drawn scale: the camera's zoom at the lift's peak times the lift group's scale there
const drawnScale = (out, id = 'w.lift0') => {
  const group = out.nodes.find((n) => n.id === id);
  const peak = group.tracks.opacity.points.find((p) => p.v === 1).t + LIFT_MOVES / 2;
  return layeredCamera(out.camera, 'test')(peak).zoom * sample(group.tracks.scale, peak);
};

test('a lift never draws past the take\'s native pixels: at a capped stop the camera eases down and the card keeps the look\'s scale', () => {
  const shot = LIFT_SHOT({ steps: [{ id: 'open' }, { id: 'tab' }, { id: 'search', at: 9 }, { id: 'hover' }, { id: 'add' }], stops: [{ to: 'step:tab' }] });
  const out = expandWalk(walkFilm(shot), { w: { ...committed(), width: 1920, height: 1080, scale: 2 } }); // a take at 2x: its pixels cap the stop
  const native = out.data.width / out.boxes.image[2];
  const { scale } = out.ctx.look.kinds.walk.lift;
  const stop = walkSetup(shot, out.ctx).planned.stops[0];
  assert.ok(stop.zoom * scale > native, 'the stop\'s zoom with the look\'s scale would pass the native pixels');
  assert.ok(drawnScale(out) <= native + 1e-6, `${drawnScale(out)} vs native ${native}`);
  const group = out.nodes.find((n) => n.id === 'w.lift0');
  // the lift is raised before the stop lands, with the camera at zoom 1: the whole view's scale
  const start = out.plan.steps[1].end + LIFT_LEAD;
  near(sample(group.tracks.scale, start + 0.4), liftAt(out.ctx.look.kinds.walk.lift, layeredCamera(out.camera, 'test')(start).zoom).scale, 'the card still scales to the look\'s scale');
  const room = expandWalk(walkFilm(shot, { look: 'keynote' }), { w: { ...committed(), width: 5760, height: 3240, scale: 6 } });
  const roomy = room.data.width / room.boxes.image[2];
  const roomCam = layeredCamera(room.camera, 'test');
  near(drawnScale(room), liftAt(room.ctx.look.kinds.walk.lift, roomCam(start).zoom).scale * roomCam(start + 0.4).zoom, 'with room above the push the look\'s scale holds');
  assert.ok(drawnScale(room) <= roomy + 1e-6);
});

test('at whole view the lift takes the look\'s wholeScale (smaller than its scale, so the card keeps clear of its neighbours)', () => {
  const out = expandWalk(walkFilm(LIFT_SHOT()), { w: committed() });
  const group = out.nodes.find((n) => n.id === 'w.lift0');
  const peak = out.plan.steps[1].end + LIFT_LEAD + 0.4;
  const { scale, wholeScale } = out.ctx.look.kinds.walk.lift;
  assert.ok(wholeScale > 1 && wholeScale < scale, `the look names a wholeScale: ${wholeScale} under ${scale}`);
  near(sample(group.tracks.scale, peak), wholeScale, 'scale at the peak');
});

test('every lift of a shot is drawn, each under its own id', () => {
  const out = expandWalk(walkFilm(walkShot({ lift: [{ step: 'tab' }, { step: 'add' }] })), { w: committed() });
  for (const id of ['w.lift0', 'w.lift1', 'w.lift0.dim', 'w.lift1.dim']) assert.ok(out.nodes.some((n) => n.id === id), id);
});

// ---- `on` devices aimed at a step ----

test('desk: a circle on step:search is the circle device, in the walk look\'s mark style, built round that step\'s mapped box (fitted)', () => {
  const prepared = { w: committed() };
  const out = expandWalk(walkFilm(walkShot({ on: [{ at: 'sentence:3', do: 'circle', target: 'step:search' }] }), { look: 'desk' }), prepared);
  const { look } = out.ctx;
  const whole = out.boxes['step:search'];
  assert.notDeepEqual(whole, out.boxes.image, 'the step has a box of its own');
  const box = [whole[0] + (whole[2] * (1 - look.kinds.walk.mark.fit)) / 2, whole[1], whole[2] * look.kinds.walk.mark.fit, whole[3]];
  const styled = { ...look, devices: { ...look.devices, circle: { ...look.devices.circle, ...look.kinds.walk.mark.circle } } };
  const built = registries.devices.get('circle').build({ id: 'w.on0', box, at: out.ctx.at('sentence:3'), look: styled, unit: out.ctx.unit, seed: out.ctx.seed, measure: out.ctx.measure });
  const group = all(out.nodes).find((n) => n.id === 'w.on0.clear');
  const drawn = group.children.filter((n) => !n.id.endsWith('.glow'));
  assert.equal(drawn.length, built.nodes.length);
  assert.deepEqual(drawn, built.nodes);
  const numbers = drawn.flatMap((n) => n.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number));
  const xs = numbers.filter((_, i) => i % 2 === 0), ys = numbers.filter((_, i) => i % 2 === 1);
  const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const slack = 0.01; // the path is written to two decimals
  assert.ok(left <= box[0] + slack && right >= box[0] + box[2] - slack && top <= box[1] + slack && bottom >= box[1] + box[3] - slack, `round the box: ${[left, top, right, bottom]} vs ${box}`);
  near((left + right) / 2, box[0] + box[2] / 2, 'centred on the box (x)', 6); // a hand circle runs on past where it began
  near((top + bottom) / 2, box[1] + box[3] / 2, 'centred on the box (y)', 6);
});
