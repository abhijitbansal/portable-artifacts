#!/usr/bin/env node
// node scripts/guide.mjs <demo.json> --take take-<n> --video <file.mp4> [--out <file>] [--json]
// Writes the guide spec, by fixed rules and with no model, from demo.json, scout/scout.json, one take and the rendered MP4: <demo>/guide.json
// by default, a make-explainer spec. It refuses a take of another plan (the same check film.mjs makes), never overwrites a file (the agent may
// have edited it) and never writes outside the demo folder. It prints the path, the notes and the make-explainer command that builds the page.
// exit 0 written, 1 refused (spec, scout, take, plan or video errors, an --out that is taken or outside the folder), 2 usage or a missing make-explainer
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
const USAGE = 'node scripts/guide.mjs <demo.json> --take take-<n> --video <file.mp4> [--out <file>] [--json]';
const OPTIONS = { take: { type: 'string' }, video: { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean' } };
const SIGNED_IN_NOTICE = "this guide shows a signed-in take's frames: it is the user's to open; do not open it or its check pictures";
const say = (line) => process.stdout.write(`${line}\n`);

function report({ file, guide, notes, take, buildScript }) {
  const page = path.join(path.dirname(file), 'guide.html');
  const next = `node ${quoteArg(buildScript)} ${quoteArg(file)} --out ${quoteArg(page)}`;
  return { file, sections: guide.sections.length, notes, next, notice: take.signedIn ? SIGNED_IN_NOTICE : null };
}

function printReport(body, json) {
  if (json) return say(escapeJsonInvisible(JSON.stringify({ ok: true, ...body })));
  say(`wrote ${body.file}`);
  say(`sections: ${body.sections}`);
  for (const note of body.notes) say(`note: ${note}`);
  say(`next: ${body.next}`);
  if (body.notice) say(`notice: ${body.notice}`);
  return undefined;
}

// The guide's paths (the film, the frames) are relative to the folder that holds it, so it has to sit beside demo.json and the take folders.
function besideDemo(Refused, dir, target) {
  if (fs.realpathSync(path.dirname(target)) !== fs.realpathSync(dir)) throw new Refused({ path: 'out', message: `${target} is not directly in the demo folder ${dir}; the guide's paths are relative to its own folder, so pass --out with a name there` });
}

async function guide(file, values) {
  const json = values.json === true;
  const { siblingScript } = await import('./lib/siblings.mjs');
  const buildScript = siblingScript('make-explainer', 'scripts/build.mjs'); // a missing make-explainer is usage, before anything is read
  const { loadDemo, stop } = await import('./lib/demo-load.mjs');
  const demo = await loadDemo(file, { json, skillRoot: SKILL_ROOT });
  if (demo === null) return undefined;
  const { spec, dir, rows } = demo;
  const { Refused, outPath } = await import('./lib/demo-out.mjs');
  try {
    const { readDemoTake } = await import('./lib/take-read.mjs');
    const { draftGuide } = await import('./lib/guide-draft.mjs');
    const { videoRef } = await import('./lib/guide-video.mjs');
    const take = readDemoTake(dir, values.take);
    const drafted = draftGuide({ spec, rows, take, video: videoRef(dir, values.video) });
    const target = outPath(dir, values.out, path.join(dir, 'guide.json'));
    besideDemo(Refused, dir, target);
    fs.writeFileSync(target, `${escapeJsonInvisible(JSON.stringify(drafted.guide, null, 2))}\n`, { flag: 'wx' });
    printReport(report({ file: target, guide: drafted.guide, notes: drafted.notes, take, buildScript }), json);
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
  if (values.video === undefined) throw new UsageError(`--video <file.mp4> is required: the film made from this take, inside the demo folder; usage: ${USAGE}`);
  if (preflight(SKILL_ROOT, { argv })) await guide(positionals[0], values);
} catch (e) {
  if (e instanceof UsageError || e?.name === 'SiblingError') exitUsage(e, { json });
  else exitInternal(e, { json });
}
