// Files make-motion writes under a fixed or guessable name (the locate pictures, a review sheet, a cutout) are replaced when a
// symlink sits there, never written through. No browser, no model, no ffmpeg (a PNG reads in Node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, lstatSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomically } from '../../scripts/v2/sheets.mjs';
import { writeAtomic as writeCutout } from '../../scripts/lib/cutout.mjs';
import { pngOf } from './helpers/png.mjs';

const skip = process.platform === 'win32' && 'symbolic links need a privilege on Windows';
const LOCATE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/locate.mjs');
const made = [];
const scratch = () => { const dir = mkdtempSync(path.join(tmpdir(), 'mm-link-')); made.push(dir); return dir; };
test.after(() => { for (const dir of made) rmSync(dir, { recursive: true, force: true }); });

function victimIn(dir) {
  const victim = path.join(dir, 'victim.txt');
  writeFileSync(victim, 'precious');
  return victim;
}

test('locate: strips-cols.png and strips-rows.png that are symlinks are replaced, and their targets are untouched', { skip }, () => {
  const dir = scratch();
  const victim = victimIn(dir);
  const picture = path.join(dir, 'p.png');
  writeFileSync(picture, pngOf(64, 64, (x, y) => [x * 4, y * 4, 0]));
  const out = path.join(dir, 'o');
  mkdirSync(out);
  for (const name of ['strips-cols.png', 'strips-rows.png']) symlinkSync(victim, path.join(out, name));
  const r = spawnSync(process.execPath, [LOCATE, picture, '--out', out], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(readFileSync(victim, 'utf8') === 'precious', 'locate wrote through the link');
  for (const name of ['strips-cols.png', 'strips-rows.png']) assert.equal(lstatSync(path.join(out, name)).isSymbolicLink(), false);
});

test('a review sheet that is a symlink is replaced, and a link at a guessable temp name is not written through', { skip }, () => {
  const dir = scratch();
  const victim = victimIn(dir);
  const sheet = path.join(dir, 'shot-1.png');
  symlinkSync(victim, sheet);
  for (const guess of [`.shot-1.png.tmp-${process.pid}`, `shot-1.png.tmp-${process.pid}`]) symlinkSync(victim, path.join(dir, guess));
  assert.equal(writeAtomically(sheet, Buffer.from([1, 2, 3])), sheet);
  assert.ok(readFileSync(victim, 'utf8') === 'precious', 'the sheet was written through a link');
  assert.equal(lstatSync(sheet).isSymbolicLink(), false);
});

test('a cutout picture whose output name is a symlink is replaced, never written through', { skip }, () => {
  const dir = scratch();
  const victim = victimIn(dir);
  const file = path.join(dir, 'cut.png');
  symlinkSync(victim, file);
  writeCutout(file, Buffer.from([9, 9]));
  assert.ok(readFileSync(victim, 'utf8') === 'precious', 'the cutout was written through a link');
  assert.deepEqual([...readFileSync(file)], [9, 9]);
});
