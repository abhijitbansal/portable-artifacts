import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFileReplacing, dropLinkAt } from '../write-file.mjs';

const canLink = process.platform !== 'win32';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pa-wf-'));
const names = (dir) => fs.readdirSync(dir).sort();

test('control: a plain writeFileSync follows a symlink at the target (the bug the helper exists to avoid)', { skip: !canLink }, () => {
  const dir = tmp();
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  fs.symlinkSync(victim, path.join(dir, 'page.html'));
  fs.writeFileSync(path.join(dir, 'page.html'), 'PAGE');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'PAGE');
});

test('writes a new file with the mode writeFileSync would give, and leaves no temp file', () => {
  const dir = tmp();
  const plain = path.join(dir, 'plain.txt');
  fs.writeFileSync(plain, 'x');
  writeFileReplacing(path.join(dir, 'new.html'), 'hello');
  assert.equal(fs.readFileSync(path.join(dir, 'new.html'), 'utf8'), 'hello');
  if (canLink) assert.equal(fs.statSync(path.join(dir, 'new.html')).mode & 0o777, fs.statSync(plain).mode & 0o777);
  assert.deepEqual(names(dir), ['new.html', 'plain.txt']);
});

test('accepts bytes as well as text', () => {
  const dir = tmp();
  writeFileReplacing(path.join(dir, 'a.png'), Buffer.from([1, 2, 3]));
  assert.deepEqual([...fs.readFileSync(path.join(dir, 'a.png'))], [1, 2, 3]);
});

test('replaces an existing file and keeps its mode', { skip: !canLink }, () => {
  const dir = tmp();
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, 'old');
  fs.chmodSync(file, 0o600);
  writeFileReplacing(file, 'new');
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('a symlink at the target is replaced by the page; its old target is untouched', { skip: !canLink }, () => {
  const dir = tmp();
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  const target = path.join(dir, 'page.html');
  fs.symlinkSync(victim, target);
  writeFileReplacing(target, 'PAGE');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'precious');
  assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'PAGE');
});

test('a dangling symlink at the target is replaced and nothing is created where it pointed', { skip: !canLink }, () => {
  const dir = tmp();
  const nowhere = path.join(dir, 'nowhere.txt');
  const target = path.join(dir, 'page.html');
  fs.symlinkSync(nowhere, target);
  writeFileReplacing(target, 'PAGE');
  assert.equal(fs.existsSync(nowhere), false);
  assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
});

test('a symlink planted at a guessable temp name is never written through', { skip: !canLink }, () => {
  const dir = tmp();
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  for (const guess of ['page.html.tmp', '.page.html.tmp', `page.html.${process.pid}.tmp`, `.page.html.${process.pid}.tmp`]) fs.symlinkSync(victim, path.join(dir, guess));
  writeFileReplacing(path.join(dir, 'page.html'), 'PAGE');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'precious');
});

test('the temp name differs between calls (unpredictable)', () => {
  const dir = tmp();
  const seen = new Set();
  const realRename = fs.renameSync;
  fs.renameSync = (from, to) => { seen.add(path.basename(from)); return realRename(from, to); };
  try {
    for (let i = 0; i < 5; i += 1) writeFileReplacing(path.join(dir, 'page.html'), String(i));
  } finally {
    fs.renameSync = realRename;
  }
  assert.equal(seen.size, 5);
});

test('a directory at the target is an EISDIR error (as writeFileSync reports it) and is left whole', { skip: !canLink && 'Windows reports EPERM' }, () => {
  const dir = tmp();
  const target = path.join(dir, 'page.html');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep.txt'), 'k');
  assert.throws(() => writeFileReplacing(target, 'PAGE'), (e) => e.code === 'EISDIR');
  assert.deepEqual(names(target), ['keep.txt']);
  assert.deepEqual(names(dir), ['page.html'], 'no temp file left behind');
});

test('a FIFO at the target is replaced by the file: it is never opened, so nothing blocks', { skip: !canLink }, () => {
  const dir = tmp();
  const target = path.join(dir, 'page.html');
  const made = spawnSync('mkfifo', [target]);
  if (made.status !== 0) return;
  writeFileReplacing(target, 'PAGE');
  assert.equal(fs.lstatSync(target).isFIFO(), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'PAGE');
});

test('a failed write removes the temp file and keeps the error code', () => {
  const dir = tmp();
  const target = path.join(dir, 'page.html');
  fs.writeFileSync(target, 'old');
  const realRename = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error('no rename here'), { code: 'EXDEV' }); };
  try {
    assert.throws(() => writeFileReplacing(target, 'new'), (e) => e.code === 'EXDEV');
  } finally {
    fs.renameSync = realRename;
  }
  assert.equal(fs.readFileSync(target, 'utf8'), 'old', 'never a fallback that writes in place');
  assert.deepEqual(names(dir), ['page.html']);
});

test('dropLinkAt removes a symlink (dangling or not) and nothing else', { skip: !canLink }, () => {
  const dir = tmp();
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  fs.symlinkSync(victim, path.join(dir, 'a.png'));
  fs.symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'b.png'));
  fs.writeFileSync(path.join(dir, 'c.png'), 'plain');
  fs.mkdirSync(path.join(dir, 'd.png'));
  for (const name of ['a.png', 'b.png', 'c.png', 'd.png', 'missing.png']) dropLinkAt(path.join(dir, name));
  assert.deepEqual(names(dir), ['c.png', 'd.png', 'victim.txt']);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'precious');
});

test('an unwritable folder reports EACCES, and a missing folder ENOENT', { skip: !canLink || process.getuid?.() === 0 }, () => {
  const dir = tmp();
  const locked = path.join(dir, 'locked');
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0o500);
  try {
    assert.throws(() => writeFileReplacing(path.join(locked, 'p.html'), 'x'), (e) => e.code === 'EACCES');
  } finally {
    fs.chmodSync(locked, 0o700);
  }
  assert.throws(() => writeFileReplacing(path.join(dir, 'missing', 'p.html'), 'x'), (e) => e.code === 'ENOENT');
});
