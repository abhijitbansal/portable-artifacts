// The asset manifest (<slug>.assets/.pa-assets.json) is written with an unpredictable temp name and replaced, never written
// through: a symlink at the manifest path or at the old fixed temp name leaves its target alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MANIFEST, syncAssets } from '../scripts/lib/assets.mjs';

const skip = process.platform === 'win32' && 'symbolic links need a privilege on Windows';

test('syncAssets: a symlink at the manifest path or at the old temp name is replaced or ignored, and its target is untouched', { skip }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-manifest-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  const assets = path.join(dir, 'page.assets');
  fs.mkdirSync(assets);
  fs.symlinkSync(victim, path.join(assets, MANIFEST));
  fs.symlinkSync(victim, path.join(assets, `${MANIFEST}.tmp`));
  syncAssets(assets, [{ content: 'x', to: path.join(assets, 'a.txt') }]);
  assert.ok(fs.readFileSync(victim, 'utf8') === 'precious', 'the manifest was written through a link');
  assert.equal(fs.lstatSync(path.join(assets, MANIFEST)).isSymbolicLink(), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(assets, MANIFEST), 'utf8')).files, ['a.txt']);
  assert.deepEqual(fs.readdirSync(assets).sort(), [MANIFEST, 'a.txt'].sort(), 'no temp file is left behind');
});
