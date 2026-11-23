// The second half of gather's guards (git-hardening.test.mjs holds the first): which git runs, what its environment is,
// what a failed or oversized call means, which config values trip the dirty-check skip, and what the guards still allow.
// Each marker test first proves with plain git that the plant is live (a control). Built-ins only; no browser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gatherGit, gitEnv } from '../scripts/lib/git.mjs';
import { makeRepo, featureRepo, git } from './helpers/repo.mjs';
import {
  plant, plainGit, plantGitAt, withEnv, withGitStub, RELATIVE_PATHS, realPath, cleanUp, tmpDir,
  IN_REPO_ENTRIES, plantedPath, signedCommit, showSignatureConfig,
} from '../../../shared/test/helpers/git-plants.mjs';

// A home folder with no git config of its own, for the tests that must not read the developer's.
const quietHome = tmpDir('explainer-gate-home-');
after(() => cleanUp(quietHome));

const SKIP_WARNING = /own git config defines a filter driver or a git-lfs extension.*skipped the uncommitted-changes check/;
const FAILED_WARNING = /git status failed or was stopped, so the uncommitted-changes check did not run/;
const appendConfig = (repo, text) => fs.appendFileSync(path.join(repo.dir, '.git', 'config'), text);
const touch = (file, seconds) => fs.utimesSync(file, Date.now() / 1000 + seconds, Date.now() / 1000 + seconds);
const readCalls = (dir) => fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n');

// The nth call whose arguments contain `word` runs `action` (a shell fragment); every other call runs the real git.
const onNth = (word, nth, action) => (dir) => `case " $* " in *" ${word} "*)
  n=$(cat '${dir}/n-${word}' 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > '${dir}/n-${word}'
  if [ "$n" -eq ${nth} ]; then ${action}; fi;;
esac`;
const logCalls = (dir) => `printf '%s\\n' "$*" >> '${dir}/calls'`;
const both = (...parts) => (dir) => parts.map((p) => p(dir)).join('\n');

// A well-formed listing ends in a NUL after every entry: `scope NUL key LF value NUL`.
const WELL_FORMED = "printf 'local\\0core.repositoryformatversion\\n0\\0'";

// ---- F2: a relative PATH entry names the repository itself ---------------------------------------------------------------
for (const { label, rel, path: pathOf } of RELATIVE_PATHS) {
  test(`gather: a PATH with ${label} never runs a git planted in the repository, and still works`, () => {
    const repo = featureRepo();
    const planted = plantGitAt(repo.dir, rel);
    try {
      spawnSync('git', ['--version'], { cwd: repo.dir, env: { ...process.env, PATH: pathOf(realPath()) } });
      assert.equal(planted.ran(), true, 'control: the planted git is what that PATH finds from inside the repository');
      fs.rmSync(planted.marker);
      const facts = withEnv({ PATH: pathOf(realPath()) }, () => gatherGit({ repo: repo.dir }));
      assert.equal(facts.branch, 'feat/login');
      assert.equal(planted.ran(), false, 'gather ran the git planted in the repository');
    } finally {
      repo.cleanup();
    }
  });
}

test('gather: a PATH with no absolute entry reports git as not found, and runs nothing', () => {
  const repo = featureRepo();
  const planted = plantGitAt(repo.dir, '.');
  try {
    withEnv({ PATH: '.' }, () => assert.throws(() => gatherGit({ repo: repo.dir }), /git is not installed or not on PATH/));
    assert.equal(planted.ran(), false, 'gather ran the git planted in the repository');
  } finally {
    repo.cleanup();
  }
});

// ---- F18: more variables that point git elsewhere or change how it matches ------------------------------------------------
test('gitEnv drops the variables that point git at other files or change pathspec matching', () => {
  const dropped = ['GIT_SHALLOW_FILE', 'GIT_GRAFT_FILE', 'GIT_REPLACE_REF_BASE', 'GIT_ATTR_SOURCE', 'GIT_REFERENCE_BACKEND', 'GIT_IMPLICIT_WORK_TREE',
    'GIT_PREFIX', 'GIT_LITERAL_PATHSPECS', 'GIT_GLOB_PATHSPECS', 'GIT_NOGLOB_PATHSPECS', 'GIT_ICASE_PATHSPECS'];
  const env = gitEnv({ PATH: '/usr/bin', GIT_AUTHOR_NAME: 'A', ...Object.fromEntries(dropped.map((k) => [k, '1'])) });
  for (const k of dropped) assert.equal(Object.hasOwn(env, k), false, k);
  assert.equal(env.GIT_AUTHOR_NAME, 'A');
});

test('a stray GIT_REFERENCE_BACKEND or GIT_*_PATHSPECS in the environment does not change what gather reports', () => {
  const repo = featureRepo();
  try {
    const plain = gatherGit({ repo: repo.dir });
    const facts = withEnv({ GIT_REFERENCE_BACKEND: 'nonsense', GIT_ICASE_PATHSPECS: '1', GIT_GLOB_PATHSPECS: '1' }, () => gatherGit({ repo: repo.dir }));
    assert.deepEqual(facts, plain);
  } finally {
    repo.cleanup();
  }
});

// ---- F7: a failed check is never read as a clean one ---------------------------------------------------------------------
test('a failed ls-tree counts as a .lfsconfig hit: the dirty check is skipped', () => {
  const repo = featureRepo();
  try {
    withGitStub(onNth('ls-tree', 1, 'exit 128'), () => {
      const facts = gatherGit({ repo: repo.dir });
      assert.equal(facts.dirty, null);
      assert.ok(facts.warnings.some((w) => SKIP_WARNING.test(w)), facts.warnings.join('\n'));
    });
  } finally {
    repo.cleanup();
  }
});

test('a corrupt index makes git status fail: dirty is null with a warning that says the check failed, never false', () => {
  const repo = featureRepo();
  try {
    fs.writeFileSync(path.join(repo.dir, '.git', 'index'), 'not an index');
    assert.notEqual(plainGit(repo.dir, ['status', '--porcelain']).status, 0, 'control: plain git status fails on it');
    const facts = gatherGit({ repo: repo.dir });
    assert.equal(facts.dirty, null);
    assert.ok(facts.warnings.some((w) => FAILED_WARNING.test(w)), facts.warnings.join('\n'));
    assert.ok(!facts.warnings.some((w) => SKIP_WARNING.test(w)), 'the config-skip warning names a different cause');
  } finally {
    repo.cleanup();
  }
});

test('a git status that does not finish in the time limit is killed: dirty is null with the same warning', () => {
  const repo = featureRepo();
  try {
    withGitStub(onNth('status', 1, 'exec sleep 20'), () => {
      const facts = gatherGit({ repo: repo.dir, _test: { timeoutMs: 1000 } });
      assert.equal(facts.dirty, null);
      assert.ok(facts.warnings.some((w) => FAILED_WARNING.test(w)), facts.warnings.join('\n'));
    });
  } finally {
    repo.cleanup();
  }
});

test('GIT_ICASE_PATHSPECS in the environment does not hide a .lfsconfig that is only in HEAD', () => {
  const repo = makeRepo();
  try {
    repo.write('.lfsconfig', '[lfs]\n\turl = https://example.invalid/lfs\n');
    repo.write('a.txt', 'a\n');
    repo.commit('chore: base');
    git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
    repo.write('b.txt', 'b\n');
    repo.commit('feat: b');
    repo.remove('.lfsconfig');
    const facts = withEnv({ GIT_ICASE_PATHSPECS: '1', GIT_GLOB_PATHSPECS: '1' }, () => gatherGit({ repo: repo.dir }));
    assert.equal(facts.dirty, null);
  } finally {
    repo.cleanup();
  }
});

// ---- F3 and F8b: which values and keys trip the skip ---------------------------------------------------------------------
test('an ordinary branch description (git branch --edit-description writes a trailing newline) does not skip the dirty check', () => {
  const repo = featureRepo();
  try {
    git(repo.dir, 'config', 'branch.feat/login.description', 'what this branch is for\n\n');
    assert.equal(plainGit(repo.dir, ['config', '-z', '--get', 'branch.feat/login.description']).out, 'what this branch is for\n\n\0', 'control: the value holds line breaks');
    const facts = gatherGit({ repo: repo.dir });
    assert.equal(facts.dirty, false);
    assert.deepEqual(facts.warnings, []);
  } finally {
    repo.cleanup();
  }
});

const FORGED = {
  'after an LF': 'x\\nlfs.extension.evil.clean=/bin/true',
  'after an LF, indented and in capitals': 'x\\n   LFS.Extension.evil.clean=/bin/true',
  'after a second line': 'x\\ny\\nlfs.extension.evil.clean=/bin/true',
};
for (const [label, value] of Object.entries(FORGED)) {
  test(`a repository-owned value that forges an lfs. line ${label} skips the dirty check`, () => {
    const repo = featureRepo();
    try {
      appendConfig(repo, `[core]\n\tnotes = "${value}"\n`);
      const facts = gatherGit({ repo: repo.dir });
      assert.equal(facts.dirty, null);
      assert.ok(facts.warnings.some((w) => SKIP_WARNING.test(w)), facts.warnings.join('\n'));
    } finally {
      repo.cleanup();
    }
  });
}

test('a value with a second line that does not start with lfs. does not skip the dirty check', () => {
  const repo = featureRepo();
  try {
    appendConfig(repo, '[core]\n\tnotes = "x\\nfilterx.y=1\\nz"\n');
    assert.equal(gatherGit({ repo: repo.dir }).dirty, false);
  } finally {
    repo.cleanup();
  }
});

test('an lfs. key that holds a byte above 0x7f skips the dirty check (a git-lfs that folds case would read it as an extension)', () => {
  const repo = featureRepo();
  try {
    fs.appendFileSync(path.join(repo.dir, '.git', 'config'), Buffer.from('[lfs "extens\xc4\xb0on.evil"]\n\tclean = /bin/true %f\n', 'latin1'));
    const facts = gatherGit({ repo: repo.dir });
    assert.equal(facts.dirty, null);
    assert.ok(facts.warnings.some((w) => SKIP_WARNING.test(w)), facts.warnings.join('\n'));
  } finally {
    repo.cleanup();
  }
});

// ---- F4, F15, F16: one listing call, a 16 MiB limit, errors reported as themselves ----------------------------------------
test('a config listing over 16 MiB is refused in words, with no second git call', () => {
  const repo = featureRepo();
  try {
    withGitStub(both(logCalls, onNth('--show-scope', 1, 'head -c 17000000 /dev/zero; exit 0')), (dir) => {
      assert.throws(() => gatherGit({ repo: repo.dir }), /git config of .* is over 16 MiB/);
      assert.match(readCalls(dir).at(-1), /--show-scope/, 'the listing is the last git call');
    });
  } finally {
    repo.cleanup();
  }
});

test('a config listing that times out is reported as a timeout, with no second git call', () => {
  const repo = featureRepo();
  try {
    withGitStub(both(logCalls, onNth('--show-scope', 1, 'exec sleep 20')), (dir) => {
      assert.throws(() => gatherGit({ repo: repo.dir, _test: { timeoutMs: 2000 } }), /git did not finish within 2 seconds/);
      assert.match(readCalls(dir).at(-1), /--show-scope/, 'the listing is the last git call');
    });
  } finally {
    repo.cleanup();
  }
});

// The limit only has to be well under the stub's `sleep 20`; the size case needs no short limit at all (about a dozen git calls come before it).
for (const [label, action, timeoutMs, message] of [['over 16 MiB', 'head -c 17000000 /dev/zero; exit 0', 30000, /is over 16 MiB/], ['not finished in the time limit', 'exec sleep 20', 2000, /did not finish within 2 seconds/]]) {
  test(`the second config listing ${label} is reported as itself, not as a skipped check`, () => {
    const repo = featureRepo();
    try {
      withGitStub(onNth('--show-scope', 2, action), () => assert.throws(() => gatherGit({ repo: repo.dir, _test: { timeoutMs } }), message));
    } finally {
      repo.cleanup();
    }
  });
}

// ---- F5: the marker for a readable listing is any entry of the repository's own ---------------------------------------------
test('a repository whose config has no core.repositoryformatversion is still read', () => {
  const repo = featureRepo();
  try {
    git(repo.dir, 'config', '--unset', 'core.repositoryformatversion');
    assert.equal(plainGit(repo.dir, ['log', '-1', '--format=%s']).status, 0, 'control: git itself reads the repository');
    const facts = gatherGit({ repo: repo.dir });
    assert.equal(facts.branch, 'feat/login');
    assert.equal(facts.dirty, false);
  } finally {
    repo.cleanup();
  }
});

test('a listing with no entry of the repository\'s own is refused', () => {
  const repo = featureRepo();
  try {
    withGitStub(onNth('--show-scope', 1, "printf 'global\\0core.repositoryformatversion\\n0\\0'; exit 0"), () => {
      assert.throws(() => gatherGit({ repo: repo.dir }), /cannot read the git config/);
    });
  } finally {
    repo.cleanup();
  }
});

// ---- F10: a well-formed listing from a git that exits non-zero is not trusted ------------------------------------------------
test('a well-formed config listing that exits 1 is refused (first listing)', () => {
  const repo = featureRepo();
  try {
    withGitStub(onNth('--show-scope', 1, `${WELL_FORMED}; exit 1`), () => assert.throws(() => gatherGit({ repo: repo.dir }), /cannot read the git config/));
  } finally {
    repo.cleanup();
  }
});

test('a well-formed config listing that exits 1 skips the dirty check (second listing)', () => {
  const repo = featureRepo();
  try {
    withGitStub(onNth('--show-scope', 2, `${WELL_FORMED}; exit 1`), () => {
      const facts = gatherGit({ repo: repo.dir });
      assert.equal(facts.dirty, null);
      assert.ok(facts.warnings.some((w) => SKIP_WARNING.test(w)), facts.warnings.join('\n'));
    });
  } finally {
    repo.cleanup();
  }
});

// ---- F11: hooks and a planted bare repository ---------------------------------------------------------------------------------
// A hook file runs only when git itself rewrites the index, and gather runs with GIT_OPTIONAL_LOCKS=0, so `status` rewrites nothing:
// the hook does not run on gather even without the hooksPath override. The override is defence in depth; this test proves the
// observable fact (no hook ran, the index is unchanged), and the control proves the plant is live under plain git.
test('a .git/hooks/post-index-change hook does not run during gather, and the index is left as it was', () => {
  const repo = featureRepo();
  const p = plant();
  try {
    const hook = path.join(repo.dir, '.git', 'hooks', 'post-index-change');
    fs.mkdirSync(path.dirname(hook), { recursive: true });
    fs.writeFileSync(hook, `#!/bin/sh\necho ran >> '${p.marker}'\n`, { mode: 0o755 });
    touch(path.join(repo.dir, 'README.md'), 60);
    plainGit(repo.dir, ['status', '--porcelain']);
    assert.equal(p.ran(), true, 'control: plain git status rewrites the index and runs the hook');
    p.clear();
    touch(path.join(repo.dir, 'README.md'), 120);
    const index = path.join(repo.dir, '.git', 'index');
    const before = fs.readFileSync(index);
    gatherGit({ repo: repo.dir });
    assert.equal(p.ran(), false, 'gather ran the repository\'s hook');
    assert.ok(fs.readFileSync(index).equals(before), 'gather rewrote the index (GIT_OPTIONAL_LOCKS=0 is missing)');
  } finally {
    p.cleanup();
    repo.cleanup();
  }
});

test('a bare repository that names a work tree, planted as the folder, is not entered by gather', () => {
  const root = tmpDir('explainer-bare-');
  const p = plant();
  try {
    const source = makeRepo();
    source.write('a.txt', 'a\n');
    source.commit('chore: base');
    const bare = path.join(root, 'planted');
    git(root, 'clone', '-q', '--bare', `file://${source.dir}`, bare);
    source.cleanup();
    const work = path.join(root, 'work');
    fs.mkdirSync(work);
    fs.appendFileSync(path.join(bare, 'config'), `[core]\n\tbare = false\n\tworktree = ${work}\n\tfsmonitor = ${p.script}\n`);
    plainGit(bare, ['status', '--porcelain']);
    assert.equal(p.ran(), true, 'control: plain git status in the planted folder runs its fsmonitor command');
    p.clear();
    assert.throws(() => gatherGit({ repo: bare }), /no work tree|not a git repository|cannot use bare/);
    assert.equal(p.ran(), false, 'gather ran the planted repository\'s core.fsmonitor command');
  } finally {
    p.cleanup();
    cleanUp(root);
  }
});

// ---- GIT_OPTIONAL_LOCKS: gather writes nothing to the repository ----------------------------------------------------------------
test('gather leaves the index bytes unchanged after a file was touched (control: plain git status rewrites them)', () => {
  const repo = featureRepo();
  try {
    const index = path.join(repo.dir, '.git', 'index');
    touch(path.join(repo.dir, 'README.md'), 60);
    const before = fs.readFileSync(index);
    plainGit(repo.dir, ['status', '--porcelain']);
    assert.ok(!fs.readFileSync(index).equals(before), 'control: plain git status refreshes and rewrites the index');
    touch(path.join(repo.dir, 'README.md'), 120);
    const after = fs.readFileSync(index);
    gatherGit({ repo: repo.dir });
    assert.ok(fs.readFileSync(index).equals(after), 'gather rewrote the index');
  } finally {
    repo.cleanup();
  }
});

// ---- F12: the user's locale for status, C for every other call --------------------------------------------------------------------
test('every git call runs with LC_ALL=C except status, which keeps the user\'s locale (a global filter may depend on it)', () => {
  const repo = featureRepo();
  const log = (dir) => `case " $* " in *" status "*) echo "status:$LC_ALL" >> '${dir}/loc';; *) echo "other:$LC_ALL" >> '${dir}/loc';; esac`;
  try {
    withEnv({ LC_ALL: 'en_US.UTF-8', LANG: 'en_US.UTF-8' }, () => withGitStub(log, (dir) => {
      gatherGit({ repo: repo.dir });
      const seen = fs.readFileSync(path.join(dir, 'loc'), 'utf8').trim().split('\n');
      assert.deepEqual(seen.filter((l) => l.startsWith('status:')), ['status:en_US.UTF-8']);
      assert.ok(seen.length > 8 && seen.filter((l) => l.startsWith('other:')).every((l) => l === 'other:C'), seen.join(' '));
    }));
  } finally {
    repo.cleanup();
  }
});

test('gitEnv keeps the user\'s locale when asked (the status call), and sets LC_ALL=C otherwise', () => {
  const source = { PATH: '/usr/bin', LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8' };
  assert.equal(gitEnv(source).LC_ALL, 'C');
  assert.equal(gitEnv(source, { keepLocale: true }).LC_ALL, 'de_DE.UTF-8');
  assert.equal(gitEnv({ PATH: '/usr/bin' }, { keepLocale: true }).LC_ALL, undefined);
});

// ---- an absolute PATH entry that lies inside the repository (npm run and direnv put <repo>/node_modules/.bin on PATH) ---------
for (const { label, symlink } of IN_REPO_ENTRIES) {
  for (const where of ['', 'src']) {
    test(`gather: ${label} never runs a git planted in the repository, from ${where === '' ? 'its root' : 'a subfolder'}`, () => {
      const repo = featureRepo();
      const plan = plantedPath(repo.dir, { symlink });
      const folder = path.join(repo.dir, where);
      try {
        assert.equal(plan.ranFrom(folder), true, 'control: the planted git is what that PATH finds');
        const facts = withEnv({ PATH: plan.PATH }, () => gatherGit({ repo: folder }));
        assert.equal(facts.branch, 'feat/login', 'the real git still answers through the other entries');
        assert.equal(plan.planted.ran(), false, 'gather ran the git planted in the repository');
      } finally {
        plan.cleanup();
        repo.cleanup();
      }
    });
  }
}

test('gather: a PATH whose only entry lies inside the repository reports git as not found, and runs nothing', () => {
  const repo = featureRepo();
  const plan = plantedPath(repo.dir);
  try {
    withEnv({ PATH: path.join(repo.dir, 'node_modules', '.bin') }, () => assert.throws(() => gatherGit({ repo: repo.dir }), /git is not installed or not on PATH/));
    assert.equal(plan.planted.ran(), false, 'gather ran the git planted in the repository');
  } finally {
    repo.cleanup();
  }
});

// ---- log.showSignature: a signed commit is only checked when something asks, and the check runs gpg.program ----------------------
test('a repository with log.showSignature=true, a gpg.program and a commit with a gpgsig header never runs the program during gather', () => {
  const repo = featureRepo();
  const p = plant('exit 1');
  try {
    signedCommit(repo.dir, 'feat: signed');
    appendConfig(repo, showSignatureConfig(p.script));
    plainGit(repo.dir, ['log', '-1']);
    assert.equal(p.ran(), true, 'control: plain git log verifies the signature through gpg.program');
    p.clear();
    const facts = gatherGit({ repo: repo.dir });
    assert.equal(facts.commits.at(-1).subject, 'feat: signed');
    assert.equal(p.ran(), false, 'gather ran the repository\'s gpg.program');
  } finally {
    p.cleanup();
    repo.cleanup();
  }
});

// ---- status.showUntrackedFiles=no must not make untracked work read as clean ------------------------------------------------
test('status.showUntrackedFiles=no in the repository does not hide an untracked file: dirty is true', () => {
  const repo = featureRepo();
  try {
    appendConfig(repo, '[status]\n\tshowUntrackedFiles = no\n');
    repo.write('new.txt', 'x\n');
    assert.equal(plainGit(repo.dir, ['status', '--porcelain']).out, '', 'control: plain status shows nothing');
    assert.equal(withEnv({ GIT_CONFIG_GLOBAL: os.devNull }, () => gatherGit({ repo: repo.dir })).dirty, true, 'the developer\'s own config is out of it');
  } finally {
    repo.cleanup();
  }
});

test('status.showUntrackedFiles=no in the user\'s own global config does not hide an untracked file either', () => {
  const repo = featureRepo();
  const global = path.join(quietHome, 'no-untracked.cfg');
  fs.writeFileSync(global, '[status]\n\tshowUntrackedFiles = no\n');
  try {
    repo.write('new.txt', 'x\n');
    assert.equal(plainGit(repo.dir, ['status', '--porcelain'], { env: { GIT_CONFIG_GLOBAL: global } }).out, '', 'control: plain status shows nothing');
    assert.equal(withEnv({ GIT_CONFIG_GLOBAL: global }, () => gatherGit({ repo: repo.dir })).dirty, true);
  } finally {
    repo.cleanup();
  }
});

// ---- a relative HOME, XDG_CONFIG_HOME or GIT_CONFIG_GLOBAL names a file inside the repository, which git would call the user's own ----
const USER_CONFIG_PLACES = [
  { label: 'GIT_CONFIG_GLOBAL=gc', file: 'gc', env: { GIT_CONFIG_GLOBAL: 'gc', HOME: quietHome } },
  { label: 'XDG_CONFIG_HOME=cfg', file: 'cfg/git/config', env: { XDG_CONFIG_HOME: 'cfg', GIT_CONFIG_GLOBAL: undefined, HOME: quietHome } },
  { label: 'HOME=.', file: '.gitconfig', env: { HOME: '.', XDG_CONFIG_HOME: undefined, GIT_CONFIG_GLOBAL: undefined } },
];
for (const { label, file, env } of USER_CONFIG_PLACES) {
  test(`gather: ${label} is not read as the user's own config, so a filter planted there never runs`, () => {
    const repo = makeRepo();
    const p = plant();
    try {
      repo.write('.gitattributes', 'notes.txt filter=evil\n');
      repo.write('notes.txt', 'two\n');
      repo.commit('chore: base');
      git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
      repo.write('other.txt', 'x\n');
      repo.commit('feat: other');
      repo.write(file, `[filter "evil"]\n\tclean = ${p.script}\n`);
      repo.write('notes.txt', 'six\n');
      plainGit(repo.dir, ['status', '--porcelain'], { env: { ...env, GIT_CONFIG_SYSTEM: os.devNull } });
      assert.equal(p.ran(), true, 'control: plain git reads that file as the user\'s config and runs its filter');
      p.clear();
      withEnv(env, () => gatherGit({ repo: repo.dir }));
      assert.equal(p.ran(), false, `gather ran a filter from ${file} in the repository`);
    } finally {
      p.cleanup();
      repo.cleanup();
    }
  });
}

// ---- the reported top level must contain the folder asked for (core.worktree can point anywhere) -------------------------------
for (const [label, sub] of [['another repository', ''], ['a subfolder of another repository', 'sub']]) {
  test(`gather refuses a repository whose core.worktree names ${label}: it would report that one's history`, () => {
    const hostile = makeRepo();
    const other = featureRepo();
    try {
      hostile.write('a.txt', 'a\n');
      hostile.commit('chore: base');
      other.write('sub/keep.txt', 'k\n');
      const named = path.join(other.dir, sub);
      appendConfig(hostile, `[core]\n\tworktree = ${named}\n`);
      assert.equal(plainGit(hostile.dir, ['rev-parse', '--show-toplevel']).out.trim(), named, 'control: plain git reports that folder as the top level');
      assert.throws(() => gatherGit({ repo: hostile.dir }), /work tree .* does not contain/);
    } finally {
      hostile.cleanup();
      other.cleanup();
    }
  });
}

test('gather still works from a subfolder and through a symlinked path, and reports the repository\'s own name', () => {
  const repo = featureRepo();
  const holder = tmpDir('explainer-link-');
  try {
    fs.symlinkSync(repo.dir, path.join(holder, 'link'));
    for (const folder of [path.join(repo.dir, 'src', 'auth'), path.join(holder, 'link'), path.join(holder, 'link', 'src')]) {
      const facts = gatherGit({ repo: folder });
      assert.equal(facts.repo, path.basename(repo.dir), folder);
      assert.equal(facts.branch, 'feat/login');
    }
  } finally {
    cleanUp(holder);
    repo.cleanup();
  }
});

test('gather works when the folder is typed in another letter case on a file system that ignores case', (t) => {
  const repo = featureRepo();
  try {
    const swapped = path.join(path.dirname(repo.dir), path.basename(repo.dir).toUpperCase());
    if (swapped === repo.dir || !fs.existsSync(swapped)) return t.skip('this file system is case-sensitive');
    assert.equal(gatherGit({ repo: swapped }).branch, 'feat/login');
  } finally {
    repo.cleanup();
  }
});

test('a .lfsconfig at the repository root is seen when gather is started in a subfolder', () => {
  const repo = featureRepo();
  try {
    repo.write('.lfsconfig', '[lfs]\n\turl = https://example.invalid/lfs\n');
    assert.equal(gatherGit({ repo: path.join(repo.dir, 'src') }).dirty, null);
  } finally {
    repo.cleanup();
  }
});

// ---- .lfsconfig as a symlink that points nowhere is still a .lfsconfig (lstat, not exists) ----------------------------------------
test('a .lfsconfig that is a dangling symlink skips the dirty check', () => {
  const repo = featureRepo();
  try {
    fs.symlinkSync('no-such-target', path.join(repo.dir, '.lfsconfig'));
    assert.equal(fs.existsSync(path.join(repo.dir, '.lfsconfig')), false, 'control: the link dangles');
    const facts = gatherGit({ repo: repo.dir });
    assert.equal(facts.dirty, null);
    assert.ok(facts.warnings.some((w) => SKIP_WARNING.test(w)), facts.warnings.join('\n'));
  } finally {
    repo.cleanup();
  }
});

// ---- an empty .git/config is one cause of "cannot read the git config" -------------------------------------------------------------
test('an empty .git/config is refused, and the message names it as a cause', () => {
  const repo = featureRepo();
  try {
    fs.writeFileSync(path.join(repo.dir, '.git', 'config'), '');
    assert.equal(plainGit(repo.dir, ['log', '-1', '--format=%s']).status, 0, 'control: plain git reads the repository');
    assert.throws(() => gatherGit({ repo: repo.dir }), /cannot read the git config.*an empty \.git\/config/);
  } finally {
    repo.cleanup();
  }
});
