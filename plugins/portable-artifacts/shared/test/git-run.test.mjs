// The shared git runner: the environment, the config overrides, the PATH rule and the error words. These tests feed it
// plain objects and a fake `spawn`; the tests that run real git on planted repositories are beside each caller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hardenedGitEnv, gitBaseArgs, absolutePathEntries, spawnGit, gitErrorMessage, listConfig, REDIRECTING_ENV,
  GIT_TIMEOUT_MS, SCRATCH_TIMEOUT_MS, LISTING_MAX_BUFFER,
} from '../git-run.mjs';
import { tmpDir, cleanUp } from './helpers/git-plants.mjs';

test('the limits: 60 s for git calls, 5 s for the scratch note, 16 MiB for a config listing', () => {
  assert.equal(GIT_TIMEOUT_MS, 60000);
  assert.equal(SCRATCH_TIMEOUT_MS, 5000);
  assert.equal(LISTING_MAX_BUFFER, 16 * 1024 * 1024);
});

test('every variable that points git elsewhere is in the redirecting set', () => {
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR',
    'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG',
    'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE', 'GIT_REPLACE_REF_BASE', 'GIT_ATTR_SOURCE', 'GIT_REFERENCE_BACKEND', 'GIT_IMPLICIT_WORK_TREE', 'GIT_PREFIX']) {
    assert.ok(REDIRECTING_ENV.has(k), k);
  }
});

test('the environment drops the redirecting variables, the config pairs and the pathspec switches, and keeps the rest', () => {
  const env = hardenedGitEnv({
    PATH: '/usr/bin', HOME: '/h', GIT_AUTHOR_NAME: 'A', GIT_CONFIG_GLOBAL: '/h/.gitconfig', GIT_CONFIG_SYSTEM: '/etc/gitconfig', GIT_EXTERNAL_DIFF: 'x',
    GIT_DIR: '/x', GIT_CONFIG_KEY_3: 'k', GIT_CONFIG_VALUE_3: 'v', GIT_ICASE_PATHSPECS: '1', GIT_NOGLOB_PATHSPECS: '1', GIT_PREFIX: 'sub/',
  });
  for (const k of ['GIT_DIR', 'GIT_CONFIG_KEY_3', 'GIT_CONFIG_VALUE_3', 'GIT_ICASE_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_PREFIX']) assert.equal(Object.hasOwn(env, k), false, k);
  assert.deepEqual([env.HOME, env.GIT_AUTHOR_NAME, env.GIT_CONFIG_GLOBAL, env.GIT_CONFIG_SYSTEM, env.GIT_EXTERNAL_DIFF], ['/h', 'A', '/h/.gitconfig', '/etc/gitconfig', 'x']);
});

test('no prompts, no optional locks, lazy fetching off over an inherited 0, and LC_ALL=C over an inherited locale', () => {
  const env = hardenedGitEnv({ PATH: '/usr/bin', GIT_NO_LAZY_FETCH: '0', GIT_OPTIONAL_LOCKS: '1', LC_ALL: 'de_DE.UTF-8' });
  assert.deepEqual([env.GIT_NO_LAZY_FETCH, env.GIT_OPTIONAL_LOCKS, env.GIT_TERMINAL_PROMPT, env.LC_ALL], ['1', '0', '0', 'C']);
});

test('options: the user\'s config can be nulled, the lazy-fetch variable left out, the locale kept', () => {
  const nulled = hardenedGitEnv({ PATH: '/usr/bin', GIT_CONFIG_GLOBAL: '/h/.gitconfig' }, { nullUserConfig: true });
  assert.deepEqual([nulled.GIT_CONFIG_GLOBAL, nulled.GIT_CONFIG_SYSTEM], [os.devNull, os.devNull]);
  assert.equal(Object.hasOwn(hardenedGitEnv({ PATH: '/usr/bin', GIT_NO_LAZY_FETCH: '1' }, { omitLazyFetchEnv: true }), 'GIT_NO_LAZY_FETCH'), false);
  assert.equal(hardenedGitEnv({ LC_ALL: 'de_DE.UTF-8' }, { keepLocale: true }).LC_ALL, 'de_DE.UTF-8');
  assert.equal(Object.hasOwn(hardenedGitEnv({}, { keepLocale: true }), 'LC_ALL'), false);
});

test('PATH keeps only absolute entries: relative ones, empty ones and "." are dropped', () => {
  const posix = (value) => hardenedGitEnv({ PATH: value }, { platform: 'linux' }).PATH;
  assert.equal(posix('/usr/bin:/bin'), '/usr/bin:/bin');
  assert.equal(posix('.:/usr/bin'), '/usr/bin');
  assert.equal(posix(':/usr/bin'), '/usr/bin', 'a leading empty entry means the current folder');
  assert.equal(posix('/usr/bin::/bin:'), '/usr/bin:/bin', 'so do a middle and a trailing one');
  assert.equal(posix('node_modules/.bin:/usr/bin:../x'), '/usr/bin');
  assert.equal(posix('.:node_modules/.bin'), '', 'nothing absolute is left: the empty string, never a missing PATH');
  assert.equal(posix(''), '');
});

test('on Windows the variable may be spelled Path, the delimiter is ;, and a drive-relative entry is dropped', () => {
  const env = hardenedGitEnv({ Path: 'C:\\Windows;.;git\\bin;D:\\Git\\cmd;;C:rel', PATH: 'C:\\other', HOME: 'C:\\h' }, { platform: 'win32' });
  assert.equal(env.Path, 'C:\\Windows;D:\\Git\\cmd');
  assert.equal(Object.hasOwn(env, 'PATH'), false, 'one spelling survives');
  assert.equal(env.HOME, 'C:\\h');
  assert.equal(hardenedGitEnv({ path: '.;sub' }, { platform: 'win32' }).path, '');
});

test('on Linux a variable spelled Path is an ordinary variable, not the search path', () => {
  const env = hardenedGitEnv({ Path: '.', PATH: '/usr/bin' }, { platform: 'linux' });
  assert.equal(env.Path, '.');
  assert.equal(env.PATH, '/usr/bin');
});

test('an environment with no PATH at all is left without one (the system default applies)', () => {
  assert.equal(Object.hasOwn(hardenedGitEnv({ HOME: 'x' }), 'PATH'), false);
  assert.deepEqual(absolutePathEntries('/a:/b', 'linux'), ['/a', '/b']);
});

test('the base arguments carry the fsmonitor and hooks overrides, and the bare-repository rule unless a caller opts out', () => {
  const joined = (args) => args.join(' ');
  assert.ok(joined(gitBaseArgs()).includes('-c core.fsmonitor=false'));
  assert.ok(joined(gitBaseArgs()).includes(`-c core.hooksPath=${os.devNull}`));
  assert.ok(joined(gitBaseArgs()).includes('-c safe.bareRepository=explicit'));
  assert.ok(gitBaseArgs().includes('--no-pager'));
  assert.ok(!joined(gitBaseArgs({ bareExplicit: false })).includes('safe.bareRepository'));
  assert.ok(joined(gitBaseArgs({ bareExplicit: false })).includes('core.fsmonitor=false'));
});

test('spawnGit spawns git with the folder, the limits and the environment it was given', () => {
  const seen = [];
  const out = spawnGit('/r', ['log'], { env: { PATH: '/usr/bin' }, timeoutMs: 1234, maxBuffer: 99, raw: true, spawn: (...a) => { seen.push(a); return { status: 0, stdout: Buffer.alloc(0) }; } });
  assert.equal(out.status, 0);
  assert.deepEqual(seen[0].slice(0, 2), ['git', ['log']]);
  assert.deepEqual(seen[0][2], { cwd: '/r', encoding: 'buffer', env: { PATH: '/usr/bin' }, maxBuffer: 99, timeout: 1234, killSignal: 'SIGKILL' });
});

test('spawnGit with an empty PATH does not spawn: git is not found', () => {
  let spawned = false;
  const r = spawnGit('/r', ['log'], { env: { PATH: '' }, timeoutMs: 1, spawn: () => { spawned = true; return {}; } });
  assert.equal(spawned, false);
  assert.equal(r.error.code, 'ENOENT');
  assert.equal(spawnGit('/r', ['log'], { env: { Path: '' }, timeoutMs: 1, platform: 'win32', spawn: () => { spawned = true; return {}; } }).error.code, 'ENOENT');
  assert.equal(spawned, false);
});

test('error words: a timeout, a missing git, an over-size output, anything else', () => {
  const words = (code) => gitErrorMessage({ code }, { cwd: '/r', timeoutMs: 1500, bufferText: 'too big' });
  assert.match(words('ETIMEDOUT'), /git did not finish within 1\.5 seconds in \/r and was stopped/);
  assert.match(words('ENOENT'), /git is not installed or not on PATH/);
  assert.equal(words('ENOBUFS'), 'too big');
  assert.equal(words('EACCES'), 'cannot run git: EACCES');
  assert.equal(gitErrorMessage(new Error('boom'), { cwd: '/r', timeoutMs: 1 }), 'cannot run git: boom');
});

test('listConfig asks for the listing once, with the 16 MiB limit, and returns bytes, or null when git failed', () => {
  const calls = [];
  const spawn = (result) => (...a) => { calls.push(a); return result; };
  const ok = Buffer.from('local\0a.b\nc\0');
  const run = (result) => listConfig('/r', { base: ['-c', 'x=y'], env: { PATH: '/usr/bin' }, timeoutMs: 10, spawn: spawn(result) });
  assert.equal(run({ status: 0, stdout: ok }), ok);
  assert.equal(run({ status: 1, stdout: ok }), null, 'a listing from a git that exited 1 is not trusted');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0][1], ['-c', 'x=y', 'config', '--list', '--includes', '--show-scope', '-z']);
  assert.equal(calls[0][2].maxBuffer, 16 * 1024 * 1024);
  assert.equal(calls[0][2].encoding, 'buffer');
});

// ---- an absolute PATH entry inside the repository git is started in -------------------------------------------------------------
// <root>/repo (a .git folder; sub/, node_modules/.bin), <root>/repo2/bin (a sibling whose name starts like the repository's),
// <root>/tools (outside), <root>/plain (no .git anywhere above it).
function folders() {
  const root = tmpDir('pa-run-');
  for (const dir of ['repo/.git', 'repo/sub', 'repo/node_modules/.bin', 'repo2/bin', 'tools', 'plain/bin']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  return { root, at: (...parts) => path.join(root, ...parts), cleanup: () => cleanUp(root) };
}

/** The PATH value spawnGit hands to spawn when git is started in `cwd` with these entries. */
function pathSeen(cwd, entries, extra = {}) {
  let seen = 'not spawned';
  const env = { PATH: entries.join(path.delimiter) };
  const result = spawnGit(cwd, ['log'], { env, timeoutMs: 1, spawn: (_cmd, _args, opts) => { seen = opts.env.PATH; return { status: 0 }; }, ...extra });
  return { seen, result, env };
}

test('spawnGit drops an absolute PATH entry inside the repository, from its root and from a subfolder, and keeps the others', () => {
  const f = folders();
  try {
    const entries = [f.at('repo', 'node_modules', '.bin'), f.at('tools'), f.at('repo', 'sub')];
    for (const cwd of [f.at('repo'), f.at('repo', 'sub')]) assert.equal(pathSeen(cwd, entries).seen, f.at('tools'), cwd);
    assert.equal(pathSeen(f.at('repo'), [f.at('repo')]).result.error.code, 'ENOENT', 'the repository folder itself is inside it');
  } finally {
    f.cleanup();
  }
});

test('spawnGit finds the repository root by a .git file too (linked worktree, submodule checkout)', () => {
  const f = folders();
  try {
    fs.rmSync(f.at('repo', '.git'), { recursive: true });
    fs.writeFileSync(f.at('repo', '.git'), 'gitdir: /elsewhere\n');
    assert.equal(pathSeen(f.at('repo', 'sub'), [f.at('repo', 'node_modules', '.bin'), f.at('tools')]).seen, f.at('tools'));
  } finally {
    f.cleanup();
  }
});

test('spawnGit with no .git above the folder takes the folder itself as the root', () => {
  const f = folders();
  try {
    assert.equal(pathSeen(f.at('plain'), [f.at('plain', 'bin'), f.at('tools')]).seen, f.at('tools'));
    assert.equal(pathSeen(f.at('plain'), [f.at('repo', 'node_modules', '.bin')]).seen, f.at('repo', 'node_modules', '.bin'), 'a folder beside it is not inside it');
  } finally {
    f.cleanup();
  }
});

test('spawnGit compares on a path-segment boundary: /repo2 is not inside /repo', () => {
  const f = folders();
  try {
    assert.equal(pathSeen(f.at('repo'), [f.at('repo2', 'bin'), f.at('repo', 'node_modules', '.bin')]).seen, f.at('repo2', 'bin'));
  } finally {
    f.cleanup();
  }
});

test('spawnGit compares real paths: a symlink that resolves into the repository is dropped, one that resolves out of it is kept', () => {
  const f = folders();
  try {
    fs.symlinkSync(f.at('repo', 'node_modules', '.bin'), f.at('tools', 'in'));
    fs.symlinkSync(f.at('tools'), f.at('repo', 'out'));
    assert.equal(pathSeen(f.at('repo'), [f.at('tools', 'in'), f.at('repo', 'out')]).seen, f.at('repo', 'out'));
    assert.equal(pathSeen(f.at('repo'), [f.at('tools', 'in')]).result.error.code, 'ENOENT');
  } finally {
    f.cleanup();
  }
});

test('spawnGit compares a folder that does not exist by its path, and resolves a repository reached through a symlink', () => {
  const f = folders();
  try {
    assert.equal(pathSeen(f.at('repo'), [f.at('repo', 'not', 'yet', 'bin'), f.at('nowhere', 'bin')]).seen, f.at('nowhere', 'bin'));
    fs.symlinkSync(f.at('repo'), f.at('tools', 'via'));
    assert.equal(pathSeen(f.at('tools', 'via', 'sub'), [f.at('repo', 'node_modules', '.bin'), f.at('tools')]).seen, f.at('tools'), 'the cwd is a path through a symlink');
  } finally {
    f.cleanup();
  }
});

test('spawnGit with nothing left reports git as not found, runs nothing, and leaves the caller\'s environment alone', () => {
  const f = folders();
  try {
    const env = { PATH: f.at('repo', 'node_modules', '.bin') };
    const r = spawnGit(f.at('repo'), ['log'], { env, timeoutMs: 1, spawn: () => assert.fail('spawned') });
    assert.equal(r.error.code, 'ENOENT');
    assert.deepEqual(env, { PATH: f.at('repo', 'node_modules', '.bin') });
    assert.match(gitErrorMessage(r.error, { cwd: f.at('repo'), timeoutMs: 1 }), /git is not installed or not on PATH/);
  } finally {
    f.cleanup();
  }
});

test('spawnGit leaves an environment with no PATH alone (the system default applies)', () => {
  const f = folders();
  try {
    let seen;
    spawnGit(f.at('repo'), ['log'], { env: { HOME: '/h' }, timeoutMs: 1, spawn: (_c, _a, opts) => { seen = opts.env; return { status: 0 }; } });
    assert.deepEqual(seen, { HOME: '/h' });
  } finally {
    f.cleanup();
  }
});

test('spawnGit drops a PATH entry spelled in another letter case where the file system ignores case', (t) => {
  const f = folders();
  try {
    if (!fs.existsSync(f.at('REPO'))) return t.skip('this file system is case-sensitive');
    assert.equal(pathSeen(f.at('repo'), [f.at('REPO', 'node_modules', '.bin'), f.at('tools')]).seen, f.at('tools'));
    assert.equal(pathSeen(f.at('REPO', 'sub'), [f.at('repo', 'node_modules', '.bin'), f.at('tools')]).seen, f.at('tools'), 'and the folder git starts in');
  } finally {
    f.cleanup();
  }
});

// ---- variables that name a place git reads config or programs from: a relative value is the repository --------------------------
const SEARCH_PLACES = ['HOME', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_EXEC_PATH'];

test('a relative HOME, XDG_CONFIG_HOME, GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM or GIT_EXEC_PATH is dropped; an absolute one is kept', () => {
  for (const key of SEARCH_PLACES) {
    for (const relative of ['.', '.config', 'gc', '../x']) assert.equal(Object.hasOwn(hardenedGitEnv({ PATH: '/usr/bin', [key]: relative }), key), false, `${key}=${relative}`);
    assert.equal(hardenedGitEnv({ PATH: '/usr/bin', [key]: '/abs/x' })[key], '/abs/x', key);
  }
});

test('an empty GIT_CONFIG_GLOBAL or GIT_CONFIG_SYSTEM means "no file" to git, so it becomes the null device; the other empty ones are dropped', () => {
  const env = hardenedGitEnv({ PATH: '/usr/bin', GIT_CONFIG_GLOBAL: '', GIT_CONFIG_SYSTEM: '', HOME: '', XDG_CONFIG_HOME: '', GIT_EXEC_PATH: '' });
  assert.deepEqual([env.GIT_CONFIG_GLOBAL, env.GIT_CONFIG_SYSTEM], [os.devNull, os.devNull]);
  for (const key of ['HOME', 'XDG_CONFIG_HOME', 'GIT_EXEC_PATH']) assert.equal(Object.hasOwn(env, key), false, key);
  const nulled = hardenedGitEnv({ PATH: '/usr/bin', GIT_CONFIG_GLOBAL: 'gc', GIT_CONFIG_SYSTEM: '' }, { nullUserConfig: true });
  assert.deepEqual([nulled.GIT_CONFIG_GLOBAL, nulled.GIT_CONFIG_SYSTEM], [os.devNull, os.devNull], 'make-scene\'s null user config still wins');
});

test('on Windows variable names are compared in capitals: GIT_DIR, the config pairs and the pathspec switches in any spelling are dropped', () => {
  const source = { Git_Dir: 'C:\\x', git_config_key_1: 'k', Git_Config_Value_1: 'v', git_literal_pathspecs: '1', Home: 'rel', Git_Exec_Path: 'bin', GIT_AUTHOR_NAME: 'A', Path: 'C:\\Windows' };
  assert.deepEqual(hardenedGitEnv(source, { platform: 'win32' }).GIT_AUTHOR_NAME, 'A');
  const names = Object.keys(hardenedGitEnv(source, { platform: 'win32' })).filter((k) => /^(git_dir|git_config_|git_literal|home|git_exec)/i.test(k));
  assert.deepEqual(names, []);
  assert.equal(Object.hasOwn(hardenedGitEnv(source, { platform: 'linux' }), 'Git_Dir'), true, 'elsewhere names are case-sensitive');
  assert.equal(hardenedGitEnv({ Git_Config_Global: '' }, { platform: 'win32' }).GIT_CONFIG_GLOBAL, os.devNull);
  assert.equal(hardenedGitEnv({ Home: 'C:\\h' }, { platform: 'win32' }).HOME, 'C:\\h', 'an absolute one is kept, under its capitals');
});

test('listConfig reports a timeout, an over-size listing and a missing git as themselves', () => {
  const run = (error, env = { PATH: '/usr/bin' }) => () => listConfig('/r', { base: [], env, timeoutMs: 500, spawn: () => ({ status: null, error: Object.assign(new Error('x'), { code: error }) }) });
  assert.throws(run('ETIMEDOUT'), /git did not finish within 0\.5 seconds/);
  assert.throws(run('ENOBUFS'), /git config of \/r is over 16 MiB/);
  assert.throws(run('ENOENT'), /git is not installed or not on PATH/);
  assert.throws(() => listConfig('/r', { base: [], env: { PATH: '' }, timeoutMs: 1, spawn: () => assert.fail('spawned') }), /git is not installed or not on PATH/);
});
