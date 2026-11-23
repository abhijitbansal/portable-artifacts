#!/usr/bin/env node
// Turns one reference video on this machine into numbers about its pacing and loudness, each labelled measured or guessed:
//   node scripts/measure.mjs <video file> [--json]
// ffmpeg's scdet finds the cuts and ebur128 the loudness, in one pass over the file. The file is opened as a clip is
// (scripts/v2/clips.mjs clipInput): the file protocol only, the clip demuxers only and the accepted decoders only, so a
// playlist or a concat script that names a URL is refused by what ffmpeg opens, not just by the argument. Nothing is
// fetched and nothing is written; the output is numbers only. Exit 0 done; exit 2: anything that is not a regular local
// file of an accepted format (a URL, a folder, a link, a playlist), one line on stderr; exit 1: ffmpeg is missing or fails.
import { spawn } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli } from '../shared/cli.mjs';
import { findFfmpeg, findFfprobe, parseLoudness } from './lib/ffmpeg.mjs';
import { SCENE_THRESHOLD, measureReport, parseScdet, reportJson } from './lib/measure.mjs';
import { clipInput, clipProblem, probeClip } from './v2/clips.mjs';

const SELF = fileURLToPath(import.meta.url);
const USAGE = 'node scripts/measure.mjs <video file> [--json]';
const OPTIONS = { json: { type: 'boolean' } };
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCAL_ONLY = 'local files only: give the path of a video file on this machine (mp4, mov, m4v, webm or mkv)';
const RUN_TIMEOUT_MS = 300_000;
const PROBE_TIMEOUT_MS = 10_000;
const KEPT_LINES = 40; // of ffmpeg's log, for an error message
// ebur128 with its per-frame log off (a line every 100 ms otherwise): ffmpeg 7+ filters video and audio on separate
// threads and builds each of those lines from several log calls, so a scdet line could land inside one. Every line is kept.
const LOUDNESS = 'ebur128=peak=true:framelog=quiet';

/** An error that exits 2 with its message (and, when set, a second line saying why a file was refused). */
class Refused extends UsageError {
  constructor(message, why) {
    super(message);
    this.why = why;
  }
}

/** The file to measure, as an absolute path: a regular file named on this machine, never a URL or a link. */
function localFile(argv) {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  if (positionals.length !== 1) throw new UsageError(`expected one video file, got ${positionals.length}; usage: ${USAGE}`);
  const [arg] = positionals;
  if (URL_SCHEME.test(arg)) throw new Refused(LOCAL_ONLY);
  let stat = null;
  try { stat = lstatSync(arg); } catch { /* not there */ }
  if (stat === null || stat.isSymbolicLink() || !stat.isFile()) throw new Refused(LOCAL_ONLY);
  return { file: path.resolve(arg), json: values.json === true };
}

// Runs `binary args` and resolves { code, stdout, kept } where `kept` is stderr, one entry a line.
// `timedOut` is true when `timeout` ms passed and the process was killed.
export function run(binary, args, timeout) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const kept = [];
    let stdout = '';
    let pending = '';
    let timedOut = false;
    const keep = (line) => { kept.push(line); };
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop();
      lines.forEach(keep);
    });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      keep(pending);
      resolve({ code, stdout, kept, timedOut });
    });
  });
}

/** An exit-1 error for a tool that failed: `what`, then the limit when it ran out of time, else its last log line. */
export const fail = (what, result, limitMs) => {
  const why = result.timedOut === true ? `did not finish within ${limitMs / 1000} s` : (result.kept.filter((l) => l.trim() !== '').slice(-1)[0] ?? `exited ${result.code}`);
  return Object.assign(new Error(`${what}: ${why}`), { exitCode: 1 });
};

// ffprobe's frame rate of the one video stream ("30000/1001"), or null when the file does not give one.
async function frameRate(ffprobe, file) {
  const args = ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=avg_frame_rate,r_frame_rate', '-of', 'json', ...clipInput(file)];
  const result = await run(ffprobe, args, PROBE_TIMEOUT_MS);
  if (result.code !== 0) throw fail('ffprobe could not read the frame rate', result, PROBE_TIMEOUT_MS);
  let stream;
  try {
    stream = JSON.parse(result.stdout).streams?.[0] ?? {};
  } catch {
    throw Object.assign(new Error('ffprobe could not read the frame rate: its answer is not JSON'), { exitCode: 1 });
  }
  for (const text of [stream.avg_frame_rate, stream.r_frame_rate]) {
    const [num, den] = String(text ?? '').split('/').map(Number);
    if (num > 0 && den > 0) return Math.round((num / den) * 1000) / 1000;
  }
  return null;
}

// Why a probed file is refused. A file the clip demuxers or decoders will not open (a playlist, a concat script, a
// format off the list) is the local-files refusal; a clip that opens but is too large or has extra streams says what.
function refusal(file, probe, problem) {
  const name = path.basename(file);
  if (probe.error !== undefined && probe.codecRefused !== true) return new Refused(LOCAL_ONLY, `${name} ${problem}`);
  return new Refused(`${name} cannot be measured: ${problem}`);
}

async function measureFile(file) {
  const ffmpeg = await findFfmpeg().catch((e) => { throw Object.assign(e, { exitCode: 1 }); });
  const ffprobe = findFfprobe({ ffmpeg });
  if (ffprobe === null) throw Object.assign(new Error('ffprobe not found: it is needed to check a video before it is read; install ffmpeg with its ffprobe, or set FFPROBE_PATH'), { exitCode: 1 });
  const probe = await probeClip({ file, ffprobe }).catch((e) => { // a probe that timed out or answered with no JSON: one line, exit 1
    throw Object.assign(new Error(e instanceof SyntaxError ? `ffprobe could not read ${path.basename(file)}: its answer is not JSON` : e.message), { exitCode: 1 });
  });
  const problem = clipProblem(probe);
  if (problem !== null) throw refusal(file, probe, problem);
  const fps = await frameRate(ffprobe, file);
  const sound = probe.audio ? ['-map', '0:a:0', '-af', LOUDNESS] : [];
  const args = ['-nostdin', '-hide_banner', '-nostats', '-v', 'info', ...clipInput(file), '-map', `0:${probe.videoIndex}`, '-vf', `scdet=threshold=${SCENE_THRESHOLD}`, ...sound, '-sn', '-dn', '-f', 'null', '-'];
  const result = await run(ffmpeg, args, RUN_TIMEOUT_MS);
  if (result.code !== 0) throw fail('ffmpeg could not measure the file', { ...result, kept: result.kept.slice(-KEPT_LINES) }, RUN_TIMEOUT_MS);
  const log = result.kept.join('\n');
  const loudness = probe.audio ? parseLoudness(log) : null;
  if (probe.audio && loudness === null) throw fail('ffmpeg printed no loudness summary', result, RUN_TIMEOUT_MS);
  return measureReport({ probe: { duration: probe.duration, width: probe.width, height: probe.height, fps }, cuts: parseScdet(log), loudness });
}

const UNITS = { duration: ' s', shotMedian: ' s', shotShortest: ' s', shotLongest: ' s', fps: ' fps', lufs: ' LUFS', truePeakDb: ' dBFS' };
const MEASURED = ['duration', 'size', 'fps', 'cuts', 'shotMedian', 'shotShortest', 'shotLongest', 'lufs', 'truePeakDb'];
const GUESSED = ['mode', 'pace'];

function show(name, { value }) {
  if (value === null) return name === 'fps' ? 'unknown' : 'none (no sound)';
  if (name === 'size') return value.join('x');
  return `${Number.isFinite(value) || typeof value !== 'number' ? value : (value < 0 ? '-inf' : 'inf')}${UNITS[name] ?? ''}`;
}

/** The two groups under the headings `measured` and `guessed`, one `name  value` row each. */
export function table(report) {
  const rows = (names) => names.map((name) => `  ${name.padEnd(13)}${show(name, report[name])}`);
  return `${['measured', ...rows(MEASURED), 'guessed', ...rows(GUESSED)].join('\n')}\n`;
}

/** Runs the command on `argv`; returns the exit code. `out` and `err` (writers; default: stdout and stderr) exist for tests. */
export async function main(argv, { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  try {
    const { file, json } = localFile(argv);
    const report = await measureFile(file);
    out(json ? `${reportJson(report)}\n` : table(report));
    return 0;
  } catch (e) {
    if (e instanceof UsageError && e.help === true) {
      out(`usage: ${e.message}\n`);
      return 0;
    }
    if (e instanceof UsageError) {
      err(`${String(e.message).split('\n')[0]}\n`);
      if (e.why !== undefined) err(`${e.why}\n`);
      return 2;
    }
    if (e?.exitCode === 1) {
      err(`${String(e.message).split('\n')[0]}\n`);
      return 1;
    }
    throw e;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === SELF) {
  process.exitCode = await main(process.argv.slice(2));
}
