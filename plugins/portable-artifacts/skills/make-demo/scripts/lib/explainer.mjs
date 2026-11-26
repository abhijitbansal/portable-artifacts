// make-explainer's scripts, run as child processes with this process's output: the click plan is drawn and checked by the sibling skill,
// never by a copy of its code. A missing sibling is a SiblingError (the install command, exit 2).
import { spawnSync } from 'node:child_process';
import { siblingScript } from './siblings.mjs';

const SIBLING = 'make-explainer';

// Tests point at a folder with no sibling in it; a real run always looks next to this skill.
const siblingsRoot = () => (process.env.NODE_ENV === 'test' ? process.env.PA_SIBLINGS_ROOT : undefined);

/** The absolute path of one of make-explainer's scripts ('build', 'check'); throws a SiblingError when it is not installed. */
export const explainerScript = (name) => siblingScript(SIBLING, `scripts/${name}.mjs`, { root: siblingsRoot() });

/** Run it with `argv` (no shell), its stdout and stderr passed through; returns its exit code (2 when it did not exit). */
export function runExplainer(name, argv) {
  const run = spawnSync(process.execPath, [explainerScript(name), ...argv], { stdio: 'inherit' });
  if (run.error) throw run.error;
  return run.status ?? 2;
}

const MAX_JSON_BYTES = 8 * 1024 * 1024; // answers.mjs prints a few kilobytes; a flood is an error, not a buffer

/**
 * Run it with `argv` and `--json` in it: stdout is captured (stderr passes through) and its one JSON line is parsed.
 * -> { status, result }. No line, more than one, or a line that is not a JSON object throws: a caller never acts on a
 * guess about what the script said. The thrown message holds no text from the script's output.
 */
export function runExplainerJson(name, argv) {
  const run = spawnSync(process.execPath, [explainerScript(name), ...argv], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: MAX_JSON_BYTES });
  if (run.error) throw run.error;
  const lines = run.stdout.split('\n').filter((line) => line.trim() !== '');
  if (lines.length !== 1) throw new Error(`make-explainer ${name} printed ${lines.length} lines on stdout, not the one JSON line expected (exit ${run.status ?? 'none'})`);
  let result;
  try {
    result = JSON.parse(lines[0]);
  } catch {
    throw new Error(`make-explainer ${name} printed a line that is not JSON (exit ${run.status ?? 'none'})`);
  }
  if (result === null || typeof result !== 'object' || Array.isArray(result)) throw new Error(`make-explainer ${name} printed JSON that is not an object`);
  return { status: run.status ?? 2, result };
}
