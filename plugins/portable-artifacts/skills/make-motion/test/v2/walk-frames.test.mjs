// The gate films' tour (keynote and desk) at every film frame of every hold: no word of the fixture page is cut by a frame
// edge while the camera rests on a stop or a lift is up (gate round 2: the tab row cut at the top during the lift, the header
// cut in a hold). Mid-move frames may slice for a moment, so only the holds are checked. Pure, on the committed take.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pointThroughCamera } from '../../engine/graph/camera.mjs';
import { LIFT_MOVES } from '../../engine/kinds/walk-time.mjs';
import { ADDED_TEXT, LIFTED_TEXT, PAGE_TEXT, gateTour, sliced } from './helpers/walk-gate.mjs';

const FILMS = ['gate-walk-keynote.json', 'gate-walk-desk.json'];
const EPSILON = 1e-9;
const ADDED_CARD = [716, 272, 212, 122]; // the card the add click brings, in page px

// [{ label, from, to, lifted }]: the seconds the camera rests: each stop from where it lands to where the next move (or lift)
// starts, and each lift while its card is fully up.
function holdsOf(tour) {
  const { stops, lifts: held } = tour.setup.planned;
  const moves = stops.filter((s) => !s.dropped && !s.noRoom);
  const spans = tour.setup.lifts;
  const nextStart = (land) => Math.min(tour.duration, ...[...moves.map((s) => s.start), ...spans.map((l) => l.start)].filter((t) => t > land + EPSILON));
  return [
    ...moves.map((s) => ({ label: `stop ${s.to}`, from: s.land, to: nextStart(s.land), lifted: false })),
    ...spans.filter((l) => held.some((h) => h.step === l.step)).map((l) => ({ label: `lift ${l.step}`, from: l.start + LIFT_MOVES / 2, to: l.end - LIFT_MOVES / 2, lifted: true })),
  ];
}

const allNodes = (nodes) => nodes.flatMap((n) => [n, ...allNodes(n.children)]);

for (const file of FILMS) {
  test(`${file}: the mark on the search field stays out of the title-safe pad at every frame it is up`, () => {
    const tour = gateTour(file);
    const mark = allNodes(tour.out.nodes).find((n) => n.id === `${tour.shot.id}.on0`);
    const clear = allNodes(tour.out.nodes).find((n) => n.id === `${tour.shot.id}.on0.clear`);
    const { w, h } = tour.ctx.canvas;
    const pad = tour.ctx.look.kinds.walk.pushPad * tour.ctx.unit;
    const nums = mark.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const points = Array.from({ length: nums.length / 2 }, (_, i) => [nums[2 * i], nums[2 * i + 1]]);
    // while the camera rests: from the first stroke to where the mark clears or the next camera move starts (a mid-move frame may cross the pad)
    const moves = tour.setup.planned.stops.filter((s) => !s.dropped && !s.noRoom).map((s) => s.start);
    const from = mark.tracks.draw.points[0].t;
    const to = Math.min(clear.tracks.opacity.points.at(-1).t, ...moves.filter((t) => t > from));
    assert.ok(to > from + 1, `the mark is up for a while: ${from} to ${to}`);
    for (let k = Math.ceil(from * tour.fps); k / tour.fps <= to; k += 1) {
      const cam = tour.cam(k / tour.fps);
      const half = (mark.props.strokeWidth / 2) * cam.zoom; // the ring's own stroke (its soft glow under it is exempt)
      for (const p of points) {
        const [x, y] = pointThroughCamera(p, cam, tour.ctx.canvas);
        assert.ok(x - half >= pad - 0.5 && x + half <= w - pad + 0.5 && y - half >= pad - 0.5 && y + half <= h - pad + 0.5, `${file} at ${(k / tour.fps).toFixed(2)} s: the mark reaches (${Math.round(x)}, ${Math.round(y)}) inside the ${pad} px pad`);
      }
    }
  });

  test(`${file}: the last step's hold shows (all but 1% of) the page's width, so the card the click adds is in frame whole`, () => {
    const tour = gateTour(file);
    const { stops } = tour.setup.planned;
    const add = stops.find((s) => s.to === 'step:add');
    for (let t = add.land + 0.5; t < stops.find((s) => s.to === 'whole').start; t += 0.1) {
      const [left, top, right, bottom] = tour.window(t);
      assert.ok(right - left >= 0.98 * 960, `${file} at ${t.toFixed(2)} s: ${Math.round(right - left)} page px wide`);
      const [cx, cy, cw, ch] = ADDED_CARD;
      assert.ok(left <= cx && top <= cy && right >= cx + cw && bottom >= cy + ch, `${file} at ${t.toFixed(2)} s: window ${[left, top, right, bottom].map(Math.round)} holds the new card ${ADDED_CARD}`);
    }
  });

  test(`${file}: no word is cut by a frame edge at any film frame of any stop hold or lift hold`, () => {
    const tour = gateTour(file);
    const addAct = tour.setup.plan.steps.at(-1).act;
    const holds = holdsOf(tour);
    assert.ok(holds.length >= 4, `the tour has holds to check: ${holds.map((h) => h.label)}`);
    for (const hold of holds) {
      for (let k = Math.ceil(hold.from * tour.fps - EPSILON); k / tour.fps <= hold.to + EPSILON; k += 1) {
        const t = k / tour.fps;
        const texts = [...PAGE_TEXT.filter((r) => !hold.lifted || r !== LIFTED_TEXT), ...(t >= addAct + 0.5 ? ADDED_TEXT : [])];
        const box = tour.window(t);
        const cut = texts.filter((rect) => sliced(box, rect));
        assert.deepEqual(cut, [], `${file} ${hold.label} at ${t.toFixed(2)} s: window ${box.map(Math.round)} slices ${JSON.stringify(cut)}`);
      }
    }
  });
}
