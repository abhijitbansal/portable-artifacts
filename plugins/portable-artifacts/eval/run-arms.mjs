#!/usr/bin/env node
// The arms driver: one prompt set run through several copies of a skill ("arms"), one session at a time, under one spend
// ceiling. It owns the whole test because run-eval.mjs runs one set and one skill folder per process, so a cap and an
// interleaving across arms cannot live there. Each finished case is appended to <out>/cases.jsonl at once; --resume skips the
// finished ones and counts their spend. BILLED: one host session per case, each capped by --budget, and no case starts that
// could take the spend past --max-total (each is reserved its budget plus 10%, because the host's cap can be overshot). Scoring
// uses the repository's own skill, not the arm's copy. See eval/README.md.
//
// Crash safety: a case is written to <out>/inflight.jsonl (charged its whole budget) before its host starts, and its cost is
// written the moment the host exits. A resume charges a case that never finished, records it `interrupted` and does not run it
// again unless --retry names it. SIGINT and SIGTERM kill the host's process group and exit 130; <out>/driver.lock refuses a
// second live driver.
//
//   node eval/run-arms.mjs --skill motion --set budget --host claude-stream --model sonnet --arm A=<folder> --arm D=<folder> \
//     --budget 1.00 --max-total 20 --timeout 1800 --out <dir> [--resume [--retry <prompt>:<arm>] [--raise-ceiling]] [--limit n] [--dry-run]
//   node eval/run-arms.mjs --packets --skill motion --set budget --out <dir>   blind packets (<out>/blind) and the key (<out>/private)
//   node eval/run-arms.mjs --verdict --out <dir> --ratings <dir>               the pass rule over the cases and the readers' replies
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SKILLS, loadPrompts, run } from './lib.mjs';
import { OVERSHOOT_RESERVE, caseOrder, failReason, mayStart, readLedger, renderVerdict, reserveOf, verdict } from './arms-lib.mjs';
import { appendDurable, caseDirOf, makeJournal, readInflight, recoverOpen, takeLock } from './arms-journal.mjs';
import { planChanges, planRecord } from './arms-plan.mjs';
import { readRatings, writePackets } from './arms-packets.mjs';
import { runCase } from './arms-case.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_SEC = 1800;
const EXIT_USAGE = 2;
const EXIT_CEILING = 3;
const EXIT_HOST_FAULT = 4;
const EXIT_INTERRUPTED = 130;
const ARM_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const USAGE = `usage: node eval/run-arms.mjs --skill motion --set <name> --host claude-stream --model m --arm name=<folder> [--arm ...] --budget <usd> --max-total <usd> --out <dir> [--timeout sec] [--resume [--retry <prompt>:<arm>] [--raise-ceiling]] [--limit n] [--dry-run] [--help]
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
        resume: { type: 'boolean', default: false }, retry: { type: 'string', multiple: true, default: [] }, 'raise-ceiling': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
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
  // Without --model the host runs the account default, which may be the dearest model: the ceiling would go on it.
  if (opts.model === undefined && host.modelArgs) refuse(`--model is required for host "${opts.host}": without it the session runs the account's default model`);
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
  if (maxTotal < reserveOf(budget)) refuse(`--max-total ${maxTotal} is below --budget ${budget} plus its ${OVERSHOOT_RESERVE * 100}% reserve (${reserveOf(budget)}): not even one case could start`);
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
  return { skillCfg, host, budget, maxTotal, timeoutSec, prompts, arms, order, model: opts.model, out: path.resolve(opts.out) };
}

const money = (n) => n.toFixed(2);
const key = (c) => `${c.prompt}\u0000${c.arm}`;
const label = (c) => `${c.prompt} ${c.arm}`;
const sumCharge = (cases) => cases.reduce((sum, c) => sum + c.chargeUsd, 0);
const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');

// --- the retry list and the earlier run's files ------------------------------------------------------------------------------------

// `--retry <prompt>:<arm>`: cases of this plan to run again. -> the set of case keys.
function parseRetries(specs, { resume, order }) {
  if (specs.length === 0) return new Set();
  if (!resume) refuse('--retry needs --resume: it runs a case of an earlier run again');
  return new Set(specs.map((spec) => {
    const at = spec.lastIndexOf(':');
    if (at < 1 || at === spec.length - 1) refuse(`--retry needs <prompt>:<arm>, got "${spec}"`);
    const c = { prompt: spec.slice(0, at), arm: spec.slice(at + 1) };
    if (!order.some((x) => key(x) === key(c))) refuse(`--retry ${spec}: ${spec} is not a case of this plan`);
    return key(c);
  }));
}

// Only a case that never gave a result may be run again: one interrupted, one the host faulted on, one whose scoring threw. A
// finished result (a success, a timeout, a budget cap, a failed check) is the experiment's data; running it again would re-roll it.
function checkRetries(retry, records) {
  const latest = new Map(records.map((c) => [key(c), c]));
  for (const k of retry) {
    const spec = k.replace('\u0000', ':');
    const c = latest.get(k);
    if (!c) refuse(`--retry ${spec}: ${spec} has no earlier record, so there is nothing to run again`);
    if (!(c.interrupted || c.hostFault || c.scoringError)) refuse(`--retry ${spec}: ${spec} is not interrupted, a host fault or a scoring failure: re-running a finished result would re-roll it`);
  }
}

// What an earlier run left, read and not changed: the finished cases, the in-flight journal, and the text of both files.
function inspectLedger(out, { resume }) {
  const file = path.join(out, 'cases.jsonl');
  const inflightFile = path.join(out, 'inflight.jsonl');
  const text = readText(file);
  const inflightText = readText(inflightFile);
  const view = { file, inflightFile, text, inflightText, ...readLedger(text), inflight: readInflight(inflightText) };
  if (!resume && text.trim() !== '') refuse(`${file} already has cases or a half-written line: pass --resume to continue that run, or use a new --out`);
  if (!resume && inflightText.trim() !== '') refuse(`${inflightFile} already has records of a case that started: pass --resume to continue that run, or use a new --out`);
  return view;
}

function guardResume(out, next, opts) {
  const file = path.join(out, 'plan.json');
  if (!opts.resume || !fs.existsSync(file)) return;
  let prev;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return refuse(`${file} is not JSON`); }
  const changes = planChanges(prev, next, { raiseCeiling: opts['raise-ceiling'] });
  if (changes.length) refuse(`--resume refused: this is not the run that began in ${out}.\n${changes.map((c) => `  - ${c}`).join('\n')}`);
}

// A file rewritten as whole lines only (a half-written last line dropped), through a temporary file and a rename.
function rewrite(file, text, records) {
  const clean = records.map((r) => `${JSON.stringify(r)}\n`).join('');
  if (clean === text) return;
  fs.writeFileSync(`${file}.tmp`, clean);
  fs.renameSync(`${file}.tmp`, file);
}

// Make the files whole, then record every attempt an earlier driver left open as an interrupted case (charged, not rerun).
function settle(view, recovered, stdout) {
  rewrite(view.file, view.text, view.cases);
  rewrite(view.inflightFile, view.inflightText, view.inflight);
  for (const r of recovered) {
    appendDurable(view.file, r);
    stdout.write(`resume: ${label(r)} started and never finished: recorded interrupted, charged ${money(r.chargeUsd)} USD${r.usage?.costUsd === null && !r.hostFault ? ' (no cost in its transcript: the whole budget)' : ''}\n`);
  }
  const cases = [...view.cases, ...recovered];
  return { file: view.file, inflightFile: view.inflightFile, cases, spentUsd: sumCharge(cases) };
}

function dryRun(p, view, retry, stdout) {
  const recovered = recoverOpen({ out: p.out, inflight: view.inflight, cases: view.cases });
  const finished = new Set([...view.cases, ...recovered].map(key));
  for (const k of retry) finished.delete(k);
  const todo = p.order.filter((c) => !finished.has(key(c)));
  const inflightUsd = sumCharge(recovered);
  const reserve = reserveOf(p.budget);
  stdout.write(`${p.order.length} cases (${p.prompts.length} prompts, ${p.arms.size} arms; the arm order rotates by one each prompt), ${todo.length} still to run.\n`);
  stdout.write(`order: ${p.order.map(label).join(', ')}\n`);
  if (recovered.length) stdout.write(`${recovered.length} case${recovered.length === 1 ? '' : 's'} in flight when an earlier run stopped, ${money(inflightUsd)} USD charged: --resume records ${recovered.length === 1 ? 'it' : 'them'} as interrupted and does not run ${recovered.length === 1 ? 'it' : 'them'} again unless --retry names it.\n`);
  stdout.write(`at most ${p.budget} USD each, plus a ${OVERSHOOT_RESERVE * 100}% reserve because the host's cap can be overshot (${money(reserve)} USD reserved per case): ${money(todo.length * reserve)} USD worst case for the cases still to run; ceiling --max-total ${money(p.maxTotal)} USD, ${money(view.spentUsd + inflightUsd)} USD already spent.\n`);
  stdout.write('dry run: nothing was started\n');
}

// --- the billed run -------------------------------------------------------------------------------------------------------------------

function ceilingStop(p, spent, c, stderr) {
  stderr.write(`ceiling reached: ${money(spent)} USD spent, and one more case reserved at ${money(reserveOf(p.budget))} USD (--budget ${p.budget} plus ${OVERSHOOT_RESERVE * 100}% for an overshoot) could pass --max-total ${p.maxTotal}; stopped before ${label(c)}. --resume with a higher --max-total and --raise-ceiling continues.\n`);
  return EXIT_CEILING;
}

async function runCases(p, ledger, retry, { evalDir, skillsRoot, stdout, stderr }, signal) {
  const done = new Set(ledger.cases.map(key));
  for (const k of retry) done.delete(k);
  let spent = ledger.spentUsd;
  if (ledger.cases.length > 0) stdout.write(`resume: skipping ${[...done].length} finished cases, ${money(spent)} USD already spent\n`);
  for (const { prompt: id, arm } of p.order) {
    if (done.has(key({ prompt: id, arm }))) continue;
    if (signal.aborted) return EXIT_INTERRUPTED;
    if (!mayStart(spent, p.budget, p.maxTotal)) return ceilingStop(p, spent, { prompt: id, arm }, stderr);
    stdout.write(`▶ ${id} ${arm}\n`);
    const c = await runCase({
      prompt: p.prompts.find((x) => x.id === id), arm, skillSrc: p.arms.get(arm), skillCfg: p.skillCfg, host: p.host, model: p.model,
      budget: p.budget, timeoutSec: p.timeoutSec, caseDir: caseDirOf(p.out, id, arm), skillsRoot, evalDir, signal,
      journal: makeJournal(ledger.inflightFile, { prompt: id, arm, budget: p.budget }),
    });
    appendDurable(ledger.file, c);
    spent += c.chargeUsd;
    done.add(key(c));
    const reason = failReason(c);
    stdout.write(`  cost ${money(c.chargeUsd)} USD, spent ${money(spent)}/${money(p.maxTotal)}  ${c.seconds.toFixed(0)}s${reason ? `  failed: ${reason}` : ''}\n`);
    if (c.workdirLeft) stdout.write(`  note: workdir left behind (it could not be removed): ${c.workdirLeft}\n`);
    if (c.interrupted) { stderr.write(`interrupted: ${label(c)} was stopped and recorded, charged ${money(c.chargeUsd)} USD; --resume --retry ${id}:${arm} runs it again\n`); return EXIT_INTERRUPTED; }
    if (c.hostFault) return hostFaultStop(c, stderr);
  }
  return 0;
}

function hostFaultStop(c, stderr) {
  stderr.write(`host fault in ${label(c)}: ${c.hostFault}. Charged ${money(c.chargeUsd)} USD. Stopped, because the next case would likely fail the same way (a usage or sign-in limit). Fix the host, then --resume --retry ${c.prompt}:${c.arm}.\n`);
  return EXIT_HOST_FAULT;
}

// The run itself, under the lock: the earlier run's files are checked, settled, and the plan written before the first host starts.
async function runLocked(p, opts, retry, env) {
  const next = planRecord(p, opts);
  const view = inspectLedger(p.out, { resume: opts.resume });
  guardResume(p.out, next, opts);
  const recovered = recoverOpen({ out: p.out, inflight: view.inflight, cases: view.cases });
  checkRetries(retry, [...view.cases, ...recovered]);
  const ledger = settle(view, recovered, env.stdout);
  // What this run set out to do, so a verdict can tell a prompt that never started (the ceiling stopped the run) from one that was never planned.
  fs.writeFileSync(path.join(p.out, 'plan.json'), `${JSON.stringify(next, null, 2)}\n`);
  const faulted = recovered.find((r) => r.hostFault);
  if (faulted) return hostFaultStop(faulted, env.stderr);
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    return await runCases(p, ledger, retry, env, abort.signal);
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

function lockOut(out) {
  try {
    return takeLock(path.join(out, 'driver.lock'));
  } catch (e) {
    if (e.holder !== undefined) return refuse(e.message);
    throw e;
  }
}

// --- after the run: blind packets, then the verdict from the readers' replies (no host, no budget) -----------------------

function readCases(out) {
  const file = path.join(out, 'cases.jsonl');
  if (!fs.existsSync(file)) refuse(`no cases.jsonl in ${out}`);
  return readLedger(fs.readFileSync(file, 'utf8')).cases;
}

// The key is kept in <out>/private, apart from blind/ (what the raters are given) and from cases/ (which names every arm).
const keyFileOf = (out) => path.join(out, 'private', 'key.json');

function makePackets(opts, out, { promptsDir, stdout }) {
  if (opts.skill === undefined) refuse('--packets needs --skill (and --set), to find the prompts the cases were run on');
  const skillCfg = SKILLS[opts.skill] ?? refuse(`unknown --skill ${opts.skill}`);
  const cases = readCases(out);
  let prompts;
  try { prompts = loadPrompts(promptsDir, opts.skill, opts.set); } catch (e) { refuse(e.message); }
  if (fs.existsSync(keyFileOf(out))) refuse(`${keyFileOf(out)} already exists: packets are made once, because the ratings are tied to its names`);
  const written = writePackets({ out, cases, prompts, sheetsDir: path.basename(skillCfg.artifacts[0]) });
  stdout.write(`${Object.keys(written).length} prompts have packets in ${path.join(out, 'blind')}; the key is ${keyFileOf(out)}: keep it from the readers.\n`);
  stdout.write(`Give each rater only the paths ${path.join(out, 'blind', '<prompt>')}, never ${out} itself: its cases/ folder names every arm.\n`);
  return 0;
}

function makeVerdict(opts, out, { stdout }) {
  if (opts.ratings === undefined) refuse('--verdict needs --ratings <folder of <prompt>.<reader>.json files>');
  const ratingsDir = path.resolve(opts.ratings);
  if (!fs.existsSync(ratingsDir) || !fs.statSync(ratingsDir).isDirectory()) refuse(`--ratings ${ratingsDir} is not a folder`);
  if (!fs.existsSync(keyFileOf(out))) refuse(`no key.json in ${path.join(out, 'private')}: run --packets first`);
  const keyTable = JSON.parse(fs.readFileSync(keyFileOf(out), 'utf8'));
  const planFile = path.join(out, 'plan.json');
  const planned = fs.existsSync(planFile) ? JSON.parse(fs.readFileSync(planFile, 'utf8')).prompts : [];
  const text = renderVerdict(verdict(readCases(out), readRatings(ratingsDir, keyTable), keyTable, { planned }));
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

/** -> the exit code: 0 all cases finished (whatever their results), 2 usage, 3 ceiling reached, 4 host fault, 130 interrupted, 1 an error (what finished is kept). */
export async function main(argv, deps = {}) {
  const env = { evalDir: here, skillsRoot: path.resolve(here, '../skills'), promptsDir: path.join(here, 'prompts'), stdout: process.stdout, stderr: process.stderr, ...deps };
  try {
    const opts = parseOptions(argv);
    if (opts.help) { env.stdout.write(USAGE); return 0; }
    if (opts.packets || opts.verdict) return afterRun(opts, env);
    const p = plan(opts, env);
    const retry = parseRetries(opts.retry, { resume: opts.resume, order: p.order });
    if (opts['dry-run']) { dryRun(p, inspectLedger(p.out, { resume: opts.resume }), retry, env.stdout); return 0; }
    const check = await run(p.host.check);
    if (check.code !== 0) { env.stderr.write(`host "${opts.host}" not available (${p.host.check.join(' ')} failed)\n`); return EXIT_USAGE; }
    fs.mkdirSync(p.out, { recursive: true });
    const release = lockOut(p.out);
    try {
      return await runLocked(p, opts, retry, env);
    } finally {
      release();
    }
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
