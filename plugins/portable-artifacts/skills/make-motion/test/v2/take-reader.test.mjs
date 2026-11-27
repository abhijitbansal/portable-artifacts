// The take reader (scripts/v2/take.mjs): a take folder is untrusted input, so every rule of the phase-3 claim 2 has a test
// here, on synthetic takes in OS temp folders (helpers/synthetic-take.mjs) with no browser. Each refusal is a SpecError
// at `shots[<i>].src` whose message names the take field that broke.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpecError } from '../../scripts/v2/spec.mjs';
import { readTake, TAKE_JSON_MAX, MAX_FRAMES, MAX_STEPS } from '../../scripts/v2/take.mjs';
import { prepareWalk } from '../../scripts/v2/prepare/walk.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { filmOf } from './helpers/kinds.mjs';
import { makeFilmDir, writeSyntheticTake, frameName, solidPng, minimalJpeg, SIDE } from './helpers/synthetic-take.mjs';

const EXAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../references/examples/v2');
const OWNER = 'shots[2]';
const dirs = [];
const newDir = () => {
  const dir = makeFilmDir();
  dirs.push(dir);
  return dir;
};
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

// A film folder holding the synthetic take at `take/`, after `edit(take, pngs)`.
const takeIn = (edit) => {
  const specDir = newDir();
  return { specDir, ...writeSyntheticTake(specDir, { edit }) };
};
const read = (specDir, src = 'take') => readTake(specDir, src, { owner: OWNER });

// The read is refused with a SpecError at shots[2].src whose message matches `field`.
function refuses(fn, field) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof SpecError, `expected a SpecError, got ${err?.stack ?? err}`);
    assert.equal(err.errors.length, 1);
    assert.equal(err.errors[0].path, `${OWNER}.src`);
    assert.match(err.errors[0].message, field);
    return true;
  });
}
const refusesEdit = (edit, field) => {
  const { specDir } = takeIn(edit);
  refuses(() => read(specDir), field);
};
const stepEdit = (n, change) => (take) => Object.assign(take.steps[n], change);

// ---- a good take ----

test('a good take reads: names, 0-based step indexes, size and signedIn', () => {
  const { specDir, takeDir } = takeIn();
  const take = read(specDir);
  assert.equal(take.src, 'take');
  assert.equal(take.dir, takeDir);
  assert.equal(take.framesDir, path.join(takeDir, 'frames'));
  assert.equal(take.names.length, 12);
  assert.equal(take.names[0], frameName(0));
  assert.equal(take.fps, 30);
  assert.deepEqual(take.viewport, { width: SIDE, height: SIDE });
  assert.deepEqual([take.scale, take.width, take.height, take.signedIn], [1, SIDE, SIDE, false]);
  assert.deepEqual(take.steps.map((s) => [s.id, s.do, s.startIndex, s.actIndex, s.settledIndex]),
    [['open', 'goto', 0, 0, 2], ['tab', 'click', 2, 4, 7], ['search', 'type', 7, 8, 11]]);
  assert.deepEqual(take.steps[1].pointer, { x: 100, y: 120 });
  assert.deepEqual(take.steps[1].box, { x: 80, y: 100, width: 60, height: 40 });
  assert.equal(take.steps[0].box, null);
  assert.equal(take.steps[2].textPx, 13.5);
});

test('a missing textPx reads as null and a signed-in take says so', () => {
  const { specDir } = takeIn((take) => { delete take.steps[1].textPx; take.signedIn = true; });
  const take = read(specDir);
  assert.equal(take.steps[1].textPx, null);
  assert.equal(take.signedIn, true);
});

test('a take scaled 2x reads when its frames are 2x the viewport; JPEG frames read by their SOF header', () => {
  const { specDir } = takeIn((take, pngs) => {
    take.scale = 2;
    take.frames = take.frames.map((n) => n.replace('.png', '.jpg'));
    pngs.clear();
    for (const name of new Set(take.frames)) pngs.set(name, minimalJpeg(SIDE * 2, SIDE * 2));
  });
  assert.deepEqual([read(specDir).width, read(specDir).height], [SIDE * 2, SIDE * 2]);
});

test('a settledIndex later than settleFrame - 1 but not before actFrame - 1 is the take\'s own rule, and reads', () => {
  const { specDir } = takeIn(stepEdit(2, { settledIndex: 10 }));
  assert.equal(read(specDir).steps[2].settledIndex, 10);
});

test('the committed walk-take reads clean', () => {
  const take = readTake(EXAMPLES, 'walk-take', { owner: 'shots[0]' });
  assert.equal(take.steps.length, 5);
  assert.equal(take.names.length, 207);
  assert.equal(new Set(take.names).size, 14);
  assert.deepEqual([take.width, take.height, take.signedIn], [2880, 1620, false]);
  assert.deepEqual([take.steps[0].startIndex, take.steps[0].settledIndex, take.steps[1].startIndex], [0, 30, 30]);
});

// ---- check 1: src and take.json ----

test('src: an absolute path, "../x", a NUL, an empty or non-string src, and a missing folder are refused', () => {
  const { specDir } = takeIn();
  refuses(() => read(specDir, path.join(specDir, 'take')), /relative/);
  const sibling = newDir(); // a real take folder next to the film's folder, reached by "../"
  writeSyntheticTake(sibling);
  refuses(() => read(specDir, `../${path.basename(sibling)}/take`), /not a folder inside the film's folder/);
  refuses(() => read(specDir, '../take'), /inside the film's folder/);
  refuses(() => read(specDir, 'take\0x'), /NUL/);
  refuses(() => read(specDir, ''), /non-empty/);
  refuses(() => read(specDir, 7), /non-empty/);
  refuses(() => read(specDir, 'nope'), /not a folder inside the film's folder/);
});

test('src: a link to a take folder outside the film folder is refused', () => {
  const outside = newDir();
  writeSyntheticTake(outside);
  const specDir = newDir();
  symlinkSync(path.join(outside, 'take'), path.join(specDir, 'linked'));
  refuses(() => read(specDir, 'linked'), /inside the film's folder/);
});

test('take.json: a link to a file outside the take folder is refused', () => {
  const outside = newDir();
  const other = writeSyntheticTake(outside);
  const { specDir, takeDir } = takeIn();
  rmSync(path.join(takeDir, 'take.json'));
  symlinkSync(path.join(other.takeDir, 'take.json'), path.join(takeDir, 'take.json'));
  refuses(() => read(specDir), /take\.json is not a file inside the take folder/);
});

test('take.json: missing and not JSON are refused', () => {
  const { specDir, takeDir } = takeIn();
  writeFileSync(path.join(takeDir, 'take.json'), '{"version": 1, "frames": [');
  refuses(() => read(specDir), /take\.json is not valid JSON/);
  rmSync(path.join(takeDir, 'take.json'));
  refuses(() => read(specDir), /take\.json is not a file inside the take folder/);
});

test('take.json that is a link loop, or has no read permission, is refused as a SpecError with its code and no path', () => {
  const loop = takeIn();
  rmSync(path.join(loop.takeDir, 'take.json'));
  symlinkSync(path.join(loop.takeDir, 'loop2'), path.join(loop.takeDir, 'take.json'));
  symlinkSync(path.join(loop.takeDir, 'take.json'), path.join(loop.takeDir, 'loop2'));
  refuses(() => read(loop.specDir), /^take\.json cannot be read \(ELOOP\)$/);
  const locked = takeIn();
  chmodSync(path.join(locked.takeDir, 'take.json'), 0o000);
  try {
    refuses(() => read(locked.specDir), /^take\.json cannot be read \(EACCES\)$/);
  } finally {
    chmodSync(path.join(locked.takeDir, 'take.json'), 0o644);
  }
});

test('a take folder or frames/ that cannot be searched is refused as a SpecError, not a raw error', () => {
  const closed = takeIn();
  chmodSync(closed.takeDir, 0o000);
  try {
    refuses(() => read(closed.specDir), /cannot be read \(EACCES\)/);
  } finally {
    chmodSync(closed.takeDir, 0o755);
  }
});

test('take.json of 8 MiB + 1 is refused by its size, before it is read', () => {
  const { specDir, takeDir } = takeIn();
  truncateSync(path.join(takeDir, 'take.json'), TAKE_JSON_MAX + 1); // not JSON any more: a parse would say so
  refuses(() => read(specDir), /take\.json is 8388609 bytes; at most 8388608/);
});

// ---- check 2: the root ----

test('version, fps, mode, scale, viewport and signedIn each name their field when wrong', () => {
  refusesEdit((t) => { t.version = 2; }, /take\.json version must be 1/);
  refusesEdit((t) => { t.fps = 24; }, /take\.json fps must be 30/);
  refusesEdit((t) => { t.mode = 'live'; }, /take\.json mode must be "stepped"/);
  refusesEdit((t) => { t.scale = 4; }, /take\.json scale must be a whole number from 1 to 3/);
  refusesEdit((t) => { t.scale = 1.5; }, /take\.json scale/);
  refusesEdit((t) => { t.viewport.width = 100; }, /take\.json viewport\.width must be a whole number from 320 to 1920/);
  refusesEdit((t) => { t.viewport.height = 1201; }, /take\.json viewport\.height must be a whole number from 320 to 1200/);
  refusesEdit((t) => { t.viewport = 5; }, /take\.json viewport/);
  refusesEdit((t) => { t.signedIn = 'no'; }, /take\.json signedIn must be true or false/);
});

test('a root that is not an object, and other root keys, are handled: the first refused, the rest ignored', () => {
  const { specDir, takeDir } = takeIn();
  writeFileSync(path.join(takeDir, 'take.json'), '[1]');
  refuses(() => read(specDir), /take\.json must be an object/);
  const extra = takeIn((t) => { t.seen = { origins: ['http://x'] }; t.surprise = 1; });
  assert.equal(read(extra.specDir).steps.length, 3);
});

// ---- check 3: frames and steps ----

test('frames: none, 6,001, a "/", a "..", an uppercase name and a non-string are refused with their index', () => {
  assert.equal(MAX_FRAMES, 6000);
  refusesEdit((t) => { t.frames = []; }, /take\.json frames must list 1 to 6000 names/);
  refusesEdit((t) => { t.frames = Array.from({ length: MAX_FRAMES + 1 }, () => frameName(0)); }, /take\.json frames must list 1 to 6000 names; this lists 6001/);
  refusesEdit((t) => { t.frames[4] = 'sub/0000000000000000.png'; }, /frames\[4\].*"sub\/0000000000000000\.png"/);
  refusesEdit((t) => { t.frames[5] = '../0000000000000001.png'; }, /frames\[5\]/);
  refusesEdit((t) => { t.frames[6] = '000000000000000A.png'; }, /frames\[6\]/);
  refusesEdit((t) => { t.frames[7] = 12; }, /frames\[7\]/);
  refusesEdit((t) => { t.frames[8] = frameName(0, 'gif'); }, /frames\[8\]/);
});

test('steps: none, 201, a bad id, and a duplicate id are refused', () => {
  assert.equal(MAX_STEPS, 200);
  refusesEdit((t) => { t.steps = []; }, /take\.json steps must list 1 to 200 steps/);
  refusesEdit((t) => { t.steps = Array.from({ length: MAX_STEPS + 1 }, () => t.steps[0]); }, /take\.json steps must list 1 to 200 steps; this lists 201/);
  refusesEdit(stepEdit(1, { id: 'Tab Two' }), /steps\[1\]\.id/);
  refusesEdit(stepEdit(2, { id: 'tab' }), /steps\[2\]\.id "tab" is already the id of steps\[1\]/);
});

// ---- check 4: step ranges ----

test('a settleFrame of 0, one past the end and one before the startFrame are refused, not clamped', () => {
  refusesEdit(stepEdit(0, { settleFrame: 0, settledIndex: 0 }), /steps\[0\]\.settleFrame/);
  refusesEdit(stepEdit(2, { settleFrame: 13, settledIndex: 12 }), /steps\[2\]\.settleFrame/);
  refusesEdit(stepEdit(1, { settleFrame: 2, settledIndex: 1 }), /steps\[1\]\.settleFrame.*startFrame/);
});

test('startFrame and actFrame out of order or out of range are refused', () => {
  refusesEdit(stepEdit(1, { actFrame: 2 }), /steps\[1\]\.actFrame.*startFrame/);
  refusesEdit(stepEdit(1, { actFrame: 9 }), /steps\[1\]\.actFrame.*settleFrame/);
  refusesEdit(stepEdit(2, { startFrame: 13, actFrame: 13, settleFrame: 13, settledIndex: 12 }), /steps\[2\]\.startFrame/);
  refusesEdit(stepEdit(0, { startFrame: 1.5 }), /steps\[0\]\.startFrame must be a whole number/);
  refusesEdit(stepEdit(0, { startFrame: -1 }), /steps\[0\]\.startFrame/);
});

test('a step that starts inside the step before it is refused', () => {
  refusesEdit((t) => Object.assign(t.steps[1], { startFrame: 2, actFrame: 5 }), /steps\[1\]\.startFrame .* before steps\[0\] settles/);
});

test('settledIndex that is neither settleFrame - 1 nor in range and at or after actFrame - 1 is refused', () => {
  refusesEdit(stepEdit(1, { settledIndex: 12 }), /steps\[1\]\.settledIndex/);
  refusesEdit(stepEdit(1, { settledIndex: 3 }), /steps\[1\]\.settledIndex/);
  refusesEdit(stepEdit(1, { settledIndex: 2.5 }), /steps\[1\]\.settledIndex/);
});

test('pointer, box and textPx out of bounds or not numbers are refused', () => {
  refusesEdit(stepEdit(1, { pointer: { x: 1e9, y: 0 } }), /steps\[1\]\.pointer\.x/);
  refusesEdit(stepEdit(1, { pointer: { x: 'left', y: 0 } }), /steps\[1\]\.pointer\.x/);
  refusesEdit(stepEdit(1, { pointer: 4 }), /steps\[1\]\.pointer/);
  refusesEdit(stepEdit(1, { box: { x: 0, y: 0, width: -1, height: 5 } }), /steps\[1\]\.box\.width/);
  refusesEdit(stepEdit(1, { box: { x: 5000, y: 0, width: 5, height: 5 } }), /steps\[1\]\.box\.x/);
  refusesEdit(stepEdit(1, { box: { x: 0, y: 0, width: 5 } }), /steps\[1\]\.box\.height/);
  refusesEdit(stepEdit(1, { textPx: 0 }), /steps\[1\]\.textPx must be null or a number above 0 and up to 4096/);
  refusesEdit(stepEdit(1, { textPx: -3 }), /steps\[1\]\.textPx/);
  refusesEdit(stepEdit(1, { textPx: 4097 }), /steps\[1\]\.textPx/);
  refusesEdit(stepEdit(1, { textPx: 'big' }), /steps\[1\]\.textPx/);
});

test('a textPx of 288 (a hero headline), 0.5 and 4096 read: make-demo writes sizes like these', () => {
  for (const textPx of [288, 0.5, 4096]) {
    const { specDir } = takeIn(stepEdit(1, { textPx }));
    assert.equal(read(specDir).steps[1].textPx, textPx);
  }
});

test('an error repeats at most a short, quoted piece of the take', () => {
  const long = 'x'.repeat(5000);
  const { specDir } = takeIn((t) => { t.frames[0] = long; });
  assert.throws(() => read(specDir), (err) => err.errors[0].message.length < 300 && !err.errors[0].message.includes('x'.repeat(200)));
});

// ---- check 5: the frames folder and each frame file ----

test('frames/ missing, or a link to a folder outside the take, is refused', () => {
  const { specDir, takeDir, framesDir } = takeIn();
  const outside = newDir();
  writeSyntheticTake(outside);
  rmSync(framesDir, { recursive: true });
  refuses(() => read(specDir), /frames\/ is not a folder inside the take folder/);
  symlinkSync(path.join(outside, 'take', 'frames'), path.join(takeDir, 'frames'));
  refuses(() => read(specDir), /frames\/ is not a folder inside the take folder/);
});

test('a frame that is a link to a file outside frames/ is refused with its name, though the file is a valid picture', () => {
  const outside = newDir();
  writeFileSync(path.join(outside, 'secret.png'), solidPng());
  const { specDir, framesDir } = takeIn();
  rmSync(path.join(framesDir, frameName(1)));
  symlinkSync(path.join(outside, 'secret.png'), path.join(framesDir, frameName(1)));
  refuses(() => read(specDir), new RegExp(`frames\\[3\\] "${frameName(1)}" is not a file inside the take's frames/ folder`));
});

test('a frame link to a file elsewhere inside the take folder, and a frame that is a folder, are refused', () => {
  const { specDir, takeDir, framesDir } = takeIn();
  copyFileSync(path.join(framesDir, frameName(2)), path.join(takeDir, 'elsewhere.png'));
  rmSync(path.join(framesDir, frameName(2)));
  symlinkSync(path.join(takeDir, 'elsewhere.png'), path.join(framesDir, frameName(2)));
  refuses(() => read(specDir), /frames\[6\]/);
  rmSync(path.join(framesDir, frameName(2)));
  mkdirSync(path.join(framesDir, frameName(2)));
  refuses(() => read(specDir), /frames\[6\]/);
});

test('a frame named by take.json but missing is refused with its name', () => {
  const { specDir, framesDir } = takeIn();
  rmSync(path.join(framesDir, frameName(3)));
  refuses(() => read(specDir), new RegExp(`frames\\[9\\] "${frameName(3)}"`));
});

test('a .jpg that holds PNG bytes, a .png that holds SVG or HTML, and a short file are refused at read', () => {
  const asJpg = (name) => name.replace('.png', '.jpg');
  const { specDir } = takeIn((t, pngs) => {
    t.frames = t.frames.map((n) => (n === frameName(0) ? asJpg(n) : n));
    pngs.set(asJpg(frameName(0)), solidPng()); // PNG bytes under a .jpg name
    pngs.delete(frameName(0));
  });
  refuses(() => read(specDir), new RegExp(`frames\\[0\\] "${asJpg(frameName(0))}".*first bytes.*JPEG`));
  for (const body of ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<!doctype html><script>1</script>', '\x89PNG']) {
    const next = takeIn((t, pngs) => pngs.set(frameName(1), Buffer.from(body.padEnd(40, ' '))));
    refuses(() => read(next.specDir), new RegExp(`frames\\[3\\] "${frameName(1)}".*first bytes.*PNG`));
  }
  const short = takeIn((t, pngs) => pngs.set(frameName(1), Buffer.from('\x89PNG\r\n\x1a\n')));
  refuses(() => read(short.specDir), /frames\[3\]/);
});

test('a PNG whose IHDR says 30,000 wide, and a JPEG that says 30,000 x 30,000, are refused with the frame name', () => {
  const huge = solidPng();
  huge.writeUInt32BE(30_000, 16);
  const png = takeIn((t, pngs) => pngs.set(frameName(1), huge));
  refuses(() => read(png.specDir), new RegExp(`frames\\[3\\] "${frameName(1)}" is 30000x320`));
  const jpg = takeIn((t, pngs) => {
    t.frames = t.frames.map((n) => (n === frameName(1) ? 'aaaaaaaaaaaaaaaa.jpg' : n));
    pngs.delete(frameName(1));
    pngs.set('aaaaaaaaaaaaaaaa.jpg', minimalJpeg(30_000, 30_000));
  });
  refuses(() => read(jpg.specDir), /frames\[3\] "aaaaaaaaaaaaaaaa\.jpg" is 30000x30000/);
});

test('a frame of the wrong size, and a JPEG with no size header, are refused', () => {
  const small = takeIn((t, pngs) => pngs.set(frameName(2), solidPng(undefined, 160, 160)));
  refuses(() => read(small.specDir), new RegExp(`frames\\[6\\] "${frameName(2)}" is 160x160; this take's frames are 320x320`));
  const blind = takeIn((t, pngs) => {
    t.frames = t.frames.map((n) => (n === frameName(0) ? 'bbbbbbbbbbbbbbbb.jpg' : n));
    pngs.delete(frameName(0));
    pngs.set('bbbbbbbbbbbbbbbb.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0xff, 0xd9]));
  });
  refuses(() => read(blind.specDir), /frames\[0\] "bbbbbbbbbbbbbbbb\.jpg".*no size/);
});

test('a frame over 16 MiB is refused by its size', () => {
  const { specDir, framesDir } = takeIn();
  truncateSync(path.join(framesDir, frameName(1)), 16 * 1024 * 1024 + 1); // the header stays valid
  refuses(() => read(specDir), new RegExp(`frames\\[3\\] "${frameName(1)}" is 16777217 bytes; at most 16777216`));
});

test('distinct frames that together weigh over 3 GiB are refused', () => {
  const { specDir, framesDir } = takeIn((t, pngs) => {
    const bytes = solidPng();
    t.frames = Array.from({ length: 200 }, (_, k) => frameName(k));
    t.steps = [{ id: 'open', do: 'goto', startFrame: 0, actFrame: 0, settleFrame: 200, settledIndex: 199, pointer: null, box: null, textPx: null }];
    pngs.clear();
    for (const name of t.frames) pngs.set(name, bytes);
  });
  for (let k = 0; k < 200; k++) truncateSync(path.join(framesDir, frameName(k)), 16 * 1024 * 1024); // sparse: valid header, 16 MiB each
  refuses(() => read(specDir), /frames together weigh over 3 GiB/);
});

test('the same frame named many times is checked once and weighs once', () => {
  const { specDir } = takeIn();
  assert.equal(read(specDir).names.filter((n) => n === frameName(0)).length, 3);
});

// ---- the preparer ----

test('prepareWalk: the take minus its paths, plus distinct; no folder path in the JSON', () => {
  const { specDir, takeDir } = takeIn();
  const { data, problems } = prepareWalk({ id: 'w', show: 'walk', src: 'take' }, { filmDir: specDir, index: 0 });
  assert.deepEqual(problems, []);
  assert.equal(data.distinct, 4);
  assert.equal(data.names.length, 12);
  assert.equal(data.steps.length, 3);
  assert.equal(data.dir, undefined);
  assert.equal(data.framesDir, undefined);
  assert.ok(!JSON.stringify(data).includes(takeDir) && !JSON.stringify(data).includes(specDir));
});

test('prepareWalk: a refused take is a problem at the shot\'s src, with no data', () => {
  const { specDir } = takeIn((t) => { t.version = 2; });
  const out = prepareWalk({ id: 'w', show: 'walk', src: 'take' }, { filmDir: specDir, index: 4 });
  assert.equal(out.data, null);
  assert.equal(out.problems.length, 1);
  assert.equal(out.problems[0].path, 'src');
  assert.match(out.problems[0].message, /take\.json version must be 1/);
});

test('prepareFilm puts a walk shot\'s data under the shot id, and reports a bad take at shots[i].src', () => {
  const kinds = new Map([['walk', { prepared: true }], ['statement', {}]]); // `walk` is not registered until its kind exists
  const { specDir } = takeIn();
  const film = filmOf([{ id: 'a', show: 'statement', hold: 1, text: 'Hi' }, { id: 'w', show: 'walk', src: 'take' }]);
  const ok = prepareFilm(film, { filmDir: specDir, kinds });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(Object.keys(ok.prepared), ['w']);
  assert.equal(ok.prepared.w.steps.length, 3);
  const bad = takeIn((t) => { t.scale = 9; });
  const refused = prepareFilm(film, { filmDir: bad.specDir, kinds });
  assert.deepEqual(refused.prepared, {});
  assert.equal(refused.problems[0].path, 'shots[1].src');
  assert.match(refused.problems[0].message, /take\.json scale/);
});

test('reading a take never changes the take folder', () => {
  const { specDir, takeDir } = takeIn();
  const before = readFileSync(path.join(takeDir, 'take.json'), 'utf8');
  read(specDir);
  assert.equal(readFileSync(path.join(takeDir, 'take.json'), 'utf8'), before);
});
