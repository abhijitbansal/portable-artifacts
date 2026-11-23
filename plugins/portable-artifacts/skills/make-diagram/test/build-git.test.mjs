// End to end: build.mjs of a spec that sits inside a git repository writes the page to <git root>/.scratch and then asks git
// whether that folder is ignored. That repository may not be the user's own, so the question must not run its core.fsmonitor
// command or lazy-fetch through its uploadpack (shared/output.mjs scratchIgnoreNote). No browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { plant, scratchRepo, partialCloneWithMissingIgnore, plainGit, tmpDir, cleanUp } from '../../../shared/test/helpers/git-plants.mjs';

const BUILD = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const EXAMPLE = fileURLToPath(new URL('../references/examples/flow.diagram.json', import.meta.url));
const CHECK = ['check-ignore', '-q', '--', '.scratch/x.html'];

// Builds the example from a copy inside `dir`, run from `dir`, with no --out and no PA_OUTPUT_DIR: the default output is <dir>/.scratch.
function buildInside(dir) {
  const spec = path.join(dir, 'flow.diagram.json');
  fs.copyFileSync(EXAMPLE, spec);
  const home = tmpDir('diagram-git-home-');
  // The developer's own git config must not decide the note: no global ignore rule (core.excludesFile or $XDG_CONFIG_HOME/git/ignore).
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull };
  delete env.PA_OUTPUT_DIR;
  const r = spawnSync(process.execPath, [BUILD, spec], { cwd: dir, encoding: 'utf8', env, timeout: 60000 });
  cleanUp(home);
  return r;
}

const pageIn = (dir) => fs.readdirSync(path.join(dir, '.scratch')).filter((f) => f.endsWith('.html'));

test('build.mjs in a repository with a planted core.fsmonitor never runs it, and still prints the not-ignored note', () => {
  const repo = scratchRepo();
  const p = plant();
  try {
    fs.appendFileSync(path.join(repo.dir, '.git', 'config'), `[core]\n\tfsmonitor = ${p.script}\n`);
    plainGit(repo.dir, CHECK);
    assert.equal(p.ran(), true, 'control: plain git check-ignore runs the planted fsmonitor');
    p.clear();
    const r = buildInside(repo.dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(pageIn(repo.dir).length, 1, 'the page landed in <repo>/.scratch');
    assert.match(r.stderr, /note: \.scratch\/ is not gitignored/, 'git was asked, and answered');
    assert.equal(p.ran(), false, 'the build ran the repository\'s core.fsmonitor command');
  } finally {
    repo.cleanup();
    p.cleanup();
  }
});

test('build.mjs in a partial clone whose .gitignore blob is missing never lazy-fetches through its uploadpack', () => {
  const repo = partialCloneWithMissingIgnore();
  try {
    plainGit(repo.dir, CHECK);
    assert.equal(repo.p.ran(), true, 'control: plain git check-ignore lazy-fetches through the planted uploadpack');
    repo.p.clear();
    const r = buildInside(repo.dir);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(pageIn(repo.dir).length, 1);
    assert.equal(repo.p.ran(), false, 'the build ran remote.origin.uploadpack through a lazy fetch');
  } finally {
    repo.cleanup();
  }
});
