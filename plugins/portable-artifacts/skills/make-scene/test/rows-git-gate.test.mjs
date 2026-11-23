// The second half of `rows.mjs git`'s guards (rows-history.test.mjs holds the first): which git runs, what a failed or oversized
// config listing means, and what a bare or mirror clone may do. Each marker test first proves with plain git that the plant is
// live (a control). Built-ins only; no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { historyRows, gitEnv } from '../scripts/lib/history-rows.mjs';
import {
  plant, plainGit, mustGit, plantGitAt, withEnv, withGitStub, RELATIVE_PATHS, realPath, cleanUp, tmpDir,
} from '../../../shared/test/helpers/git-plants.mjs';

const rows = (repo, extra = {}) => historyRows({ repo, weeks: 2, depth: 1, ...extra });
const total = (list) => list.reduce((sum, r) => sum + r.value, 0);

// A repository with one commit made now (inside the two-week window the tests ask for).
function fixture() {
  const dir = tmpDir('scene-gate-');
  mustGit(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), 'a\n');
  mustGit(dir, 'add', '-A');
  mustGit(dir, 'commit', '-q', '-m', 'base');
  return { dir, cleanup: () => cleanUp(dir) };
}

const onNth = (word, nth, action) => (dir) => `case " $* " in *" ${word} "*)
  n=$(cat '${dir}/n-${word}' 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > '${dir}/n-${word}'
  if [ "$n" -eq ${nth} ]; then ${action}; fi;;
esac`;
const logCalls = (dir) => `printf '%s\\n' "$*" >> '${dir}/calls'`;
const both = (...parts) => (dir) => parts.map((p) => p(dir)).join('\n');
const readCalls = (dir) => fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n');
const WELL_FORMED = "printf 'local\\0core.repositoryformatversion\\n0\\0'";

// ---- F2: a relative PATH entry names the repository itself ---------------------------------------------------------------
for (const { label, rel, path: pathOf } of RELATIVE_PATHS) {
  test(`rows git: a PATH with ${label} never runs a git planted in the repository, and still works`, () => {
    const repo = fixture();
    const planted = plantGitAt(repo.dir, rel);
    try {
      spawnSync('git', ['--version'], { cwd: repo.dir, env: { ...process.env, PATH: pathOf(realPath()) } });
      assert.equal(planted.ran(), true, 'control: the planted git is what that PATH finds from inside the repository');
      fs.rmSync(planted.marker);
      const list = withEnv({ PATH: pathOf(realPath()) }, () => rows(repo.dir));
      assert.equal(total(list), 1);
      assert.equal(planted.ran(), false, 'rows git ran the git planted in the repository');
    } finally {
      repo.cleanup();
    }
  });
}

test('rows git: a PATH with no absolute entry reports git as not found, and runs nothing', () => {
  const repo = fixture();
  const planted = plantGitAt(repo.dir, '.');
  try {
    withEnv({ PATH: '.' }, () => assert.throws(() => rows(repo.dir), /git is not installed or not on PATH/));
    assert.equal(planted.ran(), false, 'rows git ran the git planted in the repository');
  } finally {
    repo.cleanup();
  }
});

// ---- F18 and F12 ------------------------------------------------------------------------------------------------------------
test('the git environment drops the variables that point git at other files or change pathspec matching', () => {
  const dropped = ['GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE', 'GIT_REPLACE_REF_BASE', 'GIT_ATTR_SOURCE', 'GIT_REFERENCE_BACKEND', 'GIT_IMPLICIT_WORK_TREE',
    'GIT_PREFIX', 'GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS'];
  const env = gitEnv({ PATH: '/usr/bin', GIT_AUTHOR_NAME: 'A', ...Object.fromEntries(dropped.map((k) => [k, '1'])) });
  for (const k of dropped) assert.equal(Object.hasOwn(env, k), false, k);
  assert.equal(env.GIT_AUTHOR_NAME, 'A');
});

test('a stray GIT_REFERENCE_BACKEND or GIT_*_PATHSPECS in the environment does not change the rows', () => {
  const repo = fixture();
  try {
    const plain = rows(repo.dir);
    assert.deepEqual(withEnv({ GIT_REFERENCE_BACKEND: 'nonsense', GIT_ICASE_PATHSPECS: '1', GIT_GLOB_PATHSPECS: '1' }, () => rows(repo.dir)), plain);
  } finally {
    repo.cleanup();
  }
});

test('every git call runs with LC_ALL=C over the user\'s locale', () => {
  const repo = fixture();
  try {
    withEnv({ LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' }, () => withGitStub((dir) => `echo "$LC_ALL" >> '${dir}/loc'`, (dir) => {
      rows(repo.dir);
      const seen = fs.readFileSync(path.join(dir, 'loc'), 'utf8').trim().split('\n');
      assert.ok(seen.length >= 3 && seen.every((l) => l === 'C'), seen.join(' '));
    }));
  } finally {
    repo.cleanup();
  }
});

// ---- F4, F15, F16: one listing call, a 16 MiB limit, errors reported as themselves ----------------------------------------
test('a config listing over 16 MiB is refused in words, with no second git call', () => {
  const repo = fixture();
  try {
    withGitStub(both(logCalls, onNth('--show-scope', 1, 'head -c 17000000 /dev/zero; exit 0')), (dir) => {
      assert.throws(() => rows(repo.dir), /git config of .* is over 16 MiB/);
      assert.match(readCalls(dir).at(-1), /--show-scope/, 'the listing is the last git call');
    });
  } finally {
    repo.cleanup();
  }
});

test('a config listing that times out is reported as a timeout, with no second git call', () => {
  const repo = fixture();
  try {
    withGitStub(both(logCalls, onNth('--show-scope', 1, 'exec sleep 20')), (dir) => {
      assert.throws(() => rows(repo.dir, { _test: { timeoutMs: 500 } }), /git did not finish within 0\.5 seconds/);
      assert.match(readCalls(dir).at(-1), /--show-scope/, 'no rev-parse follows the timeout');
    });
  } finally {
    repo.cleanup();
  }
});

test('a config listing of about 1.6 MB (9000 branch sections) is read, not refused as unreadable', () => {
  const repo = fixture();
  try {
    const sections = Array.from({ length: 9000 }, (_, i) => `[branch "feature/long-branch-name-number-${i}"]\n\tremote = origin\n\tmerge = refs/heads/feature/long-branch-name-number-${i}\n`).join('');
    fs.appendFileSync(path.join(repo.dir, '.git', 'config'), sections);
    assert.ok(plainGit(repo.dir, ['config', '--list', '--show-scope', '-z']).out.length > 1024 * 1024, 'control: the listing is over the 1 MiB default of spawnSync');
    assert.equal(total(rows(repo.dir)), 1);
  } finally {
    repo.cleanup();
  }
});

// ---- F10 and F5 ------------------------------------------------------------------------------------------------------------
test('a well-formed config listing that exits 1 is refused, not trusted', () => {
  const repo = fixture();
  try {
    withGitStub(onNth('--show-scope', 1, `${WELL_FORMED}; exit 1`), () => assert.throws(() => rows(repo.dir), /cannot read the git config/));
  } finally {
    repo.cleanup();
  }
});

test('a repository whose config has no core.repositoryformatversion is still read', () => {
  const repo = fixture();
  try {
    mustGit(repo.dir, 'config', '--unset', 'core.repositoryformatversion');
    assert.equal(plainGit(repo.dir, ['log', '-1', '--format=%s']).status, 0, 'control: git itself reads the repository');
    assert.equal(total(rows(repo.dir)), 1);
  } finally {
    repo.cleanup();
  }
});

// ---- F6: a bare or mirror clone named as --repo works, and its planted config still runs nothing -----------------------------
for (const flag of ['--bare', '--mirror']) {
  test(`a ${flag} clone named as --repo gives rows (as in 2.4.0)`, () => {
    const repo = fixture();
    const root = tmpDir('scene-gate-bare-');
    try {
      mustGit(root, 'clone', '-q', flag, `file://${repo.dir}`, path.join(root, 'b.git'));
      assert.equal(plainGit(path.join(root, 'b.git'), ['rev-parse', '--is-bare-repository']).out.trim(), 'true', 'control: it is bare');
      assert.equal(total(rows(path.join(root, 'b.git'))), 1);
    } finally {
      repo.cleanup();
      cleanUp(root);
    }
  });
}

test('a filter, an fsmonitor command and a lazy fetch planted in a bare repository never run', () => {
  const repo = fixture();
  const root = tmpDir('scene-gate-bare-');
  const p = plant();
  try {
    const bare = path.join(root, 'b.git');
    const work = path.join(root, 'work');
    mustGit(root, 'clone', '-q', '--bare', `file://${repo.dir}`, bare);
    fs.mkdirSync(path.join(work, 'src'), { recursive: true });
    fs.writeFileSync(path.join(work, 'src', 'a.js'), 'changed\n');
    fs.mkdirSync(path.join(bare, 'info'), { recursive: true });
    fs.writeFileSync(path.join(bare, 'info', 'attributes'), '* filter=evil\n');
    fs.appendFileSync(path.join(bare, 'config'), `[core]\n\tfsmonitor = ${p.script}\n[filter "evil"]\n\tclean = ${p.script}\n`);
    plainGit(bare, ['--work-tree', work, 'status', '--porcelain']);
    assert.equal(p.ran(), true, 'control: plain git given a work tree runs the planted fsmonitor');
    p.clear();
    plainGit(bare, ['--work-tree', work, 'add', 'src/a.js']);
    assert.match(fs.readFileSync(p.marker, 'utf8'), /x\.sh/, 'control: plain git add runs the planted clean filter');
    p.clear();
    assert.equal(total(rows(bare)), 1);
    assert.equal(p.ran(), false, 'rows git ran a program planted in the bare repository');
  } finally {
    repo.cleanup();
    p.cleanup();
    cleanUp(root);
  }
});

test('a bare partial clone is refused before git log runs, and its uploadpack never runs', () => {
  const repo = fixture();
  const root = tmpDir('scene-gate-bare-');
  const p = plant('exit 1');
  try {
    mustGit(repo.dir, 'config', 'uploadpack.allowFilter', 'true');
    mustGit(repo.dir, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    const bare = path.join(root, 'b.git');
    mustGit(root, 'clone', '-q', '--bare', '--filter=blob:none', `file://${repo.dir}`, bare);
    fs.appendFileSync(path.join(bare, 'config'), `[remote "origin"]\n\tuploadpack = ${p.script}\n`);
    plainGit(bare, ['log', '--numstat', '-1']);
    assert.equal(p.ran(), true, 'control: plain git log lazy-fetches through the planted uploadpack');
    p.clear();
    assert.throws(() => rows(bare, { _test: { omitLazyFetchEnv: true } }), /this is a partial clone .*full clone/);
    assert.equal(p.ran(), false, 'rows git ran the uploadpack');
  } finally {
    repo.cleanup();
    p.cleanup();
    cleanUp(root);
  }
});

test('a folder that holds a repository with a work tree, planted with an fsmonitor command, runs nothing', () => {
  const repo = fixture();
  const root = tmpDir('scene-gate-planted-');
  const p = plant();
  try {
    const planted = path.join(root, 'planted');
    mustGit(root, 'clone', '-q', '--bare', `file://${repo.dir}`, planted);
    fs.mkdirSync(path.join(root, 'work'));
    fs.appendFileSync(path.join(planted, 'config'), `[core]\n\tbare = false\n\tworktree = ${path.join(root, 'work')}\n\tfsmonitor = ${p.script}\n`);
    plainGit(planted, ['status', '--porcelain']);
    assert.equal(p.ran(), true, 'control: plain git status in the planted folder runs its fsmonitor command');
    p.clear();
    assert.equal(total(rows(planted)), 1);
    assert.equal(p.ran(), false, 'rows git ran the planted core.fsmonitor command');
  } finally {
    repo.cleanup();
    p.cleanup();
    cleanUp(root);
  }
});
