// The repository's own git config, read as bytes, for the two tools that run git inside a repository that may not be the
// user's own (make-explainer's gather and make-scene's rows git). Both ask the same two questions of that config: is this
// a partial clone, and does it hold anything that git would run while it compares files?
//
// git is never asked to match a key. `git config --get-regexp` fails with exit 1 and no output when a key's subsection is
// not valid UTF-8 in a UTF-8 locale, and exit 1 with no output is also how git says "no match", so a hostile name
// (`[filter "\xff"]`) used to read as a clean config. Instead the whole listing is read as a Buffer and decided here, and
// anything that does not parse is null: the caller fails closed (refuses, or skips the dirty check).
//
// Text is latin1 throughout: one char per byte, nothing decoded, nothing lost.

// `-z`: `scope NUL key [LF value] NUL` per entry. --includes follows include.path and includeIf; --show-scope also marks
// config.worktree, which `--local` misses. Needs git 2.26 or later; an older git fails and the caller fails closed.
export const CONFIG_LIST_ARGS = ['config', '--list', '--includes', '--show-scope', '-z'];

// Scopes whose config the user owns, plus command-line `-c` (the tools' own flags). Anything else (the repository's
// .git/config, its config.worktree, a file either includes, an unknown scope) is the repository's own.
const USER_SCOPES = new Set(['global', 'system', 'command']);
const SCOPE = /^[a-z]+$/;
// Every repository has this key in its own config (linked worktrees and submodule checkouts read the shared or the
// module's config, still scope `local`); a listing without it is not a listing of a repository, so it is unreadable.
const REPO_MARKER = 'core.repositoryformatversion';

// ASCII only: a latin1 `toLowerCase` would fold high bytes (0xC3 to 0xE3) and change what a name is.
const lowerAscii = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * The entries of a `config --list --includes --show-scope -z` listing: [{ scope, key, value }], key lowercased, value null for
 * a key written without "=". Null when the structure is not exactly that (odd field count, an unterminated final field,
 * a scope that is not a word, an empty key). Only a Buffer is accepted: a string means a caller let node decode the bytes
 * (spawnSync's default), which has already lost them, so it is null.
 */
export function parseConfigList(stdout) {
  if (!Buffer.isBuffer(stdout)) return null;
  const text = stdout.toString('latin1');
  if (!text.endsWith('\0')) return null;
  const fields = text.slice(0, -1).split('\0');
  if (fields.length % 2 !== 0) return null;
  const entries = [];
  for (let i = 0; i < fields.length; i += 2) {
    const scope = fields[i];
    const entry = fields[i + 1];
    const split = entry.indexOf('\n');
    const key = split === -1 ? entry : entry.slice(0, split);
    if (!SCOPE.test(scope) || key === '') return null;
    entries.push({ scope, key: lowerAscii(key), value: split === -1 ? null : entry.slice(split + 1) });
  }
  return entries;
}

/**
 * The entries the repository owns (every scope but global, system and command), from the stdout of the listing; pass null
 * when git failed or could not run. Null when the config cannot be read (a failure, a malformed listing, or no repository
 * of its own in it): treat it as a hit.
 */
export function repoOwnedConfig(stdout) {
  if (stdout === null || stdout === undefined) return null;
  const entries = parseConfigList(stdout);
  if (entries === null) return null;
  if (!entries.some((e) => e.scope === 'local' && e.key === REPO_MARKER)) return null;
  return entries.filter((e) => !USER_SCOPES.has(e.scope));
}

/**
 * True when the repository's own config says it is a partial clone: extensions.partialclone, or a remote's promisor or
 * partialclonefilter key. A fetch of a missing object runs that repository's remote settings (uploadpack, sshCommand,
 * a credential helper).
 */
export function isPartialClone(entries) {
  return entries.some(({ key }) => key === 'extensions.partialclone'
    || (key.startsWith('remote.') && (key.endsWith('.promisor') || key.endsWith('.partialclonefilter'))));
}

/**
 * True when the repository's own config holds something git or git-lfs would run while comparing files: a filter driver
 * (`filter.<name>.*`), a git-lfs extension (`lfs.extension.<name>.*`), a hook (`hook.<name>.*`), or any value with a
 * line break (git-lfs reads `git config -l` line by line, so a value can forge a line that names an extension).
 * Ordinary local lfs keys (`lfs.repositoryformatversion`, `lfs.url`) do not count.
 */
export function skipsDirtyCheck(entries) {
  return entries.some(({ key, value }) => key.startsWith('filter.') || key.startsWith('lfs.extension.') || key.startsWith('hook.')
    || (value !== null && value.includes('\n')));
}
