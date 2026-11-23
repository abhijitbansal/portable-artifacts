// Facts about a branch, read from git. Git always runs through spawnSync with an
// argument array (never a shell string) and with `-z` output, so paths with spaces,
// quotes, tabs, newlines or non-ASCII letters come back exact. Every failure that a
// user can fix (not a repository, a base that does not exist, no commits, no shared
// history) is a UsageError that names the fix.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { UsageError } from '../../shared/cli.mjs';
import { CONFIG_LIST_ARGS, repoOwnedConfig, isPartialClone, skipsDirtyCheck } from '../../shared/git-config.mjs';

const MAX_BUFFER = 256 * 1024 * 1024;
// A git call that has not finished in this long is stopped: a named pipe where git reads .gitattributes or an ignore file
// would otherwise block gather for good.
const GIT_TIMEOUT_MS = 60 * 1000;
// Test seams, set only by gatherGit({ _test }): a shorter time limit, and the environment of a git that ignores
// GIT_NO_LAZY_FETCH (before 2.45.0, or 2.44.0), so the config check alone is proved to keep a partial clone out.
const seams = { timeoutMs: GIT_TIMEOUT_MS, omitLazyFetchEnv: false };
const BASE_NAMES = ['main', 'master'];
const SHOWN_BRANCHES = 10;
const SHORT_SHA = 7;
// A copy (C) is a new file that remembers its source; scaffold notes it like a rename.
const CHANGES = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified' };
// These GIT_* variables point git at a different repository, object store, index or discovery root than
// --repo names, so the child gets none of them; nor the config injectors (GIT_CONFIG_PARAMETERS, GIT_CONFIG_COUNT and
// the GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n pairs), which can set core.fsmonitor or a diff driver from outside the repo;
// nor the legacy GIT_CONFIG, which makes `git config` read another file than the repository's (the config check below).
// Everything else (GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM, which are the user's own files and hold safe.directory,
// GIT_EXEC_PATH, identity, GIT_EXTERNAL_DIFF, ...) passes through: --no-ext-diff and --no-pager keep the output free of helpers.
const REDIRECTING_ENV = new Set([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG',
]);
const CONFIG_PAIR_ENV = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/;

// A test file is code that lives in a test folder or has a test-shaped name. Fixtures, goldens,
// helpers and snapshots inside a test folder support the tests; data and docs are not tests.
const CODE_EXT = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|swift|kt|java|cs|php|c|cc|cpp|m|mm|sh|bats|lua|dart|ex|exs|scala)$/;
const TEST_DIR = /(^|\/)(tests?|__tests__|e2e)\/|(^|\/)[^/]*Tests\//;
const SUPPORT_DIR = /(^|\/)(fixtures?|golden|goldens|helpers?|snapshots|__snapshots__|__mocks__|mocks?|testdata|support)\//i;
const TEST_NAME = /(^|\/)test_[^/]*$|[._-]tests?\.[A-Za-z0-9]+$|[._-]spec\.[A-Za-z0-9]+$|[A-Za-z0-9]Tests?\.[A-Za-z0-9]+$/;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The environment git runs in: `source` without the repo-redirecting variables, and no prompts, optional locks or lazy
 * fetches. A partial clone would otherwise fetch missing objects through the repository's own remote.<name>.uploadpack,
 * core.sshCommand or credential helper (git 2.45.0 honours GIT_NO_LAZY_FETCH, as do the backports 2.39.4, 2.43.4 and
 * 2.44.1 among others; 2.44.0 and older releases without the backport ignore it). LC_ALL=C: git's own text and key
 * matching must not depend on the user's locale (`config --get-regexp` fails on bytes that are not valid UTF-8 in a UTF-8
 * locale); the config check below does not use git's matcher either.
 */
export function gitEnv(source) {
  const env = Object.fromEntries(Object.entries(source).filter(([k]) => !REDIRECTING_ENV.has(k) && !CONFIG_PAIR_ENV.test(k)));
  env.LC_ALL = 'C';
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_TERMINAL_PROMPT = '0';
  if (!seams.omitLazyFetchEnv) env.GIT_NO_LAZY_FETCH = '1';
  else delete env.GIT_NO_LAZY_FETCH;
  return env;
}

// git only, an argv array, no shell. `-c core.fsmonitor=false`: `git status` would otherwise run the command a
// repository's own config names there. `-c core.hooksPath=<null device>`: no hook of the repository (a .git/hooks file or
// a hooksPath in its config) can run. `-c safe.bareRepository=explicit`: git does not discover a bare repository from
// the folder it starts in (one planted inside a work tree); a linked worktree or a submodule checkout is not bare and is
// unaffected. Other commands a repository's config can name (filter drivers, hook.<name>.command, a remote's uploadpack
// through a lazy fetch) are handled where they would run: isDirty and gitEnv. `raw` returns stdout as a Buffer.
function run(cwd, args, { raw = false } = {}) {
  // log.mailmap=false: git reads .mailmap from the work tree, and a named pipe there would block `git log` (names are not used).
  const base = [
    '--no-pager', '-c', 'core.quotepath=off', '-c', 'log.showSignature=false', '-c', 'log.mailmap=false', '-c', 'core.fsmonitor=false',
    '-c', `core.hooksPath=${os.devNull}`, '-c', 'safe.bareRepository=explicit',
  ];
  const r = spawnSync('git', [...base, ...args], {
    cwd, encoding: raw ? 'buffer' : 'utf8', env: gitEnv(process.env), maxBuffer: MAX_BUFFER, timeout: seams.timeoutMs, killSignal: 'SIGKILL',
  });
  if (r.error) {
    if (r.error.code === 'ETIMEDOUT') throw new UsageError(`git did not finish within ${seams.timeoutMs / 1000} seconds in ${cwd} and was stopped; look for a named pipe or another file git cannot read (.gitattributes, .gitignore, .mailmap) in the repository`);
    if (r.error.code === 'ENOENT') throw new UsageError('git is not installed or not on PATH; install it, then retry');
    throw new UsageError(`cannot run git: ${r.error.code ?? r.error.message}`);
  }
  return { ok: r.status === 0, status: r.status, out: r.stdout, err: r.stderr.toString('utf8').trim() };
}

const nulFields = (text) => text.split('\0').filter((f) => f !== '');

/** The repository's work-tree root for a folder inside it. */
export function repoRoot(dir) {
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new UsageError(`--repo ${dir}: no such folder; pass a folder inside a git repository`);
  }
  if (!stat.isDirectory()) throw new UsageError(`--repo ${dir}: not a folder; pass a folder inside a git repository`);
  const top = run(dir, ['rev-parse', '--show-toplevel']);
  if (top.ok) return top.out.trim();
  // With safe.bareRepository=explicit git refuses a bare repository by name ("cannot use bare repository", measured on git
  // 2.54; LC_ALL=C keeps the text English). A git without that setting finds the bare repository, and `inGitDir.ok` covers it.
  const inGitDir = run(dir, ['rev-parse', '--git-dir']);
  if (inGitDir.ok || inGitDir.err.includes('cannot use bare repository')) {
    throw new UsageError(`${dir} has no work tree (a bare repository, or the inside of a .git folder); pass --repo <the checked-out folder>`);
  }
  throw new UsageError(`${dir} is not a git repository; pass --repo <a folder inside one>`);
}

const commitExists = (repo, ref) => run(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok;
const isShallow = (repo) => run(repo, ['rev-parse', '--is-shallow-repository']).out.trim() === 'true';
const SHALLOW_FIX = 'this is a shallow clone, so history is missing; run `git fetch --unshallow` (or fetch the base branch)';

function existingBranches(repo) {
  const refs = run(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  // Full names, so a remote's HEAD alias (refs/remotes/<any remote>/HEAD) is recognised and dropped.
  const names = refs.ok
    ? refs.out.split('\n').filter((n) => n && !/^refs\/remotes\/[^/]+\/HEAD$/.test(n)).map((n) => n.replace(/^refs\/(heads|remotes)\//, ''))
    : [];
  const shown = names.slice(0, SHOWN_BRANCHES);
  return shown.length === names.length ? shown.join(', ') : `${shown.join(', ')}, …`;
}

function resolveBase(repo, requested) {
  if (requested !== undefined) {
    if (requested.startsWith('-')) throw new UsageError(`--base ${requested}: a branch name cannot start with "-"; pass --base <branch>`);
    if (commitExists(repo, requested)) return requested;
    const hint = isShallow(repo) ? ` (${SHALLOW_FIX})` : '';
    throw new UsageError(`base "${requested}" does not exist; branches that do: ${existingBranches(repo)}; pass --base <branch>${hint}`);
  }
  for (const name of BASE_NAMES) {
    const found = freshest(repo, name);
    if (found) return found;
  }
  throw new UsageError(`no main or master branch found; branches that do exist: ${existingBranches(repo)}; pass --base <branch>`);
}

// The local branch and origin's copy of it: origin's when the local one is missing or strictly behind it
// (a stale local main would credit other people's commits to this branch); the local one otherwise.
function freshest(repo, name) {
  const local = commitExists(repo, `refs/heads/${name}`);
  const remote = commitExists(repo, `refs/remotes/origin/${name}`);
  if (!remote) return local ? name : null;
  if (!local) return `origin/${name}`;
  const sameTip = run(repo, ['rev-parse', `refs/heads/${name}`]).out === run(repo, ['rev-parse', `refs/remotes/origin/${name}`]).out;
  const behind = !sameTip && run(repo, ['merge-base', '--is-ancestor', `refs/heads/${name}`, `refs/remotes/origin/${name}`]).ok;
  return behind ? `origin/${name}` : name;
}

function currentBranch(repo) {
  const named = run(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (named.ok && named.out.trim()) return { branch: named.out.trim(), detached: false };
  const sha = run(repo, ['rev-parse', 'HEAD']).out.trim();
  return { branch: `detached-${sha.slice(0, SHORT_SHA)}`, detached: true };
}

function readCommits(repo, range) {
  const log = run(repo, ['log', '-z', '--reverse', '--no-color', '--format=%H%x1f%cs%x1f%s', range, '--']);
  if (!log.ok) throw new UsageError(`cannot read the commit list: ${log.err}`);
  return nulFields(log.out).map((record) => {
    const [sha, date, ...subject] = record.split('\x1f');
    // Exact: the page's timeline titles are built from it. gather.mjs cuts a long subject only where the agent reads it.
    return { sha, date, subject: subject.join('\x1f') };
  });
}

// `--name-status -z`: status NUL path NUL [new path NUL for a rename].
function readStatuses(text) {
  const fields = nulFields(text);
  const rows = [];
  for (let i = 0; i < fields.length;) {
    const code = fields[i][0];
    if (code === 'R' || code === 'C') {
      rows.push({ code, oldPath: fields[i + 1], path: fields[i + 2] });
      i += 3;
    } else {
      rows.push({ code, path: fields[i + 1] });
      i += 2;
    }
  }
  return rows;
}

// `--numstat -z`: "add\tdel\tpath" NUL; a rename is "add\tdel\t" NUL old NUL new NUL. A binary file has "-" counts.
function readCounts(text) {
  const fields = text.split('\0');
  const counts = new Map();
  for (let i = 0; i < fields.length; i++) {
    const m = /^([^\t]*)\t([^\t]*)\t([\s\S]*)$/.exec(fields[i]);
    if (!m) continue;
    let file = m[3];
    if (file === '') {
      file = fields[i + 2];
      i += 2;
    }
    const binary = m[1] === '-' || m[2] === '-';
    counts.set(file, binary ? { add: null, del: null, binary: true } : { add: Number(m[1]), del: Number(m[2]), binary: false });
  }
  return counts;
}

function readFiles(repo, from) {
  const flags = ['diff', '-z', '-M', '--no-ext-diff', '--no-textconv', '--no-color'];
  const status = run(repo, [...flags, '--name-status', from, 'HEAD', '--']);
  const numstat = run(repo, [...flags, '--numstat', from, 'HEAD', '--']);
  if (!status.ok || !numstat.ok) throw new UsageError(`cannot read the changed files: ${status.err || numstat.err}`);
  const counts = readCounts(numstat.out);
  return readStatuses(status.out)
    .map(({ code, path: file, oldPath }) => ({
      path: file,
      ...(oldPath === undefined ? {} : { oldPath }),
      change: CHANGES[code] ?? 'modified',
      ...(counts.get(file) ?? { add: 0, del: 0, binary: false }),
    }))
    .sort((a, b) => byCodeUnit(a.path, b.path));
}

/** A real test file: test-shaped name, or code in a test folder that is not a fixture, golden or helper. */
export function isTestPath(p) {
  if (!CODE_EXT.test(p)) return false;
  return TEST_NAME.test(p) || (TEST_DIR.test(p) && !SUPPORT_DIR.test(p));
}

/**
 * Facts for the branch checked out in `dir`, measured against `base` (default: main, master,
 * origin/main, origin/master). Committed work only; the working tree is never read.
 * -> { repo, branch, detached, base, mergeBase, commits: [{ sha, date, subject }],
 *      files: [{ path, oldPath?, change, add, del, binary }], tests: [path], date, dirty (null: check skipped, see isDirty), warnings: [text] }
 */
export function gatherGit({ repo: dir = '.', base, _test = {} } = {}) {
  seams.timeoutMs = _test.timeoutMs ?? GIT_TIMEOUT_MS;
  seams.omitLazyFetchEnv = _test.omitLazyFetchEnv === true;
  try {
    return gatherFacts(dir, base);
  } finally {
    seams.timeoutMs = GIT_TIMEOUT_MS;
    seams.omitLazyFetchEnv = false;
  }
}

function gatherFacts(dir, base) {
  const root = repoRoot(path.resolve(dir));
  assertFullClone(root);
  if (!commitExists(root, 'HEAD')) throw new UsageError(`${root} has no commits yet; commit something, then retry`);
  const baseRef = resolveBase(root, base);
  const merge = run(root, ['merge-base', baseRef, 'HEAD']);
  if (!merge.ok || !merge.out.trim()) {
    if (isShallow(root)) throw new UsageError(`cannot find where this branch left "${baseRef}": ${SHALLOW_FIX}, or pass --base <a branch the clone has>`);
    throw new UsageError(`this branch and "${baseRef}" have no common history; pass --base <the branch this one started from>`);
  }
  const mergeBase = merge.out.trim();
  const files = readFiles(root, mergeBase);
  const tip = run(root, ['log', '-1', '--format=%cs', 'HEAD', '--']);
  const current = currentBranch(root);
  const commits = readCommits(root, `${mergeBase}..HEAD`);
  const dirty = isDirty(root);
  return {
    repo: path.basename(root),
    ...current,
    base: baseRef,
    mergeBase,
    commits,
    files,
    tests: files.filter((f) => f.change !== 'deleted' && isTestPath(f.path)).map((f) => f.path),
    date: tip.out.trim(),
    dirty,
    warnings: factWarnings({ branch: current.branch, baseRef, commits, dirty }),
  };
}

// The entries of the repository's own config (not global, system or command-line), or null when the config cannot be read
// (fail closed: the caller treats null as a hit). The whole listing is read as bytes and decided in shared/git-config.mjs,
// never matched by git: `config --get-regexp` fails with no output on a key that is not valid UTF-8, which looked like "no
// match". Reading config runs nothing. Any failure, a malformed listing, or a listing with no repository of its own in it
// is null. The listing includes include.path files and config.worktree. Needs git 2.26 or later; older git fails closed.
function repoConfig(root) {
  const listed = run(root, CONFIG_LIST_ARGS, { raw: true });
  return repoOwnedConfig(listed.ok ? listed.out : null);
}

// A partial clone fetches missing objects on demand, and that fetch runs the repository's own remote.<name>.uploadpack,
// core.sshCommand, credential helper or transport. GIT_NO_LAZY_FETCH stops it only from git 2.45.0 (and the backports
// 2.39.4, 2.43.4, 2.44.1 among others), and gather reads objects (diff, log) before anything else, so the config is checked
// first, on any git version. A clone made with a filter writes remote.<name>.promisor (and partialclonefilter); an older
// git wrote extensions.partialclone: all three count.
function assertFullClone(root) {
  const config = repoConfig(root);
  if (config === null) throw new UsageError(`cannot read the git config of ${root} (gather needs git 2.26 or later); check \`git config --list --show-scope\` there`);
  if (isPartialClone(config)) throw new UsageError('this is a partial clone (its config says missing objects are fetched on demand, which runs the repository\'s own remote settings); run gather on a full clone, made without --filter');
}

// True when the repository's own config defines something git or git-lfs would run to compare files, or when that cannot
// be told: a filter driver, a git-lfs extension, a hook.<name> command, or a value with a line break. `git status` runs a
// driver's clean command on every tracked file whose stat data differs from the index, which an unpacked archive makes all
// of them. A git-lfs filter, even a global one, runs the repository's lfs.extension.<name>.clean itself, so those keys
// count too, and git-lfs reads `git config -l` line by line, so a value with a line break can forge one. git-lfs also reads
// .lfsconfig from the work tree root or HEAD; its documentation limits that file to a safe subset of keys but this is from
// memory, so the file's presence alone counts. Global and system drivers are the user's own: they stay active and are not counted.
function repoRunsCommandsToCompare(root) {
  const config = repoConfig(root);
  if (config === null || skipsDirtyCheck(config)) return true;
  if (fs.lstatSync(path.join(root, '.lfsconfig'), { throwIfNoEntry: false }) !== undefined) return true;
  return run(root, ['ls-tree', '--name-only', 'HEAD', '.lfsconfig']).out.trim() !== '';
}

// Uncommitted work: a modified or staged tracked file, or an untracked one that is not ignored. null when the check was
// skipped. --ignore-submodules=all: a submodule's own config and .gitattributes (under .git/modules) would be read by the
// status git starts inside it, past the check above, so edits inside a submodule are not counted.
function isDirty(root) {
  if (repoRunsCommandsToCompare(root)) return null;
  return run(root, ['status', '--porcelain', '--ignore-submodules=all']).out.trim() !== '';
}

// What a script cannot fix but the reader should know before trusting the facts.
function factWarnings({ branch, baseRef, commits, dirty }) {
  const out = [];
  if (dirty === null) out.push('this repository\'s own git config defines a filter driver or a git-lfs extension (or a hook, a value with a line break, a config that cannot be read, or the work tree has a .lfsconfig); skipped the uncommitted-changes check (dirty is unknown), because git would run that command to compare files');
  if (commits.length === 0) out.push(`no commits on ${branch} beyond ${baseRef}, so a recap would be empty; check out the feature branch, or pass --base <the branch it started from>`);
  if (dirty) out.push('the work tree has uncommitted changes; these facts cover committed work only, so commit them first if the recap should include them');
  return out;
}
