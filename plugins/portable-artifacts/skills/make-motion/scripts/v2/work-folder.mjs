// The private folder a render makes its video in (beside the output), and the sweep of what a killed render left.
//
// A work folder is `.pa-XXXXXX` (mkdtemp: a random name, mode 0700) holding the two video files and an owner marker: the pid of the
// render, its host and a random token. The sweep removes a folder only when it can prove it is a dead render's: the marker is
// valid, names this host, its process has ended, the folder is ours (same user) and holds nothing but the marker and the two video
// files, and nothing in it was written for an hour. A folder with no marker, an empty one, another user's, or a live render's is
// never touched. The sweep never fails a render: an entry it cannot read or remove (a race with another run, another user's
// folder) is skipped. The cutout's `clip.webm` folder is not swept (see CHANGELOG).
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { assertContained } from '../../shared/write-file.mjs';
import { pidAlive } from './pid-alive.mjs';

const PARTIAL_MAX_AGE_MS = 60 * 60 * 1000;
const PARTIAL_RE = /^\..+\.partial-\d+\.mp4$/; // the partial file of an older run
const WORK_PREFIX = '.pa-';
const WORK_RE = /^\.pa-[A-Za-z0-9]{6}$/; // what mkdtempSync makes of WORK_PREFIX
export const WORK_FILES = ['video.mp4', 'voice.mp4'];
export const WORK_OWNER_FILE = 'owner.json';
const OWNER_TOKEN_BYTES = 16;
const OWNER_TOKEN_RE = /^[0-9a-f]{32}$/;
const OWNER_MAX_BYTES = 1024;

/** A new private work folder in `dir`, marked as this process's. Returns its path. */
export function makeWorkFolder(dir) {
  const folder = mkdtempSync(path.join(dir, WORK_PREFIX));
  const owner = { pid: process.pid, host: hostname(), token: randomBytes(OWNER_TOKEN_BYTES).toString('hex') };
  try {
    writeFileSync(path.join(folder, WORK_OWNER_FILE), JSON.stringify(owner), { flag: 'wx' });
  } catch (e) {
    rmSync(folder, { recursive: true, force: true });
    throw e;
  }
  return folder;
}

// The marker of a work folder, or null when it is missing, not a plain file, too big or not what makeWorkFolder writes.
function readOwner(folder) {
  const file = path.join(folder, WORK_OWNER_FILE);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.size > OWNER_MAX_BYTES) return null;
  const owner = JSON.parse(readFileSync(file, 'utf8'));
  const valid = Number.isInteger(owner?.pid) && owner.pid > 0 && typeof owner.host === 'string' && OWNER_TOKEN_RE.test(owner.token);
  return valid ? owner : null;
}

const isOurs = (stat) => process.getuid === undefined || stat.uid === process.getuid();

// Whether `folder` is provably a dead render's work folder that nothing has written to since `now - olderThanMs`.
function isDeadWork(folder, olderThanMs, now) {
  const stat = lstatSync(folder);
  if (!stat.isDirectory() || !isOurs(stat)) return false;
  const owner = readOwner(folder);
  if (owner === null || owner.host !== hostname() || pidAlive(owner.pid)) return false;
  const files = readdirSync(folder).map((name) => ({ name, stat: lstatSync(path.join(folder, name)) }));
  if (!files.every((f) => f.stat.isFile() && (WORK_FILES.includes(f.name) || f.name === WORK_OWNER_FILE))) return false;
  return now - Math.max(stat.mtimeMs, ...files.map((f) => f.stat.mtimeMs)) > olderThanMs;
}

// Whether `entry` is an older run's partial file (a plain file, never a link or a folder) that is old enough to go.
function isOldPartial(entry, olderThanMs, now) {
  const stat = lstatSync(entry);
  return stat.isFile() && now - stat.mtimeMs > olderThanMs;
}

/**
 * Remove what a killed render left in `dir`: its work folder (see the header) and the `.<name>.partial-<pid>.mp4` file of an older
 * run, once they are an hour old. Returns the names removed. Nothing is looked at, let alone removed, when `dir` leads out of the
 * repository by a link. An entry that cannot be read or removed is skipped, never an error.
 */
export function sweepPartials(dir, { olderThanMs = PARTIAL_MAX_AGE_MS, now = Date.now() } = {}) {
  assertContained(dir);
  if (!existsSync(dir)) return [];
  const removed = [];
  for (const name of readdirSync(dir)) {
    const entry = path.join(dir, name);
    try {
      const isWork = WORK_RE.test(name);
      if (!isWork && !PARTIAL_RE.test(name)) continue;
      if (!(isWork ? isDeadWork(entry, olderThanMs, now) : isOldPartial(entry, olderThanMs, now))) continue;
      rmSync(entry, { recursive: isWork, force: true });
      removed.push(name);
    } catch {
      // gone already (another run), unreadable (another user's), or a marker that is not JSON: not ours to judge
    }
  }
  return removed;
}
