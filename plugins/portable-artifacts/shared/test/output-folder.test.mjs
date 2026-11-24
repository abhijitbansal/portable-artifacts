// The one containment rule: a folder a tool writes into, inside a git repository, must not lead outside it through a symlink.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertContained, ensureOutputFolder } from '../write-file.mjs';
import { UsageError } from '../cli.mjs';

const skip = process.platform === 'win32' && 'symbolic links need a privilege on Windows';

// <base>/repo (with a .git folder) and <base>/outside, both real paths. Cleaned up when the test ends.
function world(t, { git = true } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-of-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(repo);
  fs.mkdirSync(outside);
  if (git) fs.mkdirSync(path.join(repo, '.git'));
  return { base, repo, outside };
}
const link = (to, at) => fs.symlinkSync(to, at);
const refusal = (named, repo) => (e) => e instanceof UsageError
  && !e.message.includes('\n')
  && e.message.includes(named)
  && e.message.includes(repo)
  && /remove the link, or pass the folder's real path/.test(e.message);

test('a folder outside any repository is made as before, links and all', { skip }, (t) => {
  const { repo, outside } = world(t, { git: false });
  link(outside, path.join(repo, '.scratch'));
  assert.equal(ensureOutputFolder(path.join(repo, '.scratch', 'shots')), path.join(repo, '.scratch', 'shots'));
  assert.ok(fs.statSync(path.join(outside, 'shots')).isDirectory());
});

test('a real folder inside a repository is made, and its parents', (t) => {
  const { repo } = world(t);
  ensureOutputFolder(path.join(repo, '.scratch', 'a', 'b'));
  assert.ok(fs.statSync(path.join(repo, '.scratch', 'a', 'b')).isDirectory());
});

test('a linked folder that leads outside the repository is refused in one line naming the link and the repository; nothing is created', { skip }, (t) => {
  const { repo, outside } = world(t);
  link(outside, path.join(repo, '.scratch'));
  assert.throws(() => ensureOutputFolder(path.join(repo, '.scratch')), refusal(path.join(repo, '.scratch'), repo));
  assert.throws(() => ensureOutputFolder(path.join(repo, '.scratch', 'shots')), refusal(path.join(repo, '.scratch'), repo));
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('a linked ancestor, however deep, is refused', { skip }, (t) => {
  const { repo, outside } = world(t);
  fs.mkdirSync(path.join(repo, 'a'));
  link(outside, path.join(repo, 'a', 'out'));
  assert.throws(() => ensureOutputFolder(path.join(repo, 'a', 'out', 'x', 'y', 'z')), refusal(path.join(repo, 'a', 'out'), repo));
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('a dangling link component is refused, and nothing is made where it points', { skip }, (t) => {
  const { repo, outside } = world(t);
  link(path.join(outside, 'not-yet'), path.join(repo, 'shots'));
  assert.throws(() => ensureOutputFolder(path.join(repo, 'shots')), (e) => e instanceof UsageError && e.message.includes(path.join(repo, 'shots')) && e.message.includes(repo) && !e.message.includes('\n'));
  assert.throws(() => ensureOutputFolder(path.join(repo, 'shots', 'a')), UsageError);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('a link that stays inside the repository is allowed', { skip }, (t) => {
  const { repo } = world(t);
  fs.mkdirSync(path.join(repo, 'build', 'tmp'), { recursive: true });
  link(path.join(repo, 'build', 'tmp'), path.join(repo, '.scratch'));
  ensureOutputFolder(path.join(repo, '.scratch', 'shots'));
  assert.ok(fs.statSync(path.join(repo, 'build', 'tmp', 'shots')).isDirectory());
});

test('the real path of a folder behind a link is accepted', { skip }, (t) => {
  const { repo, outside } = world(t);
  link(outside, path.join(repo, '.scratch'));
  assert.equal(ensureOutputFolder(path.join(outside, 'shots')), path.join(outside, 'shots'));
  assert.ok(fs.statSync(path.join(outside, 'shots')).isDirectory());
});

test('a repository reached through a link: its own real path is what counts', { skip }, (t) => {
  const { base, repo } = world(t);
  link(repo, path.join(base, 'alias'));
  ensureOutputFolder(path.join(base, 'alias', '.scratch'));
  assert.ok(fs.statSync(path.join(repo, '.scratch')).isDirectory());
});

test('a .git found THROUGH the link does not hide the outer repository (the spec sits in a linked folder that is itself a repository)', { skip }, (t) => {
  const { repo, outside } = world(t);
  fs.mkdirSync(path.join(outside, '.git'));
  link(outside, path.join(repo, '.scratch'));
  assert.throws(() => ensureOutputFolder(path.join(repo, '.scratch', '.scratch')), refusal(path.join(repo, '.scratch'), repo));
  assert.throws(() => ensureOutputFolder(`${repo}/docs/../.scratch/docs`), UsageError, 'a path that climbs back to the link by ..');
  assert.deepEqual(fs.readdirSync(outside).sort(), ['.git']);
});

test('a link followed by .. is checked where the OS goes, not where the text points', { skip }, (t) => {
  const { base, repo, outside } = world(t);
  fs.mkdirSync(path.join(outside, 'deep'));
  link(path.join(outside, 'deep'), path.join(repo, 'l'));
  assert.throws(() => ensureOutputFolder(`${repo}/l/../x`), UsageError); // path.join would fold the .. away before the OS sees it
  assert.deepEqual(fs.readdirSync(outside), ['deep']);
  assert.equal(fs.existsSync(path.join(repo, 'x')), false);
  assert.ok(base);
});

test('a linked work tree (.git is a file) and a submodule count as repositories', { skip }, (t) => {
  const { repo, outside } = world(t, { git: false });
  fs.writeFileSync(path.join(repo, '.git'), 'gitdir: /somewhere/else\n');
  link(outside, path.join(repo, 'out'));
  assert.throws(() => ensureOutputFolder(path.join(repo, 'out', 'x')), UsageError);
  // a submodule inside an outer repository: the inner .git file also guards its own folder
  const outer = world(t);
  fs.mkdirSync(path.join(outer.repo, 'sub'));
  fs.writeFileSync(path.join(outer.repo, 'sub', '.git'), 'gitdir: ../.git/modules/sub\n');
  fs.mkdirSync(path.join(outer.repo, 'elsewhere'));
  link(path.join(outer.repo, 'elsewhere'), path.join(outer.repo, 'sub', 'l'));
  assert.throws(() => ensureOutputFolder(path.join(outer.repo, 'sub', 'l', 'x')), (e) => e instanceof UsageError && e.message.includes(path.join(outer.repo, 'sub')));
});

test('a home folder that is itself a repository guards the folders below it', { skip }, (t) => {
  const { base, repo: home, outside } = world(t);
  fs.mkdirSync(path.join(home, 'project'));
  link(outside, path.join(home, 'project', 'out'));
  assert.throws(() => ensureOutputFolder(path.join(home, 'project', 'out')), refusal(path.join(home, 'project', 'out'), home));
  assert.ok(base);
});

test('a spec file that is a link out of the repository is refused by assertContained, one inside is not', { skip }, (t) => {
  const { repo, outside } = world(t);
  fs.writeFileSync(path.join(outside, 'scene.json'), '{}');
  fs.writeFileSync(path.join(repo, 'real.json'), '{}');
  link(path.join(outside, 'scene.json'), path.join(repo, 'scene.json'));
  link(path.join(repo, 'real.json'), path.join(repo, 'alias.json'));
  assert.throws(() => assertContained(path.join(repo, 'scene.json')), refusal(path.join(repo, 'scene.json'), repo));
  assert.equal(assertContained(path.join(repo, 'alias.json')), path.join(repo, 'alias.json'));
});

test('a relative folder is resolved against the current folder', { skip }, (t) => {
  const { repo, outside } = world(t);
  link(outside, path.join(repo, '.scratch'));
  const before = process.cwd();
  process.chdir(repo);
  try {
    assert.throws(() => ensureOutputFolder('.scratch/shots'), UsageError);
  } finally {
    process.chdir(before);
  }
});

test('letter case: a repository named in another case on a case-insensitive disk is still contained', (t) => {
  const { repo } = world(t);
  const swapped = path.join(path.dirname(repo), 'REPO');
  if (!fs.existsSync(swapped)) return t.skip('this disk is case-sensitive');
  ensureOutputFolder(path.join(swapped, '.scratch'));
  assert.ok(fs.statSync(path.join(repo, '.scratch')).isDirectory());
  ensureOutputFolder(path.join(swapped, '.scratch')); // now it exists: the whole path is real
  assertContained(swapped);
});

test('paths under /dev/ and /proc/ are not folders to make', { skip }, () => {
  assert.equal(assertContained('/dev/stdout'), '/dev/stdout');
  assert.equal(ensureOutputFolder('/dev/fd'), '/dev/fd');
});

test('a file where the folder should be is an ordinary mkdir error, not a refusal', (t) => {
  const { repo } = world(t);
  fs.writeFileSync(path.join(repo, 'afile'), 'x');
  assert.throws(() => ensureOutputFolder(path.join(repo, 'afile', 'sub')), (e) => !(e instanceof UsageError) && /ENOTDIR|EEXIST/.test(e.code));
});
