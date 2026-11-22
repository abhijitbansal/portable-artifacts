// The text of `--range <from>..<to>`: split into its two film times as written. Kept apart from slice.mjs so the command line
// (cli.mjs) can refuse a malformed range without loading the film's engine. Pure.
import { UsageError } from '../../shared/cli.mjs';

const RANGE_SEPARATOR = '..';

/** The usage error for a --range that is not `<from>..<to>`, naming the form. */
export const RANGE_FORM = '--range takes <from>..<to>, two film times (seconds such as 1.5, a shot id, <shot-id>@<anchor> or an anchor such as end-1), '
  + 'for example --range intro..rows@end';

/** The two film times of `--range <from>..<to>` as written. A text with no "..", or an empty side, is a UsageError naming the form. */
export function rangeParts(text) {
  const at = typeof text === 'string' ? text.indexOf(RANGE_SEPARATOR) : -1;
  if (at <= 0 || at + RANGE_SEPARATOR.length >= text.length) throw new UsageError(RANGE_FORM);
  return [text.slice(0, at), text.slice(at + RANGE_SEPARATOR.length)];
}
