// The geometry and the pictures behind `scripts/locate.mjs`: two passes of numbered cells turn what an agent sees in a
// picture into a `regions` box ([x, y, w, h], fractions of the picture). Pass one cuts the picture into nine strips each
// way; pass two cuts the chosen block into a 6 by 6 grid; the cells picked, grown by a quarter cell, are the region.
// No network, no model: the agent looks at the PNGs and names the numbers.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../../shared/cli.mjs';
import { readPng } from '../v2/png.mjs';
import { drawNumber, plateSize } from './digits.mjs';
import { findFfmpeg, fileInput } from './ffmpeg.mjs';

export const STRIPS = 9;
export const GRID = 6;
export const PAD_CELLS = 0.25;
export const MAX_OVERLAY_SIDE = 1600;
export const REGION_DECIMALS = 3;

const CELLS = GRID * GRID;
const MIN_GRID_SIDE = 720; // a small crop is enlarged to this long side so its cells are big enough to read
const PLATE_SHARE = 0.5; // a number plate takes at most this share of the cell (or strip) it labels
const MAX_PLATE_SCALE = 8;
const LINE = 2; // pixels
const BOX_LINE = 3;
const DIM = 0.45; // brightness kept outside the box in box.png
const TINT = 0.28; // how far the odd strips are pulled toward the strip colour
const MAX_FFMPEG_BYTES = 512 * 1024 * 1024;
const COLOURS = Object.freeze({ line: [255, 0, 255], strip: [255, 190, 0], ink: [255, 255, 0], plate: [0, 0, 0] });

const outsideRange = (flag, what, max, got) => new UsageError(`${flag}: ${what} run from 1 to ${max}, got ${got}`);

// [first, last] of whole numbers in 1..max with first <= last, or a UsageError that names the accepted values.
function checkPair(flag, what, max, pair) {
  const [first, last] = pair;
  for (const n of pair) if (!Number.isInteger(n) || n < 1 || n > max) throw outsideRange(flag, what, max, `${first}-${last}`);
  if (first > last) throw new UsageError(`${flag}: ${what} run from 1 to ${max}, first before last (got ${first}-${last})`);
  return pair;
}

/** The block of strips `cols` and `rows` (each [first, last], strips counted from 1) as [x0, y0, x1, y1], fractions of the picture. */
export function stripsBox({ cols, rows }) {
  const [c0, c1] = checkPair('--cols', 'strips', STRIPS, cols);
  const [r0, r1] = checkPair('--rows', 'strips', STRIPS, rows);
  return [(c0 - 1) / STRIPS, (r0 - 1) / STRIPS, c1 / STRIPS, r1 / STRIPS];
}

const clampUnit = (v) => Math.min(1, Math.max(0, v));

/**
 * The rectangle from cell `first` to cell `last` (cells counted 1 to 36, row by row) of the 6 by 6 grid over `box`
 * [x0, y0, x1, y1], grown by PAD_CELLS of a cell on each side and held inside 0..1.
 */
export function cellsBox(box, cells) {
  const [first, last] = checkPair('--cells', 'cells', CELLS, cells);
  const [x0, y0, x1, y1] = box;
  const [cw, ch] = [(x1 - x0) / GRID, (y1 - y0) / GRID];
  const [colA, colB] = [(first - 1) % GRID, (last - 1) % GRID];
  const [rowA, rowB] = [Math.floor((first - 1) / GRID), Math.floor((last - 1) / GRID)];
  return [
    clampUnit(x0 + (Math.min(colA, colB) - PAD_CELLS) * cw),
    clampUnit(y0 + (Math.min(rowA, rowB) - PAD_CELLS) * ch),
    clampUnit(x0 + (Math.max(colA, colB) + 1 + PAD_CELLS) * cw),
    clampUnit(y0 + (Math.max(rowA, rowB) + 1 + PAD_CELLS) * ch),
  ];
}

const ROUND = 10 ** REGION_DECIMALS;
const round = (v) => Math.round(v * ROUND) / ROUND;

/** [x0, y0, x1, y1] as [x, y, w, h], each rounded to REGION_DECIMALS: the form a `regions` entry takes. */
export function toRegion([x0, y0, x1, y1]) {
  return [round(x0), round(y0), round(x1 - x0), round(y1 - y0)];
}

// ---- reading the picture -----------------------------------------------------------------------------------------

// 8-bit RGB of any pixels: an alpha channel is laid over white.
function toRgb({ width, height, channels, data }) {
  if (channels === 3) return { width, height, channels, data };
  const out = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(data[i * 4 + c] * a + 255 * (1 - a));
  }
  return { width, height, channels: 3, data: out };
}

// ffmpeg decodes one frame of any picture format to an 8-bit RGB PNG on a pipe, through the file and pipe protocols only.
async function decodeWithFfmpeg(file) {
  const ext = path.extname(file).slice(1).toLowerCase() || 'non-PNG';
  let ffmpeg;
  try {
    ffmpeg = await findFfmpeg();
  } catch {
    throw new UsageError(`locate needs ffmpeg to read a ${ext} picture; run the doctor, or give a PNG`);
  }
  const run = spawnSync(ffmpeg, ['-v', 'error', '-nostdin', ...fileInput(file), '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-pix_fmt', 'rgb24', 'pipe:1'],
    { maxBuffer: MAX_FFMPEG_BYTES });
  if (run.status !== 0 || !run.stdout?.length) {
    const why = run.error ? (run.error.code ?? run.error.message) : String(run.stderr ?? '').trim().split('\n').at(-1) || 'no picture came out';
    throw new UsageError(`ffmpeg could not read ${path.basename(file)} as a picture: ${why}`);
  }
  return toRgb(readPng(run.stdout));
}

/** The picture in `file` as { width, height, channels: 3, data }: a PNG `readPng` takes directly, anything else through ffmpeg. */
export async function readPicture(file) {
  const buffer = readFileSync(file);
  try {
    return toRgb(readPng(buffer));
  } catch {
    return decodeWithFfmpeg(file);
  }
}

// ---- drawing --------------------------------------------------------------------------------------------------

// `pixels` resampled to w by h: the mean of the source pixels a destination pixel covers when shrinking, the nearest when enlarging.
function resize(pixels, w, h) {
  if (pixels.width === w && pixels.height === h) return pixels;
  const out = Buffer.alloc(w * h * 3);
  const [sx, sy] = [pixels.width / w, pixels.height / h];
  for (let y = 0; y < h; y++) {
    const [y0, y1] = [Math.floor(y * sy), Math.min(pixels.height, Math.max(Math.floor(y * sy) + 1, Math.ceil((y + 1) * sy)))];
    for (let x = 0; x < w; x++) {
      const [x0, x1] = [Math.floor(x * sx), Math.min(pixels.width, Math.max(Math.floor(x * sx) + 1, Math.ceil((x + 1) * sx)))];
      const sum = [0, 0, 0];
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) for (let c = 0; c < 3; c++) sum[c] += pixels.data[(py * pixels.width + px) * 3 + c];
      }
      const n = (y1 - y0) * (x1 - x0);
      for (let c = 0; c < 3; c++) out[(y * w + x) * 3 + c] = Math.round(sum[c] / n);
    }
  }
  return { width: w, height: h, channels: 3, data: out };
}

// The picture, shrunk (never enlarged) so neither side passes MAX_OVERLAY_SIDE.
function fitWithin(pixels) {
  const k = Math.min(1, MAX_OVERLAY_SIDE / Math.max(pixels.width, pixels.height));
  return k === 1 ? pixels : resize(pixels, Math.max(1, Math.round(pixels.width * k)), Math.max(1, Math.round(pixels.height * k)));
}

const copyOf = (p) => ({ ...p, data: Buffer.from(p.data) });

function cropTo(pixels, [x0, y0, x1, y1]) {
  const left = Math.min(pixels.width - 1, Math.floor(x0 * pixels.width + 1e-6));
  const top = Math.min(pixels.height - 1, Math.floor(y0 * pixels.height + 1e-6));
  const right = Math.min(pixels.width, Math.max(left + 1, Math.ceil(x1 * pixels.width - 1e-6)));
  const bottom = Math.min(pixels.height, Math.max(top + 1, Math.ceil(y1 * pixels.height - 1e-6)));
  const [w, h] = [right - left, bottom - top];
  const data = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) pixels.data.copy(data, y * w * 3, ((top + y) * pixels.width + left) * 3, ((top + y) * pixels.width + left + w) * 3);
  return { width: w, height: h, channels: 3, data };
}

function paint(pixels, x, y, w, h, colour, mix = 1) {
  for (let py = Math.max(0, Math.round(y)); py < Math.min(pixels.height, Math.round(y + h)); py++) {
    for (let px = Math.max(0, Math.round(x)); px < Math.min(pixels.width, Math.round(x + w)); px++) {
      for (let c = 0; c < 3; c++) {
        const at = (py * pixels.width + px) * 3 + c;
        pixels.data[at] = Math.round(pixels.data[at] * (1 - mix) + colour[c] * mix);
      }
    }
  }
}

// The largest plate scale whose plate takes no more than PLATE_SHARE of a `room` pixels span, for a plate `units` font cells across.
const plateScale = (room, units) => Math.max(1, Math.min(MAX_PLATE_SCALE, Math.floor((PLATE_SHARE * room) / units)));
const plateAt = (pixels, x, y, value, scale) => drawNumber(pixels, { x, y, value, scale, ink: COLOURS.ink, plate: COLOURS.plate });

/** The picture cut into nine numbered strips along `axis` ('cols': side by side, 'rows': stacked), as RGB pixels. */
export function renderStrips(pixels, axis) {
  const out = copyOf(fitWithin(pixels));
  const across = axis === 'cols' ? out.width : out.height;
  const size = across / STRIPS;
  const unit = plateSize(STRIPS, 1);
  const scale = plateScale(size, axis === 'cols' ? unit.width : unit.height);
  const plate = plateSize(STRIPS, scale);
  for (let i = 0; i < STRIPS; i++) {
    const at = i * size;
    if (axis === 'cols') paint(out, at, 0, size, out.height, COLOURS.strip, i % 2 ? TINT : 0);
    else paint(out, 0, at, out.width, size, COLOURS.strip, i % 2 ? TINT : 0);
  }
  for (let i = 0; i < STRIPS; i++) {
    const at = i * size;
    if (axis === 'cols') {
      paint(out, at, 0, LINE, out.height, COLOURS.line);
      const x = Math.round(at + size / 2 - plate.width / 2);
      plateAt(out, x, 0, i + 1, scale);
      plateAt(out, x, out.height - plate.height, i + 1, scale);
    } else {
      paint(out, 0, at, out.width, LINE, COLOURS.line);
      const y = Math.round(at + size / 2 - plate.height / 2);
      plateAt(out, 0, y, i + 1, scale);
      plateAt(out, out.width - plate.width, y, i + 1, scale);
    }
  }
  return out;
}

/** The block `box` ([x0, y0, x1, y1], fractions) of the picture, enlarged if small, with its 36 cells numbered row by row. */
export function renderGrid(pixels, box) {
  const crop = cropTo(pixels, box);
  const long = Math.max(crop.width, crop.height);
  const target = Math.min(MAX_OVERLAY_SIDE, Math.max(long, MIN_GRID_SIDE));
  const k = target / long;
  const out = copyOf(resize(crop, Math.max(1, Math.round(crop.width * k)), Math.max(1, Math.round(crop.height * k))));
  const [cw, ch] = [out.width / GRID, out.height / GRID];
  const scale = Math.min(plateScale(cw, plateSize(CELLS, 1).width), plateScale(ch, plateSize(CELLS, 1).height)); // 36 is the widest label
  for (let i = 0; i <= GRID; i++) {
    paint(out, Math.min(out.width - LINE, i * cw), 0, LINE, out.height, COLOURS.line);
    paint(out, 0, Math.min(out.height - LINE, i * ch), out.width, LINE, COLOURS.line);
  }
  for (let n = 0; n < CELLS; n++) plateAt(out, Math.round((n % GRID) * cw) + LINE, Math.round(Math.floor(n / GRID) * ch) + LINE, n + 1, scale);
  return out;
}

/** The picture with `box` ([x0, y0, x1, y1], fractions) drawn on it: the rest dimmed, the box edged. */
export function renderBox(pixels, box) {
  const out = copyOf(fitWithin(pixels));
  const [x0, y0, x1, y1] = [box[0] * out.width, box[1] * out.height, box[2] * out.width, box[3] * out.height];
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (x >= x0 && x < x1 && y >= y0 && y < y1) continue;
      const at = (y * out.width + x) * 3;
      for (let c = 0; c < 3; c++) out.data[at + c] = Math.round(out.data[at + c] * DIM);
    }
  }
  paint(out, x0, y0, x1 - x0, BOX_LINE, COLOURS.line);
  paint(out, x0, y1 - BOX_LINE, x1 - x0, BOX_LINE, COLOURS.line);
  paint(out, x0, y0, BOX_LINE, y1 - y0, COLOURS.line);
  paint(out, x1 - BOX_LINE, y0, BOX_LINE, y1 - y0, COLOURS.line);
  return out;
}
