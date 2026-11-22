// make.mjs --compare-looks <shot-id>: one PNG with the anchor shot's late frame (85% of the shot, the frame the board uses) drawn in
// every listed look that serves the film's mode, four across, each cell stamped with the look's name. The film is timed as it is
// estimated (no voice is made) and drawn once per look in the run's one browser, the sessions opened and closed one after another.
// A look that cannot draw the film (the validator refuses it: a kind, a device, an overlay or a cut the look lacks) or the shot
// (the page raised an error about it) is a flat labelled cell that says why, never a blank one or a crash; a look that parks the
// anchor's kind is drawn and marked. The tiles are placed in Node (png.mjs reads, scripts/lib/png-write.mjs writes). No review,
// no sound, no ffmpeg of its own (a film with clips or music.snap prepares them as a poster does: run.mjs passes `prepare`).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { registries as defaultRegistries } from '../../engine/registry.mjs';
import { canvasSize } from '../../engine/formats.mjs';
import { isParkedChartType, isParkedKind } from '../../engine/looks/index.mjs';
import { encodePng } from '../lib/png-write.mjs';
import { readPng } from './png.mjs';
import { loadFilm } from './pipeline.mjs';
import { DEFAULT_MODE, SpecError, validateFilm } from './spec.mjs';
import { sliceOf } from './slice.mjs';
import { lateFrameOf } from './plan.mjs';
import { launchRunBrowser, openSession, pageErrorMessage } from './session.mjs';
import { sessionFindings } from './review.mjs';
import { COLOURS, PNG, composeInPage, writeAtomically } from './sheets.mjs';

/** The most looks one sheet compares, the cells across a row and the width of one cell in px. */
export const COMPARE_MAX = 16;
export const COMPARE_COLUMNS = 4;
export const COMPARE_TILE_WIDTH = 480;
const PARKED_KIND_NOTE = 'experimental kind';
const PARKED_CHART_NOTE = 'experimental chart type';
const SHEET_RGBA = Buffer.from([0x16, 0x14, 0x0f, 0xff]); // sheets.mjs SHEET_BACKGROUND, for the cells a short last row leaves
const REFUSED_BACKGROUND = '#2b2722';
const BYTES_PER_PIXEL = 4;
const MIDDLE_DOT = '·';
const LINE_HEIGHT = 1.4; // of the label's size
const TEXT_TOP = 4; // label pads between the stamp and the first line of a refusal

/** Where the sheet goes: the video path's stem with `.looks.png`, in the folder the MP4 would go to. */
export const comparePath = (videoOut) => path.join(path.dirname(videoOut), `${path.basename(videoOut, path.extname(videoOut))}.looks.png`);

const firstProblem = (errors) => `${errors[0].path}: ${errors[0].message}`;

function parkedNote(look, anchor) {
  if (anchor === undefined) return null;
  if (isParkedKind(look, anchor.show)) return PARKED_KIND_NOTE;
  return anchor.show === 'chart' && isParkedChartType(look, anchor.type) ? PARKED_CHART_NOTE : null;
}

/**
 * The looks a film is compared in: the listed looks (registries.looks.names()) whose `modes` hold the film's mode, in listed
 * order, at most COMPARE_MAX. `refused` when the film does not validate in that look (`note`: the first error as `path: message`),
 * `parked` when the anchor shot's kind (or chart type) is parked there (drawn, with the note "experimental kind"), else `drawn`.
 * Pure but for the files a film names, which the validator looks at (`specDir`, default the current folder).
 * @param {object} film a film with its defaults, or any film the validator takes
 * @param {{ shot?: string, specDir?: string, registries?: object }} [options] `shot`: the anchor's id (default the first shot)
 * @returns {{ look: string, status: 'drawn' | 'parked' | 'refused', note: string | null }[]}
 */
export function comparableLooks(film, { shot, specDir = process.cwd(), registries = defaultRegistries } = {}) {
  const mode = film.mode ?? DEFAULT_MODE;
  const anchor = film.shots?.find((s) => s.id === (shot ?? film.shots[0]?.id));
  const serving = registries.looks.names().filter((name) => (registries.looks.get(name).modes ?? []).includes(mode));
  return serving.slice(0, COMPARE_MAX).map((look) => {
    const { ok, errors } = validateFilm({ ...film, look }, { specDir, registries });
    if (!ok) return { look, status: 'refused', note: firstProblem(errors) };
    const note = parkedNote(registries.looks.get(look), anchor);
    return note === null ? { look, status: 'drawn', note: null } : { look, status: 'parked', note };
  });
}

// Copies the 4-channel `tile` into the sheet's pixels at (x0, y0), a row at a time; an RGB tile (a PNG the browser wrote without
// alpha) is widened a pixel at a time.
function copyTile(data, sheetWidth, tile, x0, y0, { width, height }) {
  const [w, h] = [Math.min(width, tile.width), Math.min(height, tile.height)];
  for (let y = 0; y < h; y++) {
    const to = ((y0 + y) * sheetWidth + x0) * BYTES_PER_PIXEL;
    if (tile.channels === BYTES_PER_PIXEL) {
      const from = y * tile.width * BYTES_PER_PIXEL;
      tile.data.copy(data, to, from, from + w * BYTES_PER_PIXEL);
      continue;
    }
    for (let x = 0; x < w; x++) {
      const from = (y * tile.width + x) * tile.channels;
      data.set([tile.data[from], tile.data[from + 1], tile.data[from + 2], 0xff], to + x * BYTES_PER_PIXEL);
    }
  }
}

/**
 * The sheet's PNG: `tiles` (readPng's { width, height, channels, data }) placed row by row, `columns` across (fewer when there
 * are fewer tiles), each in a `tileWidth` x `tileHeight` cell; a cell a short last row leaves is the sheet colour.
 */
export function assembleSheet(tiles, { columns, tileWidth, tileHeight }) {
  const across = Math.min(columns, tiles.length);
  const width = across * tileWidth;
  const height = Math.ceil(tiles.length / across) * tileHeight;
  const data = Buffer.alloc(width * height * BYTES_PER_PIXEL);
  for (let at = 0; at < data.length; at += BYTES_PER_PIXEL) SHEET_RGBA.copy(data, at);
  tiles.forEach((tile, k) => copyTile(data, width, tile, (k % across) * tileWidth, Math.floor(k / across) * tileHeight, { width: tileWidth, height: tileHeight }));
  return encodePng({ width, height, channels: BYTES_PER_PIXEL, data });
}

// Runs in the page (Playwright sends its source): a flat cell carrying the look's name, stamped as a drawn cell is, and the reason
// it is not a picture, wrapped to the cell's width. The page's own stamp face when it has one (a film's page), else a monospace.
async function composeRefusedInPage({ width, height, label, note, colours, background, lineHeight, textTop }) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const size = Math.max(colours.stampMin, Math.round(width / colours.stampShare));
  const font = `${size}px "${window.__stampFamily ?? 'monospace'}"`;
  await document.fonts.load(font);
  ctx.font = font;
  ctx.textBaseline = 'top';
  const pad = Math.round(size * colours.pad);
  ctx.fillStyle = colours.stampBackground;
  ctx.fillRect(0, 0, ctx.measureText(label).width + 2 * pad, size + 2 * pad);
  ctx.fillStyle = colours.stampInk;
  ctx.fillText(label, pad, pad);
  const room = width - 2 * pad;
  const fits = (text) => ctx.measureText(text).width <= room;
  const lines = [];
  let line = '';
  for (const word of note.split(' ')) {
    if (line === '' ? fits(word) : fits(`${line} ${word}`)) {
      line = line === '' ? word : `${line} ${word}`;
      continue;
    }
    if (line !== '') lines.push(line);
    line = word;
    while (!fits(line) && line.length > 1) {
      let k = line.length - 1;
      while (k > 1 && !fits(line.slice(0, k))) k -= 1;
      lines.push(line.slice(0, k));
      line = line.slice(k);
    }
  }
  lines.push(line);
  lines.forEach((text, i) => {
    const y = size + textTop * pad + i * Math.round(size * lineHeight);
    if (y + size <= height) ctx.fillText(text, pad, y);
  });
  return canvas.toDataURL('image/png').split(',')[1];
}

const labelOf = (cell) => (cell.status === 'drawn' ? cell.look : `${cell.look} ${MIDDLE_DOT} ${cell.status === 'parked' ? cell.note : 'refused'}`);

async function drawRefused(page, cells, tile) {
  for (const cell of cells) {
    cell.png = await page.evaluate(composeRefusedInPage, { ...tile, label: labelOf(cell), note: cell.note, colours: COLOURS, background: REFUSED_BACKGROUND, lineHeight: LINE_HEIGHT, textTop: TEXT_TOP });
  }
}

// The film in each look that can serve it, timed as the run's `prepare` says (the estimate, after music.snap, with its clips):
// a look whose film does not load (a Node-side preparer, the clips, the music) joins the refused.
async function loadCells({ specPath, values, registries, own, shot, index, prepare, signal }) {
  const cells = [];
  for (const entry of comparableLooks(own.film, { shot, specDir: own.specDir, registries })) {
    signal?.throwIfAborted();
    const cell = { ...entry, frame: null, loaded: null, png: null };
    if (entry.status !== 'refused') {
      try {
        cell.loaded = await prepare(loadFilm(specPath, { values, registries, look: entry.look }));
        cell.frame = lateFrameOf(cell.loaded.timeline, index);
      } catch (err) {
        if (!(err instanceof SpecError)) throw err;
        Object.assign(cell, { status: 'refused', note: firstProblem(err.errors), frame: null, loaded: null });
      }
    }
    cells.push(cell);
  }
  return cells;
}

const noLookError = (mode, shot, index, cells) => {
  const first = cells.find((cell) => cell.status === 'refused');
  const why = first === undefined ? '' : ` (${first.look}: ${first.note})`;
  return new SpecError([{ path: `shots[${index}]`, message: `no look of mode "${mode}" can draw shot "${shot}"${why}` }]);
};

// A cell the page refused after the film validated (it raised an error about the film in that look): labelled like any refusal.
const refuse = (cell, message) => Object.assign(cell, { status: 'refused', note: `page: ${message}`, frame: null, loaded: null, png: null });

// The sessions, one look after another in `browser`. The first one that opens draws the labelled cells of the refused looks (in
// its own page, with the film's stamp face); a look refused later, by its page, waits for the next session or a blank page.
async function drawCells(cells, { browser, tile, signal, findings }) {
  let waiting = cells.filter((cell) => cell.status === 'refused');
  for (const cell of cells) {
    if (cell.status === 'refused') continue;
    signal?.throwIfAborted();
    let session = null;
    try {
      session = await openSession(cell.loaded, { browser });
      const placement = { frame: cell.frame, x: 0, y: 0, w: tile.width, h: tile.height, label: labelOf(cell) };
      cell.png = await session.page.evaluate(composeInPage, { width: tile.width, height: tile.height, placements: [placement], colours: COLOURS, format: PNG });
      findings.push(...sessionFindings(session));
      await drawRefused(session.page, waiting, tile);
      waiting = [];
    } catch (err) {
      const message = pageErrorMessage(err);
      if (message === null) throw err;
      refuse(cell, message);
      waiting.push(cell);
    } finally {
      await session?.close();
    }
  }
  if (waiting.length === 0 || !cells.some((cell) => cell.png !== null && cell.status !== 'refused')) return;
  const context = await browser.newContext({ viewport: { width: tile.width, height: tile.height } });
  try {
    await drawRefused(await context.newPage(), waiting, tile);
  } finally {
    await context.close();
  }
}

/**
 * Writes the comparison sheet of the film at `specPath` for the anchor shot `shot`, to `file` (whole or not at all).
 * One session per look that is not refused, opened and closed one after another in `browser` (launched here, and closed, when
 * none is given). `prepare(loaded)` (default: as loaded) takes a look's loaded film to the one to draw: run.mjs moves the cuts
 * onto the beats for music.snap and decodes the film's clips; a SpecError from it refuses that look.
 * @returns {Promise<{ file: string, shot: string, frame: number, looks: { look: string, status: string, note: string | null, frame: number | null }[], findings: object[] }>}
 *   `frame`: the anchor's late frame in the film's own look (the first drawn look when that is not compared); each look has its
 *   own, because a look can lengthen a shot. `findings`: what the pages said (review.mjs sessionFindings), not part of the report's `compare`.
 * @throws {FilmTimeError} the film has no shot `shot` (its hint lists the shots)
 * @throws {SpecError} no look can draw the shot: one error at `shots[i]`, and no file is written
 */
export async function writeComparison({ specPath, values = {}, shot, file, browser, signal, prepare = async (loaded) => loaded, registries = defaultRegistries }) {
  const own = loadFilm(specPath, { values, registries });
  sliceOf({ shot }, own.film, own.timeline); // an id the film lacks is a FilmTimeError naming the shots, before any browser
  const index = own.film.shots.findIndex((s) => s.id === shot);
  const mode = own.film.mode;
  const cells = await loadCells({ specPath, values, registries, own, shot, index, prepare, signal });
  if (!cells.some((cell) => cell.status !== 'refused')) throw noLookError(mode, shot, index, cells);
  const [width, height] = canvasSize(own.film);
  const tile = { width: COMPARE_TILE_WIDTH, height: Math.round((COMPARE_TILE_WIDTH * height) / width) };
  const findings = [];
  const launched = browser === undefined ? await launchRunBrowser() : null;
  try {
    await drawCells(cells, { browser: browser ?? launched, tile, signal, findings });
  } finally {
    await launched?.close();
  }
  if (!cells.some((cell) => cell.status !== 'refused')) throw noLookError(mode, shot, index, cells); // every page refused it
  const tiles = cells.map((cell) => readPng(Buffer.from(cell.png, 'base64')));
  mkdirSync(path.dirname(file), { recursive: true });
  writeAtomically(file, assembleSheet(tiles, { columns: COMPARE_COLUMNS, tileWidth: tile.width, tileHeight: tile.height }));
  const anchored = cells.find((cell) => cell.look === own.film.look && cell.frame !== null) ?? cells.find((cell) => cell.frame !== null);
  return { file, shot, frame: anchored.frame, looks: cells.map(({ look, status, note, frame }) => ({ look, status, note, frame })), findings };
}
