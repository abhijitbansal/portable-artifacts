// walk-time: which take frames a walk shot plays and when (idle stretches cut), where each step starts, and the frame
// track the picture reads. Pure, on hand-made take data (what scripts/v2/prepare/walk.mjs gives the page) and on the
// committed fixture take.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sample } from '../../engine/time/track.mjs';
import { frameIndexOf } from '../../engine/kinds/media-clip.mjs';
import { FINAL_HOLD, GLIDE, HOLD_MIN, IDLE_KEEP, IDLE_RUN, keptFrames, walkFrameTrack, walkMinSeconds, walkPlan, walkProblems } from '../../engine/kinds/walk-time.mjs';
import { prepareWalk } from '../../scripts/v2/prepare/walk.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLES = path.resolve(HERE, '../../references/examples/v2');
const FPS = 30;

// A take of `blocks` consecutive blocks of [name, length] frames, cut into steps by [id, first block, last block, act block
// offset]. Every step starts on its first frame and settles on its last, as the real take's steps do.
function takeOf(names, steps) {
  return { names, fps: FPS, steps: steps.map(([id, startIndex, settledIndex, actIndex]) => ({ id, do: 'click', startIndex, actIndex, settledIndex })) };
}
const run = (name, length) => Array.from({ length }, () => name);
const distinct = (prefix, length) => Array.from({ length }, (_, i) => `${prefix}${i}`);
const refs = (...ids) => ({ id: 'w', steps: ids.map((id) => ({ id })) });
const sentencesAt = (...starts) => ({ words: starts.map(() => ({})), sentences: starts.map((start) => ({ start })), duration: 99 });
const NO_SAY = { words: [], sentences: [], duration: 3 };
const near = (actual, wanted, label) => assert.ok(Math.abs(actual - wanted) < 1e-9, `${label}: ${actual} is not ${wanted}`);

test('constants are the plan\'s', () => {
  assert.deepEqual([IDLE_RUN, IDLE_KEEP, GLIDE, HOLD_MIN], [15, 6, 10, 0.5]);
});

// ---- keptFrames ----

test('a 40-frame still run shrinks to its first 6 frames', () => {
  const data = takeOf(run('a', 40), [['s', 0, 39, 0]]);
  assert.deepEqual(keptFrames(data, data.steps[0]), [0, 1, 2, 3, 4, 5]);
});

test('a run of exactly IDLE_RUN equal frames is kept whole; one more shrinks', () => {
  const kept = (n) => { const d = takeOf(run('a', n), [['s', 0, n - 1, 0]]); return keptFrames(d, d.steps[0]).length; };
  assert.equal(kept(IDLE_RUN), IDLE_RUN);
  assert.equal(kept(IDLE_RUN + 1), IDLE_KEEP);
});

test('the glide: the 10 frames before the act survive inside a still run, and nothing after them but the first 6', () => {
  const data = takeOf(run('a', 40), [['s', 0, 39, 30]]);
  assert.deepEqual(keptFrames(data, data.steps[0]), [0, 1, 2, 3, 4, 5, ...Array.from({ length: GLIDE }, (_, i) => 20 + i)]);
});

test('a glide that overlaps the run\'s first frames adds nothing twice, in order', () => {
  const data = takeOf(run('a', 40), [['s', 0, 39, 12]]);
  assert.deepEqual(keptFrames(data, data.steps[0]), Array.from({ length: 12 }, (_, i) => i));
});

test('runs are judged one by one: a short run stays, a long one shrinks, changing frames stay', () => {
  const names = [...run('a', 10), ...distinct('m', 5), ...run('b', 30)];
  const data = takeOf(names, [['s', 0, 44, 0]]);
  const kept = keptFrames(data, data.steps[0]);
  assert.deepEqual(kept, [...Array.from({ length: 15 }, (_, i) => i), 15, 16, 17, 18, 19, 20]);
});

test('only the step\'s own frames are walked', () => {
  const data = takeOf([...distinct('a', 5), ...distinct('b', 5), ...distinct('c', 5)], [['x', 0, 4, 0], ['y', 5, 9, 5], ['z', 10, 14, 10]]);
  assert.deepEqual(keptFrames(data, data.steps[1]), [5, 6, 7, 8, 9]);
});

// ---- walkPlan ----

// Three steps of 6 kept frames (0.2 s) each, so every step ends 0.2 s after it starts and holds HOLD_MIN.
const SHORT = takeOf(distinct('f', 18), [['a', 0, 5, 3], ['b', 6, 11, 9], ['c', 12, 17, 15]]);

test('three steps on three sentences start on them', () => {
  const plan = walkPlan(refs('a', 'b', 'c'), sentencesAt(0, 3, 6), SHORT);
  assert.deepEqual(plan.steps.map((s) => s.start), [0, 3, 6]);
  near(plan.steps[0].act, 3 / FPS, 'act of a');
  near(plan.steps[1].end, 3 + 6 / FPS, 'end of b');
  near(plan.steps[1].until, 3 + 6 / FPS + HOLD_MIN, 'until of b');
  near(plan.end, 6 + 6 / FPS + FINAL_HOLD, 'the shot end is the last step\'s end and the final hold');
});

test('the last step\'s settled frame holds FINAL_HOLD (2.0 s) before the shot ends, with or without a lift or a closing stop', () => {
  assert.equal(FINAL_HOLD, 2);
  const last = (plan) => plan.steps.at(-1);
  const plain = walkPlan(refs('a', 'b', 'c'), sentencesAt(0, 3, 6), SHORT);
  assert.ok(plain.end - last(plain).end >= FINAL_HOLD - 1e-9, `plain: ${plain.end - last(plain).end}`);
  const lifted = walkPlan(refs('a', 'b', 'c'), sentencesAt(0, 3, 6), SHORT, { lifts: [{ step: 'c', hold: 1.2 }] });
  near(lifted.end, last(lifted).until, 'a lift that holds longer than FINAL_HOLD keeps its own end');
  const closing = walkPlan({ ...refs('a', 'b', 'c'), stops: [{ to: 'step:c' }, { to: 'whole' }] }, sentencesAt(0, 3, 6), SHORT);
  assert.ok(closing.end - last(closing).end >= FINAL_HOLD - 1e-9, `closing: ${closing.end - last(closing).end}`);
  const asked = walkMinSeconds(refs('a', 'b', 'c'), { sentences: sentencesAt(0, 3, 6).sentences, words: [], seconds: 1, prepared: SHORT });
  assert.equal(asked, plain.end, 'minSeconds says so too');
});

test('a step whose action outruns its sentence pushes the next step to its until; the shot end grows', () => {
  const data = takeOf([...distinct('a', 150), ...distinct('b', 6)], [['slow', 0, 149, 140], ['next', 150, 155, 150]]);
  const plan = walkPlan(refs('slow', 'next'), sentencesAt(0, 1), data);
  near(plan.steps[0].end, 5, 'slow takes 150 frames at real speed');
  near(plan.steps[0].until, 5 + HOLD_MIN, 'slow holds');
  near(plan.steps[1].start, 5 + HOLD_MIN, 'next waits for the hold');
  near(plan.end, 5 + HOLD_MIN + 6 / FPS + FINAL_HOLD, 'the shot lasts to the last step\'s final hold');
});

test('a say-less shot plays its steps back to back', () => {
  const plan = walkPlan(refs('a', 'b', 'c'), NO_SAY, SHORT);
  assert.equal(plan.steps[0].start, 0);
  near(plan.steps[1].start, plan.steps[0].until, 'b follows a');
  near(plan.steps[2].start, plan.steps[1].until, 'c follows b');
});

test('a step\'s `at` is its anchor, a number or a sentence form', () => {
  const timing = sentencesAt(0, 3, 6);
  const plan = walkPlan({ id: 'w', steps: [{ id: 'a', at: 1.5 }, { id: 'b', at: 'sentence:2' }, { id: 'c', at: 'start+20' }] }, timing, SHORT);
  assert.deepEqual(plan.steps.map((s) => s.start), [1.5, 6, 20]);
});

test('an `at` past the shot\'s natural length is not clamped (the shot stretches to it)', () => {
  const plan = walkPlan({ id: 'w', steps: [{ id: 'a', at: 40 }] }, { ...sentencesAt(0), duration: 3 }, SHORT);
  assert.equal(plan.steps[0].start, 40);
});

test('a step on a later sentence than it can reach waits; an earlier anchor than the hold does not start it early', () => {
  const plan = walkPlan({ id: 'w', steps: [{ id: 'a' }, { id: 'b', at: 0 }] }, sentencesAt(0, 3), SHORT);
  near(plan.steps[1].start, plan.steps[0].until, 'b cannot start before a\'s hold ends');
});

test('a lift holds the step: until is its at, its 0.8 s of moves and its hold past end', () => {
  const plan = walkPlan(refs('a', 'b'), sentencesAt(0, 3), SHORT, { lifts: [{ step: 'a', hold: 1.2 }] });
  near(plan.steps[0].until, plan.steps[0].end + 0.5 + 0.8 + 1.2, 'default at is 0.5 s after end');
  const later = walkPlan({ id: 'w', steps: [{ id: 'a' }, { id: 'b' }] }, sentencesAt(0, 3), SHORT, { lifts: [{ step: 'a', at: 1, hold: 1 }] });
  near(later.steps[0].until, 1 + 0.8 + 1, 'an `at` of 1 s');
  near(later.steps[1].start, 3, 'b still starts on its sentence when a is done by then');
});

test('a lift whose at is before the step\'s end never shortens the hold; a lift on another step does nothing', () => {
  const plan = walkPlan(refs('a', 'b'), sentencesAt(0, 3), SHORT, { lifts: [{ step: 'b', at: 0, hold: 0 }] });
  near(plan.steps[0].until, plan.steps[0].end + HOLD_MIN, 'a');
  near(plan.steps[1].until, plan.steps[1].end + HOLD_MIN, 'b');
});

test('lifts is optional, and a lift for a step the shot lacks is ignored', () => {
  const plain = walkPlan(refs('a', 'b'), sentencesAt(0, 3), SHORT);
  assert.deepEqual(walkPlan(refs('a', 'b'), sentencesAt(0, 3), SHORT, {}), plain);
  assert.deepEqual(walkPlan(refs('a', 'b'), sentencesAt(0, 3), SHORT, { lifts: [{ step: 'zz', hold: 5 }] }), plain);
});

test('a take step the shot skips is not played', () => {
  const plan = walkPlan(refs('a', 'c'), sentencesAt(0, 3), SHORT);
  assert.deepEqual(plan.steps.map((s) => s.id), ['a', 'c']);
});

// ---- walkFrameTrack ----

const at = (tr, t) => sample(tr, t);

test('the frame track reads startIndex at start, settledIndex at end, and is flat until the next step starts', () => {
  const plan = walkPlan(refs('a', 'b', 'c'), sentencesAt(0, 3, 6), SHORT);
  const tr = walkFrameTrack(plan, SHORT);
  plan.steps.forEach((s, i) => {
    const take = SHORT.steps[i];
    assert.equal(frameIndexOf(at(tr, s.start), 99), take.startIndex, `${s.id} at start`);
    assert.equal(frameIndexOf(at(tr, s.end), 99), take.settledIndex, `${s.id} at end`);
    assert.equal(at(tr, s.end), take.settledIndex, `${s.id} at end is exact`);
    const next = plan.steps[i + 1]?.start ?? s.until + 1;
    for (const t of [s.end + 0.01, (s.end + next) / 2, next - 1e-6]) assert.equal(frameIndexOf(at(tr, t), 99), take.settledIndex, `${s.id} flat at ${t}`);
  });
});

test('the frame track walks one take frame per 1/fps, each kept frame in its turn', () => {
  const plan = walkPlan(refs('a'), NO_SAY, SHORT);
  const tr = walkFrameTrack(plan, SHORT);
  const kept = keptFrames(SHORT, SHORT.steps[0]);
  kept.forEach((frame, j) => assert.equal(frameIndexOf(at(tr, plan.steps[0].start + j / FPS), 99), frame, `kept frame ${j}`));
  kept.forEach((frame, j) => assert.equal(frameIndexOf(at(tr, plan.steps[0].start + (j + 0.5) / FPS), 99), frame, `half way into kept frame ${j}`));
});

test('before the first step starts the walk shows its first frame', () => {
  const plan = walkPlan({ id: 'w', steps: [{ id: 'b', at: 2 }] }, sentencesAt(0), SHORT);
  const tr = walkFrameTrack(plan, SHORT);
  for (const t of [0, 1, 1.99]) assert.equal(frameIndexOf(at(tr, t), 99), SHORT.steps[1].startIndex, `at ${t}`);
});

test('a cut in a step is a jump: the frame before it, then the frame after, at the same time', () => {
  const names = [...distinct('a', 3), ...run('s', 30), ...distinct('z', 3)];
  const data = takeOf(names, [['s', 0, 35, 0]]);
  const plan = walkPlan(refs('s'), NO_SAY, data);
  const kept = keptFrames(data, data.steps[0]);
  assert.deepEqual(kept, [0, 1, 2, 3, 4, 5, 6, 7, 8, 33, 34, 35]);
  const tr = walkFrameTrack(plan, data);
  const cutAt = 9 / FPS;
  assert.equal(frameIndexOf(at(tr, cutAt - 0.001), 99), 8);
  assert.equal(frameIndexOf(at(tr, cutAt), 99), 33);
  assert.equal(frameIndexOf(at(tr, plan.steps[0].end - 0.001), 99), 35);
  assert.equal(at(tr, plan.steps[0].end), 35);
  assert.equal(plan.steps[0].end, 12 / FPS);
});

test('a take whose last run is still ends on settledIndex, though the kept frames stop earlier', () => {
  const data = takeOf([...distinct('a', 3), ...run('s', 40)], [['s', 0, 42, 0]]);
  const plan = walkPlan(refs('s'), NO_SAY, data);
  assert.equal(keptFrames(data, data.steps[0]).at(-1), 8);
  assert.equal(at(walkFrameTrack(plan, data), plan.steps[0].end), 42);
});

test('the frame track on the committed take runs, in order, without a key going back in time', () => {
  const { data } = prepareWalk({ src: 'walk-take' }, { filmDir: EXAMPLES });
  const ids = data.steps.map((s) => s.id);
  const plan = walkPlan({ id: 'w', steps: ids.map((id) => ({ id })) }, { words: [], sentences: [], duration: 3 }, data);
  const tr = walkFrameTrack(plan, data);
  assert.ok(tr.points.every((p, i) => i === 0 || p.t >= tr.points[i - 1].t));
  assert.equal(at(tr, plan.end), data.steps.at(-1).settledIndex);
  // idle stretches are cut: far fewer seconds than the take's own 207 frames
  assert.ok(plan.end < data.names.length / data.fps + HOLD_MIN * ids.length);
  assert.ok(plan.steps.every((s, i) => i === 0 || s.start >= plan.steps[i - 1].until));
});

// ---- walkProblems ----

test('walkProblems: some steps without `at` and a sentence count that is not the step count names both counts', () => {
  const shot = { id: 'w', steps: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  const [problem] = walkProblems(shot, sentencesAt(0, 3), SHORT);
  assert.equal(problem.path, 'steps');
  assert.equal(problem.message, '3 steps, 2 sentences: give each step a sentence or an at');
});

test('walkProblems: every step with an `at`, or a say-less shot, needs no sentences', () => {
  assert.deepEqual(walkProblems({ id: 'w', steps: [{ id: 'a', at: 0 }, { id: 'b', at: 1 }] }, sentencesAt(0), SHORT), []);
  assert.deepEqual(walkProblems(refs('a', 'b'), NO_SAY, SHORT), []);
  assert.deepEqual(walkProblems(refs('a', 'b', 'c'), sentencesAt(0, 3, 6), SHORT), []);
});

test('walkProblems: a step id the take lacks, and steps out of the take\'s order', () => {
  const [unknown] = walkProblems(refs('a', 'nope'), sentencesAt(0, 3), SHORT);
  assert.equal(unknown.path, 'steps[1].id');
  assert.match(unknown.message, /"nope".*not a step of the take.*a, b, c/);
  const [order] = walkProblems(refs('b', 'a'), sentencesAt(0, 3), SHORT);
  assert.equal(order.path, 'steps[1].id');
  assert.match(order.message, /"a".*before "b".*take's order/);
});
