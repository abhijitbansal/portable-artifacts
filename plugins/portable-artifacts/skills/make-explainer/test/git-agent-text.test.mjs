// Commit subjects, file names and branch names come from the repository, so gather prints them to the agent as
// third-party text. gatherGit keeps the data exact (it feeds the page: timeline titles) apart from cutting a long
// subject; scripts/gather.mjs writes every invisible character as a legal JSON escape where the agent reads it, so
// JSON.parse still returns the exact original. Invisible characters are written as braced escapes in this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gatherGit } from '../scripts/lib/git.mjs';
import { makeRepo, featureRepo, git } from './helpers/repo.mjs';

const GATHER = fileURLToPath(new URL('../scripts/gather.mjs', import.meta.url));
// Any character that is invisible or reorders text, other than the newline that lays out pretty-printed JSON.
const RAW_INVISIBLE = /[\p{Cf}\p{Co}\u{2028}\u{2029}\p{Variation_Selector}\u{0}-\u{9}\u{b}-\u{1f}\u{7f}-\u{9f}]/u;
const TAGS = String.fromCodePoint(0xE0069, 0xE0067); // two Unicode tag characters (hidden text)
const SUBJECT = `fix: typo${TAGS} \u{202E}evil \u{267B}\u{FE0F} \u{1F468}\u{200D}\u{1F469}`;
const FILE = 'src/evil\u{202E}gnp\u{200B}.test.js';

function hostileRepo() {
  const repo = makeRepo();
  repo.write('README.md', '# demo\n');
  repo.commit('chore: base');
  git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
  repo.write(FILE, 'x\n');
  repo.commit(SUBJECT);
  return repo;
}

const gather = (repo, ...args) => spawnSync(process.execPath, [GATHER, 'git', '--repo', repo.dir, ...args], { encoding: 'utf8' });

test('gatherGit keeps subjects and paths exact: the data the page is built from is not rewritten', () => {
  const repo = hostileRepo();
  try {
    const facts = gatherGit({ repo: repo.dir });
    assert.equal(facts.commits[0].subject, SUBJECT);
    assert.deepEqual(facts.files.map((f) => f.path), [FILE]);
    assert.deepEqual(facts.tests, [FILE]);
  } finally {
    repo.cleanup();
  }
});

test('gather prints no raw invisible character, shows each as a JSON escape, and parses back to the exact facts', () => {
  const repo = hostileRepo();
  try {
    const expected = gatherGit({ repo: repo.dir });
    for (const args of [[], ['--json']]) {
      const r = gather(repo, ...args);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stdout, RAW_INVISIBLE, `gather ${args.join(' ')} printed a raw invisible character`);
      assert.match(r.stdout, /\\u202e/);
      assert.match(r.stdout, /\\u200d/);
      assert.match(r.stdout, /\\ufe0f/);
      assert.match(r.stdout, /\\udb40\\udc69/, 'a tag character above U+FFFF is a surrogate pair');
      assert.deepEqual(JSON.parse(r.stdout), expected);
    }
  } finally {
    repo.cleanup();
  }
});

test('gather --out writes the same escaped JSON, and it parses back to the exact facts', () => {
  const repo = hostileRepo();
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gather-out-')), 'facts.json');
  try {
    const r = gather(repo, '--out', out);
    assert.equal(r.status, 0, r.stderr);
    const text = fs.readFileSync(out, 'utf8');
    assert.doesNotMatch(text, RAW_INVISIBLE);
    assert.deepEqual(JSON.parse(text), gatherGit({ repo: repo.dir }));
  } finally {
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
    repo.cleanup();
  }
});

test('a repository with nothing to hide prints exactly what JSON.stringify gives', () => {
  const repo = featureRepo();
  try {
    const r = gather(repo);
    assert.equal(r.stdout, `${JSON.stringify(gatherGit({ repo: repo.dir }), null, 2)}\n`);
  } finally {
    repo.cleanup();
  }
});

test('a commit subject is capped at 200 characters with a count of what was dropped', () => {
  const repo = makeRepo();
  try {
    repo.write('a.txt', 'a\n');
    repo.commit('chore: base');
    git(repo.dir, 'checkout', '-q', '-b', 'feat/x');
    repo.write('b.txt', 'b\n');
    repo.commit(`feat: ${'z'.repeat(400)}`);
    const [commit] = gatherGit({ repo: repo.dir }).commits;
    assert.equal(commit.subject, `feat: ${'z'.repeat(194)}\u{2026}[206 more characters]`);
  } finally {
    repo.cleanup();
  }
});

test('a warning on stderr shows an invisible character of a branch name as a code point', () => {
  const repo = makeRepo();
  try {
    repo.write('a.txt', 'a\n');
    repo.commit('chore: base');
    git(repo.dir, 'checkout', '-q', '-b', 'feat/a\u{200B}b');
    const r = gather(repo);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /^warning: no commits on feat\/a\\u\{200b\}b beyond main/m);
    assert.doesNotMatch(r.stderr, RAW_INVISIBLE);
  } finally {
    repo.cleanup();
  }
});
