// The page's clip frame cache is bounded by decoded pixels as well as by count: a 3840 x 2160 take played for a minute
// cannot grow it past CACHE_MAX_PIXELS, while a film's own clips at 1080p keep the whole CACHE_MAX window.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClipFrames } from '../../engine/page/clip-frames.mjs';

const realFetch = globalThis.fetch;
const realBitmap = globalThis.createImageBitmap;
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.createImageBitmap = realBitmap;
});

function stubPage(width, height) {
  const closed = new Set();
  globalThis.fetch = async () => ({ ok: true, blob: async () => ({}) });
  let made = 0;
  globalThis.createImageBitmap = async () => {
    const id = made++;
    return { width, height, id, close: () => closed.add(id) };
  };
  return { closed };
}

const clip = (width, height, count = 100) => ({ src: 'take', width, height, from: 0, fps: 30, count });
const stateShowing = (n) => ({ sampled: [{ props: { src: 'take', video: { count: 100 } }, frame: n }] });
const isLoaded = (frames, n) => {
  try {
    frames.frames('take', n);
    return true;
  } catch {
    return false;
  }
};
const loadedCount = (frames, upTo) => Array.from({ length: upTo }, (_, n) => n).filter((n) => isLoaded(frames, n)).length;

test('20 frames of 3840 x 2160 keep at most 12 in the cache, the newest one among them', async () => {
  const { closed } = stubPage(3840, 2160);
  const frames = createClipFrames([clip(3840, 2160)]);
  for (let n = 0; n < 20; n++) await frames.prepare(stateShowing(n));
  assert.ok(loadedCount(frames, 20) <= 12, `${loadedCount(frames, 20)} kept`);
  assert.ok(isLoaded(frames, 19), 'the frame just prepared is kept');
  assert.equal(closed.size, 20 - loadedCount(frames, 20), 'each evicted bitmap is closed');
});

test('48 frames of 1920 x 1080 are all kept', async () => {
  stubPage(1920, 1080);
  const frames = createClipFrames([clip(1920, 1080)]);
  for (let n = 0; n < 48; n++) await frames.prepare(stateShowing(n));
  assert.equal(loadedCount(frames, 48), 48);
});

test('the count cap still holds for small frames', async () => {
  stubPage(64, 64);
  const frames = createClipFrames([clip(64, 64)]);
  for (let n = 0; n < 60; n++) await frames.prepare(stateShowing(n));
  assert.equal(loadedCount(frames, 60), 48);
});

test('a frame the draw is showing is never evicted for pixels', async () => {
  stubPage(3840, 2160);
  const frames = createClipFrames([clip(3840, 2160)]);
  const wide = { sampled: Array.from({ length: 16 }, (_, n) => ({ props: { src: 'take', video: { count: 100 } }, frame: n })) };
  await frames.prepare(wide);
  assert.equal(loadedCount(frames, 16), 16, 'all sixteen are being shown, so all stay');
});
