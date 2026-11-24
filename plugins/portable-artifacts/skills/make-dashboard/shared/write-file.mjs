// Write a file at a path someone else may have prepared. A repository the user did not write can ship a symlink at
// `.scratch/<slug>.html` (or at any predictable output name), and a plain writeFileSync would overwrite the link's
// target. This writes a temp file beside the target (exclusive create, an unpredictable name), then renames it over
// the target: a rename replaces whatever is at the name, a symlink included, and never opens it. A dangling link and a
// FIFO are replaced too (nothing is opened, so nothing blocks); a directory at the target makes the rename fail (EISDIR
// on macOS and Linux) and stays as it was.
// There is no fallback: if the rename cannot happen, the error is thrown and nothing is written in place.
// Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const MODE_MASK = 0o777;
const TOKEN_BYTES = 8;
const MAX_BASE = 100; // keeps the temp name under the 255-byte file name limit

// The mode of a regular file already at `target` (an overwrite keeps it, as writeFileSync does), else null.
function existingMode(target) {
  const stat = fs.lstatSync(target, { throwIfNoEntry: false });
  return stat?.isFile() ? stat.mode & MODE_MASK : null;
}

/**
 * For a writer that takes a path and opens it itself (a browser's screenshot): remove a symlink at `target` first, so
 * the writer creates a new file where the link was. A regular file or folder is left alone (the writer replaces or
 * refuses it as before). A window remains between this call and the writer's open; use writeFileReplacing when the
 * bytes are in hand.
 */
export function dropLinkAt(target) {
  if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(target);
}

/**
 * Write `data` (text or bytes) to `target`, replacing whatever is there without following it.
 * A new file gets the mode writeFileSync would give; a replaced regular file keeps its own. Throws the file system's
 * error (its `code` intact: EACCES, ENOSPC, EISDIR for a folder at the target ...) and leaves no temp file behind. The folder must exist.
 * @param {string} target
 * @param {string | Uint8Array} data
 * @returns {string} target
 */
export function writeFileReplacing(target, data) {
  const mode = existingMode(target);
  const base = path.basename(target).slice(0, MAX_BASE);
  const temp = path.join(path.dirname(target), `.${base}.${randomBytes(TOKEN_BYTES).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temp, data, { flag: 'wx' });
    if (mode !== null) fs.chmodSync(temp, mode);
    fs.renameSync(temp, target);
  } catch (e) {
    fs.rmSync(temp, { force: true });
    throw e;
  }
  return target;
}
