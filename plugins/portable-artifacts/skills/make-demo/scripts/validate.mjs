#!/usr/bin/env node
// node scripts/validate.mjs <demo.json> [--json]
// Checks a demo file against the schema and the rules for each step. Reads no page and opens no browser.
// exit 0 valid, 1 spec errors, 2 usage/IO or dependencies not installed (the doctor command is named)
//
// Imports only built-ins and shared/ up here: lib/spec.mjs (ajv) loads after preflight has found node_modules, so a
// missing install is one line naming the doctor command, not an ERR_MODULE_NOT_FOUND stack.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage, evalLog } from '../shared/cli.mjs';
import { printResult } from '../shared/errors.mjs';
import { preflight } from '../shared/preflight.mjs';
import { exitInternal } from './lib/internal-error.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'node scripts/validate.mjs <demo.json> [--json]';
const OPTIONS = { json: { type: 'boolean' } };

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  if (positionals.length !== 1) throw new UsageError(`expected one demo file; usage: ${USAGE}`);
  if (preflight(SKILL_ROOT, { argv })) {
    const { loadSpec, validateSpec } = await import('./lib/spec.mjs');
    const { spec } = loadSpec(positionals[0]);
    const result = validateSpec(spec);
    printResult(result, { json: values.json, label: positionals[0] });
    evalLog(result.ok, result.errors.length);
    process.exitCode = result.ok ? 0 : 1;
  }
} catch (e) {
  evalLog(false, 1);
  if (e instanceof UsageError) exitUsage(e, { json });
  else exitInternal(e, { json });
}
