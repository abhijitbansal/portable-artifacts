// Review sheets: PNGs a person (or a model that can see) looks at instead of the whole video. One per shot, one per
// cut (plan.mjs says which frames). The page seeks each frame and draws the visible canvas, post pass included, onto a
// sheet canvas with each tile stamped "<shot id> . <seconds>s" in the bundled mono face; Node lays the tiles out
// (layout.mjs) and writes the PNG. No ffmpeg and no screenshots. writeSheets also returns the film review's findings.
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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

// Runs in the page (Playwright sends its source), so it names only page globals and its own argument.
async function composeInPage({ width, height, placements, colours, format }) {
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = colours.sheet;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  const stage = document.getElementById('stage');
  for (const p of placements) {
    await window.__seek(p.frame); // a film with clips loads the frame's clip pictures first (engine/page/clip-frames.mjs)
    ctx.drawImage(stage, p.x, p.y, p.w, p.h);
    const size = Math.max(colours.stampMin, Math.round(p.w / colours.stampShare));
    const font = `${size}px "${window.__stampFamily}"`;
    await document.fonts.load(font);
    ctx.font = font;
    ctx.textBaseline = 'top';
    const pad = Math.round(size * colours.pad);
    ctx.fillStyle = colours.stampBackground;
    ctx.fillRect(p.x, p.y, ctx.measureText(p.label).width + 2 * pad, size + 2 * pad);
    ctx.fillStyle = colours.stampInk;
    ctx.fillText(p.label, p.x + pad, p.y + pad);
  }
  return sheet.toDataURL(format.mime, format.quality).split(',')[1];
}

const PNG = Object.freeze({ mime: 'image/png' });

const COLOURS = Object.freeze({ sheet: SHEET_BACKGROUND, stampBackground: STAMP_BACKGROUND, stampInk: STAMP_INK, stampShare: STAMP_SHARE, stampMin: STAMP_MIN, pad: STAMP_PAD });

async function writeOne(session, sheet, dir, canvas, signal) {
  signal?.throwIfAborted();
  const columns = sheet.kind === 'cut' ? CUT_COLUMNS : shotColumns(canvas);
  const { width, height, placements } = layoutSheet({ tiles: sheet.tiles, canvas, columns });
  const png = await session.page.evaluate(composeInPage, { width, height, placements, colours: COLOURS, format: PNG });
  return writeAtomically(path.join(dir, sheet.name), Buffer.from(png, 'base64'));
}

// The file appears whole or not at all: written under a temp name beside it, then renamed.
function writeAtomically(file, bytes) {
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}`);
  try {
    writeFileSync(temp, bytes);
    renameSync(temp, file);
  } finally {
    rmSync(temp, { force: true });
  }
  return file;
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

// The folder's own board-N.jpg files are the last run's strips: they go before the new ones are made, so a strip the film no
// longer needs cannot linger. Any other file in it stays.
function clearOwnBoard(dir) {
  mkdirSync(dir, { recursive: true });
  for (const name of readdirSync(dir)) if (BOARD_FILE_RE.test(name)) rmSync(path.join(dir, name), { force: true });
}

/**
 * The board (--estimated): the film's shots, BOARD_COLUMNS to a row and BOARD_PER_STRIP to a strip, each tile stamped as a
 * sheet tile is, written as JPEGs (BOARD_JPEG_QUALITY) at most BOARD_STRIP_WIDTH px wide.
 * @param {{ session: object, dir: string, signal?: AbortSignal }} opts `dir` is the sheets folder: the strips go in its `board/`
 * @returns {Promise<string[]>} the strip paths, in order
 */
export async function writeBoard({ session, dir, signal }) {
  const boardDir = path.join(dir, BOARD_DIR);
  signal?.throwIfAborted();
  clearOwnBoard(boardDir);
  const [w, h] = canvasSize(session.film);
  const files = [];
  for (const strip of planBoard(session.film, session.timeline)) {
    signal?.throwIfAborted();
    const { width, height, placements } = layoutSheet({ tiles: strip.tiles, canvas: { w, h }, columns: BOARD_COLUMNS, maxWidth: BOARD_STRIP_WIDTH });
    const jpeg = await session.page.evaluate(composeInPage, { width, height, placements, colours: COLOURS, format: BOARD_FORMAT });
    files.push(writeAtomically(path.join(boardDir, strip.name), Buffer.from(jpeg, 'base64')));
  }
  return files;
}

/**
 * @param {{ specPath?: string, dir: string, session?: object, signal?: AbortSignal, slice?: object | null }} opts a session
 *   (openSession) is used and left open when given; otherwise the film at specPath is loaded and opened here and closed
 *   after. `slice` (slice.mjs sliceOf): only the sheets of that slice are written and reviewed, and the folder is not
 *   emptied: only the files the slice rewrites change.
 * @returns {Promise<{ files: string[], findings: object[] }>} the sheet paths and the review findings (see review.mjs)
 */
export async function writeSheets({ specPath, dir, session, signal, slice = null }) {
  const own = session === undefined;
  const open = own ? await openSession(loadFilm(specPath)) : session;
  try {
    signal?.throwIfAborted(); // an interrupt that came during the launch must not delete the last run's sheets
    if (slice === null) clearOwnSheets(dir);
    else mkdirSync(dir, { recursive: true });
    const [w, h] = canvasSize(open.film);
    const planned = planSheets(open.film, open.timeline);
    const files = [];
    for (const sheet of slice === null ? planned : sliceSheets(planned, slice)) files.push(await writeOne(open, sheet, dir, { w, h }, signal));
    return { files, findings: await reviewFilm({ session: open, signal, slice }) };
  } finally {
    if (own) await open.close();
  }
}
