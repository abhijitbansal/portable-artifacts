// gather runs git inside a repository that may not be the user's own. A repository's own config must not be able to
// run a command through a read-only gather: core.fsmonitor (run by `git status`), a diff driver's textconv and a filter driver's clean, smudge or process command.
// Each test first proves with plain git that the planted config really runs the script, so a pass means gather
// switched it off and not that the plant was wrong. Built-ins only; no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gatherGit, gitEnv } from '../scripts/lib/git.mjs';
import { makeRepo, cloneRepo, featureRepo, git } from './helpers/repo.mjs';

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
// gather does not enumerate and blank such drivers: when the repository's own config names any filter it skips the
// uncommitted-changes check (`dirty: null`, plus a warning). The config goes in after the commits, so the plant does not
// run while the fixture is built.
const SKIP_WARNING = /own git config defines a filter driver; skipped the uncommitted-changes check/;

function addDriver(repo, name, lines) {
  appendConfig(repo, `[filter "${name}"]\n${lines}`);
}

function filterRepo(driverName, driverLines, plantDriver = addDriver) {
  const repo = makeRepo();
  repo.write('.gitattributes', `* filter=${driverName}\n`);
  repo.write('notes.txt', 'two\n');
  repo.commit('chore: base');
  git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
  repo.write('other.txt', 'x\n');
  repo.commit('feat: other');
  plantDriver(repo, driverName, driverLines);
  repo.write('notes.txt', 'six\n');
  return repo;
}

// A process driver that does not speak git's filter protocol makes status fail, but it has run by then.
function plainStatusRuns(repo, marker) {
  try { git(repo.dir, 'status', '--porcelain'); } catch { /* the marker is the control */ }
  assert.equal(fs.existsSync(marker), true, 'control: plain git status runs the planted filter');
  fs.rmSync(marker);
}

function assertFilterSkipped(driverName, marker, repo) {
  plainStatusRuns(repo, marker);
  const facts = gatherGit({ repo: repo.dir });
  assert.equal(fs.existsSync(marker), false, `gather ran the repository's filter.${driverName} command`);
  assert.equal(facts.dirty, null, 'the dirty check is skipped, so dirty is unknown');
  assert.ok(facts.warnings.some((w) => SKIP_WARNING.test(w)), facts.warnings.join('\n'));
}

function filterCase(title, name, lines, plantDriver) {
  test(title, () => {
    const { marker, script, cleanup } = plant();
    const repo = filterRepo(name, lines(script), plantDriver);
    try {
      assertFilterSkipped(name, marker, repo);
    } finally {
      cleanup();
      repo.cleanup();
    }
  });
}

filterCase('a repository-local filter driver with a clean command never runs during gather', 'evil', (s) => `\tclean = ${s}\n`);
filterCase('a filter driver with a long-running process command never runs during gather', 'evil', (s) => `\tprocess = ${s}\n\tsmudge = ${s}\n\trequired = true\n`);
filterCase('a filter driver whose name contains dots never runs during gather', 'my.evil.clean', (s) => `\tclean = ${s}\n`);
filterCase('a filter driver whose name contains "=" never runs during gather', 'a=b', (s) => `\tclean = ${s}\n`);
filterCase('a filter driver with an empty name never runs during gather', '', (s) => `\tclean = ${s}\n`);
filterCase('a filter driver reached through include.path never runs during gather', 'evil', (s) => `\tclean = ${s}\n`, (repo, name, lines) => {
  fs.writeFileSync(path.join(repo.dir, 'extra.cfg'), `[filter "${name}"]\n${lines}`);
  appendConfig(repo, '[include]\n\tpath = ../extra.cfg\n');
});
filterCase('a filter driver in config.worktree (extensions.worktreeConfig) never runs during gather', 'evil', (s) => `\tclean = ${s}\n`, (repo, name, lines) => {
  appendConfig(repo, '[extensions]\n\tworktreeConfig = true\n');
  fs.writeFileSync(path.join(repo.dir, '.git', 'config.worktree'), `[filter "${name}"]\n${lines}`);
});

test('a GIT_CONFIG variable in the environment does not hide the repository\'s filter from the check', () => {
  const { marker, script, cleanup } = plant();
  const repo = filterRepo('evil', `\tclean = ${script}\n`);
  const empty = path.join(path.dirname(marker), 'empty.cfg');
  fs.writeFileSync(empty, '');
  try {
    plainStatusRuns(repo, marker);
    process.env.GIT_CONFIG = empty;
    const facts = gatherGit({ repo: repo.dir });
    assert.equal(fs.existsSync(marker), false, 'gather ran the filter while GIT_CONFIG pointed at an empty file');
    assert.equal(facts.dirty, null);
  } finally {
    delete process.env.GIT_CONFIG;
    cleanup();
    repo.cleanup();
  }
});

test('a submodule whose own config defines a filter is not entered by the dirty check', () => {
  const { marker, script, cleanup } = plant();
  const sub = makeRepo();
  const repo = makeRepo();
  try {
    sub.write('notes.txt', 'two\n');
    sub.commit('chore: sub base');
    repo.write('README.md', '# demo\n');
    repo.commit('chore: base');
    git(repo.dir, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', `file://${sub.dir}`, 'vendor');
    repo.commit('chore: add submodule');
    git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
    repo.write('other.txt', 'x\n');
    repo.commit('feat: other');
    const inner = path.join(repo.dir, 'vendor');
    fs.appendFileSync(path.join(git(inner, 'rev-parse', '--absolute-git-dir'), 'config'), `[filter "evil"]\n\tclean = ${script}\n`);
    fs.writeFileSync(path.join(inner, '.gitattributes'), '* filter=evil\n');
    fs.writeFileSync(path.join(inner, 'notes.txt'), 'six\n');
    plainStatusRuns(repo, marker);
    const facts = gatherGit({ repo: repo.dir });
    assert.equal(fs.existsSync(marker), false, 'gather ran the submodule\'s filter');
    assert.equal(facts.dirty, false, 'submodule contents are not counted');
  } finally {
    cleanup();
    sub.cleanup();
    repo.cleanup();
  }
});

test('a partial clone never lets the repository\'s remote.origin.uploadpack run through a lazy fetch', () => {
  const { marker, cleanup } = plant();
  const source = makeRepo();
  let clone;
  try {
    source.write('notes.txt', 'one\n');
    source.commit('chore: base');
    git(source.dir, 'checkout', '-q', '-b', 'feat/x');
    source.write('notes.txt', 'one\ntwo\n');
    source.commit('feat: edit');
    git(source.dir, 'config', 'uploadpack.allowFilter', 'true');
    git(source.dir, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    clone = cloneRepo(source, '--filter=blob:none');
    const fail = path.join(path.dirname(marker), 'upload.sh');
    fs.writeFileSync(fail, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
    fs.chmodSync(fail, 0o755);
    appendConfig(clone, `[remote "origin"]\n\tuploadpack = ${fail}\n`);
    try { git(clone.dir, 'diff', '--numstat', 'origin/main', 'HEAD'); } catch { /* the marker is the control */ }
    assert.equal(fs.existsSync(marker), true, 'control: plain git diff lazy-fetches through the planted uploadpack');
    fs.rmSync(marker);
    assert.throws(() => gatherGit({ repo: clone.dir }), /cannot read the changed files/);
    assert.equal(fs.existsSync(marker), false, 'gather ran remote.origin.uploadpack through a lazy fetch');
  } finally {
    cleanup();
    source.cleanup();
    clone?.cleanup();
  }
});

// A driver from the user's own global config (git-lfs installs filter.lfs.*) is the user's choice, not the repository's:
// it stays active, so a touched file that the filter makes equal to the index is not reported as modified.
test('a global-only filter driver is left alone: no skip, and dirty is measured through the filter', () => {
  const repo = makeRepo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-global-'));
  const globalConfig = path.join(dir, 'gitconfig');
  fs.writeFileSync(globalConfig, '[filter "up"]\n\tclean = tr a-z A-Z\n');
  const plainStatus = () => spawnSync('git', ['status', '--porcelain'], {
    cwd: repo.dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: os.devNull },
  }).stdout.trim();
  const before = process.env.GIT_CONFIG_GLOBAL;
  try {
    repo.write('.gitattributes', 'notes.txt filter=up\n');
    repo.write('notes.txt', 'TWO\n');
    repo.commit('chore: base');
    git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
    repo.write('other.txt', 'x\n');
    repo.commit('feat: other');
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    repo.write('notes.txt', 'two\n');
    assert.equal(plainStatus(), '', 'control: through the global filter the file is unchanged');
    const same = gatherGit({ repo: repo.dir });
    assert.equal(same.dirty, false, 'gather blanked the global filter and saw a change that is not there');
    assert.deepEqual(same.warnings, []);
    repo.write('notes.txt', 'six\n');
    assert.notEqual(plainStatus(), '', 'control: a real change shows');
    assert.equal(gatherGit({ repo: repo.dir }).dirty, true);
  } finally {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = before;
    fs.rmSync(dir, { recursive: true, force: true });
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

test('gitEnv drops the legacy GIT_CONFIG variable and turns lazy fetching off', () => {
  const env = gitEnv({ PATH: '/usr/bin', GIT_CONFIG: '/tmp/empty.cfg' });
  assert.equal(Object.hasOwn(env, 'GIT_CONFIG'), false);
  assert.equal(env.GIT_NO_LAZY_FETCH, '1');
  assert.equal(gitEnv({ GIT_NO_LAZY_FETCH: '0' }).GIT_NO_LAZY_FETCH, '1', 'an inherited 0 must not re-enable it');
});

test('gitEnv keeps GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM: they are the user\'s own files (safe.directory lives there)', () => {
  const env = gitEnv({ GIT_CONFIG_GLOBAL: '/h/.gitconfig', GIT_CONFIG_SYSTEM: '/etc/gitconfig', GIT_CONFIG_NOSYSTEM: '1' });
  assert.equal(env.GIT_CONFIG_GLOBAL, '/h/.gitconfig');
  assert.equal(env.GIT_CONFIG_SYSTEM, '/etc/gitconfig');
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
});
