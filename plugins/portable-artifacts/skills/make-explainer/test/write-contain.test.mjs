// make-explainer's other writers under the one containment rule: the --md twin, the assets folder and the manifest, and the
// `--out` file of scaffold and gather. Real scripts, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertRefused, canLink, listing, runNode, tmpDir } from '../../../shared/test/helpers/link-plants.mjs';
import { mkfifo, mustGit } from '../../../shared/test/helpers/git-plants.mjs';
import { MANIFEST, syncAssets } from '../scripts/lib/assets.mjs';

const skip = !canLink && 'symbolic links need a privilege on Windows';
const script = (name) => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url));
const examples = fileURLToPath(new URL('../references/examples', import.meta.url));
const LIMIT_MS = 15000;

function world(t) {
  const base = tmpDir(t, 'pa-ex-');
  const repo = path.join(base, 'repo');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(outside);
  return { base, repo, outside };
}

test('--md: the twin and the page share one folder, so a linked folder out of the repository is refused before either is written', { skip }, (t) => {
  const { repo, outside } = world(t);
  fs.cpSync(examples, path.join(repo, 'examples'), { recursive: true });
  fs.symlinkSync(outside, path.join(repo, '.scratch'));
  const r = runNode(t, script('build.mjs'), [path.join(repo, 'examples', 'checklist.explainer.json'), '--md'], repo);
  assertRefused(r, { link: path.join(repo, '.scratch'), repo });
  assert.deepEqual(listing(outside), []);
  fs.unlinkSync(path.join(repo, '.scratch'));
  fs.mkdirSync(path.join(repo, '.scratch'));
  const ok = runNode(t, script('build.mjs'), [path.join(repo, 'examples', 'checklist.explainer.json'), '--md'], repo);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(listing(path.join(repo, '.scratch')).some((n) => n.endsWith('.md')), 'the twin is written beside the page');
});

test('the refusal comes before the assets folder is tidied: a leftover temp in <slug>.assets behind the link survives', { skip }, (t) => {
  const { repo, outside } = world(t);
  fs.cpSync(examples, path.join(repo, 'examples'), { recursive: true });
  const spec = path.join(repo, 'examples', 'recap-simple.explainer.json');
  assert.equal(runNode(t, script('build.mjs'), [spec, '--out', outside], repo).status, 0);
  const page = fs.readdirSync(outside).find((n) => n.endsWith('.html'));
  const assets = path.join(outside, page.replace(/\.html$/, '.assets'));
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, '.pa-0123456789abcdef.tmp'), 'half');
  const before = listing(outside);
  fs.symlinkSync(outside, path.join(repo, '.scratch'));
  const r = runNode(t, script('build.mjs'), [spec], repo);
  assertRefused(r, { link: path.join(repo, '.scratch'), repo });
  assert.deepEqual(listing(outside), before, 'the assets folder behind the link was tidied or written');
});

test('--md: a twin that is a symlink out is replaced, never written through', { skip }, (t) => {
  const { repo, outside } = world(t);
  fs.cpSync(examples, path.join(repo, 'examples'), { recursive: true });
  const spec = path.join(repo, 'examples', 'checklist.explainer.json');
  assert.equal(runNode(t, script('build.mjs'), [spec, '--md'], repo).status, 0);
  const twin = listing(path.join(repo, '.scratch')).find((n) => n.endsWith('.md'));
  const victim = path.join(outside, 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  fs.rmSync(path.join(repo, '.scratch', twin));
  fs.symlinkSync(victim, path.join(repo, '.scratch', twin));
  const again = runNode(t, script('build.mjs'), [spec, '--md'], repo);
  // the old twin was ours; the link was not: a twin is only ever written over a file an earlier --md build wrote
  assert.ok([0, 1].includes(again.status), again.stderr);
  assert.equal(fs.readFileSync(victim, 'utf8'), 'precious', 'the twin was written through the link');
});

test('scaffold --out: a path through a linked folder out of the repository is refused; the real path is accepted', { skip }, (t) => {
  const { repo, outside } = world(t);
  fs.symlinkSync(outside, path.join(repo, '.scratch'));
  const r = runNode(t, script('scaffold.mjs'), ['concept', '--out', '.scratch/e.json'], repo);
  assertRefused(r, { link: path.join(repo, '.scratch'), repo });
  assert.deepEqual(listing(outside), []);
  const real = runNode(t, script('scaffold.mjs'), ['concept', '--out', path.join(outside, 'e.json')], repo);
  assert.equal(real.status, 0, real.stderr);
  assert.ok(fs.existsSync(path.join(outside, 'e.json')));
});

test('gather --out: a path through a linked folder out of the repository is refused; nothing is written', { skip }, (t) => {
  const { base, outside } = world(t);
  const repo = path.join(base, 'real-repo');
  fs.mkdirSync(repo);
  mustGit(repo, 'init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
  mustGit(repo, 'add', '-A');
  mustGit(repo, 'commit', '-q', '-m', 'base');
  fs.symlinkSync(outside, path.join(repo, 'facts'));
  const r = runNode(t, script('gather.mjs'), ['git', '--repo', repo, '--out', path.join(repo, 'facts', 'facts.json')], repo);
  assertRefused(r, { link: path.join(repo, 'facts'), repo, otherLines: true }); // gather says first that the repository has no commits beyond main
  assert.deepEqual(listing(outside), []);
});

test('--out /dev/stdout works again (scaffold writes to the process stdout)', { skip: !canLink || !fs.existsSync('/dev/stdout') }, (t) => {
  const r = runNode(t, script('scaffold.mjs'), ['concept', '--out', '/dev/stdout', '--force'], process.cwd());
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"sections"/);
});

test('a manifest that is a named pipe is never opened: the build does not hang, and the pipe is left alone', { skip: !canLink }, (t) => {
  const dir = tmpDir(t, 'pa-ex-fifo-');
  const assets = path.join(dir, 'page.assets');
  fs.mkdirSync(assets);
  if (!mkfifo(path.join(assets, MANIFEST))) return t.skip('mkfifo is not available');
  const code = `import { syncAssets } from ${JSON.stringify(fileURLToPath(new URL('../scripts/lib/assets.mjs', import.meta.url)))};
try { syncAssets(process.argv[1], [{ content: 'x', to: process.argv[1] + '/a.txt' }]); } catch (e) { process.stderr.write(String(e.message) + '\\n'); process.exitCode = 3; }`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code, assets], { encoding: 'utf8', timeout: LIMIT_MS });
  assert.notEqual(r.status, null, `the build hung: ${r.signal}`);
  assert.equal(fs.lstatSync(path.join(assets, MANIFEST)).isFIFO(), true);
});

test('a leftover .pa-<hex>.tmp (a regular file) in the assets folder is removed with the old temp name; another file of that look is not', { skip }, (t) => {
  const dir = tmpDir(t, 'pa-ex-tmp-');
  const assets = path.join(dir, 'page.assets');
  fs.mkdirSync(assets);
  fs.writeFileSync(path.join(assets, '.pa-0123456789abcdef.tmp'), 'half');
  fs.writeFileSync(path.join(assets, `${MANIFEST}.tmp`), 'old');
  fs.writeFileSync(path.join(assets, '.pa-mine.tmp'), 'the user\'s');
  fs.mkdirSync(path.join(assets, '.pa-fedcba9876543210.tmp'));
  syncAssets(assets, [{ content: 'x', to: path.join(assets, 'a.txt') }]);
  assert.deepEqual(fs.readdirSync(assets).sort(), ['.pa-fedcba9876543210.tmp', '.pa-mine.tmp', MANIFEST, 'a.txt'].sort());
});

test('an assets folder whose last build left only a temp is emptied away with the folder', { skip }, (t) => {
  const dir = tmpDir(t, 'pa-ex-empty-');
  const assets = path.join(dir, 'page.assets');
  syncAssets(assets, [{ content: 'x', to: path.join(assets, 'a.txt') }]);
  fs.writeFileSync(path.join(assets, '.pa-0123456789abcdef.tmp'), 'half');
  syncAssets(assets, []);
  assert.equal(fs.existsSync(assets), false, 'a leftover temp no longer keeps the folder alive');
});
