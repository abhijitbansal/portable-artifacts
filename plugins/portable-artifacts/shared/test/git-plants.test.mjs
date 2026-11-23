// The helper the git tests share: its own git must not be steered by the developer's environment (a git hook or
// `git rebase --exec` exports GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE), and it must build a commit with a gpgsig header.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  plainGit, mustGit, withEnv, tmpDir, cleanUp, signedCommit, showSignatureConfig, plant,
} from './helpers/git-plants.mjs';

test('plainGit and mustGit ignore GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE and the config injectors of the developer\'s environment', () => {
  const dir = tmpDir('pa-plants-');
  const elsewhere = tmpDir('pa-plants-else-');
  try {
    withEnv({
      GIT_DIR: path.join(elsewhere, 'git'), GIT_WORK_TREE: elsewhere, GIT_INDEX_FILE: path.join(elsewhere, 'index'),
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.bare', GIT_CONFIG_VALUE_0: 'true',
    }, () => {
      mustGit(dir, 'init', '-q', '-b', 'main');
      fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
      mustGit(dir, 'add', '-A');
      mustGit(dir, 'commit', '-q', '-m', 'base');
      assert.equal(plainGit(dir, ['rev-parse', '--git-dir']).out.trim(), '.git');
    });
    assert.deepEqual(fs.readdirSync(elsewhere), [], 'nothing was written where the developer\'s variables pointed');
  } finally {
    cleanUp(dir, elsewhere);
  }
});

test('an env value of undefined removes the variable from plainGit\'s environment (the null global config goes, HOME\'s is read)', () => {
  const dir = tmpDir('pa-plants-');
  const home = tmpDir('pa-plants-home-');
  try {
    mustGit(dir, 'init', '-q');
    fs.writeFileSync(path.join(home, '.gitconfig'), '[pa]\n\tmarker = yes\n');
    assert.equal(plainGit(dir, ['config', 'pa.marker'], { env: { HOME: home } }).out.trim(), '', 'by default the global config is the null device');
    assert.equal(plainGit(dir, ['config', 'pa.marker'], { env: { HOME: home, GIT_CONFIG_GLOBAL: undefined } }).out.trim(), 'yes');
  } finally {
    cleanUp(dir, home);
  }
});

test('signedCommit makes a commit with a gpgsig header that git verifies through gpg.program only when asked', () => {
  const dir = tmpDir('pa-plants-');
  const p = plant('exit 1');
  try {
    mustGit(dir, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    mustGit(dir, 'add', '-A');
    mustGit(dir, 'commit', '-q', '-m', 'base');
    const sha = signedCommit(dir, 'signed', 'b.txt');
    assert.equal(mustGit(dir, 'rev-parse', 'HEAD'), sha);
    assert.match(mustGit(dir, 'cat-file', '-p', 'HEAD'), /^gpgsig -----BEGIN PGP SIGNATURE-----$/m);
    assert.deepEqual(mustGit(dir, 'ls-tree', '--name-only', 'HEAD').split('\n'), ['a.txt', 'b.txt']);
    mustGit(dir, 'log', '-1');
    assert.equal(p.ran(), false, 'nothing asked for a check');
    fs.appendFileSync(path.join(dir, '.git', 'config'), showSignatureConfig(p.script));
    plainGit(dir, ['log', '-1']);
    assert.equal(p.ran(), true);
  } finally {
    p.cleanup();
    cleanUp(dir);
  }
});
