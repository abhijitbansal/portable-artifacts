// What the walk kind draws over its picture: the cursor and its click ripple, the lift, and the `on` devices aimed at a
// step. Pure: the take is the committed fixture, or a hand-made one of plain runs of frames (test/v2/helpers/walk.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { layeredCamera, pointThroughCamera } from '../../engine/graph/camera.mjs';
import { sample } from '../../engine/time/track.mjs';
import { GLIDE, HOLD_MIN, LIFT_LEAD, LIFT_MOVES } from '../../engine/kinds/walk-time.mjs';
import { walkSetup } from '../../engine/kinds/walk-layout.mjs';
import { all } from './helpers/kinds.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { EXAMPLES_DIR, committed, expandWalk, handShot, handTake, walkFilm, walkShot } from './helpers/walk.mjs';

const FPS = 30;
const near = (actual, wanted, label, tolerance = 1e-6) => assert.ok(Math.abs(actual - wanted) < tolerance, `${label}: ${actual} is not ${wanted}`);
const byId = (out, id) => all(out.nodes).find((n) => n.id === id);
const filmOfHand = (data, extra = {}) => walkFilm(handShot(data, extra));
const THREE = () => handTake([30, 30, 30], [[40, 40, 120, 60], [400, 200, 120, 60], [760, 420, 120, 60]]);
const expandHand = (data, extra) => expandWalk(filmOfHand(data, extra), { w: data });

// a step's page point on the drawn picture, then through the shot's own camera (every layer) at shot second t
function through(out, point, t) {
  const [ix, iy, iw, ih] = out.boxes.image;
  const { width, height } = out.data.viewport;
  return pointThroughCamera([ix + (point.x / width) * iw, iy + (point.y / height) * ih], layeredCamera(out.camera, 'test')(t), out.ctx.canvas);
}
const cursorAt = (out, t) => {
  const cursor = byId(out, 'w.cursor');
  return [sample(cursor.tracks.x, t), sample(cursor.tracks.y, t)];
};

// ---- the cursor ----

test('the cursor is a fixed node in the look\'s ink with a paper keyline, 5% of the canvas high', () => {
  const out = expandHand(THREE());
  const cursor = out.nodes.find((n) => n.id === 'w.cursor');
  assert.ok(cursor, 'a top-level cursor node (the camera skips only top-level fixed nodes)');
  assert.equal(cursor.props.fixed, true);
  const arrow = byId(out, 'w.cursor.arrow');
  assert.equal(arrow.type, 'path');
  assert.equal(arrow.props.fill, out.ctx.look.palette.ink);
  assert.equal(arrow.props.stroke, out.ctx.look.palette.paper);
  const ys = [...arrow.props.d.matchAll(/(-?\d+(?:\.\d+)?)[ ,](-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
  near(Math.max(...ys) - Math.min(...ys), 0.05 * out.ctx.canvas.h, 'arrow height', 0.01 * out.ctx.canvas.h);
  assert.ok(Math.min(...ys) >= -1e-9 && Math.min(...ys) < 1e-9, 'the tip is the origin, so the dip does not move the hot spot');
});

test('at each step\'s act the cursor stands on the step\'s pointer, through the image map and the whole camera', () => {
  const data = THREE();
  for (const stops of [[], [{ to: 'step:s1' }]]) {
    const out = expandHand(data, { stops });
    const steps = stops.length === 0 ? [0, 1, 2] : [1];
    for (const i of steps) {
      const act = out.plan.steps[i].act;
      const [x, y] = cursorAt(out, act);
      const [ex, ey] = through(out, data.steps[i].pointer, act);
      near(x, ex, `step ${i} x (${stops.length} stops)`);
      near(y, ey, `step ${i} y (${stops.length} stops)`);
    }
  }
});

test('the cursor follows the camera of the shot\'s devices too (a device layer is one of its layers)', () => {
  const data = THREE();
  const out = expandHand(data, { on: [{ at: 1.5, do: 'punch' }] });
  assert.ok(out.camera.some((layer) => layer.some((k) => k.zoom !== undefined)), 'the punch is a camera layer');
  const act = out.plan.steps[1].act;
  const [x, y] = cursorAt(out, act);
  const [ex, ey] = through(out, data.steps[1].pointer, act);
  near(x, ex, 'x');
  near(y, ey, 'y');
});

test('it is keyed once per film frame while it is on', () => {
  const out = expandHand(THREE());
  const cursor = byId(out, 'w.cursor');
  const from = out.plan.steps[0].start;
  for (const k of [Math.ceil(from * FPS) + 1, 40, 41, 77]) {
    assert.ok(cursor.tracks.x.points.some((p) => Math.abs(p.t - k / FPS) < 1e-9), `frame ${k} has a key`);
  }
});

test('it stays inside the frame at full push on a corner step', () => {
  const data = handTake([30, 30], [[20, 20, 100, 40], [820, 440, 100, 40]]);
  const out = expandHand(data, { steps: [{ id: 's0' }, { id: 's1', at: 5 }], stops: [{ to: 'step:s0' }] });
  const act = out.plan.steps[1].act;
  const [px, py] = through(out, data.steps[1].pointer, act);
  const { w, h } = out.ctx.canvas;
  assert.ok(px < 0 || py < 0 || px > w || py > h, `the camera puts the pointer outside the frame (${px}, ${py})`);
  for (const key of ['x', 'y']) {
    for (const p of byId(out, 'w.cursor').tracks[key].points) assert.ok(p.v >= 0 && p.v <= (key === 'x' ? w : h), `${key} ${p.v} at ${p.t}`);
  }
});

test('it is off until the first step with a pointer: the committed take\'s first step has no box, so no cursor yet', () => {
  const out = expandWalk(walkFilm(), { w: committed() });
  const { opacity } = byId(out, 'w.cursor').tracks;
  assert.equal(sample(opacity, 0), 0);
  assert.equal(sample(opacity, out.plan.steps[0].act), 0);
  assert.equal(sample(opacity, out.plan.steps[1].start - 1e-6), 0, 'still off while step 1 has not started its glide');
  assert.equal(sample(opacity, out.plan.steps[1].act), 1);
  assert.equal(sample(opacity, out.timing.duration), 1, 'and it stays on');
});

test('a step with no box keeps the cursor where it was', () => {
  const data = THREE();
  data.steps[1] = { ...data.steps[1], box: null };
  const out = expandHand(data);
  const [from, to] = [out.plan.steps[1].start, out.plan.steps[1].end];
  for (const t of [from, (from + to) / 2, to]) {
    const [x, y] = cursorAt(out, t);
    const [ex, ey] = through(out, data.steps[0].pointer, t);
    near(x, ex, `x at ${t}`);
    near(y, ey, `y at ${t}`);
  }
});

test('it travels over the GLIDE frames before act on one curve from the previous pointer, and dips to 0.9 at act for 0.12 s', () => {
  const data = THREE();
  data.steps = data.steps.map((s) => ({ ...s, actIndex: s.startIndex + 12 })); // twelve frames before act: a full glide
  const out = expandHand(data);
  const { act } = out.plan.steps[1];
  const glideFrom = act - GLIDE / data.fps;
  const [x0, y0] = cursorAt(out, glideFrom);
  const [ex, ey] = through(out, data.steps[0].pointer, glideFrom);
  near(x0, ex, 'glide starts on the previous pointer (x)');
  near(y0, ey, 'glide starts on the previous pointer (y)');
  const t = glideFrom + (act - glideFrom) / 2;
  const [a, b] = [through(out, data.steps[0].pointer, t), through(out, data.steps[1].pointer, t)];
  const [mx, my] = cursorAt(out, t);
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const away = Math.abs((b[0] - a[0]) * (a[1] - my) - (a[0] - mx) * (b[1] - a[1])) / chord;
  assert.ok(away > 2, `mid-glide the cursor is ${away.toFixed(2)} px off the straight line: a curve`);
  const { scale } = byId(out, 'w.cursor').tracks;
  near(sample(scale, glideFrom), 1, 'full size while gliding');
  near(sample(scale, act), 0.9, 'dip at act');
  near(sample(scale, act + 0.12), 0.9, 'held for 0.12 s');
  near(sample(scale, act + 0.5), 1, 'back to full size');
});

// ---- the ripple ----

test('a click step adds a ripple ring in the look\'s ripple colour,0.5 to 2 times the cursor size over 0.4 s; other steps add none', () => {
  const data = THREE();
  data.steps[1] = { ...data.steps[1], do: 'hover' };
  const out = expandHand(data);
  const ids = all(out.nodes).filter((n) => /^w\.ripple\d+$/.test(n.id)).map((n) => n.id);
  assert.deepEqual(ids, ['w.ripple0', 'w.ripple2'], 'the click steps only');
  const ripple = out.nodes.find((n) => n.id === 'w.ripple2');
  assert.equal(ripple.props.fixed, true);
  assert.equal(byId(out, 'w.ripple2.ring').props.stroke, out.ctx.look.palette[out.ctx.look.kinds.walk.ripple.color]);
  const { act } = out.plan.steps[2];
  near(sample(ripple.tracks.scale, act), 0.5, 'starts at half the cursor size');
  near(sample(ripple.tracks.scale, act + 0.4), 2, 'ends at twice the cursor size');
  assert.equal(sample(ripple.tracks.opacity, act - 0.01), 0, 'not there before the click');
  assert.equal(sample(ripple.tracks.opacity, act + 0.4 + 0.01), 0, 'gone after 0.4 s');
  assert.ok(sample(ripple.tracks.opacity, act + 0.05) > 0);
  const [rx, ry] = [sample(ripple.tracks.x, act), sample(ripple.tracks.y, act)];
  const [cx, cy] = through(out, data.steps[2].pointer, act);
  near(rx, cx, 'ripple x');
  near(ry, cy, 'ripple y');
});

test('the committed take ripples on its two click steps, tab and add, and not on typing or hovering', () => {
  const out = expandWalk(walkFilm(), { w: committed() });
  const ids = all(out.nodes).filter((n) => /^w\.ripple\d+$/.test(n.id)).map((n) => n.id);
  assert.deepEqual(ids, ['w.ripple1', 'w.ripple4']);
});

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
  assert.deepEqual(crop.props.clip.map((v) => Number(v.toFixed(6))), [tab.box.x, tab.box.y, tab.box.width, tab.box.height].map((v) => Number((v * prepared.w.scale).toFixed(6))));
  assert.deepEqual(crop.tracks.frame.points.map((p) => p.v), [tab.settledIndex]);
  const [bx, by, bw, bh] = out.boxes['step:tab'];
  near(crop.props.w, bw, 'drawn as wide as the box', 1e-9);
  near(crop.props.h, bh, 'drawn as high as the box', 1e-9);
  const group = out.nodes.find((n) => n.id === 'w.lift0');
  near(group.props.x, bx + bw / 2, 'centred on the box (x)');
  near(group.props.y, by + bh / 2, 'centred on the box (y)');
  assert.notEqual(group.props.fixed, true, 'it moves with the picture under the camera');
});

test('the lift scales to the look\'s scale over 0.4 s, holds, and returns over 0.4 s to the same box', () => {
  const out = expandWalk(walkFilm(LIFT_SHOT()), { w: committed() });
  const { scale, hold } = out.ctx.look.kinds.walk.lift;
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
  near(sample(group.tracks.scale, out.plan.steps[1].end + LIFT_LEAD + 0.4), scale, 'the card still scales to the look\'s scale');
  const room = expandWalk(walkFilm(shot, { look: 'keynote' }), { w: { ...committed(), width: 5760, height: 3240, scale: 6 } });
  const roomy = room.data.width / room.boxes.image[2];
  near(drawnScale(room), room.ctx.look.kinds.walk.lift.scale * layeredCamera(room.camera, 'test')(room.plan.steps[1].end + LIFT_LEAD + 0.4).zoom, 'with room above the push the look\'s scale holds');
  assert.ok(drawnScale(room) <= roomy + 1e-6);
});

test('at whole view the lift keeps the look\'s scale', () => {
  const out = expandWalk(walkFilm(LIFT_SHOT()), { w: committed() });
  const group = out.nodes.find((n) => n.id === 'w.lift0');
  const peak = out.plan.steps[1].end + LIFT_LEAD + 0.4;
  near(sample(group.tracks.scale, peak), out.ctx.look.kinds.walk.lift.scale, 'scale at the peak');
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
