// Fix pass for the 2.4.2 security review (sec5): a backslash in a name, file-system errors in the check, one path for check and
// write, nothing in a .git, the temp file of a replace, and the exact list of device paths written in place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertContained, ensureOutputFolder, isDeviceNamespace, writeFileReplacing } from '../write-file.mjs';
import { UsageError } from '../cli.mjs';

const posix = process.platform !== 'win32';
const skip = !posix && 'symbolic links and backslash names need POSIX';
const isRoot = process.getuid?.() === 0;
const MAX_NAME = 300; // over NAME_MAX (255) on every file system we meet

function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-wh-')));
  t.after(() => {
    for (const dir of [base, path.join(base, 'repo', 'locked')]) if (fs.existsSync(dir)) fs.chmodSync(dir, 0o700);
    fs.rmSync(base, { recursive: true, force: true });
  });
  const repo = path.join(base, 'repo');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(outside);
  return { base, repo, outside };
}
const link = (to, at) => fs.symlinkSync(to, at);

// ---- H1: on POSIX a backslash is an ordinary character of a name ------------------------------------------------------------------

test('a linked folder whose name holds a backslash is followed as one name and refused', { skip }, (t) => {
  const { repo, outside } = world(t);
  link(outside, path.join(repo, 'a\\b'));
  assert.throws(() => assertContained(path.join(repo, 'a\\b', 'out')), UsageError);
  assert.throws(() => ensureOutputFolder(path.join(repo, 'a\\b', 'out', 'x')), UsageError);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('a link below a folder whose name holds a backslash is refused', { skip }, (t) => {
  const { repo, outside } = world(t);
  fs.mkdirSync(path.join(repo, 'a\\b'));
  link(outside, path.join(repo, 'a\\b', 'out'));
  assert.throws(() => ensureOutputFolder(path.join(repo, 'a\\b', 'out', 'x')), UsageError);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('a film named with a backslash cannot hide its linked sheets folder', { skip }, (t) => {
  const { repo, outside } = world(t);
  fs.mkdirSync(path.join(repo, 'out'));
  link(outside, path.join(repo, 'out', 'fi\\lm.sheets'));
  assert.throws(() => assertContained(path.join(repo, 'out', 'fi\\lm.sheets')), UsageError);
});

test('an ordinary repository below a folder with a backslash in its name still works', { skip }, (t) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-wh-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'my\\dir', 'repo');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  const made = ensureOutputFolder(path.join(repo, '.scratch', 'x'));
  assert.equal(made, path.join(repo, '.scratch', 'x'));
  assert.ok(fs.statSync(made).isDirectory());
});

// ---- M1: an error of the check is a one-line UsageError, not a stack ---------------------------------------------------------------

const oneLineUsage = (e) => e instanceof UsageError && !e.message.includes('\n') && typeof e.code === 'string';

test('a folder the user cannot read: EACCES becomes a one-line UsageError that keeps the code', { skip: skip || isRoot }, (t) => {
  const { repo } = world(t);
  fs.mkdirSync(path.join(repo, 'locked', 'a'), { recursive: true });
  fs.chmodSync(path.join(repo, 'locked'), 0o000);
  assert.throws(() => assertContained(path.join(repo, 'locked', 'a', 'x.html')), (e) => oneLineUsage(e) && e.code === 'EACCES');
});

test('a name over the limit: ENAMETOOLONG becomes a one-line UsageError', { skip }, (t) => {
  const { repo } = world(t);
  assert.throws(() => assertContained(path.join(repo, 'x'.repeat(MAX_NAME), 'a')), (e) => oneLineUsage(e) && e.code === 'ENAMETOOLONG');
  assert.throws(() => ensureOutputFolder(path.join(repo, 'x'.repeat(MAX_NAME), 'a')), (e) => oneLineUsage(e) && e.code === 'ENAMETOOLONG');
});

test('a link that loops is a one-line UsageError, never a raw ELOOP (control: it was already)', { skip }, (t) => {
  const { repo } = world(t);
  link('loop', path.join(repo, 'loop'));
  for (const target of [path.join(repo, 'loop', 'x'), path.join(repo, 'loop', 'a', 'b')]) {
    assert.throws(() => assertContained(target), (e) => e instanceof UsageError && !e.message.includes('\n'));
    assert.throws(() => ensureOutputFolder(target), (e) => e instanceof UsageError && !e.message.includes('\n'));
  }
});

test('a folder that cannot be made (EACCES from mkdir) is a one-line UsageError', { skip: skip || isRoot }, (t) => {
  const { repo } = world(t);
  fs.mkdirSync(path.join(repo, 'locked'));
  fs.chmodSync(path.join(repo, 'locked'), 0o500);
  assert.throws(() => ensureOutputFolder(path.join(repo, 'locked', 'new')), (e) => oneLineUsage(e) && e.code === 'EACCES');
});

test('a NUL byte in the path is a one-line UsageError', { skip }, (t) => {
  const { repo } = world(t);
  assert.throws(() => assertContained(path.join(repo, 'a\0b')), (e) => e instanceof UsageError && !e.message.includes('\n'));
});

// ---- M4: the folded path is the one that is checked, made and returned ---------------------------------------------------------------

test('a .. that follows a link is folded once: what is checked is what is made', { skip }, (t) => {
  const { repo, outside } = world(t);
  fs.mkdirSync(path.join(repo, 'safe', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'sub'));
  link(path.join(repo, 'safe', 'deep'), path.join(repo, 'sub', 'l'));
  link(outside, path.join(repo, 'sub', 'esc'));
  const raw = `${repo}/sub/l/../esc/new`; // a template: path.join would fold the .. away before the call
  assert.throws(() => ensureOutputFolder(raw), UsageError); // the text folds to sub/esc/new, which is the linked folder
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('the returned path is the folded absolute one, and a relative path is folded against the working folder', { skip }, (t) => {
  const { repo } = world(t);
  const was = process.cwd();
  process.chdir(repo);
  t.after(() => process.chdir(was));
  const made = ensureOutputFolder('a/../b/c'); // a literal: the working folder is repo
  assert.equal(made, path.join(fs.realpathSync(repo), 'b', 'c'));
  assert.ok(fs.statSync(path.join(repo, 'b', 'c')).isDirectory());
  assert.equal(fs.existsSync(path.join(repo, 'a')), false);
});

// ---- M7: a .git is never an output ------------------------------------------------------------------------------------------------

test('a link into .git is refused even though it stays inside the repository', { skip }, (t) => {
  const { repo } = world(t);
  link(path.join(repo, '.git'), path.join(repo, 'dotgit'));
  assert.throws(() => ensureOutputFolder(path.join(repo, 'dotgit', 'hooks')), (e) => e instanceof UsageError && /\.git/.test(e.message) && !e.message.includes('\n'));
  assert.equal(fs.existsSync(path.join(repo, '.git', 'hooks')), false);
});

test('the .git folder itself, and anything below it, is not an output', (t) => {
  const { repo } = world(t);
  assert.throws(() => ensureOutputFolder(path.join(repo, '.git')), UsageError);
  assert.throws(() => ensureOutputFolder(path.join(repo, '.git', 'hooks', 'x')), UsageError);
  assert.equal(fs.existsSync(path.join(repo, '.git', 'hooks')), false);
});

test('.GIT is the same folder on a case-insensitive disk', { skip: process.platform !== 'darwin' }, (t) => {
  const { repo } = world(t);
  assert.throws(() => ensureOutputFolder(path.join(repo, '.GIT', 'hooks')), UsageError);
  assert.equal(fs.existsSync(path.join(repo, '.git', 'hooks')), false);
});

test('a folder that merely starts with .git is an output like any other', (t) => {
  const { repo } = world(t);
  ensureOutputFolder(path.join(repo, '.github', 'x'));
  ensureOutputFolder(path.join(repo, '.gitlab'));
  assert.ok(fs.statSync(path.join(repo, '.github', 'x')).isDirectory());
});

// ---- L1, L2: the temp file of a replace -------------------------------------------------------------------------------------------

test('when closeSync itself fails, the error is the real one and no temp is left', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-wh-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const realClose = fs.closeSync;
  fs.closeSync = (fd) => { realClose(fd); throw Object.assign(new Error('EIO: i/o error, close'), { code: 'EIO' }); }; // the fd is gone, as after a failed NFS flush
  try {
    assert.throws(() => writeFileReplacing(path.join(dir, 'page.html'), 'x'), (e) => e.code === 'EIO');
  } finally {
    fs.closeSync = realClose;
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('when the rename fails and the cleanup fails too, the error is the rename\'s', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-wh-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const real = { rename: fs.renameSync, rm: fs.rmSync };
  fs.renameSync = () => { throw Object.assign(new Error('EXDEV: cross-device link'), { code: 'EXDEV' }); };
  fs.rmSync = () => { throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }); };
  try {
    assert.throws(() => writeFileReplacing(path.join(dir, 'page.html'), 'x'), (e) => e.code === 'EXDEV');
  } finally {
    Object.assign(fs, { renameSync: real.rename, rmSync: real.rm });
  }
});

test('the temp of a 0640 file holds the text with no group bits open, and the owner and group come first', { skip: !posix }, (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-wh-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'f.txt');
  fs.writeFileSync(file, 'old');
  fs.chmodSync(file, 0o640);
  const events = [];
  const real = { write: fs.writeFileSync, chown: fs.fchownSync, stat: fs.fstatSync };
  fs.fstatSync = (fd, ...rest) => { const s = real.stat(fd, ...rest); return typeof fd === 'number' && s.isFile() ? Object.assign(Object.create(s), { gid: s.gid + 1, mode: s.mode }) : s; }; // the temp has "another" group
  fs.fchownSync = (fd, uid, gid) => { events.push('chown'); return real.chown(fd, uid, process.getgid()); };
  fs.writeFileSync = (target, ...rest) => { if (typeof target === 'number') events.push(`write:${(real.stat(target).mode & 0o077).toString(8)}`); return real.write(target, ...rest); };
  try {
    writeFileReplacing(file, 'secret');
  } finally {
    Object.assign(fs, { writeFileSync: real.write, fchownSync: real.chown, fstatSync: real.stat });
  }
  assert.deepEqual(events.filter((e) => e !== 'chown'), ['write:0'], `the text was written into a temp with group bits: ${events}`);
  assert.equal(events.indexOf('chown') < events.findIndex((e) => e.startsWith('write')), true, `the group was fixed after the text was written: ${events}`);
  assert.equal(fs.statSync(file).mode & 0o777, 0o640);
});

// ---- L3: only these device paths are written in place -----------------------------------------------------------------------------

test('exactly stdout, stderr, null, tty and numbered descriptors are written in place', { skip: !posix }, () => {
  for (const yes of ['/dev/stdout', '/dev/stderr', '/dev/null', '/dev/tty', '/dev/fd/0', '/dev/fd/12', '/proc/self/fd/1', '/proc/4242/fd/7']) assert.equal(isDeviceNamespace(yes), true, yes);
  for (const no of ['/dev/shm/x', '/dev/shm', '/dev', '/dev/fd', '/dev/fd/x', '/dev/stdout/x', '/dev/disk0', '/proc/self/cwd/x', '/proc/self/fd', '/proc/self/environ', '/proc/net/dev', '/devx/null', '/dev/fd/1/../2x']) assert.equal(isDeviceNamespace(no), false, no);
});

test('a path under /dev/shm is checked, made and written like any other (Linux)', { skip: !fs.existsSync('/dev/shm') }, (t) => {
  const dir = fs.mkdtempSync('/dev/shm/pa-wh-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const made = ensureOutputFolder(path.join(dir, 'o', 'x'));
  assert.ok(fs.statSync(made).isDirectory());
});
