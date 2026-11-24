import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { frameStore } from '../scripts/lib/frames.mjs';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-frames-'));

test('the same buffer twice is stored once and the second add says repeated', () => {
  const dir = tempDir();
  const store = frameStore(dir);
  const buffer = Buffer.from('a frame of pixels');
  const first = store.add(buffer);
  const second = store.add(buffer);
  assert.equal(first.repeated, false);
  assert.equal(second.repeated, true);
  assert.equal(first.file, second.file);
  assert.deepEqual([first.index, second.index], [0, 1]);
  assert.equal(store.index().length, 2);
  assert.equal(store.bytes(), buffer.length);
  assert.deepEqual(fs.readdirSync(dir), [first.file]);
});

test('files are named by the first 16 hex of the sha256, with .jpg', () => {
  const store = frameStore(tempDir());
  assert.match(store.add(Buffer.from('x')).file, /^[0-9a-f]{16}\.jpg$/);
});

test('different buffers are different files and bytes() sums each file once', () => {
  const dir = tempDir();
  const store = frameStore(dir);
  const a = Buffer.from('aaaa');
  const b = Buffer.from('bbbbbb');
  store.add(a);
  store.add(b);
  store.add(a);
  assert.equal(store.index().length, 3);
  assert.equal(new Set(store.index()).size, 2);
  assert.equal(store.bytes(), a.length + b.length);
  assert.equal(fs.readdirSync(dir).length, 2);
});

test('the file holds the buffer, and index() is a copy a caller cannot change', () => {
  const dir = tempDir();
  const store = frameStore(dir);
  const buffer = Buffer.from('keep me');
  const { file } = store.add(buffer);
  assert.deepEqual(fs.readFileSync(path.join(dir, file)), buffer);
  store.index().push('junk');
  assert.equal(store.index().length, 1);
});

test('a folder that does not exist yet is created', () => {
  const dir = path.join(tempDir(), 'nested', 'frames');
  const store = frameStore(dir);
  store.add(Buffer.from('z'));
  assert.equal(fs.existsSync(dir), true);
});
