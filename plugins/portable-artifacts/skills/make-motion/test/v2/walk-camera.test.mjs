// The walk kind's camera stops (engine/kinds/walk-camera.mjs) as the kind expands them, on hand-made takes of plain runs of frames:
// where a step stop lands and starts, a whole stop, a move that waits for a step's hold, a stop that cannot land. Pure. (Split out of
// walk-kind.test.mjs; the pose, establishing, closing and lift rules have their own walk-*.test.mjs files.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { RESULT_HOLD } from '../../engine/kinds/walk-time.mjs';
import { expandWalk, handShot, handTake, walkFilm } from './helpers/walk.mjs';

const near = (actual, wanted, label) => assert.ok(Math.abs(actual - wanted) < 1e-9, `${label}: ${actual} is not ${wanted}`);
const filmOfWalk = (data, extra = {}) => walkFilm(handShot(data, extra));

// ---- camera stops ----

const stopsOf = (shot, data) => {
  const out = expandWalk(walkFilm(shot), { w: data });
  return { out, layer: out.camera.at(-1), plan: out.plan };
};
// three steps of one second each, no say: they start at 0, 1.5 and 3 (each holds HOLD_MIN after its last frame)
const THREE = () => handTake([30, 30, 30], [[40, 40, 120, 60], [400, 200, 120, 60], [760, 420, 120, 60]]);
// the same steps on seconds 0, 4 and 8: a stop on them is later than the 2.0 s the whole picture is held first
const FAR = (data, extra) => handShot(data, { steps: [{ id: 's0' }, { id: 's1', at: 4 }, { id: 's2', at: 8 }], ...extra });
const keyAt = (layer, t) => layer.find((k) => Math.abs(k.t - t) < 1e-9 && k.zoom !== undefined);

test('no stops: the camera is the look\'s own', () => {
  const data = THREE();
  const out = expandWalk(filmOfWalk(data), { w: data });
  assert.equal(out.camera.length, 1, 'the keynote drift alone');
});

test('a step stop lands on its step\'s start, in 0.8 s, on the in-out cubic ease, to the context the box gets', () => {
  const data = THREE();
  const { layer, plan, out } = stopsOf(FAR(data, { stops: [{ to: 'step:s1' }] }), data);
  near(plan.steps[1].start, 4, 'step 1 starts');
  const landing = keyAt(layer, 4);
  assert.ok(landing, JSON.stringify(layer));
  assert.equal(landing.ease, 'inOutCubic');
  assert.ok(landing.zoom > 1);
  const before = layer.filter((k) => k.t < 4).at(-1);
  near(before.t, 3.2, 'the move starts 0.8 s before');
  assert.deepEqual([before.x, before.y, before.zoom], [0, 0, 1]);
  assert.ok(layer.every((k, i) => i === 0 || layer[i - 1].t <= k.t), 'keys in time order');
  assert.ok(out.camera.length === 2);
});

test('a stop with an `at` lands there instead', () => {
  const data = THREE();
  const { layer } = stopsOf(FAR(data, { stops: [{ to: 'step:s2', at: 5.6 }] }), data);
  assert.ok(keyAt(layer, 5.6), JSON.stringify(layer));
});

test('a whole stop with no at lands RESULT_HOLD and a move after the previous stop\'s step ends; a first whole stop is the shot start', () => {
  const data = THREE();
  const { layer, plan } = stopsOf(FAR(data, { stops: [{ to: 'step:s1' }, { to: 'whole' }] }), data);
  const landing = keyAt(layer, plan.steps[1].end + RESULT_HOLD + 0.8);
  assert.ok(landing, JSON.stringify(layer));
  assert.deepEqual([landing.x, landing.y, landing.zoom], [0, 0, 1]);
  const first = stopsOf(FAR(data, { stops: [{ to: 'whole' }, { to: 'step:s1' }] }), data);
  assert.ok(keyAt(first.layer, first.plan.steps[1].start), 'a first whole stop takes no move, so the next lands on its step');
  assert.ok(first.layer.every((k) => k.zoom === undefined || k.t === 0 || k.t >= 2 - 1e-9));
});

test('a move never starts inside a step\'s hold: it starts when the hold ends, and lands 0.8 s later', () => {
  const data = THREE();
  // step 0 ends at 4.0 and holds until 4.5; a landing at 4.9 would start at 4.1, inside the hold
  const { layer, plan } = stopsOf(handShot(data, { steps: [{ id: 's0', at: 3 }, { id: 's1', at: 6 }, { id: 's2', at: 9 }], stops: [{ to: 'step:s2', at: 4.9 }] }), data);
  near(plan.steps[0].end, 4, 'step 0 ends');
  const landing = layer.find((k) => k.ease === 'inOutCubic');
  near(landing.t, 4.5 + 0.8, 'lands 0.8 s after the hold ends');
  assert.ok(layer.some((k) => Math.abs(k.t - 4.5) < 1e-9 && k.zoom === 1), 'and starts at 4.5');
});

test('a stop that cannot land before the next one starts moving is dropped', () => {
  const data = THREE();
  const { layer, out } = stopsOf(FAR(data, { stops: [{ to: 'step:s1', at: 5 }, { to: 'step:s2', at: 5.1 }] }), data);
  const moves = layer.filter((k) => k.ease === 'inOutCubic');
  assert.equal(moves.length, 1, 'only the second stop has a move');
  near(moves[0].t, 5.1, 'the second stop lands on its at');
  assert.ok(out.camera.length === 2);
});

