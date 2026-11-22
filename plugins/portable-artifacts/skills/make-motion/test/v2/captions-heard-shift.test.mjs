// Sound, captions and the cut-window rule follow the narration shift (a shot's `narration: { lead, trail }`): what is heard
// does not move, the picture's cut does, so the sound readers keep their times, the cut's own cue moves with the picture,
// and a word heard over another shot is captioned by the shot on screen (captionWordsOf, engine/captions/groups.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../../engine/script/timing.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { buildFilm } from '../../engine/graph/film.mjs';
import { captionWordsOf } from '../../engine/captions/groups.mjs';
import { heardWordSpans } from '../../scripts/v2/sound/duck.mjs';
import { soundEvents } from '../../scripts/v2/sound/events.mjs';
import { subtitleCues } from '../../scripts/v2/subtitles.mjs';
import { voiceTrackArgs } from '../../scripts/v2/voice/master.mjs';
import { cutWindowFindings } from '../../scripts/v2/review.mjs';
import { measure, canvasOf } from './helpers/kinds.mjs';

const FPS = 30;
const FILM = { version: 2, mode: 'pro', shots: [
  { id: 'a', show: 'statement', say: 'One two three four five six.' },
  { id: 'b', show: 'statement', say: 'Seven eight nine ten eleven twelve.' },
  { id: 'c', show: 'statement', say: 'Thirteen fourteen fifteen sixteen.' },
] };
const withOn = (id, extra) => ({ ...FILM, shots: FILM.shots.map((s) => (s.id === id ? { ...s, ...extra } : s)) });
const build = (film, options = {}) => buildTimeline(film, { fps: FPS, ...options });
const frames = (seconds) => Math.round(seconds * FPS);
const star = (film) => ({ ...film, shots: film.shots.map((s) => (s.id === 'b' ? { ...s, say: 'Seven *eight* nine ten eleven twelve.' } : s)) });
const led = build(star(withOn('b', { narration: { lead: 0.5 } }))), plain = build(star(FILM));
const round = (list) => JSON.parse(JSON.stringify(list, (k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)));

test('what is heard does not move: the duck spans, the subtitle cues, the emphasis events and the voice track are the unshifted film\'s', () => {
  assert.deepEqual(round(heardWordSpans(led)), round(heardWordSpans(plain)));
  assert.deepEqual(round(subtitleCues(led)), round(subtitleCues(plain)));
  const emphasis = (timeline) => soundEvents(star(FILM), timeline).filter((e) => e.kind === 'emphasis').map((e) => Math.round(e.t * 1e6));
  assert.deepEqual(emphasis(led), emphasis(plain));
  const shots = [{ wav: '/v/a.wav' }, { wav: '/v/b.wav' }, { wav: '/v/c.wav' }];
  assert.deepEqual(voiceTrackArgs({ shots, timeline: led, out: '/v/x.wav' }), voiceTrackArgs({ shots, timeline: plain, out: '/v/x.wav' }));
});

test('the cut\'s own cue follows the picture: it is 0.5 s later', () => {
  const cutAt = (timeline) => soundEvents(star(FILM), timeline).find((e) => e.kind === 'cut' && e.shot === 'b')?.t;
  assert.equal(frames(cutAt(led)), frames(cutAt(plain)) + 15);
});

test('captionWordsOf: with no shift it is the shot\'s own words; with a lead, b\'s early words belong to a', () => {
  plain.shots.forEach((s, i) => assert.deepEqual(captionWordsOf(plain, i), s.words));
  const onA = captionWordsOf(led, 0), onB = captionWordsOf(led, 1);
  const early = onA.filter((w) => w.from === 1);
  assert.ok(early.length >= 1 && early[0].text === 'Seven');
  assert.ok(early.every((w) => w.start >= 0 && w.start < led.shots[0].duration));
  assert.ok(onB.every((w) => w.from === undefined) && !onB.some((w) => w.text === 'Seven'));
  const total = [0, 1, 2].reduce((n, i) => n + captionWordsOf(led, i).length, 0);
  assert.equal(total, led.shots.reduce((n, s) => n + s.words.length, 0), 'every word is captioned by exactly one shot');
});

test('a neighbour\'s word is in the shot\'s own seconds: its start and end are its heard times, and it comes in the order heard', () => {
  const [first] = captionWordsOf(led, 0).filter((w) => w.from === 1);
  const seven = led.shots[1].words[0];
  assert.ok(Math.abs(first.start - (led.shots[1].start + seven.soundStart - led.shots[0].start)) < 1e-9);
  assert.ok(Math.abs(first.end - (led.shots[1].start + seven.soundEnd - led.shots[0].start)) < 1e-9);
  const onA = captionWordsOf(led, 0);
  const heard = (w) => (w.from === undefined ? w.soundStart : w.start); // a neighbour's word already holds its heard second
  onA.forEach((w, k) => assert.ok(k === 0 || heard(w) >= heard(onA[k - 1]) - 1e-9, `${w.text} is heard after ${onA[k - 1]?.text}`));
});

test('with a trail longer than the mode\'s tail, a\'s last word belongs to b', () => {
  const trailed = build(withOn('a', { narration: { trail: 1 } })); // pro keeps 0.6 s after the last word
  assert.ok(trailed.shots[0].words.at(-1).soundStart >= trailed.shots[0].duration - 1e-9, 'the fixture: "six." is heard after a\'s picture');
  assert.ok(captionWordsOf(trailed, 1).some((w) => w.from === 0 && w.text === 'six.'));
  assert.ok(!captionWordsOf(trailed, 0).some((w) => w.text === 'six.'));
  const six = captionWordsOf(trailed, 1).find((w) => w.text === 'six.');
  assert.ok(six.start >= 0 && six.start < trailed.shots[1].duration, 'heard over b: inside b\'s own seconds');
});

test('a captioned film draws b\'s early words on a, also when a shows its own words (decision 4)', () => {
  const film = { ...star(withOn('b', { narration: { lead: 0.5 } })), captions: true, look: 'desk', format: '16:9', fps: FPS, seed: 1 };
  const timeline = build(film);
  const built = buildFilm({ film, timeline, measure, canvas: canvasOf('16:9') });
  const late = JSON.stringify(built.sampleShot(0, timeline.shots[0].duration - 0.1));
  assert.ok(late.includes('a.captions') && /"text":"seven"/i.test(late), 'a statement shot captions the neighbour\'s words (the desk style sets them in capitals)');
  assert.ok(!JSON.stringify(built.sampleShot(1, 0.2)).includes('b.captions'), 'b shows its own words and none was heard over another shot: no captions');
  const before = buildFilm({ film: { ...star(FILM), captions: true, look: 'desk', format: '16:9', fps: FPS, seed: 1 }, timeline: plain, measure, canvas: canvasOf('16:9') });
  assert.ok(!JSON.stringify(before.sampleShot(0, 0.5)).includes('a.captions'), 'a statement with no shift has no captions, as today');
});

test('the cut-window rule reads the shifted shot', () => {
  const cut = { type: 'crossfade', duration: 1 };
  const filmA = withOn('b', { cut }), filmB = withOn('b', { cut, narration: { lead: 1.5 } });
  const tA = build(filmA), tB = build(filmB);
  assert.ok(tA.shots[1].duration >= 2 && tB.shots[1].duration < 2, 'the fixture: b is at least twice its cut before the lead, under twice after');
  assert.deepEqual(cutWindowFindings(filmA, tA), []);
  assert.deepEqual(cutWindowFindings(filmB, tB).map((f) => [f.kind, f.rule, f.path]), [['creative', 'cut-window', 'shots[1].cut']]);
});
