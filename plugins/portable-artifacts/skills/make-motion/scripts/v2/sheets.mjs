// Review sheets: PNGs a person (or a model that can see) looks at instead of the whole video. One per shot, one per
// cut (plan.mjs says which frames). The page seeks each frame and draws the visible canvas, post pass included, onto a
// sheet canvas with each tile stamped "<shot id> . <seconds>s" in the bundled mono face; Node lays the tiles out
// (layout.mjs) and writes the PNG. No ffmpeg and no screenshots. writeSheets also returns the film review's findings.
import { lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { writeFileReplacing } from '../../shared/write-file.mjs';
import { canvasSize } from '../../engine/formats.mjs';
import { loadFilm } from './pipeline.mjs';
import { openSession } from './session.mjs';
import { planSheets, planBoard, BOARD_COLUMNS, BOARD_JPEG_QUALITY, BOARD_STRIP_WIDTH } from './plan.mjs';
import { sliceSheets } from './slice.mjs';
import { layoutSheet, shotColumns, CUT_COLUMNS } from './layout.mjs';
import { reviewFilm } from './review.mjs';

const SHEET_BACKGROUND = '#16140f';
const STAMP_BACKGROUND = 'rgba(0, 0, 0, 0.72)';
const STAMP_INK = '#ffffff';
const STAMP_SHARE = 34; // the stamp is a tile's width / this many px tall, but never under STAMP_MIN
const STAMP_MIN = 11;
const STAMP_PAD = 0.4; // of the stamp size

// Runs in the page (Playwright sends its source), so it names only page globals and its own argument. Exported for the
// compare sheet (compare.mjs), which stamps its tiles the same way. A placement with a `note` is not a frame of the film: it is
// a flat cell (colours.flat) with the stamp and the note wrapped under it (compare.mjs: a look that cannot draw the shot), which
// needs no film page: the stamp face falls back to a monospace one.
export async function composeInPage({ width, height, placements, colours, format }) {
  // The lines of `text` within `maxWidth` in ctx's font (a word wider than that is broken). Inside, as the page gets the source of this function only.
  const wrapNote = (ctx, text, maxWidth) => {
    const fits = (t) => ctx.measureText(t).width <= maxWidth;
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
      const joined = line === '' ? word : `${line} ${word}`;
      if (fits(joined)) { line = joined; continue; }
      if (line !== '') lines.push(line);
      line = word;
      for (let k = line.length - 1; !fits(line) && line.length > 1; k = line.length - 1) { // k: the longest piece that fits, 1 at least
        while (k > 1 && !fits(line.slice(0, k))) k -= 1;
        lines.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    return [...lines, line];
  };
  const ctx = Object.assign(document.createElement('canvas'), { width, height }).getContext('2d');
  ctx.fillStyle = colours.sheet;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  for (const p of placements) {
    if (p.note === undefined) {
      await window.__seek(p.frame); // a film with clips loads the frame's clip pictures first (engine/page/clip-frames.mjs)
      ctx.drawImage(document.getElementById('stage'), p.x, p.y, p.w, p.h);
    } else {
      ctx.fillStyle = colours.flat;
      ctx.fillRect(p.x, p.y, p.w, p.h);
    }
    const size = Math.max(colours.stampMin, Math.round(p.w / colours.stampShare));
    const font = `${size}px "${window.__stampFamily ?? 'monospace'}"`;
    await document.fonts.load(font);
    ctx.font = font;
    ctx.textBaseline = 'top';
    const pad = Math.round(size * colours.pad);
    ctx.fillStyle = colours.stampBackground;
    ctx.fillRect(p.x, p.y, ctx.measureText(p.label).width + 2 * pad, size + 2 * pad);
    ctx.fillStyle = colours.stampInk;
    ctx.fillText(p.label, p.x + pad, p.y + pad);
    if (p.note === undefined) continue;
    wrapNote(ctx, p.note, p.w - 2 * pad).forEach((text, i) => {
      const y = p.y + size + colours.noteTop * pad + i * Math.round(size * colours.noteLine);
      if (y + size <= p.y + p.h) ctx.fillText(text, p.x + pad, y);
    });
  }
  return ctx.canvas.toDataURL(format.mime, format.quality).split(',')[1];
}

export const PNG = Object.freeze({ mime: 'image/png' });

export const COLOURS = Object.freeze({ sheet: SHEET_BACKGROUND, stampBackground: STAMP_BACKGROUND, stampInk: STAMP_INK, stampShare: STAMP_SHARE, stampMin: STAMP_MIN, pad: STAMP_PAD });

async function writeOne(session, sheet, dir, canvas, signal) {
  signal?.throwIfAborted();
  const columns = sheet.kind === 'cut' ? CUT_COLUMNS : shotColumns(canvas);
  const { width, height, placements } = layoutSheet({ tiles: sheet.tiles, canvas, columns });
  const png = await session.page.evaluate(composeInPage, { width, height, placements, colours: COLOURS, format: PNG });
  return writeAtomically(path.join(dir, sheet.name), Buffer.from(png, 'base64'));
}

// The file appears whole or not at all: written under a temp name beside it, then renamed. A link at `file` is replaced,
// never written through, and the temp name cannot be guessed (shared/write-file.mjs).
export function writeAtomically(file, bytes) {
  return writeFileReplacing(file, bytes);
}

// The folder belongs to one video, so the PNGs in it are the last run's sheets; they go before the new ones are made,
// and a sheet the film no longer has cannot linger.
function clearOwnSheets(dir) {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) if (name.toLowerCase().endsWith('.png')) rmSync(path.join(dir, name), { force: true });
}

const BOARD_DIR = 'board';
const BOARD_FILE_RE = /^board-\d+\.jpg$/;
const PERCENT = 100;
const BOARD_FORMAT = Object.freeze({ mime: 'image/jpeg', quality: BOARD_JPEG_QUALITY / PERCENT });

const kindOf = (stat) => (stat.isSymbolicLink() ? 'a symbolic link' : 'not a file');

// Whether `dir` is a folder this run may write in (made when absent). It is looked at with lstat, so a symbolic link is never
// followed (nothing in its target is deleted or written); anything that is not a plain folder is said so and left alone.
function boardFolder(dir, log) {
  const stat = lstatSync(dir, { throwIfNoEntry: false });
  if (stat === undefined) {
    mkdirSync(dir, { recursive: true });
    return true;
  }
  if (stat.isDirectory()) return true;
  log(`make: board: ${dir} is ${stat.isSymbolicLink() ? 'a symbolic link' : 'not a folder'}; no board was written`);
  return false;
}

// The folder's own board-N.jpg files are the last run's strips: they go before the new ones are made, so a strip the film no
// longer needs cannot linger. Any other file in it stays, and so does a board-N.jpg that is not a plain file.
function clearOwnBoard(dir) {
  for (const name of readdirSync(dir)) {
    if (BOARD_FILE_RE.test(name) && lstatSync(path.join(dir, name)).isFile()) rmSync(path.join(dir, name), { force: true });
  }
}

/**
 * A run that writes the whole film's sheets takes away the last run's board strips: they show a film that may have changed, and a
 * storyboard built from them later would carry stale pictures. A run with --estimated writes new ones straight after. Only the
 * regular files named board-N.jpg in `<dir>/board` go (the folder is looked at with lstat, so a link or a file there is left alone).
 * @param {string} dir the sheets folder
 */
export function clearStaleBoard(dir) {
  const boardDir = path.join(dir, BOARD_DIR);
  if (lstatSync(boardDir, { throwIfNoEntry: false })?.isDirectory() === true) clearOwnBoard(boardDir);
}

// Whether the strip `file` can be written: nothing is there (clearOwnBoard took a plain file), else it is said and skipped.
function stripFree(file, log) {
  const stat = lstatSync(file, { throwIfNoEntry: false });
  if (stat === undefined) return true;
  log(`make: board: ${path.basename(file)} is ${kindOf(stat)}; that strip was not written`);
  return false;
}

/**
 * The board (--estimated): the film's shots, BOARD_COLUMNS to a row and BOARD_PER_STRIP to a strip, each tile stamped as a
 * sheet tile is, written as JPEGs (BOARD_JPEG_QUALITY) at most BOARD_STRIP_WIDTH px wide.
 * @param {{ session: object, dir: string, signal?: AbortSignal, log?: (line: string) => void }} opts `dir` is the sheets folder: the
 *   strips go in its `board/`. A `board` that is not a folder (a file, a symbolic link) writes nothing, and a board-N.jpg that is not
 *   a plain file is left alone and its strip skipped; `log` says so.
 * @returns {Promise<string[]>} the strip paths written, in order
 */
export async function writeBoard({ session, dir, signal, log = () => {} }) {
  const boardDir = path.join(dir, BOARD_DIR);
  signal?.throwIfAborted();
  if (!boardFolder(boardDir, log)) return [];
  clearOwnBoard(boardDir);
  const [w, h] = canvasSize(session.film);
  const files = [];
  for (const strip of planBoard(session.film, session.timeline)) {
    signal?.throwIfAborted();
    const file = path.join(boardDir, strip.name);
    if (!stripFree(file, log)) continue;
    const { width, height, placements } = layoutSheet({ tiles: strip.tiles, canvas: { w, h }, columns: BOARD_COLUMNS, maxWidth: BOARD_STRIP_WIDTH });
    const jpeg = await session.page.evaluate(composeInPage, { width, height, placements, colours: COLOURS, format: BOARD_FORMAT });
    files.push(writeAtomically(file, Buffer.from(jpeg, 'base64')));
  }
  return files;
}

/**
 * @param {{ specPath?: string, dir: string, session?: object, signal?: AbortSignal, slice?: object | null }} opts a session
 *   (openSession) is used and left open when given; otherwise the film at specPath is loaded and opened here and closed
 *   after. `slice` (slice.mjs sliceOf): only the sheets of that slice are written and reviewed, and the folder is not
 *   emptied: only the files the slice rewrites change. A whole-film run also removes the old board strips (clearStaleBoard).
 * @returns {Promise<{ files: string[], findings: object[] }>} the sheet paths and the review findings (see review.mjs)
 */
export async function writeSheets({ specPath, dir, session, signal, slice = null }) {
  const own = session === undefined;
  const open = own ? await openSession(loadFilm(specPath)) : session;
  try {
    signal?.throwIfAborted(); // an interrupt that came during the launch must not delete the last run's sheets
    if (slice === null) {
      clearOwnSheets(dir);
      clearStaleBoard(dir);
    } else mkdirSync(dir, { recursive: true });
    const [w, h] = canvasSize(open.film);
    const planned = planSheets(open.film, open.timeline);
    const files = [];
    for (const sheet of slice === null ? planned : sliceSheets(planned, slice)) files.push(await writeOne(open, sheet, dir, { w, h }, signal));
    return { files, findings: await reviewFilm({ session: open, signal, slice }) };
  } finally {
    if (own) await open.close();
  }
}
