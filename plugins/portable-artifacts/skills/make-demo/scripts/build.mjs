#!/usr/bin/env node
// node scripts/build.mjs <demo.json> [--out <path>] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>] [--json]
// Joins demo.json with scout/scout.json offline, refuses a step it cannot resolve, then writes click-plan.json (and, signed out,
// click-plan/<page>.jpg: scout's pictures with numbered boxes) beside demo.json and has make-explainer draw the plan page. What
// make-explainer prints, and its exit code, are passed through; --out, --theme, --model, --effort, --agent and --json go to it.
// Nothing is clicked. exit 0 ok, 1 the spec, the scout or a step is not usable (nothing drawn), 2 usage, no make-explainer, or another
// headless browser is live (the pictures need one).
//
// Imports only built-ins and shared/ up here: ajv and Playwright load after preflight has found node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { printResult } from '../shared/errors.mjs';
import { preflight } from '../shared/preflight.mjs';
import { exitInternal } from './lib/internal-error.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'node scripts/build.mjs <demo.json> [--out <path>] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>] [--json]';
const OPTIONS = { out: { type: 'string' }, theme: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' }, agent: { type: 'string' }, json: { type: 'boolean' } };
const PASSED_ON = ['out', 'theme', 'model', 'effort', 'agent'];

function stop(errors, { json, label }) {
  printResult({ ok: false, errors }, { json, label });
  process.exitCode = 1;
}

/** The parsed scout.json beside demo.json, or an error that says to run scout first. */
function loadScout(dir, file) {
  try {
    const scout = JSON.parse(fs.readFileSync(path.join(dir, 'scout', 'scout.json'), 'utf8'));
    if (scout?.version === 1 && Array.isArray(scout.pages)) return { scout };
  } catch {
    // missing or unreadable: the same answer
  }
  return { errors: [{ path: 'scout', message: `run scout first: node ${path.join(SKILL_ROOT, 'scripts', 'scout.mjs')} ${file}` }] };
}

// Without --out the page is click-plan.html beside demo.json: make-explainer's default folder would give every demo the same file name.
const flagsOf = (values, dir) => {
  const given = { ...values, out: values.out ?? path.join(dir, 'click-plan.html') };
  return [...PASSED_ON.flatMap((name) => (given[name] === undefined ? [] : [`--${name}`, given[name]])), ...(values.json === true ? ['--json'] : [])];
};

async function build(file, values) {
  const { explainerScript, runExplainer } = await import('./lib/explainer.mjs');
  explainerScript('build'); // a missing make-explainer stops here, before a browser starts
  const { loadSpec, validateSpec } = await import('./lib/spec.mjs');
  const json = values.json === true;
  const { spec, dir } = loadSpec(file);
  const checked = validateSpec(spec);
  if (!checked.ok) return stop(checked.errors, { json, label: file });
  const loaded = loadScout(dir, file);
  if (loaded.errors) return stop(loaded.errors, { json, label: file });
  const { planRows } = await import('./lib/plan-rows.mjs');
  const result = planRows(spec, loaded.scout);
  if (result.errors.length > 0) return stop(result.errors, { json, label: file });
  for (const w of result.warnings) process.stderr.write(`${w.path}: warning: ${w.message}\n`);
  const { markShots } = await import('./lib/mark-shots.mjs');
  const { planPage } = await import('./lib/plan-page.mjs');
  const pictures = await markShots(loaded.scout, result.rows, dir);
  const planFile = path.join(dir, 'click-plan.json');
  fs.writeFileSync(planFile, `${JSON.stringify(planPage(spec, loaded.scout, result, pictures), null, 2)}\n`);
  process.exitCode = runExplainer('build', [planFile, ...flagsOf(values, dir)]);
}

const argv = process.argv.slice(2);
let json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  json = values.json === true;
  if (positionals.length !== 1) throw new UsageError(`expected one demo file; usage: ${USAGE}`);
  if (preflight(SKILL_ROOT, { argv })) await build(positionals[0], values);
} catch (e) {
  if (e instanceof UsageError || e?.name === 'SiblingError') exitUsage(e, { json });
  else exitInternal(e, { json });
}
