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
const MARK = (extra = {}) => ({ at: 1.5, do: 'circle', target: 'step:s1', ...extra });

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
  assert.ok(last < gone && last > 1.5, 'and up before that');
  assert.equal(sample(byId(out, 'w.on0.clear').tracks.opacity, 3.01), 0);
  assert.equal(sample(byId(out, 'w.on0.clear').tracks.opacity, 1.6), 1);
});

test('the mark clears after MARK_SECONDS when the next step starts later', () => {
  const data = THREE();
  const out = expandWalk(walkFilm(handShot(data, { steps: [{ id: 's0' }, { id: 's1' }, { id: 's2', at: 9 }], on: [MARK()] })), { w: data });
  near(clearOf(out).gone, 1.5 + MARK_SECONDS, '2.0 s after it is drawn');
});

test('a mark aimed after the next step has started is gone as it lands, never a track out of order', () => {
  const data = THREE();
  const out = expandWalk(walkFilm(handShot(data, { on: [MARK({ at: 3.5 })] })), { w: data });
  near(clearOf(out).gone, 3.5, 'cleared on its own second');
});

test('a mark on the last step clears after MARK_SECONDS', () => {
  const data = THREE();
  const out = expandWalk(walkFilm(handShot(data, { on: [MARK({ at: 3, target: 'step:s2' })] })), { w: data });
  near(clearOf(out).gone, 3 + MARK_SECONDS, 'no next step');
});

test('the mark is not drawn over a lift: it clears when a lift starts', () => {
  const data = THREE();
  const out = expandWalk(walkFilm(handShot(data, { steps: [{ id: 's0' }, { id: 's1' }, { id: 's2', at: 9 }], lift: [{ step: 's1', at: 2.2 }], on: [MARK()] })), { w: data });
  near(clearOf(out).gone, 2.2, 'gone as the lift starts');
});

test('a mark aimed at the screen is the device as built, never cleared by the walk', () => {
  const data = THREE();
  const out = expandWalk(walkFilm(handShot(data, { on: [{ at: 1, do: 'circle', target: 'screen' }] })), { w: data });
  assert.equal(byId(out, 'w.on0.clear'), undefined);
  assert.ok(out.nodes.some((n) => n.id.startsWith('w.on0')));
});

test('keynote: the ring is the look\'s accent at full weight with a glow stroke under it, wider than the ring and not the page\'s outline', () => {
  const out = expandWalk(walkFilm(walkShot({ on: [{ at: 'sentence:3', do: 'circle', target: 'step:search' }] })), { w: committed() });
  const { mark } = out.ctx.look.kinds.walk;
  const rings = all(out.nodes).filter((n) => /^w\.on0\.[ab]$/.test(n.id));
  const glows = all(out.nodes).filter((n) => /^w\.on0\.[ab]\.glow$/.test(n.id));
  assert.equal(rings.length, 2);
  assert.equal(glows.length, 2);
  for (const ring of rings) {
    assert.equal(ring.props.stroke, out.ctx.look.palette[mark.circle.color]);
    near(ring.props.strokeWidth, mark.circle.width * out.ctx.unit, 'ring width');
  }
  for (const glow of glows) {
    assert.equal(glow.props.stroke, out.ctx.look.palette[mark.circle.color]);
    near(glow.props.strokeWidth, mark.circle.width * mark.glow.widen * out.ctx.unit, 'glow width');
    assert.equal(glow.props.opacity, mark.glow.alpha);
  }
  const group = byId(out, 'w.on0.clear');
  assert.ok(group.children.indexOf(glows[0]) < group.children.indexOf(rings[0]), 'the glow is drawn under the ring');
  const box = out.boxes['step:search'];
  const ring = rings[0].props.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.ok(Math.min(...ring.filter((_, i) => i % 2 === 0)) <= box[0] - mark.circle.pad * out.ctx.unit + 0.01, 'outside the field it is drawn on, by the look\'s pad');
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
