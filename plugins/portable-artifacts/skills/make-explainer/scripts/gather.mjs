#!/usr/bin/env node
// node scripts/gather.mjs git [--base <branch>] [--repo <folder>] [--out <file>] [--json]
// Prints the facts of the checked-out branch as JSON: branch, base, merge base, commits,
// changed files (with +/- counts, renames and binaries), test files, date. Committed work
// only (a warning on stderr says when there are none or when the work tree has uncommitted changes; the facts
// carry `dirty` (null when skipped) and `warnings` too; a partial clone is refused); nothing is written except the --out file. Feed the output to scaffold.mjs --facts.
// exit 0 ok, 2 usage / not a repository / no such base
import { gatherGit } from './lib/git.mjs';
import { emit } from './lib/write-out.mjs';
import { agentText, capText, escapeJsonInvisible } from '../shared/agent-text.mjs';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';

const USAGE = 'node scripts/gather.mjs git [--base <branch>] [--repo <folder>] [--out <file>] [--json]';
const OPTIONS = { base: { type: 'string' }, repo: { type: 'string' }, out: { type: 'string' }, json: { type: 'boolean' } };
const SOURCES = ['git'];
// A commit subject is repository text the agent reads, so printed to stdout a long one is cut. A facts file (--out) keeps it exact:
// scaffold.mjs builds the page's timeline titles from it.
const SUBJECT_MAX = 200;

const argv = process.argv.slice(2);
const json = argv.includes('--json');
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  const [source, ...extra] = positionals;
  if (source === undefined) throw new UsageError(`expected a subcommand (${SOURCES.join(', ')}); usage: ${USAGE}`);
  if (!SOURCES.includes(source)) throw new UsageError(`unknown source "${source}"; the only source is ${SOURCES.join(', ')}; usage: ${USAGE}`);
  if (extra.length > 0) throw new UsageError(`unexpected argument "${extra[0]}"; usage: ${USAGE}`);
  const facts = gatherGit({ repo: values.repo, base: values.base });
  // Commit subjects, file names and branch names are repository text the agent reads. Every invisible character in them is
  // written as a JSON escape (and as a code point on stderr), so the agent sees it; JSON.parse, and so scaffold.mjs, gets the exact text.
  for (const w of facts.warnings) process.stderr.write(`warning: ${agentText(w, { max: Infinity })}\n`);
  const shown = values.out === undefined ? { ...facts, commits: facts.commits.map((c) => ({ ...c, subject: capText(c.subject, { max: SUBJECT_MAX }) })) } : facts;
  emit(`${escapeJsonInvisible(JSON.stringify(shown, null, values.json ? 0 : 2))}\n`, values.out);
} catch (e) {
  if (!(e instanceof UsageError)) throw e;
  // Branch names, a --base echo and git's own stderr are repository text too: shown with invisible characters as code points.
  exitUsage(e.help === true ? e : new UsageError(agentText(String(e.message).split('\n')[0], { max: Infinity })), { json });
}
