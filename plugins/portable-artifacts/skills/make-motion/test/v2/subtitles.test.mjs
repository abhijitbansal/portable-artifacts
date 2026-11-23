// --subtitles srt|vtt (scripts/v2/subtitles.mjs): a caption file beside the MP4, one cue per sentence (split past
// MAX_CUE_WORDS), timed by when each word is heard: measured with a voice, the word-count estimate without one (and a
// VTT then says so in a NOTE; SRT has no comment line, so an estimated SRT is refused). No browser for the unit tests.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable } from './helpers/session.mjs';
import { MAX_CUE_WORDS, subtitleCues, subtitleText, writeSubtitles, ESTIMATE_NOTE } from '../../scripts/v2/subtitles.mjs';
import { parseMakeArgs } from '../../scripts/v2/cli.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const word = (text, soundStart, soundEnd) => ({ text, soundStart, soundEnd, start: soundStart, end: soundEnd });
const TIMELINE = { timed: 'measured', shots: [
  { id: 'a', start: 0, end: 2, words: [word('Hello', 0.1, 0.4), word('world.', 0.45, 0.9), word('Again.', 1.2, 1.6)], sentences: [{ first: 0, last: 1 }, { first: 2, last: 2 }] },
  { id: 'b', start: 2, end: 4, words: [], sentences: [] },
  { id: 'c', start: 4, end: 6, words: [word('Last', 0.2, 0.5), word('one.', 0.55, 1)], sentences: [{ first: 0, last: 1 }] },
] };

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-subtitles-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

test('one cue per sentence, at film time, from the first word heard to the last', () => {
  assert.deepEqual(subtitleCues(TIMELINE), [
    { start: 0.1, end: 0.9, text: 'Hello world.' },
    { start: 1.2, end: 1.6, text: 'Again.' },
    { start: 4.2, end: 5, text: 'Last one.' },
  ]);
});

test('a sentence longer than MAX_CUE_WORDS is split into cues of at most that many words', () => {
  const words = Array.from({ length: MAX_CUE_WORDS + 3 }, (_, i) => word(`w${i}`, i * 0.3, i * 0.3 + 0.2));
  const cues = subtitleCues({ timed: 'measured', shots: [{ id: 'a', start: 0, end: 9, words, sentences: [{ first: 0, last: words.length - 1 }] }] });
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text.split(' ').length, MAX_CUE_WORDS);
  assert.equal(cues[1].start, MAX_CUE_WORDS * 0.3);
});

test('SRT: numbered cues with comma milliseconds; VTT: the header, dot milliseconds', () => {
  const srt = subtitleText(TIMELINE, 'srt');
  assert.match(srt, /^1\n00:00:00,100 --> 00:00:00,900\nHello world\.\n\n2\n00:00:01,200 --> 00:00:01,600\nAgain\.\n\n3\n00:00:04,200 --> 00:00:05,000\nLast one\.\n$/);
  const vtt = subtitleText(TIMELINE, 'vtt');
  assert.match(vtt, /^WEBVTT\n\n00:00:00\.100 --> 00:00:00\.900\nHello world\.\n\n/);
  assert.ok(!vtt.includes('NOTE'), 'measured times need no note');
});

test('estimated times: the VTT says so in a NOTE; an SRT is refused because it has no comment line', () => {
  const estimated = { ...TIMELINE, timed: 'estimated' };
  assert.match(subtitleText(estimated, 'vtt'), new RegExp(`^WEBVTT\\n\\nNOTE ${ESTIMATE_NOTE}\\n\\n`));
  assert.throws(() => subtitleText(estimated, 'srt'), /SRT has no comment line.*--subtitles vtt/);
});

test('a cue holds no markup the player would read: < and & are written as text', () => {
  const t = { timed: 'measured', shots: [{ id: 'a', start: 0, end: 2, words: [word('<b>x</b>', 0, 0.5), word('&', 0.6, 0.8)], sentences: [{ first: 0, last: 1 }] }] };
  assert.match(subtitleText(t, 'vtt'), /&lt;b&gt;x&lt;\/b&gt; &amp;/);
});

test('make.mjs --subtitles vtt on a silent film writes the file beside the MP4 path with the estimate note', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const film = path.join(dir, 'film.json');
  writeFileSync(film, JSON.stringify({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'Every row has a source.' }] }));
  const run = spawnSync(process.execPath, [MAKE, film, '--subtitles', 'vtt', '--no-render', '--json'], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const report = JSON.parse(run.stdout);
  const file = path.join(dir, 'out', 'film.vtt');
  assert.deepEqual(report.subtitles, { file, format: 'vtt', timed: 'estimated', level: 'sentence' });
  assert.match(readFileSync(file, 'utf8'), /NOTE /);
  const srt = spawnSync(process.execPath, [MAKE, film, '--subtitles', 'srt', '--no-render'], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(srt.status, 2);
  assert.equal(existsSync(path.join(dir, 'out', 'film.srt')), false);
  return undefined;
});

// ---- --subtitle-words: one cue per word, at the film second it is heard ----

// duration 4. a: start 0, one [0-0.4] two [0.5-0.9] three [1.5-1.9]; b: start 2.0, four [-0.3-0.1] (leads its cut), five [0.2-0.6]
const WORDS = { timed: 'measured', duration: 4, shots: [
  { id: 'a', start: 0, end: 2, words: [word('one', 0, 0.4), word('two', 0.5, 0.9), word('three', 1.5, 1.9)], sentences: [{ first: 0, last: 2 }] },
  { id: 'b', start: 2, end: 4, words: [word('four', -0.3, 0.1), word('five', 0.2, 0.6)], sentences: [{ first: 0, last: 1 }] },
] };

test('word level: one cue per word, at film time', () => {
  assert.deepEqual(subtitleCues(WORDS, { level: 'word' }).slice(0, 2), [{ start: 0, end: 0.4, text: 'one' }, { start: 0.5, end: 0.9, text: 'two' }]);
});

test('a word that leads its cut sorts where it is heard, and the word before it ends there', () => {
  const cues = subtitleCues(WORDS, { level: 'word' });
  assert.deepEqual(cues.map((c) => c.text), ['one', 'two', 'three', 'four', 'five']);
  assert.deepEqual(cues[2], { start: 1.5, end: 1.7, text: 'three' });
  assert.deepEqual(cues[3], { start: 1.7, end: 2.1, text: 'four' });
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end);
});

test('no cue leaves the film: a trailing word is cut at the duration, one wholly outside is dropped, a negative start is held at 0', () => {
  const t = { timed: 'measured', duration: 4, shots: [
    { id: 'a', start: 0, end: 2, words: [word('early', -0.2, 0.3)], sentences: [] },
    { id: 'b', start: 3, end: 4, words: [word('tail', 0.8, 1.4), word('gone', 1.2, 1.6), word('silent', 0.9, 0.9)], sentences: [] },
  ] };
  assert.deepEqual(subtitleCues(t, { level: 'word' }), [{ start: 0, end: 0.3, text: 'early' }, { start: 3.8, end: 4, text: 'tail' }]);
});

test('through buildTimeline: a shot with narration.lead hears its first word before its picture starts', () => {
  const film = (extra) => ({ version: 2, mode: 'pro', shots: [
    { id: 'a', show: 'statement', say: 'One two three four five six.' },
    { id: 'b', show: 'statement', say: 'Seven eight nine ten eleven twelve.', ...extra },
  ] });
  const timeline = buildTimeline(film({ narration: { lead: 0.5 } }), { fps: 30 });
  const cues = subtitleCues(timeline, { level: 'word' });
  assert.ok(cues.find((c) => c.text === 'Seven').start < timeline.shots[1].start);
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end - 1e-9, 'cues run forward');
});

test('estimated word times say so in the VTT; an estimated SRT is refused', () => {
  const estimated = { ...WORDS, timed: 'estimated' };
  assert.match(subtitleText(estimated, 'vtt', { level: 'word' }), /^WEBVTT\n\nNOTE the word times are estimated from the word count: the film has no voice to measure them by\n\n/);
  assert.throws(() => subtitleText(estimated, 'srt', { level: 'word' }), /SRT has no comment line/);
});

test('word level writes a numbered SRT of single words', () => {
  assert.match(subtitleText(WORDS, 'srt', { level: 'word' }), /^1\n00:00:00,000 --> 00:00:00,400\none\n\n2\n00:00:00,500 --> 00:00:00,900\ntwo\n\n/);
});

test('--subtitle-words needs --subtitles; with it, subtitleWords is true', () => {
  assert.throws(() => parseMakeArgs(['f.json', '--subtitle-words']), (err) => err instanceof UsageError && /--subtitle-words needs --subtitles/.test(err.message));
  assert.equal(parseMakeArgs(['f.json', '--subtitles', 'vtt', '--subtitle-words']).subtitleWords, true);
  assert.equal(parseMakeArgs(['f.json', '--subtitles', 'vtt']).subtitleWords, false);
});

test('make.mjs --subtitles vtt --subtitle-words writes one cue per word and reports level word', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const film = path.join(dir, 'words.json');
  writeFileSync(film, JSON.stringify({ version: 2, shots: [{ id: 'a', show: 'statement', say: 'Every row has a source.' }] }));
  const run = spawnSync(process.execPath, [MAKE, film, '--subtitles', 'vtt', '--subtitle-words', '--no-render', '--json'], { encoding: 'utf8', timeout: 120_000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.equal(JSON.parse(run.stdout).subtitles.level, 'word');
  const text = readFileSync(path.join(dir, 'out', 'words.vtt'), 'utf8');
  assert.match(text, /NOTE the word times are estimated/);
  assert.equal(text.split('-->').length - 1, 5, 'five words, five cues');
  return undefined;
});

const oneShot = (words) => ({ timed: 'measured', duration: 4, shots: [{ id: 'a', start: 0, end: 4, words, sentences: [] }] });
const noOverlap = (cues) => cues.every((c, i) => c.end > c.start && (i === 0 || c.start >= cues[i - 1].end));

test('words heard at the same second are one cue, their words joined: a merged run reads "$5 million"', () => {
  const cues = subtitleCues(oneShot([word('Cost', 0, 0.8), word('$5', 1, 1.4), word('million', 1, 1.4), word('now', 1.6, 2)]), { level: 'word' });
  assert.deepEqual(cues, [{ start: 0, end: 0.8, text: 'Cost' }, { start: 1, end: 1.4, text: '$5 million' }, { start: 1.6, end: 2, text: 'now' }]);
});

test('words heard within a millisecond of each other are one cue, as equal starts are (float noise from a shot start plus a word time)', () => {
  const cues = subtitleCues(oneShot([word('$5', 1, 1.4), word('million', 1.0004, 1.4), word('now', 1.6, 2)]), { level: 'word' });
  assert.deepEqual(cues, [{ start: 1, end: 1.4, text: '$5 million' }, { start: 1.6, end: 2, text: 'now' }]);
  const apart = subtitleCues(oneShot([word('a', 1, 1.4), word('b', 1.002, 1.4)]), { level: 'word' });
  assert.equal(apart.length, 2, 'two milliseconds apart are two cues');
});

test('a word of one shot and a word of the next heard at the same film second are one cue, in shot order', () => {
  // shot a's word trails into the cut (heard at 2.0 s), shot b's first word starts at its shot start (2.0 s)
  const timeline = { timed: 'measured', duration: 4, shots: [
    { id: 'a', start: 0, end: 2, words: [word('over', 2, 2.4)], sentences: [] },
    { id: 'b', start: 2, end: 4, words: [word('the', 0, 0.4), word('cut', 0.5, 0.9)], sentences: [] },
  ] };
  assert.deepEqual(subtitleCues(timeline, { level: 'word' }), [{ start: 2, end: 2.4, text: 'over the' }, { start: 2.5, end: 2.9, text: 'cut' }]);
});

test('a long word that starts with a shorter one ends where the next cue starts, whichever cue is next', () => {
  // A [1.0-2.0], B [1.0-1.2], C [1.5-1.8]: A and B share a start so they merge; the merged cue stops where C starts
  const cues = subtitleCues(oneShot([word('A', 1, 2), word('B', 1, 1.2), word('C', 1.5, 1.8)]), { level: 'word' });
  assert.deepEqual(cues, [{ start: 1, end: 1.5, text: 'A B' }, { start: 1.5, end: 1.8, text: 'C' }]);
  assert.ok(noOverlap(cues));
});

test('word cues never overlap, even when words come in no order and share starts', () => {
  const cues = subtitleCues(oneShot([word('d', 2, 3), word('a', 0, 3.5), word('b', 0, 0.5), word('c', 1, 1.1), word('e', 2, 2.2)]), { level: 'word' });
  assert.ok(noOverlap(cues), JSON.stringify(cues));
  assert.deepEqual(cues.map((c) => c.text), ['a b', 'c', 'd e']);
});

test('writeSubtitles reports the level it wrote, for both levels, and the files differ', () => {
  const videoOut = path.join(dir, 'unit', 'u.mp4');
  const sentence = writeSubtitles({ timeline: TIMELINE, format: 'vtt', videoOut });
  assert.deepEqual(sentence, { file: path.join(dir, 'unit', 'u.vtt'), format: 'vtt', timed: 'measured', level: 'sentence' });
  const sentenceText = readFileSync(sentence.file, 'utf8');
  const words = writeSubtitles({ timeline: { ...TIMELINE, duration: 6 }, format: 'vtt', videoOut, level: 'word' });
  assert.deepEqual(words, { ...sentence, level: 'word' });
  assert.notEqual(readFileSync(words.file, 'utf8'), sentenceText);
  assert.match(readFileSync(words.file, 'utf8'), /\nHello\n/);
});

test('the sentence form is unchanged by the level argument', () => {
  assert.deepEqual(subtitleCues(TIMELINE, { level: 'sentence' }), subtitleCues(TIMELINE));
});
