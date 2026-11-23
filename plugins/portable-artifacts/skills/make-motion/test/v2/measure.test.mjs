// The reference measure (scripts/measure.mjs, scripts/lib/measure.mjs): one local video file read through ffmpeg's scdet
// and ebur128 behind the clip probe's whitelists, every value labelled measured or guessed. Tests that need ffmpeg skip
// without it, unless PA_REQUIRE_BROWSER=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { FAST_SHOT_SECONDS, SCENE_THRESHOLD, measureReport, parseScdet, reportJson, shotStats } from '../../scripts/lib/measure.mjs';
import { fail, run as runTool } from '../../scripts/measure.mjs';
import { CLIP_DECODERS, CLIP_DEMUXERS, probeClip } from '../../scripts/v2/clips.mjs';

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEASURE = path.resolve(HERE, '../../scripts/measure.mjs');
const toolOf = (name) => process.env[`${name.toUpperCase()}_PATH`] || name; // as the tools find ffmpeg and ffprobe: the variable, else PATH
const hasFfmpeg = spawnSync(toolOf('ffmpeg'), ['-version']).status === 0 && spawnSync(toolOf('ffprobe'), ['-version']).status === 0;
if (!hasFfmpeg && process.env.PA_REQUIRE_BROWSER === '1') throw new Error('ffmpeg and ffprobe are required (PA_REQUIRE_BROWSER=1)');
const LOCAL_ONLY = /local files only: give the path of a video file on this machine \(mp4, mov, m4v, webm or mkv\)/;

// Two lines as this machine's ffmpeg printed them for the fixture below (`-vf scdet=threshold=10 -f null -`), logged
// through the filter's own name; the lines of a different build may name the filter's instance differently.
const SCDET = '[Parsed_scdet_0 @ 0x77dd062c40] lavfi.scd.score: 15.625, lavfi.scd.time: 1\n[Parsed_scdet_0 @ 0x77dd062c40] lavfi.scd.score: 15.625, lavfi.scd.time: 2\n';

let dir, fixture, playlist, playlistAsMp4, concatScript, folder, linkToScript, fifo, plainFile, hits, server, serverUrl;
const server404 = (req, res) => { hits.push(req.url); res.statusCode = 404; res.end(); };

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-measure-'));
  hits = [];
  server = http.createServer(server404);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverUrl = `http://127.0.0.1:${server.address().port}/seg.mp4`;
  fixture = path.join(dir, 'fixture.mp4');
  if (hasFfmpeg) { // red 1 s, blue 1 s, green 1 s, 320x180 at 30 fps, a 440 Hz tone
    spawnSync(toolOf('ffmpeg'), ['-nostdin', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=30:d=1', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=30:d=1',
      '-f', 'lavfi', '-i', 'color=c=green:s=320x180:r=30:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', fixture]);
  }
  playlist = path.join(dir, 'list.m3u8');
  playlistAsMp4 = path.join(dir, 'list.mp4');
  concatScript = path.join(dir, 'script.mp4');
  const hls = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n${serverUrl}\n#EXT-X-ENDLIST\n`;
  writeFileSync(playlist, hls);
  writeFileSync(playlistAsMp4, hls);
  writeFileSync(concatScript, `ffconcat version 1.0\nfile '${serverUrl}'\n`);
  folder = path.join(dir, 'folder');
  mkdirSync(folder);
  linkToScript = path.join(dir, 'link.mp4');
  symlinkSync(concatScript, linkToScript); // a link, to a file that exists
  plainFile = path.join(dir, 'plain.mp4'); // a regular file that the fake tools below answer for
  writeFileSync(plainFile, 'x');
  fifo = path.join(dir, 'pipe.mp4');
  if (process.platform === 'win32' || spawnSync('mkfifo', [fifo]).status !== 0) fifo = null;
});
after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(dir, { recursive: true, force: true });
});

const measure = (args, env = {}) => execFileAsync(process.execPath, [MEASURE, ...args], { encoding: 'utf8', env: { ...process.env, ...env } })
  .then((r) => ({ status: 0, ...r }), (e) => ({ status: e.code, stdout: e.stdout, stderr: e.stderr }));

// The tool `name` the recording wrappers run: the path in FFMPEG_PATH / FFPROBE_PATH when set (as the tools themselves find
// it), else the first on PATH; an error that names the tool when there is neither.
function realBinary(name, env = process.env) {
  const set = env[`${name.toUpperCase()}_PATH`];
  if (typeof set === 'string' && set !== '') return set;
  const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' }).stdout.split('\n')[0].trim();
  if (found === '') throw new Error(`${name} is not on PATH and ${name.toUpperCase()}_PATH is not set: the recording wrappers run the real one (a test that needs them skips without ffmpeg)`);
  return found;
}
let toolCount = 0;
// A node script that stands in for ffmpeg or ffprobe: `body` is its source (CommonJS), run with the argv as `args`.
function fakeTool(name, body) {
  const file = path.join(dir, `${name}-${toolCount++}`);
  writeFileSync(file, `#!${process.execPath}\nconst args = process.argv.slice(2);\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}
// ffmpeg and ffprobe stand-ins that log every call's argv to one file, then run the real binary.
function recorders() {
  const log = path.join(dir, `calls-${toolCount++}.jsonl`);
  const wrap = (tool) => fakeTool(tool, `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ tool: ${JSON.stringify(tool)}, argv: args }) + '\\n');\n`
    + `process.exit(require('node:child_process').spawnSync(${JSON.stringify(realBinary(tool))}, args, { stdio: 'inherit' }).status ?? 1);`);
  const env = { FFMPEG_PATH: wrap('ffmpeg'), FFPROBE_PATH: wrap('ffprobe') };
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { env, calls };
}
// Every call opens its one input behind all three clip whitelists: the file protocol only, the clip demuxers, the accepted decoders.
function assertWhitelisted(calls, file) {
  assert.ok(calls.length > 0, 'the tools were run');
  for (const { tool, argv } of calls) {
    const at = argv.indexOf('-i');
    assert.ok(at >= 6, `${tool} has an input: ${argv.join(' ')}`);
    assert.equal(argv.lastIndexOf('-i'), at, `${tool} has one input`);
    assert.deepEqual(argv.slice(at - 6, at), ['-protocol_whitelist', 'file', '-format_whitelist', CLIP_DEMUXERS.join(','), '-codec_whitelist', CLIP_DECODERS.join(',')], `${tool}: ${argv.join(' ')}`);
    assert.equal(argv[at + 1], file, `${tool} opens the file by its absolute path`);
  }
}
// A probe answer that clipProblem accepts, with `width` for the frame.
const probeAnswer = (width) => JSON.stringify({ streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width, height: 180 }], format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '3.0' } });

test('parseScdet reads the cut times in order', () => assert.deepEqual(parseScdet(SCDET), [1, 2]));

test('parseScdet reads a decimal time and ignores other lines', () => {
  assert.deepEqual(parseScdet('frame=1\n[scdet @ 0x1] lavfi.scd.score: 34.9, lavfi.scd.time: 2.033333\nlavfi.scd.mafd: 4\n'), [2.033333]);
  assert.deepEqual(parseScdet(''), []);
});

test('the constants are scdet\'s own default threshold and the two-second fast-shot line', () => {
  assert.equal(SCENE_THRESHOLD, 10);
  assert.equal(FAST_SHOT_SECONDS, 2);
});

test('shot lengths come from the cuts and the duration', () => {
  assert.deepEqual(shotStats([1, 2], 3.5), { count: 2, median: 1, shortest: 1, longest: 1.5 });
  assert.deepEqual(shotStats([], 4), { count: 0, median: 4, shortest: 4, longest: 4 });
  assert.equal(shotStats([1, 2, 4], 6).median, 1.5, 'an even number of shots: the middle two averaged');
});

test('every field says whether it was measured or guessed', () => {
  const r = measureReport({ probe: { duration: 3, width: 1080, height: 1920, fps: 30 }, cuts: [1, 2], loudness: { lufs: -14.2, truePeak: -1.1 } });
  assert.deepEqual(r.cuts, { value: 2, basis: 'measured' });
  assert.deepEqual(r.size, { value: [1080, 1920], basis: 'measured' });
  assert.deepEqual(r.mode, { value: 'viral', basis: 'guessed' });
  assert.deepEqual(r.pace, { value: 'fast', basis: 'guessed' });
  assert.deepEqual(Object.keys(r), ['duration', 'size', 'fps', 'cuts', 'shotMedian', 'shotShortest', 'shotLongest', 'lufs', 'truePeakDb', 'mode', 'pace']);
  for (const field of Object.values(r)) assert.ok(['measured', 'guessed'].includes(field.basis));
});

test('a file with no sound has null loudness, still measured; a wide slow film is pro and calm', () => {
  const r = measureReport({ probe: { duration: 10, width: 1920, height: 1080, fps: 24 }, cuts: [], loudness: null });
  assert.deepEqual(r.lufs, { value: null, basis: 'measured' });
  assert.deepEqual(r.truePeakDb, { value: null, basis: 'measured' });
  assert.deepEqual(r.mode, { value: 'pro', basis: 'guessed' });
  assert.deepEqual(r.pace, { value: 'calm', basis: 'guessed' });
});

test('in --json, digital silence is the string "-inf" and a file with no sound is null, so the two differ', () => {
  const silent = measureReport({ probe: { duration: 3, width: 320, height: 180, fps: 30 }, cuts: [], loudness: { lufs: -Infinity, truePeak: -Infinity } });
  const none = measureReport({ probe: { duration: 3, width: 320, height: 180, fps: 30 }, cuts: [], loudness: null });
  assert.deepEqual(JSON.parse(reportJson(silent)).truePeakDb, { value: '-inf', basis: 'measured' });
  assert.deepEqual(JSON.parse(reportJson(silent)).lufs, { value: '-inf', basis: 'measured' });
  assert.deepEqual(JSON.parse(reportJson(none)).truePeakDb, { value: null, basis: 'measured' });
  assert.equal(JSON.parse(reportJson(none)).duration.value, 3, 'numbers stay numbers');
});

test('a run that passes its time limit says so, with the limit, instead of "exited null"', async () => {
  const result = await runTool(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 200);
  assert.equal(result.timedOut, true);
  assert.equal(result.code, null);
  assert.match(fail('ffmpeg could not measure the file', result, 300_000).message, /did not finish within 300 s/);
  assert.match(fail('ffprobe could not read the frame rate', { code: 1, timedOut: false, kept: ['boom'] }, 10_000).message, /: boom$/);
});

// F-9: tools.md promises `did not finish within <n> s` for the ffprobe checks as well as the scan.
test('a clip probe that passes its time limit says so with the limit, as the scan and the frame rate do', async () => {
  const hang = fakeTool('ffprobe', 'setTimeout(() => {}, 10000);');
  await assert.rejects(probeClip({ file: plainFile, ffprobe: hang, timeout: 200 }), (e) => /^ffprobe did not finish within 0\.2 s reading plain\.mp4$/.test(e.message));
});

test('a URL, a folder, a link and a named pipe each exit 2 with the local-files message, and no ffmpeg is started for them', async () => {
  const marker = path.join(dir, 'ffmpeg-started');
  const fake = fakeTool('marker', `require('node:fs').appendFileSync(${JSON.stringify(marker)}, 'started\\n'); process.exit(1);`);
  const args = ['https://example.com/a.mp4', 'HTTP://example.com/a.mp4', 'rtsp://127.0.0.1/a', folder, linkToScript, path.join(dir, 'missing.mp4')];
  if (fifo !== null) args.push(fifo);
  for (const arg of args) {
    const result = await measure([arg], { FFMPEG_PATH: fake, FFPROBE_PATH: fake });
    assert.equal(result.status, 2, arg);
    assert.match(result.stderr, LOCAL_ONLY, arg);
  }
  assert.equal(existsSync(marker), false, 'neither ffmpeg nor ffprobe ran');
});

test('no argument, or two, is exit 2 with the usage line', async () => {
  assert.equal((await measure([])).status, 2);
  assert.equal((await measure([fixture, fixture])).status, 2);
});

test('a playlist, an HLS file named .mp4 and a concat script that name a URL are refused, the URL is never opened, and every call carries the whitelists', { skip: !hasFfmpeg }, async () => {
  // This ffmpeg's own defaults refuse these files too, so the refusal alone would pass without the whitelists: the
  // recording wrappers show that what was run carried them (the playlist is refused at the probe, so one call each).
  for (const arg of [playlist, playlistAsMp4, concatScript]) {
    const { env, calls } = recorders();
    const result = await measure([arg], env);
    assert.equal(result.status, 2, arg);
    assert.match(result.stderr, LOCAL_ONLY, arg);
    assert.deepEqual(calls().map((c) => c.tool), ['ffprobe'], arg);
    assertWhitelisted(calls(), arg);
  }
  assert.deepEqual(hits, [], 'the local server saw no request');
});

// F-10 (R-3): a recorder that cannot find the real binary used to spawn '' and fail with an unrelated exit 1.
test('realBinary says which tool is missing instead of giving an empty path', () => {
  assert.throws(() => realBinary('no-such-tool-for-measure-test'), /no-such-tool-for-measure-test is not on PATH/);
});

// R-4: a machine whose ffmpeg is found only through FFMPEG_PATH or FFPROBE_PATH runs the recorder tests, not errors in them.
test('realBinary honours FFMPEG_PATH and FFPROBE_PATH when set, and falls back to PATH when they are empty', () => {
  assert.equal(realBinary('ffmpeg', { FFMPEG_PATH: '/opt/x/ffmpeg' }), '/opt/x/ffmpeg');
  assert.equal(realBinary('ffprobe', { FFPROBE_PATH: '/opt/x/ffprobe' }), '/opt/x/ffprobe');
  if (!hasFfmpeg) return;
  assert.equal(realBinary('ffmpeg', { FFPROBE_PATH: '/opt/x/ffprobe' }), realBinary('ffmpeg', {}), 'the other tool\'s variable is not read');
  assert.equal(realBinary('ffmpeg', { FFMPEG_PATH: '' }), realBinary('ffmpeg', {}), 'an empty variable is not a path');
});

// F-10 (R-2): the same three calls, answered by stand-ins that need no ffmpeg, so the whitelists are checked on every machine.
test('the probe, the frame rate and the pass are each opened behind the whitelists, with no ffmpeg installed', async () => {
  const log = path.join(dir, `calls-${toolCount++}.jsonl`);
  const note = (tool) => `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ tool: ${JSON.stringify(tool)}, argv: args }) + '\\n');`;
  const ffprobe = fakeTool('ffprobe', `${note('ffprobe')}\nif (args.includes('-select_streams')) console.log(JSON.stringify({ streams: [{ avg_frame_rate: '30/1', r_frame_rate: '30/1' }] }));\nelse console.log(${JSON.stringify(probeAnswer(320))});`);
  const ffmpeg = fakeTool('ffmpeg', `${note('ffmpeg')}\nconsole.error('[Parsed_scdet_0 @ 0x1] lavfi.scd.score: 15.6, lavfi.scd.time: 1');`);
  const result = await measure([plainFile, '--json'], { FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe });
  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(calls.map((c) => c.tool), ['ffprobe', 'ffprobe', 'ffmpeg']);
  assertWhitelisted(calls, plainFile);
});

test('a measured file is read by three calls, the probe, the frame rate and the pass, each behind the whitelists', { skip: !hasFfmpeg }, async () => {
  const { env, calls } = recorders();
  const result = await measure([fixture, '--json'], env);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls().map((c) => c.tool), ['ffprobe', 'ffprobe', 'ffmpeg']);
  assertWhitelisted(calls(), fixture);
});

test('a frame rate ffprobe does not give prints "unknown", not the no-sound label', async () => {
  const ffprobe = fakeTool('ffprobe', `if (args.includes('-select_streams')) console.log(JSON.stringify({ streams: [{ avg_frame_rate: '0/0', r_frame_rate: '0/0' }] }));\nelse console.log(${JSON.stringify(probeAnswer(320))});`);
  const ffmpeg = fakeTool('ffmpeg', "console.error('[Parsed_scdet_0 @ 0x1] lavfi.scd.score: 15.6, lavfi.scd.time: 1');");
  const result = await measure([plainFile], { FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\bfps\s+unknown\n/);
  assert.doesNotMatch(result.stdout.split('\n').find((l) => /\bfps\b/.test(l)), /no sound/);
});

// ffmpeg 7+ filters video and audio on separate threads, and ebur128 builds each per-frame line from several av_log
// calls (f_ebur128.c), so scdet's line can land inside one; av_log then prints it with no prefix of its own. CI's
// ffmpeg 8.0.1 did this and the cut was dropped with the progress line (1 cut of 2 on the fixture, now and then).
const withSound = JSON.stringify({ streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 320, height: 180 }, { index: 1, codec_type: 'audio', codec_name: 'aac' }], format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '3.0' } });
const SUMMARY = '[Parsed_ebur128_0 @ 0x2] Summary:\\n\\n  Integrated loudness:\\n    I:         -21.8 LUFS\\n    Threshold: -31.8 LUFS\\n\\n  True peak:\\n    Peak:      -17.7 dBFS';
const soundProbe = () => fakeTool('ffprobe', `if (args.includes('-select_streams')) console.log(JSON.stringify({ streams: [{ avg_frame_rate: '30/1', r_frame_rate: '30/1' }] }));\nelse console.log(${JSON.stringify(withSound)});`);

test('a scdet line printed inside an ebur128 progress line still counts as a cut', async () => {
  const merged = '[Parsed_ebur128_0 @ 0x2] t: 1.299977   TARGET:-23 LUFS    M: -21.7 S:-120.7     I: -21.8 LUFS       LRA:   0.0 LU  FTPK: -17.8 dBFSlavfi.scd.score: 15.625, lavfi.scd.time: 1';
  const ffmpeg = fakeTool('ffmpeg', `console.error(${JSON.stringify(merged)});\nconsole.error('  TPK: -17.7 dBFS');\nconsole.error('[Parsed_scdet_0 @ 0x1] lavfi.scd.score: 15.625, lavfi.scd.time: 2');\nconsole.error('${SUMMARY}');`);
  const result = await measure([plainFile, '--json'], { FFMPEG_PATH: ffmpeg, FFPROBE_PATH: soundProbe() });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).cuts.value, 2, result.stdout);
});

test('the pass turns off ebur128\'s per-frame log, so no progress line can swallow a scdet line', async () => {
  const log = path.join(dir, `calls-${toolCount++}.jsonl`);
  const ffmpeg = fakeTool('ffmpeg', `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');\nconsole.error('${SUMMARY}');`);
  const result = await measure([plainFile, '--json'], { FFMPEG_PATH: ffmpeg, FFPROBE_PATH: soundProbe() });
  assert.equal(result.status, 0, result.stderr);
  const argv = JSON.parse(readFileSync(log, 'utf8').trim());
  assert.equal(argv[argv.indexOf('-af') + 1], 'ebur128=peak=true:framelog=quiet');
});

test('an ffprobe that gives no JSON, or no frame rate JSON, is one error line and exit 1, not a stack', async () => {
  const ffmpeg = fakeTool('ffmpeg', 'process.exit(1);');
  const garbage = fakeTool('ffprobe', "console.log('not json');");
  const garbageRate = fakeTool('ffprobe', `if (args.includes('-select_streams')) console.log('not json');\nelse console.log(${JSON.stringify(probeAnswer(320))});`);
  for (const ffprobe of [garbage, garbageRate]) {
    const result = await measure([plainFile], { FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr.trim().split('\n').length, 1, result.stderr);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  }
});

test('a real local video the probe refuses for its size says why, not "local files only"', async () => {
  const ffprobe = fakeTool('ffprobe', `console.log(${JSON.stringify(probeAnswer(8000))});`);
  const result = await measure([plainFile], { FFMPEG_PATH: fakeTool('ffmpeg', 'process.exit(1);'), FFPROBE_PATH: ffprobe });
  assert.equal(result.status, 2, result.stderr);
  assert.doesNotMatch(result.stderr, /local files only/);
  assert.match(result.stderr, /plain\.mp4 cannot be measured: is 8000x180; a clip's frame may be at most 4096 px a side/);
});

test('a fixture with two known cuts measures two cuts within a frame of 1 s and 2 s', { skip: !hasFfmpeg }, async () => {
  const run = await measure([fixture, '--json']);
  assert.equal(run.status, 0, run.stderr);
  const r = JSON.parse(run.stdout);
  assert.equal(r.cuts.value, 2); assert.equal(r.cuts.basis, 'measured');
  assert.ok(Math.abs(r.shotMedian.value - 1) <= 1 / 30);
  assert.ok(Math.abs(r.shotShortest.value - 1) <= 1 / 30);
  assert.ok(Math.abs(r.duration.value - 3) <= 1 / 30);
  assert.deepEqual(r.size, { value: [320, 180], basis: 'measured' });
  assert.equal(r.fps.value, 30);
  assert.equal(r.lufs.basis, 'measured'); assert.equal(typeof r.lufs.value, 'number');
  assert.equal(typeof r.truePeakDb.value, 'number');
  assert.deepEqual(r.mode, { value: 'pro', basis: 'guessed' });
  assert.deepEqual(r.pace, { value: 'fast', basis: 'guessed' });
});

test('the text form prints the measured group, then the guessed group, and writes nothing', { skip: !hasFfmpeg }, async () => {
  const run = await measure([fixture]);
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.split('\n');
  const measured = lines.indexOf('measured');
  const guessed = lines.indexOf('guessed');
  assert.ok(measured >= 0 && guessed > measured, run.stdout);
  assert.match(run.stdout, /\bcuts\b\s+2\b/);
  assert.match(run.stdout, /\bmode\b\s+pro\b/);
  assert.equal(run.stderr, '');
});
