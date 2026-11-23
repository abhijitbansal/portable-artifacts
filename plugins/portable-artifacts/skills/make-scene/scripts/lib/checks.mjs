// Error helpers shared by the semantic checks: every message names the value
// and the fix, with a did-you-mean over a closed set.
import { didYouMean, pathJoin } from '../../shared/errors.mjs';
import { agentText, agentJson } from '../../shared/agent-text.mjs';

const MAX_LISTED = 12;
const ECHO_MAX = 80; // the longest user text an error message echoes (see agent-text.mjs)
export const q = (v) => JSON.stringify(v);

// `candidates` are the raw names: the match runs on the real text, and each name is escaped once, here, where it is printed.
// A hint that would be cut by the cap is not offered (a cut name is not a valid value); the list says it with a count instead.
export function suggestion(value, candidates, label = 'available') {
  const hint = didYouMean(value, candidates);
  if (hint !== null && [...String(hint)].length <= ECHO_MAX) return `did you mean ${agentJson(hint, { max: Infinity })}?`;
  const shown = candidates.slice(0, MAX_LISTED).map((c) => agentText(c, { max: ECHO_MAX })).join(', ');
  return `${label}: ${shown}${candidates.length > MAX_LISTED ? `, … (${candidates.length - MAX_LISTED} more)` : ''}`;
}

export function checkLength(errors, item, field, base, limit) {
  const value = item[field];
  if (typeof value !== 'string') return;
  const n = [...value].length;
  if (n > limit) errors.push({ path: pathJoin(base, field), message: `${field} is ${n} characters; the limit is ${limit}; shorten it` });
}

export function checkNegative(errors, value, at) {
  if (typeof value === 'number' && value < 0) errors.push({ path: at, message: `value ${value} is negative; values must be 0 or more` });
}
