// buildTimeline with measured words (a voice sidecar's shots) and without them. Without words the timeline must stay
// exactly what it was before measured words existed: the gate films are compared with their timelines as frozen before
// the change (fixtures/voice/timeline-gate-*.json, written by .scratch/voice/freeze-gate-timelines.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { NARRATION_LEAD, buildTimeline, narrationStart } from '../../engine/script/timing.mjs';
import { anchorSeconds } from '../../engine/script/anchors.mjs';
import { createRegistry, registries } from '../../engine/registry.mjs';
import { validateSidecar } from '../../scripts/v2/voice/sidecar.mjs';
import { walkMinSeconds, walkPlan } from '../../engine/kinds/walk-time.mjs';
import { prepareWalk } from '../../scripts/v2/prepare/walk.mjs';
import { FIXTURE, digestOf, exampleFiles, firstDifference } from './helpers/example-timelines.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '../..');
const FIXTURES = path.join(HERE, 'fixtures/voice');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const FPS = 30;
const PRO_TAIL = registries.modes.get('pro').tail;
const FRAME_EPSILON = 1e-6;
const frameCeil = (seconds) => Math.ceil(seconds * FPS - FRAME_EPSILON) / FPS;

const FILM = readJson(path.join(FIXTURES, 'film-three-shots.json'));
const SIDECAR = readJson(path.join(FIXTURES, 'sidecar-three-shots.json'));
const flatWords = (sidecarShot) => sidecarShot.sentences.flatMap((s) => s.words);
const measured = (words = SIDECAR.shots) => buildTimeline(FILM, { fps: FPS, words });
// A timeline without the words' sound times (soundStart, soundEnd): what the picture reads.
const pictureOnly = (tl) => ({ ...tl, shots: tl.shots.map((sh) => ({ ...sh, words: sh.words.map(({ soundStart, soundEnd, ...w }) => w) })) });

// --- without words: byte-identical to before ---

for (const name of ['gate-desk', 'gate-pop']) {
  test(`without words the ${name} timeline deep-equals the one frozen before measured words existed`, () => {
    const { film } = loadFilm(path.join(SKILL, 'references/examples/v2', `${name}.json`));
    const frozen = readJson(path.join(FIXTURES, `timeline-${name}.json`));
    // The picture is the frozen one; each word also carries its sound times (final review I1), equal to its shown times.
    const tl = buildTimeline(film, { fps: film.fps });
    assert.deepEqual(pictureOnly(tl), frozen);
    assert.deepEqual(pictureOnly(buildTimeline(film, { fps: film.fps, words: undefined })), frozen);
    assert.equal(JSON.stringify(pictureOnly(buildTimeline(film, { fps: film.fps, words: undefined }))), JSON.stringify(frozen), 'same keys in the same order');
    for (const w of tl.shots.flatMap((sh) => sh.words)) assert.deepEqual([w.soundStart, w.soundEnd], [w.start, w.end], w.text);
  });
}

// --- with words ---

test('the fixture sidecar is a valid sidecar of the fixture film', () => {
  assert.doesNotThrow(() => validateSidecar(SIDECAR, FILM));
});

test('with words the timeline is measured and each word time is the sidecar time from the shot start, the first word aside', () => {
  const tl = measured();
  assert.equal(tl.timed, 'measured');
  SIDECAR.shots.forEach((sidecarShot, i) => {
    const expected = flatWords(sidecarShot).map((w) => {
      const [start, end] = [w.start + NARRATION_LEAD, w.end + NARRATION_LEAD];
      return { text: w.text, start, end, soundStart: start, soundEnd: end, emphasis: w.emphasis, aside: w.aside };
    });
    assert.deepEqual(tl.shots[i].words.slice(1), expected.slice(1), `shot ${sidecarShot.id}`);
    if (expected.length > 0) assert.deepEqual(tl.shots[i].words[0], { ...expected[0], start: 0 }, `shot ${sidecarShot.id}: first word`);
  });
});

test('a measured shot shows its first word from its first frame: its visual start is the shot start, its sound follows', () => {
  const tl = measured();
  SIDECAR.shots.forEach((sidecarShot, i) => {
    if (sidecarShot.wav === null) return;
    assert.ok(flatWords(sidecarShot)[0].start > 0, `the fixture's first word of ${sidecarShot.id} is heard after the shot starts`);
    assert.equal(tl.shots[i].start + tl.shots[i].words[0].start, tl.shots[i].start, `${sidecarShot.id}: the first word is shown from the shot's start`);
    assert.equal(anchorSeconds('word:0', tl.shots[i]), 0, `${sidecarShot.id}: an anchor on the first word is the shot's start`);
    assert.equal(tl.shots[i].sentences[0].start, 0, `${sidecarShot.id}: so is the first sentence`);
  });
  const estimated = buildTimeline(FILM, { fps: FPS });
  assert.deepEqual(estimated.shots[0].words, buildTimeline(FILM, { fps: FPS, words: undefined }).shots[0].words, 'the estimated path is unchanged');
});

test('word:<n>, word:<text> and sentence:<n> anchors resolve to the measured times', () => {
  const [open, , close] = measured().shots;
  const openWords = flatWords(SIDECAR.shots[0]);
  assert.equal(anchorSeconds('word:3', open), openWords[3].start);
  assert.equal(anchorSeconds('word:answer', open), openWords.find((w) => w.text === 'answer').start);
  assert.equal(anchorSeconds('sentence:1', open), SIDECAR.shots[0].sentences[1].start);
  assert.equal(anchorSeconds('word:files', close), flatWords(SIDECAR.shots[2]).find((w) => w.text === 'files,').start);
  const estimated = buildTimeline(FILM, { fps: FPS }).shots[0];
  assert.notEqual(anchorSeconds('word:3', estimated), anchorSeconds('word:3', open), 'the fixture times differ from the estimate');
});

test('a narrated shot lasts its last measured word end plus the trailing pause and the tail, rounded up to a frame', () => {
  const tl = measured();
  const lastEnd = (i) => flatWords(SIDECAR.shots[i]).at(-1).end;
  assert.equal(tl.shots[0].duration, frameCeil(lastEnd(0) + PRO_TAIL));
  assert.equal(tl.shots[1].duration, FILM.shots[1].hold, 'a shot without say keeps its hold');
  assert.equal(tl.shots[2].duration, frameCeil(lastEnd(2) + PRO_TAIL));
  assert.equal(tl.shots[1].start, tl.shots[0].end);
  assert.equal(tl.frameCount, Math.round(tl.duration * FPS));
});

test('a trailing pause in the say is added after the last measured word, before the tail', () => {
  const film = { mode: 'pro', shots: [{ id: 'a', say: 'Two words. (1.0)' }] };
  const words = [{ id: 'a', wav: 'shot-0.wav', seconds: 0.9, sentences: [{ start: 0.1, end: 0.8, words: [
    { text: 'Two', start: 0.1, end: 0.4, emphasis: false, aside: false },
    { text: 'words.', start: 0.4, end: 0.8, emphasis: false, aside: false },
  ] }] }];
  assert.equal(buildTimeline(film, { fps: FPS, words }).shots[0].duration, frameCeil(0.8 + 1.0 + PRO_TAIL));
});

test('a shot is never shorter than its WAV, so its narration cannot run into the next shot', () => {
  const longWav = SIDECAR.shots.map((s, i) => (i === 0 ? { ...s, seconds: flatWords(s).at(-1).end + 2 } : s));
  const shot = measured(longWav).shots[0];
  assert.ok(shot.duration >= NARRATION_LEAD + longWav[0].seconds, `${shot.duration} covers ${longWav[0].seconds}`);
});

test('measured sentences carry start, end and the indexes of their first and last words', () => {
  const open = measured().shots[0];
  assert.deepEqual(open.sentences, SIDECAR.shots[0].sentences.map((s, k, all) => {
    const first = all.slice(0, k).reduce((n, x) => n + x.words.length, 0);
    return { start: k === 0 ? 0 : s.start, end: s.end, first, last: first + s.words.length - 1 }; // the first word shows from the shot start
  }));
});

test('narrationStart is the film second a shot narration starts at: the shot start, estimated or measured', () => {
  assert.equal(NARRATION_LEAD, 0);
  for (const tl of [measured(), buildTimeline(FILM, { fps: FPS })]) {
    for (const shot of tl.shots) assert.equal(narrationStart(shot), shot.start + NARRATION_LEAD);
  }
});

test('words that do not match the film are an error, never a quiet fall back to the estimate', () => {
  assert.throws(() => measured(SIDECAR.shots.slice(0, 2)), /words: 2 shots, the film has 3/);
  const renamed = SIDECAR.shots.map((s, i) => (i === 2 ? { ...s, id: 'other' } : s));
  assert.throws(() => measured(renamed), /words\[2\]: shot "other", the film's shot is "close"/);
  const short = SIDECAR.shots.map((s, i) => (i === 0 ? { ...s, sentences: s.sentences.slice(0, 1) } : s));
  assert.throws(() => measured(short), /words\[0\]: 5 words, the say of shot "open" has 9/);
  assert.throws(() => buildTimeline(FILM, { fps: FPS, words: 'voice.json' }), TypeError);
});

test('what is emphasised is the film\'s: emphasis and aside come from the say, not from the sidecar', () => {
  const flipped = SIDECAR.shots.map((s) => ({ ...s, sentences: s.sentences.map((sentence) => ({
    ...sentence, words: sentence.words.map((w) => ({ ...w, emphasis: !w.emphasis, aside: !w.aside })),
  })) }));
  const estimated = buildTimeline(FILM, { fps: FPS });
  measured(flipped).shots.forEach((shot, i) => {
    assert.deepEqual(shot.words.map((w) => [w.emphasis, w.aside]), estimated.shots[i].words.map((w) => [w.emphasis, w.aside]));
  });
});

test('a sidecar shot whose WAV length is not a number is an error, not a shot with no floor', () => {
  const broken = SIDECAR.shots.map((s, i) => (i === 0 ? { ...s, seconds: Number.NaN } : s));
  assert.throws(() => measured(broken), /words\[0\]: seconds must be the WAV's length in seconds, got NaN/);
});

test('buildTimeline does not change the words it is given', () => {
  const words = structuredClone(SIDECAR.shots);
  measured(words);
  assert.deepEqual(words, SIDECAR.shots);
});

// --- a kind's minimum length (minSeconds): the walk shot stretches to its steps; nothing else moves ---

const EXAMPLES = path.join(SKILL, 'references/examples/v2');
const TAKE = prepareWalk({ src: 'walk-take' }, { filmDir: EXAMPLES }).data;
const WALK_IDS = TAKE.steps.map((s) => s.id);
// a stub registry whose `walk` kind reads the plan as the real kind will (Task 5 registers it)
const walkKinds = (calls = []) => {
  const kinds = createRegistry('kind');
  kinds.add('walk', { minSeconds: (shot, ctx) => { calls.push({ shot, ctx }); return walkMinSeconds(shot, ctx, { lifts: shot.lift }); } });
  return kinds;
};
const walkFilm = (say, extra = {}) => ({ version: 2, mode: 'pro', shots: [
  { id: 'intro', show: 'statement', say: 'Before the walk.' },
  { id: 'w', show: 'walk', src: 'walk-take', steps: WALK_IDS.map((id) => ({ id })), say, ...extra },
  { id: 'after', show: 'statement', say: 'After the walk.' },
] });
const FIVE_SHORT = 'Open it. Tab. Type. Hover. Add.';
const walkShot = (tl) => tl.shots[1];
const natural = (film) => buildTimeline(film, { fps: FPS, kinds: createRegistry('kind') });
const stretched = (film, options = {}) => buildTimeline(film, { fps: FPS, kinds: walkKinds(), prepared: { w: TAKE }, ...options });
const walkEnd = (film, tl) => walkPlan(film.shots[1], walkShot(tl), TAKE).end; // the plan on the shot's own sentences

test('a walk shot shorter than its steps lasts until the last step\'s hold ends, rounded up to a frame', () => {
  const film = walkFilm(FIVE_SHORT);
  const base = natural(film);
  const tl = stretched(film);
  const want = walkEnd(film, base);
  assert.ok(want > walkShot(base).duration, 'the fixture says too little for the take, so the shot must stretch');
  assert.equal(walkShot(tl).duration, frameCeil(want));
  assert.equal(walkShot(tl).end, walkShot(tl).start + frameCeil(want));
  assert.equal(tl.shots[2].start, walkShot(tl).end, 'the shot after moves with it');
  assert.equal(tl.shots[0].duration, base.shots[0].duration, 'the shot before does not move');
});

test('a walk shot longer than its steps is not shortened', () => {
  const long = 'Open it. Then the tab, with a long sentence about the tab and what it holds. Then type a number into the search field, slowly and with care. Then hover a card. Last of all add the new card to the list.';
  const film = walkFilm(long);
  const base = natural(film);
  const tl = stretched(film);
  assert.ok(walkEnd(film, base) < walkShot(base).duration, 'the words outlast the steps');
  assert.deepEqual(tl, base);
});

test('the shot\'s sentences and words, in the timeline, are the voice\'s own: the stretch moves no word', () => {
  const film = walkFilm(FIVE_SHORT);
  const [a, b] = [natural(film), stretched(film)];
  assert.deepEqual(walkShot(b).words, walkShot(a).words);
  assert.deepEqual(walkShot(b).sentences, walkShot(a).sentences);
});

test('a measured walk shot stretches too', () => {
  const film = walkFilm(FIVE_SHORT);
  const voiced = (id, say, step = 0.5) => ({ id, seconds: 3, sentences: [{ words: say.split(' ').map((text, i) => ({ text, start: 0.2 + i * step, end: 0.2 + i * step + 0.3 })) }] });
  const words = [voiced('intro', 'Before the walk.'), voiced('w', FIVE_SHORT), voiced('after', 'After the walk.')];
  const base = buildTimeline(film, { fps: FPS, words, kinds: createRegistry('kind') });
  const tl = buildTimeline(film, { fps: FPS, words, kinds: walkKinds(), prepared: { w: TAKE } });
  assert.equal(tl.timed, 'measured');
  assert.equal(walkShot(tl).duration, frameCeil(walkPlan(film.shots[1], walkShot(base), TAKE).end));
  assert.ok(walkShot(tl).duration > walkShot(base).duration);
});

test('the hook is given the shot, its sentences and words, the natural seconds, the prepared data and the look; only for its own kind', () => {
  const calls = [];
  stretched(walkFilm(FIVE_SHORT), { kinds: walkKinds(calls) });
  assert.equal(calls.length, 1);
  const { shot, ctx } = calls[0];
  assert.equal(shot.id, 'w');
  assert.equal(ctx.sentences.length, 5);
  assert.equal(ctx.words.length, 6);
  assert.equal(ctx.prepared, TAKE);
  const naturalSeconds = walkShot(natural(walkFilm(FIVE_SHORT))).duration;
  assert.ok(ctx.seconds <= naturalSeconds && ctx.seconds > naturalSeconds - 1 / FPS, 'seconds is the natural length, before it is rounded to frames');
  assert.equal(ctx.look, registries.looks.get(registries.modes.get('pro').defaultLook));
});

test('a walk shot with no prepared data, a kind with no hook, or a kind not registered keeps its natural length', () => {
  const film = walkFilm(FIVE_SHORT);
  const base = natural(film);
  assert.deepEqual(stretched(film, { prepared: undefined }), base);
  assert.deepEqual(stretched(film, { prepared: {} }), base);
  const bare = createRegistry('kind');
  bare.add('walk', {});
  assert.deepEqual(stretched(film, { kinds: bare }), base);
});

test('a walk shot whose steps do not fit the take is not stretched (the validator names the problem)', () => {
  const film = walkFilm(FIVE_SHORT, { steps: [{ id: 'open' }, { id: 'nope' }] });
  assert.deepEqual(stretched(film), natural(film));
});

test('a say-less walk shot lasts its steps back to back', () => {
  const film = { version: 2, mode: 'pro', shots: [{ id: 'w', show: 'walk', src: 'walk-take', steps: WALK_IDS.map((id) => ({ id })) }] };
  const tl = buildTimeline(film, { fps: FPS, kinds: walkKinds(), prepared: { w: TAKE } });
  const plan = walkPlan(film.shots[0], { words: [], sentences: [], duration: 2 }, TAKE);
  assert.equal(tl.shots[0].duration, frameCeil(plan.end));
});

test('a lift the shot lists holds its step, so the shot grows with it', () => {
  const film = walkFilm(FIVE_SHORT, { lift: [{ step: 'add', hold: 4 }] });
  const lifted = stretched(film);
  assert.ok(walkShot(lifted).duration >= walkShot(stretched(walkFilm(FIVE_SHORT))).duration + 4);
});

test('no existing film moves: every example film\'s timeline is the one frozen before the hook, hooked registry or not', () => {
  const frozen = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const names = exampleFiles();
  assert.ok(names.length > 20);
  for (const name of names) {
    const { film } = loadFilm(path.join(EXAMPLES, name));
    for (const options of [{}, { prepared: {}, kinds: walkKinds() }, { prepared: { nothing: TAKE }, kinds: walkKinds() }]) {
      const tl = buildTimeline(film, { fps: film.fps, modes: registries.modes, ...options });
      assert.equal(firstDifference(digestOf(tl), frozen[name]), null, name);
    }
  }
});

test('the comparison above can fail: a hook on a kind the examples use does move their shots', () => {
  const frozen = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const kinds = createRegistry('kind');
  kinds.add('statement', { minSeconds: () => 99 });
  const { film } = loadFilm(path.join(EXAMPLES, 'gate-desk.json'));
  const tl = buildTimeline(film, { fps: film.fps, modes: registries.modes, kinds });
  assert.notEqual(firstDifference(digestOf(tl), frozen['gate-desk.json']), null);
});

test('buildTimeline with the hook does not call a kind that is not in the film, nor touch `prepared`', () => {
  const calls = [];
  const prepared = Object.freeze({});
  buildTimeline(FILM, { fps: FPS, kinds: walkKinds(calls), prepared });
  assert.equal(calls.length, 0);
});

