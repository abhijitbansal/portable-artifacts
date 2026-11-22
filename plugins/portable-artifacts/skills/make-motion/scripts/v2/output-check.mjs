// The check of the finished file (R2-1): ffmpeg decodes the MP4 the render is about to keep to small gray frames, and the
// file is refused when it holds a different number of frames than the timeline, or when no frame of it has any detail (a
// browser that drew or captured nothing, an encode that lost frames). The frames are read as a stream, one at a time:
// never the whole film in memory.
//
// Not checked, on purpose: a picture that does not move (a film of one held still is legal) and a flat stretch inside a
// film (a flood, a field, the poster look's grounds). Only a wrong frame count, or a film with no detail in any frame, fails.
import { spawn } from 'node:child_process';

export const CHECK_WIDTH = 96;
export const CHECK_HEIGHT = 54;
// The standard deviation of a frame's luma, in levels of 255, under which a frame has no detail. The lowest of ten finished
// films measured 47.21 (W0 pixel pass), so a legal film sits far above it.
export const BLANK_STD = 1.5;
const FRAME_BYTES = CHECK_WIDTH * CHECK_HEIGHT;
const QUIET = ['-hide_banner', '-loglevel', 'error'];
const STDERR_KEEP = 4000;
const STDERR_LINES = 5;

/** The ffmpeg arguments that decode the first video stream of `file` to CHECK_WIDTH by CHECK_HEIGHT 8-bit gray frames on stdout. */
export const checkArgs = (file) => [...QUIET, '-i', file, '-map', '0:v:0', '-vf', `scale=${CHECK_WIDTH}:${CHECK_HEIGHT}:flags=area,format=gray`, '-f', 'rawvideo', '-'];

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
 * @param {{ ffmpeg: string, file: string, frames: number, signal?: AbortSignal }} opts
 * @returns {Promise<{ decoded: number }>}
 */
export function checkOutput({ ffmpeg, file, frames, signal }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const child = spawn(ffmpeg, checkArgs(file), { stdio: ['ignore', 'pipe', 'pipe'] });
    const stds = [];
    let carry = Buffer.alloc(0);
    let stderr = '';
    let failure = null;
    const onAbort = () => { child.kill('SIGKILL'); reject(signal.reason); };
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-STDERR_KEEP); });
    child.stdout.on('data', (chunk) => {
      const bytes = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
      let offset = 0;
      for (; offset + FRAME_BYTES <= bytes.length; offset += FRAME_BYTES) stds.push(lumaStd(bytes, offset));
      carry = Buffer.from(bytes.subarray(offset)); // a copy: the chunk's memory is reused
    });
    child.on('error', (err) => { failure = err.message; });
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      if (failure !== null || code !== 0) {
        const said = stderr.trim().split('\n').filter(Boolean).slice(-STDERR_LINES).join(' | ');
        return reject(refusal(`ffmpeg could not read the finished file (${failure ?? `exit ${code}`}): ${said}`));
      }
      const problem = outputProblem({ decoded: stds.length, stds, frames });
      return problem === null ? resolve({ decoded: stds.length }) : reject(refusal(problem));
    });
  });
}
