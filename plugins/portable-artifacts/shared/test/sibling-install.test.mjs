// The sibling-install command is one constant in shared/sibling-install.mjs. The doctor, make-explainer (siblings.mjs,
// checks.mjs) and make-scene (siblings.mjs) all print it, so a second spelling would drift from the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SKILLS_CLI, SIBLING_REPO, siblingInstallCommand } from '../sibling-install.mjs';

const SHARED = path.resolve(import.meta.dirname, '..');
const PLUGIN = path.resolve(SHARED, '..');

test('the command pins the skills CLI and names this repository and the skills to add', () => {
  assert.equal(SKILLS_CLI, 'skills@1.7.2');
  assert.equal(SIBLING_REPO, 'abhijitbansal/portable-artifacts');
  assert.equal(siblingInstallCommand(['make-diagram']), 'npx --yes skills@1.7.2 add abhijitbansal/portable-artifacts --skill make-diagram -y');
  assert.equal(siblingInstallCommand(['make-diagram', 'make-dashboard']), 'npx --yes skills@1.7.2 add abhijitbansal/portable-artifacts --skill make-diagram make-dashboard -y');
});

/** Every .mjs under `dir` that is shipped code: no tests, no node_modules, no per-skill shared/ copy. */
function shippedCode(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'test', 'shared'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) shippedCode(full, out);
    else if (e.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

test('no shipped file spells the pinned CLI or the install command out again', () => {
  const files = [
    ...fs.readdirSync(SHARED).filter((f) => f.endsWith('.mjs')).map((f) => path.join(SHARED, f)),
    ...shippedCode(path.join(PLUGIN, 'skills')),
  ].filter((f) => path.basename(f) !== 'sibling-install.mjs');
  assert.ok(files.length > 10, 'the scan found the code');
  const offenders = files.filter((f) => /skills@\d|add abhijitbansal\/portable-artifacts/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(offenders.map((f) => path.relative(PLUGIN, f)), []);
});
