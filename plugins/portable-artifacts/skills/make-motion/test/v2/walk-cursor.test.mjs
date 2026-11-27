// The walk cursor (gate round 1): its drawn arrow is 5% of the canvas height, measured on the path's own bounds (not a box
// round it), and it has a soft shadow so it reads on white. Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { all } from './helpers/kinds.mjs';
import { committed, expandWalk, walkFilm, walkShot } from './helpers/walk.mjs';

const boundsOf = (d) => {
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const [xs, ys] = [nums.filter((_, i) => i % 2 === 0), nums.filter((_, i) => i % 2 === 1)];
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), top: Math.min(...ys), left: Math.min(...xs) };
};

test('the drawn arrow is 5% of the canvas height on its own path bounds, tip at the origin', () => {
  for (const look of ['keynote', 'desk']) {
    const out = expandWalk(walkFilm(walkShot(), { look }), { w: committed() });
    const arrow = all(out.nodes).find((n) => n.id === 'w.cursor.arrow');
    const { h, top, left } = boundsOf(arrow.props.d);
    assert.ok(Math.abs(h - 0.05 * out.ctx.canvas.h) < 0.02, `${look}: ${h} vs ${0.05 * out.ctx.canvas.h}`);
    assert.ok(Math.abs(top) < 1e-9 && Math.abs(left) < 1e-9, `${look}: the tip is the origin`);
  }
});

test('the cursor never draws smaller than 4% of the canvas height (the pull-back keeps it): its size is constant and its dip stays above 0.9', () => {
  for (const look of ['keynote', 'desk']) {
    const out = expandWalk(walkFilm(walkShot({ stops: [{ to: 'step:tab' }, { to: 'whole' }] }), { look }), { w: committed() });
    const cursor = out.nodes.find((n) => n.id === 'w.cursor');
    const arrow = all(out.nodes).find((n) => n.id === 'w.cursor.arrow');
    const least = Math.min(...cursor.tracks.scale.points.map((p) => p.v));
    assert.ok(boundsOf(arrow.props.d).h * least >= 0.04 * out.ctx.canvas.h, `${look}: ${boundsOf(arrow.props.d).h * least} px`);
    assert.equal(cursor.props.fixed, true, `${look}: fixed to the frame, so the camera does not shrink it`);
  }
});

test('the click ripple reads on white UI and on the blue button: the look\'s ripple data (ink, thick) over a paper keyline, never the accent', () => {
  for (const look of ['keynote', 'desk']) {
    const out = expandWalk(walkFilm(walkShot(), { look }), { w: committed() });
    const { palette, kinds } = out.ctx.look;
    const size = 0.05 * out.ctx.canvas.h;
    const ids = all(out.nodes).filter((n) => /^w\.ripple\d+$/.test(n.id)).map((n) => n.id);
    assert.ok(ids.length >= 2, `${look}: ripples on the click steps`);
    for (const id of ids) {
      const ring = all(out.nodes).find((n) => n.id === `${id}.ring`);
      const keyline = all(out.nodes).find((n) => n.id === `${id}.keyline`);
      assert.equal(ring.props.stroke, palette[kinds.walk.ripple.color], `${look} ${id}: the look's ripple colour`);
      assert.notEqual(ring.props.stroke, palette.accent, `${look} ${id}: not the accent (the button is that colour)`);
      assert.ok(ring.props.strokeWidth >= 0.12 * size, `${look} ${id}: thick, ${ring.props.strokeWidth}`);
      assert.equal(keyline.props.stroke, palette.paper, `${look} ${id}: a paper keyline`);
      assert.ok(keyline.props.strokeWidth > ring.props.strokeWidth, `${look} ${id}: wider than the ring`);
    }
  }
});

test('the arrow has a soft shadow: ink at low alpha, offset down and right, drawn under it, in both looks', () => {
  for (const look of ['keynote', 'desk']) {
    const out = expandWalk(walkFilm(walkShot(), { look }), { w: committed() });
    const cursor = out.nodes.find((n) => n.id === 'w.cursor');
    const shadows = cursor.children.filter((n) => /^w\.cursor\.shadow\d+$/.test(n.id));
    assert.ok(shadows.length >= 2, `${look}: stacked soft layers`);
    assert.equal(cursor.children.at(-1).id, 'w.cursor.arrow', `${look}: the arrow on top`);
    const size = 0.05 * out.ctx.canvas.h;
    for (const s of shadows) {
      assert.equal(s.props.fill, out.ctx.look.palette.ink);
      assert.ok(s.props.opacity > 0 && s.props.opacity <= 0.2, `${look}: low alpha ${s.props.opacity}`);
      assert.ok(s.props.x > 0 && s.props.y > 0 && s.props.y <= size / 4, `${look}: offset down and right`);
      assert.ok(s.props.strokeWidth > 0, `${look}: wider than the arrow, so its edge is soft`);
    }
  }
});
