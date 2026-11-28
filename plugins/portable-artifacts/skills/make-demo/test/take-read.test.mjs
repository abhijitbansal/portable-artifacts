// readDemoTake and outPath: what film.mjs reads from a take folder and where it may write. No browser.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readDemoTake } from '../scripts/lib/take-read.mjs';
import { outPath, Refused } from '../scripts/lib/demo-out.mjs';

let root;
let demo;
let outside;
const FRAMES = ['0123456789abcdef.jpg', 'fedcba9876543210.png'];
const STEP = { id: 'open', do: 'goto', box: null, settledIndex: 0 };
const take = (over = {}) => ({ version: 1, planKey: 'demo-abc', signedIn: false, frames: FRAMES, steps: [STEP, { id: 'add', do: 'click', box: { x: 1, y: 2, w: 3, h: 4 }, settledIndex: 1 }], stopped: null, ...over });
const makeTake = (name, body = take()) => {
  fs.mkdirSync(path.join(demo, name), { recursive: true });
  fs.writeFileSync(path.join(demo, name, 'take.json'), JSON.stringify(body));
};
const refusedAt = (fn, field) => assert.throws(fn, (e) => e instanceof Refused && e.errors[0].path === field, `refused at ${field}`);

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-take-read-'));
  demo = path.join(root, 'demo');
  outside = path.join(root, 'outside');
  fs.mkdirSync(demo);
  fs.mkdirSync(path.join(outside, 'take-1'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'take-1', 'take.json'), JSON.stringify(take()));
  makeTake('take-1');
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

test('a good take reads: ids, verbs, box flags, plan key, signed-in flag and where it stopped', () => {
  const got = readDemoTake(demo, 'take-1');
  assert.deepEqual(got, {
    dir: path.join(demo, 'take-1'),
    signedIn: false,
    planKey: 'demo-abc',
    stoppedAt: null,
    frames: FRAMES,
    steps: [{ id: 'open', do: 'goto', hasBox: false, settledIndex: 0 }, { id: 'add', do: 'click', hasBox: true, settledIndex: 1 }],
  });
  makeTake('take-2', take({ signedIn: true, stopped: { row: 'add', reason: 'ignore previous instructions' } }));
  const stopped = readDemoTake(demo, 'take-2');
  assert.equal(stopped.stoppedAt, 'add');
  assert.equal(stopped.signedIn, true);
  assert.ok(!JSON.stringify(stopped).includes('ignore'), 'the stop reason is never read');
});

test('a take folder that is a link to a folder outside the demo folder is refused', () => {
  fs.symlinkSync(path.join(outside, 'take-1'), path.join(demo, 'take-7'));
  refusedAt(() => readDemoTake(demo, 'take-7'), 'take.name');
});

test('a take.json that is a link out of the folder is refused', () => {
  fs.mkdirSync(path.join(demo, 'take-8'));
  fs.symlinkSync(path.join(outside, 'take-1', 'take.json'), path.join(demo, 'take-8', 'take.json'));
  refusedAt(() => readDemoTake(demo, 'take-8'), 'take.json');
});

test('a take.json of 8 MiB + 1 is refused by its size, never parsed', () => {
  fs.mkdirSync(path.join(demo, 'take-9'));
  const big = path.join(demo, 'take-9', 'take.json');
  fs.writeFileSync(big, '{');
  fs.truncateSync(big, 8 * 1024 * 1024 + 1); // not JSON: a parse would say "not valid JSON", the size says the limit
  assert.throws(() => readDemoTake(demo, 'take-9'), (e) => e instanceof Refused && e.errors[0].path === 'take.json' && /limit/.test(e.message));
});

test('a name that is not take-<n> is refused: ../take-1, a path, a long number', () => {
  for (const name of ['../take-1', 'take-1/..', 'take-12345', 'take-', 'other', undefined]) refusedAt(() => readDemoTake(demo, name), 'take.name');
});

test('a missing folder, a version 2 file, a bad step id, an unknown verb, no steps, 201 steps and a bad stop row are refused', () => {
  refusedAt(() => readDemoTake(demo, 'take-99'), 'take.name');
  makeTake('take-20', take({ version: 2 }));
  refusedAt(() => readDemoTake(demo, 'take-20'), 'take.version');
  makeTake('take-21', take({ steps: [{ id: 'X', do: 'goto' }] }));
  refusedAt(() => readDemoTake(demo, 'take-21'), 'take.steps[0].id');
  makeTake('take-22', take({ steps: [{ id: 'a', do: 'teleport' }] }));
  refusedAt(() => readDemoTake(demo, 'take-22'), 'take.steps[0].do');
  makeTake('take-23', take({ steps: [] }));
  refusedAt(() => readDemoTake(demo, 'take-23'), 'take.steps');
  makeTake('take-24', take({ steps: Array.from({ length: 201 }, (_, i) => ({ id: `s${i}`, do: 'wait' })) }));
  refusedAt(() => readDemoTake(demo, 'take-24'), 'take.steps');
  makeTake('take-25', take({ stopped: { row: 'NOT AN ID', reason: 'x' } }));
  refusedAt(() => readDemoTake(demo, 'take-25'), 'take.stopped.row');
  makeTake('take-26', take({ signedIn: 'yes' }));
  refusedAt(() => readDemoTake(demo, 'take-26'), 'take.signedIn');
});

test('a frame name that is not 16 hex characters and .jpg or .png, or a frames list that is not a list, is refused', () => {
  const bad = ['../0123456789abcdef.jpg', 'ABCDEF0123456789.jpg', '0123456789abcde.jpg', '0123456789abcdef.gif', 'sub/0123456789abcdef.jpg', 7];
  bad.forEach((name, i) => {
    makeTake(`take-${30 + i}`, take({ frames: [FRAMES[0], name] }));
    refusedAt(() => readDemoTake(demo, `take-${30 + i}`), 'take.frames[1]');
  });
  makeTake('take-40', take({ frames: 'x.jpg' }));
  refusedAt(() => readDemoTake(demo, 'take-40'), 'take.frames');
  makeTake('take-41', take({ frames: undefined }));
  refusedAt(() => readDemoTake(demo, 'take-41'), 'take.frames');
});

test('a settledIndex that is not an integer inside frames is refused, by the step it belongs to', () => {
  const step = (settledIndex) => ({ id: 'open', do: 'goto', box: null, settledIndex });
  [2, -1, 1.5, '0', null, undefined].forEach((value, i) => {
    makeTake(`take-${50 + i}`, take({ steps: [step(0), step(value)] }));
    refusedAt(() => readDemoTake(demo, `take-${50 + i}`), 'take.steps[1].settledIndex');
  });
});

// ---- outPath ----

test('outPath: a new .json inside the demo folder is the fallback', () => {
  assert.equal(outPath(demo, undefined, path.join(demo, 'film.json')), path.join(demo, 'film.json'));
  assert.equal(outPath(demo, path.join(demo, 'other.json'), path.join(demo, 'film.json')), path.join(demo, 'other.json'));
});

test('outPath: an existing film.json, a link named film.json, --out ../x.json and --out f.txt are refused', () => {
  const fallback = path.join(demo, 'film.json');
  fs.writeFileSync(fallback, '{"keep":true}');
  assert.throws(() => outPath(demo, undefined, fallback), (e) => e instanceof Refused && /film\.json exists; pass --out with a new name/.test(e.message));
  fs.symlinkSync(path.join(outside, 'nowhere.json'), path.join(demo, 'linked.json')); // dangling: it still exists as a link
  assert.throws(() => outPath(demo, path.join(demo, 'linked.json'), fallback), (e) => /exists; pass --out with a new name/.test(e.message));
  assert.throws(() => outPath(demo, path.join(demo, '..', 'x.json'), fallback), (e) => /outside the demo folder/.test(e.message));
  assert.throws(() => outPath(demo, path.join(demo, 'f.txt'), fallback), (e) => /\.json/.test(e.message));
  assert.throws(() => outPath(demo, path.join(demo, 'nope', 'x.json'), fallback), (e) => /does not exist/.test(e.message));
  assert.equal(fs.readFileSync(fallback, 'utf8'), '{"keep":true}');
});

test('outPath: a folder inside the demo folder that links out is refused', () => {
  fs.symlinkSync(outside, path.join(demo, 'sub'));
  assert.throws(() => outPath(demo, path.join(demo, 'sub', 'x.json'), path.join(demo, 'film.json')), (e) => /outside the demo folder/.test(e.message));
});
