// How a walk shot ends (gate round 1): after the last step's click the camera stays on that step's stop until its result has
// held RESULT_HOLD, then goes to the whole picture, and the shot holds the whole picture WHOLE_HOLD before it ends (the
// walk's minimum seconds count all of it, so the shot stretches). Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { layeredCamera } from '../../engine/graph/camera.mjs';
import { MOVE_SECONDS, RESULT_HOLD, WHOLE_HOLD, HOLD_MIN, walkPlan, walkMinSeconds, wholeLanding } from '../../engine/kinds/walk-time.mjs';
import { committed, expandWalk, handShot, handTake, walkFilm, walkShot } from './helpers/walk.mjs';

const near = (actual, wanted, label) => assert.ok(Math.abs(actual - wanted) < 1e-9, `${label}: ${actual} is not ${wanted}`);
const THREE = () => handTake([30, 30, 30], [[40, 40, 120, 60], [400, 200, 120, 60], [760, 420, 120, 60]]);
const STOPS = [{ to: 'step:s0' }, { to: 'step:s2' }, { to: 'whole' }];

test('the closing constants: the result holds 1.0 s, a move takes 0.8 s, the whole picture holds 1.5 s', () => {
  assert.deepEqual([RESULT_HOLD, MOVE_SECONDS, WHOLE_HOLD], [1, 0.8, 1.5]);
});

test('a whole stop lands RESULT_HOLD after its step ends, then the move: wholeLanding', () => {
  near(wholeLanding({ end: 10, until: 10 + HOLD_MIN }), 10 + RESULT_HOLD + MOVE_SECONDS, 'a plain step');
  near(wholeLanding({ end: 10, until: 12.9 }), 12.9 - 0.4 + MOVE_SECONDS, 'a lifted step: the camera leaves as the lift returns');
});

test('the plan\'s end counts the whole stop and the whole picture\'s hold', () => {
  const data = THREE();
  const shot = handShot(data, { stops: STOPS });
  const timing = { words: [], sentences: [], duration: 3 };
  const plan = walkPlan(shot, timing, data);
  const last = plan.steps[2];
  near(plan.end, last.end + RESULT_HOLD + MOVE_SECONDS + WHOLE_HOLD, 'end');
  assert.ok(plan.end > last.until);
  near(walkMinSeconds(shot, { sentences: [], words: [], seconds: 3, prepared: data }), plan.end, 'walkMinSeconds');
});

test('a whole stop with an `at` holds the whole picture from there; no closing whole stop leaves the end as it was', () => {
  const data = THREE();
  const timing = { words: [], sentences: [], duration: 3 };
  const later = walkPlan(handShot(data, { stops: [{ to: 'step:s2' }, { to: 'whole', at: 9 }] }), timing, data);
  near(later.end, 9 + WHOLE_HOLD, 'at + hold');
  const plain = walkPlan(handShot(data), timing, data);
  const stepOnly = walkPlan(handShot(data, { stops: [{ to: 'step:s2' }] }), timing, data);
  near(stepOnly.end, plain.end, 'a last step stop adds nothing');
  const first = walkPlan(handShot(data, { stops: [{ to: 'whole' }] }), timing, data);
  near(first.end, plain.end, 'a first whole stop is the shot start');
});

test('the camera stays on the last step\'s stop until its result has held, then goes whole, and holds whole before the shot ends', () => {
  const data = THREE();
  for (const look of ['keynote', 'desk']) {
    const out = expandWalk(walkFilm(handShot(data, { stops: STOPS }), { look }), { w: data });
    const last = out.plan.steps[2];
    const cam = layeredCamera(out.camera, 'test');
    const atStop = cam(last.start);
    for (const t of [last.act, last.end, last.end + 0.5, last.end + RESULT_HOLD - 0.01]) {
      assert.ok(Math.abs(cam(t).zoom - atStop.zoom) < 1e-9 && Math.abs(cam(t).x - atStop.x) < 25, `${look}: still on the stop at ${t.toFixed(2)}`);
    }
    assert.ok(atStop.zoom > 1.5, `${look}: the add stop is a close framing`);
    const whole = last.end + RESULT_HOLD + MOVE_SECONDS;
    assert.ok(cam(whole).zoom < 1 + 1e-9, `${look}: whole at ${whole.toFixed(2)}`);
    assert.ok(out.timing.duration >= whole + WHOLE_HOLD - 1e-9, `${look}: the shot is ${out.timing.duration}, the whole view needs until ${(whole + WHOLE_HOLD).toFixed(2)}`);
    assert.ok(cam(out.timing.duration - WHOLE_HOLD).zoom < 1 + 1e-9, `${look}: whole for the last ${WHOLE_HOLD} s`);
  }
});

test('on the committed take the add stop frames the add click: the camera is on it at the click and for the result\'s hold', () => {
  const out = expandWalk(walkFilm(walkShot({ stops: [{ to: 'step:tab' }, { to: 'step:hover' }, { to: 'step:add' }, { to: 'whole' }], lift: [{ step: 'hover' }] })), { w: committed() });
  const add = out.plan.steps[4];
  const cam = layeredCamera(out.camera, 'test');
  assert.ok(cam(add.act).zoom > 1.5, `zoomed at the click: ${cam(add.act).zoom}`);
  assert.ok(cam(add.end + RESULT_HOLD - 0.05).zoom > 1.5, 'and while its result holds');
});
