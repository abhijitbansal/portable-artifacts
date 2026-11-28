// What the walk kind draws over its picture: the cursor (on from the first frame, at rest, travelling at least 0.6 s to a click)
// and its click ripple. The lift and the `on` devices aimed at a step are in walk-lift-overlay.test.mjs. Pure: the take is the
// committed fixture, or a hand-made one of plain runs of frames (test/v2/helpers/walk.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { layeredCamera, pointThroughCamera } from '../../engine/graph/camera.mjs';
import { sample } from '../../engine/time/track.mjs';
import { GLIDE, LIFT_MOVES } from '../../engine/kinds/walk-time.mjs';
import { walkSetup } from '../../engine/kinds/walk-layout.mjs';
import { REST, TRAVEL_MIN } from '../../engine/kinds/walk-cursor.mjs';
import { all } from './helpers/kinds.mjs';
import { gateTour } from './helpers/walk-gate.mjs';
import { committed, expandWalk, handShot, handTake, walkFilm } from './helpers/walk.mjs';

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

test('it is drawn from the shot\'s first frame: at rest on the REST point of the page until it travels to the first pointer', () => {
  const out = expandWalk(walkFilm(), { w: committed() });
  const cursor = byId(out, 'w.cursor');
  const opacityAt = (t) => (cursor.tracks.opacity === undefined ? 1 : sample(cursor.tracks.opacity, t)); // no track: always on
  assert.equal(opacityAt(0), 1, 'on at second 0');
  assert.equal(opacityAt(out.plan.steps[0].act), 1, 'and during the first step, which has no pointer');
  assert.equal(REST.x, 0.62);
  assert.equal(REST.y, 0.7);
  const { width, height } = out.data.viewport;
  const [rx, ry] = through(out, { x: REST.x * width, y: REST.y * height }, 0);
  const [x0, y0] = cursorAt(out, 0);
  near(x0, rx, 'rests at 62% across (x)', 1e-6);
  near(y0, ry, 'rests at 70% down (y)', 1e-6);
  const first = out.plan.steps[1];
  const before = first.act - TRAVEL_MIN - 0.01; // the camera's resting drift moves the point on the canvas, so compare at the same second
  const [bx, by] = cursorAt(out, before);
  const [ex, ey] = through(out, { x: REST.x * width, y: REST.y * height }, before);
  near(bx, ex, 'still at rest just before the travel starts (x)', 1e-2); // keyed per film frame: the drift between keys is linear
  near(by, ey, 'still at rest just before the travel starts (y)', 1e-2);
  const rest = out.boxes.image;
  assert.ok(rx > rest[0] && rx < rest[0] + rest[2] && ry > rest[1] && ry < rest[1] + rest[3], 'the rest point is inside the picture');
});

test('a take with no pointer at all has no cursor', () => {
  const data = THREE();
  data.steps = data.steps.map((s) => ({ ...s, pointer: null }));
  const out = expandHand(data);
  assert.equal(byId(out, 'w.cursor'), undefined);
});

// the page point one cursor size down and right of `point` (the click's parked spot), in page px
function parked(out, point) {
  const size = 0.05 * out.ctx.canvas.h;
  const k = out.boxes.image[2] / out.data.viewport.width; // drawn px per page px
  return { x: point.x + size / k, y: point.y + size / k };
}

test('a step with no box keeps the cursor where it was (off the clicked label, on the parked spot)', () => {
  const data = THREE();
  data.steps[1] = { ...data.steps[1], box: null };
  const out = expandHand(data);
  const [from, to] = [out.plan.steps[1].start, out.plan.steps[1].end];
  for (const t of [from, (from + to) / 2, to - TRAVEL_MIN]) { // the travel to step 2 borrows the last TRAVEL_MIN s of this step
    const [x, y] = cursorAt(out, t);
    const [ex, ey] = through(out, parked(out, data.steps[0].pointer), t);
    near(x, ex, `x at ${t}`);
    near(y, ey, `y at ${t}`);
  }
});

test('after a click the cursor stays on the clicked spot at most 0.4 s, then eases for 0.3 s to a point one cursor size down and right, so the label reads', () => {
  const data = THREE();
  const out = expandHand(data);
  const { act } = out.plan.steps[0];
  const point = data.steps[0].pointer;
  const at = (t, p) => { const [x, y] = cursorAt(out, t); const [ex, ey] = through(out, p, t); return Math.hypot(x - ex, y - ey); };
  assert.ok(at(act + 0.4, point) < 0.05, 'still on the clicked spot 0.4 s after the click');
  assert.ok(at(act + 0.55, point) > 3, 'on its way off mid-ease');
  assert.ok(at(act + 0.7, parked(out, point)) < 0.5, `one cursor size down and right of the act point 0.7 s after the click (${at(act + 0.7, parked(out, point)).toFixed(2)} px off)`);
  assert.ok(at(act + 0.9, parked(out, point)) < 0.5, 'and it stays there through the hold');
});

test('after a hover the cursor stays on the card (the lift needs it there)', () => {
  const data = THREE();
  data.steps[0] = { ...data.steps[0], do: 'hover' };
  const out = expandHand(data);
  const { act } = out.plan.steps[0];
  const [x, y] = cursorAt(out, act + 0.9);
  const [ex, ey] = through(out, data.steps[0].pointer, act + 0.9);
  near(x, ex, 'x', 0.05);
  near(y, ey, 'y', 0.05);
});

test('a next travel that sets off before the ease can finish leaves the cursor on the click: no half ease', () => {
  const data = handTake([6, 6, 6], [[40, 40, 120, 60], [400, 200, 120, 60], [760, 420, 120, 60]]);
  const out = expandHand(data);
  const from = out.plan.steps[1].act - TRAVEL_MIN; // the next travel starts about 0.1 s after the click
  assert.ok(from - out.plan.steps[0].act < 0.3, 'less than the 0.3 s an ease takes');
  const [x, y] = cursorAt(out, from);
  const [ex, ey] = through(out, data.steps[0].pointer, from);
  near(x, ex, 'on the clicked spot when the travel sets off (x)', 1e-2);
  near(y, ey, 'on the clicked spot when the travel sets off (y)', 1e-2);
});

test('the parked spot stays inside the picture: a click at its bottom right corner does not park off it', () => {
  const data = handTake([30, 30], [[40, 40, 120, 60], [880, 480, 80, 60]]);
  const out = expandHand(data);
  const [ix, iy, iw, ih] = out.boxes.image;
  const size = 0.05 * out.ctx.canvas.h;
  const { act } = out.plan.steps[1];
  const [x, y] = cursorAt(out, act + 0.9);
  const slack = 0.1 * size; // the camera's resting drift moves the picture a few px
  assert.ok(x >= ix - slack && x <= ix + iw - 0.6 * size + slack && y >= iy - slack && y <= iy + ih - size + slack, `the cursor at (${x.toFixed(1)}, ${y.toFixed(1)}) is inside the picture ${[ix, iy, ix + iw, iy + ih].map(Math.round)}`);
});

test('the rest point stays at 62% / 70% unless it lands inside a step box, then it goes just below that box', () => {
  const data = handTake([30, 30], [[40, 40, 120, 60], [500, 300, 200, 150]]); // the second box holds (595, 378)
  const out = expandHand(data);
  const { width, height } = out.data.viewport;
  assert.ok(REST.x * width > 500 && REST.x * width < 700 && REST.y * height > 300 && REST.y * height < 450, 'the rest point is inside the box');
  const [, y] = cursorAt(out, 0);
  const [, below] = through(out, { x: REST.x * width, y: 450 }, 0); // the box's bottom edge
  assert.ok(y >= below - 1e-6, `the rest tip (${y.toFixed(1)}) is below the box (${below.toFixed(1)})`);
  assert.ok(y < below + 0.05 * out.ctx.canvas.h, 'and close under it');
  const [x] = cursorAt(out, 0);
  near(x, through(out, { x: REST.x * width, y: 450 }, 0)[0], 'across it does not move', 1e-6);
});

test('it travels over the TRAVEL_MIN (0.6 s) before act on one curve from the previous pointer, and dips to 0.9 at act for 0.12 s', () => {
  const data = THREE();
  data.steps = data.steps.map((s, i) => ({ ...s, actIndex: s.startIndex + 12, do: i === 0 ? 'hover' : s.do })); // twelve frames before act: the take's own glide; step 0 hovers, so the cursor stays on its pointer
  const out = expandHand(data);
  const { act } = out.plan.steps[1];
  assert.ok(TRAVEL_MIN >= 0.6, `the least travel: ${TRAVEL_MIN}`);
  assert.ok(TRAVEL_MIN > GLIDE / data.fps, 'longer than the take\'s own glide frames');
  const glideFrom = act - TRAVEL_MIN;
  assert.ok(glideFrom < out.plan.steps[1].start, 'it borrows from the previous step\'s hold');
  assert.ok(glideFrom >= out.plan.steps[0].act, 'but never from before the previous step\'s act');
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

test('the travel never starts while a lift holds its card up: it waits until the card starts back down', () => {
  const data = THREE();
  data.steps = data.steps.map((s, i) => ({ ...s, actIndex: s.startIndex + 3, do: i === 0 ? 'hover' : s.do })); // act close to the step's start: 0.6 s back reaches into the lift; the lifted step is hovered, so the cursor stays on the card
  const film = filmOfHand(data, { lift: [{ step: 's0' }] });
  const out = expandWalk(film, { w: data });
  const [span] = walkSetup(film.shots[0], out.ctx).lifts;
  const back = span.end - LIFT_MOVES / 2; // the card starts back
  const { act } = out.plan.steps[1];
  assert.ok(act - TRAVEL_MIN < back - 1e-6, `without the rule the travel would start at ${(act - TRAVEL_MIN).toFixed(2)}, before the card is back (${back.toFixed(2)})`);
  const [ex, ey] = through(out, data.steps[0].pointer, back);
  const [x, y] = cursorAt(out, back);
  near(x, ex, 'still on the lifted step\'s pointer as the card starts back (x)');
  near(y, ey, 'still on the lifted step\'s pointer as the card starts back (y)');
  assert.ok(Math.hypot(...cursorAt(out, back + 0.15).map((v, i) => v - [ex, ey][i])) > 1, 'and it is under way soon after');
});

test('both gate films: from the lifted card to "Add project" the cursor travels at least 0.6 s, and not before the card starts back', () => {
  for (const file of ['gate-walk-keynote.json', 'gate-walk-desk.json']) {
    const tour = gateTour(file);
    const { plan, geo, data, lifts } = tour.setup;
    const [hover, add] = [plan.steps[3], plan.steps[4]];
    const back = lifts[0].end - LIFT_MOVES / 2;
    const from = Math.max(add.act - TRAVEL_MIN, back);
    assert.ok(add.act - from >= TRAVEL_MIN - 1e-9, `${file}: the travel is ${(add.act - from).toFixed(2)} s`);
    assert.ok(from < hover.until, `${file}: it starts (${from.toFixed(2)}) before the add step does (${add.start.toFixed(2)}), borrowing the hold`);
    const cursor = tour.out.nodes.find((n) => n.id === `${tour.shot.id}.cursor`);
    const pointer = geo.mapPoint(data.steps.find((s) => s.id === 'hover').pointer);
    const standing = (t) => pointThroughCamera(pointer, tour.cam(t), tour.ctx.canvas);
    const at = (t) => [sample(cursor.tracks.x, t), sample(cursor.tracks.y, t)];
    const [sx, sy] = standing(from - 0.01);
    near(at(from - 0.01)[0], sx, `${file}: on the hovered card until the card is back (x)`, 1e-2);
    near(at(from - 0.01)[1], sy, `${file}: on the hovered card until the card is back (y)`, 1e-2);
    const [mx, my] = standing(from + 0.2);
    assert.ok(Math.hypot(at(from + 0.2)[0] - mx, at(from + 0.2)[1] - my) > 2, `${file}: under way 0.2 s later`);
  }
});

// ---- the ripple ----

const boundsOf = (d) => {
  const nums = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const [xs, ys] = [nums.filter((_, i) => i % 2 === 0), nums.filter((_, i) => i % 2 === 1)];
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

test('a click step adds a clearly visible outline ring (0.08 of the cursor, full opacity for 0.15 s) from 1.6 to 2.6 times the cursor, fading over 0.45 s, in both looks; other steps add none', () => {
  for (const look of ['keynote', 'desk']) {
    const data = THREE();
    data.steps[1] = { ...data.steps[1], do: 'hover' };
    const out = expandWalk(walkFilm(handShot(data), { look }), { w: data });
    const ids = all(out.nodes).filter((n) => /^w\.ripple\d+$/.test(n.id)).map((n) => n.id);
    assert.deepEqual(ids, ['w.ripple0', 'w.ripple2'], `${look}: the click steps only`);
    const ripple = out.nodes.find((n) => n.id === 'w.ripple2');
    const ring = byId(out, 'w.ripple2.ring');
    const size = 0.05 * out.ctx.canvas.h;
    const { act } = out.plan.steps[2];
    assert.equal(ripple.props.fixed, true);
    assert.equal(ring.props.stroke, out.ctx.look.palette[out.ctx.look.kinds.walk.ripple.color]);
    const across = (t) => boundsOf(ring.props.d).w * sample(ripple.tracks.scale, t); // the ring's diameter on the canvas
    assert.ok(across(act) >= 1.6 * size - 0.5, `${look}: starts at ${(across(act) / size).toFixed(2)} times the cursor, at least 1.6`);
    near(across(act + 0.45), 2.6 * size, `${look}: ends at 2.6 times the cursor`, 0.5);
    // at act + 0.1 s: fully opaque, and a stroke a viewer sees (about 0.08 of the cursor's size, scaled with the ring)
    const seen = ring.props.strokeWidth * sample(ripple.tracks.scale, act + 0.1);
    assert.equal(sample(ripple.tracks.opacity, act + 0.1), 1, `${look}: fully opaque at act + 0.1 s`);
    assert.ok(Math.abs(ring.props.strokeWidth - 0.08 * size) < 0.005 * size, `${look}: ring stroke ${ring.props.strokeWidth} is 0.08 of the cursor (${0.08 * size})`);
    assert.ok(seen >= 0.08 * size && seen <= 0.14 * size, `${look}: the stroke seen at act + 0.1 s is ${seen.toFixed(2)} px against the cursor's ${size}`);
    const keyline = byId(out, 'w.ripple2.keyline');
    assert.equal(keyline.props.stroke, out.ctx.look.palette.paper, `${look}: a paper keyline under it`);
    assert.ok(keyline.props.strokeWidth > ring.props.strokeWidth, `${look}: wider than the ring`);
    assert.equal(sample(ripple.tracks.opacity, act - 0.01), 0, `${look}: not there before the click`);
    assert.equal(sample(ripple.tracks.opacity, act + 0.15), 1, `${look}: opaque for its first 0.15 s`);
    assert.ok(sample(ripple.tracks.opacity, act + 0.3) < 1 && sample(ripple.tracks.opacity, act + 0.3) > 0, `${look}: then fading`);
    assert.equal(sample(ripple.tracks.opacity, act + 0.45 + 0.01), 0, `${look}: gone after 0.45 s`);
    const [rx, ry] = [sample(ripple.tracks.x, act), sample(ripple.tracks.y, act)];
    const [cx, cy] = through(out, data.steps[2].pointer, act);
    near(rx, cx, `${look}: ripple x`);
    near(ry, cy, `${look}: ripple y`);
  }
});

test('the ring stays on its click point for its whole 0.4 s, though the cursor has set off for the next step', () => {
  const data = handTake([6, 6, 6], [[40, 40, 120, 60], [400, 200, 120, 60], [760, 420, 120, 60]]); // short steps: the next travel starts inside the ring
  const out = expandHand(data);
  const { act } = out.plan.steps[0];
  assert.ok(out.plan.steps[1].act - TRAVEL_MIN < act + 0.3, 'the cursor is already travelling to step 1 while the ring is up');
  const ripple = out.nodes.find((n) => n.id === 'w.ripple0');
  for (const t of [act, act + 0.1, act + 0.2, act + 0.3, act + 0.45]) {
    const [ex, ey] = through(out, data.steps[0].pointer, t);
    near(sample(ripple.tracks.x, t), ex, `ring x at +${(t - act).toFixed(1)} s`, 1e-2);
    near(sample(ripple.tracks.y, t), ey, `ring y at +${(t - act).toFixed(1)} s`, 1e-2);
  }
});

test('on the click frame of "Add project" the ring is an outline round the label, not a blot over it (at most 0.1 of the cursor in ink, 1.6 times it across)', () => {
  const out = expandWalk(walkFilm(), { w: committed() });
  const ring = byId(out, 'w.ripple4.ring');
  const ripple = out.nodes.find((n) => n.id === 'w.ripple4');
  const { act } = out.plan.steps[4];
  const size = 0.05 * out.ctx.canvas.h;
  const stroke = ring.props.strokeWidth * sample(ripple.tracks.scale, act);
  assert.ok(stroke <= 0.1 * size, `${stroke.toFixed(2)} px of ink at the click frame`);
  assert.ok(boundsOf(ring.props.d).w * sample(ripple.tracks.scale, act) >= 1.6 * size - 0.5, 'and it is wider than the label it rings');
});

test('the committed take ripples on its two click steps, tab and add, and not on typing or hovering', () => {
  const out = expandWalk(walkFilm(), { w: committed() });
  const ids = all(out.nodes).filter((n) => /^w\.ripple\d+$/.test(n.id)).map((n) => n.id);
  assert.deepEqual(ids, ['w.ripple1', 'w.ripple4']);
});
