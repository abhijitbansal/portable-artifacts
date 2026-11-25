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
