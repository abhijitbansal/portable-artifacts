// `--world` rewrites the user's own spec in place. That file is an input the user named, not an output a build picks, so a
// symlinked spec stays a symlink and the rewrite lands in the file it points to (only the page and fragment are replaced).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { build } from '../scripts/build.mjs';
import { PINNED_ENV, tempDir, writeScene } from './helpers/scene-fixtures.mjs';

const BASE = { title: 'Commits per folder', units: 'commits', data: { file: 'rows.json' } };

test('--world through a symlinked spec keeps the link and rewrites the real file', { skip: process.platform === 'win32' }, async (t) => {
  const real = writeScene(t, { ...BASE, world: 'city' });
  const link = path.join(path.dirname(real), 'link.scene.json');
  fs.symlinkSync(real, link);
  const result = await build(link, { world: 'forest', env: { ...PINNED_ENV, PA_OUTPUT_DIR: tempDir(t) } });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'the spec link was replaced');
  assert.equal(JSON.parse(fs.readFileSync(real, 'utf8')).world, 'forest');
});
