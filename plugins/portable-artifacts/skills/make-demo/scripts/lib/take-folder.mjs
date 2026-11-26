// The folder of one take: `take-<n>/` beside demo.json, n one past the highest there is.
//   takeDir(demoDir, { planKey, again })  -> { dir, n, again: [row ids] }   makes the folder; throws TakeFolderRefused when it must not
// Refused when:
//   - the demo folder is inside a git work tree and git would track the take folder (a take holds pictures of the site, so it is never
//     committed by accident): ignore it first, with a line such as `take-*/` in a .gitignore;
//   - the newest take-<n>/take.json (a folder with none, made by a take that was refused or died, is passed over) is a take of this plan (same `planKey`) that ran a `change` or `danger` row, and `again` is not set:
//     running it twice repeats what the site did. With `again` the rows that run twice come back as `again`, and take.json keeps them.
//     A last take.json that cannot be read counts as one that ran such a row.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { agentText } from '../../shared/agent-text.mjs';

const TAKE_FOLDER = /^take-(\d+)$/;
const ROW_ECHO_MAX = 40;

/** The take folder cannot be made, or must not be (the message says why and what to do). */
export class TakeFolderRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'TakeFolderRefused';
  }
}

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

/** True when git would track `folder` (inside a work tree, and not ignored, or git could not say). No git, or no work tree: false. */
function gitWouldTrack(demoDir, folder) {
  const inside = git(demoDir, ['rev-parse', '--is-inside-work-tree']);
  if (inside.error || inside.status !== 0 || inside.stdout.trim() !== 'true') return false;
  return git(demoDir, ['check-ignore', '-q', path.join(folder, 'take.json')]).status !== 0; // 0 means ignored; 1 not ignored; 128 git could not say
}

const takeNumbers = (demoDir) => fs.readdirSync(demoDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && TAKE_FOLDER.test(entry.name))
  .map((entry) => Number(TAKE_FOLDER.exec(entry.name)[1]));

/** The newest take number whose folder holds a take.json (a folder made by a take that was refused or died has none), or null. */
function lastWithTake(demoDir, numbers) {
  const done = numbers.filter((n) => fs.existsSync(path.join(demoDir, `take-${n}`, 'take.json')));
  return done.length === 0 ? null : Math.max(...done);
}

/** The ids of the rows take-<last> ran that change something: [] for a take of another plan; null when take.json does not parse. */
function ranTwice(demoDir, last, planKey) {
  let take;
  try {
    take = JSON.parse(fs.readFileSync(path.join(demoDir, `take-${last}`, 'take.json'), 'utf8'));
  } catch {
    return null;
  }
  if (take?.planKey !== planKey) return [];
  return (Array.isArray(take.steps) ? take.steps : []).filter((s) => s?.effect === 'change' || s?.effect === 'danger').map((s) => String(s.id));
}

const echoRows = (ids) => ids.map((id) => agentText(id, { max: ROW_ECHO_MAX })).join(', ');

function againRule(demoDir, numbers, { planKey, again }) {
  const last = lastWithTake(demoDir, numbers);
  if (last === null) return [];
  const rows = ranTwice(demoDir, last, planKey);
  if (rows === null) {
    if (!again) throw new TakeFolderRefused(`take-${last}/take.json cannot be read, so it is not known whether it ran a row that changes something; ask the user, then pass --again`);
    return [];
  }
  if (rows.length > 0 && !again) {
    throw new TakeFolderRefused(`take-${last} already took this plan and ran rows that change something (${echoRows(rows)}); a second take repeats them. Ask the user, then pass --again`);
  }
  return rows;
}

/** Make and return the next take folder. `planKey` is `demo-<hash>` of the plan being taken. */
export function takeDir(demoDir, { planKey, again = false } = {}) {
  if (typeof planKey !== 'string' || planKey === '') throw new TypeError('takeDir needs the planKey of the plan being taken');
  const base = path.resolve(demoDir);
  const numbers = takeNumbers(base);
  const rows = againRule(base, numbers, { planKey, again });
  const n = (numbers.length === 0 ? 0 : Math.max(...numbers)) + 1;
  const dir = path.join(base, `take-${n}`);
  if (gitWouldTrack(base, dir)) {
    throw new TakeFolderRefused(`git would track ${path.basename(dir)}/ (pictures of the site); ignore it first, for example add the line take-*/ to a .gitignore`);
  }
  fs.mkdirSync(dir);
  return { dir, n, again: rows };
}
