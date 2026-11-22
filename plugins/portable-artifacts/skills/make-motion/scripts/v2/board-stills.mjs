// The board's strips (`board-<n>.jpg`, written by `make.mjs --sheets-only --estimated`) as the storyboard page takes them:
// read from the board folder, refused when make-explainer would refuse them, and copied beside the plan. Strip n holds the
// shots (n - 1) * BOARD_PER_STRIP onward, so a strip is tied to its shots by the number in its name, never by its place in a list.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../../shared/cli.mjs';
import { BOARD_PER_STRIP } from './plan.mjs';

const STRIP_RE = /^board-([1-9]\d*)\.jpg$/;
const ACCEPTED = 'board-<n>.jpg files, regular files of at most 1.5 MB';
const MAX_STRIP_BYTES = 1.5 * 1024 * 1024; // make-explainer's limit for an image section
const BYTES_PER_MB = 1024 * 1024;

const lstatOrNull = (file) => {
  try {
    return lstatSync(file);
  } catch {
    return null;
  }
};

function stripNames(folder) {
  let names;
  try {
    names = readdirSync(folder);
  } catch {
    throw new UsageError(`--stills: ${folder} is not a readable folder; give the board folder (accepted: ${ACCEPTED})`);
  }
  const strips = names.filter((n) => STRIP_RE.test(n)).map((name) => ({ name, n: Number(STRIP_RE.exec(name)[1]) })).sort((a, b) => a.n - b.n);
  if (strips.length === 0) throw new UsageError(`--stills: ${folder} holds no board-<n>.jpg file; make them with make.mjs --sheets-only --estimated (accepted: ${ACCEPTED})`);
  return strips;
}

/**
 * The strips of `folder` (`{ name, n }`, in order of n) that have a shot of a film of `shotCount` shots behind them, or a
 * UsageError naming the strip that is a link, not a regular file or too big, or the folder that holds no usable strip.
 */
export function checkStrips(folder, shotCount) {
  const strips = stripNames(folder);
  for (const { name } of strips) {
    const stat = lstatSync(path.join(folder, name));
    if (stat.isSymbolicLink()) throw new UsageError(`--stills: ${name} is a symbolic link; make-explainer takes only regular files (accepted: ${ACCEPTED})`);
    if (!stat.isFile()) throw new UsageError(`--stills: ${name} is not a regular file (accepted: ${ACCEPTED})`);
    if (stat.size > MAX_STRIP_BYTES) {
      throw new UsageError(`--stills: ${name} is ${(stat.size / BYTES_PER_MB).toFixed(2)} MB; make-explainer takes at most 1.5 MB (accepted: ${ACCEPTED})`);
    }
  }
  const wanted = strips.filter(({ n }) => (n - 1) * BOARD_PER_STRIP < shotCount);
  if (wanted.length === 0) throw new UsageError(`--stills: no strip in ${folder} has a shot of this ${shotCount}-shot film behind it; make the board again with make.mjs --sheets-only --estimated`);
  return wanted;
}

// The destination folder, ready to take the strips: made if it is not there, refused when it is a link, a file, or the board
// folder itself (copying a strip onto itself would delete its own source), and emptied of its own board-<n>.jpg files.
function prepareDest(folder, dest, stillsName) {
  const existing = lstatOrNull(dest);
  if (existing?.isSymbolicLink() === true) throw new UsageError(`--stills: ${stillsName} beside the plan (${dest}) is a symbolic link; remove it or choose another --out`);
  if (existing !== null && !existing.isDirectory()) throw new UsageError(`--stills: ${dest} is in the way: it is not a folder; remove it or choose another --out`);
  if (existing !== null && realpathSync(dest) === realpathSync(folder)) {
    throw new UsageError(`--stills: ${folder} is the folder the pictures are copied into (${stillsName} beside the plan); keep the board elsewhere, or choose another --out`);
  }
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(dest)) {
    if (STRIP_RE.test(name) && lstatSync(path.join(dest, name)).isFile()) rmSync(path.join(dest, name), { force: true });
  }
}

/**
 * Copies `strips` (from checkStrips) of `folder` into `<plan folder>/<plan stem>.stills/` and returns their paths relative
 * to the plan's folder (the form an image section takes). A failed copy is a UsageError naming the path.
 */
export function copyStrips(folder, strips, planFile) {
  const stillsName = `${path.basename(planFile, path.extname(planFile))}.stills`;
  const dest = path.join(path.dirname(planFile), stillsName);
  try {
    prepareDest(folder, dest, stillsName);
    return strips.map(({ name }) => {
      rmSync(path.join(dest, name), { force: true }); // a link of that name is replaced, never followed
      copyFileSync(path.join(folder, name), path.join(dest, name));
      return `${stillsName}/${name}`;
    });
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`--stills: could not copy the strips to ${dest}: ${e.code ?? String(e.message).split('\n')[0]}`);
  }
}
