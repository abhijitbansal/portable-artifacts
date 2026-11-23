// scratchIgnoreNote asks git one question about a repository the user named (is .scratch/ ignored there?). That
// repository may not be the user's own, so the question must not let it run anything: not its core.fsmonitor command, not a
// lazy fetch through its uploadpack, not a `git` found through a PATH entry that names the repository, and not hang on a
// named pipe. Each test first proves with plain git that the plant is live (a control), so a pass means the code switched it off.
// The layer tests strip the other guards through the injectable `run`, so each guard is proved on its own.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scratchIgnoreNote } from '../output.mjs';
import {
  plant, scratchRepo, partialCloneWithMissingIgnore, plainGit, mkfifo, withEnv, plantGitAt, RELATIVE_PATHS, realPath, tmpDir, cleanUp,
  IN_REPO_ENTRIES, plantedPath,
} from './helpers/git-plants.mjs';

// The developer's own git config must not decide these tests: a global ignore rule that covers .scratch/ (core.excludesFile, or
// the default $XDG_CONFIG_HOME/git/ignore) would silence every note. This file runs in its own process, so the variables stay set.
const quietHome = tmpDir('pa-quiet-home-');
Object.assign(process.env, { HOME: quietHome, XDG_CONFIG_HOME: quietHome, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull });
after(() => cleanUp(quietHome));

const NOTE = /^note: \.scratch\/ is not gitignored in /;
const CHECK = ['check-ignore', '-q', '--', '.scratch/x.html'];

function inFolder(dir, fn) {
  const before = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(before);
  }
}

// A `run` that removes some of the guards before it calls the real spawnSync: 'no-index', 'fsmonitor', 'lazy'.
function without(...layers) {
  return (cmd, args, opts) => {
    const argv = [...args];
    const env = { ...opts.env };
    const drop = (item, count, before = 0) => { const at = argv.indexOf(item); if (at >= 0) argv.splice(at - before, count); };
    if (layers.includes('no-index')) drop('--no-index', 1);
    if (layers.includes('fsmonitor')) drop('core.fsmonitor=false', 2, 1);
    if (layers.includes('lazy')) delete env.GIT_NO_LAZY_FETCH;
    return spawnSync(cmd, argv, { ...opts, env });
  };
}

function fsmonitorRepo() {
  const repo = scratchRepo();
  const p = plant();
  fs.appendFileSync(path.join(repo.dir, '.git', 'config'), `[core]\n\tfsmonitor = ${p.script}\n`);
  return { ...repo, p, cleanup: () => { repo.cleanup(); p.cleanup(); } };
}

test('real git: a note when .scratch/ is not ignored, nothing when it is', () => {
  const repo = scratchRepo();
  try {
    assert.match(scratchIgnoreNote(repo.target), NOTE);
    fs.writeFileSync(path.join(repo.dir, '.gitignore'), '.scratch/\n');
    assert.equal(scratchIgnoreNote(repo.target), null);
  } finally {
    repo.cleanup();
  }
});

test('a repository whose config sets core.fsmonitor to a script never runs it through scratchIgnoreNote', () => {
  const repo = fsmonitorRepo();
  try {
    plainGit(repo.dir, CHECK);
    assert.equal(repo.p.ran(), true, 'control: plain git check-ignore runs the planted fsmonitor');
    repo.p.clear();
    assert.match(scratchIgnoreNote(repo.target), NOTE, 'the note still comes out');
    assert.equal(repo.p.ran(), false, 'scratchIgnoreNote ran the repository\'s core.fsmonitor command');
  } finally {
    repo.cleanup();
  }
});

test('a partial clone whose .gitignore blob is missing never lazy-fetches through its uploadpack', () => {
  const repo = partialCloneWithMissingIgnore();
  try {
    plainGit(repo.dir, CHECK);
    assert.equal(repo.p.ran(), true, 'control: plain git check-ignore lazy-fetches through the planted uploadpack');
    repo.p.clear();
    assert.match(scratchIgnoreNote(repo.target), NOTE);
    assert.equal(repo.p.ran(), false, 'scratchIgnoreNote ran remote.origin.uploadpack through a lazy fetch');
  } finally {
    repo.cleanup();
  }
});

test('a named pipe at .gitignore is stopped at the time limit: a null note, not a hang', (t) => {
  const repo = scratchRepo();
  try {
    fs.rmSync(path.join(repo.dir, '.gitignore'));
    if (!mkfifo(path.join(repo.dir, '.gitignore'))) return t.skip('mkfifo is not available here');
    assert.equal(plainGit(repo.dir, CHECK, { timeout: 1000 }).error?.code, 'ETIMEDOUT', 'control: plain git blocks on the pipe');
    const started = Date.now();
    assert.equal(scratchIgnoreNote(repo.target, { timeoutMs: 1000 }), null);
    assert.ok(Date.now() - started < 10000, `took ${Date.now() - started} ms`);
  } finally {
    repo.cleanup();
  }
});

test('the default time limit is 5 seconds, and git gets --no-index, the config overrides and the scrubbed environment', () => {
  const repo = scratchRepo();
  const seen = [];
  try {
    scratchIgnoreNote(repo.target, { run: (cmd, args, opts) => { seen.push({ cmd, args, opts }); return { status: 1 }; } });
    const [{ cmd, args, opts }] = seen;
    assert.equal(cmd, 'git');
    assert.equal(opts.timeout, 5000);
    assert.equal(opts.cwd, repo.dir);
    assert.ok(args.includes('--no-index'));
    assert.ok(args.join(' ').includes('-c core.fsmonitor=false'));
    assert.ok(args.join(' ').includes('-c core.hooksPath='));
    assert.equal(opts.env.GIT_NO_LAZY_FETCH, '1');
    assert.equal(opts.env.GIT_OPTIONAL_LOCKS, '0');
    assert.equal(opts.env.LC_ALL, 'C');
  } finally {
    repo.cleanup();
  }
});

test('any error, a timeout or a status other than 1 is a null note', () => {
  const repo = scratchRepo();
  try {
    for (const result of [{ status: 0 }, { status: 128 }, { status: null }, { error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }), status: null }, { error: Object.assign(new Error('x'), { code: 'ENOBUFS' }), status: 1 }]) {
      assert.equal(scratchIgnoreNote(repo.target, { run: () => result }), null, JSON.stringify(result));
    }
  } finally {
    repo.cleanup();
  }
});

// ---- Each guard on its own ------------------------------------------------------------------------------------------
test('control for the layer tests: with --no-index, the fsmonitor override and GIT_NO_LAZY_FETCH all removed, the plants run', () => {
  const a = fsmonitorRepo();
  const b = partialCloneWithMissingIgnore();
  try {
    scratchIgnoreNote(a.target, { run: without('no-index', 'fsmonitor', 'lazy') });
    assert.equal(a.p.ran(), true, 'the fsmonitor plant runs when every guard is stripped');
    scratchIgnoreNote(b.target, { run: without('no-index', 'fsmonitor', 'lazy') });
    assert.equal(b.p.ran(), true, 'the lazy-fetch plant runs when every guard is stripped');
  } finally {
    a.cleanup();
    b.cleanup();
  }
});

const LAYERS = [
  { name: '-c core.fsmonitor=false', strip: ['no-index', 'lazy'], repo: fsmonitorRepo },
  { name: '--no-index (against fsmonitor)', strip: ['fsmonitor', 'lazy'], repo: fsmonitorRepo },
  { name: '--no-index (against a lazy fetch)', strip: ['fsmonitor', 'lazy'], repo: partialCloneWithMissingIgnore },
  { name: 'GIT_NO_LAZY_FETCH=1', strip: ['fsmonitor', 'no-index'], repo: partialCloneWithMissingIgnore },
];
for (const { name, strip, repo: make } of LAYERS) {
  test(`${name} alone keeps the plant from running`, () => {
    const repo = make();
    try {
      scratchIgnoreNote(repo.target, { run: without(...strip) });
      assert.equal((repo.p).ran(), false);
    } finally {
      repo.cleanup();
    }
  });
}

// ---- A relative PATH entry names the repository itself ----------------------------------------------------------------
for (const { label, rel, path: pathOf } of RELATIVE_PATHS) {
  test(`a PATH with ${label} never runs a git planted in the repository`, () => {
    const repo = scratchRepo();
    const planted = plantGitAt(repo.dir, rel);
    try {
      const control = spawnSync('git', ['--version'], { cwd: repo.dir, env: { ...process.env, PATH: pathOf(realPath()) } });
      assert.ok(planted.ran(), `control: the planted git is what the PATH finds (exit ${control.status})`);
      fs.rmSync(planted.marker);
      // The build is run from inside the repository, as `node scripts/build.mjs` often is: the process folder is the repository.
      inFolder(repo.dir, () => withEnv({ PATH: pathOf(realPath()) }, () => assert.match(scratchIgnoreNote(repo.target), NOTE, 'the real git still answers through the absolute entries')));
      assert.equal(planted.ran(), false, 'the planted git ran');
    } finally {
      repo.cleanup();
    }
  });
}

// ---- an absolute PATH entry that lies inside the repository (npm run and direnv put <repo>/node_modules/.bin on PATH) ---------
for (const { label, symlink } of IN_REPO_ENTRIES) {
  test(`${label} never runs a git planted in the repository`, () => {
    const repo = scratchRepo();
    const plan = plantedPath(repo.dir, { symlink });
    try {
      assert.equal(plan.ranFrom(repo.dir), true, 'control: the planted git is what that PATH finds');
      inFolder(repo.dir, () => withEnv({ PATH: plan.PATH }, () => assert.match(scratchIgnoreNote(repo.target), NOTE, 'the real git still answers through the other entries')));
      assert.equal(plan.planted.ran(), false, 'the planted git ran');
    } finally {
      plan.cleanup();
      repo.cleanup();
    }
  });
}

test('a PATH whose only entry lies inside the repository is "git not found": nothing is run, the note is null', () => {
  const repo = scratchRepo();
  const plan = plantedPath(repo.dir);
  try {
    inFolder(repo.dir, () => withEnv({ PATH: path.join(repo.dir, 'node_modules', '.bin') }, () => assert.equal(scratchIgnoreNote(repo.target), null)));
    assert.equal(plan.planted.ran(), false, 'the planted git ran');
  } finally {
    repo.cleanup();
  }
});

test('a PATH with no absolute entry is "git not found": nothing is run, the note is null', () => {
  const repo = scratchRepo();
  const planted = plantGitAt(repo.dir, '.');
  try {
    inFolder(repo.dir, () => withEnv({ PATH: '.' }, () => assert.equal(scratchIgnoreNote(repo.target), null)));
    assert.equal(planted.ran(), false, 'the planted git ran');
  } finally {
    repo.cleanup();
  }
});
