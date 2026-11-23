// A live outgoing shot (motion-steals W2 Task 8), in the page: inside a layer cut's window the outgoing picture is drawn
// again each frame, at the film second it has reached. Two `free` shots in the ledger look (its post pass has no grain,
// so two frames differ only where the picture does): the first is the mesh field (painted from the time), the second a flat
// colour arriving by a wipe from the left, which leaves the outgoing picture untouched where its edge has not reached.
// One browser at a time: run with --test-concurrency=1; skips without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds and cuts
import { registries } from '../../engine/registry.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { openStage } from './helpers/stage.mjs';

const FPS = 30;
const START = 30; // shot b's first frame: shot a holds 1 s
const WINDOW = 12; // a 0.4 s window at 30 fps
const EARLY = START + 1; // p 0.08
const LATE = START + 5; // p 0.42
const UNTOUCHED_FROM = 0.7; // a wipe from the left, at these frames, has not reached the right 30%
const ZERO = { grain: 0, halftone: 0, bloom: 0 };
const PALETTE = { paper: '#f3eee3', accent: '#ffe14a', accent2: '#d63a2f', ink: '#15130f', ink2: '#5b554a', rule: '#cfc7b6' };
const MESH = { type: 'field', id: 'mesh', props: { field: 'mesh', params: {}, w: 1920, h: 1080, unit: 1, seed: 1, palette: PALETTE } };

const flat = (id, background, cut, nodes = []) => ({ id, show: 'free', hold: 1, background, nodes, ...(cut ? { cut } : {}) });
const film = (cut, first = [MESH]) => ({ version: 2, mode: 'pro', look: 'ledger', fps: FPS, seed: 1, shots: [flat('a', '#f3eee3', undefined, first), flat('b', '#0000ff', cut)] });
const wipe = { type: 'wipe', direction: 'right' };

async function open(t, f) {
  const stage = await openStage(f);
  if (!stage) { t.skip('no browser'); return null; }
  t.after(() => stage.close());
  await stage.page.evaluate((zero) => window.__setPost(zero), ZERO);
  return stage;
}

// A hash (FNV-1a) of the pixels of window.__source with x >= from * width, after seeking `frame`.
const cropHash = (s, frame, from = UNTOUCHED_FROM) => s.page.evaluate(([i, share]) => {
  window.__seek(i);
  const { width, height } = window.__source;
  const x0 = Math.floor(share * width);
  const { data } = window.__source.getContext('2d').getImageData(x0, 0, width - x0, height);
  let h = 0x811c9dc5;
  for (let k = 0; k < data.length; k += 1) h = Math.imul(h ^ data[k], 0x01000193) >>> 0;
  return h;
}, [frame, from]);

// A hash of the whole 2D frame after seeking `frame`.
const frameHash = (s, frame) => cropHash(s, frame, 0);

test('the outgoing picture moves inside the window: the right 30% of the frame, which a wipe from the left has not reached, differs between p 0.1 and p 0.4', async (t) => {
  const s = await open(t, film(wipe)); if (!s) return;
  assert.notEqual(await cropHash(s, EARLY), await cropHash(s, LATE));
  assert.deepEqual(s.errors, []);
});

test('the same crop at one frame, read twice, is equal', async (t) => {
  const s = await open(t, film(wipe)); if (!s) return;
  const first = await cropHash(s, LATE);
  await cropHash(s, EARLY);
  assert.equal(await cropHash(s, LATE), first);
});

test('seek order: the window\'s frames read forwards, then backwards, then backwards in a fresh page, hash the same', async (t) => {
  const s = await open(t, film(wipe)); if (!s) return;
  const frames = Array.from({ length: WINDOW }, (_, k) => START + k);
  const forwards = [];
  for (const i of frames) forwards.push(await frameHash(s, i));
  const backwards = [];
  for (const i of [...frames].reverse()) backwards.unshift(await frameHash(s, i));
  assert.deepEqual(backwards, forwards);
  await frameHash(s, 50);
  assert.equal(await frameHash(s, START + 5), forwards[5], 'after a seek outside the window');
  await s.close();
  // a fresh page draws the window's last frame first: the outgoing picture must not depend on what was drawn before
  const fresh = await open(t, film(wipe));
  const reversed = [];
  for (const i of [...frames].reverse()) reversed.unshift(await frameHash(fresh, i));
  assert.deepEqual(reversed, forwards);
});

test('held frames: a window with a live outgoing shot is not held, even when the incoming shot stands still', async (t) => {
  const s = await open(t, film(wipe)); if (!s) return;
  const flags = await s.page.evaluate(([a, b]) => window.__heldFlags(a, b, true), [START + 1, START + WINDOW - 1]);
  assert.deepEqual(flags, Array(WINDOW - 1).fill(false));
});

// The colour flood (Task 10), in desk (accent #ffe14a): two flat still shots, red then blue, the second arriving by a flood.
const FLOOD_WINDOW = 15; // 0.5 s at 30 fps
const ACCENT = [0xff, 0xe1, 0x4a];
const LEVELS = 2;
const INSET = 20;
const floodFilm = () => ({ version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: [flat('a', '#ff0000', undefined), flat('b', '#0000ff', 'flood')] });

// The pixels of window.__source at the centre and INSET px inside each corner, after seeking `frame` (at `progress` of its cut).
const samples = (s, frame, progress) => s.page.evaluate(([i, p, inset]) => {
  window.__seek(i, p === undefined ? {} : { progress: p });
  const { width, height } = window.__source;
  const ctx = window.__source.getContext('2d');
  const at = [[width / 2, height / 2], [inset, inset], [width - inset, inset], [inset, height - inset], [width - inset, height - inset]];
  return at.map(([x, y]) => [...ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data].slice(0, 3));
}, [frame, progress, INSET]);

test('flood: the middle of the window is the look\'s accent at the centre and near each corner', async (t) => {
  const s = await open(t, floodFilm()); if (!s) return;
  for (const pixel of await samples(s, START + 7, 0.5)) {
    pixel.forEach((level, k) => assert.ok(Math.abs(level - ACCENT[k]) <= LEVELS, `${pixel} is not ${ACCENT}`));
  }
  assert.deepEqual(s.errors, []);
});

test('flood: the window\'s first frame is the outgoing still and the frame after it the incoming one', async (t) => {
  const s = await open(t, floodFilm()); if (!s) return;
  const outgoing = await frameHash(s, START - 1);
  assert.equal(await frameHash(s, START), outgoing);
  const incoming = await frameHash(s, START + FLOOD_WINDOW);
  assert.notEqual(incoming, outgoing);
  assert.equal(await frameHash(s, START + FLOOD_WINDOW + 5), incoming);
  assert.notEqual(await frameHash(s, START + 3), outgoing, 'inside the window the frame is neither');
});

test('flood seek order: the window\'s frames read forwards, then backwards, then backwards in a fresh page, hash the same', async (t) => {
  const s = await open(t, floodFilm()); if (!s) return;
  const frames = Array.from({ length: FLOOD_WINDOW }, (_, k) => START + k);
  const forwards = [];
  for (const i of frames) forwards.push(await frameHash(s, i));
  assert.equal(new Set(forwards).size > FLOOD_WINDOW / 2, true, 'the window\'s frames are not all one picture');
  const backwards = [];
  for (const i of [...frames].reverse()) backwards.unshift(await frameHash(s, i));
  assert.deepEqual(backwards, forwards);
  await s.close();
  const fresh = await open(t, floodFilm());
  const reversed = [];
  for (const i of [...frames].reverse()) reversed.unshift(await frameHash(fresh, i));
  assert.deepEqual(reversed, forwards);
});

// A flood never paints the colour of a ground it covers: poster's red is also one of its grounds. Five statements in
// poster (seed 1, 9:16) sit on blue, paper, black, red, blue; each cut is a flood.
const POSTER_SHOTS = ['One.', 'Two.', 'Three.', 'Four.', 'Five.'].map((say, i) => ({ id: `s${i}`, show: 'statement', say, ...(i > 0 ? { cut: 'flood' } : {}) }));
const posterFilm = () => ({ version: 2, mode: 'viral', look: 'poster', format: '9:16', fps: FPS, seed: 1, shots: POSTER_SHOTS });
const startOf = (index) => Math.round(buildTimeline(posterFilm(), { fps: FPS }).shots[index].start * FPS);
const rgbOf = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
const poster = () => registries.looks.get('poster').palette;

test('flood in poster: out of the red ground it is the ink, into the red ground the paper, and the key says which', async (t) => {
  const s = await open(t, posterFilm()); if (!s) return;
  const red = poster().accent;
  const cases = [[3, poster().paper, 'into red from black'], [4, poster().ink, 'out of red into blue']]; // [boundary, colour]
  for (const [boundary, colour, why] of cases) {
    const frame = startOf(boundary) + 3;
    for (const pixel of await samples(s, frame, 0.5)) {
      rgbOf(colour).forEach((level, k) => assert.ok(Math.abs(level - pixel[k]) <= LEVELS, `${why}: ${pixel} is not ${colour}`));
      assert.notDeepEqual(pixel.map((level, k) => Math.abs(level - rgbOf(red)[k]) <= LEVELS), [true, true, true], `${why}: red over red`);
    }
    assert.match(await s.page.evaluate((i) => window.__stateKey(i), frame), new RegExp(`\\|flood:${colour}`), why);
  }
  assert.deepEqual(s.errors, []);
});

test('a window that is not a flood has no flood in its key', async (t) => {
  const s = await open(t, film(wipe)); if (!s) return;
  assert.doesNotMatch(await s.page.evaluate((i) => window.__stateKey(i), START + 3), /flood/);
});

test('a film with no layer or shader cut still makes no second picture', async (t) => {
  const plain = await open(t, film('slide')); if (!plain) return;
  for (const i of [START, START + 6, START + WINDOW - 1]) await plain.page.evaluate((f) => window.__seek(f), i);
  assert.equal(await plain.page.evaluate(() => window.__cutCanvases()), 0);
});
