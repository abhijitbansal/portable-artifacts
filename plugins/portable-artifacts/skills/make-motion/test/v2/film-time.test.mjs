// Film time (scripts/v2/film-time.mjs): one grammar that names a moment of the film (a number of seconds, a shot, a place
// in a shot, an anchor across the whole film), read by --poster. No browser, no ffmpeg, no voice package.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { buildTimeline } from '../../engine/script/timing.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { FilmTimeError, checkFilmTime, filmFrame, filmSeconds, wholeFilmShot } from '../../scripts/v2/film-time.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const FPS = 30;
const SHOTS = [
  { id: 'hook', show: 'statement', say: 'Numbers need sources.' },
  { id: 'rows', show: 'statement', text: 'Four rows.', hold: 2 },
];
const film = { version: 2, mode: 'pro', fps: FPS, shots: SHOTS };
const timeline = buildTimeline(film, { fps: FPS });
const calledEnd = { version: 2, mode: 'pro', fps: FPS, shots: [{ id: 'intro', show: 'statement', text: 'Intro.', hold: 2 }, { id: 'end', show: 'statement', text: 'End.', hold: 2 }] };
const calledEndTimeline = buildTimeline(calledEnd, { fps: FPS });
// A J cut: "rows" starts its narration 0.5 s before its picture, so its first word is heard in "hook".
const SPOKEN = 'Four hundred rows in one single file, nothing else is here.';
const shifted = { version: 2, mode: 'pro', fps: FPS, shots: [SHOTS[0], { id: 'rows', show: 'statement', say: SPOKEN, narration: { lead: 0.5 } }] };
const shiftedTimeline = buildTimeline(shifted, { fps: FPS });

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-film-time-')); });
after(() => rmSync(dir, { recursive: true, force: true }));
const writeFilm = (name, spec) => {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(spec));
  return file;
};

// Anchors are rounded to a microsecond (anchors.mjs), so a time built from them is compared to a microsecond.
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < NEAR, `${message ?? ''} ${actual} is not ${expected}`);
const NEAR = 1e-5;

test('a number is seconds; a shot id is its start; shot@anchor is inside that shot', () => {
  assert.equal(filmSeconds('1.5', film, timeline), 1.5);
  assert.equal(filmSeconds(1.5, film, timeline), 1.5);
  assert.equal(filmSeconds('rows', film, timeline), timeline.shots[1].start);
  near(filmSeconds('rows@end-0.5', film, timeline), timeline.shots[1].start + 1.5);
  near(filmSeconds('hook@word:1', film, timeline), timeline.shots[0].start + timeline.shots[0].words[1].start);
});

test('a film-wide anchor counts words across the film', () => {
  near(filmSeconds('word:2', film, timeline), timeline.shots[0].words[2].soundStart);
  near(filmSeconds('end', film, timeline), timeline.duration);
  near(filmSeconds('end-1', film, timeline), timeline.duration - 1);
  near(filmSeconds('sentence:0', film, timeline), timeline.shots[0].words[0].soundStart);
});

test('a word of the film is where it is heard: shot.start + soundStart, which a narration lead puts before its shot', () => {
  const rows = shiftedTimeline.shots[1];
  assert.equal(rows.words[0].soundStart, -0.5, 'the fixture really is shifted');
  near(filmSeconds('word:3', shifted, shiftedTimeline), rows.start - 0.5);
  assert.ok(filmSeconds('word:3', shifted, shiftedTimeline) < rows.start);
});

test('shot@word is where the picture shows the word (the shot\'s own anchor), not where it is heard', () => {
  const rows = shiftedTimeline.shots[1];
  near(filmSeconds('rows@word:0', shifted, shiftedTimeline), rows.start + rows.words[0].start);
  assert.notEqual(rows.words[0].start, rows.words[0].soundStart);
});

test('a shot called end is the shot, not the film end', () => {
  assert.equal(filmSeconds('end', calledEnd, calledEndTimeline), calledEndTimeline.shots[1].start);
  assert.notEqual(filmSeconds('end', calledEnd, calledEndTimeline), calledEndTimeline.duration);
  near(filmSeconds('end@end', calledEnd, calledEndTimeline), calledEndTimeline.shots[1].start + 2);
  near(filmSeconds('end-0.5', calledEnd, calledEndTimeline), calledEndTimeline.duration - 0.5, 'only the bare id is the shot');
});

test('wholeFilmShot: the film as one shot, its words as heard', () => {
  const whole = wholeFilmShot(shiftedTimeline);
  assert.equal(whole.id, 'film');
  assert.equal(whole.duration, shiftedTimeline.duration);
  assert.equal(whole.words.length, shiftedTimeline.shots.flatMap((s) => s.words).length);
  near(whole.words[3].start, shiftedTimeline.shots[1].start - 0.5);
});

test('an unknown shot lists the shots and the forms', () => {
  assert.throws(() => filmSeconds('nope@start', film, timeline), (err) => err instanceof FilmTimeError && /the shots are: hook, rows/.test(err.hint) && /word:<n>/.test(err.hint));
  assert.throws(() => filmSeconds('nope', film, timeline), (err) => err instanceof FilmTimeError && /nope/.test(err.message));
  assert.throws(() => filmSeconds('', film, timeline), FilmTimeError);
  assert.throws(() => filmSeconds('rows@', film, timeline), FilmTimeError);
});

test('the hint is the one sentence the plan fixes', () => {
  assert.throws(() => filmSeconds('nope', film, timeline), (err) => err.hint === 'use a number of seconds, "<shot-id>", "<shot-id>@<anchor>" or a film-wide anchor; '
    + 'the shots are: hook, rows; an anchor is start, end, word:<n>, word:<text> or sentence:<n>, with an optional +<s> or -<s>');
});

test('an anchor that names nothing in its shot is a film-time error with the anchor\'s own words', () => {
  assert.throws(() => filmSeconds('hook@word:9', film, timeline), (err) => err instanceof FilmTimeError && /out of range/.test(err.message) && /the shots are/.test(err.hint));
  assert.throws(() => filmSeconds('rows@word:0', film, timeline), (err) => err instanceof FilmTimeError && /no narration/.test(err.message));
  assert.throws(() => filmSeconds('word:99', film, timeline), (err) => err instanceof FilmTimeError && /out of range/.test(err.message));
});

test('past the end names the film length; before the start is refused too', () => {
  assert.throws(() => filmFrame('99', film, timeline), /past the end \(the film is \d+\.\d s\)/);
  assert.throws(() => filmFrame('end+3', film, timeline), /past the end/);
  assert.throws(() => filmFrame('rows@start-9', film, timeline), (err) => err instanceof FilmTimeError && /before the start/.test(err.message));
});

test('filmFrame is round(seconds * fps), and the last frame is allowed', () => {
  assert.equal(filmFrame('1.5', film, timeline), 45);
  assert.equal(filmFrame('rows', film, timeline), Math.round(timeline.shots[1].start * FPS));
  assert.equal(filmFrame('0', film, timeline), 0);
  assert.equal(Object.is(filmFrame('0', film, timeline), 0), true);
  assert.equal(filmFrame(String((timeline.frameCount - 1) / FPS), film, timeline), timeline.frameCount - 1);
});

test('checkFilmTime reads the reference on the estimated timeline and throws what filmSeconds would', () => {
  assert.doesNotThrow(() => checkFilmTime('rows@end-0.5', film));
  assert.doesNotThrow(() => checkFilmTime('99', film), 'past the end is judged on the measured timeline, not the estimate');
  assert.throws(() => checkFilmTime('nope', film), FilmTimeError);
  assert.throws(() => checkFilmTime('hook@word:9', film), FilmTimeError);
});

test('make.mjs --poster nope exits 2 with the accepted list and starts no browser', () => {
  const run = spawnSync(process.execPath, [MAKE, writeFilm('gate', film), '--poster', 'nope', '--json'], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '/nonexistent' },
  });
  assert.equal(run.status, 2, run.stdout + run.stderr);
  assert.match(JSON.parse(run.stdout).error.hint, /the shots are: hook, rows/);
});

// ---- a bad reference is refused before any voice is made ----

const voiced = { version: 2, mode: 'pro', fps: FPS, voice: { name: 'af_heart' }, shots: SHOTS };
const options = (specPath, poster) => ({ specPath, out: path.join(dir, 'out', 'film.mp4'), exact: false, noRender: false, outline: false, poster, posterOut: null });
const spy = (calls) => async () => {
  calls.push('voice');
  throw Object.assign(new Error('the voice package is not installed'), { hint: 'install it' });
};

test('--poster with a bad reference on a voiced film is refused before the voice is made', async () => {
  const calls = [];
  const { report, exitCode } = await runMake(options(writeFilm('voiced-bad', voiced), 'nope'), { synthesise: spy(calls) });
  assert.equal(exitCode, 2);
  assert.deepEqual(calls, [], 'the synthesiser is never asked');
  assert.match(report.error.message, /nope/);
  assert.match(report.error.hint, /the shots are: hook, rows/);
  assert.equal(report.stages.some((s) => s.name === 'voice'), false);
});

test('a reference that names nothing in the film is refused before the voice, too', async () => {
  const calls = [];
  const { report, exitCode } = await runMake(options(writeFilm('voiced-bad-word', voiced), 'hook@word:9'), { synthesise: spy(calls) });
  assert.equal(exitCode, 2);
  assert.deepEqual(calls, []);
  assert.match(report.error.hint, /the shots are/);
});

test('a good reference on a voiced film reaches the voice (the spy proves the check above is what stopped the bad one)', async () => {
  const calls = [];
  const { report, exitCode } = await runMake(options(writeFilm('voiced-good', voiced), 'rows@end-0.5'), { synthesise: spy(calls) });
  assert.equal(exitCode, 2);
  assert.deepEqual(calls, ['voice']);
  assert.match(report.error.message, /voice package is not installed/);
});
