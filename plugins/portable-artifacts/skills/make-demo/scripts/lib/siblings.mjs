// Sibling skills (make-explainer) live in directories next to make-demo on every install path. make-demo runs their scripts as child
// processes; a missing one is a SiblingError carrying the exact install command. Adapted from make-scene's siblings.mjs, with an
// injectable `root` (the folder that holds the sibling skill folders) so a test can point at a temp layout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quoteArg } from '../../shared/doctor.mjs';
import { siblingInstallCommand } from '../../shared/sibling-install.mjs';

const SELF_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_ROOT = path.resolve(SELF_DIR, '..');
const NAME = /^[a-z][a-z0-9-]*$/;

export class SiblingError extends Error {
  constructor(message, command) {
    super(message);
    this.name = 'SiblingError';
    this.command = command;
  }
}

// The same pinned form the doctor runs.
const installCommand = siblingInstallCommand;
// Points at the doctor, which can install it for the user once they agree; its id for a sister skill is the skill name.
const doctorHint = (id) => `(doctor: node ${quoteArg(path.join(SELF_DIR, 'scripts/doctor.mjs'))}, id ${id})`;

// Absolute path of the sibling skill folder. Does not check that it exists.
export function siblingDir(name, { root = DEFAULT_ROOT } = {}) {
  if (!NAME.test(name)) throw new TypeError(`sibling name must be a plain skill name, got ${JSON.stringify(name)}`);
  return path.resolve(root, name);
}

// Absolute path of a script (e.g. 'scripts/build.mjs') inside a sibling skill; a SiblingError when the skill or the script is not there.
export function siblingScript(name, relScript, { root } = {}) {
  const dir = siblingDir(name, { root });
  const file = path.resolve(dir, relScript);
  const rel = path.relative(dir, file);
  if (!rel || path.isAbsolute(relScript) || path.isAbsolute(rel) || rel === '..' || rel.startsWith(`..${path.sep}`)) {
    throw new TypeError(`script path must name a file inside the sibling skill, got ${JSON.stringify(relScript)}`);
  }
  if (!fs.existsSync(file)) {
    const where = fs.existsSync(dir) ? `${name}/${relScript} not found in ${dir}` : `${name} skill not found next to make-demo (looked in ${dir})`;
    throw new SiblingError(`${where}; install it with: ${installCommand([name])} ${doctorHint(name)}`, installCommand([name]));
  }
  return file;
}
