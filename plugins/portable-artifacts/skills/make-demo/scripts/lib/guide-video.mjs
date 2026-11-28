// The film the guide plays: an existing regular .mp4 inside the demo folder (by realpath, so a link out is outside), at most 50 MB
// (make-explainer's limit). It is named in guide.json by its path relative to the demo folder, with `/` as the separator.
import fs from 'node:fs';
import path from 'node:path';
import { Refused, isInside } from './demo-out.mjs';

export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;
const MB = 1024 * 1024;

const refuse = (message) => new Refused({ path: 'video', message });

/** The path of `wanted` (against the working folder) relative to `demoDir`; a Refused (path `video`) when it is not such a file. */
export function videoRef(demoDir, wanted) {
  const given = path.resolve(wanted);
  let real;
  try {
    real = fs.realpathSync(given);
  } catch {
    throw refuse(`${given} does not exist; pass --video with the film's .mp4, inside the demo folder`);
  }
  const root = fs.realpathSync(demoDir);
  if (!isInside(root, real) || real === root) throw refuse(`${given} is outside the demo folder ${demoDir}; put the film inside it and pass that path`);
  const stat = fs.statSync(real);
  if (!stat.isFile()) throw refuse(`${given} is not a regular file`);
  if (path.extname(real) !== '.mp4') throw refuse(`${path.basename(real)} is not an .mp4 file; pass --video with the film's .mp4`);
  if (stat.size > VIDEO_MAX_BYTES) throw refuse(`${path.basename(real)} is ${(stat.size / MB).toFixed(1)} MB; the limit is ${VIDEO_MAX_BYTES / MB} MB`);
  return path.relative(root, real).split(path.sep).join('/');
}
