// make-diagram's standalone SVG under the one containment rule (the page itself is covered by write-link.test.mjs). Real builds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRefused, canLink, listing, runNode, tmpDir } from '../../../shared/test/helpers/link-plants.mjs';

const skip = !canLink && 'symbolic links need a privilege on Windows';
const build = fileURLToPath(new URL('../scripts/build.mjs', import.meta.url));
const examples = fileURLToPath(new URL('../references/examples', import.meta.url));

test('--format svg: a linked default folder that leaves the repository is refused; the real path and --out file.svg work', { skip }, (t) => {
  const base = tmpDir(t, 'pa-dg-');
  const repo = path.join(base, 'repo');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(outside);
  fs.cpSync(examples, path.join(repo, 'examples'), { recursive: true });
  const spec = path.join(repo, 'examples', 'flow.diagram.json');
  fs.symlinkSync(outside, path.join(repo, '.scratch'));
  const r = runNode(t, build, [spec, '--format', 'svg'], repo);
  assertRefused(r, { link: path.join(repo, '.scratch'), repo });
  assert.deepEqual(listing(outside), []);
  const viaFile = runNode(t, build, [spec, '--format', 'svg', '--out', path.join(repo, '.scratch', 'd.svg')], repo);
  assertRefused(viaFile, { link: path.join(repo, '.scratch'), repo });
  const real = runNode(t, build, [spec, '--format', 'svg', '--out', path.join(outside, 'd.svg')], repo);
  assert.equal(real.status, 0, real.stderr);
  assert.match(fs.readFileSync(path.join(outside, 'd.svg'), 'utf8'), /<svg/);
});
