#!/usr/bin/env node
// Install the portable-artifacts skills into another agent host's skill dir (--help prints the usage).
//   node bin/install.mjs <claude|codex|copilot|gemini|agents> [--project <dir>] [--skills a,b] [--link] [--force] [--no-deps]
//   node bin/install.mjs <host> [--project <dir>] --agents-only [--force]   (agent files only: no skills, no preflight, no npm)
// claude, codex, copilot and agents also get the cheap-model artifact-builder agent file (kept if present unless --force).
// claude also gets the read-only motion-reviewer agent file, the same way, except that --force never replaces a file the
// user wrote, a newer file of ours or a symbolic link there unless --replace-foreign is also given (a replaced file is
// first copied to motion-reviewer.md.bak).
// Each host reads SKILL.md folders from its own documented locations; the
// skill itself is the slash command there (/name, or $name in Codex).
// A skill's package.json "portableArtifacts": {"requires": [...]} pulls in sibling skills first.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentFile, REVIEWER_HOSTS, reviewerFile, writeAgentFile, writeReviewerFile } from '../shared/agents.mjs';
import { parseCli, UsageError, exitUsage } from '../shared/cli.mjs';
import { cmdLine } from '../shared/doctor.mjs';

const SKILLS_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills');
const SKIP = new Set(['node_modules', 'test', 'dist', 'out', '.cache']);

// host -> [user dir, project dir] relative to HOME / project root, plus how to invoke.
export const HOSTS = {
  claude: { user: '.claude/skills', project: '.claude/skills', invoke: (s) => `/${s}` },
  codex: { user: '.agents/skills', project: '.agents/skills', invoke: (s) => `$${s}` },
  copilot: { user: '.copilot/skills', project: '.github/skills', invoke: (s) => `/${s}` },
  gemini: { user: '.gemini/skills', project: '.gemini/skills', commands: '.gemini/commands', invoke: (s) => `/${s}` },
  agents: { user: '.agents/skills', project: '.agents/skills', invoke: (s) => `$${s} (Codex) or /${s} (Copilot)` },
};

export function targetsFor(host, scope, { home, proj }) {
  const h = HOSTS[host];
  const base = scope === 'user' ? home : proj;
  return {
    skills: path.join(base, h[scope]),
    commands: h.commands ? path.join(base, h.commands) : null,
  };
}

// Custom-agent folders: the artifact-builder agent file goes where Claude Code, Copilot and Codex read agents, and
// the read-only motion-reviewer file goes beside it for Claude Code only (installAgents).
// gemini gets none; the shared "agents" host gets the Copilot and Codex files (Claude Code has its own host).
// The plugin install gets both from the plugin's own agents/ folder instead; this is the path for installs without the plugin.
const AGENT_DIRS = {
  claude: { user: '.claude/agents', project: '.claude/agents' },
  copilot: { user: '.copilot/agents', project: '.github/agents' },
  codex: { user: '.codex/agents', project: '.codex/agents' },
};
const AGENT_HOSTS = { claude: ['claude'], copilot: ['copilot'], codex: ['codex'], agents: ['copilot', 'codex'] };

export function agentTargetsFor(host, scope, { home, proj }) {
  const base = scope === 'user' ? home : proj;
  return (Object.hasOwn(AGENT_HOSTS, host) ? AGENT_HOSTS[host] : []).map((h) => ({ host: h, dir: path.join(base, AGENT_DIRS[h][scope]) }));
}

export { UsageError };

const USAGE = 'node bin/install.mjs <claude|codex|copilot|gemini|agents> [--project <dir>] [--skills a,b] [--link] [--force [--replace-foreign]] [--no-deps] [--agents-only]';
const OPTIONS = {
  project: { type: 'string' },
  skills: { type: 'string' },
  link: { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  'replace-foreign': { type: 'boolean', default: false },
  'no-deps': { type: 'boolean', default: false },
  'agents-only': { type: 'boolean', default: false },
};

const SKILL_NAME = /^[a-z][a-z0-9-]*$/;

// Skills a skill needs installed beside it: package.json -> portableArtifacts.requires.
function readRequires(skill, src) {
  const file = path.join(src, skill, 'package.json');
  if (!fs.existsSync(file)) return [];
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new UsageError(`${skill}: package.json is not valid JSON (${e.message})`);
  }
  const requires = pkg.portableArtifacts?.requires ?? [];
  if (!Array.isArray(requires) || requires.some((r) => typeof r !== 'string')) {
    throw new UsageError(`${skill}: portableArtifacts.requires must be an array of skill names`);
  }
  return requires;
}

// Expand the requested skills with everything they require (transitively):
// dependency first, each skill once. requiredBy is set only on skills nobody asked for by name.
export function expandRequires(requested, src = SKILLS_SRC) {
  const asked = new Set(requested);
  const plan = [];
  const done = new Set();
  const visit = (skill, requiredBy, chain) => {
    if (done.has(skill)) return;
    if (chain.includes(skill)) throw new UsageError(`dependency cycle: ${[...chain.slice(chain.indexOf(skill)), skill].join(' -> ')}`);
    if (requiredBy && !(SKILL_NAME.test(skill) && fs.existsSync(path.join(src, skill, 'SKILL.md')))) {
      throw new UsageError(`${requiredBy} requires unknown skill "${skill}"`);
    }
    for (const dep of readRequires(skill, src)) visit(dep, skill, [...chain, skill]);
    done.add(skill);
    plan.push(asked.has(skill) ? { skill } : { skill, requiredBy });
  };
  for (const skill of requested) visit(skill, undefined, []);
  return plan;
}

function readDescription(skillDir) {
  const md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  return md.match(/^description:\s*(.+)$/m)?.[1].trim() ?? '';
}

function geminiCommand(skill, description) {
  const desc = description.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return [
    `description = "${desc}"`,
    'prompt = """',
    `Activate the ${skill} skill and follow its SKILL.md workflow exactly.`,
    'Request: {{args}}',
    '"""',
    '',
  ].join('\n');
}

// How to spawn npm. On win32 npm is a .cmd shim and Node (CVE-2024-27980 fix, 18.20.2 and later) refuses to spawn one
// without a shell, so the line goes through cmd.exe, quoted as shared/doctor.mjs quotes its own fix commands.
export function npmCommand(args, platform = process.platform) {
  return platform === 'win32' ? { cmd: cmdLine(['npm', ...args]), args: [], shell: true } : { cmd: 'npm', args, shell: false };
}

// Put the skill at `at`: a symlink to the source, or a copy without node_modules, tests and build output.
function placeSkill(src, at, link) {
  if (link) {
    fs.symlinkSync(src, at, 'dir');
    return;
  }
  fs.cpSync(src, at, {
    recursive: true,
    filter: (p) => !path.relative(src, p).split(path.sep).some((seg) => SKIP.has(seg)),
  });
}

// npm ci for the skill placed at `at`; a message when it failed, otherwise null.
function installDeps(src, at, link) {
  // A linked install runs inside the source checkout: --omit=dev there would delete the developer's dev deps.
  const args = ['ci', '--ignore-scripts', ...(link ? [] : ['--omit=dev']), '--no-audit', '--no-fund'];
  const npm = npmCommand(args);
  const r = spawnSync(npm.cmd, npm.args, { cwd: link ? src : at, stdio: 'inherit', shell: npm.shell });
  if (r.status === 0) return null;
  return r.error ? ` (${r.error.message})` : '';
}

// Move the finished install into place. An existing install is renamed aside first and put back if the rename fails.
// Once the swap has happened the install is done: a backup that will not delete (a locked file, a permission) is a
// warning naming the leftover path, never a failed install. `rm` and `warn` are test seams.
export function swapIn(stage, dst, existing, { rm = fs.rmSync, warn = warnStderr } = {}) {
  if (!existing) {
    fs.renameSync(stage, dst);
    return;
  }
  const backup = path.join(path.dirname(dst), `.${path.basename(dst)}.old-${process.pid}`);
  fs.renameSync(dst, backup);
  try {
    fs.renameSync(stage, dst);
  } catch (e) {
    fs.renameSync(backup, dst);
    throw e;
  }
  try {
    rm(backup, { recursive: true, force: true }); // a link is removed, never its target
  } catch (e) {
    warn(`the new install is in place at ${dst}, but the old copy could not be removed (${e.message}); delete ${backup} yourself`);
  }
}

function warnStderr(message) {
  process.stderr.write(`install: warning: ${message}\n`);
}

// Folders an earlier run left beside the destination. A `.new-*` stage never held anything but a half-built copy, so
// it goes. A `.old-*` backup may be the only copy of a user's install (a run that died between its two renames), so it
// stays and the user is told.
function clearLeftovers(dstRoot, skill) {
  const stagePrefix = `.${skill}.new-`;
  const backupPrefix = `.${skill}.old-`;
  for (const name of fs.readdirSync(dstRoot)) {
    const at = path.join(dstRoot, name);
    if (name.startsWith(stagePrefix)) {
      fs.rmSync(at, { recursive: true, force: true }); // a link is removed, never its target
    } else if (name.startsWith(backupPrefix)) {
      warnStderr(`${at} was left by an earlier install of ${skill} and may hold a previous copy; check it, then delete it`);
    }
  }
}

// The new install is built beside the destination (a dot folder in the same skills dir) and swapped in once npm ci has
// passed, so a failed upgrade under --force (offline, registry error) leaves the working install where it was.
function installSkill(skill, dstRoot, { link, force, deps }) {
  const src = path.join(SKILLS_SRC, skill);
  const dst = path.join(dstRoot, skill);
  if (fs.existsSync(dst) && fs.realpathSync(dst) === fs.realpathSync(src)) {
    throw new Error(`${dst} is the source skill itself (the host dir points into this checkout); refusing to replace it`);
  }
  const existing = fs.existsSync(dst) || isSymlink(dst);
  if (existing && !force) throw new Error(`${dst} already exists; pass --force to replace it`);
  fs.mkdirSync(dstRoot, { recursive: true });
  const stage = path.join(dstRoot, `.${skill}.new-${process.pid}`);
  clearLeftovers(dstRoot, skill);
  try {
    placeSkill(src, stage, link);
    const failure = deps ? installDeps(src, stage, link) : null;
    if (failure !== null) {
      const outcome = existing ? `discarded the new copy; the existing install at ${dst} is unchanged` : `nothing was installed at ${dst}`;
      throw new Error(`npm ci failed in ${link ? src : stage}${failure}; ${outcome}`);
    }
    swapIn(stage, dst, existing);
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true }); // a link is removed, never its target
    throw e;
  }
  return dst;
}

function isSymlink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

function parse(argv) {
  // parseCli: --help/-h throw a help request, and an unknown flag names itself, the nearest real flag and the usage line.
  const parsed = parseCli(argv, OPTIONS, USAGE);
  const [host] = parsed.positionals;
  if (!Object.hasOwn(HOSTS, host)) throw new UsageError(`unknown host "${host ?? ''}"; use one of: ${Object.keys(HOSTS).join(', ')}`);
  const all = fs.readdirSync(SKILLS_SRC).filter((d) => fs.existsSync(path.join(SKILLS_SRC, d, 'SKILL.md')));
  if (parsed.values.project === '') throw new UsageError('--project needs a directory');
  if (parsed.values['replace-foreign'] && !parsed.values.force) throw new UsageError('--replace-foreign needs --force');
  if (parsed.values['agents-only']) {
    const clash = [parsed.values.skills !== undefined && '--skills', parsed.values.link && '--link', parsed.values['no-deps'] && '--no-deps'].filter(Boolean);
    if (clash.length) throw new UsageError(`--agents-only cannot be combined with ${clash.join(', ')}`);
  }
  const skills = parsed.values.skills ? [...new Set(parsed.values.skills.split(','))] : all;
  const unknown = skills.filter((s) => !all.includes(s));
  if (unknown.length) throw new UsageError(`unknown skill(s): ${unknown.join(', ')}; available: ${all.join(', ')}`);
  return { ...parsed.values, host, skills };
}

// Check every destination before installing anything, so a refusal leaves no partial install.
// A skill that was only pulled in as a requirement and is already there is kept (keep: true);
// a skill the user named, or any skill under --force, is replaced or refused as before.
function preflight(plan, dstRoot, { force }) {
  return plan.map((entry) => {
    const src = path.join(SKILLS_SRC, entry.skill);
    const dst = path.join(dstRoot, entry.skill);
    const present = fs.existsSync(dst) || isSymlink(dst);
    if (present && entry.requiredBy && !force) return { ...entry, keep: true };
    if (fs.existsSync(dst) && fs.realpathSync(dst) === fs.realpathSync(src)) {
      throw new Error(`${dst} is the source skill itself (the host dir points into this checkout); refusing to replace it`);
    }
    if (present && !force) throw new Error(`${dst} already exists; pass --force to replace it`);
    return entry;
  });
}

// Write each agent file; an existing one is kept unless force. The builder file is ours by name, so --force replaces it. The
// reviewer's name is generic, so --force goes through the same gate as `agents.mjs write-reviewer`: a file the user wrote, a
// newer file of ours or a symbolic link is kept (and said so) unless --replace-foreign is also given, and a file it does
// replace is copied to motion-reviewer.md.bak first. Returns true if any write failed (main decides whether that is fatal).
function installAgents(targets, { force, replaceForeign = false }) {
  let failed = false;
  for (const { host, dir } of targets) {
    const files = [{ ...agentFile(host), isReviewer: false }];
    if (REVIEWER_HOSTS.includes(host)) files.push({ ...reviewerFile(host), isReviewer: true });
    for (const { fileName, content, isReviewer } of files) {
      const file = path.join(dir, fileName);
      try {
        const r = isReviewer ? writeReviewerFile(dir, file, content, { force, replaceForeign }) : { result: writeAgentFile(dir, file, content, force) };
        if (r.backup) process.stdout.write(`agent: backed up ${file} to ${r.backup}\n`);
        if (r.backupError) process.stderr.write(`install: agent: ${r.backupError}\n`);
        const result = r.result;
        if (result === 'refused') {
          // The user's file is safe: say why it was kept, and do not fail the install.
          process.stdout.write(`agent: kept existing ${file}\n`);
          process.stderr.write(`install: agent: ${r.reason}\n`);
        } else if (result === 'kept') process.stdout.write(`agent: kept existing ${file}\n`);
        else if (result === 'not-file') {
          failed = true;
          process.stderr.write(`install: agent: ${file} is not a file\n`);
        } else process.stdout.write(`agent: ${file}\n`);
      } catch (e) {
        failed = true;
        process.stderr.write(`install: agent: could not write ${file} (${e.message})\n`);
      }
    }
  }
  return failed;
}

function main() {
  const opts = parse(process.argv.slice(2));
  const scope = opts.project ? 'project' : 'user';
  const ctx = { home: os.homedir(), proj: path.resolve(opts.project ?? '.') };
  const dirs = targetsFor(opts.host, scope, ctx);
  const h = HOSTS[opts.host];
  if (opts['agents-only']) {
    const targets = agentTargetsFor(opts.host, scope, ctx);
    if (!targets.length) {
      process.stdout.write(`no agent file for ${opts.host}\n`);
      return;
    }
    // The agent file is the whole job here, so a failed write is a failed run.
    if (installAgents(targets, { force: opts.force, replaceForeign: opts['replace-foreign'] })) process.exitCode = 1;
    return;
  }
  const plan = preflight(expandRequires(opts.skills), dirs.skills, { force: opts.force });
  for (const { skill, requiredBy, keep } of plan) {
    if (keep) process.stdout.write(`${skill} already installed (required by ${requiredBy})\n`);
    else if (requiredBy) process.stdout.write(`also installing ${skill} (required by ${requiredBy})\n`);
  }
  for (const { skill, keep } of plan) {
    if (keep) continue;
    const dst = installSkill(skill, dirs.skills, { link: opts.link, force: opts.force, deps: !opts['no-deps'] });
    if (dirs.commands) {
      fs.mkdirSync(dirs.commands, { recursive: true });
      const toml = path.join(dirs.commands, `${skill}.toml`);
      fs.writeFileSync(toml, geminiCommand(skill, readDescription(path.join(SKILLS_SRC, skill))));
    }
    process.stdout.write(`installed ${skill} -> ${dst}\n  invoke: ${h.invoke(skill)} <what to make>\n`);
  }
  installAgents(agentTargetsFor(opts.host, scope, ctx), { force: opts.force, replaceForeign: opts['replace-foreign'] });
  if (plan.some((p) => p.skill === 'make-motion')) {
    process.stdout.write('make-motion also needs ffmpeg on PATH and, once: npx playwright install chromium (run in the skill folder)\n');
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    // exitCode, not process.exit(): exiting right after a pipe write can SIGSEGV on Node 24.7
    if (e.help === true) exitUsage(e); // --help: usage on stdout, exit 0
    else {
      process.stderr.write(`install: ${e.message}\n`);
      process.exitCode = e instanceof UsageError ? 2 : 1;
    }
  }
}
