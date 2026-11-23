// Fixtures for the tests that prove a repository's own config cannot make the page builders run a program. Every
// plant is a script that only records that it ran; each test first shows with plain git that the plant is live (a
// control), so a pass means the code switched it off and not that the plant was wrong. Built-ins only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REDIRECTING_ENV, CONFIG_PAIR_ENV, PATHSPECS_ENV } from '../../git-run.mjs';

const IDENTITY = {
  GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull,
  GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com',
};

export const tmpDir = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
export const cleanUp = (...dirs) => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); };
export const mkfifo = (file) => spawnSync('mkfifo', [file]).status === 0;

/** The environment of a test's own git: the developer's, without the variables that redirect git (a hook or `git rebase --exec` exports GIT_DIR and friends). */
const withoutRedirects = (source) => Object.fromEntries(Object.entries(source)
  .filter(([key]) => !REDIRECTING_ENV.has(key) && !CONFIG_PAIR_ENV.test(key) && !PATHSPECS_ENV.test(key)));

/**
 * Plain git (the control): the developer's environment (minus the redirecting GIT_ variables) plus null config files and a fixed
 * identity; an `env` value of undefined removes the variable. `input` goes to stdin. -> { status, out, err, error }.
 */
export function plainGit(cwd, args, { env = {}, timeout = 15000, input } = {}) {
  const merged = Object.entries({ ...withoutRedirects(process.env), ...IDENTITY, ...env }).filter(([, value]) => value !== undefined);
  // maxBuffer: spawnSync's default 1 MiB cuts the output of a long listing (and with GIT_TRACE set the cut lands under 1 MiB).
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: Object.fromEntries(merged), timeout, killSignal: 'SIGKILL', input, maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', error: r.error };
}

export function mustGit(cwd, ...args) {
  const r = plainGit(cwd, ['-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${os.devNull}`, ...args]);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.err}`);
  return r.out.trim();
}

/** A script that records that it ran, in a folder of its own. `body` runs after the record (default: cat, a pass-through filter). */
export function plant(body = 'cat') {
  const dir = tmpDir('pa-plant-');
  const marker = path.join(dir, 'ran');
  const script = path.join(dir, 'x.sh');
  fs.writeFileSync(script, `#!/bin/sh\necho "$0 $*" >> '${marker}'\n${body}\n`, { mode: 0o755 });
  return { script, marker, dir, ran: () => fs.existsSync(marker), clear: () => fs.rmSync(marker, { force: true }), cleanup: () => cleanUp(dir) };
}

/** A repository with one commit and a `.scratch/` folder that no ignore rule covers. */
export function scratchRepo() {
  const dir = tmpDir('pa-scratch-');
  mustGit(dir, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.log\n');
  mustGit(dir, 'add', '-A');
  mustGit(dir, 'commit', '-q', '-m', 'base');
  fs.mkdirSync(path.join(dir, '.scratch'));
  return { dir, target: path.join(dir, '.scratch', 'x.html'), cleanup: () => cleanUp(dir) };
}

/**
 * A partial clone of a one-commit repository, checked out without blobs: `.gitignore` is skip-worktree in the index and
 * its blob is missing, so a plain `git check-ignore` has to lazy-fetch it, which runs remote.origin.uploadpack (a plant).
 * -> { dir, target, p (the plant), cleanup }.
 */
export function partialCloneWithMissingIgnore() {
  const source = tmpDir('pa-src-');
  const holder = tmpDir('pa-clone-');
  const dir = path.join(holder, 'c');
  const p = plant('exit 1');
  mustGit(source, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(source, '.gitignore'), '*.log\n');
  fs.writeFileSync(path.join(source, 'a.txt'), 'a\n');
  mustGit(source, 'add', '-A');
  mustGit(source, 'commit', '-q', '-m', 'base');
  mustGit(source, 'config', 'uploadpack.allowFilter', 'true');
  mustGit(source, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
  mustGit(source, 'clone', '-q', '--no-checkout', '--filter=blob:none', `file://${source}`, dir);
  mustGit(dir, 'read-tree', 'HEAD');
  mustGit(dir, 'update-index', '--skip-worktree', '.gitignore');
  fs.appendFileSync(path.join(dir, '.git', 'config'), `[remote "origin"]\n\tuploadpack = ${p.script}\n`);
  fs.mkdirSync(path.join(dir, '.scratch'));
  return { dir, target: path.join(dir, '.scratch', 'x.html'), p, cleanup: () => { cleanUp(source, holder); p.cleanup(); } };
}

/** An executable named `git` at <dir>/<rel>/git that records that it ran and fails. */
export function plantGitAt(dir, rel) {
  const marker = path.join(dir, `${rel.replace(/[^a-z0-9]+/gi, '_')}.ran`);
  const folder = path.join(dir, rel);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'git'), `#!/bin/sh\necho "$0 $*" >> '${marker}'\nexit 1\n`, { mode: 0o755 });
  return { marker, ran: () => fs.existsSync(marker) };
}

/** Run fn with these variables set in process.env (undefined deletes), then restore them. */
export function withEnv(vars, fn) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * A stand-in `git` first on PATH: it runs `before(dir)` (a shell fragment), then the real git. `dir` is the stub's own folder;
 * fn gets it. The shell fragment can append to files in it (a call log) or end the call early.
 */
export function withGitStub(before, fn) {
  const real = process.env.PATH.split(path.delimiter).map((d) => path.join(d, 'git')).find((p) => fs.existsSync(p));
  const dir = tmpDir('pa-stub-');
  fs.writeFileSync(path.join(dir, 'git'), `#!/bin/sh\n${before(dir)}\nexec '${real}' "$@"\n`, { mode: 0o755 });
  return withEnv({ PATH: `${dir}${path.delimiter}${process.env.PATH}` }, () => {
    try {
      return fn(dir);
    } finally {
      cleanUp(dir);
    }
  });
}

/** The three ways a PATH entry can name the repository itself. `rel` is where the planted `git` goes. */
export const RELATIVE_PATHS = [
  { label: 'a "." entry', rel: '.', path: (real) => `.${path.delimiter}${real}` },
  { label: 'a leading empty entry', rel: '.', path: (real) => `${path.delimiter}${real}` },
  { label: 'a node_modules/.bin entry', rel: 'node_modules/.bin', path: (real) => `node_modules/.bin${path.delimiter}${real}` },
];
export const realPath = () => process.env.PATH.split(path.delimiter).filter((e) => path.isAbsolute(e)).join(path.delimiter);

/** How an absolute PATH entry can name a folder inside the repository: directly, or through a symlink that lives outside it. */
export const IN_REPO_ENTRIES = [
  { label: 'an absolute node_modules/.bin entry', symlink: false },
  { label: 'a symlinked entry that resolves to node_modules/.bin', symlink: true },
];

/**
 * A `git` planted at <repo>/node_modules/.bin and the PATH that reaches it (first) before the real one. `ranFrom(cwd)` is the
 * control: it starts git by name with that PATH in `cwd`, then reports whether the planted one ran (and clears the record).
 * -> { planted, PATH, ranFrom, cleanup }.
 */
export function plantedPath(repoDir, { symlink = false } = {}) {
  const rel = 'node_modules/.bin';
  const planted = plantGitAt(repoDir, rel);
  const holder = symlink ? tmpDir('pa-link-') : null;
  const entry = symlink ? path.join(holder, 'bin') : path.join(repoDir, rel);
  if (symlink) fs.symlinkSync(path.join(repoDir, rel), entry);
  const PATH = `${entry}${path.delimiter}${realPath()}`;
  const ranFrom = (cwd) => {
    spawnSync('git', ['--version'], { cwd, env: { ...process.env, PATH }, timeout: 15000, killSignal: 'SIGKILL' });
    const ran = planted.ran();
    fs.rmSync(planted.marker, { force: true });
    return ran;
  };
  return { planted, PATH, ranFrom, cleanup: () => { if (holder) cleanUp(holder); } };
}

/**
 * Makes a commit on top of HEAD that carries a `gpgsig` header (git never checks it unless something asks), moves the checked-out
 * branch to it, and returns its sha. With log.showSignature=true, `git log` would then run gpg.program to verify it.
 * `file` (a name in the folder) is written and committed with it, so the commit changes something.
 */
export function signedCommit(dir, subject = 'signed', file = null) {
  if (file) {
    fs.writeFileSync(path.join(dir, file), `${subject}\n`);
    mustGit(dir, 'add', file);
  }
  const tree = file ? mustGit(dir, 'write-tree') : mustGit(dir, 'rev-parse', 'HEAD^{tree}');
  const parent = mustGit(dir, 'rev-parse', 'HEAD');
  const now = Math.floor(Date.now() / 1000);
  const person = `T <t@example.com> ${now} +0000`;
  const body = `tree ${tree}\nparent ${parent}\nauthor ${person}\ncommitter ${person}\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n aGVsbG8=\n -----END PGP SIGNATURE-----\n\n${subject}\n`;
  const made = plainGit(dir, ['hash-object', '-t', 'commit', '-w', '--stdin'], { input: body });
  if (made.status !== 0) throw new Error(`hash-object failed: ${made.err}`);
  const sha = made.out.trim();
  mustGit(dir, 'reset', '-q', '--hard', sha);
  return sha;
}

/** Config that makes git verify signatures on `git log` with the planted script as gpg.program. Append to <repo>/.git/config. */
export const showSignatureConfig = (script) => `[log]\n\tshowSignature = true\n[gpg]\n\tprogram = ${script}\n`;
