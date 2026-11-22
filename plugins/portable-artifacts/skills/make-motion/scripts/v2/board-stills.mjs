// The board's strips (`board-<n>.jpg`, written by `make.mjs --sheets-only --estimated`) as the storyboard page takes them:
// read from the board folder, refused when make-explainer would refuse them, and copied beside the plan.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../../shared/cli.mjs';

const STRIP_RE = /^board-(\d+)\.jpg$/;
const ACCEPTED = 'board-<n>.jpg files, regular files of at most 1.5 MB';
const MAX_STRIP_BYTES = 1.5 * 1024 * 1024; // make-explainer's limit for an image section
const BYTES_PER_MB = 1024 * 1024;

function stripFiles(folder) {
  let names;
  try {
    names = readdirSync(folder);
  } catch {
    throw new UsageError(`--stills: ${folder} is not a readable folder; give the board folder (accepted: ${ACCEPTED})`);
  }
  const strips = names.filter((n) => STRIP_RE.test(n)).sort((a, b) => Number(STRIP_RE.exec(a)[1]) - Number(STRIP_RE.exec(b)[1]));
  if (strips.length === 0) throw new UsageError(`--stills: ${folder} holds no board-<n>.jpg file; make them with make.mjs --sheets-only --estimated (accepted: ${ACCEPTED})`);
  return strips;
}

/** The strip names in `folder`, in order, or a UsageError naming the file that is a link or too big. */
export function checkStrips(folder) {
  const strips = stripFiles(folder);
  for (const name of strips) {
    const stat = lstatSync(path.join(folder, name));
    if (stat.isSymbolicLink()) throw new UsageError(`--stills: ${name} is a symbolic link; make-explainer takes only regular files (accepted: ${ACCEPTED})`);
    if (!stat.isFile()) throw new UsageError(`--stills: ${name} is not a regular file (accepted: ${ACCEPTED})`);
    if (stat.size > MAX_STRIP_BYTES) {
      throw new UsageError(`--stills: ${name} is ${(stat.size / BYTES_PER_MB).toFixed(2)} MB; make-explainer takes at most 1.5 MB (accepted: ${ACCEPTED})`);
    }
  }
  return strips;
}

/**
 * Copies the strips of `folder` into `<plan folder>/<plan stem>.stills/` and returns their paths relative to the plan's folder
 * (the form an image section takes). Call `checkStrips` first.
 */
export function copyStrips(folder, strips, planFile) {
  const stillsName = `${path.basename(planFile, path.extname(planFile))}.stills`;
  const dest = path.join(path.dirname(planFile), stillsName);
  let existing = null;
  try { existing = lstatSync(dest); } catch { /* not there yet */ }
  if (existing?.isSymbolicLink() === true) throw new UsageError(`--stills: ${stillsName} beside the plan is a symbolic link; remove it or choose another --out`);
  mkdirSync(dest, { recursive: true });
  return strips.map((name) => {
    rmSync(path.join(dest, name), { force: true }); // a link of that name is replaced, never followed
    copyFileSync(path.join(folder, name), path.join(dest, name));
    return `${stillsName}/${name}`;
  });
}
