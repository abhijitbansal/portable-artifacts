// The check of the finished file: its frame count matches the timeline and its picture is not blank. ffmpeg, no browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ffmpegOrNull } from './helpers/session.mjs';
import { BLANK_STD, CHECK_HEIGHT, CHECK_WIDTH, checkArgs, checkOutput, outputProblem } from '../../scripts/v2/output-check.mjs';

let dir;
let ffmpeg = null;
const clip = (name) => path.join(dir, name);
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-check-'));
  ffmpeg = await ffmpegOrNull();
});
after(() => rmSync(dir, { recursive: true, force: true }));

// One-second 320x180 clips at 30 fps, made with lavfi: black, a test pattern, one test-pattern picture held for the whole
// clip (a film of one held still is legal), and a single frame.
const SIZE = 's=320x180';
const H264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
const make = (args) => {
  const run = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
};

test('the check decodes the first video stream to 96 by 54 gray frames on stdout', () => {
  assert.deepEqual([CHECK_WIDTH, CHECK_HEIGHT, BLANK_STD], [96, 54, 1.5]);
  const args = checkArgs('/x/film.mp4');
  assert.deepEqual(args.slice(args.indexOf('-i'), args.indexOf('-i') + 2), ['-i', '/x/film.mp4']);
  assert.deepEqual(args.slice(args.indexOf('-map'), args.indexOf('-map') + 2), ['-map', '0:v:0']);
  assert.equal(args[args.indexOf('-vf') + 1], 'scale=96:54:flags=area,format=gray');
  assert.deepEqual(args.slice(-3), ['-f', 'rawvideo', '-']);
});

test('a film whose every frame is flat is blank; one frame with detail is enough', () => {
  assert.match(outputProblem({ decoded: 3, stds: [0, 0.4, 1.4], frames: 3 }), /picture is blank: none of its 3 frames/);
  assert.equal(outputProblem({ decoded: 3, stds: [0, 0, 9], frames: 3 }), null);
});

test('a frame count that differs from the timeline names both numbers', () => {
  assert.equal(outputProblem({ decoded: 29, stds: [9], frames: 30 }), 'the finished file holds 29 frames, the timeline has 30');
});

test('a black clip fails; a test pattern passes; one still picture held for the whole clip passes too', async (t) => {
  if (!ffmpeg) return t.skip('no ffmpeg');
  make(['-f', 'lavfi', '-i', `color=c=black:${SIZE}:r=30`, '-t', '1', ...H264, clip('black.mp4')]);
  make(['-f', 'lavfi', '-i', `testsrc=${SIZE}:r=30`, '-t', '1', ...H264, clip('pattern.mp4')]);
  make(['-f', 'lavfi', '-i', `testsrc=${SIZE}`, '-frames:v', '1', clip('still.png')]);
  make(['-loop', '1', '-framerate', '30', '-i', clip('still.png'), '-t', '1', ...H264, clip('held.mp4')]);
  await assert.rejects(checkOutput({ ffmpeg, file: clip('black.mp4'), frames: 30 }), /^Error: render check: the finished file's picture is blank: none of its 30 frames has any detail; nothing was written$/);
  assert.deepEqual(await checkOutput({ ffmpeg, file: clip('pattern.mp4'), frames: 30 }), { decoded: 30 });
  assert.deepEqual(await checkOutput({ ffmpeg, file: clip('held.mp4'), frames: 30 }), { decoded: 30 });
  return undefined;
});

test('a clip one frame short of the timeline fails, naming 30 and 31', async (t) => {
  if (!ffmpeg) return t.skip('no ffmpeg');
  make(['-f', 'lavfi', '-i', `testsrc=${SIZE}:r=30`, '-t', '1', ...H264, clip('short.mp4')]);
  await assert.rejects(checkOutput({ ffmpeg, file: clip('short.mp4'), frames: 31 }), { message: 'render check: the finished file holds 30 frames, the timeline has 31; nothing was written' });
  return undefined;
});

test('a film of one frame is legal, and a file ffmpeg cannot read fails with its words, not a count', async (t) => {
  if (!ffmpeg) return t.skip('no ffmpeg');
  make(['-f', 'lavfi', '-i', `testsrc=${SIZE}:r=30`, '-frames:v', '1', ...H264, clip('one.mp4')]);
  assert.deepEqual(await checkOutput({ ffmpeg, file: clip('one.mp4'), frames: 1 }), { decoded: 1 });
  await assert.rejects(checkOutput({ ffmpeg, file: clip('missing.mp4'), frames: 1 }), /^Error: render check: ffmpeg could not read the finished file.*; nothing was written$/);
  return undefined;
});

test('an abort stops the check and rejects with the signal\'s reason', async (t) => {
  if (!ffmpeg) return t.skip('no ffmpeg');
  const controller = new AbortController();
  controller.abort(new Error('stopped'));
  await assert.rejects(checkOutput({ ffmpeg, file: clip('never-read.mp4'), frames: 30, signal: controller.signal }), { message: 'stopped' });
  return undefined;
});
