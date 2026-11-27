// The walk camera waits (gate round 1): no stop's move starts until the shot has held the whole picture for ESTABLISH seconds
// after its incoming cut ends. The steps still play on their sentences; only the camera waits. Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ESTABLISH } from '../../engine/kinds/walk-camera.mjs';
import { walkSetup } from '../../engine/kinds/walk-layout.mjs';
import { expandWalk, handShot, handTake, walkFilm } from './helpers/walk.mjs';

const near = (actual, wanted, label) => assert.ok(Math.abs(actual - wanted) < 1e-9, `${label}: ${actual} is not ${wanted}`);
const THREE = () => handTake([30, 30, 30], [[40, 40, 120, 60], [400, 200, 120, 60], [760, 420, 120, 60]]);

// the shot's setup as the `index`th shot of a film (the helpers expand shot 0, so the index is set on the timing)
function setupAt(shot, data, index, look = 'keynote') {
  const out = expandWalk(walkFilm(shot, { look }), { w: data });
  return walkSetup(shot, { ...out.ctx, timing: { ...out.ctx.timing, index } });
}

test('the whole picture is held ESTABLISH seconds: 2.0', () => {
  assert.equal(ESTABLISH, 2);
});

test('a stop wished before that moves later: its move starts at 2.0 s and lands 0.8 s on', () => {
  const data = THREE();
  for (const look of ['keynote', 'desk']) {
    const { planned, plan } = setupAt(handShot(data, { stops: [{ to: 'step:s1' }] }), data, 0, look);
    near(plan.steps[1].start, 1.5, `${look}: the step still plays at 1.5`);
    const [stop] = planned.stops;
    near(stop.start, ESTABLISH, `${look}: start`);
    near(stop.land, ESTABLISH + 0.8, `${look}: land`);
    assert.ok(planned.layer.filter((k) => k.t > 0).every((k) => k.t >= ESTABLISH - 1e-9), `${look}: no key of the camera moves before 2.0 s`);
  }
});

test('the 2.0 s count from the end of the incoming cut', () => {
  const data = THREE();
  const { planned } = setupAt(handShot(data, { cut: { type: 'slide', direction: 'left' }, stops: [{ to: 'step:s1' }] }), data, 1);
  near(planned.stops[0].start, 0.4 + ESTABLISH, 'a slide of 0.4 s, then 2.0 s of the whole picture');
});

test('a stop already later than that keeps its own second, and steps keep theirs', () => {
  const data = THREE();
  const shot = handShot(data, { stops: [{ to: 'step:s2' }] });
  const { planned, plan } = setupAt(shot, data, 0);
  near(plan.steps[2].start, 3, 'step 2 plays at 3');
  near(planned.stops[0].land, 3, 'the stop lands on it');
  near(planned.stops[0].start, 3 - 0.8, 'moving from 2.2');
});

test('a whole stop first, with no at, is still the shot start; the next stop waits as any does', () => {
  const data = THREE();
  const { planned } = setupAt(handShot(data, { stops: [{ to: 'whole' }, { to: 'step:s1' }] }), data, 0);
  assert.equal(planned.stops[0].noRoom, true);
  near(planned.stops[1].start, ESTABLISH, 'the step stop starts at 2.0');
});
