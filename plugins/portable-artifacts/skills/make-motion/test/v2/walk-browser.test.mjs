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
import { walkPlan } from '../../engine/kinds/walk-time.mjs';
import { walkGeometry } from '../../engine/kinds/walk-layout.mjs';
import { shotContext } from '../../engine/graph/film.mjs';
import { writeSyntheticTake } from './helpers/synthetic-take.mjs';
import { canvasOf, measure } from './helpers/kinds.mjs';

// the synthetic take: 12 frames, names k = floor(f / 3); step open settles on frame 2 (colour 0), tab on frame 7 (colour 2),
// search on frame 11 (colour 3)
const COLOURS = [[200, 30, 30], [30, 200, 30], [30, 30, 200], [200, 200, 30]];
const FILM = { version: 2, mode: 'pro', look: 'keynote', format: '16:9', fps: 30, seed: 3, shots: [
  { id: 'w', show: 'walk', src: 'take', hold: 4, title: 'Shop', steps: [{ id: 'open' }, { id: 'tab' }, { id: 'search' }] },
] };

let dir, ready = false;
before(async () => {
  ready = await browserAvailable();
  dir = mkdtempSync(path.join(tmpdir(), 'mm-walk-b-'));
  writeSyntheticTake(dir);
  writeFileSync(path.join(dir, 'film.json'), JSON.stringify(FILM));
});
after(() => rmSync(dir, { recursive: true, force: true }));

async function open(t) {
  if (!ready) { t.skip('no browser'); return null; }
  const session = await openSession(loadFilm(path.join(dir, 'film.json')));
  t.after(() => session.close());
  return session;
}

// The pixel of the page's pre-post source canvas at frame i, as [r, g, b], at canvas point (x, y).
const pixelAt = (page, i, x, y) => page.evaluate(async ([frame, px, py]) => {
  await window.__seek(frame);
  return [...window.__source.getContext('2d').getImageData(Math.round(px), Math.round(py), 1, 1).data.slice(0, 3)];
}, [i, x, y]);

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
  // the same at the middle of the step's own box, mapped from page px
  const box = loaded.prepared.w.steps[1].box;
  const [bx, by] = geo.mapPoint({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
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

test('the film reviews with no page error and no mechanical finding', async (t) => {
  const session = await open(t);
  if (!session) return;
  const findings = await reviewFilm({ session });
  assert.deepEqual(findings.filter((f) => f.kind === 'mechanical').map((f) => `${f.path}: ${f.message}`), []);
  assert.deepEqual(session.errors, []);
});
