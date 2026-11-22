// make.mjs --poster: one still of the film's own frame round(seconds * fps), drawn by the render page with its post
// pass, captions and the film's overlays left out (window.__seek(i, { captions: false, overlays: false }); a page that
// does not know the options draws them),
// written as JPEG (quality 92) or PNG by the file's extension. No ffmpeg: the browser writes the picture.
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { posterReadFindings } from '../../engine/review/poster.mjs';
import { frameContext } from './review.mjs';

export const POSTER_JPEG_QUALITY = 92;
export const DEFAULT_POSTER = 'poster.jpg';
const SECONDS_DECIMALS = 1;

/**
 * The frame a poster at `seconds` shows: round(seconds * fps); past the last frame is an error naming the film's length.
 * `label` is what the error calls the time (default: the seconds; film-time.mjs passes the reference as the user wrote it),
 * `flag` the flag it names (default --poster; --inspect passes its own).
 */
export function posterFrame(seconds, timeline, label = seconds, flag = '--poster') {
  const frame = Math.round(seconds * timeline.fps);
  if (frame > timeline.frameCount - 1) throw new Error(`${flag} ${label}: past the end (the film is ${timeline.duration.toFixed(SECONDS_DECIMALS)} s)`);
  return frame;
}

/** Where the poster goes: --poster-out, else poster.jpg in the folder the MP4 would go to. */
export const posterPath = (posterOut, videoOut) => posterOut ?? path.join(path.dirname(videoOut), DEFAULT_POSTER);

/**
 * The poster's own review: the page's snapshot of `frame`, judged as a thumbnail (engine/review/poster.mjs). Creative
 * findings only, as the report carries them (reviewFinding takes `shot` and `t` beside the finding's own fields), so the
 * exit code is not touched. A poster with no text of its own gives [].
 */
export async function posterFindings({ session, frame }) {
  const { page, film, timeline, info } = session;
  const sampled = await page.evaluate((i) => window.__snapshot(i), frame);
  const ctx = frameContext(film, timeline, new Map(), { frame, whole: false }, info.backgrounds);
  return posterReadFindings(sampled, ctx).map((finding) => ({ ...finding, shot: ctx.shotId, t: ctx.t }));
}

/**
 * Draws `frame` on the session's page without captions and writes it to `file` (whole or not at all). ->
 * { file, frame, seconds }.
 */
export async function writePoster({ session, frame, file }) {
  const { page, timeline } = session;
  await page.evaluate((i) => window.__seek(i, { captions: false, overlays: false }), frame);
  const png = path.extname(file).toLowerCase() === '.png';
  const picture = await page.screenshot(png ? { type: 'png' } : { type: 'jpeg', quality: POSTER_JPEG_QUALITY });
  mkdirSync(path.dirname(file), { recursive: true });
  const partial = path.join(path.dirname(file), `.${path.basename(file)}.partial-${process.pid}`);
  try {
    writeFileSync(partial, picture, { flag: 'wx' });
    renameSync(partial, file);
  } finally {
    rmSync(partial, { force: true });
  }
  return { file, frame, seconds: frame / timeline.fps };
}
