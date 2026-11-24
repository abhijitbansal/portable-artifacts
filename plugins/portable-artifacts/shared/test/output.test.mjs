import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { slugify, resolveOutput, findGitRoot, defaultOutputPath, scratchIgnoreNote, fileUrlLine, refuseLinkedFolder } from '../output.mjs';
import { UsageError } from '../cli.mjs';

const home = '/home/someone';
// A fake checkout: /repo has .git (a directory), /wt has .git (a file, as in a worktree). Nothing else exists.
const exists = (p) => p === path.resolve('/repo/.git') || p === path.resolve('/wt/.git');

test('slugify keeps [a-z0-9-], caps at 60 and uses the caller fallback', () => {
  assert.equal(slugify('A -- B / C!!'), 'a-b-c');
  assert.equal(slugify('🙂'), 'diagram');
  assert.equal(slugify('🙂', 'explainer'), 'explainer');
  assert.match(slugify('x'.repeat(100)), /^x{60}$/);
});

test('--out ending in .htm or .html (any case) is the file itself, not a directory', () => {
  assert.equal(resolveOutput({ out: '/a/foo.htm', title: 'T', env: {}, home }), '/a/foo.htm');
  assert.equal(resolveOutput({ out: '/a/FOO.HTM', title: 'T', env: {}, home }), '/a/FOO.HTM');
  assert.equal(resolveOutput({ out: '/a/foo.html', title: 'T', env: {}, home }), '/a/foo.html');
  assert.equal(resolveOutput({ out: '/a/foo.htmx', title: 'T', env: {}, home }), '/a/foo.htmx/t.html', 'only .htm and .html name a file');
});

test('findGitRoot walks up for .git, a directory or a worktree file; null outside a repo', () => {
  assert.equal(findGitRoot('/repo/docs/specs', exists), path.resolve('/repo'));
  assert.equal(findGitRoot('/repo', exists), path.resolve('/repo'));
  assert.equal(findGitRoot('/wt/a/b', exists), path.resolve('/wt'));
  assert.equal(findGitRoot('/elsewhere/x', exists), null);
});

test('D2: a spec inside a git repo builds to <git root>/.scratch/<slug>.html', () => {
  assert.equal(resolveOutput({ title: 'My T', specPath: '/repo/docs/t.diagram.json', env: {}, home, exists }), path.resolve('/repo/.scratch/my-t.html'));
  assert.equal(defaultOutputPath({ title: 'My T', specPath: '/repo/t.json', env: {}, home, exists }), path.resolve('/repo/.scratch/my-t.html'));
  assert.equal(resolveOutput({ title: '', fallback: 'explainer', specPath: '/wt/x.json', env: {}, home, exists }), path.resolve('/wt/.scratch/explainer.html'));
});

test('D2 precedence: --out, then PA_OUTPUT_DIR, then the git default, then the home default', () => {
  assert.equal(resolveOutput({ out: '/a/b.html', title: 'T', specPath: '/repo/t.json', env: {}, home, exists }), '/a/b.html');
  assert.equal(resolveOutput({ out: '/a', title: 'T', specPath: '/repo/t.json', env: {}, home, exists }), '/a/t.html');
  assert.equal(resolveOutput({ title: 'T', specPath: '/repo/t.json', env: { PA_OUTPUT_DIR: '/v' }, home, exists }), '/v/t.html');
  assert.equal(resolveOutput({ title: 'T', specPath: '/nogit/t.json', env: {}, home, exists }), '/home/someone/.agent/diagrams/t.html');
  assert.equal(resolveOutput({ title: 'T', env: {}, home, exists }), '/home/someone/.agent/diagrams/t.html', 'no spec path: the old behaviour');
});

test('scratchIgnoreNote: one line when the default folder is not ignored, nothing otherwise', () => {
  const target = path.resolve('/repo/.scratch/t.html');
  const calls = [];
  const run = (status) => (cmd, args) => { calls.push([cmd, ...args]); return { status }; };
  const note = scratchIgnoreNote(target, { exists, run: run(1) });
  assert.match(note, /^note: \.scratch\/ is not gitignored in /);
  assert.ok(!note.includes('\n'));
  assert.equal(calls[0][0], 'git');
  assert.deepEqual(calls[0].slice(-5), ['check-ignore', '--no-index', '-q', '--', path.join('.scratch', 't.html')]);
  assert.equal(scratchIgnoreNote(target, { exists, run: run(0) }), null, 'ignored');
  assert.equal(scratchIgnoreNote(target, { exists, run: run(128) }), null, 'git failed: stay quiet');
  assert.equal(scratchIgnoreNote(target, { exists, run: () => ({ error: new Error('ENOENT') }) }), null, 'no git binary');
  const before = calls.length;
  assert.equal(scratchIgnoreNote(path.resolve('/repo/out/t.html'), { exists, run: run(1) }), null, 'not the default folder');
  assert.equal(calls.length, before, 'git is not even asked');
});

test('fileUrlLine is the bare file:// URL of an absolute path, escaped, with no label or newline', () => {
  assert.equal(fileUrlLine('/tmp/a b/x.html'), 'file:///tmp/a%20b/x.html');
  assert.ok(!fileUrlLine('/tmp/x.html').includes('\n'));
  assert.match(fileUrlLine('relative/x.html'), /^file:\/\/\/.*\/relative\/x\.html$/, 'a relative path is resolved first');
});

test('resolveOutput: file, directory, PA_OUTPUT_DIR and home default', () => {
  assert.equal(resolveOutput({ out: '/a/b.html', title: 'T', env: { PA_OUTPUT_DIR: '/v' }, home }), '/a/b.html');
  assert.equal(resolveOutput({ out: '/a', title: 'My T', env: {}, home }), '/a/my-t.html');
  assert.equal(resolveOutput({ title: 'My T', env: { PA_OUTPUT_DIR: '/v' }, home }), '/v/my-t.html');
  assert.equal(resolveOutput({ title: '', fallback: 'explainer', env: {}, home }), '/home/someone/.agent/diagrams/explainer.html');
});

// ---- a .scratch that is a symlink: the implicit default is refused, an explicit choice is not ----------------------------
const canLink = process.platform !== 'win32';
function linkedRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-out-'));
  const repo = path.join(base, 'repo');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(repo, '.scratch'));
  return { base, repo, outside, spec: path.join(repo, 't.json') };
}

test('a .scratch symlink under the git root is refused with a one-line UsageError naming both fixes', { skip: !canLink }, () => {
  const { repo, spec, outside } = linkedRepo();
  for (const call of [() => defaultOutputPath({ title: 'T', specPath: spec, env: {}, home }), () => resolveOutput({ title: 'T', specPath: spec, env: {}, home })]) {
    assert.throws(call, (e) => e instanceof UsageError && !e.message.includes('\n') && e.message.includes(path.join(repo, '.scratch')) && /remove the link/.test(e.message) && /--out/.test(e.message));
  }
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing is created through the link');
});

test('a .scratch symlink does not matter when --out or PA_OUTPUT_DIR names the place, or the default is not in a repo', { skip: !canLink }, () => {
  const { repo, spec, base } = linkedRepo();
  const elsewhere = path.join(base, 'elsewhere');
  assert.equal(resolveOutput({ out: elsewhere, title: 'T', specPath: spec, env: {}, home }), path.join(elsewhere, 't.html'));
  assert.equal(resolveOutput({ out: path.join(repo, '.scratch'), title: 'T', specPath: spec, env: {}, home }), path.join(repo, '.scratch', 't.html'), 'an explicit --out through a symlinked folder keeps working');
  assert.equal(resolveOutput({ title: 'T', specPath: spec, env: { PA_OUTPUT_DIR: elsewhere }, home }), path.join(elsewhere, 't.html'));
});

test('a real .scratch folder, and no .scratch at all, resolve as before', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-out-'));
  fs.mkdirSync(path.join(base, '.git'));
  const spec = path.join(base, 't.json');
  assert.equal(resolveOutput({ title: 'T', specPath: spec, env: {}, home }), path.join(base, '.scratch', 't.html'));
  fs.mkdirSync(path.join(base, '.scratch'));
  assert.equal(resolveOutput({ title: 'T', specPath: spec, env: {}, home }), path.join(base, '.scratch', 't.html'));
});

test('refuseLinkedFolder: a symlink is refused with the given fix, a folder or nothing is not', { skip: !canLink }, () => {
  const { repo, base } = linkedRepo();
  assert.throws(() => refuseLinkedFolder(path.join(repo, '.scratch')), (e) => e instanceof UsageError && /is a symlink/.test(e.message));
  assert.doesNotThrow(() => refuseLinkedFolder(path.join(base, 'outside')));
  assert.doesNotThrow(() => refuseLinkedFolder(path.join(base, 'missing')));
});
