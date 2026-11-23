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
const SKIP_WARNING = /own git config defines a filter driver or a git-lfs extension.*skipped the uncommitted-changes check/;

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

// A partial clone whose remote.origin.uploadpack is a planted script, and the control that plain git runs it through a
// lazy fetch. fn gets { clone, marker }. GIT_NO_LAZY_FETCH is honoured from git 2.45.0 (and by the backports 2.39.4, 2.43.4
// and 2.44.1, among others; not by 2.44.0), so the refusal that does not depend on it is proved with `_test.omitLazyFetchEnv`
// (the environment of a git without it).
// form: "clone" (what git writes: remote.<name>.promisor and partialclonefilter), "promisor" (the promisor key alone) or
// "extension" (the older extensions.partialclone key alone).
// remoteBytes: the remote is renamed in the config file to a name that is not valid UTF-8 (byte ff), after the clone.
function withPartialClone(fn, { form = "clone", remoteBytes = false } = {}) {
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
    if (remoteBytes) {
      const file = path.join(clone.dir, '.git', 'config');
      fs.writeFileSync(file, Buffer.from(fs.readFileSync(file).toString('latin1').replaceAll('[remote "origin"]', '[remote "\xff"]'), 'latin1'));
    }
    try { git(clone.dir, 'diff', '--numstat', 'origin/main', 'HEAD'); } catch { /* the marker is the control */ }
    assert.equal(fs.existsSync(marker), true, 'control: plain git diff lazy-fetches through the planted uploadpack');
    fs.rmSync(marker);
    // After the control: a fetch with a filter writes the clone keys back (remote.<name>.promisor, partialclonefilter and
    // extensions.partialclone), so a single-key form has to be cut down once the control has run.
    const unset = (key) => { try { git(clone.dir, 'config', '--unset-all', key); } catch { /* not there */ } };
    if (form !== 'clone') {
      unset('remote.origin.partialclonefilter');
      unset('extensions.partialclone');
    }
    if (form === 'extension') {
      unset('remote.origin.promisor');
      git(clone.dir, 'config', 'extensions.partialclone', 'origin');
    }
    if (form !== 'clone') {
      const listed = git(clone.dir, 'config', '--list').split('\n').filter((l) => /partialclone|promisor/.test(l));
      assert.deepEqual(listed, form === 'promisor' ? ['remote.origin.promisor=true'] : ['extensions.partialclone=origin'], 'the form leaves exactly one key');
    }
    fn({ clone, marker });
  } finally {
    cleanup();
    source.cleanup();
    clone?.cleanup();
  }
}

const PARTIAL_REFUSAL = /this is a partial clone .*full clone/;

test('a partial clone is refused before any object is read, and the lazy fetch never runs (GIT_NO_LAZY_FETCH set)', () => {
  withPartialClone(({ clone, marker }) => {
    assert.throws(() => gatherGit({ repo: clone.dir }), PARTIAL_REFUSAL);
    assert.equal(fs.existsSync(marker), false, 'gather ran remote.origin.uploadpack through a lazy fetch');
  });
});

test('a partial clone is refused by its config alone, for a git that ignores GIT_NO_LAZY_FETCH (before 2.45.0, or 2.44.0)', () => {
  withPartialClone(({ clone, marker }) => {
    assert.throws(() => gatherGit({ repo: clone.dir, _test: { omitLazyFetchEnv: true } }), PARTIAL_REFUSAL);
    assert.equal(fs.existsSync(marker), false, 'the refusal came after a diff had already run the uploadpack');
  });
});

for (const form of ['promisor', 'extension']) {
  test(`a clone with only the ${form} key set is refused too`, () => {
    withPartialClone(({ clone, marker }) => {
      assert.throws(() => gatherGit({ repo: clone.dir, _test: { omitLazyFetchEnv: true } }), PARTIAL_REFUSAL);
      assert.equal(fs.existsSync(marker), false);
    }, { form });
  });
}

test('a repository with no partial-clone keys is not refused', () => {
  const repo = featureRepo();
  try {
    assert.equal(gatherGit({ repo: repo.dir, _test: { omitLazyFetchEnv: true } }).branch, 'feat/login');
  } finally {
    repo.cleanup();
  }
});

// git-lfs runs the repository's own lfs.extension.<name>.clean command from inside a global filter driver, so a global
// filter does not make that safe. git-lfs is not needed here: the check only reads the repository's config. A stub global
// filter keeps the case honest (it would measure dirty if the check did not skip).
function lfsRepo(plantRepo) {
  const repo = makeRepo();
  repo.write('.gitattributes', 'notes.txt filter=up\n');
  repo.write('notes.txt', 'two\n');
  repo.commit('chore: base');
  git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
  repo.write('other.txt', 'x\n');
  repo.commit('feat: other');
  plantRepo(repo);
  repo.write('notes.txt', 'six\n');
  return repo;
}

function withGlobalCat(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-lfsish-'));
  const globalConfig = path.join(dir, 'gitconfig');
  fs.writeFileSync(globalConfig, '[filter "up"]\n\tclean = cat\n');
  const before = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a repository-local lfs.extension.<name> key skips the dirty check even under a global filter', () => {
  const repo = lfsRepo((r) => appendConfig(r, '[lfs "extension.x"]\n\tclean = /bin/true %f\n\tpriority = 0\n'));
  try {
    withGlobalCat(() => {
      const facts = gatherGit({ repo: repo.dir });
      assert.equal(facts.dirty, null);
      assert.ok(facts.warnings.some((w) => SKIP_WARNING.test(w)), facts.warnings.join('\n'));
    });
  } finally {
    repo.cleanup();
  }
});

test('control for the lfs case: the same repository without the extension key measures dirty through the global filter', () => {
  const repo = lfsRepo(() => {});
  try {
    withGlobalCat(() => assert.equal(gatherGit({ repo: repo.dir }).dirty, true));
  } finally {
    repo.cleanup();
  }
});

// git-lfs also reads .lfsconfig from the root of the work tree (or HEAD). Its documentation limits the keys read from
// there to a safe subset, but extensions are not named in it and this is from memory, so the file's presence alone skips the check.
test('a .lfsconfig in the work tree, or only in HEAD, skips the dirty check', () => {
  const inTree = lfsRepo((r) => r.write('.lfsconfig', '[lfs]\n\turl = https://example.invalid/lfs\n'));
  const inHead = makeRepo();
  try {
    withGlobalCat(() => {
      const facts = gatherGit({ repo: inTree.dir });
      assert.equal(facts.dirty, null);
      assert.ok(facts.warnings.some((w) => SKIP_WARNING.test(w)));
    });
    inHead.write('.lfsconfig', '[lfs]\n\turl = https://example.invalid/lfs\n');
    inHead.write('a.txt', 'a\n');
    inHead.commit('chore: base');
    git(inHead.dir, 'checkout', '-q', '-b', 'feat/x');
    inHead.write('b.txt', 'b\n');
    inHead.commit('feat: b');
    inHead.remove('.lfsconfig');
    assert.equal(gatherGit({ repo: inHead.dir }).dirty, null, 'removed from the work tree but still in HEAD');
  } finally {
    inTree.cleanup();
    inHead.cleanup();
  }
});

// A named pipe where git reads a file blocks git for good: gather stops it after a time limit and says so.
const mkfifo = (file) => spawnSync('mkfifo', [file]).status === 0;

test('a named pipe at .gitattributes stops gather with a one-line error instead of hanging', (t) => {
  const repo = featureRepo();
  try {
    if (!mkfifo(path.join(repo.dir, '.gitattributes'))) return t.skip('mkfifo is not available here');
    assert.throws(() => gatherGit({ repo: repo.dir, _test: { timeoutMs: 1500 } }), /git did not finish within 1\.5 seconds/);
  } finally {
    repo.cleanup();
  }
});

test('a named pipe at .mailmap does not stop gather (git log reads no mailmap)', (t) => {
  const repo = featureRepo();
  try {
    if (!mkfifo(path.join(repo.dir, '.mailmap'))) return t.skip('mkfifo is not available here');
    assert.equal(gatherGit({ repo: repo.dir, _test: { timeoutMs: 5000 } }).branch, 'feat/login');
  } finally {
    repo.cleanup();
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

test('gitEnv sets LC_ALL to C over an inherited locale', () => {
  const env = gitEnv({ PATH: '/usr/bin', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' });
  assert.equal(env.LC_ALL, 'C');
  assert.equal(env.PATH, '/usr/bin');
});

// ---- Config that git's own key matcher cannot read -----------------------------------------------------------------
// In a UTF-8 locale `git config --get-regexp` fails with exit 1 and no output on a key whose subsection is not valid
// UTF-8 (the old check read that as "no match"). gather now lists the whole config as bytes and decides in JavaScript.
// Each case runs with LANG and LC_ALL set in the parent environment, which the control git sees too.
function withLocale(lang, fn) {
  const before = { LANG: process.env.LANG, LC_ALL: process.env.LC_ALL };
  process.env.LANG = lang;
  process.env.LC_ALL = lang;
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const bytes = (...parts) => Buffer.concat(parts.map((p) => Buffer.from(p)));
const NAMES = { 'byte ff': [0xff], 'byte c3': [0xc3], 'ASCII control 1f': [0x1f] };

// Where a filter or hook section is planted: the repository's config, a file it includes, or config.worktree.
const ROUTES = {
  config: (repo, section) => appendConfig(repo, section),
  include: (repo, section) => {
    fs.writeFileSync(path.join(repo.dir, 'extra.cfg'), section);
    appendConfig(repo, '[include]\n\tpath = ../extra.cfg\n');
  },
  worktree: (repo, section) => {
    appendConfig(repo, '[extensions]\n\tworktreeConfig = true\n');
    fs.writeFileSync(path.join(repo.dir, '.git', 'config.worktree'), section);
  },
};

function byteNamedRepo(attributes, section, route = 'config') {
  const repo = makeRepo();
  repo.write('.gitattributes', attributes);
  repo.write('notes.txt', 'two\n');
  repo.commit('chore: base');
  git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
  repo.write('other.txt', 'x\n');
  repo.commit('feat: other');
  ROUTES[route](repo, section);
  return repo;
}

function byteFilterCase(title, lang, name, route) {
  test(title, () => withLocale(lang, () => {
    const { marker, script, cleanup } = plant();
    const repo = byteNamedRepo(bytes('* filter=', name, '\n'), bytes('[filter "', name, '"]\n\tclean = ', script, '\n'), route);
    try {
      repo.write('notes.txt', 'six\n');
      assertFilterSkipped('with a name that is not plain text', marker, repo);
    } finally {
      cleanup();
      repo.cleanup();
    }
  }));
}

for (const [label, name] of Object.entries(NAMES)) {
  byteFilterCase(`a filter driver named with ${label} never runs during gather (en_US.UTF-8)`, 'en_US.UTF-8', name);
}
byteFilterCase('a filter driver named with byte ff never runs during gather (C.UTF-8)', 'C.UTF-8', NAMES['byte ff']);
byteFilterCase('a filter driver named with byte ff, reached through include.path, never runs during gather', 'en_US.UTF-8', NAMES['byte ff'], 'include');
byteFilterCase('a filter driver named with byte c3, in config.worktree, never runs during gather', 'en_US.UTF-8', NAMES['byte c3'], 'worktree');

// hook.<name>.command runs on git 2.54.0 (measured). Older releases were not checked; they are treated as not having it,
// which only skips the control, never the gather assertions.
function gitHasHookConfig() {
  const [major, minor] = (/git version (\d+)\.(\d+)/.exec(spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout) ?? []).slice(1).map(Number);
  return major > 2 || (major === 2 && minor >= 54);
}

function hookCase(title, name, route) {
  test(title, () => withLocale('en_US.UTF-8', () => {
    const { marker, script, cleanup } = plant();
    const repo = byteNamedRepo('', bytes('[hook "', name, '"]\n\tevent = post-index-change\n\tcommand = ', script, '\n'), route);
    const notes = path.join(repo.dir, 'notes.txt');
    const touch = (seconds) => fs.utimesSync(notes, Date.now() / 1000 + seconds, Date.now() / 1000 + seconds);
    try {
      // `git status` rewrites the index when only a file's stat data changed, which runs post-index-change. The control is a
      // plain spawn (the test helper passes core.hooksPath=/dev/null, which would switch the plant off). A git that has no
      // hook.<name>.command (before 2.54) does not run it: the control is asserted only where this git has the feature.
      touch(60);
      spawnSync('git', ['status', '--porcelain'], { cwd: repo.dir, env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull } });
      if (gitHasHookConfig()) assert.equal(fs.existsSync(marker), true, 'control: plain git status runs the planted hook command');
      fs.rmSync(marker, { force: true });
      touch(120);
      const facts = gatherGit({ repo: repo.dir });
      assert.equal(fs.existsSync(marker), false, 'gather ran the repository\'s hook');
      assert.equal(facts.dirty, null, 'the dirty check is skipped for hook.*');
      assert.ok(facts.warnings.some((w) => SKIP_WARNING.test(w)), facts.warnings.join('\n'));
    } finally {
      cleanup();
      repo.cleanup();
    }
  }));
}

hookCase('a hook.<name> command never runs during gather', 'evil');
hookCase('a hook.<name> command with a name that is not valid UTF-8 never runs during gather', NAMES['byte ff']);
hookCase('a hook.<name> command in config.worktree never runs during gather', 'evil', 'worktree');

test('a repository-local lfs.extension key in mixed case skips the dirty check', () => withLocale('en_US.UTF-8', () => {
  const repo = lfsRepo((r) => appendConfig(r, '[lfs "Extension.X"]\n\tclean = /bin/true %f\n'));
  try {
    withGlobalCat(() => {
      const facts = gatherGit({ repo: repo.dir });
      assert.equal(facts.dirty, null);
      assert.ok(facts.warnings.some((w) => SKIP_WARNING.test(w)), facts.warnings.join('\n'));
    });
  } finally {
    repo.cleanup();
  }
}));

// git-lfs reads `git config -l` line by line, so a value with a line break can forge a line that names an extension.
test('a repository-owned value with a line break that names lfs.extension skips the dirty check', () => withLocale('en_US.UTF-8', () => {
  const repo = lfsRepo((r) => appendConfig(r, '[core]\n\tnotes = "x\\nlfs.extension.evil.clean=/bin/true %f"\n'));
  try {
    const lines = git(repo.dir, 'config', '-l').split('\n');
    assert.ok(lines.some((l) => l.startsWith('lfs.extension.evil.clean=')), 'control: a line-by-line reader sees an lfs extension');
    withGlobalCat(() => {
      const facts = gatherGit({ repo: repo.dir });
      assert.equal(facts.dirty, null);
      assert.ok(facts.warnings.some((w) => SKIP_WARNING.test(w)), facts.warnings.join('\n'));
    });
  } finally {
    repo.cleanup();
  }
}));

test('a global-only filter driver with a name that is not valid UTF-8 is left alone: dirty is measured through it', () => withLocale('en_US.UTF-8', () => {
  const repo = makeRepo();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-global-bytes-'));
  const globalConfig = path.join(dir, 'gitconfig');
  fs.writeFileSync(globalConfig, bytes('[filter "', NAMES['byte ff'], '"]\n\tclean = tr a-z A-Z\n'));
  const plainStatus = () => spawnSync('git', ['status', '--porcelain'], {
    cwd: repo.dir, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_SYSTEM: os.devNull },
  }).stdout.trim();
  const before = process.env.GIT_CONFIG_GLOBAL;
  try {
    repo.write('.gitattributes', bytes('notes.txt filter=', NAMES['byte ff'], '\n'));
    repo.write('notes.txt', 'TWO\n');
    repo.commit('chore: base');
    git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
    repo.write('other.txt', 'x\n');
    repo.commit('feat: other');
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    repo.write('notes.txt', 'two\n');
    assert.equal(plainStatus(), '', 'control: through the global filter the file is unchanged');
    const same = gatherGit({ repo: repo.dir });
    assert.equal(same.dirty, false, 'a global driver made gather skip or blank the check');
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
}));

test('a partial clone whose remote name is not valid UTF-8 is refused, and the lazy fetch never runs (LANG and LC_ALL set)', () => withLocale('en_US.UTF-8', () => {
  withPartialClone(({ clone, marker }) => {
    assert.throws(() => gatherGit({ repo: clone.dir, _test: { omitLazyFetchEnv: true } }), PARTIAL_REFUSAL);
    assert.equal(fs.existsSync(marker), false, 'gather ran the planted uploadpack through a lazy fetch');
  }, { remoteBytes: true });
}));

test('the same refusal under C.UTF-8', () => withLocale('C.UTF-8', () => {
  withPartialClone(({ clone, marker }) => {
    assert.throws(() => gatherGit({ repo: clone.dir, _test: { omitLazyFetchEnv: true } }), PARTIAL_REFUSAL);
    assert.equal(fs.existsSync(marker), false);
  }, { remoteBytes: true });
}));

// A stand-in `git` first on PATH: it runs `before(dir)` (a shell fragment), then the real git.
function withGitStub(before, fn) {
  const real = process.env.PATH.split(path.delimiter).map((d) => path.join(d, 'git')).find((p) => fs.existsSync(p));
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-stub-')));
  fs.writeFileSync(path.join(dir, 'git'), `#!/bin/sh\n${before(dir)}\nexec '${real}' "$@"\n`);
  fs.chmodSync(path.join(dir, 'git'), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${saved}`;
  try {
    return fn(dir);
  } finally {
    process.env.PATH = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The nth `git config --show-scope` call prints `output` (a printf format) and exits with `code`; every other call runs the real git.
const brokenListing = (nth, code, output = '') => (dir) => `case "$*" in *--show-scope*)
  n=$(cat '${dir}/n' 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > '${dir}/n'
  if [ "$n" -eq ${nth} ]; then printf '${output}'; exit ${code}; fi;;
esac`;

test('every git call carries -c core.hooksPath=/dev/null and -c safe.bareRepository=explicit', () => {
  const repo = featureRepo();
  try {
    withGitStub((dir) => `printf '%s\\n' "$*" >> '${dir}/calls'`, (dir) => {
      assert.equal(gatherGit({ repo: repo.dir }).branch, 'feat/login');
      const calls = fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n');
      assert.ok(calls.length >= 10, `only ${calls.length} git calls were seen`);
      for (const call of calls) {
        assert.ok(call.includes(`-c core.hooksPath=${os.devNull}`), `no hooksPath override: ${call}`);
        assert.ok(call.includes('-c safe.bareRepository=explicit'), `no bareRepository override: ${call}`);
      }
    });
  } finally {
    repo.cleanup();
  }
});

// Fail closed: a listing that cannot be read is never "no match".
test('a config listing that exits 1 with no output (what the matcher failure looked like) is refused, not read as no match', () => {
  const repo = featureRepo();
  try {
    withGitStub(brokenListing(1, 1), () => assert.throws(() => gatherGit({ repo: repo.dir }), /cannot read the git config/));
  } finally {
    repo.cleanup();
  }
});

test('a well-formed config listing with no core.repositoryformatversion of its own is refused', () => {
  const repo = featureRepo();
  try {
    withGitStub(brokenListing(1, 0, 'local\\0user.name\\nx\\0global\\0core.repositoryformatversion\\n0\\0'), () => assert.throws(() => gatherGit({ repo: repo.dir }), /cannot read the git config/));
  } finally {
    repo.cleanup();
  }
});

for (const [label, code, output] of [['exits 1 with no output', 1, ''], ['has an odd field count', 0, 'junk\\0']]) {
  test(`when the second config listing ${label}, the dirty check is skipped (dirty is null)`, () => {
    const repo = featureRepo();
    try {
      withGitStub(brokenListing(2, code, output), () => {
        const facts = gatherGit({ repo: repo.dir });
        assert.equal(facts.dirty, null);
        assert.ok(facts.warnings.some((w) => SKIP_WARNING.test(w)), facts.warnings.join('\n'));
      });
    } finally {
      repo.cleanup();
    }
  });
}

// Repositories whose config is laid out differently must still pass, because make-explainer runs in them every day.
test('gather works in a linked worktree and measures dirty there', () => {
  const repo = featureRepo();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-linked-')));
  const linked = path.join(root, 'wt');
  try {
    git(repo.dir, 'worktree', 'add', '-q', '-b', 'feat/wt', linked);
    const clean = gatherGit({ repo: linked });
    assert.equal(clean.branch, 'feat/wt');
    assert.equal(clean.dirty, false);
    fs.writeFileSync(path.join(linked, 'new.txt'), 'x\n');
    assert.equal(gatherGit({ repo: linked }).dirty, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    repo.cleanup();
  }
});

test('gather works in a linked worktree under extensions.worktreeConfig with a config.worktree of its own', () => {
  const repo = featureRepo();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-linked-')));
  const linked = path.join(root, 'wt');
  try {
    git(repo.dir, 'config', 'extensions.worktreeConfig', 'true');
    git(repo.dir, 'worktree', 'add', '-q', '-b', 'feat/wt', linked);
    git(linked, 'config', '--worktree', 'user.nickname', 'wt');
    assert.equal(git(linked, 'config', '--show-scope', '--get', 'user.nickname'), 'worktree\twt', 'control: the key is in the worktree scope');
    const facts = gatherGit({ repo: linked });
    assert.equal(facts.dirty, false);
    assert.deepEqual(facts.warnings.filter((w) => SKIP_WARNING.test(w)), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    repo.cleanup();
  }
});

test('gather works inside a submodule checkout', () => {
  const sub = makeRepo();
  const repo = makeRepo();
  try {
    sub.write('notes.txt', 'two\n');
    sub.commit('chore: sub base');
    repo.write('README.md', '# demo\n');
    repo.commit('chore: base');
    git(repo.dir, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', `file://${sub.dir}`, 'vendor');
    repo.commit('chore: add submodule');
    const inner = path.join(repo.dir, 'vendor');
    assert.ok(fs.statSync(path.join(inner, '.git')).isFile(), 'control: a submodule checkout has a .git file, not a folder');
    const facts = gatherGit({ repo: inner, base: 'HEAD' });
    assert.equal(facts.repo, 'vendor');
    assert.equal(facts.dirty, false);
  } finally {
    sub.cleanup();
    repo.cleanup();
  }
});

test('gather works in a sha256 repository', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-sha256-')));
  try {
    try {
      git(dir, 'init', '-q', '-b', 'main', '--object-format=sha256');
    } catch {
      return t.skip('this git cannot make a sha256 repository');
    }
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'chore: base');
    git(dir, 'checkout', '-q', '-b', 'feat/x');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'feat: b');
    const facts = gatherGit({ repo: dir });
    assert.equal(facts.commits.length, 1);
    assert.equal(facts.commits[0].sha.length, 64);
    assert.equal(facts.dirty, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('non-ASCII paths and subjects come back exact in a UTF-8 locale', () => withLocale('en_US.UTF-8', () => {
  const repo = makeRepo();
  try {
    repo.write('README.md', '# demo\n');
    repo.commit('chore: base');
    git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
    repo.write('café/日本語 ü.txt', 'x\n');
    repo.commit('feat: 日本語 ünïcode ✓ "quoted"');
    const facts = gatherGit({ repo: repo.dir });
    assert.deepEqual(facts.files.map((f) => f.path), ['café/日本語 ü.txt']);
    assert.equal(facts.commits[0].subject, 'feat: 日本語 ünïcode ✓ "quoted"');
  } finally {
    repo.cleanup();
  }
}));
