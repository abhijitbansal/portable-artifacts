// A word drawn glyph by glyph (engine/page/draw.mjs drawGlyphs) is, at rest, the word drawn whole: the same pixels, so a
// letter-by-letter entrance ends on the frame the plain film draws. One statement film per look (a page draws one look, so
// each look gets its own session, opened and closed one after another), its last frame hashed from window.__source (the
// picture before the post pass) with the whole-word path, then with window.__setGlyphPath(true), which sends every word of
// every text through drawGlyphs with identity values.
// The words hold what breaks a prefix-advance draw: fi, ff, fl, kerned pairs, an accent, figures. A look outside LETTER_LOOKS
// is only reported (the printed table), never asserted: its face may fold a ligature that glyph by glyph cannot.
// Launched through scripts/lib/browser.mjs, so with --font-render-hinting=none: Linux Chromium rounds glyph advances to a
// whole pixel without it, and the table would differ between this Mac and CI.
// Run with --test-concurrency=1; skips without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/looks/index.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { sessionOrNull, HERE } from './helpers/session.mjs';

const FPS = 30;
const WORDS = "Typography office AVATAR fjord waffle L'été 10,000"; // fi, ff, fl, kerned pairs, an accent, figures
const LETTER_LOOKS = ['poster']; // the looks whose statement takes `letters` in Task 4
// sha256 of the poster statement's last frame (16:9, seed 3, WORDS) with the seam off, taken at the base commit (before this
// task) on darwin. Font rasterisation differs between platforms, so other platforms only print theirs.
const BASE_SOURCE_SHA256 = { darwin: '15ced09e237d9768d67ac49bfd7e1a3580127556053b95945557abc2da262b1d' };

const filmOf = (look) => ({ version: 2, mode: 'pro', look, format: '16:9', fps: FPS, seed: 3, shots: [{ id: 's', show: 'statement', text: WORDS }] });
const lastFrame = (film) => buildTimeline(film, { fps: FPS }).frameCount - 1;

// Frame i drawn again, then the sha256 of the picture before the post pass.
const sourceHash = (page, i) => page.evaluate(async (frame) => {
  await window.__seek(frame);
  const blob = await window.__source.convertToBlob({ type: 'image/png' });
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}, i);

const results = new Map();

for (const look of registries.looks.names()) {
  test(`${look}: a settled statement drawn glyph by glyph is pixel-equal to it drawn whole`, async (t) => {
    const film = filmOf(look);
    const session = await sessionOrNull(film, { specDir: HERE });
    if (!session) return t.skip('no browser');
    try {
      const last = lastFrame(film);
      const whole = await sourceHash(session.page, last);
      await session.page.evaluate(() => window.__setGlyphPath(true));
      const perGlyph = await sourceHash(session.page, last);
      await session.page.evaluate(() => window.__setGlyphPath(false));
      results.set(look, whole === perGlyph);
      assert.deepEqual(session.errors, []);
      if (LETTER_LOOKS.includes(look)) assert.equal(perGlyph, whole);
    } finally {
      await session.close();
    }
  });
}

test('the table of every look is printed, and a look outside LETTER_LOOKS is only reported', (t) => {
  if (results.size === 0) return t.skip('no browser');
  for (const [look, equal] of results) t.diagnostic(`${look}: ${equal ? 'equal' : 'NOT equal'}${LETTER_LOOKS.includes(look) ? ' (asserted)' : ' (reported)'}`);
  for (const look of LETTER_LOOKS) assert.equal(results.get(look), true, `${look} is in LETTER_LOOKS and must be equal`);
});

test('with the seam off nothing changes: the frame equals the frame recorded before this task', async (t) => {
  const film = filmOf('poster');
  const session = await sessionOrNull(film, { specDir: HERE });
  if (!session) return t.skip('no browser');
  try {
    const sha = await sourceHash(session.page, lastFrame(film));
    t.diagnostic(`poster last frame, ${process.platform}: ${sha}`);
    assert.deepEqual(session.errors, []);
    const pinned = BASE_SOURCE_SHA256[process.platform];
    if (pinned === undefined) return t.skip(`no frame recorded for ${process.platform}`);
    assert.equal(sha, pinned);
  } finally {
    await session.close();
  }
});
