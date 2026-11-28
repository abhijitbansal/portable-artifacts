// A take folder read for the film: only what the draft needs from take.json (the ids, verbs and box flags of the finished steps, whether
// it was signed in, which plan it was of, where it stopped). Nothing else is read; make-motion's own readTake checks the frames at render.
// A take folder that links out of the demo folder, a take.json over 8 MiB (refused by size, before it is read) or one that is not what
// take.md says is refused with { path, message }.
import fs from 'node:fs';
import path from 'node:path';
import { agentJson } from '../../shared/agent-text.mjs';
import { ID_PATTERN, VERBS } from './schema.mjs';
import { Refused, isInside } from './demo-out.mjs';

const NAME = /^take-[0-9]{1,4}$/;
const ID = new RegExp(ID_PATTERN);
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_STEPS = 200;
const ECHO_MAX = 40;

const refuse = (field, message) => new Refused({ path: `take.${field}`, message });

function realFolder(demoDir, name) {
  if (typeof name !== 'string' || !NAME.test(name)) throw refuse('name', `${agentJson(name, { max: ECHO_MAX })} is not a take folder name such as take-1`);
  const root = fs.realpathSync(demoDir);
  let dir;
  try {
    dir = fs.realpathSync(path.join(demoDir, name));
  } catch {
    throw refuse('name', `${name} is not a folder in ${demoDir}`);
  }
  if (!isInside(root, dir) || dir === root || !fs.statSync(dir).isDirectory()) throw refuse('name', `${name} is not a folder inside the demo folder`);
  return { root, dir };
}

function readTakeJson({ root, dir }) {
  let file;
  try {
    file = fs.realpathSync(path.join(dir, 'take.json'));
  } catch {
    throw refuse('json', 'take.json is missing');
  }
  if (!isInside(root, file)) throw refuse('json', 'take.json is a link out of the demo folder');
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw refuse('json', 'take.json is not a regular file');
  if (stat.size > MAX_BYTES) throw refuse('json', `take.json is ${stat.size} bytes; the limit is ${MAX_BYTES}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw refuse('json', 'take.json is not valid JSON');
  }
}

function stepOf(raw, i) {
  if (raw === null || typeof raw !== 'object') throw refuse(`steps[${i}]`, 'is not an object');
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) throw refuse(`steps[${i}].id`, `${agentJson(raw.id, { max: ECHO_MAX })} is not a step id`);
  if (!VERBS.includes(raw.do)) throw refuse(`steps[${i}].do`, `${agentJson(raw.do, { max: ECHO_MAX })} is not a step verb`);
  return { id: raw.id, do: raw.do, hasBox: raw.box !== null && typeof raw.box === 'object' };
}

function stoppedOf(stopped) {
  if (stopped === null) return null;
  if (typeof stopped !== 'object' || typeof stopped?.row !== 'string' || !ID.test(stopped.row)) throw refuse('stopped.row', 'is not a step id');
  return stopped.row;
}

/** { dir, signedIn, planKey, stoppedAt, steps: [{ id, do, hasBox }] } of `<demoDir>/<name>`; a Refused (with { path, message }) when it is not a take of this folder. */
export function readDemoTake(demoDir, name) {
  const folder = realFolder(demoDir, name);
  const raw = readTakeJson(folder);
  if (raw === null || typeof raw !== 'object' || raw.version !== 1) throw refuse('version', 'take.json is not a version 1 file');
  if (!Array.isArray(raw.steps) || raw.steps.length < 1 || raw.steps.length > MAX_STEPS) throw refuse('steps', `needs 1 to ${MAX_STEPS} steps`);
  if (typeof raw.signedIn !== 'boolean') throw refuse('signedIn', 'is not true or false');
  if (typeof raw.planKey !== 'string') throw refuse('planKey', 'is not a string');
  const stoppedAt = stoppedOf(raw.stopped ?? null);
  return { dir: path.join(demoDir, name), signedIn: raw.signedIn, planKey: raw.planKey, stoppedAt, steps: raw.steps.map(stepOf) };
}
