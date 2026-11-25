#!/usr/bin/env node
// node scripts/scout.mjs <demo.json> [--json]
// Opens the demo site read-only and writes scout/scout.json (and, signed out, one picture per page) beside demo.json. It never
// clicks, types or submits, and follows only links it classes as `look`. It prints the digest of each page, then the path of
// scout.json. With a `session` in demo.json nothing a page holds is printed or kept: names are masked, there is no picture.
// --json prints one line { ok, out, pages, errors } and no digest.
// exit 0 ok, 1 the spec or the start page is not usable (nothing written), 2 usage, no saved session, or another headless browser is live
//
// Imports only built-ins and shared/ up here: Playwright and ajv load after preflight has found node_modules.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { printResult } from '../shared/errors.mjs';
import { preflight } from '../shared/preflight.mjs';
import { scratchIgnoreNote } from '../shared/output.mjs';
import { exitInternal } from './lib/internal-error.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'node scripts/scout.mjs <demo.json> [--json]';
const OPTIONS = { json: { type: 'boolean' } };
const say = (line) => process.stdout.write(`${line}\n`);

/** One line on stderr (or the JSON line on stdout) and exit 1: the scout could not be made. */
function stop(message, json) {
  if (json) say(JSON.stringify({ ok: false, errors: [{ path: '', message }] }));
  else process.stderr.write(`scout: ${String(message).split('\n')[0]}\n`);
  process.exitCode = 1;
}

/** The spec of the file, or null after printing its errors (exit 1). */
async function readSpec(file, json) {
  const { loadSpec, validateSpec } = await import('./lib/spec.mjs');
  const { spec } = loadSpec(file);
  const result = validateSpec(spec);
  if (result.ok) return spec;
  printResult(result, { json, label: file });
  process.exitCode = 1;
  return null;
}

function report({ scout, out, file, json }) {
  const problems = scout.pages.map((page, i) => ({ page, i })).filter(({ page }) => page.controls.length === 0 && page.wall !== null);
  if (json) {
    say(JSON.stringify({ ok: true, out, pages: scout.pages.length, errors: problems.map(({ page, i }) => ({ path: `pages[${i}]`, message: `${page.id}: ${page.wall}` })) }));
    return;
  }
  return import('./lib/digest-print.mjs').then(({ printDigest }) => {
    say(scout.pages.map(printDigest).join('\n\n'));
    say(out);
    const note = scratchIgnoreNote(file);
    if (note) say(note);
  });
}

async function scout(file, json) {
  const spec = await readSpec(file, json);
  if (spec === null) return;
  const { liveBrowsers, launchBrowser } = await import('./lib/browser.mjs');
  const live = liveBrowsers();
  if (live.length > 0) throw new UsageError('another headless browser is running (pgrep -fl chrome-headless-shell); wait for it to end, then run scout again');
  const { originsOf } = await import('./lib/spec.mjs');
  const { readSession } = await import('./lib/session-store.mjs');
  const state = spec.session === undefined ? null : readSession(spec.session, originsOf(spec));
  const { runScout, writeScout } = await import('./lib/scout-run.mjs');
  const browser = await launchBrowser();
  let result;
  try {
    result = await runScout({ browser, spec, state });
  } finally {
    await browser.close().catch(() => {});
  }
  if (!result.ok) return stop(result.reason, json);
  const out = writeScout(path.dirname(path.resolve(file)), result.scout, result.shots);
  await report({ scout: result.scout, out, file: path.resolve(file), json });
}

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  if (positionals.length !== 1) throw new UsageError(`expected one demo file; usage: ${USAGE}`);
  if (preflight(SKILL_ROOT, { argv })) await scout(positionals[0], values.json === true);
} catch (e) {
  if (e instanceof UsageError) exitUsage(e, { json });
  else exitInternal(e, { json });
}
