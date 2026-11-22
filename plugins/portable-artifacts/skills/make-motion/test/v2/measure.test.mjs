// The reference measure (scripts/measure.mjs, scripts/lib/measure.mjs): one local video file read through ffmpeg's scdet
// and ebur128 behind the clip probe's whitelists, every value labelled measured or guessed. Tests that need ffmpeg skip
// without it, unless PA_REQUIRE_BROWSER=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { FAST_SHOT_SECONDS, SCENE_THRESHOLD, measureReport, parseScdet, shotStats } from '../../scripts/lib/measure.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEASURE = path.resolve(HERE, '../../scripts/measure.mjs');
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;
if (!hasFfmpeg && process.env.PA_REQUIRE_BROWSER === '1') throw new Error('ffmpeg and ffprobe are required (PA_REQUIRE_BROWSER=1)');
const LOCAL_ONLY = /local files only: give the path of a video file on this machine \(mp4, mov, m4v, webm or mkv\)/;

// Two lines as this machine's ffmpeg printed them for the fixture below (`-vf scdet=threshold=10 -f null -`), logged
// through the filter's own name; the lines of a different build may name the filter's instance differently.
const SCDET = '[Parsed_scdet_0 @ 0x77dd062c40] lavfi.scd.score: 15.625, lavfi.scd.time: 1\n[Parsed_scdet_0 @ 0x77dd062c40] lavfi.scd.score: 15.625, lavfi.scd.time: 2\n';

let dir, fixture, playlist, playlistAsMp4, concatScript, folder, linkToFixture, hits, server, serverUrl;
const server404 = (req, res) => { hits.push(req.url); res.statusCode = 404; res.end(); };

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-measure-'));
  hits = [];
  server = http.createServer(server404);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}/seg.mp4`;
  fixture = path.join(dir, 'fixture.mp4');
  if (hasFfmpeg) { // red 1 s, blue 1 s, green 1 s, 320x180 at 30 fps, a 440 Hz tone
    spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=1',
      '-f', 'lavfi', '-i', 'color=c=green:s=320x180:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fixture]);
  }
  playlist = path.join(dir, 'list.m3u8');
  playlistAsMp4 = path.join(dir, 'list.mp4');
  concatScript = path.join(dir, 'script.mp4');
  const hls = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${serverUrl}\n#EXT-X-ENDLIST\n`;
  writeFileSync(playlist, hls);
  writeFileSync(playlistAsMp4, hls);
  writeFileSync(concatScript, `ffconcat version 1.0\nfile '${serverUrl}'\n`);
  folder = path.join(dir, 'folder');
  mkdirSync(folder);
  linkToFixture = path.join(dir, 'link.mp4');
  symlinkSync(concatScript, linkToFixture); // a link, to a file that exists
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const measure = (args, env = {}) => execFileAsync(process.execPath, [MEASURE, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
  .then((r) => ({ status: 0, ...r }), (e) => ({ status: e.code, stdout: e.stdout, stderr: e.stderr }));

test('parseScdet reads the cut times in order', () => assert.deepEqual(parseScdet(SCDET), [1, 2]));

test('parseScdet reads a decimal time and ignores other lines', () => {
  assert.deepEqual(parseScdet('frame=1\n[scdet @ 0x1] lavfi.scd.score: 34.9, lavfi.scd.time: 2.033333\nlavfi.scd.mafd: 4\n'), [2.033333]);
  assert.deepEqual(parseScdet(''), []);
});

test('the constants are scdet\'s own default threshold and the two-second fast-shot line', () => {
  assert.equal(SCENE_THRESHOLD, 10);
  assert.equal(FAST_SHOT_SECONDS, 2);
});

test('shot lengths come from the cuts and the duration', () => {
  assert.deepEqual(shotStats([1, 2], 3.5), { count: 2, median: 1, shortest: 1, longest: 1.5 });
  assert.deepEqual(shotStats([], 4), { count: 0, median: 4, shortest: 4, longest: 4 });
  assert.equal(shotStats([1, 2, 4], 6).median, 1.5, 'an even number of shots: the middle two averaged');
});

test('every field says whether it was measured or guessed', () => {
  const r = measureReport({ probe: { duration: 3, width: 1080, height: 1920, fps: 30 }, cuts: [1, 2], loudness: { lufs: -14.2, truePeak: -1.1 } });
  assert.deepEqual(r.cuts, { value: 2, basis: 'measured' });
  assert.deepEqual(r.size, { value: [1080, 1920], basis: 'measured' });
  assert.deepEqual(r.mode, { value: 'viral', basis: 'guessed' });
  assert.deepEqual(r.pace, { value: 'fast', basis: 'guessed' });
  assert.deepEqual(Object.keys(r), ['duration', 'size', 'fps', 'cuts', 'shotMedian', 'shotShortest', 'shotLongest', 'lufs', 'truePeakDb', 'mode', 'pace']);
  for (const field of Object.values(r)) assert.ok(['measured', 'guessed'].includes(field.basis));
});

test('a file with no sound has null loudness, still measured; a wide slow film is pro and calm', () => {
  const r = measureReport({ probe: { duration: 10, width: 1920, height: 1080, fps: 24 }, cuts: [], loudness: null });
  assert.deepEqual(r.lufs, { value: null, basis: 'measured' });
  assert.deepEqual(r.truePeakDb, { value: null, basis: 'measured' });
  assert.deepEqual(r.mode, { value: 'pro', basis: 'guessed' });
  assert.deepEqual(r.pace, { value: 'calm', basis: 'guessed' });
});

test('a URL, a folder and a link each exit 2 with the local-files message, and no ffmpeg is started for them', async () => {
  const marker = path.join(dir, 'ffmpeg-started');
  const fake = path.join(dir, 'fake-ffmpeg.sh');
  writeFileSync(fake, `#!/bin/sh\necho started >> '${marker}'\nexit 1\n`);
  chmodSync(fake, 0o755);
  for (const arg of ['https://example.com/a.mp4', 'HTTP://example.com/a.mp4', 'rtsp://127.0.0.1/a', folder, linkToFixture, path.join(dir, 'missing.mp4')]) {
    const run = await measure([arg], { FFMPEG_PATH: fake, FFPROBE_PATH: fake });
    assert.equal(run.status, 2, arg);
    assert.match(run.stderr, /local files only/, arg);
    assert.match(run.stderr, LOCAL_ONLY, arg);
  }
  assert.equal(existsSync(marker), false, 'neither ffmpeg nor ffprobe ran');
});

test('no argument, or two, is exit 2 with the usage line', async () => {
  assert.equal((await measure([])).status, 2);
  assert.equal((await measure([fixture, fixture])).status, 2);
});

test('a playlist, an HLS file named .mp4 and a concat script that name a URL are refused, and the URL is never opened', { skip: !hasFfmpeg }, async () => {
  for (const arg of [playlist, playlistAsMp4, concatScript]) {
    const run = await measure([arg]);
    assert.equal(run.status, 2, arg);
    assert.match(run.stderr, LOCAL_ONLY, arg);
  }
  assert.deepEqual(hits, [], 'the local server saw no request');
});

test('a fixture with two known cuts measures two cuts within a frame of 1 s and 2 s', { skip: !hasFfmpeg }, async () => {
  const run = await measure([fixture, '--json']);
  assert.equal(run.status, 0, run.stderr);
  const r = JSON.parse(run.stdout);
  assert.equal(r.cuts.value, 2); assert.equal(r.cuts.basis, 'measured');
  assert.ok(Math.abs(r.shotMedian.value - 1) <= 1 / 30);
  assert.ok(Math.abs(r.shotShortest.value - 1) <= 1 / 30);
  assert.ok(Math.abs(r.duration.value - 3) <= 1 / 30);
  assert.deepEqual(r.size, { value: [320, 180], basis: 'measured' });
  assert.equal(r.fps.value, 30);
  assert.equal(r.lufs.basis, 'measured'); assert.equal(typeof r.lufs.value, 'number');
  assert.equal(typeof r.truePeakDb.value, 'number');
  assert.deepEqual(r.mode, { value: 'pro', basis: 'guessed' });
  assert.deepEqual(r.pace, { value: 'fast', basis: 'guessed' });
});

test('the text form prints the measured group, then the guessed group, and writes nothing', { skip: !hasFfmpeg }, async () => {
  const run = await measure([fixture]);
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.split('\n');
  const measured = lines.indexOf('measured');
  const guessed = lines.indexOf('guessed');
  assert.ok(measured >= 0 && guessed > measured, run.stdout);
  assert.match(run.stdout, /\bcuts\b\s+2\b/);
  assert.match(run.stdout, /\bmode\b\s+pro\b/);
  assert.equal(run.stderr, '');
});
