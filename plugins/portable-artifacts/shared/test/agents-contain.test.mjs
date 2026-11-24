// agents.mjs `write` and `write-reviewer` under the one containment rule: a project's agents folder may be a link a repository
// ships; the user's own agents folders under HOME (a stowed ~/.claude is a link on purpose) stay unchecked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const AGENTS = fileURLToPath(new URL('../agents.mjs', import.meta.url));
const skip = process.platform === 'win32' && 'symbolic links need a privilege on Windows';

function world(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-ag-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const repo = path.join(base, 'repo');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.mkdirSync(outside);
  return { base, repo, outside };
}
const run = (args, home) => spawnSync(process.execPath, [AGENTS, ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });

test('write into a project agents folder that is a link out of the repository: refused in one line, nothing written', { skip }, (t) => {
  const { base, repo, outside } = world(t);
  fs.symlinkSync(outside, path.join(repo, '.claude-agents'));
  for (const args of [['write', 'claude', path.join(repo, '.claude-agents')], ['write-reviewer', 'claude', path.join(repo, '.claude-agents'), '--force']]) {
    const r = run(args, base);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
    assert.match(r.stderr, /symlink that leads outside the repository/);
  }
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('write into a real project agents folder, and one reached through a link that stays inside, works', { skip }, (t) => {
  const { base, repo } = world(t);
  const real = path.join(repo, '.claude', 'agents');
  assert.equal(run(['write', 'claude', real], base).status, 0);
  assert.ok(fs.existsSync(path.join(real, 'artifact-builder.md')));
  fs.mkdirSync(path.join(repo, 'build'));
  fs.symlinkSync(path.join(repo, 'build'), path.join(repo, 'inside'));
  assert.equal(run(['write', 'claude', path.join(repo, 'inside', 'agents')], base).status, 0);
  assert.ok(fs.existsSync(path.join(repo, 'build', 'agents', 'artifact-builder.md')));
});

test('the host user folders under HOME stay unchecked, even in a home that is a repository with a stowed link', { skip }, (t) => {
  const { base, outside } = world(t);
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(home, '.git'), { recursive: true });
  fs.symlinkSync(outside, path.join(home, '.claude')); // dotfiles kept elsewhere, on purpose
  for (const [host, dot] of [['claude', '.claude'], ['copilot', '.copilot'], ['codex', '.codex']]) {
    if (dot !== '.claude') fs.symlinkSync(outside, path.join(home, dot));
    const r = run(['write', host, path.join(home, dot, 'agents')], home);
    assert.equal(r.status, 0, `${host}: ${r.stdout}${r.stderr}`);
  }
  assert.deepEqual(fs.readdirSync(path.join(outside, 'agents')).sort(), ['artifact-builder.agent.md', 'artifact-builder.md', 'artifact-builder.toml', 'motion-reviewer.md']);
});

test('a folder under HOME that is not a host agents folder is checked like a project folder', { skip }, (t) => {
  const { base, outside } = world(t);
  const home = path.join(base, 'home');
  fs.mkdirSync(path.join(home, '.git'), { recursive: true });
  fs.symlinkSync(outside, path.join(home, 'proj-agents'));
  const r = run(['write', 'claude', path.join(home, 'proj-agents')], home);
  assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
  assert.deepEqual(fs.readdirSync(outside), []);
});
