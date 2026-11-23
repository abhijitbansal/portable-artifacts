// The git config reader shared by make-explainer's gather and make-scene's rows git. It reads the whole listing
// (`git config --list --includes --show-scope -z`) as bytes and decides in JavaScript, because git's own key matcher
// fails, with no output, on a key that is not valid UTF-8 in a UTF-8 locale. These tests feed it bytes only; no git runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG_LIST_ARGS, parseConfigList, repoOwnedConfig, isPartialClone, skipsDirtyCheck } from '../git-config.mjs';

const VERSION = ['local', 'core.repositoryformatversion', '0'];

// rows: [scope, key, value?]; a row without a value is a key with no "=" (a bare boolean). Strings are latin1: one char, one byte.
const listing = (...rows) => Buffer.from(rows.map(([scope, key, value]) => `${scope}\0${key}${value === undefined ? '' : `\n${value}`}\0`).join(''), 'latin1');
const keysOf = (entries) => entries.map((e) => e.key);

test('the listing arguments are the -z, scope-tagged, include-following list with values', () => {
  assert.deepEqual(CONFIG_LIST_ARGS, ['config', '--list', '--includes', '--show-scope', '-z']);
});

test('parses scope, key and value; a key without a value has value null; keys are lowercased', () => {
  const entries = parseConfigList(listing(VERSION, ['local', 'Core.Bare2'], ['local', 'user.name', 'A B'], ['worktree', 'LFS.Extension.X.clean', '/bin/x']));
  assert.deepEqual(entries.map((e) => [e.scope, e.key, e.value]), [
    ['local', 'core.repositoryformatversion', '0'],
    ['local', 'core.bare2', null],
    ['local', 'user.name', 'A B'],
    ['worktree', 'lfs.extension.x.clean', '/bin/x'],
  ]);
});

test('bytes that are not valid UTF-8 survive in keys and values, one char per byte', () => {
  const entries = parseConfigList(listing(VERSION, ['local', 'filter.\xff.clean', 'x\xc3'], ['local', 'remote.\xc3.promisor', 'true']));
  assert.equal(entries[1].key, 'filter.\xff.clean');
  assert.equal(entries[1].value, 'x\xc3');
  assert.equal(entries[2].key, 'remote.\xc3.promisor');
});

test('only ASCII letters are lowercased, so a high byte is never folded into another one', () => {
  assert.equal(parseConfigList(listing(VERSION, ['local', 'filter.\xc3.CLEAN']))[1].key, 'filter.\xc3.clean');
});

test('a value keeps its embedded newlines and does not become a second entry', () => {
  const entries = parseConfigList(listing(VERSION, ['local', 'core.x', 'a\nlfs.extension.evil.clean=/bin/x']));
  assert.equal(entries.length, 2);
  assert.equal(entries[1].value, 'a\nlfs.extension.evil.clean=/bin/x');
});

test('only a Buffer is read: a string (decoded by the caller, bytes already lost) is null', () => {
  assert.equal(parseConfigList(listing(VERSION)).length, 1);
  assert.equal(parseConfigList(listing(VERSION).toString('latin1')), null);
  assert.equal(repoOwnedConfig(listing(VERSION).toString('utf8')), null);
});

test('repoOwnedConfig drops global, system and command entries and keeps the rest', () => {
  const entries = repoOwnedConfig(listing(
    ['global', 'filter.g.clean', 'cat'], ['system', 'filter.s.clean', 'cat'], ['command', 'safe.barerepository', 'explicit'],
    VERSION, ['local', 'user.name', 'x'], ['worktree', 'user.email', 'y'], ['unknown', 'credential.helper', 'osxkeychain'],
  ));
  assert.deepEqual(keysOf(entries), ['core.repositoryformatversion', 'user.name', 'user.email', 'credential.helper']);
});

// Fail closed: null means "cannot tell", and both tools treat it as a hit.
test('a failed git (null), an empty listing and a listing with no entry of a repository of its own are all null', () => {
  assert.equal(repoOwnedConfig(null), null);
  assert.equal(repoOwnedConfig(Buffer.alloc(0)), null);
  assert.equal(repoOwnedConfig(listing(['global', 'core.repositoryformatversion', '0'])), null, 'a global file is not the repository');
  assert.equal(repoOwnedConfig(listing(['system', 'user.name', 'x'], ['command', 'core.x', 'y'], ['unknown', 'credential.helper', 'osxkeychain'])), null, 'Apple git lists unknown-scope entries outside a repository');
});

test('any entry in scope local or worktree marks a repository: core.repositoryformatversion is not required', () => {
  assert.deepEqual(keysOf(repoOwnedConfig(listing(['local', 'user.name', 'x']))), ['user.name']);
  assert.deepEqual(keysOf(repoOwnedConfig(listing(['worktree', 'user.name', 'x']))), ['user.name']);
  assert.deepEqual(keysOf(repoOwnedConfig(listing(['global', 'core.repositoryformatversion', '0'], ['local', 'core.bare', 'false']))), ['core.bare']);
});

test('an odd field count, a missing final NUL, an empty key or an odd scope is null', () => {
  const good = listing(VERSION, ['local', 'user.name', 'x']);
  assert.notEqual(repoOwnedConfig(good), null);
  assert.equal(repoOwnedConfig(good.subarray(0, good.length - 1)), null, 'the last field is not terminated');
  assert.equal(repoOwnedConfig(Buffer.concat([good, Buffer.from('local\0')])), null, 'a scope with no entry');
  assert.equal(repoOwnedConfig(Buffer.concat([good, Buffer.from('local\0\nvalue\0')])), null, 'an entry with an empty key');
  assert.equal(repoOwnedConfig(Buffer.concat([good, Buffer.from('lo cal\0user.x\ny\0')])), null, 'a scope that is not a word');
  assert.equal(repoOwnedConfig(Buffer.from('core.repositoryformatversion\n0\0user.name\nx\0')), null, 'a listing without scopes (git older than 2.26)');
});

test('a sha256 repository (format version 1, with extensions) is readable', () => {
  const entries = repoOwnedConfig(listing(['local', 'core.repositoryformatversion', '1'], ['local', 'extensions.objectformat', 'sha256'], ['local', 'extensions.worktreeconfig', 'true']));
  assert.equal(entries.length, 3);
});

test('partial clone: extensions.partialclone, or a remote.* key ending .promisor or .partialclonefilter', () => {
  const clone = (...rows) => isPartialClone(repoOwnedConfig(listing(VERSION, ...rows)));
  assert.equal(clone(['local', 'extensions.partialClone', 'origin']), true);
  assert.equal(clone(['local', 'remote.origin.promisor', 'true']), true);
  assert.equal(clone(['local', 'remote.origin.partialclonefilter', 'blob:none']), true);
  assert.equal(clone(['worktree', 'remote.a.b.PROMISOR', 'true']), true);
  assert.equal(clone(['local', 'remote.\xff.promisor', 'true']), true, 'a remote named with a byte that is not UTF-8');
  assert.equal(clone(['local', 'remote.\xc3.partialclonefilter', 'blob:none']), true);
  assert.equal(clone(['local', 'remote.origin.url', 'x'], ['local', 'remote.origin.fetch', 'y'], ['local', 'extensions.objectformat', 'sha256']), false);
  assert.equal(clone(['global', 'remote.origin.promisor', 'true']), false, 'the user\'s own file is not the repository');
});

test('skips the dirty check for filter., lfs.extension. and hook. keys, in any case and with any bytes', () => {
  const skips = (...rows) => skipsDirtyCheck(repoOwnedConfig(listing(VERSION, ...rows)));
  assert.equal(skips(['local', 'filter.evil.clean', 'x']), true);
  assert.equal(skips(['local', 'filter.\xff.clean', 'x']), true);
  assert.equal(skips(['local', 'filter.\xc3.process', 'x']), true);
  assert.equal(skips(['local', 'filter.\x1f.clean', 'x']), true);
  assert.equal(skips(['local', 'filter.', 'x']), true, 'an empty filter name');
  assert.equal(skips(['worktree', 'LFS.Extension.X.clean', 'x']), true);
  assert.equal(skips(['local', 'lfs.Extension.X.clean', 'x']), true, 'a mixed-case subsection');
  assert.equal(skips(['local', 'hook.x.command', 'x']), true);
  assert.equal(skips(['local', 'hook.\xff.command', 'x']), true);
});

test('skips the dirty check for a repository-owned value with a line, after its first, that starts with lfs.', () => {
  const skips = (...rows) => skipsDirtyCheck(repoOwnedConfig(listing(VERSION, ...rows)));
  assert.equal(skips(['local', 'core.x', 'a\nlfs.extension.evil.clean=/bin/x']), true);
  assert.equal(skips(['local', 'core.x', 'a\rlfs.extension.evil.clean=/bin/x']), true, 'a CR starts a line too');
  assert.equal(skips(['local', 'core.x', 'a\r\n  \tLFS.Url=x']), true, 'trimmed and ASCII-lowercased');
  assert.equal(skips(['local', 'core.x', 'a\nb\nlfs.x=1']), true, 'any later line');
  assert.equal(skipsDirtyCheck(repoOwnedConfig(listing(VERSION, ['global', 'core.x', 'a\nlfs.extension.e.clean=1']))), false, 'the user\'s own file is not counted');
});

test('an ordinary value with a line break does not skip the dirty check (git branch --edit-description writes one)', () => {
  const skips = (...rows) => skipsDirtyCheck(repoOwnedConfig(listing(VERSION, ...rows)));
  assert.equal(skips(['local', 'branch.main.description', 'what it is for\n\n']), false);
  assert.equal(skips(['local', 'core.x', '\n']), false);
  assert.equal(skips(['local', 'core.x', 'one line']), false);
  assert.equal(skips(['local', 'core.x', 'lfs.extension.e.clean=1']), false, 'the first line is the key\'s own value');
  assert.equal(skips(['local', 'core.x', 'a\nnot lfs.extension.x\nxlfs.y']), false, 'the line must start with lfs.');
});

test('an lfs. key with a byte above 0x7f skips the dirty check; the same bytes outside lfs. do not', () => {
  const skips = (...rows) => skipsDirtyCheck(repoOwnedConfig(listing(VERSION, ...rows)));
  assert.equal(skips(['local', 'lfs.extens\xc4\xb0on.evil.clean', 'x']), true);
  assert.equal(skips(['local', 'LFS.\xff.x', 'x']), true);
  assert.equal(skips(['local', 'core.\xc4\xb0', 'x']), false);
  assert.equal(skips(['local', 'lfs.url', 'https://x.invalid/\xc3\xa9']), false, 'a high byte in a value is fine');
});

test('ordinary local keys, including lfs ones, do not skip the dirty check', () => {
  const entries = repoOwnedConfig(listing(
    VERSION, ['local', 'core.filemode', 'true'], ['local', 'lfs.repositoryformatversion', '0'], ['local', 'lfs.url', 'https://x.invalid/lfs'],
    ['local', 'lfs.https://x.invalid/lfs.access', 'basic'], ['local', 'lfs.concurrenttransfers', '8'], ['local', 'filterx.y', 'z'], ['local', 'hooks.x', 'y'],
    ['global', 'filter.lfs.clean', 'git-lfs clean -- %f'], ['system', 'filter.lfs.smudge', 'git-lfs smudge'],
  ));
  assert.equal(skipsDirtyCheck(entries), false);
  assert.equal(isPartialClone(entries), false);
});
