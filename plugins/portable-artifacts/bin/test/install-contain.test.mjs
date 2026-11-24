// A project install writes into a repository the user may not have written: a symlink shipped where .claude/skills, .gemini/commands
// or an agents folder should be must not take the install outside the repository, and a link at a TOML name is replaced, never
// written through. A user install (under HOME) is the user's own and is not checked.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const installer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../install.mjs');
const skip = process.platform === 'win32' && 'symbolic links need a privilege on Windows';
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function world({ git = true } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-inst-')));
  made.push(base);
  const proj = path.join(base, 'proj');
  const outside = path.join(base, 'outside');
  const home = path.join(base, 'home');
  for (const d of [proj, outside, home]) fs.mkdirSync(d);
  if (git) fs.mkdirSync(path.join(proj, '.git'));
  return { base, proj, outside, home };
}
const install = (args, home) => spawnSync(process.execPath, [installer, ...args, '--no-deps', '--skills', 'make-diagram'], { encoding: 'utf8', env: { ...process.env, HOME: home }, timeout: 120000 });
const listing = (dir) => fs.readdirSync(dir, { recursive: true }).sort();

test('gemini --project: a symlink at the TOML name is replaced by the command file; its target is untouched', { skip }, () => {
  const { proj, outside, home } = world();
  fs.mkdirSync(path.join(proj, '.gemini', 'commands'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'v.txt'), 'precious');
  fs.symlinkSync(path.join(outside, 'v.txt'), path.join(proj, '.gemini', 'commands', 'make-diagram.toml'));
  const r = install(['gemini', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(outside, 'v.txt'), 'utf8'), 'precious');
  assert.equal(fs.lstatSync(path.join(proj, '.gemini', 'commands', 'make-diagram.toml')).isSymbolicLink(), false);
  assert.match(fs.readFileSync(path.join(proj, '.gemini', 'commands', 'make-diagram.toml'), 'utf8'), /Activate the make-diagram skill/);
});

test('--project: a skills folder that is a link out of the repository is refused in one line, and nothing is installed', { skip }, () => {
  const { proj, outside, home } = world();
  fs.mkdirSync(path.join(proj, '.claude'));
  fs.symlinkSync(outside, path.join(proj, '.claude', 'skills'));
  const r = install(['claude', '--project', proj], home);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
  assert.ok(r.stderr.includes(path.join(proj, '.claude', 'skills')));
  assert.match(r.stderr, /remove the link, or pass the folder's real path/);
  assert.deepEqual(listing(outside), []);
});

test('gemini --project: a commands folder that is a link out of the repository is refused; nothing is written through it', { skip }, () => {
  const { proj, outside, home } = world();
  fs.mkdirSync(path.join(proj, '.gemini'));
  fs.symlinkSync(outside, path.join(proj, '.gemini', 'commands'));
  const r = install(['gemini', '--project', proj], home);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stderr.includes(path.join(proj, '.gemini', 'commands')));
  assert.deepEqual(listing(outside), []);
  assert.equal(fs.existsSync(path.join(proj, '.gemini', 'skills')), false, 'no skill was installed before the refusal');
});

test('--project --agents-only: an agents folder that is a link out of the repository is refused', { skip }, () => {
  const { proj, outside, home } = world();
  fs.mkdirSync(path.join(proj, '.claude'));
  fs.symlinkSync(outside, path.join(proj, '.claude', 'agents'));
  const r = spawnSync(process.execPath, [installer, 'claude', '--project', proj, '--agents-only'], { encoding: 'utf8', env: { ...process.env, HOME: home }, timeout: 60000 });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.ok(r.stderr.includes(path.join(proj, '.claude', 'agents')));
  assert.deepEqual(listing(outside), []);
});

test('--project: a link that stays inside the repository is allowed', { skip }, () => {
  const { proj, home } = world();
  fs.mkdirSync(path.join(proj, 'vendor', 'skills'), { recursive: true });
  fs.mkdirSync(path.join(proj, '.claude'));
  fs.symlinkSync(path.join(proj, 'vendor', 'skills'), path.join(proj, '.claude', 'skills'));
  const r = install(['claude', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(proj, 'vendor', 'skills', 'make-diagram', 'SKILL.md')));
});

test('a user install is not checked: HOME may be a repository and ~/.claude a link (a stowed dotfiles setup)', { skip }, () => {
  const { base, outside, home } = world();
  fs.mkdirSync(path.join(home, '.git'));
  fs.symlinkSync(outside, path.join(home, '.claude'));
  const r = install(['claude'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(outside, 'skills', 'make-diagram', 'SKILL.md')));
  assert.ok(base);
});

test('control: with no .git the same project layout installs through the link, as before (a stated limit)', { skip }, () => {
  const { proj, outside, home } = world({ git: false });
  fs.mkdirSync(path.join(proj, '.claude'));
  fs.symlinkSync(outside, path.join(proj, '.claude', 'skills'));
  const r = install(['claude', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(outside, 'make-diagram', 'SKILL.md')));
});
