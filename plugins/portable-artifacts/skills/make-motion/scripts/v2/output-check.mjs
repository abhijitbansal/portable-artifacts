// The check of the finished file (R2-1): ffmpeg decodes the MP4 the render is about to keep to small gray frames, and the
// file is refused when it holds a different number of frames than the timeline, or when no frame of it has any detail (a
// browser that drew or captured nothing, an encode that lost frames). The frames are read as a stream, one at a time:
// never the whole film in memory.
//
// Not checked, on purpose: a picture that does not move (a film of one held still is legal) and a flat stretch inside a
// film (a flood, a field, the poster look's grounds). Only a wrong frame count, or a film with no detail in any frame, fails.
import { spawn, spawnSync } from 'node:child_process';
// The finished film is our own MP4: it is opened by the builder that allows the file protocol and the MP4 demuxers only.
import { ownMp4Input } from './voice/master.mjs';

export const CHECK_WIDTH = 96;
export const CHECK_HEIGHT = 54;
// The standard deviation of a frame's luma, in levels of 255, under which a frame has no detail. The lowest of ten finished
// films measured 47.21 (W0 pixel pass), so a legal film sits far above it.
export const BLANK_STD = 1.5;
const FRAME_BYTES = CHECK_WIDTH * CHECK_HEIGHT;
const QUIET = ['-hide_banner', '-loglevel', 'error'];
const STDERR_KEEP = 4000;
const STDERR_LINES = 5;

// `-fps_mode` came with ffmpeg 5.1; before it the same thing is `-vsync` (which later releases deprecate). Nothing in the
// plugin requires 5.1 for a silent film, so the flag is chosen by the version ffmpeg says it is.
const FPS_MODE_FROM = { major: 5, minor: 1 };
const VERSION_LINE = /ffmpeg version n?(\d+)\.(\d+)/i;
const versions = new Map(); // ffmpeg path -> its version, read once

/** { major, minor } from the first line `ffmpeg -version` prints, or null for a build that carries no number (a git build). */
export function versionOf(text) {
  const found = VERSION_LINE.exec(text);
  return found === null ? null : { major: Number(found[1]), minor: Number(found[2]) };
}

// A probe that does not answer in this long counts as no version, which gets the modern flag.
export const VERSION_PROBE_TIMEOUT_MS = 5000;

/** The version of the ffmpeg at `ffmpeg`, read once per path; null when it does not say, cannot be run or does not answer in time. `probe` is for tests. */
export function ffmpegVersion(ffmpeg, probe = spawnSync) {
  if (!versions.has(ffmpeg)) {
    const run = probe(ffmpeg, ['-version'], { encoding: 'utf8', timeout: VERSION_PROBE_TIMEOUT_MS });
    versions.set(ffmpeg, run.status === 0 ? versionOf(run.stdout.split('\n')[0] ?? '') : null);
  }
  return versions.get(ffmpeg);
}

const knowsFpsMode = (version) => version === null || version === undefined
  || version.major > FPS_MODE_FROM.major || (version.major === FPS_MODE_FROM.major && version.minor >= FPS_MODE_FROM.minor);

/**
 * The ffmpeg arguments that decode the first video stream of `file` to CHECK_WIDTH by CHECK_HEIGHT 8-bit gray frames on
 * stdout. Passthrough pacing (`-fps_mode passthrough`, or `-vsync passthrough` before ffmpeg 5.1; an unknown version gets
 * the newer flag) makes the count the frames in the file: the default would repeat or drop frames to keep a steady rate,
 * hiding a lost frame or failing a legal film.
 * @param {string} file
 * @param {{ version?: { major: number, minor: number } | null }} [opts] the ffmpeg's version (versionOf)
 */
export const checkArgs = (file, { version = null } = {}) => [
  ...QUIET, ...ownMp4Input(file), '-map', '0:v:0', '-vf', `scale=${CHECK_WIDTH}:${CHECK_HEIGHT}:flags=area,format=gray`,
  ...(knowsFpsMode(version) ? ['-fps_mode', 'passthrough'] : ['-vsync', 'passthrough']), '-f', 'rawvideo', '-',
];

/** What is wrong with the finished file, or null: a frame count that differs from the timeline's, or a picture with no detail. */
export function outputProblem({ decoded, stds, frames }) {
  if (decoded !== frames) return `the finished file holds ${decoded} frames, the timeline has ${frames}`;
  if (stds.every((std) => std < BLANK_STD)) return `the finished file's picture is blank: none of its ${decoded} frames has any detail`;
  return null;
}

// The standard deviation of the CHECK_WIDTH by CHECK_HEIGHT gray frame in `bytes` from `offset`. The sums are exact in a double.
function lumaStd(bytes, offset) {
  let sum = 0;
  let squares = 0;
  for (let i = offset; i < offset + FRAME_BYTES; i++) {
    sum += bytes[i];
    squares += bytes[i] * bytes[i];
  }
  const mean = sum / FRAME_BYTES;
  return Math.sqrt(Math.max(0, squares / FRAME_BYTES - mean * mean));
}

const refusal = (problem) => new Error(`render check: ${problem}; nothing was written`);

/**
 * Decodes `file` and throws `render check: <problem>; nothing was written` when its frame count is not `frames` or no frame
 * of it has any detail, or when ffmpeg cannot read it; else { decoded }. `signal` stops it (ffmpeg is killed, the promise
 * rejects with the signal's reason).
 * `beat` is called once per decoded frame (the stage clock restarts its stall limit on it: capture-clock.mjs), and
 * `stalled` is the clock's signal, aborted when the stage stalls: ffmpeg is killed then as well. `version` is the ffmpeg's
 * (default: asked of the ffmpeg once); `spawn` is for tests.
 * @param {{ ffmpeg: string, file: string, frames: number, signal?: AbortSignal, stalled?: AbortSignal, beat?: () => void,
 *   version?: { major: number, minor: number } | null, spawn?: typeof spawn }} opts
 * @returns {Promise<{ decoded: number }>}
 */
export function checkOutput({ ffmpeg, file, frames, signal, stalled, beat, version, spawn: start = spawn }) {
  return new Promise((resolve, reject) => {
    const stops = [signal, stalled].filter(Boolean);
    const already = stops.find((s) => s.aborted);
    if (already) return reject(already.reason);
    const child = start(ffmpeg, checkArgs(file, { version: version === undefined ? ffmpegVersion(ffmpeg) : version }), { stdio: ['ignore', 'pipe', 'pipe'] });
    const stds = [];
    let carry = Buffer.alloc(0);
    let stderr = '';
    let failure = null;
    const onAbort = (stop) => () => { reject(stop.reason); child.kill('SIGKILL'); }; // reject first: a kill's close must not speak for it
    const listeners = stops.map((stop) => [stop, onAbort(stop)]);
    for (const [stop, listener] of listeners) stop.addEventListener('abort', listener, { once: true });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-STDERR_KEEP); });
    child.stdout.on('data', (chunk) => {
      const bytes = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
      let offset = 0;
      for (; offset + FRAME_BYTES <= bytes.length; offset += FRAME_BYTES) {
        stds.push(lumaStd(bytes, offset));
        beat?.();
      }
      carry = Buffer.from(bytes.subarray(offset)); // a copy: the chunk's memory is reused
    });
    child.on('error', (err) => { failure = err.message; });
    child.on('close', (code) => {
      for (const [stop, listener] of listeners) stop.removeEventListener('abort', listener);
      if (failure !== null || code !== 0) {
        const said = stderr.trim().split('\n').filter(Boolean).slice(-STDERR_LINES).join(' | ');
        return reject(refusal(`ffmpeg could not read the finished file (${failure ?? `exit ${code}`}): ${said}`));
      }
      const problem = outputProblem({ decoded: stds.length, stds, frames });
      return problem === null ? resolve({ decoded: stds.length }) : reject(refusal(problem));
    });
  });
}
