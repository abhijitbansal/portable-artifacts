// Where film.mjs and guide.mjs may write: a new .json file inside the demo folder. Never an existing file (the agent may have edited it),
// never a link, never a place outside the folder. `Refused` carries { path, message } problems for the commands to print.
import fs from 'node:fs';
import path from 'node:path';

export class Refused extends Error {
  constructor(errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    super(list[0].message);
    this.name = 'Refused';
    this.errors = list;
  }
}

/** True when `target` is `base` or sits under it (both real paths). */
export function isInside(base, target) {
  const rel = path.relative(base, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

const refuse = (message) => new Refused({ path: 'out', message });

/** The absolute path of the file to write: `wanted` (against the working folder) or `fallback`, which must be new, a .json and inside `demoDir`. */
export function outPath(demoDir, wanted, fallback) {
  const file = path.resolve(wanted ?? fallback);
  if (path.extname(file) !== '.json') throw refuse(`${path.basename(file)} is not a .json file; pass --out with a name ending in .json`);
  let parent;
  try {
    parent = fs.realpathSync(path.dirname(file));
  } catch {
    throw refuse(`the folder of ${file} does not exist`);
  }
  if (!isInside(fs.realpathSync(demoDir), parent)) throw refuse(`${file} is outside the demo folder ${demoDir}; pass --out with a path inside it`);
  try {
    fs.lstatSync(file);
  } catch {
    return file;
  }
  throw refuse(`${file} exists; pass --out with a new name`);
}
