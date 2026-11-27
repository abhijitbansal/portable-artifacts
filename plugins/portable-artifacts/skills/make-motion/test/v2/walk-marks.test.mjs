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

test('keynote: the mark on a step is a rounded rectangle of the look\'s radius and a moderate stroke, drawn outside the box by a small gap, with a glow under it', () => {
  const out = expandWalk(walkFilm(walkShot({ on: [{ at: 'sentence:3', do: 'circle', target: 'step:search' }] })), { w: committed() });
  const { mark } = out.ctx.look.kinds.walk;
  const { unit } = out.ctx;
  const ring = byId(out, 'w.on0');
  const glow = byId(out, 'w.on0.glow');
  assert.equal(ring.props.stroke, out.ctx.look.palette[mark.rounded.color]);
  near(ring.props.strokeWidth, mark.rounded.width * unit, 'stroke');
  assert.ok(ring.props.strokeWidth <= 5 * unit, 'moderate: not the heavy 6 of round 2');
  assert.ok(/Q/.test(ring.props.d), 'rounded corners');
  const box = out.boxes['step:search'];
  const gap = mark.rounded.gap * unit, round = (mark.rounded.radius + mark.rounded.gap) * unit;
  const [x0, y0, ...rest] = numbersOf(ring.props.d);
  near(x0, box[0] - gap + round, 'the top edge starts a corner radius in', 0.01);
  near(y0, box[1] - gap, 'above the box by the gap', 0.01);
  assert.ok(Math.min(...numbersOf(ring.props.d).filter((_, i) => i % 2 === 0)) >= box[0] - gap - 0.01, 'no further out than the gap');
  assert.ok(rest.length > 0);
  assert.ok(gap >= ring.props.strokeWidth, 'clear of the app\'s own focus border: the stroke sits outside the box');
  near(glow.props.strokeWidth, mark.rounded.width * mark.glow.widen * unit, 'glow width');
  assert.equal(glow.props.opacity, mark.glow.alpha);
  assert.ok(glow.props.strokeWidth / 2 <= gap + ring.props.strokeWidth / 2, 'the glow does not reach the box either');
  const group = byId(out, 'w.on0.clear');
  assert.ok(group.children.indexOf(glow) < group.children.indexOf(ring), 'the glow is drawn under the ring');
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

test('desk: the circle is in ink (the film\'s one accent is the highlighter), fitted inside the box it is aimed at', () => {
  const out = expandWalk(walkFilm(walkShot({ on: [{ at: 'sentence:3', do: 'circle', target: 'step:search' }] }), { look: 'desk' }), { w: committed() });
  const { mark } = out.ctx.look.kinds.walk;
  const path = all(out.nodes).find((n) => n.id === 'w.on0');
  assert.equal(path.props.stroke, out.ctx.look.palette.ink);
  const box = out.boxes['step:search'];
  const xs = path.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number).filter((_, i) => i % 2 === 0);
  const reach = ((box[2] * mark.fit) * 1.25) / 2; // the hand circle is 1.25 of its box, about the box's centre
  assert.ok(Math.max(...xs) < box[0] + box[2] / 2 + reach + 30, 'it does not run on past the field into the neighbouring button');
  assert.ok(Math.max(...xs) < box[0] + box[2] + 0.05 * box[2], `right end ${Math.max(...xs)} vs field end ${box[0] + box[2]}`);
});
