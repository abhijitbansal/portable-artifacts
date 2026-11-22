// The stage clock: the time of each stage of a frame (draw, capture, encode), and a stall turned into an error that
// names the stage. No browser: the stages are plain functions here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStageClock, stallError } from '../../scripts/v2/capture-clock.mjs';
import { describeError, formatText } from '../../scripts/v2/report.mjs';
import { heldFlags, shootFrame } from '../../scripts/v2/render.mjs';
import { captureParallel } from '../../scripts/v2/workers.mjs';
import { fakeTimers } from './helpers/fake-timers.mjs';

// A page that seeks and screenshots without a browser: `seek` and `shot` are what each call does.
const fakePage = ({ seek = async () => {}, shot = async () => Buffer.from('jpeg') } = {}) => ({ evaluate: (fn, arg) => { globalThis.window = { __seek: seek, __heldFlags: (a, b) => Array.from({ length: b - a + 1 }, () => false) }; return fn(arg); }, screenshot: shot });

// The stall timer is unref'd (it must never hold a finished run open), so a test whose stage never answers keeps the
// event loop alive itself until the stall fires.
const keepAlive = () => { const timer = setInterval(() => {}, 1000); return () => clearInterval(timer); };

test('the clock sums each stage and returns what the stage returned', async () => {
  let t = 0;
  const clock = createStageClock({ frames: 10, now: () => t });
  assert.equal(await clock.time('draw', 0, async () => { t += 4; return 'x'; }), 'x');
  await clock.time('draw', 1, async () => { t += 6; });
  await clock.time('capture', 1, async () => { t += 30; });
  assert.deepEqual(clock.totals(), { drawMs: 10, captureMs: 30, encodeMs: 0, checkMs: 0 });
});

test('a stage that does not answer in time is a stall naming the stage, the frame and the last page messages', async () => {
  const release = keepAlive();
  try {
    const clock = createStageClock({ frames: 900, stallMs: 20, tail: () => ['a', 'b', 'c', 'd', 'e', 'f'] });
    await assert.rejects(clock.time('capture', 41, () => new Promise(() => {})),
      { message: 'render stalled in the capture stage at frame 42 of 900: no answer in 0.02 s; last page messages: b | c | d | e | f' });
  } finally {
    release();
  }
});

test('an error a stage throws is not a stall: it passes through unchanged', async () => {
  const boom = new Error('page.evaluate: Error: unknown font "X"');
  await assert.rejects(createStageClock({ frames: 1 }).time('draw', 0, async () => { throw boom; }), (err) => err === boom);
});

test('the browser\'s own timeout is a stall too, with its first line as the cause', async () => {
  const timeout = Object.assign(new Error('page.screenshot: Timeout 30000ms exceeded.\nCall log:\n  - taking page screenshot'), { name: 'TimeoutError' });
  await assert.rejects(createStageClock({ frames: 900 }).time('capture', 41, async () => { throw timeout; }),
    { message: 'render stalled in the capture stage at frame 42 of 900: page.screenshot: Timeout 30000ms exceeded.; last page messages: none' });
});

test('a stall with no page message says none, and an unknown stage is refused', async () => {
  assert.match(stallError({ stage: 'encode', frame: 0, frames: 1, cause: 'no answer in 1 s', tail: [] }).message, /last page messages: none$/);
  await assert.rejects(createStageClock({ frames: 1 }).time('paint', 0, async () => {}), /stage must be one of draw, capture, encode, check/);
});

test('the stall timer is unref\'d and cleared when the stage settles, and re-armed by a heartbeat but never after it settled', async () => {
  const timers = fakeTimers();
  const clock = createStageClock({ frames: 3, stallMs: 500, timers });
  await clock.time('draw', 0, async () => 'fast');
  assert.deepEqual(timers.handles.map((h) => [h.ms, h.unrefd, h.cleared]), [[500, true, true]], 'one timer, unref\'d, cleared on settle');
  let late;
  await clock.time('check', 2, async ({ beat }) => { beat(); beat(); late = beat; });
  assert.deepEqual(timers.handles.slice(1).map((h) => [h.unrefd, h.cleared]), [[true, true], [true, true], [true, true]], 'each heartbeat replaces the timer; every one is cleared at the end');
  late();
  assert.equal(timers.handles.length, 4, 'a heartbeat after the stage settled arms nothing');
});

test('a heartbeat restarts the stall limit, and a stall aborts the signal the stage was given, with the stall as its reason', async () => {
  const timers = fakeTimers();
  const clock = createStageClock({ frames: 5, stallMs: 60_000, timers });
  let control;
  const stage = clock.time('check', 4, (given) => { control = given; return new Promise(() => {}); });
  const settled = assert.rejects(stage, /^Error: render stalled in the check stage at frame 5 of 5: no answer in 60 s/);
  control.beat();
  control.beat();
  assert.deepEqual(timers.handles.map((h) => [h.ms, h.cleared]), [[60_000, true], [60_000, true], [60_000, false]], 'each beat replaces the timer with a whole new limit');
  assert.equal(control.signal.aborted, false);
  timers.handles[2].fn(); // the live timer runs out
  assert.equal(control.signal.aborted, true, 'the stall aborts the stage\'s signal');
  await settled;
  assert.match(control.signal.reason.message, /^render stalled in the check stage/);
});

test('a late failure of a stalled stage is not unhandled', async () => {
  const release = keepAlive();
  try {
    const clock = createStageClock({ frames: 1, stallMs: 20 });
    let fail;
    const stuck = new Promise((_, reject) => { fail = reject; });
    await assert.rejects(clock.time('encode', 0, () => stuck), /render stalled in the encode stage/);
    fail(new Error('late'));
    await new Promise((resolve) => setImmediate(resolve)); // an unhandled rejection would fail the file here
  } finally {
    release();
  }
});

test('shootFrame seeks as draw and screenshots as capture, and returns the picture', async () => {
  const seen = [];
  const clock = createStageClock({ frames: 5 });
  const page = fakePage({ seek: async (i) => { seen.push(['seek', i]); }, shot: async (opts) => { seen.push(['shot', opts.type]); return Buffer.from('p'); } });
  assert.equal((await shootFrame(page, 3, { exact: false, clock })).toString(), 'p');
  assert.deepEqual(seen, [['seek', 3], ['shot', 'jpeg']]);
  assert.deepEqual(Object.keys(clock.totals()), ['drawMs', 'captureMs', 'encodeMs', 'checkMs']);
});

test('shootFrame: a seek that hangs stalls in draw, a browser timeout in capture, and a film error passes through', async () => {
  const release = keepAlive();
  try {
    const frames = 50;
    const hung = createStageClock({ frames, stallMs: 20, tail: () => ['page said x'] });
    await assert.rejects(shootFrame(fakePage({ seek: () => new Promise(() => {}) }), 6, { exact: true, clock: hung }),
      { message: 'render stalled in the draw stage at frame 7 of 50: no answer in 0.02 s; last page messages: page said x' });
    const timeout = Object.assign(new Error('page.screenshot: Timeout 30000ms exceeded.'), { name: 'TimeoutError' });
    await assert.rejects(shootFrame(fakePage({ shot: async () => { throw timeout; } }), 6, { exact: true, clock: createStageClock({ frames }) }), /^Error: render stalled in the capture stage at frame 7 of 50/);
    const film = new Error('page.evaluate: Error: unknown font "X"');
    await assert.rejects(shootFrame(fakePage({ seek: async () => { throw film; } }), 6, { exact: true, clock: createStageClock({ frames }) }), (err) => err === film);
  } finally {
    release();
  }
});

test('the report says where the time went on the frames line, and a stall gets its hint even when a page message matches another', () => {
  const report = { stages: [{ name: 'validate', ok: true }], findings: [], timed: 'estimated', sheets: [], output: 'o.mp4', frames: 30, captured: 30, capture: 'fast', post: 'webgl2', msPerFrame: 12.34, bytes: 2e6, mbps: 1.5, audio: null, timing: { drawMs: 11, captureMs: 222, encodeMs: 33, checkMs: 4 } };
  assert.match(formatText(report, { sheetsDir: 's' }), /12\.3 ms per frame, draw 11 capture 222 encode 33 check 4 ms\); size:/);
  assert.doesNotMatch(formatText({ ...report, timing: null }, { sheetsDir: 's' }), /draw 11/);
  const stalled = describeError(stallError({ stage: 'capture', frame: 0, frames: 9, cause: 'no answer in 120 s', tail: ['Target page, context or browser has been closed'] }));
  assert.match(stalled.hint, /stopped answering at that stage; run again, and with --workers 1/);
  const checked = describeError(new Error('render check: the finished file holds 29 frames, the timeline has 30; nothing was written'));
  assert.match(checked.hint, /^the browser drew or captured nothing, or the encode lost frames; run again with --workers 1, then with --exact/);
});

test('the held-frame flags are part of the draw stage on both paths: a hang there names the stage and the frame', async () => {
  const release = keepAlive();
  try {
    const hang = fakePage();
    hang.evaluate = () => new Promise(() => {});
    const serial = createStageClock({ frames: 8, stallMs: 20 });
    await assert.rejects(heldFlags(hang, 4, 7, serial), /^Error: render stalled in the draw stage at frame 5 of 8/);
    const parallel = createStageClock({ frames: 8, stallMs: 20 });
    await assert.rejects(captureParallel({ pages: [fakePage(), hang], frames: 8, shoot: async () => Buffer.from('x'), write: async () => {}, held: (page, a, b) => heldFlags(page, a, b, parallel) }),
      /^Error: render stalled in the draw stage at frame 5 of 8/);
  } finally {
    release();
  }
});

test('the parallel path stalls through the same function: captureParallel with shootFrame names the stage and the frame', async () => {
  const release = keepAlive();
  try {
    const clock = createStageClock({ frames: 4, stallMs: 20 });
    const pages = [fakePage(), fakePage({ seek: (i) => (i === 3 ? new Promise(() => {}) : Promise.resolve()) })];
    await assert.rejects(captureParallel({ pages, frames: 4, shoot: (page, i) => shootFrame(page, i, { exact: false, clock }), write: async () => {} }),
      /^Error: render stalled in the draw stage at frame 4 of 4: no answer in 0\.02 s/);
  } finally {
    release();
  }
});
