// The one place that decides how git is run inside a folder that may hold a repository the user did not write: make-explainer's
// gather, make-scene's rows git and the page builders' scratchIgnoreNote (output.mjs) all spawn git through here. Reading a
// repository's config runs nothing, but several git commands act on it: `git status` queries core.fsmonitor and runs filter
// drivers, a lazy fetch runs remote.<name>.uploadpack, and a `git` found through a PATH entry that names the folder is the
// repository's own program. This lowers the risk; a sandbox is still the right place for a repository expected to be hostile.
// The PATH rule is proved on macOS only. On Windows the program lookup is believed (from memory of libuv, not verified, not run
// there) to start in the folder git is started in, which this rule would not close; the Windows spelling of PATH and its
// delimiter are handled and unit-tested through the `platform` option.
// The PATH rule also drops an absolute entry that lies inside the repository git is started in (`npm run` and direnv put
// <repo>/node_modules/.bin on PATH by its absolute path). The repository is the nearest folder, from the real path of the
// folder git starts in upwards, that holds a `.git` entry, else that folder itself. A work tree that holds the user's own
// tools (a dotfiles repository at HOME) therefore loses those PATH entries; if git is then not found, it is reported as not found.
//
//  - hardenedGitEnv: the environment git runs in (no variable that redirects git, no injected config, no prompts, optional
//    locks or lazy fetches, LC_ALL=C unless asked otherwise, a PATH of absolute entries only, and no HOME, XDG_CONFIG_HOME,
//    GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM or GIT_EXEC_PATH that names a place by a relative path).
//  - gitBaseArgs: the `-c` overrides every call carries (core.fsmonitor=false, core.hooksPath=<null device>, and
//    safe.bareRepository=explicit unless the caller reads a repository it was told to open).
//  - spawnGit: spawnSync with an argument array, a time limit and a size limit; with no PATH entry left outside the repository
//    it does not spawn at all and reports git as not found.
//  - listConfig: the one call that lists a repository's config as bytes (see git-config.mjs for what is decided from it).
// Built-ins and sibling shared modules only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { UsageError } from './cli.mjs';
import { CONFIG_LIST_ARGS } from './git-config.mjs';

export const GIT_TIMEOUT_MS = 60 * 1000;
// scratchIgnoreNote only decorates a build's output: a repository that cannot answer in this long gets no note.
export const SCRATCH_TIMEOUT_MS = 5 * 1000;
const MIB = 1024 * 1024;
// A config listing is parsed into objects in memory; 16 MiB is far above any real config and far below what a hostile one can cost.
export const LISTING_MAX_BUFFER = 16 * MIB;
export const LISTING_LIMIT_TEXT = '16 MiB';

// These GIT_* variables point git at a different repository, object store, index, discovery root, config or ref/attribute source
// than the folder names, or change how paths match, so the child gets none of them. Nor the config injectors
// (GIT_CONFIG_PARAMETERS, GIT_CONFIG_COUNT and the GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n pairs), which can set core.fsmonitor or a
// diff driver from outside the repository; nor the legacy GIT_CONFIG, which makes `git config` read another file. Everything else
// (identity, GIT_EXTERNAL_DIFF, ...) passes through: the callers' flags keep the output free of helpers. The variables in
// SEARCH_PLACES (below) pass through only with an absolute value.
export const REDIRECTING_ENV = new Set([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG',
  'GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE', 'GIT_REPLACE_REF_BASE', 'GIT_ATTR_SOURCE', 'GIT_REFERENCE_BACKEND',
  'GIT_IMPLICIT_WORK_TREE', 'GIT_PREFIX',
]);
export const CONFIG_PAIR_ENV = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/;
// GIT_LITERAL_PATHSPECS, GIT_GLOB_PATHSPECS, GIT_NOGLOB_PATHSPECS, GIT_ICASE_PATHSPECS: they change what a pathspec matches.
export const PATHSPECS_ENV = /^GIT_[A-Z]+_PATHSPECS$/;

// Where git (and the shell-less programs it starts) look for config and helpers. Each is used only with an absolute value: a
// relative one (`.config`, `.`) names a file inside the repository git is started in, which git would then read as the user's
// own config. An empty GIT_CONFIG_GLOBAL or GIT_CONFIG_SYSTEM means "read no file" to git (measured on git 2.54: the global file
// in HOME is not read), so it becomes the null device, which says the same to every git; an empty one of the others is dropped.
const SEARCH_PLACES = new Set(['HOME', 'XDG_CONFIG_HOME', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_EXEC_PATH']);
const EMPTY_MEANS_NO_FILE = new Set(['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM']);

const flavour = (platform) => (platform === 'win32' ? path.win32 : path.posix);
// Windows variable names are not case-sensitive: compare them in capitals there.
const canonicalName = (key, platform) => (platform === 'win32' ? key.toUpperCase() : key);

/** The value of a SEARCH_PLACES variable to pass on, or undefined to drop it. */
function searchPlaceValue(name, value, platform) {
  if (flavour(platform).isAbsolute(value)) return value;
  return value === '' && EMPTY_MEANS_NO_FILE.has(name) ? os.devNull : undefined;
}
// On Windows the variable may be spelled PATH, Path or path; elsewhere only PATH names the search path.
const isPathKey = (key, platform) => (platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH');

/** The entries of a PATH value that are absolute; empty entries (the current folder) and relative ones are dropped. */
export function absolutePathEntries(value, platform = process.platform) {
  const p = flavour(platform);
  return value.split(p.delimiter).filter((entry) => entry !== '' && p.isAbsolute(entry));
}

/**
 * The environment git runs in: `source` without the variables above, no prompts, no optional locks (a read-only command
 * writes nothing to the repository), and no lazy fetches: a partial clone would otherwise fetch missing objects through the
 * repository's own remote.<name>.uploadpack, core.sshCommand or credential helper (git 2.45.0 honours GIT_NO_LAZY_FETCH, as do
 * the backports 2.39.4, 2.43.4 and 2.44.1 among others; 2.44.0 and older releases without the backport ignore it).
 * PATH keeps only its absolute entries: git runs with the repository as its folder, so an entry such as ".", an empty one or
 * "node_modules/.bin" would find a `git` (or a helper of git's) inside the repository. A PATH with no absolute entry is left
 * as the empty string, which spawnGit treats as "git not found". HOME, XDG_CONFIG_HOME, GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM and
 * GIT_EXEC_PATH are dropped when their value is not absolute (SEARCH_PLACES), and on Windows names are compared in capitals.
 * Options: nullUserConfig points GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM at the null device (the user's own config is then not
 * read at all); omitLazyFetchEnv leaves GIT_NO_LAZY_FETCH out (tests: the environment of a git that ignores it); keepLocale
 * leaves the user's locale alone instead of LC_ALL=C (only for a call whose global filters may depend on it).
 * LC_ALL=C: git's own text and key matching must not depend on the user's locale.
 */
export function hardenedGitEnv(source, { nullUserConfig = false, omitLazyFetchEnv = false, keepLocale = false, platform = process.platform } = {}) {
  const env = {};
  let pathKey;
  let pathValue;
  for (const [key, value] of Object.entries(source)) {
    const name = canonicalName(key, platform);
    if (isPathKey(key, platform)) {
      if (pathKey === undefined) [pathKey, pathValue] = [key, value];
    } else if (SEARCH_PLACES.has(name)) {
      const kept = searchPlaceValue(name, value, platform);
      if (kept !== undefined) env[name] = kept;
    } else if (!REDIRECTING_ENV.has(name) && !CONFIG_PAIR_ENV.test(name) && !PATHSPECS_ENV.test(name)) {
      env[key] = value;
    }
  }
  if (pathKey !== undefined) env[pathKey] = absolutePathEntries(String(pathValue), platform).join(flavour(platform).delimiter);
  if (!keepLocale) env.LC_ALL = 'C';
  if (nullUserConfig) {
    env.GIT_CONFIG_GLOBAL = os.devNull;
    env.GIT_CONFIG_SYSTEM = os.devNull;
  }
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_TERMINAL_PROMPT = '0';
  if (omitLazyFetchEnv) delete env.GIT_NO_LAZY_FETCH;
  else env.GIT_NO_LAZY_FETCH = '1';
  return env;
}

/**
 * The arguments every git call starts with. `-c core.fsmonitor=false`: `git status` and `check-ignore` would otherwise run the
 * command a repository's own config names there. `-c core.hooksPath=<null device>`: no hook of the repository can run (defence
 * in depth: with GIT_OPTIONAL_LOCKS=0 the read-only commands used here rewrite no index and update no ref, which is when hooks
 * run). `-c safe.bareRepository=explicit` (default): git does not discover a bare repository from the folder it starts in, so
 * one planted inside a work tree is not picked up; a linked worktree or a submodule checkout is not bare and is unaffected.
 * A caller that is told to open a bare or mirror clone and runs only `config --list` and `log` passes bareExplicit: false.
 * Other commands a repository's config can name (filter drivers, hook.<name>.command, a remote's uploadpack through a lazy
 * fetch) are handled where they would run: the callers' dirty check and hardenedGitEnv.
 */
export function gitBaseArgs({ bareExplicit = true } = {}) {
  return ['--no-pager', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${os.devNull}`, ...(bareExplicit ? ['-c', 'safe.bareRepository=explicit'] : [])];
}

/** True when the environment has a PATH and none of its entries survived hardenedGitEnv. */
function hasNoUsablePath(env, platform) {
  const key = Object.keys(env).find((k) => isPathKey(k, platform));
  return key !== undefined && env[key] === '';
}

/**
 * The real path of `file` (the one the file system reports, symlinks followed and letter case as stored), or its resolved path
 * when it does not exist. The one comparison key for "is this folder inside that one" (PATH entries here, gather's top level).
 */
export function realOrResolved(file, p = flavour(process.platform)) {
  try {
    return fs.realpathSync.native(file);
  } catch {
    return p.resolve(file);
  }
}

const hasEntry = (file) => {
  try {
    return fs.lstatSync(file) !== undefined;
  } catch {
    return false;
  }
};

/** The repository git is started in: the nearest folder at or above the real path of `cwd` with a `.git` entry (file or folder), else `cwd`. */
function repositoryRoot(cwd, p) {
  const start = realOrResolved(cwd, p);
  for (let dir = start; ; dir = p.dirname(dir)) {
    if (hasEntry(p.join(dir, '.git'))) return dir;
    if (p.dirname(dir) === dir) return start;
  }
}

/** True when `entry` is `root` or lies below it, on a path-segment boundary (/repo2 is not inside /repo). Both are real paths. */
export function isInside(entry, root, platform = process.platform) {
  const sep = flavour(platform).sep;
  const [e, r] = platform === 'win32' ? [entry.toLowerCase(), root.toLowerCase()] : [entry, root];
  return e === r || e.startsWith(r.endsWith(sep) ? r : r + sep);
}

/** `env` with the absolute PATH entries that lie inside the repository git starts in taken out (see the header); a new object. */
function withoutRepositoryEntries(env, cwd, platform) {
  const key = Object.keys(env).find((k) => isPathKey(k, platform));
  if (key === undefined || env[key] === '') return env;
  const p = flavour(platform);
  const root = repositoryRoot(cwd, p);
  const kept = env[key].split(p.delimiter).filter((entry) => !p.isAbsolute(entry) || !isInside(realOrResolved(entry, p), root, platform));
  return { ...env, [key]: kept.join(p.delimiter) };
}

/**
 * spawnSync('git', args) with `cwd`, an argument array (never a shell string), a time limit and a size limit; stdout is a
 * Buffer when `raw`. git gets `env` without the PATH entries that lie inside the repository it starts in. With no usable PATH
 * entry left nothing is spawned and the result is an ENOENT error: git is "not found", never looked up inside the repository.
 * `spawn` is the test seam (the signature of spawnSync).
 * -> the spawnSync result: { status, stdout, stderr, error? }.
 */
export function spawnGit(cwd, args, { env, timeoutMs, maxBuffer = MIB, raw = false, spawn = spawnSync, platform = process.platform }) {
  const safeEnv = withoutRepositoryEntries(env, cwd, platform);
  if (hasNoUsablePath(safeEnv, platform)) return { status: null, stdout: null, stderr: null, error: Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' }) };
  return spawn('git', args, { cwd, encoding: raw ? 'buffer' : 'utf8', env: safeEnv, maxBuffer, timeout: timeoutMs, killSignal: 'SIGKILL' });
}

/** The words for a spawn error. `bufferText` says what an ENOBUFS (output over the size limit) means for the caller. */
export function gitErrorMessage(error, { cwd, timeoutMs, bufferText }) {
  if (error.code === 'ETIMEDOUT') return `git did not finish within ${timeoutMs / 1000} seconds in ${cwd} and was stopped; look for a named pipe or another file git cannot read (.gitattributes, .gitignore, .mailmap) in the repository`;
  if (error.code === 'ENOENT') return 'git is not installed or not on PATH; install it, then retry';
  if (error.code === 'ENOBUFS') return bufferText;
  return `cannot run git: ${error.code ?? error.message}`;
}

/**
 * The repository's config as bytes (the stdout of CONFIG_LIST_ARGS), or null when git ran and failed (a git older than 2.26
 * fails on --show-scope; the caller fails closed). A spawn error is not null: a timeout, a listing over the size limit and a
 * missing git throw a UsageError in their own words, so no second git call follows them. `base` and `env` are the caller's;
 * `spawn` is the test seam.
 */
export function listConfig(cwd, { base, env, timeoutMs, spawn = spawnSync }) {
  const r = spawnGit(cwd, [...base, ...CONFIG_LIST_ARGS], { env, timeoutMs, maxBuffer: LISTING_MAX_BUFFER, raw: true, spawn });
  if (r.error) throw new UsageError(gitErrorMessage(r.error, { cwd, timeoutMs, bufferText: `the git config of ${cwd} is over ${LISTING_LIMIT_TEXT}; it is too large to read` }));
  return r.status === 0 ? r.stdout : null;
}
