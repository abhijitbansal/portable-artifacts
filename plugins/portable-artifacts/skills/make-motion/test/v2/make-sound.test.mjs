// scripts/make.mjs on a film with sound: the `sound` stage between timeline and review (cues planned from the film's
// events, a bed fitted to its cuts, a music file checked), through runMake in process. Tests that need a browser or
// ffmpeg skip without them (PA_REQUIRE_BROWSER=1 makes that a failure). Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserAvailable, ffmpegOrNull } from './helpers/session.mjs';
import { findFfprobe } from '../../scripts/lib/ffmpeg.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { runMake, makeSound } from '../../scripts/v2/run.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { formatText, NOT_RENDERED_NOTE, soundLine } from '../../scripts/v2/report.mjs';
import { withFilmDefaults } from '../../scripts/v2/spec.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { planCues } from '../../scripts/v2/sound/cues.mjs';
import { fitBeatGrid } from '../../scripts/v2/sound/bed.mjs';
import { writeNoise } from './helpers/clicks.mjs';
import { writeBeatsFile } from '../../scripts/v2/sound/beats-file.mjs';
import { NO_VOICE_NOTE } from '../../scripts/v2/voice/master.mjs';

const FPS = 30;
const SHOTS = [
  { id: 'hook', show: 'statement', say: 'Every chart is a *question*.' },
  { id: 'rows', show: 'number', cut: 'cut', say: 'Four hundred fifty nine rows. One file.', value: 459, label: 'in one file' },
  { id: 'end', show: 'statement', cut: 'cut', say: 'Then the answer arrives.' },
];

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-make-sound-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

const writeFilm = (name, film) => {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(film));
  return file;
};
const run = (specPath, flags = {}, io = {}) => runMake({ specPath, out: path.join(dir, `out-${path.basename(specPath, '.json')}`, 'film.mp4'), exact: false, noRender: true, outline: false, ...flags }, io);
const stagesOf = (report) => report.stages.map((s) => [s.name, s.ok]);
const viral = (extra = {}) => ({ version: 2, mode: 'viral', shots: SHOTS, ...extra });
const pro = (extra = {}) => ({ version: 2, mode: 'pro', shots: SHOTS, ...extra });
// The planned cues and the timeline of `film` as the run makes them (defaults filled, the estimated timeline).
const planOf = (film) => {
  const filled = withFilmDefaults(film);
  const timeline = buildTimeline(filled, { fps: filled.fps });
  return { cues: planCues(filled, timeline), timeline };
};

async function needsBrowser(t) {
  if (!await browserAvailable()) { t.skip('no browser'); return false; }
  return true;
}
async function mediaTools(t) {
  const ffmpeg = await ffmpegOrNull();
  const ffprobe = ffmpeg ? findFfprobe({ ffmpeg }) : null;
  if (!ffmpeg || !ffprobe) { t.skip('no ffmpeg or ffprobe'); return null; }
  return { ffmpeg, ffprobe };
}

test('--no-render on a viral film runs the sound stage before review and reports the planned cue count, unmeasured', async (t) => {
  if (!await needsBrowser(t)) return;
  const film = viral();
  const { report, exitCode } = await run(writeFilm('viral', film));
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.deepEqual(stagesOf(report), [['validate', true], ['timeline', true], ['sound', true], ['review', true]]);
  const planned = planOf(film).cues.length;
  assert.ok(planned > 0);
  assert.deepEqual(report.audio, { lufs: null, truePeakDb: null, note: NOT_RENDERED_NOTE, cues: planned, music: null });
  assert.match(formatText(report, { sheetsDir: '/s' }), new RegExp(`^sound: ${planned} cues$`, 'm'));
});

test('the sound line says nothing about cuts on a beat for a film with no cuts, rather than "0 of 0" (review Minor 13)', () => {
  const bed = { kind: 'bed', bed: 'pulse', bpm: 108, landed: 0, cuts: 0, short: false };
  assert.equal(soundLine({ cues: 0, music: bed }), 'sound: no cues, bed pulse at 108 bpm');
  assert.equal(soundLine({ cues: 2, music: { ...bed, landed: 1, cuts: 3 } }), 'sound: 2 cues, bed pulse at 108 bpm, 1 of 3 cuts on a beat');
});

test('a viral film with nothing to plan reports no audio with --no-render, as its render would (review Minor 10)', async (t) => {
  if (!await needsBrowser(t)) return;
  const film = viral({ shots: [{ id: 'only', show: 'statement', text: 'Quiet.' }] });
  assert.equal(planOf(film).cues.length, 0, 'nothing to plan');
  const { report, exitCode } = await run(writeFilm('viral-quiet', film));
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.equal(report.audio, null);
});

test('a pro film with no sound fields takes no sound stage and reports no audio', async (t) => {
  if (!await needsBrowser(t)) return;
  const { report, exitCode } = await run(writeFilm('pro', pro()));
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.deepEqual(stagesOf(report).map(([name]) => name), ['validate', 'timeline', 'review']);
  assert.equal(report.audio, null);
  assert.doesNotMatch(formatText(report, { sheetsDir: '/s' }), /^sound:/m);
});

test('"music": { "bed": "pulse" } reports the fitted tempo and how many cuts land on a beat, without claiming more', async (t) => {
  if (!await needsBrowser(t)) return;
  const film = pro({ music: { bed: 'pulse' } });
  const { report, exitCode } = await run(writeFilm('pulse', film));
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  const { timeline } = planOf(film);
  const grid = fitBeatGrid(timeline.shots.slice(1).map((s) => s.start), { seconds: timeline.duration, fps: timeline.fps });
  assert.deepEqual(report.audio.music, { kind: 'bed', bed: 'pulse', bpm: grid.bpm, landed: grid.landed, cuts: 2, short: false });
  assert.equal(report.audio.cues, 0, 'pro plays no cues without "sound": "on"');
  assert.match(formatText(report, { sheetsDir: '/s' }), new RegExp(`^sound: no cues, bed pulse at ${grid.bpm} bpm, ${grid.landed} of 2 cuts on a beat$`, 'm'));
});

test('"sound": "off" on a viral film with music takes no sound stage', async (t) => {
  if (!await needsBrowser(t)) return;
  const { report } = await run(writeFilm('off', viral({ sound: 'off', music: { bed: 'drift' } })));
  assert.deepEqual(stagesOf(report).map(([name]) => name), ['validate', 'timeline', 'review']);
  assert.equal(report.audio, null);
});

test('an explicit cue outside the film is an invalid film at its path, found by the sound stage: exit 1, nothing after it', async () => {
  const { report, exitCode } = await run(writeFilm('far-cue', viral({ cues: [{ at: 1, cue: 'pop' }, { at: 999, cue: 'ding' }] })));
  assert.equal(exitCode, 1, JSON.stringify(report));
  assert.deepEqual(report.findings.map((f) => [f.kind, f.path]), [['mechanical', 'cues[1].at']]);
  assert.match(report.findings[0].message, /"ding" lands at 999 s, outside the film/);
  assert.deepEqual(stagesOf(report), [['validate', true], ['timeline', true], ['sound', false]]);
});

test('an ambiguous word anchor in the cue list is an invalid film at its path', async () => {
  const film = viral({ cues: [{ at: 'word:the', cue: 'pop' }], shots: [
    { id: 'a', show: 'statement', say: 'See the chart.' }, { id: 'b', show: 'statement', cut: 'cut', say: 'Read the rows.' },
  ] });
  const { report, exitCode } = await run(writeFilm('ambiguous', film));
  assert.equal(exitCode, 1, JSON.stringify(report));
  assert.deepEqual(report.findings.map((f) => f.path), ['cues[0].at']);
  assert.match(report.findings[0].message, /spoken in more than one shot/);
});

// An HLS playlist naming a segment outside the film folder (voice-external.test.mjs's hostile recording, as music).
function playlistFolder(ffmpeg) {
  const folder = path.join(dir, 'playlist');
  const outside = path.join(dir, 'playlist-outside');
  mkdirSync(folder, { recursive: true });
  mkdirSync(outside, { recursive: true });
  const segment = path.join(outside, 'seg.ts');
  const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=2', '-c:a', 'aac', '-f', 'mpegts', segment], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  writeFileSync(path.join(folder, 'music.m3u8'), `#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:2.0,\n${segment}\n#EXT-X-ENDLIST\n`);
  symlinkSync(segment, path.join(folder, 'seg.ts'));
  return folder;
}

test('a playlist as music.src is an invalid film at music.src, found by the probe before any decode', async (t) => {
  const tools = await mediaTools(t);
  if (!tools) return;
  const folder = playlistFolder(tools.ffmpeg);
  const specPath = path.join(folder, 'film.json');
  writeFileSync(specPath, JSON.stringify(pro({ music: { src: 'music.m3u8' } })));
  const { report, exitCode } = await run(specPath);
  assert.equal(exitCode, 1, JSON.stringify(report));
  assert.deepEqual(report.findings.map((f) => f.path), ['music.src']);
  assert.match(report.findings[0].message, /"music\.m3u8" is in the "hls" format, not plain audio/);
  assert.deepEqual(stagesOf(report), [['validate', true], ['timeline', true], ['sound', false]]);
});

test('a silent music file is an invalid film at music.src from make, before anything is rendered (final review I4)', async (t) => {
  const tools = await mediaTools(t);
  if (!tools) return;
  const folder = path.join(dir, 'silent-music');
  mkdirSync(folder, { recursive: true });
  assert.equal(spawnSync(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '20',
    path.join(folder, 'quiet.wav')]).status, 0);
  const specPath = path.join(folder, 'film.json');
  writeFileSync(specPath, JSON.stringify(pro({ music: { src: 'quiet.wav' } })));
  const { report, exitCode } = await run(specPath);
  assert.equal(exitCode, 1, JSON.stringify(report));
  assert.deepEqual(report.findings.map((f) => f.path), ['music.src']);
  assert.match(report.findings[0].message, /"quiet\.wav" has no sound in its first [\d.]+ s, the film's length/);
  assert.deepEqual(stagesOf(report), [['validate', true], ['timeline', true], ['sound', false]]);
});

test('an interrupt during the sound stage ends the run 130, with what ran before it kept', async () => {
  const controller = new AbortController();
  const log = (line) => { if (line.startsWith('make: timeline ok')) controller.abort(); };
  const { report, exitCode } = await run(writeFilm('stopped', viral()), {}, { signal: controller.signal, log });
  assert.equal(exitCode, 130);
  assert.deepEqual(report.error, { message: 'interrupted', hint: '' });
  assert.deepEqual(stagesOf(report), [['validate', true], ['timeline', true], ['sound', false]]);
});

test('the run\'s sound work folder is removed when the sound stage fails a film that was to be rendered', async () => {
  const isolated = path.join(dir, 'tmp-isolated');
  mkdirSync(isolated, { recursive: true });
  const saved = process.env.TMPDIR;
  process.env.TMPDIR = isolated;
  try {
    const { exitCode } = await run(writeFilm('far-cue-render', viral({ cues: [{ at: 999, cue: 'ding' }] })), { noRender: false });
    assert.equal(exitCode, 1);
  } finally {
    if (saved === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = saved;
  }
  assert.deepEqual(readdirSync(isolated).filter((name) => name.startsWith('mm-sound-')), []);
});

test('an interrupt that arrives during validation stops the run right after it: exit 130, no later stage', async () => {
  const controller = new AbortController();
  controller.abort();
  const synthesise = async () => assert.fail('the voice stage must not run after an interrupt');
  const voiced = pro({ voice: { name: 'af_heart' } });
  const { report, exitCode } = await run(writeFilm('aborted-early', voiced), {}, { signal: controller.signal, synthesise });
  assert.equal(exitCode, 130);
  assert.deepEqual(report.error, { message: 'interrupted', hint: '' });
  assert.deepEqual(stagesOf(report), [['validate', true]]);
  assert.equal(report.timed, null, 'no timeline was built');
});

test('--outline takes no sound stage', async () => {
  const { report, exitCode } = await run(writeFilm('outline', viral({ music: { bed: 'tape' } })), { outline: true, noRender: false });
  assert.equal(exitCode, 0);
  assert.deepEqual(stagesOf(report).map(([name]) => name), ['validate', 'timeline']);
});

// ---- --no-music: the music is planned (so music.snap still moves the cuts), then left out of the sound ----

const SNAP_FREE = (id, hold, cut) => ({ id, show: 'free', hold, background: '#f3eee3', ...(cut ? { cut } : {}), nodes: [{ type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } }] });
const SNAP_BEATS = Array.from({ length: 21 }, (_, k) => k * 0.5); // 120 BPM over 10 s
// A film with no narration, a music file and a beats file whose beats move three cuts (as sound-snap.test.mjs builds its own).
function snapFilm(name, extra = {}) {
  const at = path.join(dir, name);
  mkdirSync(at, { recursive: true });
  writeNoise(path.join(at, 'm.wav'), { seconds: 10 });
  writeBeatsFile(path.join(at, 'm.beats.json'), { source: 'm.wav', bpm: 120, confidence: 1, beats: SNAP_BEATS });
  const film = { version: 2, fps: FPS, mode: 'pro', shots: [SNAP_FREE('a', 1.9), SNAP_FREE('b', 2.3, 'cut'), SNAP_FREE('c', 2.1, 'cut'), SNAP_FREE('d', 1.7, 'cut')], music: { src: 'm.wav', beats: 'm.beats.json', snap: true }, ...extra };
  const specPath = path.join(at, 'film.json');
  writeFileSync(specPath, JSON.stringify(film));
  return specPath;
}

test('--no-music keeps the cuts the snap moved and drops the track', async (t) => {
  if (!await mediaTools(t)) return;
  if (!await needsBrowser(t)) return;
  const specPath = snapFilm('snap-nomusic');
  const withMusic = await run(specPath);
  const without = await run(specPath, { noMusic: true });
  assert.equal(withMusic.exitCode, 0, JSON.stringify(withMusic.report.findings));
  assert.equal(without.exitCode, 0, JSON.stringify(without.report.findings));
  assert.ok(withMusic.report.audio.music.moved.length > 0, 'the snap moved a cut');
  assert.deepEqual(without.report.audio.music.moved, withMusic.report.audio.music.moved);
  assert.equal(without.report.audio.music.muted, true);
  assert.equal(withMusic.report.audio.music.muted, undefined);
  // the picture and the timeline are the same film
  assert.equal(without.report.timed, withMusic.report.timed);
  assert.equal(without.report.frames, withMusic.report.frames);
  assert.equal(without.report.seconds, withMusic.report.seconds);
});

test('--no-music leaves every shot start and every cue time where the snap put them', async (t) => {
  if (!await mediaTools(t)) return;
  const loaded = loadFilm(snapFilm('snap-nomusic-times', { sound: 'on' }));
  const plain = buildTimeline(loaded.film, { fps: loaded.film.fps });
  const plan = async (noMusic) => {
    const state = { stages: [], findings: [], audio: null };
    const { timeline } = await makeSound(loaded, plain, state, { log: () => {} }, null, [], { noMusic });
    return { starts: timeline.shots.map((s) => [s.id, s.start]), cues: planCues(loaded.film, timeline).map((c) => [c.cue, c.t]), audio: state.audio };
  };
  const [withMusic, without] = [await plan(false), await plan(true)];
  assert.notDeepEqual(withMusic.starts, plain.shots.map((s) => [s.id, s.start]), 'the snap moved a cut');
  assert.ok(withMusic.cues.length > 0, 'the film has cues');
  assert.deepEqual(without.starts, withMusic.starts, 'every shot start');
  assert.deepEqual(without.cues, withMusic.cues, 'every cue time');
  assert.equal(without.audio.cues, withMusic.audio.cues);
  assert.deepEqual(without.audio.music.moved, withMusic.audio.music.moved);
  assert.equal(without.audio.music.muted, true);
});

test('--no-music leaves the cue plan and the timeline of a film with cues as they were', async (t) => {
  if (!await needsBrowser(t)) return;
  const specPath = writeFilm('cues-nomusic-plan', viral({ music: { bed: 'pulse', bpm: 120 } }));
  const withMusic = await run(specPath);
  const without = await run(specPath, { noMusic: true });
  assert.equal(without.exitCode, 0, JSON.stringify(without.report.findings));
  assert.ok(without.report.audio.cues > 0);
  assert.equal(without.report.audio.cues, withMusic.report.audio.cues);
  assert.equal(without.report.timed, withMusic.report.timed);
  assert.equal(without.report.frames, withMusic.report.frames);
  assert.deepEqual({ ...without.report.audio.music, muted: undefined }, { ...withMusic.report.audio.music, muted: undefined });
  assert.equal(without.report.audio.music.muted, true);
});

test('--no-music says the film is rendered without its music, once, on the log', async (t) => {
  if (!await mediaTools(t)) return;
  if (!await needsBrowser(t)) return;
  const lines = [];
  const { report, exitCode } = await run(snapFilm('snap-nomusic-log'), { noMusic: true }, { log: (line) => lines.push(line) });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.deepEqual(lines.filter((l) => /--no-music/.test(l)), ['make: --no-music: the film is rendered without its music; its cuts stay where the music put them']);
});

test('--no-music on a film with no music says there is no music to leave out, once, in a film with and without sound', async (t) => {
  if (!await needsBrowser(t)) return;
  for (const [name, film] of [['viral', viral()], ['pro', pro()]]) {
    const lines = [];
    const { report, exitCode } = await run(writeFilm(`nomusic-none-${name}`, film), { noMusic: true }, { log: (line) => lines.push(line) });
    assert.equal(exitCode, 0, JSON.stringify(report.findings));
    assert.deepEqual(lines.filter((l) => /--no-music/.test(l)), ['make: --no-music: the film has no music; nothing to leave out'], name);
  }
});

test('the text report says a muted music is muted', () => {
  const bed = { kind: 'bed', bed: 'pulse', bpm: 108, landed: 1, cuts: 3, short: false };
  assert.equal(soundLine({ cues: 2, music: { ...bed, muted: true } }), 'sound: 2 cues, bed pulse at 108 bpm, 1 of 3 cuts on a beat (muted)');
  assert.equal(soundLine({ cues: 0, music: { ...bed, muted: true } }), 'sound: no cues, bed pulse at 108 bpm, 1 of 3 cuts on a beat (muted)');
  assert.doesNotMatch(soundLine({ cues: 2, music: bed }), /muted/);
});

test('a narrated film with a bed and no cues keeps the muted bed in its report after the render, and the voice in its file', async (t) => {
  if (!await needsBrowser(t)) return;
  const tools = await mediaTools(t);
  if (!tools) return;
  const at = path.join(dir, 'narrated-muted');
  mkdirSync(at, { recursive: true });
  const made = spawnSync(tools.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=f=440:d=3', path.join(at, 'take.wav')], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  writeFileSync(path.join(at, 'take.json'), JSON.stringify({ segments: [{ words: [{ word: ' Go.', start: 0.2, end: 0.5 }] }] }));
  const specPath = path.join(at, 'film.json');
  writeFileSync(specPath, JSON.stringify({ version: 2, mode: 'pro', voice: { src: 'take.wav', words: 'take.json' }, music: { bed: 'pulse', bpm: 120 }, shots: [{ id: 'go', show: 'statement', say: 'Go.' }] }));
  const out = path.join(at, 'out', 'film.mp4');
  const { report, exitCode } = await runMake({ specPath, out, exact: false, noRender: false, outline: false, noMusic: true });
  assert.equal(exitCode, 0, JSON.stringify(report));
  assert.equal(report.audio.music.muted, true, JSON.stringify(report.audio));
  assert.equal(report.audio.music.bed, 'pulse');
  assert.equal(typeof report.audio.lufs, 'number', 'the voice is in the file and measured');
  const probe = JSON.parse(spawnSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', out], { encoding: 'utf8' }).stdout);
  assert.equal(probe.streams.filter((s) => s.codec_type === 'audio').length, 1);
});

test('a film with cues renders the cues and not the bed with --no-music, and says so in its report', async (t) => {
  if (!await needsBrowser(t)) return;
  const tools = await mediaTools(t);
  if (!tools) return;
  const out = path.join(dir, 'out-cues-muted', 'film.mp4');
  const film = viral({ music: { bed: 'pulse', bpm: 120 } });
  const { report, exitCode } = await runMake({ specPath: writeFilm('cues-muted', film), out, exact: false, noRender: false, outline: false, noMusic: true });
  assert.equal(exitCode, 0, JSON.stringify(report));
  assert.equal(report.audio.cues, planOf(film).cues.length);
  assert.equal(report.audio.music.muted, true);
  assert.equal(report.audio.music.kind, 'bed');
  assert.match(soundLine(report.audio), /\(muted\)$/);
  const probe = JSON.parse(spawnSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', out], { encoding: 'utf8' }).stdout);
  assert.equal(probe.streams.filter((s) => s.codec_type === 'audio').length, 1);
});

test('a film whose only sound is a bed renders silent with --no-music', async (t) => {
  if (!await needsBrowser(t)) return;
  const tools = await mediaTools(t);
  if (!tools) return;
  const out = path.join(dir, 'out-bed-muted', 'film.mp4');
  const { report, exitCode } = await runMake({ specPath: writeFilm('bed-muted', pro({ music: { bed: 'pulse', bpm: 120 } })), out, exact: false, noRender: false, outline: false, noMusic: true });
  assert.equal(exitCode, 0, JSON.stringify(report));
  assert.equal(report.audio, null);
  const probe = JSON.parse(spawnSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', out], { encoding: 'utf8' }).stdout);
  assert.equal(probe.streams.filter((s) => s.codec_type === 'audio').length, 0);
});

test('a full render of a viral film with a bed: one audio stream, the bed and cues in it, the level measured in the file', async (t) => {
  if (!await needsBrowser(t)) return;
  const tools = await mediaTools(t);
  if (!tools) return;
  const film = viral({ music: { bed: 'pulse', bpm: 120 } });
  const out = path.join(dir, 'out-full', 'film.mp4');
  const { report, exitCode } = await runMake({ specPath: writeFilm('full', film), out, exact: false, noRender: false, outline: false });
  assert.equal(exitCode, 0, JSON.stringify(report));
  assert.deepEqual(stagesOf(report).map(([name]) => name), ['validate', 'timeline', 'sound', 'review', 'render']);
  const probe = JSON.parse(spawnSync(tools.ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', out], { encoding: 'utf8' }).stdout);
  assert.equal(probe.streams.filter((s) => s.codec_type === 'audio').length, 1);
  assert.equal(report.audio.cues, planOf(film).cues.length);
  assert.equal(report.audio.music.kind, 'bed');
  // No voice: raised as far as the ceiling allows; short of the target only with the note that says so.
  assert.ok(report.audio.lufs <= -14 + 1, `${report.audio.lufs} LUFS`);
  assert.ok(report.audio.truePeakDb <= -1, `${report.audio.truePeakDb} dBTP`);
  assert.equal(report.audio.note, report.audio.lufs < -14 - 1 ? NO_VOICE_NOTE : null);
});
