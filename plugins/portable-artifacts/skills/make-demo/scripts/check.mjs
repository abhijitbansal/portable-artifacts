#!/usr/bin/env node
// node scripts/check.mjs <page.html> [--json] [--shots <dir>]
// Checks the built click plan page: runs make-explainer's check.mjs with the same arguments and passes its output and exit code through
// (it opens the page at three widths in a headless browser, so never start it while another browser runs).
// exit 0 ok or skipped (no browser), 1 problems, 2 usage, or no make-explainer next to this skill
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { exitInternal } from './lib/internal-error.mjs';

const USAGE = 'node scripts/check.mjs <page.html> [--json] [--shots <dir>]';
const OPTIONS = { json: { type: 'boolean' }, shots: { type: 'string' } };

const argv = process.argv.slice(2);
let json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  json = values.json === true;
  if (positionals.length !== 1) throw new UsageError(`expected one page file; usage: ${USAGE}`);
  const { runExplainer } = await import('./lib/explainer.mjs');
  process.exitCode = runExplainer('check', argv);
} catch (e) {
  if (e instanceof UsageError || e?.name === 'SiblingError') exitUsage(e, { json });
  else exitInternal(e, { json });
}
