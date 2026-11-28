// What film.mjs and guide.mjs both do first: read demo.json and scout/scout.json, validate the spec, plan the rows. Loaded after preflight
// (it pulls in ajv through spec.mjs), so a command imports this file dynamically. A problem is printed here and the command's exit code is 1.
import fs from 'node:fs';
import path from 'node:path';
import { printResult } from '../../shared/errors.mjs';
import { quoteArg } from '../../shared/doctor.mjs';

/** Print `errors` (with the command to plan again when the take is of another plan) and set the exit code to 1. */
export function stop(errors, { json, demo, skillRoot }) {
  const again = errors.some((e) => e.path === 'take.planKey' || e.path.startsWith('take.steps'));
  const hint = again ? [{ path: 'take', message: `to plan again: node ${quoteArg(path.join(skillRoot, 'scripts', 'build.mjs'))} ${quoteArg(demo)}` }] : [];
  printResult({ ok: false, errors: [...errors, ...hint] }, { json, label: demo });
  process.exitCode = 1;
}

function readScout(dir) {
  try {
    const scout = JSON.parse(fs.readFileSync(path.join(dir, 'scout', 'scout.json'), 'utf8'));
    return scout?.version === 1 && Array.isArray(scout.pages) ? scout : null;
  } catch {
    return null;
  }
}

/** { spec, dir, scout, rows } of the demo file, or null after `stop` has printed why (a bad spec, no scout.json, rows the plan refuses). */
export async function loadDemo(file, { json, skillRoot }) {
  const { loadSpec, validateSpec } = await import('./spec.mjs');
  const { spec, dir } = loadSpec(file);
  const checked = validateSpec(spec);
  if (!checked.ok) return stop(checked.errors, { json, demo: file, skillRoot }) ?? null;
  const scout = readScout(dir);
  if (scout === null) return stop([{ path: 'scout', message: `run scout first: node ${quoteArg(path.join(skillRoot, 'scripts', 'scout.mjs'))} ${quoteArg(file)}` }], { json, demo: file, skillRoot }) ?? null;
  const { planRows } = await import('./plan-rows.mjs');
  const planned = planRows(spec, scout);
  if (planned.errors.length > 0) return stop(planned.errors, { json, demo: file, skillRoot }) ?? null;
  return { spec, dir, scout, rows: planned.rows };
}
