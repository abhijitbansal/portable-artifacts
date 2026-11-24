// One run of the arms driver in this process, with a fake `claude` on PATH. Shared by the driver's test files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../run-arms.mjs';
import { readLedger } from '../../arms-lib.mjs';
import { fakeArms, fakeClaude, fakePrompts, fakeRepo, sink, tmp, withClaude } from './arms-fixtures.mjs';

export const evalDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The driver's argument list: `flags` replace the defaults key by key (an undefined value drops one). */
export function argvOf({ arms = fakeArms(), armArgs, args = {}, out }) {
  const flags = { '--skill': 'motion', '--set': 'budget', '--host': 'claude-stream', '--model': 'sonnet', '--budget': '1', '--max-total': '20', '--timeout': '60', '--out': out, ...args };
  return [...Object.entries(flags).flatMap(([k, v]) => (v === undefined ? [] : v === true ? [k] : [k, String(v)])), ...(armArgs ?? Object.entries(arms).flatMap(([n, d]) => ['--arm', `${n}=${d}`]))];
}

/** Start the driver without waiting: -> { done: Promise<code>, stdout, stderr, out, calls, ledger }. */
export function start({ claude = fakeClaude(), repo = fakeRepo(), arms = fakeArms(), armArgs, args = {}, out = tmp('pa-arms-out-'), prompts = fakePrompts(), pre } = {}) {
  const argv = argvOf({ arms, armArgs, args, out });
  if (pre) pre(out);
  const stdout = sink();
  const stderr = sink();
  const done = withClaude(claude.bin, () => main(argv, { evalDir, skillsRoot: repo, promptsDir: prompts, stdout, stderr }));
  return {
    done, stdout, stderr, out, calls: claude.calls,
    ledger: () => readLedger(fs.readFileSync(path.join(out, 'cases.jsonl'), 'utf8')),
  };
}

/** One driver run to its end: -> { code, stdout, stderr, out, calls, ledger } (stdout and stderr as text). */
export async function drive(options = {}) {
  const run = start(options);
  const code = await run.done;
  return { code, stdout: run.stdout.text, stderr: run.stderr.text, out: run.out, calls: run.calls(), ledger: run.ledger };
}

/** --packets and --verdict, which start no host. */
export async function tool(argv, { prompts = fakePrompts() } = {}) {
  const stdout = sink();
  const stderr = sink();
  const code = await main(argv, { evalDir, skillsRoot: fakeRepo(), promptsDir: prompts, stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}
