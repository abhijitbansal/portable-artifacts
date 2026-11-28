#!/usr/bin/env node
// node scripts/film.mjs <demo.json> --take take-<n> [--out <file>] [--json]
// Writes the draft film, by fixed rules and with no model, from demo.json, scout/scout.json and one take: <demo>/film.json by default. It
// refuses a take of another plan (the plan's hash is recomputed from demo.json and scout.json), never overwrites a file (the agent may
// have edited it) and never writes outside the demo folder. It prints the path, the shots, every note and the make-motion command to run.
// exit 0 written, 1 refused (spec, scout, take or plan errors, an --out that is taken or outside the folder), 2 usage or a missing make-motion
//
// Imports only built-ins and shared/ up here: ajv loads after preflight has found node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { escapeJsonInvisible } from '../shared/agent-text.mjs';
import { quoteArg } from '../shared/doctor.mjs';
import { preflight } from '../shared/preflight.mjs';
import { exitInternal } from './lib/internal-error.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'node scripts/film.mjs <demo.json> --take take-<n> [--out <file>] [--json]';
const OPTIONS = { take: { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean' } };
const SIGNED_IN_NOTICE = "this film plays a signed-in take: its sheets and MP4 are the user's to look at; do not open them or send them to an agent.";
const say = (line) => process.stdout.write(`${line}\n`);

function report({ file, film, notes, take, makeScript }) {
  const walks = film.shots.filter((s) => s.show === 'walk').map((s) => ({ id: s.id, steps: s.steps.length }));
  const next = `node ${quoteArg(makeScript)} ${quoteArg(file)} --json`;
  return { file, shots: film.shots.length, walks, notes, next, notice: take.signedIn ? SIGNED_IN_NOTICE : null };
}

function printReport(body, json) {
  if (json) return say(escapeJsonInvisible(JSON.stringify({ ok: true, ...body })));
  say(`wrote ${body.file}`);
  say(`shots: ${body.shots}`);
  for (const w of body.walks) say(`walk ${w.id}: ${w.steps} steps`);
  for (const note of body.notes) say(`note: ${note}`);
  say(`next: ${body.next}`);
  if (body.notice) say(`notice: ${body.notice}`);
  return undefined;
}

async function film(file, values) {
  const json = values.json === true;
  const { siblingScript } = await import('./lib/siblings.mjs');
  const makeScript = siblingScript('make-motion', 'scripts/make.mjs'); // a missing make-motion is usage, before anything is read
  const { loadDemo, stop } = await import('./lib/demo-load.mjs');
  const demo = await loadDemo(file, { json, skillRoot: SKILL_ROOT });
  if (demo === null) return undefined;
  const { spec, dir, scout, rows } = demo;
  const { Refused, outPath } = await import('./lib/demo-out.mjs');
  try {
    const { readDemoTake } = await import('./lib/take-read.mjs');
    const { draftFilm } = await import('./lib/film-draft.mjs');
    const take = readDemoTake(dir, values.take);
    const drafted = draftFilm({ spec, rows, scout, take });
    const target = outPath(dir, values.out, path.join(dir, 'film.json'));
    fs.writeFileSync(target, `${escapeJsonInvisible(JSON.stringify(drafted.film, null, 2))}\n`, { flag: 'wx' });
    printReport(report({ file: target, film: drafted.film, notes: drafted.notes, take, makeScript }), json);
  } catch (error) {
    if (error instanceof Refused) return stop(error.errors, { json, demo: file, skillRoot: SKILL_ROOT });
    throw error;
  }
  return undefined;
}

const argv = process.argv.slice(2);
let json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  json = values.json === true;
  if (positionals.length !== 1) throw new UsageError(`expected one demo file; usage: ${USAGE}`);
  if (values.take === undefined) throw new UsageError(`--take take-<n> is required: the take folder beside demo.json; usage: ${USAGE}`);
  if (preflight(SKILL_ROOT, { argv })) await film(positionals[0], values);
} catch (e) {
  if (e instanceof UsageError || e?.name === 'SiblingError') exitUsage(e, { json });
  else exitInternal(e, { json });
}
