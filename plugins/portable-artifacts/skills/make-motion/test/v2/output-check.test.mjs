// The check of the finished file: its frame count matches the timeline and its picture is not blank. ffmpeg, no browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter, getEventListeners } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ffmpegOrNull } from './helpers/session.mjs';
import { createStageClock } from '../../scripts/v2/capture-clock.mjs';
import { BLANK_STD, CHECK_HEIGHT, CHECK_WIDTH, checkArgs, checkOutput, outputProblem, versionOf } from '../../scripts/v2/output-check.mjs';
import { fakeTimers } from './helpers/fake-timers.mjs';

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
  assert.deepEqual(args.slice(args.indexOf('-fps_mode'), args.indexOf('-fps_mode') + 2), ['-fps_mode', 'passthrough'], 'the count reads frames, not timestamps');
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

// A decoder that is not ffmpeg, driven by hand so no test waits on the wall clock: frame() writes one gray frame, end()
// ends the process, and kill() ends it as a killed process does (its close comes at once, which is the hard case).
const FRAME = Buffer.from(Array.from({ length: CHECK_WIDTH * CHECK_HEIGHT }, (_, i) => i % 256));
function fakeDecoder() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.frame = () => child.stdout.emit('data', FRAME);
  child.end = (code = 0) => child.emit('close', code);
  child.kill = () => { child.killed = true; child.emit('close', null); };
  return child;
}
const abortListeners = (signal) => getEventListeners(signal, 'abort').length;
// The check as render runs it: inside the clock, with the clock's heartbeat and stall signal, and the run's own signal.
function checking({ frames, signal, stallMs = 60_000 }) {
  const timers = fakeTimers();
  const child = fakeDecoder();
  const clock = createStageClock({ frames, stallMs, timers });
  let stalled;
  const run = clock.time('check', frames - 1, (control) => {
    stalled = control.signal;
    return checkOutput({ ffmpeg: 'fake', file: 'f.mp4', frames, signal, stalled, beat: control.beat, version: null, spawn: () => child });
  });
  return { run, child, timers, stalled };
}

test('every decoded frame restarts the stall limit, and a finished decode leaves no timer or listener behind', async () => {
  const run = new AbortController();
  const { run: checked, child, timers, stalled } = checking({ frames: 3, signal: run.signal });
  child.frame();
  child.frame();
  child.frame();
  assert.deepEqual(timers.handles.map((h) => h.cleared), [true, true, true, false], 'one timer to start, one new one per frame');
  child.end();
  assert.deepEqual(await checked, { decoded: 3 });
  assert.equal(child.killed, false);
  assert.ok(timers.handles.every((h) => h.cleared && h.unrefd));
  assert.deepEqual([abortListeners(run.signal), abortListeners(stalled)], [0, 0]);
});

test('a decoder that stops emitting stalls the check stage and has its ffmpeg killed', async () => {
  const { run, child, timers } = checking({ frames: 10 });
  child.frame();
  child.frame();
  const stalled = assert.rejects(run, /^Error: render stalled in the check stage at frame 10 of 10: no answer in 60 s/);
  timers.handles.at(-1).fn(); // no frame for the whole limit: the live timer runs out
  await stalled;
  assert.equal(child.killed, true);
});

test('a run abort in the middle of the decode rejects with its reason, not a stall, kills ffmpeg and leaves no listener behind', async () => {
  const run = new AbortController();
  const { run: checked, child, timers, stalled } = checking({ frames: 10, signal: run.signal });
  child.frame();
  const reason = new Error('stopped by the user');
  const rejected = assert.rejects(checked, (err) => err === reason);
  run.abort(reason);
  await rejected;
  assert.equal(child.killed, true);
  assert.ok(timers.handles.every((h) => h.cleared), 'the stage is over: no stall timer is left');
  assert.deepEqual([abortListeners(run.signal), abortListeners(stalled)], [0, 0]);
});

test('checkOutput gives one heartbeat per decoded frame', async () => {
  let beats = 0;
  const child = fakeDecoder();
  const checked = checkOutput({ ffmpeg: 'fake', file: 'f.mp4', frames: 4, beat: () => { beats++; }, version: null, spawn: () => child });
  for (let k = 0; k < 4; k++) child.frame();
  child.end();
  await checked;
  assert.equal(beats, 4);
});

test('the version of ffmpeg is read from its first line, and a build with no number is unknown', () => {
  assert.deepEqual(versionOf('ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright (c) 2000-2021 the FFmpeg developers'), { major: 4, minor: 4 });
  assert.deepEqual(versionOf('ffmpeg version n6.1.1 Copyright'), { major: 6, minor: 1 });
  assert.deepEqual(versionOf('ffmpeg version 8.1.1 Copyright (c) 2000-2026 the FFmpeg developers'), { major: 8, minor: 1 });
  assert.deepEqual(versionOf('ffmpeg version 7.0-static https://johnvansickle.com/ffmpeg/'), { major: 7, minor: 0 });
  assert.equal(versionOf('ffmpeg version N-117000-gabcdef Copyright'), null);
  assert.equal(versionOf(''), null);
});

test('ffmpeg before 5.1 gets -vsync passthrough, which it knows; 5.1 and later (and an unknown build) get -fps_mode passthrough', () => {
  const pace = (version) => {
    const args = checkArgs('/x/film.mp4', { version });
    return [args.includes('-vsync') ? args.slice(args.indexOf('-vsync'), args.indexOf('-vsync') + 2) : null, args.includes('-fps_mode') ? args.slice(args.indexOf('-fps_mode'), args.indexOf('-fps_mode') + 2) : null];
  };
  const VSYNC = [['-vsync', 'passthrough'], null];
  const FPS_MODE = [null, ['-fps_mode', 'passthrough']];
  assert.deepEqual(pace({ major: 4, minor: 4 }), VSYNC);
  assert.deepEqual(pace({ major: 5, minor: 0 }), VSYNC);
  assert.deepEqual(pace({ major: 5, minor: 1 }), FPS_MODE);
  assert.deepEqual(pace({ major: 8, minor: 1 }), FPS_MODE);
  assert.deepEqual(pace(null), FPS_MODE);
  assert.deepEqual(pace(undefined), FPS_MODE);
});

test('checkOutput decodes with the flag its ffmpeg knows', async () => {
  const spawned = [];
  for (const version of [{ major: 4, minor: 4 }, { major: 6, minor: 1 }]) {
    const child = fakeDecoder();
    const checked = checkOutput({ ffmpeg: 'fake', file: 'f.mp4', frames: 1, version, spawn: (_, args) => { spawned.push(args); return child; } });
    child.frame();
    child.end();
    await checked;
  }
  assert.deepEqual(spawned.map((args) => [args.includes('-vsync'), args.includes('-fps_mode')]), [[true, false], [false, true]]);
});

test('an abort stops the check and rejects with the signal\'s reason', async (t) => {
  if (!ffmpeg) return t.skip('no ffmpeg');
  const controller = new AbortController();
  controller.abort(new Error('stopped'));
  await assert.rejects(checkOutput({ ffmpeg, file: clip('never-read.mp4'), frames: 30, signal: controller.signal }), { message: 'stopped' });
  return undefined;
});
