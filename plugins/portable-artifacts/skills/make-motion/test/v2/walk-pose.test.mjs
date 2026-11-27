// The walk camera's poses (engine/kinds/walk-pose.mjs): a step stop frames a context region, not the bare box (the box
// grown to a share of the picture, centred on it, clamped inside it), at the zoom that fits it inside the title-safe pad,
// capped at the take's native zoom; once the zoom fills the frame, no ground shows beside the picture. Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pointThroughCamera } from '../../engine/graph/camera.mjs';
import { contextRegion, fitZoom, stepPose, clampPan, WHOLE } from '../../engine/kinds/walk-pose.mjs';
import { walkSetup } from '../../engine/kinds/walk-layout.mjs';
import { layeredCamera } from '../../engine/graph/camera.mjs';
import { STEPS, committed, expandWalk, walkFilm, walkShot } from './helpers/walk.mjs';

const near = (actual, wanted, label, tolerance = 1e-6) => assert.ok(Math.abs(actual - wanted) < tolerance, `${label}: ${actual} is not ${wanted}`);
const IMAGE = [100, 50, 1000, 500];

test('the whole pose is the camera at rest', () => {
  assert.deepEqual(WHOLE, { x: 0, y: 0, zoom: 1 });
});

test('a small box grows to the share of the picture in both directions, centred on the box', () => {
  const [x, y, w, h] = contextRegion(IMAGE, [600, 300, 40, 20], 0.45);
  near(w, 450, 'width');
  near(h, 225, 'height');
  near(x + w / 2, 620, 'centred on the box (x)');
  near(y + h / 2, 310, 'centred on the box (y)');
});

test('a box already larger than the share is the region as it is', () => {
  const [, , w, h] = contextRegion(IMAGE, [200, 100, 700, 400], 0.45);
  near(w, 700, 'width');
  near(h, 400, 'height');
});

test('the region is clamped inside the picture: a box at a corner gives a region that starts at the corner', () => {
  const [x, y, w, h] = contextRegion(IMAGE, [102, 52, 40, 20], 0.45);
  near(x, 100, 'left edge');
  near(y, 50, 'top edge');
  const far = contextRegion(IMAGE, [1090, 540, 10, 10], 0.45);
  near(far[0] + far[2], 1100, 'right edge');
  near(far[1] + far[3], 550, 'bottom edge');
  assert.ok(w > 0 && h > 0);
});

test('the zoom fits the region inside the title-safe pad', () => {
  const canvas = { w: 1920, h: 1080 };
  near(fitZoom([0, 0, 600, 300], canvas, 60), Math.min(1800 / 600, 960 / 300), 'the tighter axis');
  near(fitZoom([0, 0, 1800, 300], canvas, 60), 1, 'a region as wide as the safe frame needs no zoom');
});

test('clampPan: a picture that fills the frame never shows ground beside it, a picture smaller than the frame is centred', () => {
  const canvas = { w: 1920, h: 1080 };
  const image = [286, 197, 1348, 758];
  const zoom = 2.1;
  const left = clampPan({ x: -5000, y: 0 }, zoom, image, canvas, 0);
  const [edgeL] = pointThroughCamera([image[0], image[1]], { x: left.x, y: left.y, zoom, rotate: 0 }, canvas);
  assert.ok(edgeL <= 1e-6, `the picture's left edge is at or past the frame's: ${edgeL}`);
  const right = clampPan({ x: 5000, y: 5000 }, zoom, image, canvas, 0);
  const [edgeR, edgeB] = pointThroughCamera([image[0] + image[2], image[1] + image[3]], { x: right.x, y: right.y, zoom, rotate: 0 }, canvas);
  assert.ok(edgeR >= canvas.w - 1e-6 && edgeB >= canvas.h - 1e-6, `${edgeR}, ${edgeB}`);
  const small = clampPan({ x: 300, y: 300 }, 1, [500, 300, 900, 500], canvas, 0);
  const [mx, my] = pointThroughCamera([950, 550], { x: small.x, y: small.y, zoom: 1, rotate: 0 }, canvas);
  near(mx, 960, 'centred (x)');
  near(my, 540, 'centred (y)');
});

test('the context shares are separate for width and height', () => {
  const [, , w, h] = contextRegion(IMAGE, [600, 300, 40, 20], 0.7, 0.45);
  near(w, 700, 'width');
  near(h, 225, 'height');
});

test('snap: a frame edge within the snap share of the picture\'s edge goes onto it; one further in stays', () => {
  const canvas = { w: 1920, h: 1080 };
  const image = [0, 0, 1348, 758];
  const zoom = 2;
  const leftEdge = (pan) => pointThroughCamera([0, 0], { x: pan.x, y: pan.y, zoom, rotate: 0 }, canvas)[0];
  const fillsFrom = clampPan({ x: -1e6, y: 0 }, zoom, image, canvas, 0); // the pan that puts the picture's left edge on the frame's
  const near1 = clampPan({ x: fillsFrom.x + 0.05 * 1348 * zoom, y: fillsFrom.y }, zoom, image, canvas, 0, 0.1);
  near(leftEdge(near1), 0, 'inside the snap: on the edge');
  const far = clampPan({ x: fillsFrom.x + 0.3 * 1348 * zoom, y: fillsFrom.y }, zoom, image, canvas, 0, 0.1);
  assert.ok(leftEdge(far) < -0.25 * 1348 * zoom, `outside the snap it stays: ${leftEdge(far)}`);
  const none = clampPan({ x: fillsFrom.x + 0.05 * 1348 * zoom, y: fillsFrom.y }, zoom, image, canvas, 0);
  assert.ok(leftEdge(none) < -10, 'with no snap it stays');
});

// ---- on the committed take ----

const setupOf = (look) => {
  const out = expandWalk(walkFilm(walkShot(), { look }), { w: committed() });
  return { out, geo: { image: out.boxes.image, picture: { width: out.data.width, height: out.data.height } } };
};


// ---- the gate film's stops on the committed take cut no text ----

// the text of the fixture page as [x, y, w, h] in page px (measured on the take's settled frames); a window that crosses one
// of these partly slices a word. Card 4 and its text exist once the add step has clicked.
const CARD_TEXT = (x) => [x + 16, 288, 142, 98];
const PAGE_TEXT = [
  [32, 12, 90, 30], [815, 12, 115, 30], [32, 85, 92, 26], [32, 120, 300, 16], [46, 165, 220, 26], [32, 218, 280, 34], [324, 218, 105, 34],
  CARD_TEXT(32), CARD_TEXT(260), CARD_TEXT(488), [32, 420, 110, 25],
  [48, 463, 270, 22], [880, 463, 38, 22], [48, 503, 235, 22], [880, 503, 38, 22],
];
const ADDED_TEXT = [CARD_TEXT(716)];
const STARTS = [0.11, 3.3, 6.4, 8.9, 11];

// the window the camera shows at shot second t, as [left, top, right, bottom] in the take's page px
function windowAt(out, t) {
  const cam = layeredCamera(out.camera, 'test')(t);
  const { w, h } = out.ctx.canvas;
  const [ix, iy, iw, ih] = out.boxes.image;
  const page = (s, size, pan, origin, length, pagePx) => ((size / 2 + (s + pan - size / 2) / cam.zoom - origin) / length) * pagePx;
  return [page(0, w, cam.x, ix, iw, 960), page(0, h, cam.y, iy, ih, 540), page(w, w, cam.x, ix, iw, 960), page(h, h, cam.y, iy, ih, 540)];
}

const sliced = ([l, t, r, b], [x, y, w, h]) => {
  const inter = Math.max(0, Math.min(r, x + w) - Math.max(l, x)) * Math.max(0, Math.min(b, y + h) - Math.max(t, y));
  return inter > 1 && inter < w * h - 1;
};

test('on the committed take, no stop of the gate film leaves a word sliced at a frame edge, in both looks', () => {
  for (const look of ['keynote', 'desk']) {
    const shot = walkShot({ frame: 'window', steps: STEPS.map((id, i) => ({ id, at: STARTS[i] })), stops: [{ to: 'step:tab' }, { to: 'step:hover' }, { to: 'step:add' }, { to: 'whole' }], lift: [{ step: 'hover' }] });
    const out = expandWalk(walkFilm(shot, { look }), { w: committed() });
    const { stops } = walkSetup(shot, out.ctx).planned;
    const at = (to) => stops.find((s) => s.to === to);
    const checks = [['tab stop', at('step:tab').land, PAGE_TEXT], ['hover stop', at('step:hover').land, PAGE_TEXT], ['add stop', at('step:add').land + 0.9, [...PAGE_TEXT, ...ADDED_TEXT]]];
    const [lift] = walkSetup(shot, out.ctx).lifts;
    checks.push(['lift hold', lift.start + 0.8, PAGE_TEXT.filter((r) => r !== PAGE_TEXT[8])]); // the lifted card's own text is the card's, not the page's
    for (const [label, t, texts] of checks) {
      const box = windowAt(out, t);
      const cut = texts.filter((rect) => sliced(box, rect));
      assert.deepEqual(cut, [], `${look} ${label}: window ${box.map(Math.round)} slices ${JSON.stringify(cut)}`);
    }
  }
});

test('the last step frames more of the page than one before it (its result can appear anywhere)', () => {
  const out = expandWalk(walkFilm(walkShot({ stops: [{ to: 'step:tab' }, { to: 'step:add' }] })), { w: committed() });
  const [tab, add] = walkSetup(walkShot({ stops: [{ to: 'step:tab' }, { to: 'step:add' }] }), out.ctx).planned.stops;
  assert.ok(add.zoom < tab.zoom - 0.1, `add ${add.zoom} vs tab ${tab.zoom}`);
});
