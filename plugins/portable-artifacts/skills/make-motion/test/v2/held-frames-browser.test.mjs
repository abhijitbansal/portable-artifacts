// Held frames: a frame the capture key (page's __heldFlags, withGrain) calls held must be pixel-equal to the frame before
// it, because the render reuses that picture instead of capturing again (the PNG screenshot hashed here is what --exact
// captures). A weak key would silently freeze a moving film, so this test also proves its own comparison can fail.
// Pinned elsewhere, not here: forward jumps into worker ranges (test/v2/workers-browser.test.mjs) and, after W3, slices
// (W3 Task 7). Browser tests skip without a browser (PA_REQUIRE_BROWSER=1 makes that a failure). Run with
// --test-concurrency=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { openStage } from './helpers/stage.mjs';

const FPS = 30;
const PALETTE = { paper: '#f3eee3', ink: '#15130f', ink2: '#5b554a', accent: '#ffe14a', accent2: '#d63a2f', rule: '#cfc7b6' };
const STILL_BAR = { type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } };
const MESH = { type: 'field', id: 'f', props: { field: 'mesh', params: {}, w: 1920, h: 1080, unit: 1, seed: 1, palette: PALETTE } };
const still = (id, hold, background, extra = {}) => ({ id, show: 'free', hold, background, nodes: [STILL_BAR], ...extra });

// No look is named, so the default look's grain runs (12 patterns a second): a held frame is held only while the grain
// pattern stays the same too.
const FILMS = {
  still: { version: 2, fps: FPS, shots: [still('still', 2, '#f3eee3')] },
  mesh: { version: 2, fps: FPS, shots: [{ id: 'mesh', show: 'free', hold: 2, background: '#000000', nodes: [MESH] }] },
  fade: { version: 2, fps: FPS, shots: [still('a', 1, '#f3eee3'), still('b', 1, '#101820', { cut: 'crossfade' })] },
};
const FRAMES = { still: 60, mesh: 60, fade: 60 };
const CROSSFADE_FIRST = 30; // the second shot starts at 1 s; the crossfade lasts 0.4 s
const CROSSFADE_LAST = 41;

// Opens `film`, then reads the capture-key flags and the hash of every frame in order, 0 to frames - 1.
async function measure(t, name) {
  const stage = await openStage(FILMS[name]);
  if (stage === null) { t.skip('no browser'); return null; }
  t.after(() => stage.close());
  const frames = FRAMES[name];
  const flags = await stage.page.evaluate(([a, b]) => window.__heldFlags(a, b, true), [0, frames - 1]);
  const hashes = [];
  for (let i = 0; i < frames; i++) hashes.push(await stage.hashFrame(i));
  assert.equal(flags.length, frames);
  return { stage, frames, flags, hashes };
}

const assertHeldFramesEqual = ({ flags, hashes }) => {
  flags.forEach((held, i) => {
    if (held) assert.equal(hashes[i], hashes[i - 1], `frame ${i}`);
  });
};

test('still: every frame the capture key calls held is pixel-equal to the frame before it, and some are held', async (t) => {
  const m = await measure(t, 'still');
  if (m === null) return;
  assert.ok(m.flags.some(Boolean), 'the film has held frames');
  assertHeldFramesEqual(m);
});

test('mesh: a field painted from the time is never held', async (t) => {
  const m = await measure(t, 'mesh');
  if (m === null) return;
  assert.deepEqual(m.flags.slice(1), Array(m.frames - 1).fill(false));
});

test('fade: inside the crossfade window nothing is held; the stills either side are, and each held frame is pixel-equal', async (t) => {
  const m = await measure(t, 'fade');
  if (m === null) return;
  for (let i = CROSSFADE_FIRST; i <= CROSSFADE_LAST; i++) assert.equal(m.flags[i], false, `frame ${i} is inside the crossfade`);
  assert.ok(m.flags.slice(1, CROSSFADE_FIRST).some(Boolean), 'the still before the crossfade has held frames');
  assert.ok(m.flags.slice(CROSSFADE_LAST + 1).some(Boolean), 'the still after the crossfade has held frames');
  assertHeldFramesEqual(m);
});

test('guardrail proof: the 2D key alone calls frames held whose pixels differ, so this comparison can fail', async (t) => {
  const m = await measure(t, 'still');
  if (m === null) return;
  const weak = await m.stage.page.evaluate(([a, b]) => window.__heldFlags(a, b, false), [0, m.frames - 1]);
  const i = weak.findIndex((w, k) => w && !m.flags[k]);
  assert.ok(i > 0, 'the 2D key calls a frame held that the capture key does not');
  assert.notEqual(m.hashes[i], m.hashes[i - 1], `frame ${i}: the grain moved though the 2D state did not`);
});

test('[R2-4] mesh: a frame reached by a jump back is pixel-equal to the same frame reached in order', async (t) => {
  const m = await measure(t, 'mesh');
  if (m === null) return;
  for (const i of [m.frames - 1, 0, 31, 7, 44, 8, 30]) assert.equal(await m.stage.hashFrame(i), m.hashes[i], `frame ${i}`);
  assert.equal(new Set([7, 8, 30, 31, 44].map((i) => m.hashes[i])).size, 5, 'the frames differ, so a stale picture would show');
});
