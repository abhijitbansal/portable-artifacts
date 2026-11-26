#!/usr/bin/env node
// node scripts/take.mjs <demo.json> --answers <file> [--again] [--json]
// Runs the rows of the approved click plan once, frame by frame, and writes take-<n>/ beside demo.json: take.json, frames/, downloads/
// and contact.jpg (the settled frame of each step). Then it prints the report: what ran, where it stopped and why, what the site did.
// It runs only a plan the owner approved: the answers go through make-explainer's answers.mjs, the plan is recomputed from demo.json and
// scout.json, and the verdict and every danger row's own approval must be `approve` (take-gate.mjs). Nothing is clicked before that.
// --again lets a second take of the same plan run after a first that ran a row that changes something: ask the user first. --json prints
// one line { ok, stopped, dir, report } instead of the report. A take that stops early still writes take.json, the sheet and the report.
// exit 0 every row ran, 1 the take stopped early or was refused (the plan is stale, not approved, scout says the page cannot be filmed
// frame by frame, the take folder would be tracked by git), 2 usage, no saved session, or another headless browser is live
//
// Imports only built-ins and shared/ up here: ajv and Playwright load after preflight has found node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { printResult } from '../shared/errors.mjs';
import { agentText, escapeJsonInvisible } from '../shared/agent-text.mjs';
import { preflight } from '../shared/preflight.mjs';
import { exitInternal } from './lib/internal-error.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'node scripts/take.mjs <demo.json> --answers <file> [--again] [--json]';
const OPTIONS = { answers: { type: 'string' }, again: { type: 'boolean' }, json: { type: 'boolean' } };
const REASON_MAX = 200;
const say = (line) => process.stdout.write(`${line}\n`);

function stop(errors, { json, label }) {
  printResult({ ok: false, errors }, { json, label });
  process.exitCode = 1;
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null; // missing or unreadable: the same answer
  }
};

/** scout.json and click-plan.json beside demo.json, or the errors that say which command to run. */
function loadInputs(dir, file) {
  const scout = readJson(path.join(dir, 'scout', 'scout.json'));
  if (scout?.version !== 1 || !Array.isArray(scout.pages)) return { errors: [{ path: 'scout', message: `run scout first: node ${path.join(SKILL_ROOT, 'scripts', 'scout.mjs')} ${file}` }] };
  const clickPlanFile = path.join(dir, 'click-plan.json');
  const clickPlan = readJson(clickPlanFile);
  if (clickPlan === null || typeof clickPlan !== 'object') return { errors: [{ path: 'clickPlan', message: `run build first: node ${path.join(SKILL_ROOT, 'scripts', 'build.mjs')} ${file}` }] };
  return { scout, clickPlan, clickPlanFile };
}

/** The refusal when scout did not find the page steady under the stepped clock (real time is not built yet), else null. */
function steppedRefusal(scout) {
  if (scout.stepped?.ok === true) return null;
  if (scout.stepped === undefined || scout.stepped === null) return { path: 'scout.stepped', message: 'scout.json has no frame by frame check; run scout again' };
  const why = agentText(scout.stepped.reason ?? 'no reason given', { max: REASON_MAX });
  return { path: 'scout.stepped', message: `this page cannot be filmed frame by frame; real-time capture is not built yet (scout said: ${why})` };
}

/** make-explainer's answers.mjs on the answers file: its parsed --json result. A file it cannot read is usage (exit 2), not a refusal. */
async function readAnswers(clickPlanFile, answersFile) {
  const { runExplainerJson } = await import('./lib/explainer.mjs');
  const { status, result } = runExplainerJson('answers', [clickPlanFile, answersFile, '--json']);
  if (status === 2) throw new UsageError(`answers.mjs could not read the answers: ${agentText(result.errors?.[0]?.message ?? 'no reason given', { max: REASON_MAX })}`);
  return result;
}

/** Everything that can still refuse once the folder exists; an empty folder made for a take that never started is removed again. */
async function prepare(spec, folder) {
  try {
    const { liveBrowsers } = await import('./lib/browser.mjs');
    if (liveBrowsers().length > 0) throw new UsageError('another headless browser is running (pgrep -fl chrome-headless-shell); wait for it to end, then run take again');
    if (spec.session === undefined) return null;
    const { originsOf } = await import('./lib/spec.mjs');
    const { readSession } = await import('./lib/session-store.mjs');
    return readSession(spec.session, originsOf(spec));
  } catch (error) {
    fs.rmdirSync(folder.dir);
    throw error;
  }
}

/** Run the take in one browser, write take.json and the sheet, close the browser. */
async function film({ spec, scout, gated, state, folder }) {
  const { launchBrowser } = await import('./lib/browser.mjs');
  const { runTake } = await import('./lib/take-run.mjs');
  const { contactSheet } = await import('./lib/contact-sheet.mjs');
  const browser = await launchBrowser();
  try {
    const taken = await runTake({ browser, spec, scout, rows: gated.rows, hash: gated.hash, state, dir: folder.dir, again: folder.again });
    fs.writeFileSync(path.join(folder.dir, 'take.json'), `${JSON.stringify(taken, null, 2)}\n`);
    await contactSheet(browser, taken, folder.dir);
    return taken;
  } finally {
    await browser.close().catch(() => {});
  }
}

async function take(file, values) {
  const json = values.json === true;
  const { explainerScript } = await import('./lib/explainer.mjs');
  explainerScript('answers'); // a missing make-explainer stops here, before a browser starts
  const { loadSpec, validateSpec } = await import('./lib/spec.mjs');
  const { spec, dir } = loadSpec(file);
  const checked = validateSpec(spec);
  if (!checked.ok) return stop(checked.errors, { json, label: file });
  const inputs = loadInputs(dir, file);
  if (inputs.errors) return stop(inputs.errors, { json, label: file });
  const refusal = steppedRefusal(inputs.scout);
  if (refusal) return stop([refusal], { json, label: file });
  const answers = await readAnswers(inputs.clickPlanFile, values.answers);
  const { gate } = await import('./lib/take-gate.mjs');
  const gated = gate({ spec, scout: inputs.scout, clickPlan: inputs.clickPlan, answers });
  if (!gated.ok) return stop(gated.errors, { json, label: file });
  const { takeDir, TakeFolderRefused } = await import('./lib/take-folder.mjs');
  let folder;
  try {
    folder = takeDir(dir, { planKey: `demo-${gated.hash}`, again: values.again === true });
  } catch (error) {
    if (error instanceof TakeFolderRefused) return stop([{ path: 'take', message: error.message }], { json, label: file });
    throw error;
  }
  const state = await prepare(spec, folder);
  const taken = await film({ spec, scout: inputs.scout, gated, state, folder });
  const { takeReport } = await import('./lib/take-report.mjs');
  const report = takeReport(taken, { dir: folder.dir, total: gated.rows.length });
  if (json) say(escapeJsonInvisible(JSON.stringify({ ok: taken.stopped === null, stopped: taken.stopped, dir: folder.dir, report })));
  else say(report);
  process.exitCode = taken.stopped === null ? 0 : 1;
}

const argv = process.argv.slice(2);
let json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  json = values.json === true;
  if (positionals.length !== 1) throw new UsageError(`expected one demo file; usage: ${USAGE}`);
  if (values.answers === undefined) throw new UsageError(`--answers <file> is required: the answers file of the approved plan page; usage: ${USAGE}`);
  if (preflight(SKILL_ROOT, { argv })) await take(positionals[0], values);
} catch (e) {
  if (e instanceof UsageError || e?.name === 'SiblingError') exitUsage(e, { json });
  else exitInternal(e, { json });
}
