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
