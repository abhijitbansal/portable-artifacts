// Render a film to an H.264 yuv420p MP4. The page draws each frame (post pass included); a screenshot of it goes to
// ffmpeg on a pipe. Two capture modes: `exact` takes PNG (lossless: tests, sheets, --exact) and the default `fast`
// takes JPEG at quality 98 (a grainy frame costs far less to encode as JPEG). A frame whose __stateKey equals the
// previous frame's is not captured again: the previous picture is sent twice. The video is written to a partial file
// in a private folder (random name) beside the output and renamed when ffmpeg is done, so a stop or a failure leaves no half-written MP4 behind.
// A film's sound (voice/master.mjs: its narration, and the cues and music bed of the run's sound plan) is mixed, mastered
// and encoded to AAC before the first frame is captured, so a broken audio chain or a level the film would be refused
// for fails fast; after the video encode the AAC is muxed into a second partial file, both streams copied, and only that
// file is renamed to the output. A film with neither a voice nor sound
// takes none of those steps: its video is exactly what it was before. A slice (`frames`) is that case too: silent.
import { spawn } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { findFfmpeg } from '../lib/ffmpeg.mjs';
import { ensureOutputFolder } from '../../shared/write-file.mjs';
import { makeWorkFolder, sweepPartials, WORK_FILES } from './work-folder.mjs';
export { makeWorkFolder, sweepPartials, WORK_OWNER_FILE } from './work-folder.mjs';
// for scripts/v2 modules that run ffmpeg themselves (clips.mjs) without importing scripts/lib/ffmpeg.mjs directly
export { findFfmpeg, findFfprobe } from '../lib/ffmpeg.mjs';
import { registries } from '../../engine/registry.mjs';
import '../../engine/modes/index.mjs'; // registers the modes whose loudness a voiced film is mastered to
import { loadFilm } from './pipeline.mjs';
import { TAIL_LINES, createStageClock } from './capture-clock.mjs';
import { checkOutput } from './output-check.mjs';
import { openSession } from './session.mjs';
import { withStamp } from './stamp.mjs';
import { captureParallel, workerRanges } from './workers.mjs';

// The voice steps, loaded when a film is voiced. A silent film still loads voice/master.mjs through output-check.mjs (the
// check opens the finished MP4 with its ownMp4Input), but never voice/remaster.mjs or any optional voice package.
const voiceSteps = async () => ({ ...await import('./voice/master.mjs'), ...await import('./voice/remaster.mjs') });

export const JPEG_QUALITY = 98;
const HELD_CHUNK = 150; // frames whose held flags are fetched in one page.evaluate
const MS_PER_SECOND = 1000;
const BITS_PER_BYTE = 8;
const MEGA = 1e6;
const STDERR_KEEP = 4000;
const STDERR_LINES = 5;
const QUIET = ['-hide_banner', '-loglevel', 'error'];
const DEFAULT_MODE = 'pro'; // as the timeline's (engine/script/timing.mjs)

// Every film is BT.709 limited range, the colour a player assumes for HD, and says so: the last filter writes the tags
// (matrix, primaries, transfer and range) onto the stream, and they survive the stream copy of the mux. Without them a
// player guesses, and ffmpeg's own default for an untagged file is BT.601.
export const BT709_TAGS = 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv';

// One scale filter converts the matrix and the range together. A JPEG decodes to full-range BT.601 YUV (its JFIF
// default), so the fast path names that input and converts it; a PNG decodes to RGB and needs only the output named.
// The fast path's conversion is YUV to YUV, which swscale rounds coarsely by default (a mid grey comes out as 125, 127,
// 127 when read back); accurate_rnd and full_chroma_int make it round to the nearest level (the same grey reads 128).
const COLOUR_FILTER = {
  fast: `scale=in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,${BT709_TAGS}`,
  exact: `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,${BT709_TAGS}`,
};

// The encoder settings, chosen by measurement (see the report of task 12, round 4): libx264 at crf 23 with `-tune film`
// keeps the look's grain (about 85% of its high-pass energy on flat paper) at a size that a 20 s 1080p desk film fits in
// under 20 MB; the version 1 default (no -crf, so crf 23 with no tune) gave 28 Mbit/s on grain at 0.05.
export const ENCODER = Object.freeze({ preset: 'medium', crf: 23, tune: 'film' });

/**
 * The ffmpeg arguments for frames on a pipe: PNG frames (exact) or JPEG frames (fast) into H.264 yuv420p, converted to
 * BT.709 limited range by one scale filter and tagged by the last filter (COLOUR_FILTER). Built here rather than from the
 * version 1 helper, which cannot express a crf or a tune.
 */
export function encoderArgs({ fps, out, exact, stamp = [] }) {
  const input = ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', exact ? 'png' : 'mjpeg', '-i', '-', '-vf', exact ? COLOUR_FILTER.exact : COLOUR_FILTER.fast];
  const video = ['-c:v', 'libx264', '-preset', ENCODER.preset, '-crf', String(ENCODER.crf), '-tune', ENCODER.tune, '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];
  return [...input, ...video, ...stamp, out];
}

// The runner for the mux of a film with sound: the stamp goes on the one command that writes `out` (voice/master.mjs
// muxVoice also measures the finished file through the same runner, and that command is left as it is).
const stampedRunner = (run, out, stamp) => (args) => run(args.at(-1) === out ? withStamp(args, stamp) : args);

// A promise that rejects when `signal` aborts (never settles without one); a stalled ffmpeg must not hold a stop request.
function abortion(signal) {
  const promise = new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  promise.catch(() => {}); // it is only ever raced: an abort nobody is waiting on is not an unhandled rejection
  return promise;
}

// An ffmpeg process with a promise for its end and a write() that waits for the pipe, fails when ffmpeg has died and
// gives way to `signal`. Its failures carry the last STDERR_LINES lines ffmpeg said.
function startEncoder(ffmpeg, args, signal) {
  const child = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'] });
  const aborted = abortion(signal);
  let stderr = '';
  let failure = null;
  let exitCode = null; // set once the process has ended
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-STDERR_KEEP); });
  child.stdin.on('error', (err) => { failure ??= err; });
  const ended = new Promise((resolve) => {
    child.on('error', (err) => { failure ??= err; exitCode = -1; resolve(-1); });
    child.on('close', (code) => { exitCode = code; resolve(code); });
  });
  const said = () => stderr.trim().split('\n').filter(Boolean).slice(-STDERR_LINES).join(' | ');
  const fail = (code) => new Error(`ffmpeg failed (${failure?.message ?? `exit ${code}`}): ${said()}`);
  return {
    async write(buffer) {
      signal?.throwIfAborted();
      if (!failure && exitCode === null && !child.stdin.write(buffer)) {
        await Promise.race([new Promise((resolve) => child.stdin.once('drain', resolve)), ended, aborted]); // neither a dying nor a stalled ffmpeg may hold this
      }
      if (failure || exitCode !== null) throw fail(exitCode);
    },
    async finish() {
      child.stdin.end();
      const code = await Promise.race([ended, aborted]);
      if (code !== 0 || failure) throw fail(code);
    },
    async stop() {
      child.kill('SIGKILL');
      await ended;
    },
  };
}

// Which of frames from..to equal their predecessor under the capture key.
// Timed as part of the draw stage (the page works out the frames' state keys), so a page that hangs here names it.
export const heldFlags = (page, from, to, clock) => clock.time('draw', from, () => page.evaluate(([a, b]) => window.__heldFlags(a, b, true), [from, to]));

const capture = (page, exact) => page.screenshot(exact ? { type: 'png' } : { type: 'jpeg', quality: JPEG_QUALITY });

/**
 * Frame `i` on `page`: the seek that draws it (timed as `draw`), then its screenshot (timed as `capture`). Both capture
 * paths, one page and --workers, take their pictures through this one function, so both are timed and both stall by name.
 */
export async function shootFrame(page, i, { exact, clock }) {
  await clock.time('draw', i, () => page.evaluate((k) => window.__seek(k), i));
  return clock.time('capture', i, () => capture(page, exact));
}

// The frames of the film to draw: all of them, or `range` ({ from, to }, inclusive) when a slice is rendered. A range
// outside the timeline is a mistake of the caller's, said before anything is captured.
function frameSpan(timeline, range) {
  if (range === undefined) return { first: 0, last: timeline.frameCount - 1 };
  const { from, to } = range;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to >= timeline.frameCount) {
    throw new Error(`renderFilm: frames ${JSON.stringify(range)} is not a range inside the film's ${timeline.frameCount} frames (from <= to, both whole frame numbers)`);
  }
  return { first: from, last: to };
}

// The frames first..last, each sought by its absolute index (the page draws a frame from its number, grain included). The
// first frame is always captured: whether it is held is judged against a predecessor this run never sent.
async function encodeFrames({ session, encoder, exact, signal, onProgress, clock, span, onFrame }) {
  const { page } = session;
  const frames = span.last - span.first + 1;
  let previous = null;
  let captured = 0;
  for (let from = span.first; from <= span.last; from += HELD_CHUNK) {
    const to = Math.min(span.last, from + HELD_CHUNK - 1);
    const held = await heldFlags(page, from, to, clock);
    for (let k = 0; k < held.length; k++) {
      signal?.throwIfAborted();
      if (previous === null || !held[k]) {
        previous = await shootFrame(page, from + k, { exact, clock });
        captured++;
      }
      await clock.time('encode', from + k, () => encoder.write(previous));
      onFrame?.(from + k, previous);
      onProgress?.({ frame: from + k - span.first + 1, frames, captured });
    }
  }
  return captured;
}

/**
 * The page and console messages of every page of the run, for a stall's "last page messages". Each page has its own
 * session and its own `errors`, and the stage clock does not know which page stalled, so all of them are read: one page
 * unlabelled, several as `page N: message`, each giving its newest TAIL_LINES / pages messages (at least one). The stall
 * error keeps max(TAIL_LINES, workers) lines (pageClock), which is never fewer than one per page, so every page's share
 * reaches it. The clock does not know which page stalled, so none is picked.
 * @param {{ errors?: string[] }[]} sessions the first page's session, then the extra pages' (encodeWithWorkers)
 */
export function pageMessages(sessions) {
  if (sessions.length === 1) return sessions[0].errors ?? [];
  const share = Math.max(1, Math.floor(TAIL_LINES / sessions.length));
  return sessions.flatMap((s, k) => (s.errors ?? []).slice(-share).map((message) => `page ${k + 1}: ${message}`));
}

/**
 * The stage clock of a run: its stall error reads the messages of every page in `sessions`, and keeps at least one line per
 * worker (more than TAIL_LINES for 6 to 8 workers), so the line count never drops the page that stalled.
 * @param {{ frames: number, sessions: { errors?: string[] }[], workers: number }} opts `rest` goes to createStageClock
 */
export const pageClock = ({ frames, sessions, workers, ...rest }) => createStageClock({ frames, tail: () => pageMessages(sessions), tailLines: Math.max(TAIL_LINES, workers), ...rest });

// --workers: the first page plus one opened through openPage per further range (workers.mjs), closed after. Each extra
// session is in `sessions` (the clock's message source) while it is open.
export async function encodeWithWorkers({ session, sessions = [session], encoder, exact, signal, onProgress, workers, openPage, clock, onFrame }) {
  const frames = session.timeline.frameCount;
  const extra = [];
  try {
    for (let k = 1; k < workerRanges(frames, workers).length; k++) {
      extra.push(await openPage());
      sessions.push(extra[extra.length - 1]);
    }
    const pages = [session.page, ...extra.map((s) => s.page)];
    return await captureParallel({
      pages, frames, onProgress, signal,
      held: (page, from, to) => heldFlags(page, from, to, clock),
      shoot: (page, i) => shootFrame(page, i, { exact, clock }),
      write: async (buffer, frame) => {
        await clock.time('encode', frame, () => encoder.write(buffer));
        onFrame?.(frame, buffer);
      },
    });
  } finally {
    for (const s of extra) sessions.splice(sessions.indexOf(s), 1);
    await Promise.all(extra.map((s) => s.close()));
  }
}

// Whether the run's sound plan has anything to put in the film: a cue track or music.
const hasSound = (sound) => Boolean(sound?.cues) || Boolean(sound?.music) || (sound?.tracks?.length ?? 0) > 0;

// The mode's loudness targets for a film with a voice or sound (validateMode required them when the mode registered); a
// voiced film rendered without its voice is refused, never rendered silent as if it had none. null: nothing to master.
function loudnessFor(film, voice, sound, slice) {
  if (slice) return null; // a slice is silent: the sound is mastered for the whole film, so a voiced slice needs no voice
  if (voice === undefined && film.voice !== undefined) throw new Error('renderFilm: the film has a voice; pass the voice stage\'s result ({ dir, sidecar }) as `voice`');
  if (voice === undefined && !hasSound(sound)) return null;
  return registries.modes.get(film.mode ?? DEFAULT_MODE).loudness;
}

// The report's audio: the level measured in the finished file, with what the sound plan put in it.
const audioOf = (level, sound) => ({ ...level, cues: sound?.cues?.count ?? 0, music: sound?.music?.summary ?? null, ...(sound?.tracks?.length > 0 ? { tracks: sound.tracks.length } : {}) });

/**
 * @param {{ specPath?: string, out: string, exact?: boolean, onProgress?: (p: { frame: number, frames: number, captured: number }) => void,
 *   session?: object, signal?: AbortSignal, voice?: { dir: string, sidecar: object }, stamp?: string[],
 *   sound?: { cues: { file: string, count: number } | null, music: { file: string, recording: boolean, fadeFrom: number | null,
 *   duck: object[], summary: object } | null } }} opts a session (openSession) is used and left open when given;
 *   otherwise the film at specPath is loaded and opened here and closed after. exact: PNG capture (default: JPEG at quality
 *   98). voice: what the voice stage made, required for a film with `voice`. sound: the run's sound plan (run.mjs: the cue
 *   track and the music, as files in the run's work folder), mixed with the voice into one master (voice/master.mjs).
 *   stamp: the provenance tags as ffmpeg arguments (stamp.mjs stampArgs), written by the last step that writes the
 *   output: the encode of a film with neither a voice nor sound, else the mux.
 *   frames: { from, to } (whole frame numbers, inclusive): render only those frames, each sought by its absolute index, so a
 *   frame is the one the whole film has at that number; the first is always captured. A slice is silent: no voice or sound
 *   is mastered or muxed (loudnessFor is null, a voiced film needs no `voice`), `audio` is null and `--workers` does not
 *   apply. The result's `frames` is then the slice's count. onFrame(index, bytes): called once per frame written, with the
 *   bytes sent to ffmpeg (the picture of the last captured frame for a held one).
 * @returns {Promise<{ out: string, frames: number, captured: number, seconds: number, msPerFrame: number, capture: 'fast' | 'exact', post: string, bytes: number, mbps: number,
 *   audio: { lufs: number | null, truePeakDb: number | null, note: string | null, cues: number, music: object | null } | null,
 *   timing: { drawMs: number, captureMs: number, encodeMs: number, checkMs: number } }>}
 *   timing: whole milliseconds spent in each stage (capture-clock.mjs); with --workers it is summed across pages, so it can
 *   exceed `seconds`. A stage that does not answer in 120 s, or a browser TimeoutError, rejects with an error that names it.
 *   The finished file is decoded before it is kept (output-check.mjs): a frame count other than the timeline's, or a
 *   picture with no detail in any frame, rejects with `render check: ...` and no output file is left.
 *   audio: the sound as measured in the finished file (lufs null, with a note, when it is too short to measure), with the
 *   cue count and the music summary of the plan; null with neither a voice nor sound (and then the video is exactly what
 *   it was: no audio step runs). A level more than 1 LU off the mode's target, or a true peak over its ceiling, fails
 *   the render (voice/master.mjs judgeLevel): the AAC encode of the master is judged before any frame is captured, and
 *   the finished file again after the mux (the same stream, copied).
 */
/**
 * The film's sound mastered and encoded as the render would make it (the same master and AAC encode, not judged), written
 * into `work` for the preview to play: its path, or null for a film with neither a voice nor sound.
 */
export async function masterSoundFile({ film, timeline, voice, sound, work, signal }) {
  const loudness = loudnessFor(film, voice, sound);
  if (loudness === null) return null;
  const steps = await voiceSteps();
  const run = steps.ffmpegRunner(await findFfmpeg(), signal);
  const master = (headroomDb) => steps.masterTrack({ run, voice, timeline, loudness, workDir: work, cues: sound?.cues ?? undefined, music: sound?.music ?? undefined, tracks: sound?.tracks ?? [], headroomDb });
  const encoded = await steps.encodeToTarget({ run, master, out: path.join(work, 'preview.m4a'), duration: timeline.duration, loudness, noVoice: !steps.hasNarration(voice) });
  return encoded.file;
}

export async function renderFilm({ specPath, out, exact = false, onProgress, session, signal, voice, sound, stamp = [], workers = 1, openPage, frames: range, onFrame }) {
  const ffmpeg = await findFfmpeg();
  const own = session === undefined;
  const loaded = own ? loadFilm(specPath) : null;
  const loudness = loudnessFor(own ? loaded.film : session.film, voice, sound, range !== undefined);
  const open = own ? await openSession(loaded) : session;
  let partial; // the video and the muxed video are made in a private folder (mkdtemp: a random name, mode 0700) beside the output
  let muxed; // and renamed over the output, so no name a repository could guess is ever opened by ffmpeg
  let scratch = null;
  let encoder = null;
  let work = null;
  const started = performance.now();
  try {
    const span = frameSpan(open.timeline, range); // refused before anything is written
    const frames = span.last - span.first + 1; // the frames the video holds: the film's, or the slice's
    const steps = loudness === null ? null : await voiceSteps();
    const run = steps?.ffmpegRunner(ffmpeg, signal);
    // A film with no narration (no voice, or a voice whose shots have no say) is cues and music alone, which may stop
    // short of the target (judgeLevel noVoice).
    const narrated = steps !== null && steps.hasNarration(voice);
    const subject = narrated ? 'the mastered narration' : 'the mastered sound';
    ensureOutputFolder(path.dirname(out)); // a symlink that leads out of the repository is refused before anything is removed or made
    sweepPartials(path.dirname(out));
    scratch = makeWorkFolder(path.dirname(out)); // marked with this run's pid: a later run's sweep removes it only when this one is dead
    partial = path.join(scratch, WORK_FILES[0]);
    muxed = path.join(scratch, WORK_FILES[1]);
    if (steps !== null) work = mkdtempSync(path.join(tmpdir(), 'mm-voice-'));
    const master = (headroomDb) => steps.masterTrack({ run, voice, timeline: open.timeline, loudness, workDir: work, cues: sound?.cues ?? undefined, music: sound?.music ?? undefined, tracks: sound?.tracks ?? [], headroomDb });
    // Before any frame is captured: the master encoded to the AAC the film ships (raised by what AAC took from it, and
    // mastered again with room for that when it peaks at the ceiling: encodeToTarget), and that encode judged with the
    // finished file's rule, so a film that would fail after the capture fails here. The mux copies this stream, so the
    // judgement after it can no longer differ.
    const encoded = steps === null ? null : await steps.encodeToTarget({ run, master, out: path.join(work, 'sound.m4a'), duration: open.timeline.duration, loudness, noVoice: !narrated });
    // A shortfall the last-stage hold caused (heldFrom: the level it lowered from) is noted, not refused.
    const judgement = { noVoice: !narrated, heldFrom: encoded?.heldFrom ?? null };
    if (encoded !== null) steps.judgeLevel(encoded.level, loudness, subject, judgement);
    encoder = startEncoder(ffmpeg, [...QUIET, ...encoderArgs({ fps: open.timeline.fps, out: partial, exact, stamp: steps === null ? stamp : [] })], signal);
    const sessions = [open]; // the pages the stall error reads its messages from; encodeWithWorkers adds the extra ones
    const clock = pageClock({ frames: open.timeline.frameCount, sessions, workers });
    // A slice is captured by one page (workers split a whole film's frames, not a range of them).
    const pooled = workers > 1 && openPage && range === undefined;
    const captured = pooled ? await encodeWithWorkers({ session: open, sessions, encoder, exact, signal, onProgress, workers, openPage, clock, onFrame }) : await encodeFrames({ session: open, encoder, exact, signal, onProgress, clock, span, onFrame });
    await clock.time('encode', span.last, () => encoder.finish());
    encoder = null;
    const audio = encoded === null ? null : audioOf(steps.judgeLevel(await steps.muxVoice({ run: stampedRunner(run, muxed, stamp), video: partial, audio: encoded.file, out: muxed, duration: open.timeline.duration }), loudness, undefined, judgement), sound);
    // The file about to become the output is decoded and checked first: a wrong frame count or a picture with no detail is a
    // render error (the film is not at fault), and the finally below removes both partial files, so it keeps no output.
    const finished = audio === null ? partial : muxed;
    // The check stalls when it decodes no frame for the limit, not when the whole film takes that long (`beat`), and a
    // stall kills its ffmpeg (`stalled`).
    await clock.time('check', span.last, ({ beat, signal: stalled }) => checkOutput({ ffmpeg, file: finished, frames, signal, stalled, beat }));
    renameSync(finished, out);
    const seconds = (performance.now() - started) / MS_PER_SECOND;
    const bytes = statSync(out).size;
    const mbps = (bytes * BITS_PER_BYTE) / (frames / open.timeline.fps) / MEGA;
    return { out, frames, captured, seconds, msPerFrame: (seconds * MS_PER_SECOND) / frames, capture: exact ? 'exact' : 'fast', post: open.info.post, bytes, mbps, audio, workers: pooled ? Math.min(workers, frames) : 1, timing: clock.totals() };
  } finally {
    if (encoder) await encoder.stop();
    if (scratch !== null) rmSync(scratch, { recursive: true, force: true });
    if (work !== null) rmSync(work, { recursive: true, force: true });
    if (own) await open.close();
  }
}
