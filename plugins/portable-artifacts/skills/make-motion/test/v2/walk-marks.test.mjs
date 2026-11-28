// Marks on a walk step (`on` with target `step:<id>`, gate round 1): the mark clears when the next played step starts, or after
// MARK_SECONDS if that is sooner, is not drawn over a lift, and reads as an overlay in each look (look data: kinds.walk.mark).
// A mark aimed at `screen` is untouched. Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sample } from '../../engine/time/track.mjs';
import { MARK_SECONDS } from '../../engine/kinds/walk-marks.mjs';
import { all } from './helpers/kinds.mjs';
import { committed, expandWalk, handShot, handTake, walkFilm, walkShot } from './helpers/walk.mjs';

const near = (actual, wanted, label, tolerance = 1e-6) => assert.ok(Math.abs(actual - wanted) < tolerance, `${label}: ${actual} is not ${wanted}`);
const byId = (out, id) => all(out.nodes).find((n) => n.id === id);
const THREE = () => handTake([30, 30, 30], [[40, 40, 120, 60], [400, 200, 120, 60], [760, 420, 120, 60]]);
const MARK = (extra = {}) => ({ at: 2, do: 'circle', target: 'step:s1', ...extra });

// the group a mark is drawn in and the second it is gone by (the last second its opacity is above 0)
function clearOf(out, id = 'w.on0.clear') {
  const group = byId(out, id);
  assert.ok(group, `${id} wraps the mark`);
  const { points } = group.tracks.opacity;
  return { group, from: points.find((p) => p.v === 1).t, gone: points.find((p) => p.v === 0 && p.t > 0).t, last: points.findLast((p) => p.v === 1).t };
}

test('the mark clears when the next played step starts, if that is sooner than MARK_SECONDS', () => {
  const data = THREE();
  const out = expandWalk(walkFilm(handShot(data, { on: [MARK()] })), { w: data });
  assert.equal(MARK_SECONDS, 2);
  const { gone, last } = clearOf(out);
  near(out.plan.steps[2].start, 3, 'the next step starts at 3');
  near(gone, 3, 'gone by the next step\'s start');
  assert.ok(last < gone && last > 2, 'and up before that');
  assert.equal(sample(byId(out, 'w.on0.clear').tracks.opacity, 3.01), 0);
  assert.equal(sample(byId(out, 'w.on0.clear').tracks.opacity, 1.6), 1);
});

test('the mark clears after MARK_SECONDS when the next step starts later', () => {
  const data = THREE();
  const out = expandWalk(walkFilm(handShot(data, { steps: [{ id: 's0' }, { id: 's1' }, { id: 's2', at: 9 }], on: [MARK()] })), { w: data });
  const landed = Math.max(2, out.plan.steps[1].act + out.ctx.look.moves.draw.dur); // not before the step acts
  near(clearOf(out).gone, landed + MARK_SECONDS, '2.0 s after it is drawn');
});

test('a mark aimed after the next step has started is gone as it lands, never a track out of order', () => {
  const data = THREE();
  const out = expandWalk(walkFilm(handShot(data, { on: [MARK({ at: 3.5 })] })), { w: data });
  near(clearOf(out).gone, 3.5, 'cleared on its own second');
});

test('a mark on the last step clears after MARK_SECONDS', () => {
  const data = THREE();
  const out = expandWalk(walkFilm(handShot(data, { on: [MARK({ at: 4, target: 'step:s2' })] })), { w: data });
  near(clearOf(out).gone, 4 + MARK_SECONDS, 'no next step');
});

test('the mark is not drawn over a lift: it clears when a lift starts', () => {
  const data = THREE();
  const out = expandWalk(walkFilm(handShot(data, { steps: [{ id: 's0' }, { id: 's1' }, { id: 's2', at: 9 }], lift: [{ step: 's1', at: 2.6 }], on: [MARK()] })), { w: data });
  near(clearOf(out).gone, 2.6, 'gone as the lift starts');
});

test('a mark aimed at the screen is the device as built, never cleared by the walk', () => {
  const data = THREE();
  const out = expandWalk(walkFilm(handShot(data, { on: [{ at: 1, do: 'circle', target: 'screen' }] })), { w: data });
  assert.equal(byId(out, 'w.on0.clear'), undefined);
  assert.ok(out.nodes.some((n) => n.id.startsWith('w.on0')));
});

const numbersOf = (d) => d.match(/-?\d+(?:\.\d+)?/g).map(Number);

// the box [x, y, w, h] the circle device is given round `box` so its ellipse has radii of half the box times `factor`, at least
// `clear` units past each side, about the box's centre. 1.25 is the circle device's own size round a box (desk gate round 1
// passed it); 1.45 ran a ring on a wide field out of the window and over the button beside it (round 3 render).
const ELLIPSE_FACTOR = 1.25;
const CLEAR = 8;

test('both looks: the mark on a step is an ink ellipse about the box centre that clears the box by at least 8 units on every side (drawn by the circle device, no rounded rectangle)', () => {
  for (const look of ['keynote', 'desk']) {
    const out = expandWalk(walkFilm(walkShot({ on: [{ at: 'sentence:3', do: 'circle', target: 'step:search' }] }), { look }), { w: committed() });
    const { mark } = out.ctx.look.kinds.walk;
    assert.deepEqual(mark.ellipse, { factor: ELLIPSE_FACTOR, clear: CLEAR }, `${look}: the look names the ellipse`);
    assert.equal(mark.rounded, undefined, `${look}: no rounded rectangle`);
    const path = byId(out, 'w.on0');
    assert.equal(path.props.stroke, out.ctx.look.palette.ink, `${look}: in ink`);
    assert.ok(!/Q/.test(path.props.d), `${look}: not a rounded rectangle`);
    const box = out.boxes['step:search'];
    const { unit } = out.ctx;
    const nums = numbersOf(path.props.d);
    const [xs, ys] = [nums.filter((_, i) => i % 2 === 0), nums.filter((_, i) => i % 2 === 1)];
    const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const [cx, cy] = [box[0] + box[2] / 2, box[1] + box[3] / 2];
    near((left + right) / 2, cx, `${look}: centred across on the box`, 6 * unit);
    near((top + bottom) / 2, cy, `${look}: centred down on the box (it sat low)`, 6 * unit);
    const slack = 5 * unit; // the hand circle's own wobble and its overlapping end
    assert.ok(left <= box[0] - CLEAR * unit + slack && right >= box[0] + box[2] + CLEAR * unit - slack, `${look}: clears the box's sides (${left.toFixed(1)}..${right.toFixed(1)} against ${box[0]}..${box[0] + box[2]})`);
    assert.ok(top <= box[1] - CLEAR * unit + slack && bottom >= box[1] + box[3] + CLEAR * unit - slack, `${look}: clears the box's top and bottom (${top.toFixed(1)}..${bottom.toFixed(1)} against ${box[1]}..${box[1] + box[3]})`);
    assert.ok(path.tracks.draw.points.at(-1).v === 1 && path.tracks.draw.points[0].v === 0, `${look}: drawn on`);
  }
});

test('keynote: the ellipse is exact: radii of the half box times the factor (at least the 8 unit clearance), drawn on over the look\'s draw move', () => {
  const out = expandWalk(walkFilm(walkShot({ on: [{ at: 'sentence:3', do: 'circle', target: 'step:search' }] })), { w: committed() });
  const box = out.boxes['step:search'];
  const { unit } = out.ctx;
  const [rx, ry] = [Math.max((box[2] / 2) * ELLIPSE_FACTOR, box[2] / 2 + CLEAR * unit), Math.max((box[3] / 2) * ELLIPSE_FACTOR, box[3] / 2 + CLEAR * unit)];
  const nums = numbersOf(byId(out, 'w.on0').props.d);
  const [xs, ys] = [nums.filter((_, i) => i % 2 === 0), nums.filter((_, i) => i % 2 === 1)];
  near(Math.max(...xs) - Math.min(...xs), 2 * rx, 'width', 0.05);
  near(Math.max(...ys) - Math.min(...ys), 2 * ry, 'height', 0.05);
  near((Math.max(...xs) + Math.min(...xs)) / 2, box[0] + box[2] / 2, 'centre x', 0.05);
  near((Math.max(...ys) + Math.min(...ys)) / 2, box[1] + box[3] / 2, 'centre y', 0.05);
  const drawn = byId(out, 'w.on0').tracks.draw.points;
  near(drawn.at(-1).t - drawn[0].t, out.ctx.look.moves.draw.dur, 'the look\'s draw move', 1e-9);
});

test('a mark aimed before the step acts still starts its draw-on on the act', () => {
  const out = expandWalk(walkFilm(walkShot({ on: [{ at: 0.2, do: 'circle', target: 'step:search' }] })), { w: committed() });
  const drawn = byId(out, 'w.on0').tracks.draw.points;
  near(drawn[0].t, out.plan.steps[2].act, 'starts on the act', 1e-6);
  near(drawn.at(-1).t, out.plan.steps[2].act + out.ctx.look.moves.draw.dur, 'and lands one draw move on', 1e-6);
});

test('a mark on a step never starts to draw before the step\'s act, in both looks', () => {
  for (const look of ['keynote', 'desk']) {
    const out = expandWalk(walkFilm(walkShot({ on: [{ at: 0.2, do: 'circle', target: 'step:search' }] }), { look }), { w: committed() });
    const act = out.plan.steps[2].act;
    const drawn = byId(out, 'w.on0').tracks.draw.points;
    assert.ok(drawn[0].t >= act - 1e-6, `${look}: first drawn at ${drawn[0].t}, the step acts at ${act}`);
    assert.ok(drawn.at(-1).t >= act + 0.3, `${look}: and it lands after it`);
  }
});

test('a mark aimed after the step\'s act is drawn where it is aimed', () => {
  const out = expandWalk(walkFilm(walkShot({ on: [{ at: 'sentence:4', do: 'circle', target: 'step:search' }] })), { w: committed() });
  assert.ok(out.ctx.at('sentence:4') > out.plan.steps[2].act + 1, 'the sentence is well after the act');
  near(byId(out, 'w.on0').tracks.draw.points.at(-1).t, out.ctx.at('sentence:4'), 'lands on its second');
});
