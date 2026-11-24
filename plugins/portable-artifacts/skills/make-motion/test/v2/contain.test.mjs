// make-motion's writers under the one containment rule (shared/write-file.mjs): in a git repository, a folder that leads out of it
// by a symlink is refused before anything is made, written or DELETED. A PNG, a cache entry or a partial video in the target must
// survive. No browser; ffmpeg only where a test says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../scripts/v2/list.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { writeSheets, writeBoard, clearStaleBoard } from '../../scripts/v2/sheets.mjs';
import { makeWorkFolder, sweepPartials, WORK_OWNER_FILE } from '../../scripts/v2/render.mjs';
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
  mkdirSync(path.join(noGit.outside, 'film.sheets'));
  writeFileSync(path.join(noGit.outside, 'film.sheets', 'holiday.png'), 'x');
  symlinkSync(noGit.outside, path.join(noGit.repo, 'out'));
  await writeSheets({ dir: path.join(noGit.repo, 'out', 'film.sheets'), session: stubSession }).catch(() => {});
  assert.equal(existsSync(path.join(noGit.outside, 'film.sheets', 'holiday.png')), false, 'outside any repository a linked parent folder is followed as before (a stated limit)');
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

test('a sheets folder that is itself a link is refused even when it stays inside the repository; the files behind it survive', { skip }, async () => {
  const { repo } = world();
  mkdirSync(path.join(repo, 'screenshots'));
  writeFileSync(path.join(repo, 'screenshots', 'mine.png'), 'the user\'s, not yet committed');
  mkdirSync(path.join(repo, 'out'));
  symlinkSync('../screenshots', path.join(repo, 'out', 'film.sheets'));
  const named = (e) => e instanceof UsageError && !e.message.includes('\n') && e.message.includes(path.join(repo, 'out', 'film.sheets')) && /link/.test(e.message);
  await assert.rejects(writeSheets({ dir: path.join(repo, 'out', 'film.sheets'), session: stubSession }), named);
  await assert.rejects(writeSheets({ dir: path.join(repo, 'out', 'film.sheets'), session: stubSession, slice: { from: 0, to: 0, shots: [] } }), named);
  assert.deepEqual(names(path.join(repo, 'screenshots')), ['mine.png']);
});

test('the sheets folder is cleared of the names this tool writes (a shot id and .png), not of every picture in it', { skip }, async () => {
  const { repo } = world();
  const dir = path.join(repo, 'film.sheets');
  mkdirSync(dir);
  for (const keep of ['Holiday.png', 'IMG_1.png', 'my photo.png', 'UPPER.PNG', 'notes.png.txt']) writeFileSync(path.join(dir, keep), 'the user\'s');
  writeFileSync(path.join(dir, 'a.partial-x.png'), 'the user\'s'); // not a slice label
  for (const ours of ['intro.png', 'shot-2.png', 'cut-intro-outro.png', 'a.partial-range-30-75.png', 'b.partial-shot-intro.png']) writeFileSync(path.join(dir, ours), 'x');
  await writeSheets({ dir, session: stubSession }).catch(() => {});
  assert.deepEqual(names(dir), ['Holiday.png', 'IMG_1.png', 'UPPER.PNG', 'a.partial-x.png', 'my photo.png', 'notes.png.txt']);
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

const LATER = { now: Date.now() + 2 * 3600 * 1000 };
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid; // a process that has ended: no one holds its number now

// A work folder as a render leaves it: its two files and, when `owner` is given, the marker with that owner.
function workFolder(dir, name, owner) {
  const folder = path.join(dir, name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, 'video.mp4'), 'x');
  if (owner !== undefined) writeFileSync(path.join(folder, WORK_OWNER_FILE), JSON.stringify({ host: hostname(), token: 'a'.repeat(32), ...owner }));
  return folder;
}

test('sweepPartials: a folder that leads out is refused and nothing in it is removed', { skip }, () => {
  const { repo, outside } = world();
  const old = path.join(outside, '.film.mp4.partial-1.mp4');
  writeFileSync(old, 'x');
  symlinkSync(outside, path.join(repo, 'out'));
  assert.throws(() => sweepPartials(path.join(repo, 'out'), LATER), refused(path.join(repo, 'out')));
  assert.equal(existsSync(old), true);
});

test('sweepPartials removes only what it can prove is a dead run\'s: a marked work folder whose process has ended, and an old partial file', { skip }, () => {
  const { repo } = world();
  const dir = path.join(repo, 'real');
  workFolder(dir, '.pa-dead01', { pid: deadPid() });
  workFolder(dir, '.pa-live01', { pid: process.pid }); // a run that is alive, however long its video has not changed
  workFolder(dir, '.pa-nomark'); // no marker: not ours to judge
  workFolder(dir, '.pa-hostxx', { pid: deadPid(), host: 'some-other-machine' });
  workFolder(dir, '.pa-badmrk');
  writeFileSync(path.join(dir, '.pa-badmrk', WORK_OWNER_FILE), '{"pid": "x"');
  mkdirSync(path.join(dir, '.pa-mine12')); // empty: a live render looks like this too, and so does a user's folder
  mkdirSync(path.join(dir, 'a-folder'));
  writeFileSync(path.join(dir, '.x.partial-9.mp4'), 'x');
  assert.deepEqual(sweepPartials(dir, { now: Date.now() + 30 * 60 * 1000 }), [], 'nothing is an hour old yet');
  assert.deepEqual(sweepPartials(dir, LATER).sort(), ['.pa-dead01', '.x.partial-9.mp4']);
  assert.deepEqual(names(dir), ['.pa-badmrk', '.pa-hostxx', '.pa-live01', '.pa-mine12', '.pa-nomark', 'a-folder']);
});

test('sweepPartials removes nothing but the marker and the two video files: a marked folder holding anything else is left', { skip }, () => {
  const { repo } = world();
  const dir = path.join(repo, 'real');
  const folder = workFolder(dir, '.pa-extra1', { pid: deadPid() });
  writeFileSync(path.join(folder, 'notes.txt'), 'the user\'s');
  assert.deepEqual(sweepPartials(dir, LATER), []);
  assert.deepEqual(names(folder), ['notes.txt', WORK_OWNER_FILE, 'video.mp4']);
});

test('sweepPartials never aborts a render: an unreadable folder, a dangling link or a folder named like a partial file are skipped', { skip: skip || process.getuid?.() === 0 }, () => {
  const { repo } = world();
  const dir = path.join(repo, 'real');
  workFolder(dir, '.pa-dead01', { pid: deadPid() });
  workFolder(dir, '.pa-other1', { pid: deadPid() });
  chmodSync(path.join(dir, '.pa-other1'), 0o000); // another user's folder: mkdtemp makes it 0700
  symlinkSync(path.join(dir, 'nowhere'), path.join(dir, '.a.partial-1.mp4'));
  mkdirSync(path.join(dir, '.b.partial-2.mp4'));
  try {
    assert.deepEqual(sweepPartials(dir, LATER), ['.pa-dead01']);
    assert.equal(lstatSync(path.join(dir, '.a.partial-1.mp4')).isSymbolicLink(), true);
    assert.equal(lstatSync(path.join(dir, '.b.partial-2.mp4')).isDirectory(), true);
  } finally {
    chmodSync(path.join(dir, '.pa-other1'), 0o700);
  }
});

test('makeWorkFolder: a private folder beside the output, marked with this process and a random token', { skip }, () => {
  const { repo } = world();
  mkdirSync(path.join(repo, 'out'));
  const folder = makeWorkFolder(path.join(repo, 'out'));
  assert.match(path.basename(folder), /^\.pa-[A-Za-z0-9]{6}$/);
  const marker = JSON.parse(readFileSync(path.join(folder, WORK_OWNER_FILE), 'utf8'));
  assert.equal(marker.pid, process.pid);
  assert.equal(marker.host, hostname());
  assert.match(marker.token, /^[0-9a-f]{32}$/);
  assert.equal(sweepPartials(path.join(repo, 'out'), LATER).length, 0, 'this run is alive');
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

test('the clip frame cache: an entry that is a link is no cache hit, and the times of its target are left alone', { skip: skip || !hasFfmpeg }, async () => {
  const { repo, outside } = world();
  const specDir = mkdtempSync(path.join(tmpdir(), 'mm-contain-spec-'));
  made.push(specDir);
  copyFileSync(path.resolve(HERE, '../../references/examples/v2/media-clip.mp4'), path.join(specDir, 'clip.mp4'));
  const film = { version: 2, fps: 30, look: 'desk', shots: [{ id: 'reel', show: 'media', src: 'clip.mp4', hold: 1 }] };
  const args = { film, specDir, timeline: buildTimeline(film, { fps: 30 }), canvas: { w: 1920, h: 1080 }, maxCacheBytes: 1e9 };
  const [first] = await prepareClips({ ...args, cacheDir: path.join(outside, 'cache') }); // outside any repository
  const longAgo = new Date(1000);
  utimesSync(first.dir, longAgo, longAgo);
  const cache = path.join(repo, 'out', '.clips');
  mkdirSync(cache, { recursive: true });
  const entry = path.join(cache, path.basename(first.dir));
  symlinkSync(first.dir, entry); // the repository ships an entry that leads outside, done.json and all
  const [again] = await prepareClips({ ...args, cacheDir: cache });
  assert.equal(again.cached, false, 'a link is not a cache entry');
  assert.equal(lstatSync(entry).isSymbolicLink(), false);
  assert.equal(statSync(first.dir).mtimeMs, 1000, 'the folder behind the link had its times set');
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
