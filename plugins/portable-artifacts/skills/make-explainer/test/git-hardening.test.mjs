// gather runs git inside a repository that may not be the user's own. A repository's own config must not be able to
// run a command through a read-only gather: core.fsmonitor (run by `git status`), a diff driver's textconv and a filter driver's clean, smudge or process command.
// Each test first proves with plain git that the planted config really runs the script, so a pass means gather
// switched it off and not that the plant was wrong. Built-ins only; no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gatherGit, gitEnv } from '../scripts/lib/git.mjs';
import { makeRepo, featureRepo, git } from './helpers/repo.mjs';

/** A script that records that it ran: { script, marker } in a folder of its own, outside the repository. */
function plant() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-plant-')));
  const marker = path.join(dir, 'ran');
  const script = path.join(dir, 'hook.sh');
  fs.writeFileSync(script, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
  fs.chmodSync(script, 0o755);
  return { script, marker, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const appendConfig = (repo, text) => fs.appendFileSync(path.join(repo.dir, '.git', 'config'), text);

test('a repository whose config sets core.fsmonitor to a script never runs it during gather', () => {
  const repo = featureRepo();
  const { script, marker, cleanup } = plant();
  try {
    appendConfig(repo, `[core]\n\tfsmonitor = ${script}\n`);
    git(repo.dir, 'status', '--porcelain');
    assert.equal(fs.existsSync(marker), true, 'control: plain git status runs the planted fsmonitor');
    fs.rmSync(marker);
    const facts = gatherGit({ repo: repo.dir });
    assert.equal(facts.branch, 'feat/login');
    assert.equal(fs.existsSync(marker), false, 'gather ran the repository\'s core.fsmonitor command');
  } finally {
    cleanup();
    repo.cleanup();
  }
});

test('a diff driver with a textconv command never runs during gather', () => {
  const repo = makeRepo();
  const { script, marker, cleanup } = plant();
  try {
    repo.write('.gitattributes', '*.txt diff=evil\n');
    repo.write('notes.txt', 'one\n');
    repo.commit('chore: base');
    git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
    repo.write('notes.txt', 'one\ntwo\n');
    repo.commit('feat: edit notes');
    appendConfig(repo, `[diff "evil"]\n\ttextconv = ${script}\n`);
    git(repo.dir, 'diff', 'main', 'HEAD');
    assert.equal(fs.existsSync(marker), true, 'control: a plain patch diff runs the planted textconv');
    fs.rmSync(marker);
    const facts = gatherGit({ repo: repo.dir });
    assert.deepEqual(facts.files.map((f) => f.path), ['notes.txt']);
    assert.equal(fs.existsSync(marker), false, 'gather ran the repository\'s textconv command');
  } finally {
    cleanup();
    repo.cleanup();
  }
});

// A tracked file with a same-length edit is stat-dirty at the same size, so `git status` must read its content, and
// reading content runs the clean filter the repository's config names (an unpacked archive leaves every file like this).
// The config goes in after the commits, so the plant does not run while the fixture is built.
function filterRepo(driverName, driverLines) {
  const repo = makeRepo();
  repo.write('.gitattributes', `* filter=${driverName}\n`);
  repo.write('notes.txt', 'two\n');
  repo.commit('chore: base');
  git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
  repo.write('other.txt', 'x\n');
  repo.commit('feat: other');
  appendConfig(repo, `[filter "${driverName}"]\n${driverLines}`);
  repo.write('notes.txt', 'six\n');
  return repo;
}

function assertFilterNeverRuns(driverName, marker, repo) {
  // A process driver that does not speak git's filter protocol makes status fail, but it has run by then.
  try { git(repo.dir, 'status', '--porcelain'); } catch { /* the marker is the control */ }
  assert.equal(fs.existsSync(marker), true, 'control: plain git status runs the planted filter');
  fs.rmSync(marker);
  const facts = gatherGit({ repo: repo.dir });
  assert.equal(facts.dirty, true, 'the same-length edit must still be reported as uncommitted');
  assert.equal(fs.existsSync(marker), false, `gather ran the repository's filter.${driverName} command`);
}

test('a filter driver with a clean command never runs during gather, and a same-length edit is still dirty', () => {
  const { script, marker, cleanup } = plant();
  const lines = `\tclean = ${script}\n`;
  const repo = filterRepo('evil', lines);
  try {
    assertFilterNeverRuns('evil', marker, repo);
  } finally {
    cleanup();
    repo.cleanup();
  }
});

test('a filter driver with a long-running process command never runs during gather', () => {
  const { script, marker, cleanup } = plant();
  const lines = `\tprocess = ${script}\n\tsmudge = ${script}\n\trequired = true\n`;
  const repo = filterRepo('evil', lines);
  try {
    assertFilterNeverRuns('evil', marker, repo);
  } finally {
    cleanup();
    repo.cleanup();
  }
});

test('a filter driver whose name contains dots is switched off too', () => {
  const { script, marker, cleanup } = plant();
  const lines = `\tclean = ${script}\n`;
  const repo = filterRepo('my.evil.clean', lines);
  try {
    assertFilterNeverRuns('my.evil.clean', marker, repo);
  } finally {
    cleanup();
    repo.cleanup();
  }
});

test('a clean repository with no filter drivers still reports not dirty', () => {
  const repo = featureRepo();
  try {
    assert.equal(gatherGit({ repo: repo.dir }).dirty, false);
  } finally {
    repo.cleanup();
  }
});

test('gitEnv drops every GIT_CONFIG_* variable (injected config) and keeps the rest', () => {
  const env = gitEnv({
    PATH: '/usr/bin', HOME: '/home/x', GIT_AUTHOR_NAME: 'A',
    GIT_CONFIG_PARAMETERS: "'core.fsmonitor=/tmp/x'", GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: '/tmp/x',
    GIT_CONFIG_KEY_12: 'k', GIT_CONFIG_VALUE_12: 'v',
  });
  for (const k of ['GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_12', 'GIT_CONFIG_VALUE_12']) {
    assert.equal(Object.hasOwn(env, k), false, k);
  }
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/x');
  assert.equal(env.GIT_AUTHOR_NAME, 'A');
});

test('gitEnv keeps GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM: they are the user\'s own files (safe.directory lives there)', () => {
  const env = gitEnv({ GIT_CONFIG_GLOBAL: '/h/.gitconfig', GIT_CONFIG_SYSTEM: '/etc/gitconfig', GIT_CONFIG_NOSYSTEM: '1' });
  assert.equal(env.GIT_CONFIG_GLOBAL, '/h/.gitconfig');
  assert.equal(env.GIT_CONFIG_SYSTEM, '/etc/gitconfig');
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
});
