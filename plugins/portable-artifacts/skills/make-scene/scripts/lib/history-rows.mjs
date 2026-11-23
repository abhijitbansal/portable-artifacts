// Commit history -> scene rows: commits per folder per ISO week, read with a local
// `git log --numstat`. Git runs with argument arrays and a scrubbed environment (the
// approach of PA/eval/lib.mjs createFixtureRepo), so the user's own git config
// (signing, hooks, templates) cannot change the result.
import fs from 'node:fs';
import { UsageError } from '../../shared/cli.mjs';
import { repoOwnedConfig, isPartialClone } from '../../shared/git-config.mjs';
import { GIT_TIMEOUT_MS, hardenedGitEnv, gitBaseArgs, spawnGit, gitErrorMessage, listConfig } from '../../shared/git-run.mjs';
import { LIMITS } from './schema.mjs';

export const ROOT_GROUP = '(root)';
export const OTHER_GROUP = '(other)';
const ELLIPSIS = '…';
const MAX_BUFFER = 256 * 1024 * 1024;
// Test seams, set only by historyRows({ _test }): a shorter time limit (a git call not finished in the limit is stopped: a
// named pipe where git reads an attributes or ignore file would block it for good), and the environment of a git that ignores
// GIT_NO_LAZY_FETCH (before 2.45.0, or 2.44.0).
const seams = { timeoutMs: GIT_TIMEOUT_MS, omitLazyFetchEnv: false };
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const HEADER = /^[0-9a-f]{40,64}\t(\S+)$/;
const NUMSTAT = /^(?:\d+|-)\t(?:\d+|-)\t([\s\S]+)$/;

// The environment git runs in (shared/git-run.mjs): no variable that redirects git, no lazy fetches, LC_ALL=C, a PATH of
// absolute entries only. The user's own git config is not read at all: the null device stands in for it.
export function gitEnv(source = process.env) {
  return hardenedGitEnv(source, { nullUserConfig: true, omitLazyFetchEnv: seams.omitLazyFetchEnv });
}

// The ISO week of a date, in UTC: "2026-W43". The ISO year belongs to the Thursday of the week.
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// The Monday (00:00 UTC) that starts the ISO week holding `date`.
function weekStart(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(day.getTime() - (((day.getUTCDay() + 6) % 7) * DAY_MS));
}

// Every git call starts with these (shared/git-run.mjs): core.fsmonitor=false and core.hooksPath=<null device>. Not
// safe.bareRepository=explicit: this tool reads the repository it is told to open, which may be a bare or mirror clone, its
// config is checked (assertFullClone) before anything else, and it runs only `config --list`, `rev-parse` and `log`, which run no repository program.
const GIT_BASE = gitBaseArgs({ bareExplicit: false });

// Runs a scrubbed git in `repo` and returns its stdout.
function runGit(repo, args) {
  const r = spawnGit(repo, [...GIT_BASE, ...args], { env: gitEnv(), timeoutMs: seams.timeoutMs, maxBuffer: MAX_BUFFER });
  if (r.error) throw new UsageError(gitErrorMessage(r.error, { cwd: repo, timeoutMs: seams.timeoutMs, bufferText: `git log output in ${repo} is over 256 MB; use a smaller --weeks` }));
  if (r.status !== 0) {
    const why = r.stderr.trim().split('\n')[0] || `exit ${r.status}`;
    throw new UsageError(`${repo} is not a git repository with commits (${why})`);
  }
  return r.stdout;
}

// A partial clone fetches missing objects on demand, and that fetch runs the repository's own remote.<name>.uploadpack,
// core.sshCommand, credential helper or transport. GIT_NO_LAZY_FETCH stops it only from git 2.45.0 (and the backports
// 2.39.4, 2.43.4, 2.44.1 among others), so the config is checked first, on any git version: remote.<name>.promisor and
// partialclonefilter (what a filtered clone writes) and extensions.partialclone (older git). Only the repository's own
// config counts (global and system are /dev/null here, and shared/git-config.mjs drops them anyway). The whole listing is
// read as bytes and decided in JavaScript, never matched by git: `config --get-regexp` fails with no output on a key that
// is not valid UTF-8, which looked like "no match". Reading config runs nothing. --show-scope needs git 2.26; an older git,
// any failure, a malformed listing or a listing with no entry of a repository of its own fails closed. A timeout or a listing
// over 16 MiB is an error in its own words (listConfig throws), with no second git call after it.
function assertFullClone(repo) {
  const config = repoOwnedConfig(listConfig(repo, { base: GIT_BASE, env: gitEnv(), timeoutMs: seams.timeoutMs }));
  if (config === null) {
    // Outside a repository the listing succeeds but holds no entry of a repository's own, so that is null too: this throws
    // the usual "not a git repository" error then. Inside one, the config really cannot be read.
    runGit(repo, ['rev-parse', '--git-dir']);
    throw new UsageError(`cannot read the git config of ${repo} (needs git 2.26 or later, and a config with entries of the repository's own)`);
  }
  if (isPartialClone(config)) {
    throw new UsageError('this is a partial clone (its config says missing objects are fetched on demand, which runs the repository\'s own remote settings); run on a full clone, made without --filter');
  }
}

// Where `repo` sits inside its repository: "plugins/x" for a subfolder, "" at the repository root.
const folderWithin = (repo) => runGit(repo, ['rev-parse', '--show-prefix']).trim().replace(/\/$/, '');

function runGitLog(repo, sinceIso, { subfolder }) {
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new UsageError(`${repo} is not a folder`);
  // -z: paths come back exact (no C-quoting of quotes, backslashes, tabs or newlines), NUL-separated.
  // In a subfolder, --relative keeps only that folder's changes and names them from it; the pathspec limits the walk too.
  const args = [
    '-c', 'log.showSignature=false', '-c', 'log.mailmap=false',
    'log', '-z', '--numstat', '--no-renames', '--no-merges', '--no-textconv', '--no-ext-diff',
    '--format=%H%x09%cI', `--since=${sinceIso}`,
    ...(subfolder ? ['--relative', '--', '.'] : []),
  ];
  return runGit(repo, args);
}

// The folder a changed file counts under: its first `depth` folders (whole, never cut), or (root) for a top-level file.
function groupOf(file, depth) {
  const folders = file.split('/').slice(0, -1);
  return folders.length === 0 ? ROOT_GROUP : folders.slice(0, depth).join('/');
}

// A group name that fits the scene's limit: a long path loses its leading folders (…/make-scene/test), never its tail.
function shortened(name) {
  const chars = [...name];
  if (chars.length <= LIMITS.group) return name;
  const folders = name.split('/');
  for (let from = 1; from < folders.length; from++) {
    const tail = `${ELLIPSIS}/${folders.slice(from).join('/')}`;
    if ([...tail].length <= LIMITS.group) return tail;
  }
  return `${ELLIPSIS}${chars.slice(-(LIMITS.group - 1)).join('')}`; // one folder name longer than the limit: its end
}

// The display name of every group, by full name. Distinct folders keep distinct names: a folder keeps its shortened
// name unless an earlier one (in sorted order) already holds it; those later folders take " (2)", " (3)"... (cut
// further to make room), skipping every name that is taken: another folder's shortened name (a real folder called
// "x (2)") or a suffix already handed out.
function displayNames(fullNames) {
  const names = new Map();
  const taken = new Set();
  const later = [];
  for (const full of [...fullNames].sort()) {
    const short = shortened(full);
    if (taken.has(short)) later.push([full, short]);
    else {
      names.set(full, short);
      taken.add(short);
    }
  }
  for (const [full, short] of later) {
    for (let n = 2; !names.has(full); n++) {
      const suffix = ` (${n})`;
      const name = `${[...short].slice(0, LIMITS.group - [...suffix].length).join('')}${suffix}`;
      if (taken.has(name)) continue;
      names.set(full, name);
      taken.add(name);
    }
  }
  return names;
}

// `log -z --numstat --format=%H%x09%cI`: NUL-separated fields, a header "hash<TAB>date" then one "add<TAB>del<TAB>path"
// per file (the first of them behind a newline). -> [{ when, groups: Set<string> }], commits with changed files only.
function parseCommits(log, depth) {
  const commits = [];
  let current = null;
  for (const raw of log.split('\0')) {
    const field = raw.startsWith('\n') ? raw.slice(1) : raw;
    const file = NUMSTAT.exec(field)?.[1];
    if (file !== undefined) {
      if (current) current.groups.add(groupOf(file, depth));
      continue;
    }
    const header = HEADER.exec(field);
    if (!header) continue;
    const when = new Date(header[1]);
    current = Number.isNaN(when.getTime()) ? null : { when, groups: new Set() };
    if (current) commits.push(current);
  }
  return commits.filter((c) => c.groups.size > 0);
}

// Keep the LIMITS.groups - 1 busiest groups; every other group becomes OTHER_GROUP, counted once per commit.
function foldGroups(commits, warn) {
  const totals = new Map();
  for (const c of commits) for (const g of c.groups) totals.set(g, (totals.get(g) ?? 0) + 1);
  if (totals.size <= LIMITS.groups) return { commits, order: [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a) || (a < b ? -1 : 1)) };
  const keep = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a) || (a < b ? -1 : 1)).slice(0, LIMITS.groups - 1);
  const kept = new Set(keep);
  warn(`${totals.size} groups; the limit is ${LIMITS.groups}: kept the ${keep.length} busiest and folded the rest into ${OTHER_GROUP}`);
  const folded = commits.map((c) => ({ ...c, groups: new Set([...c.groups].map((g) => (kept.has(g) ? g : OTHER_GROUP))) }));
  return { commits: folded, order: [...keep, OTHER_GROUP] };
}

/**
 * Commits per folder per ISO week for the last `weeks` weeks (the current week included).
 * -> [{ group, t, value, label }], busiest group first, every group for every week (empty weeks are 0).
 * `repo` inside a larger repository counts that folder alone, grouped by paths from it (`warn` is told).
 * Over the scene limits the busiest 23 groups stay, the rest fold into "(other)", and the oldest weeks
 * are dropped; `warn(message)` is told. Group names over 48 characters lose their leading folders (…/make-scene/test). Throws UsageError for a folder that is not a repo or has no
 * commits in the window.
 */
export function historyRows({ repo, weeks = 12, depth = 1, now = new Date(), warn = () => {}, _test = {} }) {
  seams.timeoutMs = _test.timeoutMs ?? GIT_TIMEOUT_MS;
  seams.omitLazyFetchEnv = _test.omitLazyFetchEnv === true;
  try {
    return historyRowsFrom({ repo, weeks, depth, now, warn });
  } finally {
    seams.timeoutMs = GIT_TIMEOUT_MS;
    seams.omitLazyFetchEnv = false;
  }
}

function historyRowsFrom({ repo, weeks, depth, now, warn }) {
  const thisWeek = weekStart(now);
  const first = new Date(thisWeek.getTime() - (weeks - 1) * WEEK_MS);
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new UsageError(`${repo} is not a folder`);
  assertFullClone(repo);
  // A --repo inside a larger repository counts that folder alone (paths from it); say so once.
  const within = folderWithin(repo);
  if (within !== '') warn(`counts cover only the folder ${within} of its repository (commits that change files in it), grouped by the folders inside it`);
  // A day of slack: git compares --since with its own timezone view; the exact week filter is below.
  const log = runGitLog(repo, new Date(first.getTime() - DAY_MS).toISOString(), { subfolder: within !== '' });
  // Only the folders that count (touched inside the week window) get display names: one touched only in the slack day
  // around it must not push another onto a suffix.
  const windowed = parseCommits(log, depth).filter((c) => c.when >= first && c.when < new Date(thisWeek.getTime() + WEEK_MS));
  const names = displayNames(new Set(windowed.flatMap((c) => [...c.groups])));
  const inWindow = windowed.map((c) => ({ week: isoWeek(c.when), groups: new Set([...c.groups].map((g) => names.get(g))) }));
  if (inWindow.length === 0) throw new UsageError(`no commits in the last ${weeks} week${weeks === 1 ? '' : 's'} in ${repo}; try a larger --weeks`);

  const { commits, order } = foldGroups(inWindow, warn);
  let allWeeks = Array.from({ length: weeks }, (_, i) => isoWeek(new Date(first.getTime() + i * WEEK_MS)));
  const fits = Math.floor(LIMITS.rows / order.length);
  if (allWeeks.length > fits) {
    warn(`${order.length} groups x ${allWeeks.length} weeks is over ${LIMITS.rows} rows: kept the most recent ${fits} weeks`);
    allWeeks = allWeeks.slice(-fits);
  }

  const counts = new Map(); // "group\tweek" -> commits
  for (const c of commits) for (const g of c.groups) counts.set(`${g}\t${c.week}`, (counts.get(`${g}\t${c.week}`) ?? 0) + 1);
  return order.flatMap((group) => allWeeks.map((t) => ({
    group, t, value: counts.get(`${group}\t${t}`) ?? 0, label: `${group} · ${t}`,
  })));
}
