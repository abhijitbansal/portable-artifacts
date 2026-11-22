// make.mjs <film> --poster <seconds> [--poster-out <file>]: one still of the film's own frame round(seconds * fps), post
// pass included, captions left out, and no MP4. A silent film's poster needs no ffmpeg. Browser tests skip without one.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { openSession } from '../../scripts/v2/session.mjs';
import { readPng } from '../../scripts/v2/png.mjs';
import { posterFrame } from '../../scripts/v2/poster.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const NO_FFMPEG = { FFMPEG_PATH: '/nonexistent/ffmpeg', FFPROBE_PATH: '/nonexistent/ffprobe', PATH: '/nonexistent' };
const make = (args, env = {}) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8', timeout: 120_000, env: { ...process.env, ...env } });
const BAR = (fill) => ({ type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill } });
const FILM = { version: 2, fps: 30, shots: [
  { id: 'a', show: 'free', hold: 1, background: '#f3eee3', nodes: [BAR('#15130f')] },
  { id: 'b', show: 'free', hold: 1, background: '#1f4e8c', cut: 'cut', nodes: [BAR('#ffe14a')] },
] };

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-poster-')); });
after(() => rmSync(dir, { recursive: true, force: true }));
const writeFilm = (name, film) => {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(film));
  return file;
};

test('posterFrame: round(seconds * fps); past the last frame is refused with the film\'s length', () => {
  const timeline = { fps: 30, frameCount: 60, duration: 2 };
  assert.equal(posterFrame(1.5, timeline), 45);
  assert.equal(posterFrame(0, timeline), 0);
  assert.throws(() => posterFrame(40, timeline), /^Error: --poster 40: past the end \(the film is 2\.0 s\)$/);
});

test('a silent film\'s poster needs no ffmpeg: the frame as the film draws it, at the film\'s size, and no MP4', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const film = writeFilm('silent', FILM);
  const out = path.join(dir, 'still.png');
  const run = make([film, '--poster', '1.5', '--poster-out', out, '--json'], NO_FFMPEG);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const report = JSON.parse(run.stdout);
  assert.deepEqual(report.poster, { file: out, frame: 45, seconds: 1.5 });
  assert.equal(report.output, null);
  assert.equal(existsSync(path.join(dir, 'out')), false, 'no MP4 and no sheets');
  const still = readPng(readFileSync(out));
  assert.deepEqual([still.width, still.height], [1920, 1080]);
  const session = await openSession(loadFilm(film));
  try {
    await session.page.evaluate((i) => window.__seek(i), 45);
    const exact = readPng(await session.page.screenshot({ type: 'png' }));
    assert.ok(still.data.equals(exact.data), 'the poster is the film\'s own frame 45');
  } finally {
    await session.close();
  }
  return undefined;
});

test('the default poster is poster.jpg beside where the MP4 would go', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const run = make([writeFilm('default', FILM), '--poster', '0', '--json'], NO_FFMPEG);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const file = path.join(dir, 'out', 'poster.jpg');
  assert.equal(JSON.parse(run.stdout).poster.file, file);
  assert.deepEqual([...readFileSync(file).subarray(0, 3)], [0xff, 0xd8, 0xff], 'a JPEG');
  return undefined;
});

test('a poster at film time: a shot id is its first frame, shot@end-<s> is inside that shot', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const film = writeFilm('film-time', FILM);
  const shot = JSON.parse(make([film, '--poster', 'b', '--poster-out', path.join(dir, 'b.png'), '--json'], NO_FFMPEG).stdout);
  assert.deepEqual(shot.poster, { file: path.join(dir, 'b.png'), frame: 30, seconds: 1 });
  const inside = JSON.parse(make([film, '--poster', 'b@end-0.5', '--poster-out', path.join(dir, 'b-end.png'), '--json'], NO_FFMPEG).stdout);
  assert.deepEqual(inside.poster, { file: path.join(dir, 'b-end.png'), frame: 45, seconds: 1.5 });
  const last = JSON.parse(make([film, '--poster', 'end', '--poster-out', path.join(dir, 'last.png'), '--json'], NO_FFMPEG).stdout);
  assert.equal(last.poster.frame, 59, 'the film\'s end is its last frame (60 frames)');
  const aEnd = JSON.parse(make([film, '--poster', 'a@end', '--poster-out', path.join(dir, 'a-end.png'), '--json'], NO_FFMPEG).stdout);
  assert.equal(aEnd.poster.frame, 29, 'a@end is a\'s last frame, not b\'s first');
  return undefined;
});

// W4 task 2: the poster is read as a thumbnail (engine/review/poster.mjs), by the layout the page reports.
const headline = (size) => ({ type: 'text', id: 'headline', props: { x: 300, y: 400, text: 'Plain words', font: { family: 'Geist', weight: 600, size }, maxWidth: 1400, fill: '#15130f' } });
const textFilm = (size) => ({ version: 2, fps: 30, shots: [{ id: 'a', show: 'free', hold: 1, background: '#f3eee3', nodes: [headline(size)] }] });

test('a poster whose biggest line is small is a creative finding, and the exit code stays 0', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const run = make([writeFilm('small-poster', textFilm(40)), '--poster', '0.5', '--poster-out', path.join(dir, 'small.png'), '--json'], NO_FFMPEG);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const report = JSON.parse(run.stdout);
  const found = report.findings.filter((f) => f.rule === 'poster-read');
  assert.equal(found.length, 1, run.stdout);
  assert.equal(found[0].kind, 'creative');
  assert.equal(found[0].shot, 'a');
  assert.equal(found[0].path, 'shots[0]');
  assert.deepEqual(found[0].suggest, { minSize: 84, factor: 2.1 });
  assert.match(found[0].message, /is 6\.7 px tall on a 180 px thumbnail; it needs 14 px \(84 units\).*"headline"/);
  assert.equal(report.ok, true, 'a creative finding does not fail the run');
  return undefined;
});

test('a poster whose biggest line reads at thumbnail size has no poster-read finding', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const run = make([writeFilm('big-poster', textFilm(120)), '--poster', '0.5', '--poster-out', path.join(dir, 'big.png'), '--json'], NO_FFMPEG);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).findings.filter((f) => f.rule === 'poster-read'), []);
  return undefined;
});

test('a poster with no text is a picture poster: not judged', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const run = make([writeFilm('picture-poster', FILM), '--poster', '0.5', '--poster-out', path.join(dir, 'pic.png'), '--json'], NO_FFMPEG);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.deepEqual(JSON.parse(run.stdout).findings.filter((f) => f.rule === 'poster-read'), []);
  return undefined;
});

test('a time past the end is exit 2 with the film\'s length', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const run = make([writeFilm('past', FILM), '--poster', '40'], NO_FFMPEG);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /--poster 40: past the end \(the film is 2\.0 s\)/);
  return undefined;
});

test('refused pairs and a wrong --poster-out extension are usage errors', () => {
  for (const extra of [['--out', 'x.mp4'], ['--no-render'], ['--sheets-only'], ['--outline'], ['--batch', 'rows.json']]) {
    assert.equal(make(['f.json', '--poster', '1', ...extra]).status, 2, extra.join(' '));
  }
  assert.equal(make(['f.json', '--poster-out', 'p.jpg']).status, 2);
  assert.match(make(['f.json', '--poster', '1', '--poster-out', 'p.gif']).stderr, /\.jpg, \.jpeg, \.png/);
  // film time is read once the film's timeline exists (film-time.mjs): a word that names nothing is refused there, with the list
  const soon = make([writeFilm('soon', FILM), '--poster', 'soon']);
  assert.equal(soon.status, 2);
  assert.match(soon.stderr, /the shots are: a, b/);
});

test('a captioned film\'s poster has no caption ink; the rest of the frame is the film\'s', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  // a narrated free shot: its kind shows no words of its own, so the film's captions (desk: a card low on the grid) say them
  const shot = { id: 'a', show: 'free', say: 'Every chart on this page shows where its number came from.', background: '#f3eee3', nodes: [BAR('#15130f')] };
  const captioned = writeFilm('captioned', { version: 2, fps: 30, captions: true, shots: [shot] });
  const plain = writeFilm('plain', { version: 2, fps: 30, captions: false, shots: [shot] });
  const out = path.join(dir, 'captioned.png');
  const run = make([captioned, '--poster', '1', '--poster-out', out, '--json'], NO_FFMPEG);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const still = readPng(readFileSync(out));
  const frameOf = async (file, options) => {
    const session = await openSession(loadFilm(file));
    try {
      await session.page.evaluate(([i, o]) => window.__seek(i, o), [30, options]);
      return readPng(await session.page.screenshot({ type: 'png' }));
    } finally {
      await session.close();
    }
  };
  const withCaptions = await frameOf(captioned, {});
  const withoutCaptions = await frameOf(plain, {});
  assert.ok(!withCaptions.data.equals(withoutCaptions.data), 'the film\'s own frame 30 shows its captions');
  assert.ok(still.data.equals(withoutCaptions.data), 'the poster is the frame with the captions left out, the rest as the film draws it');
  return undefined;
});
