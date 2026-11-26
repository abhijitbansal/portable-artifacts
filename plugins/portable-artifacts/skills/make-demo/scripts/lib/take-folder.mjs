// The folder of one take: `take-<n>/` beside demo.json, n one past the highest there is.
//   takeDir(demoDir, { planKey, again, rows })  -> { dir, n, again: [row ids] }   makes the folder; throws TakeFolderRefused when it must not
// `rows` are the plan rows about to run (take-gate.mjs). Refused when:
//   - the demo folder is inside a git work tree and git would track anything a take writes (take-<n>/take.json, contact.jpg, frames/x.jpg,
//     downloads/x: each one is checked, because a pattern such as `*.json` ignores one kind only): ignore it first, with a line such as
//     `take-*/` in a .gitignore;
//   - ANY earlier take-<n>/ of this plan (same `planKey`) ran a `change` or `danger` row (take.json `ran`, or `steps` when it has no
//     `ran`), and `again` is not set: running it twice repeats what the site did. A take-<n>/ that has a frames/ folder but no take.json
//     (a take that was killed) or a take.json that cannot be read counts as having run such a row, for any plan. A folder with neither
//     (a take that was refused before it started) does not count. With `again` the plan's own change and danger row ids come back as
//     `again`, and take.json keeps them.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { agentText } from '../../shared/agent-text.mjs';

const TAKE_FOLDER = /^take-(\d+)$/;
const ROW_ECHO_MAX = 40;
const WRITTEN = ['take.json', 'contact.jpg', 'frames/x.jpg', 'downloads/x']; // one path of each kind a take writes
const changes = (entry) => entry?.effect === 'change' || entry?.effect === 'danger';

/** The take folder cannot be made, or must not be (the message says why and what to do). */
export class TakeFolderRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'TakeFolderRefused';
  }
}

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/** True when git would track something a take writes (inside a work tree, and a path not ignored, or git could not say). No git, or no work tree: false. */
function gitWouldTrack(demoDir, folder) {
  const inside = git(demoDir, ['rev-parse', '--is-inside-work-tree']);
  if (inside.error || inside.status !== 0 || inside.stdout.trim() !== 'true') return false;
  // 0 means ignored; 1 not ignored; 128 git could not say. One call per path: with several, `-q` exits 0 when any one is ignored.
  return WRITTEN.some((file) => git(demoDir, ['check-ignore', '-q', path.join(folder, file)]).status !== 0);
}

const takeNumbers = (demoDir) => fs.readdirSync(demoDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && TAKE_FOLDER.test(entry.name))
  .map((entry) => Number(TAKE_FOLDER.exec(entry.name)[1]))
  .sort((a, b) => a - b);

/** Did take-<n> (possibly) change something on the site that a take of `planKey` would repeat? */
function mayHaveChanged(demoDir, n, planKey) {
  const folder = path.join(demoDir, `take-${n}`);
  const file = path.join(folder, 'take.json');
  if (!fs.existsSync(file)) return fs.existsSync(path.join(folder, 'frames')); // no take.json but frames: it began, and died
  let take;
  try {
    take = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return true;
  }
  if (take?.planKey !== planKey) return false;
  const list = Array.isArray(take.ran) ? take.ran : take.steps;
  return Array.isArray(list) && list.some(changes);
}

const echoRows = (ids) => ids.map((id) => agentText(String(id), { max: ROW_ECHO_MAX })).join(', ');

/** The plan's change and danger row ids that run again; throws unless `again` when an earlier take may have run them. */
function againRule(demoDir, numbers, { planKey, again, rows }) {
  const earlier = numbers.filter((n) => mayHaveChanged(demoDir, n, planKey));
  if (earlier.length === 0) return [];
  const ids = rows.filter(changes).map((row) => row.id);
  if (!again) {
    const named = earlier.map((n) => `take-${n}`).join(', ');
    throw new TakeFolderRefused(`${named} already took this plan, or may have (a take that died, or whose take.json cannot be read, is not known to have stopped before a row that changes something); rows that change something (${echoRows(ids)}) would run again. Ask the user, then pass --again`);
  }
  return ids;
}

/** Make and return the next take folder. `planKey` is `demo-<hash>` of the plan being taken; `rows` are its rows. */
export function takeDir(demoDir, { planKey, again = false, rows = [] } = {}) {
  if (typeof planKey !== 'string' || planKey === '') throw new TypeError('takeDir needs the planKey of the plan being taken');
  const base = path.resolve(demoDir);
  const numbers = takeNumbers(base);
  const ids = againRule(base, numbers, { planKey, again, rows });
  const n = (numbers.length === 0 ? 0 : numbers.at(-1)) + 1;
  const dir = path.join(base, `take-${n}`);
  if (gitWouldTrack(base, dir)) {
    throw new TakeFolderRefused(`git would track what ${path.basename(dir)}/ holds (pictures of the site); ignore it first, for example add the line take-*/ to a .gitignore`);
  }
  fs.mkdirSync(dir);
  return { dir, n, again: ids };
}
