// `--out <file>` of gather.mjs and scaffold.mjs (lib/write-out.mjs) replaces a symlink at the path; it never writes through it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emit } from '../scripts/lib/write-out.mjs';

const skip = process.platform === 'win32' && 'symbolic links need a privilege on Windows';

function quiet(fn) {
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try {
    return fn();
  } finally {
    process.stdout.write = write;
  }
}

function planted() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-emit-'));
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  return { dir, victim, out: path.join(dir, 'facts.json') };
}

test('emit: a symlink at --out is replaced by the file, and its target is untouched', { skip }, () => {
  const { victim, out } = planted();
  fs.symlinkSync(victim, out);
  quiet(() => emit('{"a":1}\n', out));
  assert.equal(fs.readFileSync(victim, 'utf8'), 'precious');
  assert.equal(fs.lstatSync(out).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(out, 'utf8'), '{"a":1}\n');
});

test('emit: a dangling symlink at --out is replaced even when overwrite is off (scaffold without --force)', { skip }, () => {
  const { dir, out } = planted();
  const nowhere = path.join(dir, 'nowhere.json');
  fs.symlinkSync(nowhere, out);
  quiet(() => emit('{}\n', out, { overwrite: false }));
  assert.equal(fs.existsSync(nowhere), false);
  assert.equal(fs.lstatSync(out).isSymbolicLink(), false);
});

test('emit: overwrite off still refuses a path that exists (a link to a file included), and a directory stays an error', { skip }, () => {
  const { dir, victim, out } = planted();
  fs.symlinkSync(victim, out);
  assert.throws(() => emit('{}\n', out, { overwrite: false }), /already exists/);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'precious');
  fs.mkdirSync(path.join(dir, 'adir'));
  assert.throws(() => emit('{}\n', path.join(dir, 'adir')), /must be a file, not a directory/);
});
