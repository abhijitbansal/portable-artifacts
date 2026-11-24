// `rows.mjs git` writes ./scene-rows.json by default, a predictable name in the folder it runs from. A symlink there is replaced by
// the rows file, never written through. A real run (needs git; no browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mustGit, tmpDir, cleanUp } from '../../../shared/test/helpers/git-plants.mjs';

const ROWS = fileURLToPath(new URL('../scripts/rows.mjs', import.meta.url));
const skip = process.platform === 'win32' && 'symbolic links need a privilege on Windows';

function repoWithCommit() {
  const dir = tmpDir('scene-rows-link-');
  mustGit(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a\n');
  mustGit(dir, 'add', '-A');
  mustGit(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

test('rows git: a symlink at the default ./scene-rows.json is replaced, and its target is untouched', { skip }, () => {
  const repo = repoWithCommit();
  const outside = tmpDir('scene-rows-out-');
  try {
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'precious');
    fs.symlinkSync(victim, path.join(repo, 'scene-rows.json'));
    const r = spawnSync(process.execPath, [ROWS, 'git', '--weeks', '2'], { cwd: repo, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'precious', 'rows git wrote through the link');
    assert.equal(fs.lstatSync(path.join(repo, 'scene-rows.json')).isSymbolicLink(), false);
    assert.ok(Array.isArray(JSON.parse(fs.readFileSync(path.join(repo, 'scene-rows.json'), 'utf8')).rows));
  } finally {
    cleanUp(repo, outside);
  }
});
