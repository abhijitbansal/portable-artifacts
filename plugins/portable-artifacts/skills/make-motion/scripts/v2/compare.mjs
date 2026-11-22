// make.mjs --compare-looks <shot-id>: one PNG with the anchor shot's late frame (85% of the shot, the frame the board uses) drawn in
// every listed look that serves the film's mode, four across, each cell stamped with the look's name. The film is timed as it is
// estimated (no voice is made) and drawn once per look in the run's one browser, the sessions opened and closed one after another.
// A look that cannot draw the anchor (the validator refuses the anchor shot or a film-wide field there: a kind, a device, an overlay
// or a cut the look lacks) or whose page faults (it raises an error about the shot, or reports one no other look does) is a flat
// labelled cell that says why, never a blank one or a crash. A look whose faults are all on other shots still draws the anchor,
// from the film-wide fields and the anchor alone, marked; a look that parks the anchor's kind is drawn and marked. A page finding
// every look shares is one note. The tiles are placed in Node (png.mjs reads, scripts/lib/png-write.mjs writes). No review,
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
import { pageFinding } from './report.mjs';
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
const NOTE_LINE = 1.4; // of the stamp's size: the line height of a refusal's text
const NOTE_TOP = 4; // stamp pads between the stamp and the first line of a refusal
const CELL_COLOURS = Object.freeze({ ...COLOURS, flat: REFUSED_BACKGROUND, noteLine: NOTE_LINE, noteTop: NOTE_TOP });

/** Where the sheet goes: the video path's stem with `.looks.png`, in the folder the MP4 would go to. */
export const comparePath = (videoOut) => path.join(path.dirname(videoOut), `${path.basename(videoOut, path.extname(videoOut))}.looks.png`);

// The first error as `path: message`. A film of the anchor alone has the anchor at shots[0]: `anchorIndex` (when it is that film's
// error) maps the path back to the anchor's own index in the real film.
const firstProblem = (errors, anchorIndex) => {
  const at = anchorIndex === undefined ? errors[0].path : errors[0].path.replace(/^shots\[0\]/, `shots[${anchorIndex}]`);
  return `${at}: ${errors[0].message}`;
};

function parkedNote(look, anchor) {
  if (anchor === undefined) return null;
  if (isParkedKind(look, anchor.show)) return PARKED_KIND_NOTE;
  return anchor.show === 'chart' && isParkedChartType(look, anchor.type) ? PARKED_CHART_NOTE : null;
}

// The shot an error is at (its path starts `shots[i]`), or null for a film-wide one (overlays, music, voice, the root).
const shotOfError = (error) => {
  const at = /^shots\[(\d+)\]/.exec(error.path);
  return at === null ? null : Number(at[1]);
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The looks a film is compared in: the listed looks (registries.looks.names()) whose `modes` hold the film's mode, in listed
 * order, at most COMPARE_MAX. A look is `refused` only when the anchor shot or a film-wide field fails in it (`note`: that first
 * error as `path: message`); when every error is on other shots the anchor is still drawn, from the film-wide fields and the
 * anchor shot alone: `otherFaults` is then the number of errors and the note says so. `parked` when the anchor shot's kind (or
 * chart type) is parked there (drawn, with the note "experimental kind"), else `drawn`. Pure but for the files a film names,
 * which the validator looks at (`specDir`, default the current folder).
 * @param {object} film a film with its defaults, or any film the validator takes
 * @param {{ shot?: string, specDir?: string, registries?: object }} [options] `shot`: the anchor's id (default the first shot)
 * @returns {{ look: string, status: 'drawn' | 'parked' | 'refused', note: string | null, otherFaults?: number }[]}
 */
export function comparableLooks(film, { shot, specDir = process.cwd(), registries = defaultRegistries } = {}) {
  const mode = film.mode ?? DEFAULT_MODE;
  const anchorIndex = film.shots?.findIndex((s) => s.id === (shot ?? film.shots[0]?.id)) ?? -1;
  const anchor = film.shots?.[anchorIndex];
  const serving = registries.looks.names().filter((name) => (registries.looks.get(name).modes ?? []).includes(mode));
  return serving.slice(0, COMPARE_MAX).map((look) => {
    const options = { specDir, registries };
    const whole = validateFilm({ ...film, look }, options);
    const ours = whole.errors.filter((error) => shotOfError(error) === null || shotOfError(error) === anchorIndex);
    if (ours.length > 0 || (!whole.ok && anchor === undefined)) return { look, status: 'refused', note: firstProblem(ours.length > 0 ? ours : whole.errors) };
    const alone = whole.ok ? whole : validateFilm({ ...film, look, shots: [anchor] }, options);
    const faults = whole.ok ? 0 : whole.errors.length;
    if (!alone.ok) return { look, status: 'refused', note: `fault in another shot (${plural(faults, 'error')}); the anchor alone does not validate: ${firstProblem(alone.errors, anchorIndex)}` };
    const parked = parkedNote(registries.looks.get(look), anchor);
    const notes = [parked, faults > 0 ? `other shots do not validate in this look (${plural(faults, 'problem')}); the anchor is drawn alone` : null].filter(Boolean);
    return { look, status: parked === null ? 'drawn' : 'parked', note: notes.length === 0 ? null : notes.join('; '), ...(faults > 0 ? { otherFaults: faults } : {}) };
  });
}

/**
 * `steps` (run.mjs soundSteps) with musicInput asked once per music file however many looks ask: a music.snap film with no beats
 * file is decoded and beat-detected by ffmpeg, and every look would do it again. A look that lengthens the film asks with its own
 * `seconds` (the film's length, for the silence check), so the film's length is part of the key; a refusal is remembered too.
 */
export function memoiseMusicInput(steps) {
  const seen = new Map();
  return { ...steps, musicInput: (film, specDir, options) => {
    const key = `${film.music.src}\u0000${film.music.beats ?? ''}\u0000${options?.seconds ?? ''}`;
    if (!seen.has(key)) seen.set(key, steps.musicInput(film, specDir, options));
    return seen.get(key);
  } };
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

// The stamp of a cell: the look's name, then what is special about it (parked, other shots refused). A refused cell says refused.
function labelOf(cell) {
  if (cell.status === 'refused') return `${cell.look} ${MIDDLE_DOT} refused`;
  const tags = [cell.status === 'parked' ? cell.note.split('; ')[0] : null, cell.otherFaults > 0 ? 'other shots refused' : null].filter(Boolean);
  return tags.length === 0 ? cell.look : `${cell.look} ${MIDDLE_DOT} ${tags.join(', ')}`;
}

// One cell as a placement of sheets.mjs composeInPage: a frame of the film, or (with a `note`) a flat cell that says why not.
const placementOf = (cell, tile) => ({ frame: cell.at, x: 0, y: 0, w: tile.width, h: tile.height, label: labelOf(cell), ...(cell.status === 'refused' ? { note: cell.note } : {}) });
const composeArgs = (cell, tile) => ({ width: tile.width, height: tile.height, placements: [placementOf(cell, tile)], colours: CELL_COLOURS, format: PNG });

// The flat cells of the refused looks, drawn on `page` (any page: a flat cell needs no film).
async function drawRefused(page, cells, tile) {
  for (const cell of cells) cell.png = await page.evaluate(composeInPage, composeArgs(cell, tile));
}

// The film in each look that can serve it, timed as the run's `prepare` says (the estimate, after music.snap, with its clips):
// a look whose film does not load (a Node-side preparer, the clips, the music) joins the refused. A look whose faults are all on
// other shots is loaded with the anchor shot alone (`only`): its frame is then in that one-shot film, so it is drawn (`at`) but
// not reported (`frame` null).
async function loadCells({ specPath, values, registries, own, shot, index, prepare, signal }) {
  const cells = [];
  for (const entry of comparableLooks(own.film, { shot, specDir: own.specDir, registries })) {
    signal?.throwIfAborted();
    const cell = { ...entry, frame: null, at: null, loaded: null, png: null, pageFindings: null };
    const alone = entry.otherFaults > 0;
    if (entry.status !== 'refused') {
      try {
        cell.loaded = await prepare(loadFilm(specPath, { values, registries, look: entry.look, ...(alone ? { only: shot } : {}) }));
        cell.at = lateFrameOf(cell.loaded.timeline, alone ? 0 : index);
        cell.frame = alone ? null : cell.at;
      } catch (err) {
        if (!(err instanceof SpecError)) throw err;
        Object.assign(cell, { status: 'refused', note: firstProblem(err.errors, alone ? index : undefined), loaded: null });
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

const PAGE_PREFIX = 'page: ';
const pageNote = (message) => (message.startsWith(PAGE_PREFIX) ? message : `${PAGE_PREFIX}${message}`);

// A cell its page refused (an error about the film in that look, or a finding of that look alone): flat and labelled like any refusal.
const refuse = (cell, message) => Object.assign(cell, { status: 'refused', note: pageNote(message), frame: null, at: null, loaded: null, png: null });

const keyOf = (finding) => `${finding.kind}\u0000${finding.message}`;

// What the pages said, after every look has been drawn: a finding every look that drew shares (no WebGL, a font; at least two looks
// drew, or every finding of a lone look would count as shared) is one note,
// creative whatever it was, and refuses nobody; a mechanical finding one look alone has (a console error, a blocked request) refuses
// that look's cell; a creative one of a single look is a note naming the look. -> the notes, as findings; `refused`: the cells.
export function settleFindings(cells) {
  const sampled = cells.filter((cell) => cell.status !== 'refused' && cell.pageFindings !== null);
  const shared = sampled.length < 2 ? [] : sampled[0].pageFindings.filter((f) => sampled.every((cell) => cell.pageFindings.some((g) => keyOf(g) === keyOf(f))));
  const notes = shared.map((f) => pageFinding('creative', f.message));
  const refused = [];
  for (const cell of sampled) {
    const own = cell.pageFindings.filter((f) => !shared.some((g) => keyOf(g) === keyOf(f)));
    const mechanical = own.find((f) => f.kind === 'mechanical');
    if (mechanical !== undefined) {
      refuse(cell, mechanical.message);
      refused.push(cell);
    } else notes.push(...own.map((f) => pageFinding('creative', `look "${cell.look}": ${f.message}`)));
  }
  return { notes: notes.filter((f, i, all) => all.findIndex((g) => g.message === f.message) === i), refused };
}

// The sessions, one look after another in `browser`. The first one that opens draws the labelled cells of the refused looks (in
// its own page, with the film's stamp face). A look whose page raises an error is refused, and so is one whose page alone
// reports a fault (settleFindings); those wait for the next session, or for a blank page when no session follows.
async function drawCells(cells, { browser, tile, signal, open }) {
  let waiting = cells.filter((cell) => cell.status === 'refused');
  for (const cell of cells) {
    if (cell.status === 'refused') continue;
    signal?.throwIfAborted();
    let session = null;
    try {
      try {
        session = await open(cell.loaded, { browser });
        cell.png = await session.page.evaluate(composeInPage, composeArgs(cell, tile));
        cell.pageFindings = sessionFindings(session);
      } catch (err) {
        const message = pageErrorMessage(err);
        if (message === null) throw err;
        refuse(cell, message);
        waiting.push(cell);
      }
      if (cell.png !== null && waiting.length > 0) {
        try {
          await drawRefused(session.page, waiting, tile);
          waiting = [];
        } catch (err) {
          if (pageErrorMessage(err) === null) throw err; // the page cannot draw the flat cells now: the next session or a blank page does
        }
      }
    } finally {
      await session?.close();
    }
  }
  const settled = settleFindings(cells);
  waiting.push(...settled.refused);
  if (waiting.length > 0 && cells.some((cell) => cell.status !== 'refused')) {
    const context = await browser.newContext({ viewport: { width: tile.width, height: tile.height } });
    try {
      await drawRefused(await context.newPage(), waiting, tile);
    } finally {
      await context.close();
    }
  }
  return settled.notes;
}

/**
 * Writes the comparison sheet of the film at `specPath` for the anchor shot `shot`, to `file` (whole or not at all).
 * One session per look that is not refused, opened and closed one after another in `browser` (launched by `launch`, and closed,
 * when none is given). `prepare(loaded)` (default: as loaded) takes a look's loaded film to the one to draw: run.mjs moves the
 * cuts onto the beats for music.snap and decodes the film's clips; a SpecError from it refuses that look. `open` (default
 * openSession) and `launch` (default launchRunBrowser) are seams for tests.
 * @returns {Promise<{ file: string, shot: string, frame: number | null, frameLook: string | null, looks: { look: string, status: string, note: string | null, frame: number | null }[], findings: object[] }>}
 *   `frame`: the anchor's late frame, in the film as `frameLook` draws it (the film's own look when it is compared, else the first
 *   look drawn whole; both null when every look drew the anchor alone); each look has its own `frame`, because a look can lengthen
 *   a shot, and null when it is refused or drew the anchor alone. `findings`: the notes the pages made (a finding every look shares),
 *   creative, not part of the report's `compare`.
 * @throws {FilmTimeError} the film has no shot `shot` (its hint lists the shots)
 * @throws {SpecError} no look can draw the shot: one error at `shots[i]`, and no file is written
 */
export async function writeComparison({ specPath, values = {}, shot, file, browser, signal, prepare = async (loaded) => loaded, registries = defaultRegistries, open = openSession, launch = launchRunBrowser }) {
  const own = loadFilm(specPath, { values, registries });
  sliceOf({ shot }, own.film, own.timeline); // an id the film lacks is a FilmTimeError naming the shots, before any browser
  const index = own.film.shots.findIndex((s) => s.id === shot);
  const mode = own.film.mode;
  const cells = await loadCells({ specPath, values, registries, own, shot, index, prepare, signal });
  if (!cells.some((cell) => cell.status !== 'refused')) throw noLookError(mode, shot, index, cells);
  const [width, height] = canvasSize(own.film);
  const tile = { width: COMPARE_TILE_WIDTH, height: Math.round((COMPARE_TILE_WIDTH * height) / width) };
  const launched = browser === undefined ? await launch() : null;
  let findings;
  try {
    findings = await drawCells(cells, { browser: browser ?? launched, tile, signal, open });
  } finally {
    await launched?.close();
  }
  if (!cells.some((cell) => cell.status !== 'refused')) throw noLookError(mode, shot, index, cells); // every page refused it
  const tiles = cells.map((cell) => readPng(Buffer.from(cell.png, 'base64')));
  mkdirSync(path.dirname(file), { recursive: true });
  writeAtomically(file, assembleSheet(tiles, { columns: COMPARE_COLUMNS, tileWidth: tile.width, tileHeight: tile.height }));
  const whole = cells.filter((cell) => cell.frame !== null);
  const anchored = whole.find((cell) => cell.look === own.film.look) ?? whole[0];
  return { file, shot, frame: anchored?.frame ?? null, frameLook: anchored?.look ?? null, looks: cells.map(({ look, status, note, frame }) => ({ look, status, note, frame })), findings };
}

