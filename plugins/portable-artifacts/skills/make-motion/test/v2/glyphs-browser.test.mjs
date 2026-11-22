// A word drawn glyph by glyph (engine/page/glyph-draw.mjs) is, at rest, the word drawn whole: the same picture, so a
// letter-by-letter entrance ends on the frame the plain film draws. One statement film per look and word set (a page draws
// one look, so each gets its own session, opened and closed one after another), its last frame read from window.__source
// (the picture before the post pass) with the whole-word path, then with window.__setGlyphPath(true), which sends every word
// of every text through the glyph path with identity values. "The same picture" is no channel differing by more than
// SAME_PICTURE (8 of 255): a glyph drawn alone sits a float's hair off the whole run's place, and above about 256 px, where
// the browser draws glyphs as paths, that moves a handful of edge pixels by a few levels (4 measured). A ligature, a kern or
// a mark that moves a glyph changes pixels by 100 or more.
// A word the glyph path cannot draw faithfully (a ligature or contextual form, a right-to-left word) is drawn whole even
// then, so it is the same by being drawn whole. The word sets hold each case: plain (kerned pairs, figures, a
// precomposed accent), ligatures (fi, ff, fl, ffi, ffl), marks (a decomposed accent, e + U+0301) and rtl (Hebrew, Arabic).
// A look outside LETTER_LOOKS (a look added later) is only reported, never asserted.
// Launched through scripts/lib/browser.mjs, so with --font-render-hinting=none: Linux Chromium rounds glyph advances to a
// whole pixel without it, and the table would differ between this Mac and CI.
// Run with --test-concurrency=1; skips without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/looks/index.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { SAME_PICTURE } from '../../engine/page/glyph-draw.mjs';
import { sessionOrNull, HERE } from './helpers/session.mjs';

const FPS = 30;
const WORDS = "Typography office AVATAR fjord waffle L'été 10,000"; // fi, ff, fl, kerned pairs, an accent, figures
const WORD_SETS = Object.freeze({
  plain: "Typography AVATAR fjord L'été 10,000",
  ligatures: 'office waffle fi fl ff',
  marks: 'café naïve',
  rtl: 'שלום עולם مرحبا',
  mixed: WORDS,
});
// The looks the test asserts: every look measured equal on every word set (a word the glyph path cannot draw faithfully is
// drawn whole, so a look's face cannot break it), and sending at least one word of the plain set through the glyph path, so a
// check that rejected every word cannot pass. marker is not in it: its script face has contextual forms, so the check sends
// most of its words to the whole-word draw (measured: 3 of 5 plain words, 5 of 5 ligature words), and a letters entrance would
// run some words letter by letter and the rest as one block; Task 4 gives marker `letters: null`. It stays in the table,
// reported.
const LETTER_LOOKS = ['desk', 'pop', 'cosmos', 'ledger', 'poster', 'keynote'];
// sha256 of the poster statement's last frame (16:9, seed 3, WORDS) with the seam off, taken at the base commit (before this
// task) on darwin. Font rasterisation differs between platforms, so other platforms only print theirs.
const BASE_SOURCE_SHA256 = { darwin: '15ced09e237d9768d67ac49bfd7e1a3580127556053b95945557abc2da262b1d' };

const filmOf = (look, text) => ({ version: 2, mode: 'pro', look, format: '16:9', fps: FPS, seed: 3, shots: [{ id: 's', show: 'statement', text }] });
const lastFrame = (film) => buildTimeline(film, { fps: FPS }).frameCount - 1;

// Frame i drawn again, then the sha256 of the picture before the post pass.
const sourceHash = (page, i) => page.evaluate(async (frame) => {
  await window.__seek(frame);
  const blob = await window.__source.convertToBlob({ type: 'image/png' });
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}, i);

// Frame i drawn whole, then with window.__setGlyphPath(true, values), compared channel by channel (before the post pass):
// the largest difference of one channel, how many channels differ at all, and what the forced draw sent each way.
const compareFrames = (page, i, values) => page.evaluate(async ({ frame, forced }) => {
  const grab = async () => { await window.__seek(frame); const c = window.__source; return c.getContext('2d').getImageData(0, 0, c.width, c.height).data; };
  const whole = await grab();
  window.__setGlyphPath(true, forced);
  const parts = await grab();
  const stats = window.__glyphStats();
  window.__setGlyphPath(false);
  let max = 0, differing = 0;
  for (let k = 0; k < whole.length; k++) { const d = Math.abs(whole[k] - parts[k]); if (d > 0) differing += 1; if (d > max) max = d; }
  return { max, differing, stats };
}, { frame: i, forced: values });

const results = new Map(); // `${look} / ${set}` -> { max, differing }
const counts = new Map(); // `${look} / ${set}` -> { glyph, rejected }: the words the forced draw sent each way

for (const look of registries.looks.names()) {
  for (const [set, text] of Object.entries(WORD_SETS)) {
    test(`${look} / ${set}: a settled statement drawn glyph by glyph is the same picture as it drawn whole`, async (t) => {
      const film = filmOf(look, text);
      const session = await sessionOrNull(film, { specDir: HERE });
      if (!session) return t.skip('no browser');
      try {
        const { max, differing, stats } = await compareFrames(session.page, lastFrame(film));
        results.set(`${look} / ${set}`, { max, differing });
        counts.set(`${look} / ${set}`, stats);
        assert.deepEqual(session.errors, []);
        if (LETTER_LOOKS.includes(look)) assert.ok(max <= SAME_PICTURE, `no channel differs by more than ${SAME_PICTURE} (it differs by ${max}, on ${differing} channels)`);
        if (LETTER_LOOKS.includes(look) && set === 'plain') assert.ok(stats.glyph >= 1, `${look}: no plain word took the glyph path (${stats.glyph} did, ${stats.rejected} were drawn whole)`);
      } finally {
        await session.close();
      }
    });
  }
}

test('the table of every look and word set is printed, and a look outside LETTER_LOOKS is only reported', (t) => {
  if (results.size === 0) return t.skip('no browser');
  for (const look of registries.looks.names()) {
    const cells = Object.keys(WORD_SETS).map((set) => {
      const { glyph, rejected } = counts.get(`${look} / ${set}`);
      const { max, differing } = results.get(`${look} / ${set}`);
      const verdict = max === 0 ? 'identical' : max <= SAME_PICTURE ? 'same (max ' + max + ', ' + differing + ' channels)' : 'DIFFERENT (max ' + max + ')';
      return set + ' ' + verdict + ' (' + glyph + ' by glyph, ' + rejected + ' whole)';
    });
    t.diagnostic(`${look}${LETTER_LOOKS.includes(look) ? ' (asserted)' : ' (reported)'}: ${cells.join(', ')}`);
  }
  for (const look of LETTER_LOOKS) {
    for (const set of Object.keys(WORD_SETS)) assert.ok(results.get(`${look} / ${set}`).max <= SAME_PICTURE, `${look} / ${set} is asserted and must be the same picture`);
  }
});

// The ink in the statement's text box on the last frame (before the post pass): how many pixels differ from the corner's.
const inkIn = (page, last) => page.evaluate(async (frame) => {
  await window.__seek(frame);
  const text = (function find(nodes) { for (const n of nodes) { if (n.id === 's.text') return n; const hit = find(n.children); if (hit) return hit; } return null; })(window.__snapshot(frame));
  const [x, y, w, h] = text.bbox.map((v, k) => (k < 2 ? Math.floor(v) : Math.ceil(v)));
  const { data } = window.__source.getContext('2d').getImageData(x, y, w, h);
  let ink = 0;
  for (let i = 4; i < data.length; i += 4) if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) ink += 1;
  return ink;
}, last);

// A word the check sends to the whole-word draw (a right-to-left one: it never takes the glyph path) still arrives with its letters: with every glyph at opacity 0 it is not on
// screen (it would stand there from frame 0 if the whole-word draw ignored the glyph values), and at the identity it is.
for (const [look, text, rejected] of [['poster', 'שלום', true], ['poster', 'AVATAR', false]]) {
  test(`${look}: "${text}" ${rejected ? 'is drawn whole by the check and' : 'goes through the glyph path and'} is invisible while its glyphs are at opacity 0`, async (t) => {
    const film = filmOf(look, text);
    const session = await sessionOrNull(film, { specDir: HERE });
    if (!session) return t.skip('no browser');
    try {
      const last = lastFrame(film);
      await session.page.evaluate(() => window.__setGlyphPath(true, { opacity: 0 }));
      const hidden = await inkIn(session.page, last);
      const stats = await session.page.evaluate(() => window.__glyphStats());
      await session.page.evaluate(() => window.__setGlyphPath(false));
      assert.equal(hidden, 0, 'no pixel of the word is drawn');
      if (rejected) assert.ok(stats.rejected >= 1 && stats.glyph === 0, `the check rejected the word (${JSON.stringify(stats)})`);
      else assert.ok(stats.glyph >= 1, `the word took the glyph path (${JSON.stringify(stats)})`);
      assert.ok(await inkIn(session.page, last) > 0, 'with the seam off the word is drawn');
      assert.deepEqual(session.errors, []);
    } finally {
      await session.close();
    }
  });
}

test('with the seam off nothing changes: the frame equals the frame recorded before this task', async (t) => {
  const film = filmOf('poster', WORDS);
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
