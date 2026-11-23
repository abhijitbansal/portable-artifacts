// Where a built page goes. In order: --out (file or directory); $PA_OUTPUT_DIR; <git root>/.scratch/<slug>.html when
// the spec sits inside a git repo; else ~/.agent/diagrams/<slug>.html. Never anywhere implicit but those.
// Shared by every skill that writes a page. Node built-ins and shared/git-run.mjs only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SCRATCH_TIMEOUT_MS, hardenedGitEnv, gitBaseArgs, spawnGit } from './git-run.mjs';

const MAX_SLUG = 60;
const DEFAULT_FALLBACK = 'diagram';
const SCRATCH_DIR = '.scratch';

/** Title -> lowercase [a-z0-9-], at most 60 characters, `fallback` when nothing is left. */
export function slugify(title, fallback = DEFAULT_FALLBACK) {
  const slug = String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, MAX_SLUG).replace(/-+$/, '');
  return slug || fallback;
}

/** The nearest folder at or above `start` that holds a .git entry (a directory, or a file in a worktree); null outside a repo. */
export function findGitRoot(start, exists = fs.existsSync) {
  let dir = path.resolve(start);
  for (;;) {
    if (exists(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The default page path with no --out: $PA_OUTPUT_DIR, else <git root>/.scratch for a spec inside a repo, else ~/.agent/diagrams. */
export function defaultOutputPath({ title, fallback = DEFAULT_FALLBACK, specPath, env = process.env, home = os.homedir(), exists = fs.existsSync }) {
  const file = `${slugify(title, fallback)}.html`;
  if (env.PA_OUTPUT_DIR) return path.join(path.resolve(env.PA_OUTPUT_DIR), file);
  const root = specPath ? findGitRoot(path.dirname(path.resolve(specPath)), exists) : null;
  if (root) return path.join(root, SCRATCH_DIR, file);
  return path.join(path.resolve(home, '.agent', 'diagrams'), file);
}

/** Absolute .html path for a build. `out` ending in .html or .htm is the file; any other `out` is a directory. Pass `specPath` to get the in-repo default. */
export function resolveOutput({ out, title, fallback = DEFAULT_FALLBACK, specPath, env = process.env, home = os.homedir(), exists = fs.existsSync }) {
  if (out && /\.html?$/i.test(out)) return path.resolve(out);
  if (out) return path.join(path.resolve(out), `${slugify(title, fallback)}.html`);
  return defaultOutputPath({ title, fallback, specPath, env, home, exists });
}

/**
 * One line to print after a build into <git root>/.scratch when git does not ignore that folder, else null.
 * Silent when the target is elsewhere, when git is missing, or when git cannot answer (an error, a timeout, any status but 1).
 * The repository may not be the user's own, so the question must not let it run anything (shared/git-run.mjs): `--no-index`
 * (the index is not read, so no fsmonitor query and no lazy fetch of a blob that is missing), the hardened environment and
 * config overrides, and a short time limit (a named pipe at .gitignore would block git for good). `run` and `timeoutMs` are
 * test seams.
 */
export function scratchIgnoreNote(target, { exists = fs.existsSync, run = spawnSync, timeoutMs = SCRATCH_TIMEOUT_MS } = {}) {
  const scratch = path.dirname(path.resolve(target));
  if (path.basename(scratch) !== SCRATCH_DIR) return null;
  const root = path.dirname(scratch);
  if (!exists(path.join(root, '.git'))) return null;
  const args = [...gitBaseArgs(), 'check-ignore', '--no-index', '-q', '--', path.join(SCRATCH_DIR, path.basename(target))];
  const result = spawnGit(root, args, { env: hardenedGitEnv(process.env), timeoutMs, spawn: run });
  if (result.error || result.status !== 1) return null;
  return `note: ${SCRATCH_DIR}/ is not gitignored in ${root}; add ${SCRATCH_DIR}/ to .gitignore (or .git/info/exclude) so built pages stay out of commits`;
}

/** The bare file:// URL for a built page. Builders print it alone on its own line (no label, no trailing text) so it stays clickable. */
export function fileUrlLine(absPath) {
  return pathToFileURL(path.resolve(absPath)).href;
}
