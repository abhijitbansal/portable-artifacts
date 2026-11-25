// Cut a long text from the left, so the end that tells two of them apart stays. Pure.
import { agentText } from '../../shared/agent-text.mjs';

/** `text` through agentText; over `max` characters the first ones are dropped: `[N more characters]…` then the last `max`. */
export function cutLeft(text, { max }) {
  const parts = [...String(text)].map((char) => agentText(char)); // an escape is one part and is never split
  if (parts.length <= max) return parts.join('');
  return `[${parts.length - max} more characters]\u{2026}${parts.slice(parts.length - max).join('')}`;
}
