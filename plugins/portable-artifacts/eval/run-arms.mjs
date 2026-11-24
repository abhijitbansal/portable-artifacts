#!/usr/bin/env node
// The arms driver: one prompt set run through several copies of a skill ("arms"), one session at a time, under one spend
// ceiling. It owns the whole test because run-eval.mjs runs one set and one skill folder per process, so a cap and an
// interleaving across arms cannot live there. Each finished case is appended to <out>/cases.jsonl at once; --resume skips the
// finished ones and counts their spend. BILLED: one host session per case, each capped by --budget, and no case starts that
// could take the spend past --max-total. Scoring uses the repository's own skill, not the arm's copy. See eval/README.md.
//
//   node eval/run-arms.mjs --skill motion --set budget --host claude-stream --model sonnet --arm A=<folder> --arm D=<folder> \
//     --budget 1.00 --max-total 20 --timeout 1800 --out <dir> [--resume] [--limit n] [--dry-run]
//   node eval/run-arms.mjs --packets --skill motion --set budget --out <dir>   blind packets and the key, from the finished cases
//   node eval/run-arms.mjs --verdict --out <dir> --ratings <dir>               the pass rule over the cases and the readers' replies
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SKILLS, loadPrompts, run } from './lib.mjs';
import { caseOrder, failReason, mayStart, readLedger, renderVerdict, verdict } from './arms-lib.mjs';
import { readRatings, writePackets } from './arms-packets.mjs';
import { runCase } from './arms-case.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_SEC = 1800;
const EXIT_USAGE = 2;
const EXIT_CEILING = 3;
const ARM_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const USAGE = `usage: node eval/run-arms.mjs --skill motion --set <name> --host claude-stream [--model m] --arm name=<folder> [--arm ...] --budget <usd> --max-total <usd> --out <dir> [--timeout sec] [--resume] [--limit n] [--dry-run] [--help]
       node eval/run-arms.mjs --packets --skill motion [--set name] --out <dir>
       node eval/run-arms.mjs --verdict --out <dir> --ratings <dir>\n`;

class UsageError extends Error {}
const refuse = (msg) => { throw new UsageError(msg); };

function parseOptions(argv) {
  try {
    return parseArgs({
      args: argv,
      options: {
        skill: { type: 'string' }, set: { type: 'string' }, host: { type: 'string' }, model: { type: 'string' },
        arm: { type: 'string', multiple: true, default: [] }, budget: { type: 'string' }, 'max-total': { type: 'string' },
        timeout: { type: 'string', default: String(DEFAULT_TIMEOUT_SEC) }, out: { type: 'string' }, limit: { type: 'string' },
        resume: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false },
        packets: { type: 'boolean', default: false }, verdict: { type: 'boolean', default: false }, ratings: { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }).values;
  } catch (e) {
    return refuse(e.message);
  }
}

function positive(flag, text, unit) {
  const n = Number(text);
  if (text === undefined) refuse(`${flag} is required`);
  if (!(Number.isFinite(n) && n > 0)) refuse(`${flag} must be a positive number${unit}, got "${text}"`);
  return n;
}

// name=folder pairs, each folder a skill folder (SKILL.md): checked before anything starts.
function readArms(specs) {
  if (specs.length === 0) refuse('at least one --arm name=<skill folder> is needed');
  const arms = new Map();
  for (const spec of specs) {
    const at = spec.indexOf('=');
    if (at < 1 || at === spec.length - 1) refuse(`--arm needs name=<skill folder>, got "${spec}"`);
    const name = spec.slice(0, at);
    if (!ARM_NAME.test(name)) refuse(`arm name "${name}" must be letters, digits, - or _`);
    if (arms.has(name)) refuse(`--arm ${name} is repeated`);
    const folder = path.resolve(spec.slice(at + 1));
    if (!fs.existsSync(path.join(folder, 'SKILL.md'))) refuse(`arm ${name}: ${folder} has no SKILL.md, so it is not a skill folder`);
    arms.set(name, folder);
  }
  return arms;
}

function readHost(opts, evalDir) {
  const host = JSON.parse(fs.readFileSync(path.join(evalDir, 'hosts.json'), 'utf8'))[opts.host];
  if (!host) refuse(`unknown --host ${opts.host ?? ''}`);
  if (!host.stream || !host.budgetArgs) refuse(`host "${opts.host}" does not stream its session with a spend cap, and the driver reads each cost from the stream`);
  if (opts.model !== undefined && !host.modelArgs) refuse(`host "${opts.host}" has no modelArgs, so --model would be ignored; leave it out`);
  return host;
}

// Everything that can be refused is refused here, before a directory is made or a host started.
function plan(opts, { evalDir, skillsRoot, promptsDir }) {
  const skillCfg = SKILLS[opts.skill];
  if (!skillCfg) refuse(`unknown --skill ${opts.skill ?? ''}`);
  if (!skillCfg.keepFiles) refuse(`--skill ${opts.skill} keeps no files (keepFiles), so a case has no film to compare`);
  const host = readHost(opts, evalDir);
  const budget = positive('--budget', opts.budget, ' of dollars');
  const maxTotal = positive('--max-total', opts['max-total'], ' of dollars');
  if (maxTotal < budget) refuse(`--max-total ${maxTotal} is below --budget ${budget}: not even one case could start`);
  const timeoutSec = positive('--timeout', opts.timeout, ' of seconds');
  if (opts.out === undefined) refuse('--out <dir> is required');
  let prompts;
  try { prompts = loadPrompts(promptsDir, opts.skill, opts.set); } catch (e) { refuse(e.message); }
  if (opts.limit !== undefined) {
    const n = Number(opts.limit);
    if (!Number.isInteger(n) || n < 1) refuse(`--limit must be a positive integer, got "${opts.limit}"`);
    prompts = prompts.slice(0, n);
  }
  const arms = readArms(opts.arm);
  for (const dir of [skillCfg.dir, ...(skillCfg.siblings ?? [])]) {
    if (!fs.existsSync(path.join(skillsRoot, dir, 'node_modules'))) refuse(`run "npm ci" in ${path.join(skillsRoot, dir)} first`);
  }
  const order = caseOrder(prompts.map((p) => p.id), [...arms.keys()]);
  return { skillCfg, host, budget, maxTotal, timeoutSec, prompts, arms, order, out: path.resolve(opts.out) };
}

// The finished cases of an earlier run: none unless --resume says to continue it. The file is rewritten without a half-written
// last line, so the next case is appended to whole lines only.
function openLedger(out, { resume, dryRun }) {
  const file = path.join(out, 'cases.jsonl');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const ledger = readLedger(text);
  if (ledger.cases.length > 0 && !resume) refuse(`${file} already has cases: pass --resume to continue that run, or use a new --out`);
  const clean = ledger.cases.map((c) => `${JSON.stringify(c)}\n`).join('');
  if (resume && !dryRun && clean !== text) {
    fs.writeFileSync(`${file}.tmp`, clean);
    fs.renameSync(`${file}.tmp`, file);
  }
  return { file, ...ledger };
}

const money = (n) => n.toFixed(2);
const key = (c) => `${c.prompt}\u0000${c.arm}`;

function dryRun(p, ledger, stdout) {
  const todo = p.order.filter((c) => !ledger.cases.some((d) => key(d) === key(c)));
  stdout.write(`${p.order.length} cases (${p.prompts.length} prompts, ${p.arms.size} arms; the arm order rotates by one each prompt), ${todo.length} still to run.\n`);
  stdout.write(`order: ${p.order.map((c) => `${c.prompt} ${c.arm}`).join(', ')}\n`);
  stdout.write(`at most ${p.budget} USD each: ${money(todo.length * p.budget)} USD worst case for the cases still to run; ceiling --max-total ${money(p.maxTotal)} USD, ${money(ledger.spentUsd)} USD already spent.\n`);
  stdout.write('dry run: nothing was started\n');
}

async function runCases(p, ledger, { evalDir, skillsRoot, stdout, stderr }) {
  const done = new Set(ledger.cases.map(key));
  let spent = ledger.spentUsd;
  if (done.size > 0) stdout.write(`resume: skipping ${done.size} finished cases, ${money(spent)} USD already spent\n`);
  for (const { prompt: id, arm } of p.order) {
    if (done.has(key({ prompt: id, arm }))) continue;
    if (!mayStart(spent, p.budget, p.maxTotal)) {
      stderr.write(`ceiling reached: ${money(spent)} USD spent, and one more case capped at ${p.budget} USD could pass --max-total ${p.maxTotal}; stopped before ${id} ${arm}. --resume with a higher --max-total continues.\n`);
      return EXIT_CEILING;
    }
    stdout.write(`▶ ${id} ${arm}\n`);
    const c = await runCase({
      prompt: p.prompts.find((x) => x.id === id), arm, skillSrc: p.arms.get(arm), skillCfg: p.skillCfg, host: p.host, model: p.model,
      budget: p.budget, timeoutSec: p.timeoutSec, caseDir: path.join(p.out, 'cases', id, arm), skillsRoot, evalDir,
    });
    fs.appendFileSync(ledger.file, `${JSON.stringify(c)}\n`);
    spent += c.chargeUsd;
    const reason = failReason(c);
    stdout.write(`  cost ${money(c.chargeUsd)} USD, spent ${money(spent)}/${money(p.maxTotal)}  ${c.seconds.toFixed(0)}s${reason ? `  failed: ${reason}` : ''}\n`);
  }
  return 0;
}

// --- after the run: blind packets, then the verdict from the readers' replies (no host, no budget) -----------------------

function readCases(out) {
  const file = path.join(out, 'cases.jsonl');
  if (!fs.existsSync(file)) refuse(`no cases.jsonl in ${out}`);
  return readLedger(fs.readFileSync(file, 'utf8')).cases;
}

function makePackets(opts, out, { promptsDir, stdout }) {
  if (opts.skill === undefined) refuse('--packets needs --skill (and --set), to find the prompts the cases were run on');
  const skillCfg = SKILLS[opts.skill] ?? refuse(`unknown --skill ${opts.skill}`);
  const cases = readCases(out);
  let prompts;
  try { prompts = loadPrompts(promptsDir, opts.skill, opts.set); } catch (e) { refuse(e.message); }
  if (fs.existsSync(path.join(out, 'key.json'))) refuse(`${path.join(out, 'key.json')} already exists: packets are made once, because the ratings are tied to its names`);
  const key = writePackets({ out, cases, prompts, sheetsDir: path.basename(skillCfg.artifacts[0]) });
  stdout.write(`${Object.keys(key).length} prompts have packets in ${path.join(out, 'blind')}; the key is ${path.join(out, 'key.json')}: keep it from the readers\n`);
  return 0;
}

function makeVerdict(opts, out, { stdout }) {
  if (opts.ratings === undefined) refuse('--verdict needs --ratings <folder of <prompt>.<reader>.json files>');
  const ratingsDir = path.resolve(opts.ratings);
  if (!fs.existsSync(ratingsDir) || !fs.statSync(ratingsDir).isDirectory()) refuse(`--ratings ${ratingsDir} is not a folder`);
  const keyFile = path.join(out, 'key.json');
  if (!fs.existsSync(keyFile)) refuse(`no key.json in ${out}: run --packets first`);
  const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  const planFile = path.join(out, 'plan.json');
  const planned = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, 'utf8')).prompts : [];
  const text = renderVerdict(verdict(readCases(out), readRatings(ratingsDir, key), key, { planned }));
  fs.writeFileSync(path.join(out, 'verdict.md'), text);
  stdout.write(`${text}\nwritten to ${path.join(out, 'verdict.md')}\n`);
  return 0;
}

function afterRun(opts, env) {
  if (opts.packets && opts.verdict) refuse('give only one of --packets and --verdict');
  if (opts.out === undefined) refuse('--out <dir> is required');
  const out = path.resolve(opts.out);
  return opts.packets ? makePackets(opts, out, env) : makeVerdict(opts, out, env);
}

/** -> the exit code: 0 all cases finished (whatever their results), 2 usage, 3 ceiling reached, 1 an error (what finished is kept). */
export async function main(argv, deps = {}) {
  const env = { evalDir: here, skillsRoot: path.resolve(here, '../skills'), promptsDir: path.join(here, 'prompts'), stdout: process.stdout, stderr: process.stderr, ...deps };
  try {
    const opts = parseOptions(argv);
    if (opts.help) { env.stdout.write(USAGE); return 0; }
    if (opts.packets || opts.verdict) return afterRun(opts, env);
    const p = { ...plan(opts, env), model: opts.model };
    const ledger = openLedger(p.out, { resume: opts.resume, dryRun: opts['dry-run'] });
    if (opts['dry-run']) { dryRun(p, ledger, env.stdout); return 0; }
    const check = await run(p.host.check);
    if (check.code !== 0) { env.stderr.write(`host "${opts.host}" not available (${p.host.check.join(' ')} failed)\n`); return EXIT_USAGE; }
    fs.mkdirSync(p.out, { recursive: true });
    // What this run set out to do, so a verdict can tell a prompt that never started (the ceiling stopped the run) from one that was never planned.
    const planned = { skill: opts.skill, set: opts.set ?? null, arms: [...p.arms.keys()], prompts: p.prompts.map((x) => x.id) };
    fs.writeFileSync(path.join(p.out, 'plan.json'), `${JSON.stringify(planned, null, 2)}\n`);
    return await runCases(p, ledger, env);
  } catch (e) {
    if (e instanceof UsageError) { env.stderr.write(`${e.message}\n${USAGE}`); return EXIT_USAGE; }
    env.stderr.write(`the driver stopped on an error: ${e.message}\nthe cases that finished are in the out folder's cases.jsonl\n`);
    return 1;
  }
}

function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));
