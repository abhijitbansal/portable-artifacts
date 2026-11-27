// The one containment rule the render server, the clip decoder and the take reader share. A module of its own so
// server.mjs can read take folders (take.mjs) while take.mjs checks files by the same rule, with no import cycle.
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

export const MISSING_CODES = new Set(['ENOENT', 'ENOTDIR']);

// The real path of `file` when it is a regular file inside `root` (symlinks resolved), else null. A missing file is
// null; any other filesystem error is real and propagates.
export function fileInside(root, file) {
  let real;
  try {
    real = realpathSync(file);
    if (!real.startsWith(root + path.sep) || !statSync(real).isFile()) return null;
  } catch (err) {
    if (MISSING_CODES.has(err.code)) return null;
    throw err;
  }
  return real;
}
