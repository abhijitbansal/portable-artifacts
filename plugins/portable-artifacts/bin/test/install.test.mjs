import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { targetsFor, agentTargetsFor, HOSTS, expandRequires, npmCommand, swapIn, UsageError } from '../install.mjs';
import { agentFile, REVIEWER_CURRENT_MARKER, REVIEWER_FINGERPRINT, reviewerFile } from '../../shared/agents.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const installer = path.resolve(here, '../install.mjs');
const made = [];
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-install-'))); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function runInstall(args, home) {
  return spawnSync(process.execPath, [installer, ...args, '--no-deps'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

test('targetsFor maps each host and scope to its documented skill dir', () => {
  const home = '/h';
  const proj = '/p';
  assert.equal(targetsFor('claude', 'user', { home, proj }).skills, '/h/.claude/skills');
  assert.equal(targetsFor('claude', 'project', { home, proj }).skills, '/p/.claude/skills');
  assert.equal(targetsFor('codex', 'user', { home, proj }).skills, '/h/.agents/skills');
  assert.equal(targetsFor('codex', 'project', { home, proj }).skills, '/p/.agents/skills');
  assert.equal(targetsFor('copilot', 'user', { home, proj }).skills, '/h/.copilot/skills');
  assert.equal(targetsFor('copilot', 'project', { home, proj }).skills, '/p/.github/skills');
  assert.equal(targetsFor('gemini', 'user', { home, proj }).skills, '/h/.gemini/skills');
  assert.equal(targetsFor('gemini', 'project', { home, proj }).commands, '/p/.gemini/commands');
  assert.equal(targetsFor('agents', 'user', { home, proj }).skills, '/h/.agents/skills');
  assert.deepEqual(Object.keys(HOSTS).sort(), ['agents', 'claude', 'codex', 'copilot', 'gemini']);
});

test('project install copies both skills without node_modules, tests or build output', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['codex', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  for (const s of ['make-dashboard', 'make-motion']) {
    const dst = path.join(proj, '.agents/skills', s);
    assert.ok(fs.existsSync(path.join(dst, 'SKILL.md')), `${s}/SKILL.md`);
    assert.ok(fs.existsSync(path.join(dst, 'scripts/doctor.mjs'))); // every skill has one; make-motion's validate.mjs was deleted at cut-over
    assert.ok(fs.existsSync(path.join(dst, 'package-lock.json')));
    assert.equal(fs.existsSync(path.join(dst, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(dst, 'test')), false);
  }
  assert.match(r.stdout, /\$make-dashboard/);
});

test('user install honours HOME and --skills filter', () => {
  const home = tmp();
  const r = runInstall(['copilot', '--skills', 'make-motion'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(home, '.copilot/skills/make-motion/SKILL.md')));
  assert.equal(fs.existsSync(path.join(home, '.copilot/skills/make-dashboard')), false);
  assert.match(r.stdout, /\/make-motion/);
});

test('gemini install also writes a TOML command per skill', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['gemini', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  const toml = fs.readFileSync(path.join(proj, '.gemini/commands/make-dashboard.toml'), 'utf8');
  assert.match(toml, /^description = ".+"$/m);
  assert.match(toml, /\{\{args\}\}/);
  assert.match(toml, /make-dashboard/);
});

test('refuses to overwrite an existing install without --force, then replaces with it', () => {
  const home = tmp();
  const proj = tmp();
  const dst = path.join(proj, '.claude/skills/make-dashboard');
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(path.join(dst, 'mine.txt'), 'keep me');
  const r1 = runInstall(['claude', '--project', proj], home);
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /already exists.*--force/);
  assert.equal(fs.readFileSync(path.join(dst, 'mine.txt'), 'utf8'), 'keep me');
  const r2 = runInstall(['claude', '--project', proj, '--force'], home);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(fs.existsSync(path.join(dst, 'mine.txt')), false);
  assert.ok(fs.existsSync(path.join(dst, 'SKILL.md')));
});

test('--link symlinks instead of copying', () => {
  const home = tmp();
  const r = runInstall(['agents', '--link'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.lstatSync(path.join(home, '.agents/skills/make-motion')).isSymbolicLink());
});

test('empty --project is a usage error, not a silent user-scope install', () => {
  const home = tmp();
  const r = runInstall(['claude', '--project='], home);
  assert.equal(r.status, 2);
  assert.equal(fs.existsSync(path.join(home, '.claude/skills')), false);
});

test('duplicate --skills entries install once', () => {
  const home = tmp();
  const r = runInstall(['claude', '--skills', 'make-motion,make-motion'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/installed make-motion/g) || []).length, 1);
});

// install.mjs imports the plugin's shared/*.mjs (agents, cli, doctor and what they import): a sandbox carries them all.
function copyShared(root) {
  const from = path.join(here, '../../shared');
  fs.mkdirSync(path.join(root, 'shared'));
  for (const f of fs.readdirSync(from).filter((n) => n.endsWith('.mjs'))) fs.copyFileSync(path.join(from, f), path.join(root, 'shared', f));
}

// Sandbox: a copy of install.mjs next to a fake skills/ tree, so a regression
// here can only ever delete throwaway files, never the real skills.
function sandbox() {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'bin'));
  fs.copyFileSync(installer, path.join(root, 'bin/install.mjs'));
  copyShared(root);
  fs.mkdirSync(path.join(root, 'skills/make-motion'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills/make-motion/SKILL.md'), '---\nname: make-motion\ndescription: fake\n---\n');
  return root;
}

test('--force refuses when the target resolves to the source skill (never deletes the source)', () => {
  const home = tmp();
  const root = sandbox();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.symlinkSync(path.join(root, 'skills'), path.join(home, '.claude/skills'), 'dir');
  const r = spawnSync(process.execPath, [path.join(root, 'bin/install.mjs'), 'claude', '--force', '--no-deps'], {
    encoding: 'utf8', env: { ...process.env, HOME: home },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is the source skill itself/);
  assert.ok(fs.existsSync(path.join(root, 'skills/make-motion/SKILL.md')));
});

test('a failed npm ci removes the half-installed copy and says so', () => {
  const home = tmp();
  const bin = tmp();
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho boom >&2\nexit 1\n', { mode: 0o755 });
  const r = spawnSync(process.execPath, [installer, 'claude', '--skills', 'make-motion'], {
    encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /npm ci failed in \S*\.make-motion\.new-\d+.*nothing was installed at \S*make-motion/);
  assert.equal(fs.existsSync(path.join(home, '.claude/skills/make-motion')), false);
});

test('a failed npm ci under --force names the staged folder and says the existing install is unchanged', () => {
  const { r, dst } = failingNpmInstall();
  assert.match(r.stderr, /npm ci failed in \S*\.make-motion\.new-\d+.*the existing install at \S*make-motion is unchanged/);
  assert.equal(fs.readFileSync(path.join(dst, 'SKILL.md'), 'utf8'), 'the working install');
});

test('swapIn: a backup that cannot be removed after the swap is a warning naming the leftover path, not a failed install', () => {
  const root = tmp();
  const dst = path.join(root, 'skill');
  const stage = path.join(root, '.skill.new-1');
  fs.mkdirSync(dst);
  fs.writeFileSync(path.join(dst, 'SKILL.md'), 'old');
  fs.mkdirSync(stage);
  fs.writeFileSync(path.join(stage, 'SKILL.md'), 'new');
  const warnings = [];
  const rm = () => { throw new Error('EBUSY: locked'); };
  swapIn(stage, dst, true, { rm, warn: (m) => warnings.push(m) });
  assert.equal(fs.readFileSync(path.join(dst, 'SKILL.md'), 'utf8'), 'new', 'the new install is in place');
  const backup = path.join(root, `.skill.old-${process.pid}`);
  assert.equal(warnings.length, 1);
  assert.ok(warnings[0].includes(backup), warnings[0]);
  assert.match(warnings[0], /EBUSY/);
});

test('an install removes .<skill>.new-* folders left by dead runs, keeps other skills\' folders, and warns about .old-* backups without deleting them', () => {
  const home = tmp();
  const skills = path.join(home, '.claude/skills');
  const deadStage = path.join(skills, '.make-motion.new-99999');
  const otherStage = path.join(skills, '.make-diagram.new-99999');
  const oldBackup = path.join(skills, '.make-motion.old-99999');
  for (const d of [deadStage, otherStage, oldBackup]) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'f.txt'), 'x'); }
  const r = runInstall(['claude', '--skills', 'make-motion'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(deadStage), false, 'the dead run\'s stage folder is gone');
  assert.ok(fs.existsSync(otherStage), 'another skill\'s stage folder is not ours to remove');
  assert.ok(fs.existsSync(path.join(oldBackup, 'f.txt')), 'a backup may hold a user\'s copy and stays');
  assert.ok(r.stderr.includes(oldBackup), r.stderr);
  assert.match(r.stderr, /warning/i);
});

const NPM_CI_ARGS = ['ci', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'];

test('npmCommand on win32 goes through cmd.exe with one quoted line (Node refuses to spawn npm.cmd directly)', () => {
  assert.deepEqual(npmCommand(NPM_CI_ARGS, 'win32'), { cmd: 'npm ci --ignore-scripts --omit=dev --no-audit --no-fund', args: [], shell: true });
  assert.deepEqual(npmCommand(['ci', 'a b'], 'win32'), { cmd: 'npm ci "a b"', args: [], shell: true }, 'an argument with a space stays one token');
});

test('npmCommand elsewhere runs npm directly, no shell', () => {
  for (const platform of ['darwin', 'linux']) assert.deepEqual(npmCommand(NPM_CI_ARGS, platform), { cmd: 'npm', args: NPM_CI_ARGS, shell: false });
});

// A fake npm that fails, and a home that already holds a working make-motion.
function failingNpmInstall(extraArgs = []) {
  const home = tmp();
  const bin = tmp();
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho boom >&2\nexit 1\n', { mode: 0o755 });
  const skills = path.join(home, '.claude/skills');
  const dst = path.join(skills, 'make-motion');
  fs.mkdirSync(path.join(dst, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(dst, 'SKILL.md'), 'the working install');
  const r = spawnSync(process.execPath, [installer, 'claude', '--skills', 'make-motion', '--force', ...extraArgs], {
    encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  });
  return { r, skills, dst };
}

test('--force with a failing npm ci leaves the working install untouched and no staging folder behind', () => {
  const { r, skills, dst } = failingNpmInstall();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /npm ci failed/);
  assert.equal(fs.readFileSync(path.join(dst, 'SKILL.md'), 'utf8'), 'the working install');
  assert.ok(fs.existsSync(path.join(dst, 'node_modules')));
  assert.deepEqual(fs.readdirSync(skills), ['make-motion'], 'no staged or backup folder is left in the skills dir');
});

test('--force --link with a failing npm ci also keeps the working install', () => {
  const { r, skills, dst } = failingNpmInstall(['--link']);
  assert.equal(r.status, 1);
  assert.equal(fs.readFileSync(path.join(dst, 'SKILL.md'), 'utf8'), 'the working install');
  assert.deepEqual(fs.readdirSync(skills), ['make-motion']);
});

test('--force replaces a working install with the new copy and leaves no staging or backup folder', () => {
  const home = tmp();
  const skills = path.join(home, '.claude/skills');
  const dst = path.join(skills, 'make-motion');
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(path.join(dst, 'old.txt'), 'old');
  const r = runInstall(['claude', '--skills', 'make-motion', '--force'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.existsSync(path.join(dst, 'old.txt')), false);
  assert.ok(fs.existsSync(path.join(dst, 'SKILL.md')));
  assert.deepEqual(fs.readdirSync(skills), ['make-motion']);
});

test('--help prints the usage with every accepted flag and exits 0', () => {
  for (const flag of ['--help', '-h']) {
    const r = runInstall([flag], tmp());
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^usage: .*install\.mjs <claude\|codex\|copilot\|gemini\|agents>/);
    for (const accepted of ['--project', '--skills', '--link', '--force', '--no-deps', '--agents-only']) assert.ok(r.stdout.includes(accepted), `${accepted} in: ${r.stdout}`);
  }
});

test('an unknown flag exits 2 with a one-line error that lists the accepted flags, not Node\'s "--" advice', () => {
  const r = runInstall(['claude', '--bogus'], tmp());
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^install: Unknown option '--bogus'/);
  assert.doesNotMatch(r.stderr, /place it at the end/);
  for (const accepted of ['--project', '--skills', '--link', '--force', '--no-deps', '--agents-only']) assert.ok(r.stderr.includes(accepted), `${accepted} in: ${r.stderr}`);
  assert.equal(r.stderr.trim().split('\n').length, 1);
});

test('a misspelt flag near a real one is corrected', () => {
  assert.match(runInstall(['claude', '--forse'], tmp()).stderr, /did you mean '--force'/);
});

// Fake npm that records its argv, so the exact `npm ci` flags can be pinned.
function npmArgsFor(extraArgs) {
  const home = tmp();
  const bin = tmp();
  const log = path.join(bin, 'npm-args.txt');
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\necho "$@" >> "${log}"\nexit 0\n`, { mode: 0o755 });
  const r = spawnSync(process.execPath, [installer, 'claude', '--skills', 'make-motion', ...extraArgs], {
    encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(r.status, 0, r.stderr);
  return fs.readFileSync(log, 'utf8').trim();
}

test('a copied install runs npm ci --ignore-scripts --omit=dev', () => {
  assert.match(npmArgsFor([]), /^ci --ignore-scripts --omit=dev\b/);
});

test('a --link install runs npm ci --ignore-scripts without --omit=dev (it would wipe the checkout dev deps)', () => {
  const args = npmArgsFor(['--link']);
  assert.match(args, /^ci --ignore-scripts\b/);
  assert.doesNotMatch(args, /--omit/);
});

test('usage errors exit 2', () => {
  const home = tmp();
  assert.equal(runInstall([], home).status, 2);
  assert.equal(runInstall(['emacs'], home).status, 2);
  assert.equal(runInstall(['codex', '--skills', 'nope'], home).status, 2);
  assert.equal(runInstall(['codex', '--bogus'], home).status, 2);
});

// --- portableArtifacts.requires expansion ---------------------------------

// A fake skills/ tree: { name: requiresArray | undefined } -> dirs with SKILL.md (+ package.json when requires is given).
function fakeSkills(spec) {
  const src = path.join(tmp(), 'skills');
  for (const [name, requires] of Object.entries(spec)) {
    const d = path.join(src, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: fake\n---\n`);
    if (requires) fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, portableArtifacts: { requires } }));
  }
  return src;
}

const names = (plan) => plan.map((p) => p.skill);

test('expandRequires puts required skills first, in declared order, and names who needed them', () => {
  const src = fakeSkills({ 'make-explainer': ['make-diagram', 'make-dashboard'], 'make-diagram': undefined, 'make-dashboard': undefined });
  const plan = expandRequires(['make-explainer'], src);
  assert.deepEqual(names(plan), ['make-diagram', 'make-dashboard', 'make-explainer']);
  assert.deepEqual(plan.map((p) => p.requiredBy ?? null), ['make-explainer', 'make-explainer', null]);
});

test('expandRequires dedups a skill that is also listed explicitly and does not call it "also installing"', () => {
  const src = fakeSkills({ 'make-explainer': ['make-diagram', 'make-dashboard'], 'make-diagram': undefined, 'make-dashboard': undefined });
  const plan = expandRequires(['make-dashboard', 'make-explainer'], src);
  assert.deepEqual(names(plan), ['make-dashboard', 'make-diagram', 'make-explainer']);
  assert.equal(plan.find((p) => p.skill === 'make-dashboard').requiredBy, undefined);
  assert.equal(plan.find((p) => p.skill === 'make-diagram').requiredBy, 'make-explainer');
});

test('expandRequires follows requirements transitively, dependency first', () => {
  const src = fakeSkills({ a: ['b'], b: ['c'], c: undefined });
  const plan = expandRequires(['a'], src);
  assert.deepEqual(names(plan), ['c', 'b', 'a']);
  assert.equal(plan[0].requiredBy, 'b');
});

test('expandRequires reports a cycle as a UsageError naming it', () => {
  const src = fakeSkills({ a: ['b'], b: ['a'] });
  assert.throws(() => expandRequires(['a'], src), (e) => e instanceof UsageError && /dependency cycle: a -> b -> a/.test(e.message));
});

test('expandRequires rejects an unknown required skill and a malformed requires list', () => {
  const missing = fakeSkills({ a: ['ghost'] });
  assert.throws(() => expandRequires(['a'], missing), (e) => e instanceof UsageError && /a requires unknown skill "ghost"/.test(e.message));
  const bad = fakeSkills({ a: [] });
  fs.writeFileSync(path.join(bad, 'a/package.json'), JSON.stringify({ portableArtifacts: { requires: 'b' } }));
  assert.throws(() => expandRequires(['a'], bad), (e) => e instanceof UsageError && /a: portableArtifacts\.requires must be an array of skill names/.test(e.message));
});

test('a skill with no package.json requires nothing', () => {
  const src = fakeSkills({ a: undefined });
  assert.deepEqual(names(expandRequires(['a'], src)), ['a']);
});

// End to end against a sandbox copy of install.mjs with fake skills.
function sandboxWith(spec) {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'bin'));
  fs.copyFileSync(installer, path.join(root, 'bin/install.mjs'));
  copyShared(root);
  const skills = fakeSkills(spec);
  fs.renameSync(skills, path.join(root, 'skills'));
  return path.join(root, 'bin/install.mjs');
}
const runSandbox = (script, args, home) => spawnSync(process.execPath, [script, ...args, '--no-deps'], {
  encoding: 'utf8', env: { ...process.env, HOME: home },
});

test('installing make-explainer installs its required skills first and says why', () => {
  const home = tmp();
  const script = sandboxWith({ 'make-explainer': ['make-diagram', 'make-dashboard'], 'make-diagram': undefined, 'make-dashboard': undefined });
  const r = runSandbox(script, ['claude', '--skills', 'make-explainer'], home);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n').filter((l) => /^(also installing|installed) /.test(l));
  assert.deepEqual(lines.map((l) => l.replace(/ ->.*/, '')), [
    'also installing make-diagram (required by make-explainer)',
    'also installing make-dashboard (required by make-explainer)',
    'installed make-diagram',
    'installed make-dashboard',
    'installed make-explainer',
  ]);
  for (const s of ['make-explainer', 'make-diagram', 'make-dashboard']) assert.ok(fs.existsSync(path.join(home, '.claude/skills', s, 'SKILL.md')), s);
});

test('listing a required skill explicitly installs it once, with no "also installing" for it', () => {
  const home = tmp();
  const script = sandboxWith({ 'make-explainer': ['make-diagram'], 'make-diagram': undefined });
  const r = runSandbox(script, ['claude', '--skills', 'make-diagram,make-explainer'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/installed make-diagram/g) || []).length, 1);
  assert.doesNotMatch(r.stdout, /also installing/);
});

test('a requires cycle is a usage error (exit 2) and installs nothing', () => {
  const home = tmp();
  const script = sandboxWith({ a: ['b'], b: ['a'] });
  const r = runSandbox(script, ['claude', '--skills', 'a'], home);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /dependency cycle: a -> b -> a/);
  assert.equal(fs.existsSync(path.join(home, '.claude/skills')), false);
});

test('the real make-explainer pulls in make-diagram and make-dashboard', () => {
  const home = tmp();
  const r = runInstall(['claude', '--skills', 'make-explainer'], home);
  assert.equal(r.status, 0, r.stderr);
  const order = [...r.stdout.matchAll(/^installed (\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(order, ['make-diagram', 'make-dashboard', 'make-explainer']);
});

// --- already-installed requirements, preflight, strict required names -----

const fakeTree = () => sandboxWith({ 'make-explainer': ['make-diagram', 'make-dashboard'], 'make-diagram': undefined, 'make-dashboard': undefined });
const skillDir = (home, s) => path.join(home, '.claude/skills', s);
function preInstall(home, s) {
  fs.mkdirSync(skillDir(home, s), { recursive: true });
  fs.writeFileSync(path.join(skillDir(home, s), 'mine.txt'), 'keep me');
}

test('an already-installed required skill is kept, and the dependent still installs', () => {
  const home = tmp();
  preInstall(home, 'make-diagram');
  const r = runSandbox(fakeTree(), ['claude', '--skills', 'make-explainer'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^make-diagram already installed \(required by make-explainer\)$/m);
  assert.match(r.stdout, /^also installing make-dashboard \(required by make-explainer\)$/m);
  assert.doesNotMatch(r.stdout, /installed make-diagram ->/);
  assert.equal(fs.readFileSync(path.join(skillDir(home, 'make-diagram'), 'mine.txt'), 'utf8'), 'keep me');
  assert.ok(fs.existsSync(path.join(skillDir(home, 'make-explainer'), 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(skillDir(home, 'make-dashboard'), 'SKILL.md')));
});

test('--force reinstalls required skills too', () => {
  const home = tmp();
  preInstall(home, 'make-diagram');
  const r = runSandbox(fakeTree(), ['claude', '--skills', 'make-explainer', '--force'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /already installed/);
  assert.equal(fs.existsSync(path.join(skillDir(home, 'make-diagram'), 'mine.txt')), false);
  assert.ok(fs.existsSync(path.join(skillDir(home, 'make-diagram'), 'SKILL.md')));
});

test('an explicitly requested existing skill still errors, and nothing is installed (no partial install)', () => {
  const home = tmp();
  preInstall(home, 'make-explainer');
  const r = runSandbox(fakeTree(), ['claude', '--skills', 'make-explainer'], home);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already exists.*--force/);
  assert.equal(fs.existsSync(skillDir(home, 'make-diagram')), false);
  assert.equal(fs.existsSync(skillDir(home, 'make-dashboard')), false);
  assert.equal(fs.readFileSync(path.join(skillDir(home, 'make-explainer'), 'mine.txt'), 'utf8'), 'keep me');
});

test('malformed or unknown required names are usage errors (exit 2) and install nothing', () => {
  for (const bad of ['./make-diagram', 'make-diagram/', '../x', 'Make-Diagram', 'ghost']) {
    const home = tmp();
    const script = sandboxWith({ a: [bad], 'make-diagram': undefined });
    const r = runSandbox(script, ['claude', '--skills', 'a'], home);
    assert.equal(r.status, 2, `${bad}: ${r.stderr}`);
    assert.match(r.stderr, /a requires unknown skill/, bad);
    assert.equal(fs.existsSync(path.join(home, '.claude/skills')), false, bad);
  }
});

test('the make-motion hint also fires when make-motion is only pulled in as a requirement', () => {
  const home = tmp();
  const script = sandboxWith({ a: ['make-motion'], 'make-motion': undefined });
  const r = runSandbox(script, ['claude', '--skills', 'a'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /make-motion also needs ffmpeg/);
});

// --- artifact-builder agent files -----------------------------------------

test('agentTargetsFor maps each host and scope to its agent dirs (claude gets .claude/agents, gemini none)', () => {
  const ctx = { home: '/h', proj: '/p' };
  const claude = (base, rel) => ({ host: 'claude', dir: `${base}/${rel}` });
  const copilot = (base, rel) => ({ host: 'copilot', dir: `${base}/${rel}` });
  const codex = (base, rel) => ({ host: 'codex', dir: `${base}/${rel}` });
  const table = [
    ['claude', 'user', [claude('/h', '.claude/agents')]],
    ['claude', 'project', [claude('/p', '.claude/agents')]],
    ['gemini', 'user', []],
    ['gemini', 'project', []],
    ['copilot', 'user', [copilot('/h', '.copilot/agents')]],
    ['copilot', 'project', [copilot('/p', '.github/agents')]],
    ['codex', 'user', [codex('/h', '.codex/agents')]],
    ['codex', 'project', [codex('/p', '.codex/agents')]],
    ['agents', 'user', [copilot('/h', '.copilot/agents'), codex('/h', '.codex/agents')]],
    ['agents', 'project', [copilot('/p', '.github/agents'), codex('/p', '.codex/agents')]],
  ];
  for (const [host, scope, want] of table) assert.deepEqual(agentTargetsFor(host, scope, ctx), want, `${host} ${scope}`);
});

const copilotAgent = (proj) => path.join(proj, '.github/agents/artifact-builder.agent.md');
const codexAgent = (proj) => path.join(proj, '.codex/agents/artifact-builder.toml');

test('copilot --project writes the builder agent file and prints its path', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['copilot', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(copilotAgent(proj), 'utf8'), agentFile('copilot').content);
  assert.equal(fs.existsSync(codexAgent(proj)), false);
  assert.ok(r.stdout.split('\n').includes(`agent: ${copilotAgent(proj)}`), r.stdout);
});

test('codex --project writes only the codex builder agent file', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['codex', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(codexAgent(proj), 'utf8'), agentFile('codex').content);
  assert.equal(fs.existsSync(copilotAgent(proj)), false);
});

test('agents host writes both builder agent files', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['agents', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(copilotAgent(proj)));
  assert.ok(fs.existsSync(codexAgent(proj)));
});

test('user-scope install writes the agent file under HOME', () => {
  const home = tmp();
  const r = runInstall(['agents', '--skills', 'make-motion'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(home, '.copilot/agents/artifact-builder.agent.md')));
  assert.ok(fs.existsSync(path.join(home, '.codex/agents/artifact-builder.toml')));
});

const claudeAgent = (proj) => path.join(proj, '.claude/agents/artifact-builder.md');

test('a claude install writes artifact-builder.md and a gemini install writes no agent file', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['claude', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(claudeAgent(proj), 'utf8'), agentFile('claude').content);
  assert.ok(r.stdout.split('\n').includes(`agent: ${claudeAgent(proj)}`), r.stdout);
  // The other hosts' folders stay untouched.
  assert.equal(fs.existsSync(path.join(proj, '.github/agents')), false);
  assert.equal(fs.existsSync(path.join(proj, '.codex/agents')), false);

  const gHome = tmp();
  const gProj = tmp();
  const g = runInstall(['gemini', '--project', gProj], gHome);
  assert.equal(g.status, 0, g.stderr);
  assert.doesNotMatch(g.stdout, /agent:/);
  for (const dir of ['.claude/agents', '.github/agents', '.codex/agents']) assert.equal(fs.existsSync(path.join(gProj, dir)), false, dir);
  for (const dir of ['.claude/agents', '.copilot/agents', '.codex/agents']) assert.equal(fs.existsSync(path.join(gHome, dir)), false, dir);
});

const claudeReviewer = (proj) => path.join(proj, '.claude/agents/motion-reviewer.md');

test('a claude install writes motion-reviewer.md beside artifact-builder.md; copilot and codex installs write none', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['claude', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(claudeReviewer(proj), 'utf8'), reviewerFile('claude').content);
  assert.ok(r.stdout.split('\n').includes(`agent: ${claudeReviewer(proj)}`), r.stdout);
  assert.ok(fs.existsSync(claudeAgent(proj)));

  const only = tmp();
  const o = runRaw(['claude', '--project', only, '--agents-only'], home);
  assert.equal(o.status, 0, o.stderr);
  assert.equal(fs.readFileSync(claudeReviewer(only), 'utf8'), reviewerFile('claude').content);

  for (const host of ['copilot', 'codex', 'agents']) {
    const p = tmp();
    const h = runInstall([host, '--project', p], tmp());
    assert.equal(h.status, 0, `${host}: ${h.stderr}`);
    assert.doesNotMatch(h.stdout, /motion-reviewer/, host);
    for (const dir of ['.github/agents', '.codex/agents', '.claude/agents']) {
      const abs = path.join(p, dir);
      if (fs.existsSync(abs)) assert.deepEqual(fs.readdirSync(abs).filter((f) => f.startsWith('motion-reviewer')), [], `${host} ${dir}`);
    }
  }
});

const OURS_OLD = () => reviewerFile('claude').content.replace(REVIEWER_CURRENT_MARKER, `${REVIEWER_FINGERPRINT} format 1 -->`);
const NEWER = () => reviewerFile('claude').content.replace(REVIEWER_CURRENT_MARKER, `${REVIEWER_FINGERPRINT} format 9 -->`);

test('an existing motion-reviewer.md is kept without --force, and --force alone never replaces a file the user wrote', () => {
  const home = tmp();
  const file = path.join(home, '.claude/agents/motion-reviewer.md');
  assert.equal(runRaw(['claude', '--agents-only'], home).status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), reviewerFile('claude').content);
  fs.writeFileSync(file, 'hand edited');
  const r2 = runRaw(['claude', '--agents-only'], home);
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(r2.stdout.split('\n').includes(`agent: kept existing ${file}`), r2.stdout);
  assert.equal(fs.readFileSync(file, 'utf8'), 'hand edited');
  // H1: --force is a refresh of skills, not leave to destroy the user's own reviewer.
  const r3 = runRaw(['claude', '--agents-only', '--force'], home);
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), 'hand edited', 'a foreign file survives --force');
  assert.ok(r3.stdout.split('\n').includes(`agent: kept existing ${file}`), r3.stdout);
  assert.match(r3.stderr, /not a portable-artifacts file/);
  assert.match(r3.stderr, /--replace-foreign/);
  assert.ok(fs.existsSync(path.join(home, '.claude/agents/artifact-builder.md')), 'the builder is still written');
  const r4 = runRaw(['claude', '--agents-only', '--force', '--replace-foreign'], home);
  assert.equal(r4.status, 0, r4.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), reviewerFile('claude').content);
  assert.equal(fs.readFileSync(`${file}.bak`, 'utf8'), 'hand edited', 'a copy is kept');
});

test('install --force never downgrades a newer reviewer file, and --force --replace-foreign does', () => {
  const home = tmp();
  const file = path.join(home, '.claude/agents/motion-reviewer.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, NEWER());
  const r = runRaw(['claude', '--agents-only', '--force'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), NEWER(), 'byte for byte');
  assert.match(r.stderr, /newer/);
  runRaw(['claude', '--agents-only', '--force', '--replace-foreign'], home);
  assert.equal(fs.readFileSync(file, 'utf8'), reviewerFile('claude').content);
});

test('install --force replaces our own older reviewer, after copying it to .bak (then .bak.1)', () => {
  const home = tmp();
  const file = path.join(home, '.claude/agents/motion-reviewer.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const [n, name] of [[1, 'motion-reviewer.md.bak'], [2, 'motion-reviewer.md.bak.1']]) {
    const old = `${OURS_OLD()}\nedit ${n}\n`;
    fs.writeFileSync(file, old);
    const r = runRaw(['claude', '--agents-only', '--force'], home);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(file, 'utf8'), reviewerFile('claude').content);
    assert.equal(fs.readFileSync(path.join(path.dirname(file), name), 'utf8'), old, name);
    assert.match(r.stdout, new RegExp(`backed up .*motion-reviewer\\.md to .*${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}`), r.stdout);
  }
});

test('install --force refuses a symlink at motion-reviewer.md, even to a file of ours', { skip: process.platform === 'win32' && 'symbolic links need a privilege on Windows' }, () => {
  const home = tmp();
  const file = path.join(home, '.claude/agents/motion-reviewer.md');
  const target = path.join(home, 'elsewhere.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(target, OURS_OLD());
  fs.symlinkSync(target, file);
  const r = runRaw(['claude', '--agents-only', '--force'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.lstatSync(file).isSymbolicLink());
  assert.equal(fs.readFileSync(target, 'utf8'), OURS_OLD());
});

test('--replace-foreign needs --force', () => {
  const r = runRaw(['claude', '--agents-only', '--replace-foreign'], tmp());
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /--replace-foreign needs --force/);
});

test('the agents host still writes only the copilot and codex files', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['agents', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(copilotAgent(proj)));
  assert.ok(fs.existsSync(codexAgent(proj)));
  assert.equal(fs.existsSync(path.join(proj, '.claude')), false);
});

test("a claude install into the plugin's own checkout never targets P/agents", () => {
  const pluginRoot = path.resolve(here, '../..');
  for (const scope of ['user', 'project']) {
    const targets = agentTargetsFor('claude', scope, { home: pluginRoot, proj: pluginRoot });
    assert.deepEqual(targets.map((t) => t.dir), [path.join(pluginRoot, '.claude/agents')], scope);
    assert.notEqual(targets[0].dir, path.join(pluginRoot, 'agents'));
  }
  // A real install into a temp project writes under .claude/agents only, never a top-level agents folder.
  const proj = tmp();
  assert.equal(runInstall(['claude', '--project', proj, '--skills', 'make-motion'], tmp()).status, 0);
  assert.equal(fs.existsSync(path.join(proj, 'agents')), false);
  assert.deepEqual(fs.readdirSync(path.join(proj, '.claude')).sort(), ['agents', 'skills']);
});

test('an existing agent file is kept without --force and replaced with it', () => {
  const home = tmp();
  const proj = tmp();
  const file = copilotAgent(proj);
  assert.equal(runInstall(['copilot', '--project', proj, '--skills', 'make-motion'], home).status, 0);
  fs.writeFileSync(file, 'hand edited');
  // The skill dirs would make a second run refuse without --force; remove them to isolate the agent behaviour.
  fs.rmSync(path.join(proj, '.github/skills'), { recursive: true, force: true });
  const r2 = runInstall(['copilot', '--project', proj, '--skills', 'make-motion'], home);
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(r2.stdout.split('\n').includes(`agent: kept existing ${file}`), r2.stdout);
  assert.equal(fs.readFileSync(file, 'utf8'), 'hand edited');
  const r3 = runInstall(['copilot', '--project', proj, '--skills', 'make-motion', '--force'], home);
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), agentFile('copilot').content);
  assert.ok(r3.stdout.split('\n').includes(`agent: ${file}`), r3.stdout);
});

test('an unwritable agent dir warns on stderr and the skills still install (exit 0)', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, () => {
  const home = tmp();
  const proj = tmp();
  const agentsDir = path.join(proj, '.github/agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.chmodSync(agentsDir, 0o555);
  try {
    const r = runInstall(['copilot', '--project', proj, '--skills', 'make-motion'], home);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /agent: could not write .*artifact-builder\.agent\.md/);
    assert.ok(fs.existsSync(path.join(proj, '.github/skills/make-motion/SKILL.md')));
    assert.equal(fs.existsSync(copilotAgent(proj)), false);
  } finally {
    fs.chmodSync(agentsDir, 0o755);
  }
});

// --- --agents-only ----------------------------------------------------------

// No automatic --no-deps here: --agents-only must reject it.
const runRaw = (args, home) => spawnSync(process.execPath, [installer, ...args], {
  encoding: 'utf8', env: { ...process.env, HOME: home },
});

test('--agents-only writes just the agent file even when the skills are already installed', () => {
  const home = tmp();
  const proj = tmp();
  assert.equal(runInstall(['copilot', '--project', proj, '--skills', 'make-motion'], home).status, 0);
  fs.rmSync(copilotAgent(proj), { force: true });
  const r = runRaw(['copilot', '--project', proj, '--agents-only'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.split('\n').includes(`agent: ${copilotAgent(proj)}`), r.stdout);
  assert.equal(fs.readFileSync(copilotAgent(proj), 'utf8'), agentFile('copilot').content);
  assert.doesNotMatch(r.stdout, /installed /);
});

test('--agents-only with an unwritable agent dir fails: exit 1, warning, no agent line', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, () => {
  const home = tmp();
  const proj = tmp();
  const agentsDir = path.join(proj, '.github/agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.chmodSync(agentsDir, 0o555);
  try {
    const r = runRaw(['copilot', '--project', proj, '--agents-only'], home);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /could not write/);
    assert.doesNotMatch(r.stdout, /agent:/);
    assert.equal(fs.existsSync(copilotAgent(proj)), false);
  } finally {
    fs.chmodSync(agentsDir, 0o755);
  }
});

// A symlink at the target path must never be written through.
function agentsDirWithTarget(proj) {
  const dir = path.join(proj, '.github/agents');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'artifact-builder.agent.md');
}

test('a dangling symlink at the agent path is kept and its target is not created', () => {
  const home = tmp();
  const proj = tmp();
  const outside = path.join(tmp(), 'victim.md');
  const file = agentsDirWithTarget(proj);
  fs.symlinkSync(outside, file);
  const r = runRaw(['copilot', '--project', proj, '--agents-only'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.split('\n').includes(`agent: kept existing ${file}`), r.stdout);
  assert.equal(fs.existsSync(outside), false);
  assert.ok(fs.lstatSync(file).isSymbolicLink());
});

test('a symlink to a real file is kept without --force; --force replaces the link, not the file it points to', () => {
  const home = tmp();
  const proj = tmp();
  const real = path.join(tmp(), 'precious.md');
  fs.writeFileSync(real, 'precious');
  const file = agentsDirWithTarget(proj);
  fs.symlinkSync(real, file);
  const r1 = runRaw(['copilot', '--project', proj, '--agents-only'], home);
  assert.equal(r1.status, 0, r1.stderr);
  assert.ok(r1.stdout.split('\n').includes(`agent: kept existing ${file}`), r1.stdout);
  assert.ok(fs.lstatSync(file).isSymbolicLink());
  assert.equal(fs.readFileSync(real, 'utf8'), 'precious');
  const r2 = runRaw(['copilot', '--project', proj, '--agents-only', '--force'], home);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(fs.readFileSync(real, 'utf8'), 'precious');
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(file, 'utf8'), agentFile('copilot').content);
});

test('a directory at the agent path is neither kept nor overwritten: warn, exit 0 in an install, 1 with --agents-only', () => {
  const home = tmp();
  const proj = tmp();
  const file = agentsDirWithTarget(proj);
  fs.mkdirSync(file);
  fs.writeFileSync(path.join(file, 'inside.txt'), 'x');
  for (const force of [[], ['--force']]) {
    const only = runRaw(['copilot', '--project', proj, '--agents-only', ...force], home);
    assert.equal(only.status, 1, only.stderr);
    assert.match(only.stderr, /agent: .*artifact-builder\.agent\.md is not a file/);
    assert.doesNotMatch(only.stdout, /agent:/);
  }
  const full = runInstall(['copilot', '--project', proj, '--skills', 'make-motion'], home);
  assert.equal(full.status, 0, full.stderr);
  assert.match(full.stderr, /is not a file/);
  assert.ok(fs.existsSync(path.join(proj, '.github/skills/make-motion/SKILL.md')));
  assert.ok(fs.statSync(file).isDirectory());
  assert.ok(fs.existsSync(path.join(file, 'inside.txt')));
});

test('inherited object keys are not hosts: constructor and toString are usage errors (exit 2)', () => {
  const home = tmp();
  for (const host of ['constructor', 'toString', '__proto__']) {
    assert.equal(runInstall([host], home).status, 2, host);
    assert.equal(runRaw([host, '--agents-only'], home).status, 2, host);
  }
  assert.deepEqual(agentTargetsFor('constructor', 'user', { home: '/h', proj: '/p' }), []);
});

test('--agents-only installs no skills', () => {
  const home = tmp();
  const proj = tmp();
  const r = runRaw(['agents', '--project', proj, '--agents-only'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(copilotAgent(proj)));
  assert.ok(fs.existsSync(codexAgent(proj)));
  assert.equal(fs.existsSync(path.join(proj, '.agents/skills')), false);
  assert.equal(fs.existsSync(path.join(proj, '.github/skills')), false);
});

test('--agents-only keeps an existing agent file, and --force replaces it', () => {
  const home = tmp();
  const proj = tmp();
  const file = copilotAgent(proj);
  assert.equal(runRaw(['copilot', '--project', proj, '--agents-only'], home).status, 0);
  fs.writeFileSync(file, 'hand edited');
  const r2 = runRaw(['copilot', '--project', proj, '--agents-only'], home);
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(r2.stdout.split('\n').includes(`agent: kept existing ${file}`), r2.stdout);
  assert.equal(fs.readFileSync(file, 'utf8'), 'hand edited');
  const r3 = runRaw(['copilot', '--project', proj, '--agents-only', '--force'], home);
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), agentFile('copilot').content);
});

test('--agents-only works at user scope under HOME', () => {
  const home = tmp();
  const r = runRaw(['codex', '--agents-only'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(home, '.codex/agents/artifact-builder.toml')));
});

test('--agents-only on claude writes the file; on gemini it says there is no agent file and exits 0', () => {
  const home = tmp();
  const proj = tmp();
  const c = runRaw(['claude', '--project', proj, '--agents-only'], home);
  assert.equal(c.status, 0, c.stderr);
  assert.ok(c.stdout.split('\n').includes(`agent: ${claudeAgent(proj)}`), c.stdout);
  assert.equal(fs.readFileSync(claudeAgent(proj), 'utf8'), agentFile('claude').content);
  assert.equal(fs.existsSync(path.join(proj, '.claude/skills')), false);

  const gHome = tmp();
  const gProj = tmp();
  const g = runRaw(['gemini', '--project', gProj, '--agents-only'], gHome);
  assert.equal(g.status, 0, g.stderr);
  assert.ok(g.stdout.split('\n').includes('no agent file for gemini'), g.stdout);
  assert.equal(fs.readdirSync(gProj).length, 0);
});

// The agent-file paths are host-independent code (installAgents, writeAgentFile). These repeat the
// copilot cases above for claude so a regression in the claude target shows up.
test('claude: an existing agent file is kept without --force and replaced with it (--agents-only, user scope)', () => {
  const home = tmp();
  const file = path.join(home, '.claude/agents/artifact-builder.md');
  assert.equal(runRaw(['claude', '--agents-only'], home).status, 0);
  fs.writeFileSync(file, 'hand edited');
  const r2 = runRaw(['claude', '--agents-only'], home);
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(r2.stdout.split('\n').includes(`agent: kept existing ${file}`), r2.stdout);
  assert.equal(fs.readFileSync(file, 'utf8'), 'hand edited');
  const r3 = runRaw(['claude', '--agents-only', '--force'], home);
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), agentFile('claude').content);
});

test('claude: an unwritable agent dir warns; the skills still install (exit 0), --agents-only fails (exit 1)', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, () => {
  const home = tmp();
  const proj = tmp();
  const agentsDir = path.join(proj, '.claude/agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.chmodSync(agentsDir, 0o555);
  try {
    const full = runInstall(['claude', '--project', proj, '--skills', 'make-motion'], home);
    assert.equal(full.status, 0, full.stderr);
    assert.match(full.stderr, /agent: could not write .*artifact-builder\.md/);
    assert.ok(fs.existsSync(path.join(proj, '.claude/skills/make-motion/SKILL.md')));
    const only = runRaw(['claude', '--project', proj, '--agents-only'], home);
    assert.equal(only.status, 1, only.stdout + only.stderr);
    assert.match(only.stderr, /could not write/);
    assert.equal(fs.existsSync(claudeAgent(proj)), false);
  } finally {
    fs.chmodSync(agentsDir, 0o755);
  }
});

test('claude: a symlink at the agent path is kept, and --force replaces the link, not the file it points to', () => {
  const home = tmp();
  const proj = tmp();
  const real = path.join(tmp(), 'precious.md');
  fs.writeFileSync(real, 'precious');
  const file = claudeAgent(proj);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(real, file);
  const r1 = runRaw(['claude', '--project', proj, '--agents-only'], home);
  assert.equal(r1.status, 0, r1.stderr);
  assert.ok(r1.stdout.split('\n').includes(`agent: kept existing ${file}`), r1.stdout);
  assert.ok(fs.lstatSync(file).isSymbolicLink());
  const r2 = runRaw(['claude', '--project', proj, '--agents-only', '--force'], home);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(fs.readFileSync(real, 'utf8'), 'precious');
  assert.equal(fs.readFileSync(file, 'utf8'), agentFile('claude').content);
});

test('claude: a directory at the agent path is neither kept nor overwritten', () => {
  const home = tmp();
  const proj = tmp();
  const file = claudeAgent(proj);
  fs.mkdirSync(file, { recursive: true });
  fs.writeFileSync(path.join(file, 'inside.txt'), 'x');
  const only = runRaw(['claude', '--project', proj, '--agents-only', '--force'], home);
  assert.equal(only.status, 1, only.stderr);
  assert.match(only.stderr, /agent: .*artifact-builder\.md is not a file/);
  assert.ok(fs.existsSync(path.join(file, 'inside.txt')));
});

test('--agents-only with --skills, --link or --no-deps is a usage error naming the flags', () => {
  const home = tmp();
  const proj = tmp();
  for (const flags of [['--skills', 'make-motion'], ['--link'], ['--no-deps'], ['--skills', 'make-motion', '--link']]) {
    const r = runRaw(['copilot', '--project', proj, '--agents-only', ...flags], home);
    assert.equal(r.status, 2, `${flags}: ${r.stderr}`);
    for (const f of flags.filter((x) => x.startsWith('--'))) assert.ok(r.stderr.includes(f), `${f} in: ${r.stderr}`);
    assert.match(r.stderr, /--agents-only/);
  }
  assert.equal(fs.readdirSync(proj).length, 0);
});
