#!/usr/bin/env node
// make-demo, the one command: check the machine, validate the demo, build the click plan page, check it, print one report.
//   node scripts/make.mjs <demo.json> [--out <path>] [--json] [--no-check] [--theme <name>] [--model <m>] [--effort <e>] [--agent <a>]
// It runs doctor.mjs, validate.mjs, build.mjs and check.mjs as they are; see shared/make-run.mjs for the report, the exit codes
// (0, 1, 2, 130) and the stages. Scout is not a stage: run scripts/scout.mjs first, build refuses a demo that was never scouted.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMain } from '../shared/make-run.mjs';

await makeMain(process.argv.slice(2), {
  skill: 'make-demo',
  scriptsDir: path.dirname(fileURLToPath(import.meta.url)),
});
