// How the lift reads (gate round 2): the crop is drawn through a rounded rectangle of the look's radius (no square corners),
// the scrim covers the card's own slot (no outline of it shows round the raised card) and the raised card covers the slot,
// and the card stands clear of its neighbours with the camera centring it. Pure, on the gate films and the committed take.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pointThroughCamera } from '../../engine/graph/camera.mjs';
import { sample } from '../../engine/time/track.mjs';
import { LIFT_MOVES } from '../../engine/kinds/walk-time.mjs';
import { LIFT_GROW } from '../../engine/kinds/walk-lift.mjs';
import { all } from './helpers/kinds.mjs';
import { PAGE, gateTour } from './helpers/walk-gate.mjs';

const FILMS = ['gate-walk-keynote.json', 'gate-walk-desk.json'];
const byId = (out, id) => all(out.nodes).find((n) => n.id === id);
const MIN_CLEAR = 10; // px of the frame between the raised card and a neighbour

// the lift's hold: from the card's peak to the second it starts back
const holdOf = (tour) => {
  const [span] = tour.setup.lifts;
  return { from: span.start + LIFT_MOVES / 2, to: span.end - LIFT_MOVES / 2 };
};

// a rectangle of page px ([x, y, w, h]) in frame px at t, as [l, t, r, b]
function frameRect(tour, t, [x, y, w, h]) {
  const [ix, iy, iw, ih] = tour.out.boxes.image;
  const map = ([px, py]) => pointThroughCamera([ix + (px / PAGE.w) * iw, iy + (py / PAGE.h) * ih], tour.cam(t), tour.ctx.canvas);
  return [...map([x, y]), ...map([x + w, y + h])];
}

// the raised card in frame px at t: the crop as drawn, which is the box grown by LIFT_GROW page px a side (the card's own border)
function cardRect(tour, t) {
  const group = byId(tour.out, `${tour.shot.id}.lift0`);
  const { w, h } = byId(tour.out, `${tour.shot.id}.lift0.image`).props;
  const s = sample(group.tracks.scale, t), y = sample(group.tracks.y, t);
  return [...pointThroughCamera([group.props.x - (w * s) / 2, y - (h * s) / 2], tour.cam(t), tour.ctx.canvas), ...pointThroughCamera([group.props.x + (w * s) / 2, y + (h * s) / 2], tour.cam(t), tour.ctx.canvas)];
}

// Each gate film is checked as shipped (a whole stop, so the card is raised where it sits) and as a pushed copy with the old step
// stops (built without validation), so the push camera keeps its centring and clearance guards.
const VARIANTS = FILMS.flatMap((file) => [{ file, pushed: false, label: file }, { file, pushed: true, label: `${file} (pushed copy)` }]);

for (const { file, pushed, label } of VARIANTS) {
  test(`${label}: the lifted crop is drawn through a rounded rectangle of the look's radius, in the picture's drawn px`, () => {
    const tour = gateTour(file, { pushed });
    const image = byId(tour.out, `${tour.shot.id}.lift0.image`);
    const { radius } = tour.ctx.look.kinds.walk.lift;
    assert.ok(radius >= 8, `the look names a radius: ${radius}`);
    // the crop is the box grown by LIFT_GROW, so its corners are concentric with the card's: the radius grows by as much
    const wanted = ((radius + LIFT_GROW) * tour.out.boxes.image[2]) / PAGE.w;
    assert.ok(Math.abs(image.props.round - wanted) < 1e-6, `${image.props.round} vs ${wanted}`);
  });

  test(`${label}: the scrim has no hole: it covers the card's own slot while the lift is up`, () => {
    const tour = gateTour(file, { pushed });
    const scrim = byId(tour.out, `${tour.shot.id}.lift0.focus`);
    assert.equal(scrim.props.d.match(/M/g).length, 1, 'one outline, no cut-out');
  });

  test(`${label}: the raised card covers its slot at every film frame of the hold, so the slot's outline never shows round it`, () => {
    const tour = gateTour(file, { pushed });
    const { from, to } = holdOf(tour);
    for (let k = Math.ceil(from * tour.fps); k / tour.fps <= to; k += 1) {
      const t = k / tour.fps;
      const [sl, st, sr, sb] = frameRect(tour, t, boxOf(tour));
      const [l, top, r, b] = cardRect(tour, t);
      assert.ok(l <= sl + 0.01 && top <= st + 0.01 && r >= sr - 0.01 && b >= sb - 0.01, `${label} at ${t.toFixed(2)}: card ${[l, top, r, b].map(Math.round)} over slot ${[sl, st, sr, sb].map(Math.round)}`);
      assert.ok(b - sb >= 2, `${label} at ${t.toFixed(2)}: the card reaches ${b - sb} px past the slot's bottom edge, enough to hide its corners`);
    }
  });

  // The pushed camera centres the raised card; the shipped whole picture raises it where it sits, so only the pushed copy is held
  // to the centring. The clearance rule (neighbours MIN_CLEAR px off) holds for both. At the whole view a 1.1 lift grew the card
  // about 12 px a side into a ~19 px gap (7.4 px left in keynote, 7.6 px in desk), so each look's lift.wholeScale is the scale
  // of a lift raised with the camera at zoom 1. The rule is not loosened.
  test(`${label}: the raised card ${pushed ? 'is centred in the frame with ' : 'has '}clear space round it: its neighbours stay ${MIN_CLEAR} px off`, () => {
    const tour = gateTour(file, { pushed });
    const { from, to } = holdOf(tour);
    const { w, h } = tour.ctx.canvas;
    const pad = tour.ctx.look.kinds.walk.pushPad * tour.ctx.unit;
    for (let k = Math.ceil(from * tour.fps); k / tour.fps <= to; k += 1) {
      const t = k / tour.fps;
      const [l, top, r, b] = cardRect(tour, t);
      if (pushed) {
        assert.ok(Math.abs((l + r) / 2 - w / 2) <= 0.03 * w, `${label} at ${t.toFixed(2)}: centred across, at ${Math.round((l + r) / 2)}`);
        assert.ok(Math.abs((top + b) / 2 - h / 2) <= 0.08 * h, `${label} at ${t.toFixed(2)}: centred down, at ${Math.round((top + b) / 2)}`);
      }
      assert.ok(l >= pad && top >= pad && r <= w - pad && b <= h - pad, `${label} at ${t.toFixed(2)}: inside the title-safe pad`);
      const left = frameRect(tour, t, [32, 272, 212, 122])[2]; // the card to the left: its right edge
      const right = frameRect(tour, t, [488, 272, 212, 122])[0]; // the card to the right: its left edge
      const search = frameRect(tour, t, [32, 218, 397, 34])[3]; // the search row: its bottom edge
      assert.ok(l - left >= MIN_CLEAR, `${label} at ${t.toFixed(2)}: ${Math.round(l - left)} px from the card on the left`);
      assert.ok(right - r >= MIN_CLEAR, `${label} at ${t.toFixed(2)}: ${Math.round(right - r)} px from the card on the right`);
      assert.ok(top - search >= MIN_CLEAR, `${label} at ${t.toFixed(2)}: ${Math.round(top - search)} px under the search row`);
    }
  });
}

// the hover step's slot in page px, [x, y, w, h]
function boxOf(tour) {
  const { box } = tour.setup.data.steps.find((s) => s.id === 'hover');
  return [box.x, box.y, box.width, box.height];
}
