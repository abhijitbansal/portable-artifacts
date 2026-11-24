// make-motion's writers under the one containment rule (shared/write-file.mjs): in a git repository, a folder that leads out of it
// by a symlink is refused before anything is made, written or DELETED. A PNG, a cache entry or a partial video in the target must
// survive. No browser; ffmpeg only where a test says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../scripts/v2/list.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { writeSheets, writeBoard, clearStaleBoard } from '../../scripts/v2/sheets.mjs';
import { sweepPartials } from '../../scripts/v2/render.mjs';
import { writePoster } from '../../scripts/v2/poster.mjs';
import { writeSubtitles } from '../../scripts/v2/subtitles.mjs';
import { writeBeatsFile } from '../../scripts/v2/sound/beats-file.mjs';
import { writeAtomic as writeCutout, encodeWebm } from '../../scripts/lib/cutout.mjs';
import { prepareClips } from '../../scripts/v2/clips.mjs';
import { synthesiseFilm } from '../../scripts/v2/voice/synth.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { checkStrips, copyStrips } from '../../scripts/v2/board-stills.mjs';
import { ensurePinnedFile } from '../../scripts/lib/pinned-file.mjs';
import { decodeFrames } from '../../scripts/lib/video-probe.mjs';

const skip = process.platform === 'win32' && 'symbolic links need a privilege on Windows';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCATE = path.resolve(HERE, '../../scripts/locate.mjs');
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const made = [];
test.after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

// <base>/repo (a .git folder), <base>/outside holding a PNG that must survive, and `out` in the repository linked to it.
function world({ git = true } = {}) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'mm-contain-')));
  made.push(base);
  const repo = path.join(base, 'repo');
  const outside = path.join(base, 'outside');
  mkdirSync(repo);
  mkdirSync(outside);
  if (git) mkdirSync(path.join(repo, '.git'));
  writeFileSync(path.join(outside, 'holiday.png'), 'precious');
  return { base, repo, outside };
}
const refused = (link) => (e) => e instanceof UsageError && !e.message.includes('\n') && e.message.includes(link) && /remove the link, or pass the folder's real path/.test(e.message);
const names = (dir) => readdirSync(dir).sort();
// A session that gets writeSheets through its clearing step and no further.
const stubSession = { film: { shots: [] }, timeline: {}, page: {} };

test('F1: a sheets folder that is a link out of the repository is refused; the PNG in its target survives', { skip }, async () => {
  const { repo, outside } = world();
  mkdirSync(path.join(repo, 'out'));
  symlinkSync(outside, path.join(repo, 'out', 'film.sheets'));
  await assert.rejects(writeSheets({ dir: path.join(repo, 'out', 'film.sheets'), session: stubSession }), refused(path.join(repo, 'out', 'film.sheets')));
  assert.deepEqual(names(outside), ['holiday.png']);
  assert.equal(readFileSync(path.join(outside, 'holiday.png'), 'utf8'), 'precious');
});

test('F1: an out folder that is a link out of the repository is refused for the sheets below it', { skip }, async () => {
  const { repo, outside } = world();
  mkdirSync(path.join(outside, 'film.sheets'));
  writeFileSync(path.join(outside, 'film.sheets', 'a.png'), 'precious');
  symlinkSync(outside, path.join(repo, 'out'));
  await assert.rejects(writeSheets({ dir: path.join(repo, 'out', 'film.sheets'), session: stubSession }), refused(path.join(repo, 'out')));
  assert.deepEqual(names(path.join(outside, 'film.sheets')), ['a.png']);
});

test('control: the same layout with a real folder (and the stub session) does delete the old PNGs, so the refusal is what saved them', { skip }, async () => {
  const { repo, outside } = world();
  symlinkSync(outside, path.join(repo, 'out'));
  const real = world();
  mkdirSync(path.join(real.repo, 'out'));
  writeFileSync(path.join(real.repo, 'out', 'old.png'), 'x');
  await writeSheets({ dir: path.join(real.repo, 'out'), session: stubSession }).catch(() => {}); // fails later, on the empty film
  assert.equal(existsSync(path.join(real.repo, 'out', 'old.png')), false, 'the writer clears its own sheets');
  const noGit = world({ git: false });
  symlinkSync(noGit.outside, path.join(noGit.repo, 'out'));
  await writeSheets({ dir: path.join(noGit.repo, 'out'), session: stubSession }).catch(() => {});
  assert.equal(existsSync(path.join(noGit.outside, 'holiday.png')), false, 'outside any repository nothing changes (a stated limit)');
});

test('a link that stays inside the repository is allowed for the sheets', { skip }, async () => {
  const { repo } = world();
  mkdirSync(path.join(repo, 'build', 'sheets'), { recursive: true });
  writeFileSync(path.join(repo, 'build', 'sheets', 'old.png'), 'x');
  symlinkSync(path.join(repo, 'build'), path.join(repo, 'out'));
  await writeSheets({ dir: path.join(repo, 'out', 'sheets'), session: stubSession }).catch(() => {});
  assert.equal(existsSync(path.join(repo, 'build', 'sheets', 'old.png')), false);
});

test('the sheets folder is cleared of its PNGs and of a temp file a killed run left, but not of a folder of that shape or another file', { skip }, async () => {
  const { repo } = world();
  const dir = path.join(repo, 'film.sheets');
  mkdirSync(path.join(dir, '.pa-fedcba9876543210.tmp'), { recursive: true });
  writeFileSync(path.join(dir, '.pa-0123456789abcdef.tmp'), 'half');
  writeFileSync(path.join(dir, '.pa-mine.tmp'), 'the user\'s');
  writeFileSync(path.join(dir, 'a.png'), 'x');
  writeFileSync(path.join(dir, 'notes.txt'), 'x');
  await writeSheets({ dir, session: stubSession }).catch(() => {});
  assert.deepEqual(names(dir), ['.pa-fedcba9876543210.tmp', '.pa-mine.tmp', 'notes.txt']);
});

test('clearStaleBoard and writeBoard refuse a sheets folder that leads out, and the board strips survive', { skip }, async () => {
  const { repo, outside } = world();
  mkdirSync(path.join(outside, 'board'));
  writeFileSync(path.join(outside, 'board', 'board-1.jpg'), 'precious');
  symlinkSync(outside, path.join(repo, 'film.sheets'));
  assert.throws(() => clearStaleBoard(path.join(repo, 'film.sheets')), refused(path.join(repo, 'film.sheets')));
  await assert.rejects(writeBoard({ session: stubSession, dir: path.join(repo, 'film.sheets') }), refused(path.join(repo, 'film.sheets')));
  assert.deepEqual(names(path.join(outside, 'board')), ['board-1.jpg']);
});

test('sweepPartials: a folder that leads out is refused and nothing in it is removed; a real one is swept, own work folders included', { skip }, () => {
  const { repo, outside } = world();
  const old = path.join(outside, '.film.mp4.partial-1.mp4');
  writeFileSync(old, 'x');
  symlinkSync(outside, path.join(repo, 'out'));
  const later = { now: Date.now() + 2 * 3600 * 1000 };
  assert.throws(() => sweepPartials(path.join(repo, 'out'), later), refused(path.join(repo, 'out')));
  assert.equal(existsSync(old), true);
  const dir = path.join(repo, 'real');
  mkdirSync(path.join(dir, '.pa-abc123'), { recursive: true });
  writeFileSync(path.join(dir, '.pa-abc123', 'video.mp4'), 'x');
  mkdirSync(path.join(dir, '.pa-mine12'));
  writeFileSync(path.join(dir, '.pa-mine12', 'notes.txt'), 'the user\'s');
  mkdirSync(path.join(dir, 'a-folder'));
  writeFileSync(path.join(dir, '.x.partial-9.mp4'), 'x');
  mkdirSync(path.join(dir, '.pa-live99'));
  writeFileSync(path.join(dir, '.pa-live99', 'video.mp4'), 'still growing'); // its folder is old, its video was written just now
  utimesSync(path.join(dir, '.pa-live99'), new Date(0), new Date(0));
  assert.deepEqual(sweepPartials(dir, { now: Date.now() + 30 * 60 * 1000 }), [], 'a live render is not swept');
  assert.deepEqual(sweepPartials(dir, later).sort(), ['.pa-abc123', '.pa-live99', '.x.partial-9.mp4']);
  assert.deepEqual(names(dir), ['.pa-mine12', 'a-folder']);
});

test('a poster, subtitles and a beats file go nowhere through a link out of the repository', { skip }, async () => {
  const { repo, outside } = world();
  symlinkSync(outside, path.join(repo, 'out'));
  const page = { evaluate: async () => {}, screenshot: async () => Buffer.from('png') };
  await assert.rejects(writePoster({ session: { page, timeline: { fps: 30 } }, frame: 0, file: path.join(repo, 'out', 'poster.png') }), refused(path.join(repo, 'out')));
  const timeline = { timed: 'measured', shots: [{ id: 'a', start: 0, end: 1, words: [{ text: 'Hi.', soundStart: 0, soundEnd: 0.5, start: 0, end: 0.5 }], sentences: [{ first: 0, last: 0 }] }] };
  assert.throws(() => writeSubtitles({ timeline, format: 'vtt', videoOut: path.join(repo, 'out', 'film.mp4') }), refused(path.join(repo, 'out')));
  assert.throws(() => writeBeatsFile(path.join(repo, 'out', 'm.beats.json'), { source: 'm.wav', bpm: 120, confidence: 1, beats: [0.5, 1, 1.5] }), refused(path.join(repo, 'out')));
  assert.deepEqual(names(outside), ['holiday.png']);
});

test('a cutout picture goes nowhere through a link out of the repository, and a link at its own name is still replaced', { skip }, () => {
  const { repo, outside } = world();
  symlinkSync(outside, path.join(repo, 'cutout'));
  assert.throws(() => writeCutout(path.join(repo, 'cutout', 'p.png'), Buffer.from([1])), refused(path.join(repo, 'cutout')));
  assert.deepEqual(names(outside), ['holiday.png']);
  mkdirSync(path.join(repo, 'real'));
  symlinkSync(path.join(outside, 'holiday.png'), path.join(repo, 'real', 'p.png'));
  writeCutout(path.join(repo, 'real', 'p.png'), Buffer.from([9]));
  assert.equal(readFileSync(path.join(outside, 'holiday.png'), 'utf8'), 'precious');
  assert.equal(lstatSync(path.join(repo, 'real', 'p.png')).isSymbolicLink(), false);
});

test('locate --out: a folder that leads out of the repository is refused in one line, and nothing is written', { skip }, () => {
  const { repo, outside } = world();
  const png = path.join(repo, 'p.png');
  copyFileSync(path.resolve(HERE, '../../references/examples/v2/photo.png'), png);
  symlinkSync(outside, path.join(repo, 'o'));
  const r = spawnSync(process.execPath, [LOCATE, png, '--out', path.join(repo, 'o', 'pictures')], { encoding: 'utf8', timeout: 30_000 }); // a linked ANCESTOR: locate's own check refuses only a linked --out itself
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  assert.ok(r.stderr.includes(path.join(repo, 'o')));
  assert.deepEqual(names(outside), ['holiday.png']);
});

test('the voice cache: an output folder that leads out of the repository is refused before an entry is read or removed', { skip }, async () => {
  const { repo, outside } = world();
  mkdirSync(path.join(outside, '.voice', 'entry'), { recursive: true });
  writeFileSync(path.join(outside, '.voice', 'entry', 'voice.json'), 'precious');
  symlinkSync(outside, path.join(repo, 'out'));
  const runtime = mkdtempSync(path.join(tmpdir(), 'mm-contain-rt-'));
  made.push(runtime);
  writeFileSync(path.join(runtime, 'package-lock.json'), '{}');
  const film = { version: 2, fps: 30, voice: { name: 'af_heart' }, shots: [{ id: 'a', say: 'Hello.' }] };
  const spawn = () => assert.fail('no worker may start');
  await assert.rejects(synthesiseFilm(film, { outDir: path.join(repo, 'out'), voice: 'af_heart', runtime, spawn, ensureModel: async () => {} }), refused(path.join(repo, 'out')));
  assert.deepEqual(names(path.join(outside, '.voice', 'entry')), ['voice.json']);
});

test('the clip frame cache: a .clips that leads out of the repository is refused even on a cache hit, before the cache is swept or pruned', { skip: skip || !hasFfmpeg }, async () => {
  const { repo, outside } = world();
  const specDir = mkdtempSync(path.join(tmpdir(), 'mm-contain-spec-'));
  made.push(specDir);
  copyFileSync(path.resolve(HERE, '../../references/examples/v2/media-clip.mp4'), path.join(specDir, 'clip.mp4'));
  const film = { version: 2, fps: 30, look: 'desk', shots: [{ id: 'reel', show: 'media', src: 'clip.mp4', hold: 1 }] };
  const args = { film, specDir, timeline: buildTimeline(film, { fps: 30 }), canvas: { w: 1920, h: 1080 }, maxCacheBytes: 1 };
  const cache = path.join(outside, '.clips');
  const [first] = await prepareClips({ ...args, cacheDir: cache }); // outside any repository: decoded into the cache the link will lead to
  assert.equal(first.cached, false);
  const stale = path.join(cache, `.partial-${'a'.repeat(64)}-999999`);
  mkdirSync(stale);
  writeFileSync(path.join(stale, '000001.png'), 'precious');
  mkdirSync(path.join(repo, 'out'));
  symlinkSync(cache, path.join(repo, 'out', '.clips'));
  await assert.rejects(prepareClips({ ...args, cacheDir: path.join(repo, 'out', '.clips') }), refused(path.join(repo, 'out', '.clips')));
  assert.deepEqual(names(stale), ['000001.png'], 'a cache hit would have swept the dead run\'s folder');
  assert.ok(existsSync(first.dir), 'and pruned nothing');
});

test('encodeWebm: ffmpeg writes into a private folder, a link or a pipe at the output name is never opened, and nothing is left behind', { skip: skip || !hasFfmpeg }, (t) => {
  const { repo, outside } = world();
  const frames = path.join(repo, 'frames');
  mkdirSync(frames);
  const made3 = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=5:d=1', '-frames:v', '3', path.join(frames, '%06d.png')]);
  if (made3.status !== 0) return t.skip('ffmpeg cannot make the test frames');
  const probe = spawnSync('ffmpeg', ['-hide_banner', '-encoders']);
  if (!String(probe.stdout).includes('libvpx-vp9')) return t.skip('this ffmpeg has no VP9 encoder (the cutout says so itself)');
  const out = path.join(repo, 'clip.webm');
  // guessable names from the old code: a link there is never written through
  symlinkSync(path.join(outside, 'holiday.png'), `${out}.partial-${process.pid}.webm`);
  symlinkSync(path.join(outside, 'holiday.png'), out);
  encodeWebm({ ffmpeg: 'ffmpeg', framesDir: frames, fps: 5, output: out });
  assert.equal(readFileSync(path.join(outside, 'holiday.png'), 'utf8'), 'precious');
  assert.equal(lstatSync(out).isSymbolicLink(), false);
  assert.ok(lstatSync(out).size > 0);
  assert.deepEqual(names(repo).filter((n) => n.startsWith('.pa-')), [], 'no private work folder is left');
  rmSync(out);
  assert.equal(spawnSync('mkfifo', [out]).status, 0);
  assert.throws(() => encodeWebm({ ffmpeg: 'ffmpeg', framesDir: frames, fps: 5, output: out }), /pipe|socket|device/);
  assert.equal(lstatSync(out).isFIFO(), true);
});

test('a whole run whose output folder leads out of the repository stops before a voice, a clip or a sheet is made, and opens no page', { skip }, async () => {
  const { repo, outside } = world();
  mkdirSync(path.join(outside, 'film.sheets'));
  writeFileSync(path.join(outside, 'film.sheets', 'a.png'), 'precious');
  symlinkSync(outside, path.join(repo, 'out'));
  const specPath = path.join(repo, 'film.json');
  writeFileSync(specPath, JSON.stringify({ version: 2, shots: [{ id: 'hello', show: 'statement', say: 'Welcome aboard.' }] }));
  const opened = [];
  const spy = { newContext: (...args) => { opened.push(args); return Promise.reject(new Error('a page was opened')); } };
  const { exitCode, report } = await runMake({ specPath, out: path.join(repo, 'out', 'film.mp4'), exact: false, noRender: true, outline: false }, { browser: spy });
  assert.equal(exitCode, 2, JSON.stringify(report.error ?? report.findings));
  assert.match(report.error.message, /remove the link, or pass the folder's real path/);
  assert.equal(opened.length, 0);
  assert.deepEqual(names(path.join(outside, 'film.sheets')), ['a.png']);
});

test('the board stills, a pinned download and a decode folder are refused in a folder that leads out', { skip }, async () => {
  const { repo, outside } = world();
  const board = path.join(repo, 'board');
  mkdirSync(board);
  writeFileSync(path.join(board, 'board-1.jpg'), 'strip');
  symlinkSync(outside, path.join(repo, 'plans'));
  const strips = checkStrips(board, 3);
  assert.throws(() => copyStrips(board, strips, path.join(repo, 'plans', 'plan.json')), (e) => e instanceof UsageError || /remove the link/.test(e.message));
  assert.deepEqual(names(outside), ['holiday.png']);
  const fetchImpl = async () => assert.fail('nothing may be fetched');
  await assert.rejects(ensurePinnedFile({ url: 'https://example.invalid/m', sha256: '0'.repeat(64), bytes: 1, file: path.join(repo, 'plans', 'm.bin'), label: 'weights', fetchImpl }), refused(path.join(repo, 'plans')));
  assert.throws(() => decodeFrames('ffmpeg-not-run', { dir: path.join(repo, 'plans', 'frames'), file: 'x.mp4', trimStart: 0, trimEnd: 1, fps: 30, width: 8, height: 8, fit: 'cover' }), refused(path.join(repo, 'plans')));
  assert.deepEqual(names(outside), ['holiday.png']);
});
