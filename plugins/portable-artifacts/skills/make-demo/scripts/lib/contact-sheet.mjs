// The contact sheet of a take: the settled frame of each step in a grid of three columns, each THUMB_WIDTH px wide, with the step's number
// and id under it, written to <dir>/contact.jpg under 1.4 MB (the quality is lowered as shot.mjs does). The frames are 3x JPEGs (3840 px
// wide at the default viewport), so they are scaled down in a page that can reach nothing: every request is aborted, and a data: URL
// (which is not a request) is how a frame gets in. A step id is text under its picture, never markup.
//   contactSheet(browser, take, dir) -> Promise<path of contact.jpg>
// Past MAX_CELLS steps (fewer for a tall viewport: a page is at most MAX_SHEET_HEIGHT px high) the last cell says how many are not shown.
// Signed in, the frames are masked already and the sheet is for the user's eyes; the report says the model must not open it.
import fs from 'node:fs';
import path from 'node:path';
import { agentText } from '../../shared/agent-text.mjs';
import { MAX_BYTES, QUALITIES } from './shot.mjs';

const COLUMNS = 3;
const THUMB_WIDTH = 640;
const GAP = 16;
const CAPTION_HEIGHT = 28;
const MAX_CELLS = 60;
const MAX_SHEET_HEIGHT = 16000; // Chromium's own limit is 16384
const DEFAULT_RATIO = 9 / 16;
const ID_MAX = 40;
const DECODE_MS = 10000;
const SHEET_WIDTH = COLUMNS * THUMB_WIDTH + (COLUMNS + 1) * GAP;
const START_HEIGHT = 720;

const shellOf = () => `<!doctype html><body style="margin:0;background:#fff;font:600 16px/${CAPTION_HEIGHT}px system-ui,sans-serif;color:#222">`
  + `<div id="grid" style="display:grid;grid-template-columns:repeat(${COLUMNS},${THUMB_WIDTH}px);gap:${GAP}px;padding:${GAP}px"></div>`;

/** Runs in the page: one cell, a scaled picture and its caption, or a caption alone. */
async function addCell({ caption, base64, width, decodeMs }) {
  const cell = document.createElement('figure');
  cell.style.cssText = `margin:0;width:${width}px;overflow:hidden`;
  if (base64 !== null) {
    const image = new Image();
    image.src = `data:image/jpeg;base64,${base64}`;
    await Promise.race([image.decode(), new Promise((_, reject) => setTimeout(() => reject(new Error('a frame did not decode')), decodeMs))]);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round((width * image.naturalHeight) / image.naturalWidth);
    const g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.style.cssText = 'display:block;outline:1px solid #bbb';
    cell.append(canvas);
  }
  const label = document.createElement('figcaption');
  label.textContent = caption;
  cell.append(label);
  document.getElementById('grid').append(cell);
}

/** The frame file of a step's settled picture; an error when the take does not say. */
function settledFile(take, step, n) {
  const index = step.settledIndex ?? (typeof step.settleFrame === 'number' ? step.settleFrame - 1 : undefined);
  const file = take.frames[index];
  if (typeof file !== 'string') throw new Error(`step ${n} has no settled frame in take.json`);
  return file;
}

/** How many cells a sheet may hold: fewer for a tall viewport, so the page stays under MAX_SHEET_HEIGHT. */
function cellLimit(take) {
  const ratio = take.viewport?.width > 0 && take.viewport?.height > 0 ? take.viewport.height / take.viewport.width : DEFAULT_RATIO;
  const rowHeight = Math.round(THUMB_WIDTH * ratio) + CAPTION_HEIGHT + GAP;
  return Math.min(MAX_CELLS, Math.max(COLUMNS, Math.floor(MAX_SHEET_HEIGHT / rowHeight) * COLUMNS));
}

/** The cells to draw: a picture and caption per step, then a note of what is left out, or a note that no step finished. */
function cellsOf(take, dir) {
  const limit = cellLimit(take);
  if (take.steps.length === 0) return [{ caption: 'no step finished, so there is no picture', base64: null }];
  const shown = take.steps.length > limit ? limit - 1 : take.steps.length;
  const cells = take.steps.slice(0, shown).map((step, i) => ({
    caption: `${i + 1} ${agentText(step.id, { max: ID_MAX })}`,
    base64: fs.readFileSync(path.join(dir, 'frames', settledFile(take, step, i + 1))).toString('base64'),
  }));
  if (shown < take.steps.length) cells.push({ caption: `and ${take.steps.length - shown} more steps (their frames are in frames/)`, base64: null });
  return cells;
}

async function drawGrid(page, cells) {
  await page.setContent(shellOf());
  for (const { caption, base64 } of cells) await page.evaluate(addCell, { caption, base64, width: THUMB_WIDTH, decodeMs: DECODE_MS });
}

async function shootUnder(page) {
  let picture = null;
  for (const quality of QUALITIES) {
    picture = await page.screenshot({ type: 'jpeg', quality, fullPage: true });
    if (picture.length < MAX_BYTES) break;
  }
  return picture;
}

export async function contactSheet(browser, take, dir) {
  const cells = cellsOf(take, dir); // reads the frames first: a missing file stops here, before a context is made
  const context = await browser.newContext({ viewport: { width: SHEET_WIDTH, height: START_HEIGHT } });
  try {
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await drawGrid(page, cells);
    const file = path.join(dir, 'contact.jpg');
    fs.writeFileSync(file, await shootUnder(page));
    return file;
  } finally {
    await context.close().catch(() => {});
  }
}
