// The shared git runner: the environment, the config overrides, the PATH rule and the error words. These tests feed it
// plain objects and a fake `spawn`; the tests that run real git on planted repositories are beside each caller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import {
  hardenedGitEnv, gitBaseArgs, absolutePathEntries, spawnGit, gitErrorMessage, listConfig, REDIRECTING_ENV,
  GIT_TIMEOUT_MS, SCRATCH_TIMEOUT_MS, LISTING_MAX_BUFFER,
} from '../git-run.mjs';

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
  const env = hardenedGitEnv({ Path: 'C:\\Windows;.;git\\bin;D:\\Git\\cmd;;C:rel', PATH: 'C:\\other', HOME: 'x' }, { platform: 'win32' });
  assert.equal(env.Path, 'C:\\Windows;D:\\Git\\cmd');
  assert.equal(Object.hasOwn(env, 'PATH'), false, 'one spelling survives');
  assert.equal(env.HOME, 'x');
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

test('listConfig reports a timeout, an over-size listing and a missing git as themselves', () => {
  const run = (error, env = { PATH: '/usr/bin' }) => () => listConfig('/r', { base: [], env, timeoutMs: 500, spawn: () => ({ status: null, error: Object.assign(new Error('x'), { code: error }) }) });
  assert.throws(run('ETIMEDOUT'), /git did not finish within 0\.5 seconds/);
  assert.throws(run('ENOBUFS'), /git config of \/r is over 16 MiB/);
  assert.throws(run('ENOENT'), /git is not installed or not on PATH/);
  assert.throws(() => listConfig('/r', { base: [], env: { PATH: '' }, timeoutMs: 1, spawn: () => assert.fail('spawned') }), /git is not installed or not on PATH/);
});
