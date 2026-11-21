// Which packages of a skill's package.json "dependencies" its node_modules lacks. Node built-ins only: preflight.mjs and
// doctor.mjs both run before the skill's node_modules exists, and both must agree on what a partial install is.
import fs from 'node:fs';
import path from 'node:path';

/**
 * The names under "dependencies" in the skill's package.json that have no folder with a package.json in its node_modules.
 * A skill whose package.json cannot be read lists none: the folder check alone is what remains.
 * exists, readFile and join default to the real file system and path; the doctor passes its context's (tests, win32 paths).
 */
export function missingPackages(skillRoot, exists, readFile = (p) => fs.readFileSync(p, 'utf8'), join = path.join) {
  let names;
  try {
    names = Object.keys(JSON.parse(readFile(join(skillRoot, 'package.json'))).dependencies ?? {});
  } catch {
    return [];
  }
  return names.filter((name) => !exists(join(skillRoot, 'node_modules', name, 'package.json')));
}
