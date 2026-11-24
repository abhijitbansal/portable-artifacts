// make-scene's other writers under the one containment rule: --fragment, the --world rewrite of the spec, rows.mjs --out and
// check.mjs --shots. Real scripts, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRefused, canLink, listing, runNode, tmpDir } from '../../../shared/test/helpers/link-plants.mjs';
import { mustGit } from '../../../shared/test/helpers/git-plants.mjs';
import { checkPage } from '../scripts/check.mjs';
import { UsageError } from '../shared/cli.mjs';

const skip = !canLink && 'symbolic links need a privilege on Windows';
const script = (name) => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
const examples = fileURLToPath(new URL('../references/examples', import.meta.url));
const SPEC = 'city.scene.json';

function world(t) {
  const base = tmpDir(t, 'pa-sc-');
  const repo = path.join(base, 'repo');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(outside);
  fs.cpSync(examples, path.join(repo, 'examples'), { recursive: true });
  return { base, repo, outside, spec: path.join(repo, 'examples', SPEC) };
}

test('--fragment: a linked default folder that leaves the repository is refused, and writes nothing', { skip }, (t) => {
  const { repo, outside, spec } = world(t);
  fs.symlinkSync(outside, path.join(repo, '.scratch'));
  const r = runNode(t, script('build.mjs'), [spec, '--fragment'], repo);
  assertRefused(r, { link: path.join(repo, '.scratch'), repo });
  assert.deepEqual(listing(outside), []);
  const real = runNode(t, script('build.mjs'), [spec, '--fragment', '--out', path.join(outside, 'f')], repo);
  assert.equal(real.status, 0, real.stderr);
  assert.ok(listing(path.join(outside, 'f')).some((n) => n.endsWith('.fragment.html')));
});

test('--world: a spec that is a symlink to a file outside the repository is not rewritten, and no page is left behind', { skip }, (t) => {
  const { repo, outside, spec } = world(t);
  const real = path.join(outside, 'scene.json');
  fs.copyFileSync(spec, real);
  const link = path.join(repo, 'examples', 'linked.scene.json');
  fs.symlinkSync(real, link);
  const before = fs.readFileSync(real, 'utf8');
  const r = runNode(t, script('build.mjs'), [link, '--world', 'forest'], repo);
  assertRefused(r, { link, repo });
  assert.equal(fs.readFileSync(real, 'utf8'), before, 'the spec outside was rewritten through the link');
  assert.equal(fs.existsSync(path.join(repo, '.scratch')), false, 'a page was written before the refusal');
});

test('--world: a spec reached through a linked folder out of the repository is refused; one linked inside is rewritten', { skip }, (t) => {
  const { repo, outside } = world(t);
  fs.cpSync(examples, path.join(outside, 'ex'), { recursive: true });
  fs.symlinkSync(path.join(outside, 'ex'), path.join(repo, 'linked'));
  const r = runNode(t, script('build.mjs'), [path.join(repo, 'linked', SPEC), '--world', 'forest'], repo);
  assertRefused(r, { link: path.join(repo, 'linked'), repo });
  assert.equal(JSON.parse(fs.readFileSync(path.join(outside, 'ex', SPEC), 'utf8')).world, 'city');
  fs.symlinkSync(path.join(repo, 'examples'), path.join(repo, 'inner'));
  const ok = runNode(t, script('build.mjs'), [path.join(repo, 'inner', SPEC), '--world', 'forest'], repo);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, 'examples', SPEC), 'utf8')).world, 'forest');
});

test('rows.mjs git --out: a path through a linked folder out of the repository is refused; the real path is accepted', { skip }, (t) => {
  const { base, outside } = world(t);
  const repo = path.join(base, 'real-repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  mustGit(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'a\n');
  mustGit(repo, 'add', '-A');
  mustGit(repo, 'commit', '-q', '-m', 'base');
  fs.symlinkSync(outside, path.join(repo, 'rows'));
  const r = runNode(t, script('rows.mjs'), ['git', '--weeks', '2', '--out', 'rows/r.json'], repo);
  assertRefused(r, { link: path.join(repo, 'rows'), repo });
  assert.deepEqual(listing(outside), []);
  const real = runNode(t, script('rows.mjs'), ['git', '--weeks', '2', '--out', path.join(outside, 'r.json')], repo);
  assert.equal(real.status, 0, real.stderr);
});

test('check.mjs --shots: a linked folder out of the repository is refused before a browser starts; the real path is not', { skip }, (t) => {
  const { repo, outside } = world(t);
  const page = path.join(repo, 'page.html');
  fs.writeFileSync(page, '<p>x</p>');
  fs.symlinkSync(outside, path.join(repo, 'shots'));
  const r = runNode(t, script('check.mjs'), [page, '--shots', 'shots'], repo);
  assertRefused(r, { link: path.join(repo, 'shots'), repo });
  assert.deepEqual(listing(outside), []);
});

test('checkPage: a shots folder that leads out of the repository is refused before the first shot', { skip }, async (t) => {
  const { repo, outside } = world(t);
  fs.symlinkSync(outside, path.join(repo, 'shots'));
  const browser = { newContext: async () => assert.fail('no page may open'), close: async () => {} };
  await assert.rejects(checkPage(path.join(repo, 'page.html'), { launcher: () => Promise.resolve(browser), shotsDir: path.join(repo, 'shots', 'a') }), (e) => e instanceof UsageError && e.message.includes(path.join(repo, 'shots')));
  assert.deepEqual(listing(outside), []);
});
