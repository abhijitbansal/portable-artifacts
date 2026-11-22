// The film-level overlays on the render page (motion-steals W4 Task 6): a logo and a progress bar drawn over the composed
// frame, unbroken across a node cut, a layer cut and a shader cut, never inside a cut's inputs, and left out of the
// snapshot, the stillness key, the poster and the loop check. Pixels are read from the visible canvas (the post pass's
// result) with grain, halftone and bloom at 0. One browser at a time: run with --test-concurrency=1; skips without one.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sessionOrNull } from './helpers/session.mjs';
import { pngOf } from './helpers/png.mjs';
import { readPng } from '../../scripts/v2/png.mjs';
import { frameDifference, loopFindings } from '../../scripts/v2/loop.mjs';
import { writePoster } from '../../scripts/v2/poster.mjs';
import { reviewFilm } from '../../scripts/v2/review.mjs';
import { failureOutcome } from '../../scripts/v2/run.mjs';
import { logoOnlySrc } from '../../scripts/v2/logo-finding.mjs';

const FPS = 30;
const W = 1920;
const H = 1080;
const ZERO = { grain: 0, halftone: 0, bloom: 0 };
const BAR = [214, 58, 47]; // desk's accent2, the bar
const LOGO_COLOUR = [0, 230, 0]; // a pure green logo at desk's opacity 0.9 over a near-black ground
const LOGO_CENTRE = [W - 40 - 28, 40 + 28]; // top-right, margin 40, height 56, a square picture
const BAR_ROW = H - 3; // desk: the bar sits on the bottom edge, 6 high
const GROUND = '#101820';
const GROUND_RGB = [16, 24, 32];
// shot starts at 30 frame intervals; a node cut and a layer cut last 12 frames, a shader cut 18
const BEFORE = 10;
const MID_SLIDE = 36;
const MID_CROSSFADE = 66;
const MID_RIPPLE = 99;
const AFTER = 115;

const flat = (id, background, cut) => ({ id, show: 'free', hold: 1, background, nodes: [], ...(cut ? { cut } : {}) });
const shots = () => [flat('a', GROUND), flat('b', '#182010', { type: 'slide', smear: true }), flat('c', '#201018', 'crossfade'), flat('d', '#101828', 'ripple')];
const filmWith = (extra = {}, shotList = shots()) => ({ version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: shotList, ...extra });
const ON = { logo: { src: 'assets/logo.png' }, progress: true };

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-overlays-browser-'));
  mkdirSync(path.join(dir, 'assets'));
  writeFileSync(path.join(dir, 'assets', 'logo.png'), pngOf(16, 16, () => [0, 255, 0]));
});
after(() => rmSync(dir, { recursive: true, force: true }));

async function open(t, film) {
  const session = await sessionOrNull(film, { specDir: dir });
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  await session.page.evaluate((zero) => window.__setPost(zero), ZERO);
  return session;
}

// The visible canvas after seeking `frame` (options as __seek takes them): `rows` as [y] full rows and `points` as [x, y].
const shown = (s, frame, { points = [], rows = [], options = {} } = {}) => s.page.evaluate(([i, list, lines, opts]) => {
  window.__seek(i, opts);
  const stage = document.getElementById('stage');
  const copy = new OffscreenCanvas(stage.width, stage.height);
  const ctx = copy.getContext('2d');
  ctx.drawImage(stage, 0, 0);
  return {
    points: list.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]),
    rows: lines.map((y) => [...ctx.getImageData(0, y, stage.width, 1).data]),
  };
}, [frame, points, rows, options]);

const close = (a, b, levels) => a.every((v, k) => Math.abs(v - b[k]) <= levels);
// The x where the bar's row stops being the bar colour, counting from the left edge.
const barEdge = async (s, frame) => {
  const { rows: [row] } = await shown(s, frame, { rows: [BAR_ROW] });
  let x = 0;
  while (x < W && close([row[x * 4], row[x * 4 + 1], row[x * 4 + 2]], BAR, 3)) x += 1;
  return x;
};
const frameHash = (s, frame, options = {}) => s.page.evaluate(([i, opts]) => {
  window.__seek(i, opts);
  const { data } = window.__source.getContext('2d').getImageData(0, 0, window.__source.width, window.__source.height);
  let h = 0x811c9dc5;
  for (let k = 0; k < data.length; k += 1) h = Math.imul(h ^ data[k], 0x01000193) >>> 0;
  return h;
}, [frame, options]);

test('the bar and the logo are unbroken across a node cut, a layer cut and a shader cut', async (t) => {
  const s = await open(t, filmWith({ overlays: ON })); if (!s) return;
  const { duration } = s.timeline;
  // with WebGL2 the ripple frame goes through the post pass's shader cut, where the overlay picture is laid over its result
  if (s.info.post === 'webgl2') assert.deepEqual(s.info.cuts.ran, ['ripple']);
  for (const frame of [BEFORE, MID_SLIDE, MID_CROSSFADE, MID_RIPPLE, AFTER]) {
    const edge = await barEdge(s, frame);
    const [x, , w] = (await s.page.evaluate((i) => window.__snapshotOverlays(i), frame)).find((n) => n.id === 'overlay.progress.track').bbox;
    assert.ok(Math.abs(edge - (x + (frame / FPS / duration) * w)) <= 2, `frame ${frame}: the bar ends at ${edge}, expected ${x + (frame / FPS / duration) * w}`);
    const { points: [logo] } = await shown(s, frame, { points: [LOGO_CENTRE] });
    assert.ok(close(logo, LOGO_COLOUR, 10), `logo at frame ${frame}: ${JSON.stringify(logo)}`);
  }
  assert.deepEqual(s.errors, []);
});

test('the overlays are drawn over the composed picture, after the cut, not into its pictures', async (t) => {
  const s = await open(t, filmWith({ overlays: ON })); if (!s) return;
  const plain = await open(t, filmWith());
  // mid-slide the logo is where it is on a still frame, though the shots move: it was drawn after the cut composed them
  const { points: [still] } = await shown(s, BEFORE, { points: [LOGO_CENTRE] });
  const { points: [moving] } = await shown(s, MID_SLIDE, { points: [LOGO_CENTRE] });
  assert.ok(close(moving, still, 10), `${JSON.stringify(moving)} vs ${JSON.stringify(still)}`);
  // and the cut itself draws what it drew without them: the overlay-free film's frame is the one with the overlays off
  for (const frame of [MID_SLIDE, MID_CROSSFADE]) {
    assert.equal(await frameHash(s, frame, { overlays: false }), await frameHash(plain, frame), `frame ${frame}`);
  }
});

test('the stillness key ignores the bar and the capture key does not', async (t) => {
  const s = await open(t, filmWith({ overlays: ON })); if (!s) return;
  const [from, to] = [12, 25];
  assert.ok((await s.page.evaluate(([a, b]) => window.__heldFlags(a, b, false), [from, to])).every(Boolean), 'the film itself holds still');
  assert.ok((await s.page.evaluate(([a, b]) => window.__heldFlags(a, b, true), [from, to])).every((held) => held === false), 'the capture sees the bar move');
});

test('the snapshot holds no overlay node; __snapshotOverlays holds the three, with boxes', async (t) => {
  const s = await open(t, filmWith({ overlays: ON })); if (!s) return;
  const ids = (nodes) => nodes.flatMap((n) => [n.id, ...ids(n.children)]);
  for (const frame of [BEFORE, MID_SLIDE, MID_RIPPLE]) {
    assert.deepEqual(ids(await s.page.evaluate((i) => window.__snapshot(i), frame)).filter((id) => id.startsWith('overlay.')), [], `frame ${frame}`);
  }
  const overlays = await s.page.evaluate((i) => window.__snapshotOverlays(i), BEFORE);
  assert.deepEqual(overlays.map((n) => n.id), ['overlay.logo', 'overlay.progress.track', 'overlay.progress.bar']);
  assert.ok(overlays.every((n) => Array.isArray(n.bbox) && n.bbox.length === 4));
});

test('a poster seek and the loop check draw no overlay', async (t) => {
  const looping = filmWith({ overlays: ON, loop: true }, [flat('a', GROUND), flat('b', GROUND)]);
  const s = await open(t, looping); if (!s) return;
  const last = s.timeline.frameCount - 1;
  // the page draws them by default, so the loop check seeking without them is what keeps the last frame equal to the first
  assert.notEqual(await frameHash(s, last), await frameHash(s, last, { overlays: false }), 'the default seek draws the overlays');
  assert.equal(await frameDifference(s.page, 0, last), 0, 'the first and last frame differ only by the bar, which the loop check leaves out');
  assert.deepEqual(await loopFindings(s), []);
  const { rows: [bare] } = await shown(s, last, { rows: [BAR_ROW], options: { overlays: false } });
  assert.ok(close([bare[400], bare[401], bare[402]], GROUND_RGB, 3), 'with overlays: false the bar row is the ground');
  const file = path.join(dir, 'poster.png');
  await writePoster({ session: s, frame: last, file });
  const picture = readPng(readFileSync(file));
  const at = (x, y) => [0, 1, 2].map((k) => picture.data[(y * picture.width + x) * picture.channels + k]);
  assert.ok(close(at(400, BAR_ROW), GROUND_RGB, 3), 'the poster has no bar');
  assert.ok(close(at(...LOGO_CENTRE), GROUND_RGB, 3), 'the poster has no logo');
});

// The hash (FNV-1a over the RGBA bytes, 1920x1080) of frame 10 of the overlay-free film above, a flat #101820 fill: recorded
// at b41e178, before the page drew overlays, from both window.__source and the visible canvas after the post pass at 0.
const FLAT_FRAME_10_HASH = 517316037;
const shownHash = (s, frame) => s.page.evaluate((i) => {
  window.__seek(i);
  const stage = document.getElementById('stage');
  const copy = new OffscreenCanvas(stage.width, stage.height);
  const ctx = copy.getContext('2d');
  ctx.drawImage(stage, 0, 0);
  const { data } = ctx.getImageData(0, 0, stage.width, stage.height);
  let h = 0x811c9dc5;
  for (let k = 0; k < data.length; k += 1) h = Math.imul(h ^ data[k], 0x01000193) >>> 0;
  return h;
}, frame);

test('a film without overlays draws the frame it drew before overlays existed, before and after the post pass', async (t) => {
  const plain = await open(t, filmWith()); if (!plain) return;
  assert.equal(await frameHash(plain, BEFORE), FLAT_FRAME_10_HASH, 'the 2D frame');
  assert.equal(await shownHash(plain, BEFORE), FLAT_FRAME_10_HASH, 'the visible canvas, post pass included');
});

// Bloom (a halo round pixels above 0.7 luminance) runs over the finished frame, overlays included. White ground and a
// bloom strength of 1 through __setPost: the bar's pixels and the ones beside it must read the same inside a shader cut's
// window as outside it.
test('bloom sees the overlays inside a shader cut: the bar and its halo read as they do outside the window', async (t) => {
  const white = (id, cut) => flat(id, '#ffffff', cut);
  const s = await open(t, filmWith({ overlays: { progress: true } }, [white('a'), white('b', { type: 'slide' }), white('c', 'crossfade'), white('d', 'ripple')])); if (!s) return;
  if (s.info.post !== 'webgl2') return t.skip('this browser has no WebGL2: bloom is not drawn');
  await s.page.evaluate(() => window.__setPost({ bloom: 1 }));
  const column = [BAR_ROW, H - 9, H - 14].map((y) => [100, y]); // on the bar, in its halo, clear of it
  const outside = (await shown(s, 85, { points: column })).points;
  const inside = (await shown(s, MID_RIPPLE, { points: column })).points;
  assert.deepEqual(s.errors, []);
  inside.forEach((px, k) => assert.ok(close(px, outside[k], 2), `${JSON.stringify(column[k])}: ${JSON.stringify(px)} in the window, ${JSON.stringify(outside[k])} outside`));
});

test('a film without overlays makes no overlay canvas and its frames are the frames drawn with them off', async (t) => {
  const plain = await open(t, filmWith()); if (!plain) return;
  for (const frame of [BEFORE, MID_SLIDE, MID_CROSSFADE, MID_RIPPLE]) await plain.page.evaluate((i) => window.__seek(i), frame);
  assert.equal(await plain.page.evaluate(() => window.__overlayCanvases), 0);
  assert.deepEqual(await plain.page.evaluate((i) => window.__snapshotOverlays(i), BEFORE), []);
  const withOverlays = await open(t, filmWith({ overlays: ON }));
  for (const frame of [BEFORE, MID_SLIDE, MID_CROSSFADE]) {
    assert.equal(await frameHash(plain, frame), await frameHash(withOverlays, frame, { overlays: false }), `frame ${frame}`);
  }
  await withOverlays.page.evaluate((i) => window.__seek(i), MID_RIPPLE);
  assert.ok(await withOverlays.page.evaluate(() => window.__overlayCanvases) <= 1, 'at most one picture for the shader cut');
});

test('the same frames in two sessions (--workers 2) are the same pixels', async (t) => {
  const one = await open(t, filmWith({ overlays: ON })); if (!one) return;
  const two = await open(t, filmWith({ overlays: ON }));
  for (const frame of [MID_SLIDE, MID_CROSSFADE, MID_RIPPLE]) {
    const [a, b] = [await shown(one, frame, { rows: [BAR_ROW, 68] }), await shown(two, frame, { rows: [BAR_ROW, 68] })];
    assert.deepEqual(a.rows, b.rows, `frame ${frame}`);
  }
});

// ---- the review (engine/review/overlay.mjs, scripts/v2/review.mjs) ----

const REVIEW_FONT = { family: 'Geist', weight: 600, size: 96 };
const reviewText = (x, text, y = 400) => ({ type: 'text', id: 'words', props: { x, y, text, font: REVIEW_FONT, maxWidth: 3000, fill: '#ffffff' } });
const reviewFilmOf = (extra, node = reviewText(200, 'Clear')) => ({ version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: [{ id: 'f', show: 'free', hold: 3, background: GROUND, nodes: [node] }], ...extra });
const findingsOf = async (t, film) => {
  const s = await open(t, film);
  return s === null ? null : reviewFilm({ session: s });
};

test('a film has the same findings with and without its overlays, when no text meets the logo', async (t) => {
  const withOverlays = await findingsOf(t, reviewFilmOf({ overlays: ON })); if (!withOverlays) return;
  const without = await findingsOf(t, reviewFilmOf({}));
  assert.deepEqual(withOverlays, without);
  assert.deepEqual(withOverlays.filter((f) => f.rule === 'overlay-covers'), []);
});

test('a still shot under a moving progress bar still raises still', async (t) => {
  const bar = { type: 'path', id: 'block', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } };
  const longStill = { version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, overlays: { progress: true }, shots: [{ id: 'long', show: 'free', hold: 8, background: '#f3eee3', nodes: [bar] }, { id: 'end', show: 'free', hold: 1, background: '#f3eee3', nodes: [bar] }] };
  const found = await findingsOf(t, longStill); if (!found) return;
  assert.equal(found.filter((f) => f.rule === 'still').length, 1);
});

test('a landed text under the logo is one overlay-covers finding at overlays.logo, though the shot shows it on every frame', async (t) => {
  const found = await findingsOf(t, reviewFilmOf({ overlays: { logo: { src: 'assets/logo.png' } } }, reviewText(1750, 'Hi', 20))); if (!found) return;
  const covers = found.filter((f) => f.rule === 'overlay-covers');
  assert.equal(covers.length, 1, JSON.stringify(found.map((f) => [f.rule, f.node, f.path])));
  assert.deepEqual([covers[0].kind, covers[0].path, covers[0].shot, covers[0].node], ['creative', 'overlays.logo', 'f', 'words|overlay.logo']);
  const clear = await findingsOf(t, reviewFilmOf({ overlays: { logo: { src: 'assets/logo.png' } } }));
  assert.deepEqual(clear.filter((f) => f.rule === 'overlay-covers'), []);
});

// ---- a logo the browser cannot decode ----

test('a logo with bytes the browser cannot decode stops the page naming the file, and the run reports it at overlays.logo.src', async (t) => {
  writeFileSync(path.join(dir, 'assets', 'broken.png'), 'a .png name, but not a picture');
  const film = filmWith({ overlays: { logo: { src: 'assets/broken.png' } } });
  let thrown = null;
  try {
    const session = await sessionOrNull(film, { specDir: dir });
    if (!session) return t.skip('no browser');
    await session.close();
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown, 'the page started with an undecodable logo');
  assert.match(thrown.message, /image "assets\/broken\.png" could not be loaded/);
  const out = failureOutcome(thrown, undefined, logoOnlySrc(film));
  assert.equal(out.exitCode, 1);
  assert.deepEqual([out.finding.kind, out.finding.path], ['mechanical', 'overlays.logo.src']);
  assert.equal(failureOutcome(thrown, undefined, null).exitCode, 2, 'a picture no logo names stays the machine\'s');
});
