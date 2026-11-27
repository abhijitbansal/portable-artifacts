// The walk kind in the page: every picture it shows is a frame of the take, drawn as stored (a synthetic take of solid
// colours, one per frame run, so a pixel names the frame), and the page asks for the take's frames by /clip/<k>/<n> and
// nothing else. Run with --test-concurrency=1; skips without a browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserAvailable } from './helpers/session.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { openSession } from '../../scripts/v2/session.mjs';
import { reviewFilm } from '../../scripts/v2/review.mjs';
import { walkPlan, LIFT_LEAD } from '../../engine/kinds/walk-time.mjs';
import { walkGeometry, liftsOf } from '../../engine/kinds/walk-layout.mjs';
import { shotContext } from '../../engine/graph/film.mjs';
import { layeredCamera, pointThroughCamera } from '../../engine/graph/camera.mjs';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { encodePng } from '../../scripts/lib/png-write.mjs';
import { writeSyntheticTake, frameName, SIDE } from './helpers/synthetic-take.mjs';
import { canvasOf, measure } from './helpers/kinds.mjs';

// the synthetic take: 12 frames, names k = floor(f / 3); step open settles on frame 2 (colour 0), tab on frame 7 (colour 2),
// search on frame 11 (colour 3)
const COLOURS = [[200, 30, 30], [30, 200, 30], [30, 30, 200], [200, 200, 30]];
const FILM = { version: 2, mode: 'pro', look: 'keynote', format: '16:9', fps: 30, seed: 3, shots: [
  { id: 'w', show: 'walk', src: 'take', hold: 4, title: 'Shop', steps: [{ id: 'open' }, { id: 'tab' }, { id: 'search' }] },
] };

// the same film with a lift on the last step, and the cursor drawn on every step
const LIFT_FILM = { ...FILM, shots: [{ ...FILM.shots[0], lift: [{ step: 'search' }] }] };

// the last step's settled picture (colour 3) with its box (page 20, 180, 280 x 34; the take is at scale 1) in another colour,
// so a crop cut from the wrong place shows the wrong colour at the box centre
const BOX_COLOUR = [240, 120, 200];
function boxedPicture() {
  const data = Buffer.alloc(SIDE * SIDE * 3);
  for (let y = 0; y < SIDE; y += 1) {
    for (let x = 0; x < SIDE; x += 1) data.set(x >= 20 && x < 300 && y >= 180 && y < 214 ? BOX_COLOUR : COLOURS[3], (y * SIDE + x) * 3);
  }
  return encodePng({ width: SIDE, height: SIDE, channels: 3, data });
}

let dir, ready = false;
before(async () => {
  ready = await browserAvailable();
  dir = mkdtempSync(path.join(tmpdir(), 'mm-walk-b-'));
  writeSyntheticTake(dir, { edit: (take, pngs) => pngs.set(frameName(3), boxedPicture()) });
  writeFileSync(path.join(dir, 'film.json'), JSON.stringify(FILM));
  writeFileSync(path.join(dir, 'lift.json'), JSON.stringify(LIFT_FILM));
});
after(() => rmSync(dir, { recursive: true, force: true }));

async function open(t, file = 'film.json') {
  if (!ready) { t.skip('no browser'); return null; }
  const session = await openSession(loadFilm(path.join(dir, file)));
  t.after(() => session.close());
  return session;
}

// The pixel of the page's pre-post source canvas at frame i, as [r, g, b], at canvas point (x, y).
const pixelAt = (page, i, x, y) => page.evaluate(async ([frame, px, py]) => {
  await window.__seek(frame);
  return [...window.__source.getContext('2d').getImageData(Math.round(px), Math.round(py), 1, 1).data.slice(0, 3)];
}, [i, x, y]);

const frameAt = (seconds) => Math.round(seconds * 30);
const dimmed = (pixel, colour) => pixel.some((v, i) => Math.abs(v - colour[i]) > 8);

function geometryOf(loaded) {
  const ctx = shotContext({ film: loaded.film, index: 0, timeline: loaded.timeline, canvas: canvasOf('16:9'), measure, assets: new Map(), prepared: loaded.prepared });
  return walkGeometry(loaded.film.shots[0], { ...ctx, data: ctx.look.kinds.walk }, loaded.prepared.w);
}

test('at a time inside step 2\'s hold, the canvas pixel at the mapped centre is step 2\'s settled frame, as stored', async (t) => {
  const loaded = loadFilm(path.join(dir, 'film.json'));
  const session = await open(t);
  if (!session) return;
  const plan = walkPlan(loaded.film.shots[0], loaded.timeline.shots[0], loaded.prepared.w);
  const hold = plan.steps[1].end + 0.25;
  assert.ok(hold < plan.steps[2].start, 'the time is in step 2\'s hold');
  const geo = geometryOf(loaded);
  const [cx, cy] = geo.mapPoint({ x: 160, y: 160 }); // the centre of the 320 x 320 page
  assert.deepEqual(await pixelAt(session.page, Math.round(hold * 30), cx, cy), COLOURS[2], 'step tab settled on colour 2');
  // the same inside the step's own box, mapped from page px (right of the box's middle: the cursor stands on its pointer)
  const box = loaded.prepared.w.steps[1].box;
  const [bx, by] = geo.mapPoint({ x: box.x + 0.85 * box.width, y: box.y + 0.75 * box.height });
  assert.deepEqual(await pixelAt(session.page, Math.round(hold * 30), bx, by), COLOURS[2]);
  assert.deepEqual(session.errors, []);
  assert.deepEqual(session.blocked, []);
});

test('before the first step starts the walk shows its first frame, and at the end the last step\'s settled frame', async (t) => {
  const loaded = loadFilm(path.join(dir, 'film.json'));
  const session = await open(t);
  if (!session) return;
  const geo = geometryOf(loaded);
  const [cx, cy] = geo.mapPoint({ x: 160, y: 160 });
  const last = loaded.timeline.frameCount - 1;
  assert.deepEqual(await pixelAt(session.page, 0, cx, cy), COLOURS[0]);
  assert.deepEqual(await pixelAt(session.page, last, cx, cy), COLOURS[3]);
});

test('a render of the take asks the server for /clip/<k>/<n> and nothing outside /clip/', async (t) => {
  const session = await open(t);
  if (!session) return;
  const seen = [];
  session.page.on('request', (request) => seen.push(new URL(request.url()).pathname));
  for (const i of [0, 20, 45, 70, 95, 119]) await session.page.evaluate((frame) => window.__seek(frame), i);
  assert.ok(seen.length > 0, 'the take\'s frames were asked for');
  assert.deepEqual(seen.filter((p) => !/^\/clip\/\d+\/\d+$/.test(p)), []);
  assert.deepEqual(session.blocked, []);
});

test('inside the lift the lifted crop\'s pixel is the frame\'s pixel at the box centre, and the rest of the picture is dimmed', async (t) => {
  const loaded = loadFilm(path.join(dir, 'lift.json'));
  const session = await open(t, 'lift.json');
  if (!session) return;
  const geo = geometryOf(loaded);
  const shot = loaded.film.shots[0];
  const ctx = shotContext({ film: loaded.film, index: 0, timeline: loaded.timeline, canvas: canvasOf('16:9'), measure, assets: new Map(), prepared: loaded.prepared });
  const plan = walkPlan(shot, loaded.timeline.shots[0], loaded.prepared.w, { lifts: liftsOf(shot, ctx.look) });
  const { hold } = ctx.look.kinds.walk.lift;
  const start = plan.steps[2].end + LIFT_LEAD;
  const inside = start + 0.4 + hold / 2;
  const box = loaded.prepared.w.steps[2].box;
  const [cx, cy] = geo.mapPoint({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const [ox, oy] = geo.mapPoint({ x: 8, y: 8 }); // on the picture, outside the lifted card
  assert.deepEqual(await pixelAt(session.page, frameAt(inside), cx, cy), BOX_COLOUR, 'the lifted crop shows the settled frame at the box centre, as stored');
  assert.ok(dimmed(await pixelAt(session.page, frameAt(inside), ox, oy), COLOURS[3]), 'the rest of the picture is dimmed under the lift');
  assert.deepEqual(await pixelAt(session.page, frameAt(start - 0.1), ox, oy), COLOURS[3], 'and not before it');
  assert.deepEqual(session.errors, []);
  assert.deepEqual(session.blocked, []);
});

test('the lifted card has rounded corners: a pixel just inside its corner is the scrim, not the crop; the middle of its top edge is the crop', async (t) => {
  const loaded = loadFilm(path.join(dir, 'lift.json'));
  const session = await open(t, 'lift.json');
  if (!session) return;
  const shot = loaded.film.shots[0];
  const ctx = shotContext({ film: loaded.film, index: 0, timeline: loaded.timeline, canvas: canvasOf('16:9'), measure, assets: new Map(), prepared: loaded.prepared });
  const out = registries.kinds.get('walk').expand(shot, ctx);
  const plan = walkPlan(shot, loaded.timeline.shots[0], loaded.prepared.w, { lifts: liftsOf(shot, ctx.look) });
  const at = plan.steps[2].end + LIFT_LEAD + 0.4 + ctx.look.kinds.walk.lift.hold / 2;
  const group = out.nodes.flatMap(function flat(n) { return [n, ...n.children.flatMap(flat)]; }).find((n) => n.id === 'w.lift0');
  const cam = layeredCamera(out.camera, 'test')(at);
  const [bw, bh] = [out.boxes['step:search'][2], out.boxes['step:search'][3]];
  const [s, y] = [sample(group.tracks.scale, at), sample(group.tracks.y, at)];
  const [left, top] = pointThroughCamera([group.props.x - (bw * s) / 2, y - (bh * s) / 2], cam, ctx.canvas);
  const [right] = pointThroughCamera([group.props.x + (bw * s) / 2, y], cam, ctx.canvas);
  const corner = await pixelAt(session.page, frameAt(at), left + 1.5, top + 1.5);
  assert.ok(dimmed(corner, BOX_COLOUR), `the corner pixel is not the crop: ${corner}`);
  assert.deepEqual(await pixelAt(session.page, frameAt(at), (left + right) / 2, top + 2), BOX_COLOUR, 'the top edge, mid way, is the crop');
});

test('the film reviews with no page error and no mechanical finding, with the lift too', async (t) => {
  const session = await open(t, 'lift.json');
  if (!session) return;
  const findings = await reviewFilm({ session });
  assert.deepEqual(findings.filter((f) => f.kind === 'mechanical').map((f) => `${f.path}: ${f.message}`), []);
  assert.deepEqual(session.errors, []);
});

test('the film reviews with no page error and no mechanical finding', async (t) => {
  const session = await open(t);
  if (!session) return;
  const findings = await reviewFilm({ session });
  assert.deepEqual(findings.filter((f) => f.kind === 'mechanical').map((f) => `${f.path}: ${f.message}`), []);
  assert.deepEqual(session.errors, []);
});
