// A picture the browser cannot decode is the film's file, so the run reports a mechanical finding at the path that names it
// (shots[i].<field>, overlays.logo.src), as a picture that is missing or outside the folder already is (exit 1); a load the
// server failed (HTTP <n>) is the machine's (exit 2). Pure: errors as Playwright raises them, films in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../../engine/kinds/index.mjs';
import { pictureLoadFinding, logoThrowFinding, normalSrc } from '../../scripts/v2/picture-finding.mjs';
import { failureOutcome } from '../../scripts/v2/run.mjs';
import { startV2Server } from '../../scripts/v2/server.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { tmpdir } from 'node:os';

const loadError = (src, why = 'The source image could not be decoded.') => new Error(`page.evaluate: Error: image "${src}" could not be loaded: ${why}\n    at eval (<anonymous>:1:1)`);
const FILM = {
  version: 2,
  overlays: { logo: { src: 'assets/logo.png' } },
  shots: [
    { id: 'a', show: 'statement', say: 'No pictures here.' },
    { id: 'b', show: 'media', src: 'assets/photo.png', hold: 2 },
    { id: 'c', show: 'free', hold: 1, srcs: ['assets/one.png', 'assets/two.png'] },
    { id: 'd', show: 'compare', left: { src: 'assets/left.png' }, right: { src: 'assets/right.png' } },
  ],
};

test('an undecodable shot picture is one mechanical finding at the field that names it', () => {
  const found = pictureLoadFinding(loadError('assets/photo.png'), FILM);
  assert.deepEqual([found.kind, found.shot, found.path], ['mechanical', null, 'shots[1].src']);
  assert.equal(found.message, 'the picture "assets/photo.png" could not be loaded (The source image could not be decoded); replace it with a PNG, JPEG, WebP or GIF picture');
});

test('an array field names the picture by its index, and a dotted field by its path', () => {
  assert.equal(pictureLoadFinding(loadError('assets/two.png'), FILM).path, 'shots[2].srcs[1]');
  assert.equal(pictureLoadFinding(loadError('assets/right.png'), FILM).path, 'shots[3].right.src');
});

test('an undecodable logo is a finding at overlays.logo.src', () => {
  assert.equal(pictureLoadFinding(loadError('assets/logo.png'), FILM).path, 'overlays.logo.src');
});

test('a file a shot and the logo both name is the shot\'s, as the server lists it', () => {
  const both = { ...FILM, overlays: { logo: { src: 'assets/photo.png' } } };
  assert.equal(pictureLoadFinding(loadError('assets/photo.png'), both).path, 'shots[1].src');
});

test('paths are compared normalised: ./assets/logo.png is assets/logo.png, whichever spelling the page names', () => {
  assert.equal(normalSrc('./assets/logo.png'), 'assets/logo.png');
  assert.equal(normalSrc('assets/../assets/logo.png'), 'assets/logo.png');
  const dotted = { ...FILM, overlays: { logo: { src: './assets/logo.png' } } };
  assert.equal(pictureLoadFinding(loadError('./assets/logo.png'), dotted).path, 'overlays.logo.src');
  assert.equal(pictureLoadFinding(loadError('assets/logo.png'), dotted).path, 'overlays.logo.src', 'the other spelling of the same file');
  const shotFirst = { ...FILM, overlays: { logo: { src: './assets/photo.png' } } };
  assert.equal(pictureLoadFinding(loadError('./assets/photo.png'), shotFirst).path, 'shots[1].src', 'the same file as a shot\'s picture is the shot\'s');
});

test('a load the server failed (HTTP <n>), any other error, an unnamed picture and no film are not a picture finding', () => {
  assert.equal(pictureLoadFinding(loadError('assets/photo.png', 'HTTP 500'), FILM), null);
  assert.equal(pictureLoadFinding(loadError('assets/photo.png', 'HTTP 404'), FILM), null);
  assert.equal(pictureLoadFinding(new Error('page.evaluate: Target crashed '), FILM), null);
  assert.equal(pictureLoadFinding(loadError('assets/unlisted.png'), FILM), null);
  assert.equal(pictureLoadFinding(loadError('assets/photo.png'), null), null);
});

test('failureOutcome: an undecodable shot picture or logo is exit 1 with the finding; a failed load is exit 2', () => {
  const shot = failureOutcome(loadError('assets/photo.png'), undefined, FILM);
  assert.equal(shot.exitCode, 1);
  assert.equal(shot.error, undefined);
  assert.equal(shot.finding.path, 'shots[1].src');
  assert.equal(failureOutcome(loadError('assets/logo.png'), undefined, FILM).finding.path, 'overlays.logo.src');
  const server = failureOutcome(loadError('assets/photo.png', 'HTTP 500'), undefined, FILM);
  assert.equal(server.exitCode, 2);
  assert.equal(server.finding, undefined);
  assert.match(server.error.message, /^image "assets\/photo\.png" could not be loaded: HTTP 500/);
  assert.notEqual(server.error.hint, '');
});

test('a logo with no size reports at overlays.logo.src, not at the page', () => {
  const thrown = new Error('page.evaluate: Error: overlays.logo.src: the picture "assets/logo.png" has no size (0 by 0); it could not be decoded\n    at eval (<anonymous>:1:1)');
  const out = failureOutcome(thrown, undefined, FILM);
  assert.equal(out.exitCode, 1);
  assert.deepEqual([out.finding.kind, out.finding.path], ['mechanical', 'overlays.logo.src']);
  assert.match(out.finding.message, /^the picture "assets\/logo\.png" has no size \(0 by 0\); it could not be decoded$/);
});

test('the page\'s internal "no loaded picture" throw is not blamed on the logo file: no finding at overlays.logo.src', () => {
  const internal = 'overlays.logo.src: no loaded picture for "assets/logo.png"';
  assert.equal(logoThrowFinding(internal), null);
  assert.notEqual(logoThrowFinding('overlays.logo.src: the picture "a.png" has no size (0 by 0); it could not be decoded'), null);
  const thrown = new Error(`page.evaluate: Error: ${internal}\n    at eval (<anonymous>:1:1)`);
  const out = failureOutcome(thrown, undefined, FILM);
  // the asset list and the film disagree: the machine's trouble (exit 2, an error), not a finding on the film
  assert.equal(out.exitCode, 2);
  assert.equal(out.finding, undefined);
  assert.match(out.error.message, /no loaded picture/);
});

test('a logo that pushes a film past 64 images is named in the error: it counts', async () => {
  const shots = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, show: 'media', src: `assets/missing-${i}.png`, hold: 1 }));
  const serve = (film) => startV2Server({ film, timeline: buildTimeline(film, { fps: 30 }), specDir: tmpdir() });
  const withLogo = { version: 2, fps: 30, overlays: { logo: { src: 'assets/logo.png' } }, shots: shots(64) };
  await assert.rejects(() => serve(withLogo), /a film may use at most 64 images; this one names 65 \(the logo counts as one\)/);
  await assert.rejects(() => serve({ version: 2, fps: 30, shots: shots(65) }), (err) => /this one names 65$/.test(err.message));
});

test('the message that lists the picture types names GIF, which a film accepts', () => {
  assert.match(pictureLoadFinding(loadError('assets/photo.png'), FILM).message, /replace it with a PNG, JPEG, WebP or GIF picture$/);
});
