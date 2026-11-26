// The take folder: numbered, never tracked by git, and a second take of a plan that changed something needs --again.
// Each test makes its own temporary folder (and a temporary git repo where git is the point); no browser, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { takeDir, TakeFolderRefused } from '../scripts/lib/take-folder.mjs';

const made = [];
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-take-folder-'));
  made.push(dir);
  return dir;
}
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

function repo(ignore) {
  const dir = tempDir();
  const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  if (ignore !== undefined) fs.writeFileSync(path.join(dir, '.gitignore'), ignore);
  return dir;
}

const KEY = 'demo-0123456789ab';
const options = (extra = {}) => ({ planKey: KEY, ...extra });
const step = (id, effect) => ({ id, do: 'click', effect });
const writeTake = (demo, n, take) => {
  fs.mkdirSync(path.join(demo, `take-${n}`), { recursive: true });
  fs.writeFileSync(path.join(demo, `take-${n}`, 'take.json'), JSON.stringify(take));
};

test('outside a git work tree the folders are take-1, take-2, ... beside demo.json, and they exist', () => {
  const demo = tempDir();
  const first = takeDir(demo, options());
  assert.deepEqual(first, { dir: path.join(demo, 'take-1'), n: 1, again: [] });
  assert.ok(fs.statSync(first.dir).isDirectory());
  const second = takeDir(demo, options());
  assert.equal(second.n, 2);
  assert.equal(second.dir, path.join(demo, 'take-2'));
});

test('n is one past the highest, not a count: take-3 and a stray file leave take-4', () => {
  const demo = tempDir();
  fs.mkdirSync(path.join(demo, 'take-3'));
  fs.writeFileSync(path.join(demo, 'take-9.txt'), 'not a folder');
  fs.mkdirSync(path.join(demo, 'take-x'));
  assert.equal(takeDir(demo, options()).n, 4);
});

test('in a git work tree a take folder that git would track is refused, and nothing is made', () => {
  const demo = repo();
  assert.throws(() => takeDir(demo, options()), (error) => error instanceof TakeFolderRefused && /git/.test(error.message) && /ignore/.test(error.message));
  assert.deepEqual(fs.readdirSync(demo).filter((name) => name.startsWith('take-')), []);
});

test('an ignored take folder is take-1, then take-2', () => {
  const demo = repo('take-*/\n');
  assert.equal(takeDir(demo, options()).n, 1);
  assert.equal(takeDir(demo, options()).n, 2);
});

test('a demo folder deeper in the repo, ignored by a pattern of the repo root, works the same', () => {
  const root = repo('.scratch/\n');
  const demo = path.join(root, '.scratch', 'demos', 'one');
  fs.mkdirSync(demo, { recursive: true });
  assert.equal(takeDir(demo, options()).n, 1);
});

test('only take-1 ignored: take-1 is made and take-2 is refused', () => {
  const demo = repo('/take-1/\n');
  assert.equal(takeDir(demo, options()).n, 1);
  assert.throws(() => takeDir(demo, options()), TakeFolderRefused);
});

const PLAN_ROWS = [step('open', 'look'), step('save', 'change'), step('wipe', 'danger')]; // the rows of the plan being taken
const refusedFor = (take) => (error) => error instanceof TakeFolderRefused && /--again/.test(error.message) && (take === undefined || error.message.includes(`take-${take}`));
const frameless = (demo, n) => fs.mkdirSync(path.join(demo, `take-${n}`, 'frames'), { recursive: true });

test('a second take of a plan that ran a change row is refused until again, and again names the rows of the plan that run twice', () => {
  const demo = tempDir();
  writeTake(demo, 1, { planKey: KEY, steps: [step('open', 'look'), step('save', 'change'), step('wipe', 'danger')] });
  assert.throws(() => takeDir(demo, options({ rows: PLAN_ROWS })), (error) => refusedFor(1)(error) && /save/.test(error.message) && /wipe/.test(error.message));
  assert.deepEqual(fs.readdirSync(demo), ['take-1'], 'a refusal makes no folder');
  const again = takeDir(demo, options({ again: true, rows: PLAN_ROWS }));
  assert.equal(again.n, 2);
  assert.deepEqual(again.again, ['save', 'wipe']);
});

test('a previous take of the same plan that ran only look rows needs no again', () => {
  const demo = tempDir();
  writeTake(demo, 1, { planKey: KEY, steps: [step('open', 'look'), step('hover', 'look')] });
  assert.deepEqual(takeDir(demo, options({ rows: PLAN_ROWS })).again, []);
});

test('a previous take of another plan, or a bare folder (no take.json, no frames), needs no again', () => {
  const other = tempDir();
  writeTake(other, 1, { planKey: 'demo-aaaaaaaaaaaa', steps: [step('save', 'change')] });
  assert.equal(takeDir(other, options({ rows: PLAN_ROWS })).n, 2);
  const bare = tempDir();
  fs.mkdirSync(path.join(bare, 'take-1'));
  assert.equal(takeDir(bare, options({ rows: PLAN_ROWS })).n, 2);
});

test('a killed take (frames/ but no take.json) counts as a take that ran a change row, for any plan', () => {
  const demo = tempDir();
  frameless(demo, 1);
  assert.throws(() => takeDir(demo, options({ rows: PLAN_ROWS })), (error) => refusedFor(1)(error) && /save/.test(error.message));
  assert.deepEqual(fs.readdirSync(demo), ['take-1'], 'a refusal makes no folder');
  const again = takeDir(demo, options({ again: true, rows: PLAN_ROWS }));
  assert.deepEqual([again.n, again.again], [2, ['save', 'wipe']]);
});

test('a bare folder made after a take (a refused take) does not hide that take: every earlier take.json counts', () => {
  const demo = tempDir();
  writeTake(demo, 1, { planKey: KEY, steps: [step('save', 'change')] });
  fs.mkdirSync(path.join(demo, 'take-2'));
  assert.throws(() => takeDir(demo, options({ rows: PLAN_ROWS })), refusedFor(1));
  const again = takeDir(demo, options({ again: true, rows: PLAN_ROWS }));
  assert.equal(again.n, 3);
  assert.deepEqual(again.again, ['save', 'wipe']);
});

test('every earlier take counts, not the newest: take-1 ran a change row, then take-2 of the same plan ran none, and take-3 is refused', () => {
  const demo = tempDir();
  writeTake(demo, 1, { planKey: KEY, steps: [step('save', 'change')] });
  writeTake(demo, 2, { planKey: KEY, steps: [step('open', 'look')] });
  assert.throws(() => takeDir(demo, options({ rows: PLAN_ROWS })), refusedFor(1));
  writeTake(demo, 3, { planKey: KEY, steps: [], ran: [], stopped: { row: 'open', reason: 'no match' } });
  assert.throws(() => takeDir(demo, options({ rows: PLAN_ROWS })), refusedFor(1), 'an empty take in between does not hide it either');
});

test('a take of another plan in between does not hide the earlier take of this plan', () => {
  const demo = tempDir();
  writeTake(demo, 1, { planKey: KEY, steps: [step('wipe', 'danger')] });
  writeTake(demo, 2, { planKey: 'demo-aaaaaaaaaaaa', steps: [step('open', 'look')] });
  assert.throws(() => takeDir(demo, options({ rows: PLAN_ROWS })), refusedFor(1));
});

test('ran decides when it is there: a row cut off after its act began (in ran, not in steps) needs again', () => {
  const demo = tempDir();
  writeTake(demo, 1, { planKey: KEY, steps: [step('open', 'look')], ran: [{ id: 'open', effect: 'look' }, { id: 'wipe', effect: 'danger' }], stopped: { row: 'wipe', reason: 'film time cap' } });
  assert.throws(() => takeDir(demo, options({ rows: PLAN_ROWS })), refusedFor(1));
  const looked = tempDir();
  writeTake(looked, 1, { planKey: KEY, steps: [step('save', 'change')], ran: [{ id: 'open', effect: 'look' }] });
  assert.equal(takeDir(looked, options({ rows: PLAN_ROWS })).n, 2, 'ran, when present, is the record');
});

test('a take.json that cannot be read is refused like one that ran a change row', () => {
  const demo = tempDir();
  fs.mkdirSync(path.join(demo, 'take-1'));
  fs.writeFileSync(path.join(demo, 'take-1', 'take.json'), '{ not json');
  assert.throws(() => takeDir(demo, options({ rows: PLAN_ROWS })), TakeFolderRefused);
  assert.equal(takeDir(demo, options({ again: true, rows: PLAN_ROWS })).n, 2);
});

test('the row ids in a refusal go through agentText', () => {
  const demo = tempDir();
  writeTake(demo, 1, { planKey: KEY, steps: [step('save', 'change')] });
  assert.throws(() => takeDir(demo, options({ rows: [step('a\nb', 'change')] })), (error) => !error.message.includes('\n') && error.message.includes('\\u{000a}'));
});

test('git: a .gitignore that ignores only take.json is refused, because the frames, the sheet and the downloads would be tracked', () => {
  const only = repo('*.json\n');
  assert.throws(() => takeDir(only, options()), (error) => error instanceof TakeFolderRefused && /git/.test(error.message));
  const partial = repo('take-*/take.json\ntake-*/contact.jpg\ntake-*/frames/\n');
  assert.throws(() => takeDir(partial, options()), TakeFolderRefused, 'downloads/ is not ignored');
  assert.deepEqual(fs.readdirSync(partial).filter((name) => name.startsWith('take-')), []);
});

test('a plan key is required: without one the again rule could not be applied', () => {
  assert.throws(() => takeDir(tempDir(), {}), TypeError);
});
