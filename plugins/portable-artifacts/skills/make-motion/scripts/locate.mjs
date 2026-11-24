#!/usr/bin/env node
// Turns a target you can see in a picture into a `regions` box for a clipping shot, in three plain calls. You look at
// the PNGs it writes and name the numbers; no network, no model.
//   1. node scripts/locate.mjs <picture> --out <dir>
//      writes <dir>/strips-cols.png and <dir>/strips-rows.png (the picture in nine numbered strips each way).
//   2. node scripts/locate.mjs <picture> --cols 5-6 --rows 2-3 --out <dir>
//      writes <dir>/grid.png: that block of strips, 36 numbered cells.
//   3. node scripts/locate.mjs <picture> --cols 5-6 --rows 2-3 --cells 15-30 [--out <dir>] [--json]
//      prints [x, y, w, h] (with --json: {"region": [...]}); with --out it also writes <dir>/box.png, the picture with
//      the box drawn. Name every strip and cell the target touches: the region then holds the target, each edge within
//      1.25 cells of it.
// A PNG that scripts/v2/png.mjs cannot read, and a JPEG, WebP, GIF or BMP, is decoded by ffmpeg behind the file
// protocol, picture demuxer and picture decoder whitelists (a file of any other kind is refused). Exit 0 done; exit 2: a
// usage or IO problem (an unreadable picture, a strip outside 1 to 9, a cell outside 1 to 36, a URL), one line on stderr.
import { lstatSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli } from '../shared/cli.mjs';
import { ensureOutputFolder, writeFileReplacing } from '../shared/write-file.mjs';
import { GRID, STRIPS, cellsBox, readPicture, renderBox, renderGrid, renderStrips, stripsBox, toRegion } from './lib/locate.mjs';
import { encodePng } from './lib/png-write.mjs';

const SELF = fileURLToPath(import.meta.url);
const CELLS = GRID * GRID;
const MAX_PICTURE_BYTES = 2 ** 31 - 1; // readFileSync refuses a file over 2 GiB (ERR_FS_FILE_TOO_LARGE, which has no syscall)
const USAGE = 'node scripts/locate.mjs <picture> --out <dir> | --cols 5-6 --rows 2-3 --out <dir> | --cols 5-6 --rows 2-3 --cells 15-30 [--out <dir>] [--json]';
const ACCEPTED = '--out <dir>, --cols <first-last>, --rows <first-last>, --cells <first-last>, --json';
const OPTIONS = { out: { type: 'string' }, cols: { type: 'string' }, rows: { type: 'string' }, cells: { type: 'string' }, json: { type: 'boolean' } };
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const RANGE = /^(\d+)(?:-(\d+))?$/;

// `5-6` (or `5`, a single strip or cell) as [5, 6]; a UsageError that names the form and the accepted values otherwise.
function range(flag, text, what, max) {
  const m = RANGE.exec(text ?? '');
  if (m === null) throw new UsageError(`${flag}: write ${what} as first-last, such as 5-6 (${what} run from 1 to ${max}), got ${JSON.stringify(text)}`);
  return [Number(m[1]), Number(m[2] ?? m[1])];
}

function parseArgs(argv) {
  let parsed;
  try {
    parsed = parseCli(argv, OPTIONS, USAGE);
  } catch (e) {
    if (e.help === true) throw e;
    throw new UsageError(`${e.message} (accepted options: ${ACCEPTED})`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) throw new UsageError(`expected one picture, got ${positionals.length}; usage: ${USAGE}`);
  const [picture] = positionals;
  if (URL_SCHEME.test(picture)) throw new UsageError(`locate reads a picture file, not a URL (${picture}); download it first`);
  const { cols, rows, cells, out, json } = values;
  if ((cols === undefined) !== (rows === undefined)) throw new UsageError('--cols and --rows go together: name the block of strips on both axes');
  if (cells !== undefined && cols === undefined) throw new UsageError('--cells needs --cols and --rows: the cells are numbered inside that block of strips');
  if (json === true && cells === undefined) throw new UsageError('--json goes with --cells: it prints the region');
  if ((out === undefined || out === '') && cells === undefined) throw new UsageError(`--out <dir> is required: where to write the numbered picture; usage: ${USAGE}`);
  return {
    picture,
    out: out === '' ? undefined : out,
    json: json === true,
    cols: cols === undefined ? undefined : range('--cols', cols, 'strips', STRIPS),
    rows: rows === undefined ? undefined : range('--rows', rows, 'strips', STRIPS),
    cells: cells === undefined ? undefined : range('--cells', cells, 'cells', CELLS),
  };
}

const realOrResolved = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

function checkPicture(picture) {
  let stat;
  try {
    stat = statSync(picture);
  } catch {
    throw new UsageError(`cannot read ${picture}: no such file`);
  }
  if (stat.isDirectory()) throw new UsageError(`${picture} is a folder; name a picture file`);
  if (!stat.isFile()) throw new UsageError(`${picture} is not a regular file (a device or a pipe); name a picture file`);
  if (stat.size > MAX_PICTURE_BYTES) throw new UsageError(`${picture} is too large to read (${stat.size} bytes; the limit is ${MAX_PICTURE_BYTES}); name a smaller picture`);
}

// The folder to write into, made; never the picture itself, and no file it writes may replace the picture.
function outDir(out, picture, names) {
  const dir = path.resolve(out);
  const source = realOrResolved(picture);
  if (realOrResolved(dir) === source) throw new UsageError(`--out is the picture itself; name a folder for the numbered pictures, such as ${path.join(path.dirname(path.resolve(picture)), 'locate')}`);
  let stat = null;
  try { stat = lstatSync(dir); } catch { /* not there yet */ }
  if (stat !== null && !stat.isDirectory()) throw new UsageError(`--out: ${dir} exists and is not a folder; name a folder`);
  for (const name of names) {
    if (realOrResolved(path.join(dir, name)) === source) throw new UsageError(`--out: ${name} in ${dir} is the picture itself; choose another folder`);
  }
  ensureOutputFolder(dir);
  return dir;
}

// Paths made of plain characters print as they are; anything else is single-quoted.
const shellQuote = (text) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`);
const rangeText = ([a, b]) => `${a}-${b}`;
const savePng = (file, pixels) => writeFileReplacing(file, encodePng(pixels)); // strips-cols.png, grid.png, box.png: fixed names, so a link there is replaced
const command = (picture, parts) => `node ${shellQuote(SELF)} ${shellQuote(path.resolve(picture))} ${parts.join(' ')}`;

async function run(opts, out) {
  checkPicture(opts.picture);
  if (opts.cols === undefined) {
    const dir = outDir(opts.out, opts.picture, ['strips-cols.png', 'strips-rows.png']);
    const pixels = await readPicture(opts.picture);
    const files = [path.join(dir, 'strips-cols.png'), path.join(dir, 'strips-rows.png')];
    savePng(files[0], renderStrips(pixels, 'cols'));
    savePng(files[1], renderStrips(pixels, 'rows'));
    out(`${files.join('\n')}\nnext: ${command(opts.picture, ['--cols <first-last>', '--rows <first-last>', '--out', shellQuote(dir)])}\n`);
    return;
  }
  const block = stripsBox({ cols: opts.cols, rows: opts.rows });
  if (opts.cells === undefined) {
    const dir = outDir(opts.out, opts.picture, ['grid.png']);
    const file = path.join(dir, 'grid.png');
    savePng(file, renderGrid(await readPicture(opts.picture), block));
    const both = ['--cols', rangeText(opts.cols), '--rows', rangeText(opts.rows)];
    out(`${file}\nnext: ${command(opts.picture, [...both, '--cells <first-last>'])}\n`);
    return;
  }
  const box = cellsBox(block, opts.cells);
  const region = toRegion(box);
  if (opts.out !== undefined) {
    const dir = outDir(opts.out, opts.picture, ['box.png']);
    savePng(path.join(dir, 'box.png'), renderBox(await readPicture(opts.picture), box));
  }
  out(opts.json ? `${JSON.stringify({ region })}\n` : `[${region.join(', ')}]\n`);
}

/** Runs the command on `argv`; returns the exit code. `out` and `err` (writers; default: stdout and stderr) exist for tests. */
export async function main(argv, { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  try {
    await run(parseArgs(argv), out);
    return 0;
  } catch (e) {
    // A file it cannot read or write (a Node error with a code such as EACCES or ENOTDIR) is an IO problem: one line, exit 2.
    if (!(e instanceof UsageError) && typeof e?.code === 'string' && typeof e.syscall === 'string') {
      err(`${String(e.message).split('\n')[0]}\n`);
      return 2;
    }
    if (!(e instanceof UsageError)) throw e;
    if (e.help === true) {
      out(`usage: ${e.message}\n`);
      return 0;
    }
    err(`${String(e.message).split('\n')[0]}\n`);
    return 2;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === SELF) {
  process.exitCode = await main(process.argv.slice(2));
}
