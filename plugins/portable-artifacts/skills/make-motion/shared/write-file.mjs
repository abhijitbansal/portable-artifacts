// Where and how a tool writes a file when the folder may belong to a repository the user did not write.
//
// 1. CONTAINMENT: `assertContained(path)` and `ensureOutputFolder(dir)`. For the absolute lexical path, every ancestor (the
//    path itself included) that holds a `.git` entry (a folder, or a file in a linked work tree or a submodule) is a
//    repository, and the real path of the deepest part that exists must lie inside that repository's real path. A symlink
//    that leads outside is refused in one line, before anything is created, written or deleted; a link that stays inside is
//    allowed; a dangling link is refused. The `.git` is looked for along the lexical path, so one found THROUGH a link (a
//    linked folder that is itself a repository) does not hide the outer repository. Outside any repository nothing changes
//    (an unpacked archive with no .git is not covered). It applies to default and explicit paths alike; the path the user
//    would pass instead is the real one, which names no link. A path that is, or leads into, the repository's own `.git` is
//    refused too. The path is folded once (`path.resolve`: a `..` is text); the check looks at it and at the text as the OS
//    would walk it, and the caller makes and writes the RETURNED path, so check and write never see two places. A file-system
//    error of the check (EACCES, ENAMETOOLONG, ELOOP, a null byte) is a one-line UsageError carrying the fs code.
// 2. REPLACING: `writeFileReplacing(target, data)` writes a temp file beside the target (exclusive create, an unpredictable
//    short name, owner-only until the text is in) and renames it over the target. A rename replaces whatever is at the name,
//    a symlink included, and never opens it. A FIFO, socket or device at the target is refused (never opened, never replaced);
//    a symlink to a folder is an EISDIR error, as a folder is; exactly /dev/stdout, /dev/stderr, /dev/null, /dev/tty,
//    /dev/fd/N, /proc/self/fd/N and /proc/<pid>/fd/N are written in place, so --out /dev/stdout and process substitution still
//    work (when stdout is a socket, Linux refuses the open and the error is the system's: write to a file or a pipe instead).
//    An existing regular file keeps its mode and, when the caller may give it, its group (else the group bits are dropped;
//    the group is set before the text is written); one that is not writable is EACCES, as a plain write reports it.
//    Owner, ACL entries, extended attributes and setuid/setgid bits are not kept, and a hard link to the file is broken.
// There is no fallback: if the rename cannot happen, the error is thrown and nothing is written in place.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { UsageError } from './cli.mjs';
import { isInside, realOrResolved } from './git-run.mjs';

const MODE_MASK = 0o777;
const OWNER_BITS = 0o700;
const GROUP_BITS = 0o070;
const NEW_FILE_MODE = 0o666; // what writeFileSync asks for; the umask narrows it
const TOKEN_BYTES = 8;
const GIT_ENTRY = '.git';
// Exactly these are written in place: the standard streams, the terminal, the null device and a numbered descriptor. /dev/shm, a
// /proc file and anything else under /dev/ or /proc/ is an ordinary path.
const DEVICE_PATH = /^\/(?:dev\/(?:stdout|stderr|null|tty|fd\/\d+)|proc\/(?:self|\d+)\/fd\/\d+)$/;
// A backslash is a separator on Windows only; on POSIX it is one letter of a name.
const SEPARATORS = path.sep === '\\' ? /[\\/]+/ : /\/+/;
const FS_REFUSALS = new Set(['EACCES', 'EPERM', 'ENAMETOOLONG', 'ELOOP']); // what the check and mkdir report for a path the user typed
const FIX = "remove the link, or pass the folder's real path";

/** The name of writeFileReplacing's temp file: a folder that a killed build left one in may sweep it (a regular file of this shape only). */
export const TEMP_NAME = /^\.pa-[0-9a-f]{16}\.tmp$/;

/** True for /dev/stdout, /dev/stderr, /dev/null, /dev/tty, /dev/fd/N, /proc/self/fd/N and /proc/<pid>/fd/N (never on Windows): written in place, never renamed over. */
export function isDeviceNamespace(target) {
  return DEVICE_PATH.test(path.resolve(target));
}

// A file-system error of the check or of mkdir, for a path the user typed, as the one-line usage error the CLIs print with exit 2.
// The fs code stays on it. Anything else is not ours to rename and is returned as it is.
function asUsageError(e, abs) {
  if (e instanceof UsageError || !FS_REFUSALS.has(e?.code)) return e;
  const refusal = new UsageError(`cannot use ${abs}: ${String(e.message).split('\n')[0]}`);
  refusal.code = e.code;
  return refusal;
}

const exists = (file) => {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
};

const lstatOrNull = (file) => {
  try {
    return fs.lstatSync(file);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
    throw e;
  }
};

/** The folders at or above `abs` (innermost first). */
function ancestors(abs) {
  const out = [];
  for (let dir = abs; ; dir = path.dirname(dir)) {
    out.push(dir);
    if (path.dirname(dir) === dir) return out;
  }
}

/**
 * Where the OS would put `target`: every symlink on the way followed (a `..` after a link climbs from the link's target, not
 * from the link's folder), the part that does not exist appended as it is, the part that exists in the letter case the disk
 * stores. -> { real } or { dangling } (the first link that leads nowhere).
 */
function resolveReal(target) {
  const start = path.isAbsolute(target) ? target : `${process.cwd()}${path.sep}${target}`;
  const { root } = path.parse(start);
  let comps = start.slice(root.length).split(SEPARATORS).filter(Boolean);
  let current = root;
  while (comps.length > 0) {
    const [name, ...rest] = comps;
    if (name === '.') {
      comps = rest;
      continue;
    }
    if (name === '..') {
      current = path.dirname(current);
      comps = rest;
      continue;
    }
    const next = path.join(current, name);
    const stat = lstatOrNull(next);
    if (stat === null) {
      const normal = path.normalize(comps.join(path.sep));
      if (normal === comps.join(path.sep)) return { real: path.join(fs.realpathSync.native(current), ...comps) };
      comps = normal.split(path.sep).filter(Boolean);
      continue;
    }
    if (stat.isSymbolicLink()) {
      try {
        current = fs.realpathSync.native(next);
      } catch {
        return { dangling: next };
      }
    } else current = next;
    comps = rest;
  }
  return { real: fs.realpathSync.native(current) };
}

// The first piece of `abs`, from `repo` down, that is a symlink leading outside `repoReal`; else `abs` itself.
function leadingLink(abs, repo, repoReal) {
  const pieces = ancestors(abs).filter((dir) => isInside(dir, repo)).reverse();
  const hit = pieces.find((piece) => {
    if (!lstatOrNull(piece)?.isSymbolicLink()) return false;
    const real = realOrResolved(piece);
    return !isInside(real, repoReal);
  });
  return hit ?? abs;
}

// `real` comes from resolveReal, which spells the part that exists in the letter case the disk stores (so `.GIT` is `.git` here).
const insideGitFolder = (real, repoReal) => isInside(real, path.join(repoReal, GIT_ENTRY));

// Refuse when `view` (a path that reaches `abs`'s file by the OS's own walk) leaves a repository of `repos`, or lands in its .git.
function refuseEscape(view, abs, repos) {
  const resolved = resolveReal(view);
  if (resolved.dangling !== undefined) throw new UsageError(`${resolved.dangling} is a symlink that leads nowhere, inside the repository ${repos[0]}; ${FIX}`);
  for (const repo of repos) {
    const repoReal = realOrResolved(repo);
    if (insideGitFolder(resolved.real, repoReal)) throw new UsageError(`${abs} is inside the .git folder of the repository ${repo}; a build never writes there`);
    if (isInside(resolved.real, repoReal)) continue;
    const link = leadingLink(abs, repo, repoReal);
    throw new UsageError(`${link} is a symlink that leads outside the repository ${repo} (to ${resolved.real}); ${FIX}`);
  }
}

/**
 * Throw a one-line UsageError when `target` (a folder to write in, or a file to write) would land outside a git repository that
 * holds it by name, through a symlink, or inside that repository's .git. Nothing is created. Returns the absolute lexical path
 * (folded once: a `..` is resolved as text), and that is the path to make and to write: the check looks at it, and at the text as
 * the OS would walk it, so neither reading can reach outside. A file-system error of the check is a one-line UsageError too.
 */
export function assertContained(target) {
  const abs = path.resolve(target);
  if (abs.includes('\0')) throw new UsageError(`cannot use ${JSON.stringify(abs)}: a path holds no null byte`);
  if (isDeviceNamespace(abs)) return abs;
  try {
    const repos = ancestors(abs).filter((dir) => exists(path.join(dir, GIT_ENTRY))).reverse(); // outermost first
    if (repos.length > 0) for (const view of new Set([abs, target])) refuseEscape(view, abs, repos);
  } catch (e) {
    throw asUsageError(e, abs);
  }
  return abs;
}

/** assertContained, then mkdir -p of the returned path. Returns the absolute lexical path. A device path (see isDeviceNamespace) is returned untouched. */
export function ensureOutputFolder(dir) {
  const abs = assertContained(dir);
  if (isDeviceNamespace(abs)) return abs;
  try {
    fs.mkdirSync(abs, { recursive: true });
  } catch (e) {
    throw asUsageError(e, abs);
  }
  return abs;
}

const SPECIAL_FILE = 'is a named pipe, socket or device, not a file; name a regular file (a path under /dev/ is written in place)';

function folderError(target) {
  return Object.assign(new Error(`EISDIR: illegal operation on a directory, open '${target}'`), { code: 'EISDIR', errno: -21, syscall: 'open', path: target });
}

/**
 * What is at `target`: { mode, gid } of a regular file an overwrite keeps the metadata of, else null. Throws for a target
 * that must not be replaced (a pipe, a socket, a device, a symlink to a folder) and for a regular file that is not writable.
 * writeFileReplacing asks it first; a writer that renames its own file over `target` (ffmpeg's output) asks it too.
 */
export function inspectTarget(target) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  if (stat === undefined) return null;
  if (stat.isSymbolicLink()) {
    if (fs.statSync(target, { throwIfNoEntry: false })?.isDirectory()) throw folderError(target);
    return null;
  }
  if (stat.isFile()) {
    fs.accessSync(target, fs.constants.W_OK);
    return { mode: stat.mode & MODE_MASK, gid: stat.gid };
  }
  if (stat.isDirectory()) return null; // the rename reports EISDIR
  throw new Error(SPECIAL_FILE);
}

// The group of the file the temp replaces, given to the temp BEFORE the text is written (the temp is owner-only until then). Returns
// the mode the finished file gets: `old.mode`, or without the group bits when the group cannot be kept (never another group's).
function keepGroup(fd, old) {
  if (fs.fstatSync(fd).gid === old.gid) return old.mode;
  try {
    fs.fchownSync(fd, -1, old.gid);
    return old.mode;
  } catch {
    return old.mode & ~GROUP_BITS;
  }
}

// A mount that refuses chmod keeps what the create gave: an existing file's replacement is then owner-only (mode & 0700).
function setMode(fd, mode) {
  try {
    fs.fchmodSync(fd, mode);
  } catch {
    // best effort
  }
}

const quietly = (fn) => {
  try {
    fn();
  } catch {
    // the error being reported is the first one, not the cleanup's
  }
};

/**
 * Write `data` (text or bytes) to `target`, replacing whatever is there without following it (see the header). A new file gets
 * the mode writeFileSync would give. Throws the file system's error (its `code` intact: EACCES, ENOSPC, EISDIR ...) and leaves
 * no temp file behind. The folder must exist (ensureOutputFolder).
 * @param {string} target
 * @param {string | Uint8Array} data
 * @returns {string} target
 */
export function writeFileReplacing(target, data) {
  if (isDeviceNamespace(target)) {
    fs.writeFileSync(target, data);
    return target;
  }
  const old = inspectTarget(target);
  const temp = path.join(path.dirname(target), `.pa-${randomBytes(TOKEN_BYTES).toString('hex')}.tmp`); // TEMP_NAME
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', old === null ? NEW_FILE_MODE : old.mode & OWNER_BITS); // the group and the rest come once the text is in
    const mode = old === null ? null : keepGroup(fd, old);
    fs.writeFileSync(fd, data);
    if (mode !== null) setMode(fd, mode);
    const done = fd;
    fd = undefined; // closed once, whether or not it succeeds: a second close would hide the real error
    fs.closeSync(done);
    fs.renameSync(temp, target);
  } catch (e) {
    if (fd !== undefined) quietly(() => fs.closeSync(fd));
    quietly(() => fs.rmSync(temp, { force: true }));
    throw e;
  }
  return target;
}
