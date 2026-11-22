// J and L cuts: a shot's opt-in `narration: { lead, trail }` moves the seam between two shots by whole frames while the
// sound track stays where it was (engine/script/timing.mjs buildTimeline). The picture's cut moves; every word is heard
// at the film second it was. Without the field, or with zeros, the timeline is today's, with no new key.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMON_SHOT_FIELDS } from '../../scripts/v2/list.mjs'; // also registers the looks, kinds, devices and cuts, as make.mjs does
import { PlacementError, buildTimeline, narrationStart } from '../../engine/script/timing.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const FILM = { version: 2, mode: 'pro', shots: [
  { id: 'a', show: 'statement', say: 'One two three four five six.' },
  { id: 'b', show: 'statement', say: 'Seven eight nine ten eleven twelve.' },
  { id: 'c', show: 'statement', say: 'Thirteen fourteen fifteen sixteen.' },
] };
const withOn = (id, extra) => ({ ...FILM, shots: FILM.shots.map((s) => (s.id === id ? { ...s, ...extra } : s)) });
const build = (film, options = {}) => buildTimeline(film, { fps: FPS, ...options });
const frames = (seconds) => Math.round(seconds * FPS);
const heardAt = (timeline) => timeline.shots.flatMap((s) => s.words.map((w) => Math.round((s.start + w.soundStart) * 1e6)));
const base = build(FILM);

let specDir;
before(() => { specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-narration-shift-')); });
after(() => rmSync(specDir, { recursive: true, force: true }));

test('a lead of 0.5 s on b moves its cut 15 frames later: a is longer, b shorter, the film as long, every word heard when it was', () => {
  const led = build(withOn('b', { narration: { lead: 0.5 } }));
  assert.equal(frames(led.shots[1].start), frames(base.shots[1].start) + 15);
  assert.equal(frames(led.shots[0].duration), frames(base.shots[0].duration) + 15);
  assert.equal(frames(led.shots[1].duration), frames(base.shots[1].duration) - 15);
  assert.equal(led.frameCount, base.frameCount);
  assert.equal(frames(led.shots[2].start), frames(base.shots[2].start));
  assert.deepEqual(heardAt(led), heardAt(base));
  assert.equal(frames(led.shots[1].narrationAt), -15);
  assert.equal(frames(narrationStart(led.shots[1])), frames(narrationStart(base.shots[1])));
  assert.ok(!('narrationAt' in led.shots[0]) && !('narrationAt' in led.shots[2]));
});

test('a trail of 1 s on a moves the same cut 30 frames earlier, b narrates from 1 s into its picture, and a\'s last word is heard over b', () => {
  // the pro mode keeps 0.6 s after a shot's last word (engine/modes/pro.mjs:12), so a trail must be longer than that for a word to cross the cut
  const trailed = build(withOn('a', { narration: { trail: 1 } }));
  assert.equal(frames(trailed.shots[1].start), frames(base.shots[1].start) - 30);
  assert.equal(frames(trailed.shots[1].narrationAt), 30);
  assert.deepEqual(heardAt(trailed), heardAt(base));
  const last = trailed.shots[0].words.at(-1);
  assert.ok(last.soundStart >= trailed.shots[0].duration - 1e-9, 'the fixture: the last word starts after its own picture has gone');
  assert.ok(last.end <= trailed.shots[0].duration + 1e-9, 'its shown time is clamped into the shot');
  const inTail = build(withOn('a', { narration: { trail: 0.4 } }));
  assert.ok(inTail.shots[0].words.at(-1).soundEnd <= inTail.shots[0].duration + 1e-9, 'a trail inside the tail moves the cut into silence: no word crosses');
});

test('the picture never shows a word outside its shot: shown times are clamped, heard times are not', () => {
  const led = build(withOn('b', { narration: { lead: 0.5 } }));
  const [first] = led.shots[1].words;
  assert.equal(first.start, 0);
  assert.ok(first.soundStart < 0);
  for (const shot of led.shots) for (const w of shot.words) assert.ok(w.start >= 0 && w.end <= shot.duration + 1e-9 && w.start <= w.end, `${shot.id} ${w.text}`);
});

test('no narration, and zeros, are today\'s timeline exactly, with no new key', () => {
  assert.deepEqual(build(withOn('b', { narration: { lead: 0, trail: 0 } })), base);
  assert.deepEqual(build(withOn('b', { narration: {} })), base);
  assert.ok(base.shots.every((s) => !('narrationAt' in s)));
});

test('a lead on b and a trail on b move both of b\'s seams: the film is as long and every word is heard when it was', () => {
  const both = build(withOn('b', { narration: { lead: 0.5, trail: 0.2 } }));
  assert.equal(frames(both.shots[1].start), frames(base.shots[1].start) + 15);
  assert.equal(frames(both.shots[2].start), frames(base.shots[2].start) - 6);
  assert.equal(both.frameCount, base.frameCount);
  assert.deepEqual(heardAt(both), heardAt(base));
  assert.equal(frames(both.shots[2].narrationAt), 6);
});

test('the timeline of every example film, built without a voice, is the one frozen before the field existed', () => {
  const frozen = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'timeline-examples-sha.json'), 'utf8'));
  const dir = path.resolve(HERE, '../../references/examples/v2');  const names = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(names, Object.keys(frozen), 'every example has a frozen timeline');
  for (const name of names) {
    const { timeline } = loadFilm(path.join(dir, name));
    const sha = createHash('sha256').update(JSON.stringify(timeline)).digest('hex');
    assert.equal(sha, frozen[name], `${name}: same values, same keys, same order`);
  }
});

test('a measured timeline shifts the same way', () => {
  const words = base.shots.map((s) => ({ id: s.id, seconds: s.words.at(-1).end, sentences: [{ words: s.words.map(({ text, start, end }) => ({ text, start, end })) }] }));
  const plain = build(FILM, { words }), led = build(withOn('b', { narration: { lead: 0.5 } }), { words });
  assert.equal(led.timed, 'measured');
  assert.equal(frames(led.shots[1].start), frames(plain.shots[1].start) + 15);
  assert.deepEqual(heardAt(led), heardAt(plain));
});

test('a measured timeline refuses a shift its shot is too short for, at the field', () => {
  const words = base.shots.map((s) => ({ id: s.id, seconds: s.words.at(-1).end, sentences: [{ words: s.words.map(({ text, start, end }) => ({ text, start, end })) }] }));
  const film = { ...FILM, shots: FILM.shots.map((s) => (s.id === 'b' ? { ...s, narration: { lead: 1.5 } } : s)) };
  const short = words.map((w, k) => (k === 1 ? { ...w, seconds: 0.2, sentences: [{ words: [{ text: 'Seven', start: 0.05, end: 0.15 }, ...w.sentences[0].words.slice(1).map((x) => ({ ...x, start: 0.15, end: 0.15 }))] }] } : w));
  assert.throws(() => build(film, { words: short }), (err) => err instanceof PlacementError && err.errors[0].path === 'shots[1].narration.lead');
});

test('a shift that leaves a shot under 1 s, or under the cut that opens it, is a PlacementError at the field', () => {
  const short = { ...FILM, shots: FILM.shots.map((s) => (s.id === 'b' ? { ...s, say: 'Go.', narration: { lead: 1.5 } } : s)) };
  assert.throws(() => build(short), (err) => err instanceof PlacementError && err.errors[0].path === 'shots[1].narration.lead'
    && /^a lead of 1\.5 s leaves shot "b" [\d.]+ s; a shot lasts at least 1 s$/.test(err.errors[0].message));
  const cut = withOn('b', { cut: { type: 'crossfade', duration: 2 }, narration: { lead: 1.5 } });
  assert.ok(build(withOn('b', { cut: { type: 'crossfade', duration: 2 } })).shots[1].duration - 1.5 < 2, 'the fixture leaves b shorter than its 2 s cut');
  assert.throws(() => build(cut), (err) => /and at least its cut \(2 s\)$/.test(err.errors[0].message));
});

test('a trail longer than its own shot names shots[i].narration.trail', () => {
  const short = { ...FILM, shots: FILM.shots.map((s) => (s.id === 'a' ? { ...s, say: 'Go.', narration: { trail: 1.5 } } : s)) };
  assert.throws(() => build(short), (err) => err instanceof PlacementError && err.errors[0].path === 'shots[0].narration.trail'
    && /^a trail of 1\.5 s leaves shot "a" [\d.]+ s; a shot lasts at least 1 s$/.test(err.errors[0].message));
});

const errorsOf = (film) => validateFilm(film, { specDir }).errors.map((e) => `${e.path}: ${e.message}`);

test('the field is refused where it cannot work, each with its path', () => {
  assert.deepEqual(errorsOf(withOn('a', { narration: { lead: 0.3 } })), ['shots[0].narration.lead: the first shot has nothing before it for its narration to start over; remove "lead"']);
  assert.deepEqual(errorsOf(withOn('c', { narration: { trail: 0.3 } })), ['shots[2].narration.trail: the last shot has nothing after it for its narration to run over; remove "trail"']);
  const held = { ...FILM, shots: [FILM.shots[0], { id: 'b', show: 'statement', text: 'Hold', hold: 2, narration: { lead: 0.3 } }, FILM.shots[2]] };
  assert.deepEqual(errorsOf(held), ['shots[1].narration: a shot with no "say" has no narration to move; remove "narration"']);
  const both = { ...FILM, shots: [{ ...FILM.shots[0], narration: { trail: 0.3 } }, { ...FILM.shots[1], narration: { lead: 0.3 } }, FILM.shots[2]] };
  assert.deepEqual(errorsOf(both), ['shots[1].narration.lead: shot "a" already trails over this cut (its narration.trail); keep one of the two']);
  assert.match(errorsOf(withOn('b', { narration: { lead: 1.6 } })).join('\n'), /^shots\[1\]\.narration\.lead: /);
  assert.match(errorsOf(withOn('b', { narration: { lean: 0.2 } })).join('\n'), /^shots\[1\]\.narration/);
  assert.deepEqual(errorsOf(withOn('b', { narration: { lead: 0.5 } })), []);
});

test('a shift too long for its shot is a validation error, so loadFilm never throws on it', () => {
  const short = { ...FILM, shots: FILM.shots.map((s) => (s.id === 'b' ? { ...s, say: 'Go.', narration: { lead: 1.5 } } : s)) };
  assert.match(errorsOf(short).join('\n'), /^shots\[1\]\.narration\.lead: a lead of 1\.5 s leaves shot "b"/);
});

test('a recorded voice refuses the field', () => {
  const recorded = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'voice', 'film-recording.json'), 'utf8'));
  const film = { ...recorded, shots: recorded.shots.map((s, k) => (k === 2 ? { ...s, narration: { lead: 0.3 } } : s)) };
  assert.ok(errorsOf(film).includes('shots[2].narration: a recording sets where its own words fall; "narration" works with a made voice or with no voice'));
});

test('a made voice takes the field', () => {
  assert.deepEqual(errorsOf({ ...withOn('b', { narration: { lead: 0.5 } }), voice: { name: 'af_heart' } }), []);
});

test('list names the field after cut', () => {
  const names = COMMON_SHOT_FIELDS.map((f) => f.name);
  assert.equal(names[names.indexOf('cut') + 1], 'narration');
});
