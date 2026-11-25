// A failure that is neither a spec error nor a usage error is a bug in the tool:
// say so in one line (exit 1) instead of printing a stack trace. The message of a browser error can hold what a page said, so the line
// goes through agentText (invisible characters written out, at most 200 characters), and a JSON line through escapeJsonInvisible.
import { agentText, escapeJsonInvisible } from '../../shared/agent-text.mjs';

const MESSAGE_MAX = 200;

/** Print "internal error: <message>; please report it" (JSON on stdout when asked, else stderr) and set exit code 1. */
export function exitInternal(error, { json = false } = {}) {
  const first = agentText(String(error?.message ?? error).split('\n')[0], { max: MESSAGE_MAX });
  const message = `internal error: ${first}; please report it`;
  if (json) process.stdout.write(`${escapeJsonInvisible(JSON.stringify({ ok: false, errors: [{ path: '', message }] }))}\n`);
  else process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
