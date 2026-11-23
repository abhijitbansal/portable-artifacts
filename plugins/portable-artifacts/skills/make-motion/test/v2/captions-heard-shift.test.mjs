// Sound, captions and the cut-window rule follow the narration shift (a shot's `narration: { lead, trail }`): what is heard
// does not move, the picture's cut does, so the sound readers keep their times, the cut's own cue moves with the picture,
// and a word heard over another shot is captioned by the shot on screen (captionWordsOf, engine/captions/groups.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline } from '../../engine/script/timing.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { buildFilm } from '../../engine/graph/film.mjs';
import { captionGroups, captionWordsOf, groupTimes } from '../../engine/captions/groups.mjs';
import { heardWordSpans } from '../../scripts/v2/sound/duck.mjs';
import { soundEvents } from '../../scripts/v2/sound/events.mjs';
import { subtitleCues } from '../../scripts/v2/subtitles.mjs';
import { voiceTrackArgs } from '../../scripts/v2/voice/master.mjs';
import { cutWindowFindings } from '../../scripts/v2/review.mjs';
import { measure, canvasOf, all } from './helpers/kinds.mjs';

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

test('after a trail every word is at the second it is heard in the shot\'s own seconds, so the groups come in order (a kind that does not show its words)', () => {
  const trailed = build(withOn('a', { narration: { trail: 1 } }));
  const words = captionWordsOf(trailed, 1);
  const heard = (w) => (w.from === undefined ? w.soundStart : w.start);
  words.forEach((w, k) => assert.ok(k === 0 || w.start >= words[k - 1].start - 1e-9, `${w.text} starts after ${words[k - 1]?.text}`));
  const own = words.filter((w) => w.from === undefined);
  own.forEach((w) => assert.ok(Math.abs(w.start - heard(w)) < 1e-9 && Math.abs(w.end - w.soundEnd) < 1e-9, `${w.text}: an own word is at its heard times`));
  assert.ok(Math.abs(own[0].start - trailed.shots[1].narrationAt) < 1e-9, 'the shot\'s first word is heard narrationAt into the picture, not at 0');
  const groups = captionGroups(words, { maxWords: 3, maxChars: 30 });
  const times = groupTimes(groups, { duration: trailed.shots[1].duration, fps: FPS });
  times.forEach((t, k) => assert.ok(k === 0 || t.at >= times[k - 1].at, `group ${k} is not before the group before it`));
  assert.equal(groups[0].words[0].text, 'six.');
  assert.ok(times[0].until >= Math.min(times[0].end + 0.2, times[1].at) - 1e-9, 'the carried word is held to its end, not for one frame');
  assert.ok(times[0].until - times[0].at > 0.2, 'six. is on screen about as long as it is heard');
  assert.ok(Math.abs(times[1].at - trailed.shots[1].narrationAt) < 1e-9, 'the shot\'s own first group opens when its first word is heard');
});

test('a word heard two shots away is captioned: every word of the film by exactly one shot', () => {
  const far = { ...FILM, shots: [FILM.shots[0], { id: 'b', show: 'statement', say: 'Yes.', narration: { lead: 1.4 } }, { ...FILM.shots[2], narration: { lead: 1.5 } }] };
  const timeline = build(far);
  const heardAtFilm = (s, w) => s.start + w.soundStart;
  assert.ok(heardAtFilm(timeline.shots[2], timeline.shots[2].words[0]) < timeline.shots[1].start, 'the fixture: c\'s first word is heard over a, two shots back');
  const onA = captionWordsOf(timeline, 0);
  assert.ok(onA.some((w) => w.text === 'Thirteen' && w.from === 2), 'a captions "Thirteen"');
  const total = timeline.shots.reduce((n, _, i) => n + captionWordsOf(timeline, i).length, 0);
  assert.equal(total, timeline.shots.reduce((n, s) => n + s.words.length, 0));
});

test('a captioned film draws b\'s early words on a, also when a shows its own words (decision 4)', () => {
  const film = { ...star(withOn('b', { narration: { lead: 0.5 } })), captions: true, look: 'desk', format: '16:9', fps: FPS, seed: 1 };
  const timeline = build(film);
  const built = buildFilm({ film, timeline, measure, canvas: canvasOf('16:9') });
  const sampled = built.sampleShot(0, timeline.shots[0].duration - 0.1);
  const card = sampled.find((n) => n.id === 'a.captions');
  assert.ok(card !== undefined, 'a statement shot has a caption node for the neighbour\'s words');
  const captioned = all([card]).filter((n) => n.type === 'text').flatMap((n) => n.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)));
  assert.ok(captioned.includes('SEVEN'), 'the neighbour\'s word is set inside a.captions (the desk look sets caption text in capitals)');
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
