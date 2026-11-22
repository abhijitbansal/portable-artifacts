// A live outgoing shot (motion-steals W2 Task 8), in the page: inside a layer cut's window the outgoing picture is drawn
// again each frame, at the film second it has reached. Two `free` shots in the ledger look (its post pass has no grain,
// so two frames differ only where the picture does): the first is the mesh field (painted from the time), the second a flat
// colour arriving by a wipe from the left, which leaves the outgoing picture untouched where its edge has not reached.
// One browser at a time: run with --test-concurrency=1; skips without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
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

test('a film with no layer or shader cut still makes no second picture', async (t) => {
  const plain = await open(t, film('slide')); if (!plain) return;
  for (const i of [START, START + 6, START + WINDOW - 1]) await plain.page.evaluate((f) => window.__seek(f), i);
  assert.equal(await plain.page.evaluate(() => window.__cutCanvases()), 0);
});
