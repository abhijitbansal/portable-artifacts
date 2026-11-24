// A writer that makes its output folder with a bare `mkdirSync(dir, { recursive: true })` skips the containment check (shared/write-file.mjs
// ensureOutputFolder). This reads every skill script and the installer and fails on one that is not on the short list below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Each is a folder that is not an output of a build in a repository, with the reason.
const ALLOWED = new Map([
  ['skills/make-diagram/scripts/lib/icon-import.mjs', 'the cloud-icon cache under the user\'s home (or MAKE_DIAGRAM_ICON_DIR), not a repository output'],
  ['bin/install.mjs', 'checked up front for --project (checkProjectFolders); a user install writes under HOME'],
  ['bin/sync-shared.mjs', 'the developer script that copies shared/ into the skills'],
]);
const BARE = /mkdirSync\(.*recursive:\s*true/;

function scripts(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dev', 'test', 'shared'].includes(entry.name)) out.push(...scripts(file));
    } else if (entry.name.endsWith('.mjs')) out.push(file);
  }
  return out;
}

test('no writer makes its output folder with a bare recursive mkdirSync', () => {
  const skills = fs.readdirSync(path.join(PLUGIN, 'skills')).map((name) => path.join(PLUGIN, 'skills', name, 'scripts')).filter((d) => fs.existsSync(d));
  const files = [...skills.flatMap(scripts), ...scripts(path.join(PLUGIN, 'bin'))];
  assert.ok(files.length > 50, 'the scan found the scripts');
  const bare = files
    .filter((file) => fs.readFileSync(file, 'utf8').split('\n').some((line) => BARE.test(line) && !line.trimStart().startsWith('//')))
    .map((file) => path.relative(PLUGIN, file))
    .filter((rel) => !ALLOWED.has(rel));
  assert.deepEqual(bare, [], 'use ensureOutputFolder (shared/write-file.mjs) instead of mkdirSync(..., { recursive: true }), or list the file with its reason');
});
