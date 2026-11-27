// The walk shot's time: which frames of a take it plays, when each step starts, and the frame track the picture reads.
// A step plays on its sentence (or its `at`), at the take's real speed with idle stretches cut. Its last frame holds
// until the next step starts, and the next step waits for that hold. Everything is in shot seconds and in 0-based indexes
// into the take's frame names (scripts/v2/prepare/walk.mjs gives `data`). Pure and DOM-free.
import { track } from '../time/track.mjs';
import { anchorSeconds } from '../script/anchors.mjs';

/** A run of more than this many frames with one name is idle. */
export const IDLE_RUN = 15;
/** The frames of an idle run that are kept (the first ones). */
export const IDLE_KEEP = 6;
/** The frames before a step's act that are always kept: the cursor travels over them. */
export const GLIDE = 10;
/** The least seconds a step's last frame holds. */
export const HOLD_MIN = 0.5;
/** The seconds a lift takes to come up and to go back (0.4 s each). */
export const LIFT_MOVES = 0.8;
/** Seconds after a step's end that a lift without an `at` starts. */
export const LIFT_LEAD = 0.5;

const sentenceCount = (n) => `${n} sentence${n === 1 ? '' : 's'}`;
const stepCount = (n) => `${n} step${n === 1 ? '' : 's'}`;
const takeSteps = (data) => new Map(data.steps.map((s, i) => [s.id, { ...s, order: i }]));

/**
 * The indexes a step plays: startIndex..settledIndex, with each run of more than IDLE_RUN frames of one name cut to its
 * first IDLE_KEEP frames, but for the GLIDE frames before actIndex, which are always kept.
 */
export function keptFrames(data, step) {
  const kept = [];
  const glideFrom = step.actIndex - GLIDE;
  let first = step.startIndex;
  while (first <= step.settledIndex) {
    let last = first;
    while (last < step.settledIndex && data.names[last + 1] === data.names[first]) last += 1;
    const idle = last - first + 1 > IDLE_RUN;
    for (let k = first; k <= last; k += 1) {
      if (!idle || k - first < IDLE_KEEP || (k >= glideFrom && k < step.actIndex)) kept.push(k);
    }
    first = last + 1;
  }
  return kept;
}

/**
 * What stops `shot`'s steps from being played on `data`, as { path, message } with the path from the shot: a step id the
 * take lacks, steps out of the take's order, and (for a shot with a say) some steps without `at` while the sentence
 * count is not the step count.
 */
export function walkProblems(shot, timing, data) {
  const byId = takeSteps(data);
  const problems = [];
  shot.steps.forEach((ref, i) => {
    const found = byId.get(ref.id);
    const before = i > 0 ? byId.get(shot.steps[i - 1].id) : undefined;
    if (found === undefined) {
      problems.push({ path: `steps[${i}].id`, message: `step "${ref.id}" is not a step of the take (it has: ${data.steps.map((s) => s.id).join(', ')})` });
    } else if (before !== undefined && found.order <= before.order) {
      problems.push({ path: `steps[${i}].id`, message: `step "${ref.id}" comes after "${before.id}" in the shot but before "${before.id}" in the take: steps follow the take's order` });
    }
  });
  const sentences = timing.sentences?.length ?? 0;
  if (sentences > 0 && sentences !== shot.steps.length && shot.steps.some((s) => s.at === undefined)) {
    problems.push({ path: 'steps', message: `${stepCount(shot.steps.length)}, ${sentenceCount(sentences)}: give each step a sentence or an at` });
  }
  return problems;
}

// Shot seconds an anchor names. Not clamped to the shot: the shot stretches to its steps, so its length is not known yet.
const secondsOf = (ref, shot, timing) => Math.max(0, anchorSeconds(ref, {
  id: shot.id, words: timing.words ?? [], sentences: timing.sentences ?? [], duration: timing.duration ?? 0,
}));

// Seconds from a step's end to the end of its longest lift: its wait, the moves, the hold.
function liftSeconds(lifts, id, end, anchor) {
  const own = lifts.filter((l) => l.step === id);
  return own.reduce((most, l) => {
    const from = l.at === undefined ? LIFT_LEAD : anchor(l.at) - end;
    return Math.max(most, from + LIFT_MOVES + (l.hold ?? 0));
  }, 0);
}

/**
 * Where each of `shot.steps` starts, acts and ends, in shot seconds, and where the shot ends (`end`, the last step's
 * `until`). `timing` is the shot's { words, sentences, duration }; a step without `at` takes its sentence's start, or 0 in
 * a shot with no say. `start` is the later of that and the previous step's `until`, the end of its hold:
 * `until = end + max(HOLD_MIN, lift seconds)`. `lifts` is [{ step, at?, hold }]. Throws for a step id the take lacks
 * (walkProblems says so first).
 */
export function walkPlan(shot, timing, data, { lifts = [] } = {}) {
  const byId = takeSteps(data);
  const anchor = (ref) => secondsOf(ref, shot, timing);
  let until = 0;
  const steps = shot.steps.map((ref, i) => {
    const take = byId.get(ref.id);
    if (take === undefined) throw new RangeError(`steps[${i}].id: "${ref.id}" is not a step of the take`);
    const kept = keptFrames(data, take);
    const wanted = ref.at === undefined ? (timing.sentences?.[i]?.start ?? 0) : anchor(ref.at);
    const start = Math.max(wanted, until);
    const end = start + kept.length / data.fps;
    until = end + Math.max(HOLD_MIN, liftSeconds(lifts, ref.id, end, anchor));
    return { id: ref.id, start, act: start + kept.filter((k) => k < take.actIndex).length / data.fps, end, until };
  });
  return { steps, end: until };
}

// [{ first, length }]: the runs of consecutive indexes in `kept`.
function runsOf(kept) {
  const runs = [];
  for (const k of kept) {
    const last = runs.at(-1);
    if (last !== undefined && last.first + last.length === k) last.length += 1;
    else runs.push({ first: k, length: 1 });
  }
  return runs;
}

/**
 * The track of the take frame index the picture shows (what `frameIndexOf` reads). Over a run of kept frames it rises
 * `fps` per second; at a cut it jumps (two keys at one time); over a hold it is flat at the step's settledIndex; before the
 * first step starts it is that step's startIndex. At a step's `end` it is exactly settledIndex.
 */
export function walkFrameTrack(plan, data) {
  const byId = takeSteps(data);
  const keys = [];
  const push = (t, v) => {
    const last = keys.at(-1);
    if (last === undefined || last.t !== t || last.v !== v) keys.push({ t, v });
  };
  let held = byId.get(plan.steps[0].id).startIndex;
  push(0, held);
  for (const step of plan.steps) {
    const take = byId.get(step.id);
    push(step.start, held);
    let done = 0;
    for (const run of runsOf(keptFrames(data, take))) {
      push(step.start + done / data.fps, run.first);
      done += run.length;
      push(step.start + done / data.fps, run.first + run.length);
    }
    push(step.end, take.settledIndex);
    held = take.settledIndex;
  }
  return track(keys);
}

/**
 * The `minSeconds` of the walk kind: the seconds the shot needs to play its steps and their holds, or undefined when it
 * cannot say (no prepared take, or steps that do not fit it: the validator reports those). `seconds` is the shot's natural
 * length; it stands in for `end` in an anchor.
 */
export function walkMinSeconds(shot, { sentences, words, seconds, prepared }, { lifts = [] } = {}) {
  if (prepared === undefined || prepared === null) return undefined;
  const timing = { sentences, words, duration: seconds };
  if (walkProblems(shot, timing, prepared).length > 0) return undefined;
  return walkPlan(shot, timing, prepared, { lifts }).end;
}
