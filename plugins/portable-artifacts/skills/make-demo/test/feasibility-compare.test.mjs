import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stableMask, wrongBlocks, groupBlocks, failingGroups, maskedSsim, verdict } from './feasibility/compare.mjs';
import { entryProblem, cappedSteps } from './feasibility/probe.mjs';

const BLOCK = 12;
const COLS = 4; // 48 px wide, four blocks across and four down
const SIZE = COLS * BLOCK;
const BLOCK_PIXELS = BLOCK * BLOCK;

/** An RGB picture; `paint(x, y)` gives [r, g, b], a grey number or null (the base grey 128). */
function picture(paint = () => null, size = SIZE) {
  const data = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const value = paint(x, y) ?? 128;
      const rgb = Array.isArray(value) ? value : [value, value, value];
      data.set(rgb, (y * size + x) * 3);
    }
  }
  return { width: size, height: size, channels: 3, data };
}

const inBlock = (bx, by) => (x, y) => Math.floor(x / BLOCK) === bx && Math.floor(y / BLOCK) === by;
const painted = (bx, by, value) => picture((x, y) => (inBlock(bx, by)(x, y) ? value : null));
/** `count` pixels of block (bx, by) set to `value`, row by row. */
const somePixels = (bx, by, count, value) => picture((x, y) => {
  const index = (y - by * BLOCK) * BLOCK + (x - bx * BLOCK);
  return inBlock(bx, by)(x, y) && index < count ? value : null;
});
const reals = (p = picture()) => [p, picture(), picture()];

test('three equal pictures give share 1 and every block stable', () => {
  const { mask, share, cols, rows } = stableMask(reals());
  assert.equal(share, 1);
  assert.deepEqual([cols, rows, mask.length], [COLS, COLS, COLS * COLS]);
  assert.ok(mask.every((v) => v === 1));
});

test('a change of 6 on every channel keeps a block stable, a change of 7 on any one channel does not (B2: colour counts)', () => {
  assert.equal(stableMask([picture(), painted(0, 0, 134)]).share, 1);
  assert.equal(stableMask([picture(), painted(0, 0, 135)]).mask[0], 0);
  assert.equal(stableMask([picture(), painted(1, 0, [128, 128, 135])]).mask[1], 0, 'only the blue channel moved');
});

test('one picture of the three that differs makes the block unstable: all of them must agree', () => {
  assert.equal(stableMask([picture(), picture(), painted(2, 2, 200)]).mask[2 * COLS + 2], 0);
});

test('pictures of different sizes are an error, not a pass', () => {
  assert.throws(() => stableMask([picture(), picture(undefined, 24)]), /size/i);
});

test('a picture with an alpha channel is read as its RGB', () => {
  const rgba = { width: SIZE, height: SIZE, channels: 4, data: Buffer.alloc(SIZE * SIZE * 4, 128) };
  assert.equal(stableMask([picture(), rgba]).share, 1);
});

test('an identical stepped picture has no wrong block', () => {
  const info = stableMask(reals());
  assert.deepEqual(wrongBlocks(picture(), reals(), info), []);
});

test('a whole block 37 grey levels off is wrong: a flat brightness shift is not hidden by a mean (B1)', () => {
  const info = stableMask(reals());
  const wrong = wrongBlocks(painted(1, 1, 165), reals(), info);
  assert.equal(wrong.length, 1);
  assert.deepEqual(wrong[0].box, { x: BLOCK, y: BLOCK, width: BLOCK, height: BLOCK });
});

test('red against green of one brightness is wrong, and SSIM on luma cannot see it (B2)', () => {
  const red = picture(() => [255, 0, 0]);
  const green = picture(() => [0, 131, 0]);
  const realRuns = [red, picture(() => [255, 0, 0]), picture(() => [255, 0, 0])];
  const info = stableMask(realRuns);
  assert.equal(wrongBlocks(green, realRuns, info).length, COLS * COLS);
  assert.ok(maskedSsim(green, red, info.mask) > 0.98, 'the luma figure alone would have passed it');
});

test('a difference of exactly 24 is noise and 25 is wrong; 8 wrong pixels are noise and 9 make the block wrong', () => {
  const info = stableMask(reals());
  assert.deepEqual(wrongBlocks(painted(0, 0, 128 + 24), reals(), info), []);
  assert.equal(wrongBlocks(painted(0, 0, 128 + 25), reals(), info).length, 1);
  assert.deepEqual(wrongBlocks(somePixels(0, 0, 8, 255), reals(), info), []);
  assert.equal(wrongBlocks(somePixels(0, 0, 9, 255), reals(), info).length, 1);
});

test('a pixel counts only when it differs from every real picture, so a real variation is not blamed', () => {
  const variable = [picture(), painted(0, 0, 200), picture()];
  const info = stableMask(variable);
  assert.equal(info.mask[0], 0, 'the block is not stable, so it is not compared');
  const nearOne = [picture(), picture(), picture()];
  assert.deepEqual(wrongBlocks(painted(0, 0, 200), [nearOne[0], painted(0, 0, 200), nearOne[2]], stableMask(nearOne)), []);
});

test('only stable blocks are judged: a wrong picture inside an unstable block is left out', () => {
  const real = [picture(), painted(3, 3, 60), painted(3, 3, 200)];
  const info = stableMask(real);
  assert.equal(info.mask[3 * COLS + 3], 0);
  assert.deepEqual(wrongBlocks(painted(3, 3, 0), real, info), []);
});

test('a mask hides only its blocks in the SSIM figure', () => {
  const a = picture();
  const differs = picture((x, y) => (inBlock(1, 0)(x, y) ? ((x + y) % 2 ? 0 : 255) : null));
  const all = new Uint8Array(COLS * COLS).fill(1);
  const hidden = Uint8Array.from(all);
  hidden[1] = 0;
  assert.ok(maskedSsim(a, differs, all) < 0.98);
  assert.equal(maskedSsim(a, differs, hidden), 1);
  assert.equal(maskedSsim(a, differs, new Uint8Array(COLS * COLS)), 0, 'no stable block gives 0');
});

const blockAt = (bx, by, pixels = 20) => ({ index: by * COLS + bx, box: { x: bx * BLOCK, y: by * BLOCK, width: BLOCK, height: BLOCK }, pixels, area: BLOCK_PIXELS });

test('touching wrong blocks fail, corner to corner too; two apart do not', () => {
  assert.equal(failingGroups([blockAt(0, 0), blockAt(1, 0)], COLS).length, 1);
  assert.equal(failingGroups([blockAt(0, 0), blockAt(1, 1)], COLS).length, 1);
  assert.deepEqual(failingGroups([blockAt(0, 0), blockAt(2, 0)], COLS), []);
  assert.deepEqual(failingGroups([blockAt(3, 0), blockAt(0, 1)], COLS), [], 'the end of one row is not next to the start of the next');
});

test('a group names its box', () => {
  const [group] = groupBlocks([blockAt(1, 1), blockAt(2, 1)], COLS);
  assert.deepEqual(group.box, { x: BLOCK, y: BLOCK, width: 2 * BLOCK, height: BLOCK });
});

test('one wrong block fails only when at least half of it is wrong', () => {
  assert.deepEqual(failingGroups([blockAt(1, 1, 20)], COLS), []);
  assert.equal(failingGroups([blockAt(1, 1, BLOCK_PIXELS / 2)], COLS).length, 1);
});

const STEP = { share: 1, wrongGroups: [], treeDifferences: [], treeLeftOut: 0 };
const GOOD = { steps: [STEP, STEP] };

test('verdict is steppable when every step agrees', () => {
  assert.equal(verdict(GOOD).verdict, 'no difference found');
});

test('every verdict says the smallest stable share it compared, and the words are the three of the scope cut', () => {
  const steps = [{ ...STEP, share: 0.97 }, { ...STEP, share: 0.82 }];
  for (const result of [verdict({ steps }), verdict({ steps, wall: 'status 403' }), verdict({ steps: [{ ...STEP, share: 0.3 }] })]) {
    assert.ok(['no difference found', 'difference found', 'inconclusive'].includes(result.verdict), result.verdict);
    assert.match(result.why.join(' | '), /stable share compared: 0\.\d\d/);
  }
  assert.match(verdict({ steps }).why.join(' | '), /stable share compared: 0\.82 .*2 step/);
});

test('verdict is inconclusive for a stable share of 0.49 at any step, and keeps 0.5', () => {
  const low = verdict({ steps: [STEP, { ...STEP, share: 0.49 }] });
  assert.equal(low.verdict, 'inconclusive');
  assert.match(low.why.join(' '), /step 1: only 0\.49/);
  assert.equal(verdict({ steps: [{ ...STEP, share: 0.5 }] }).verdict, 'no difference found');
});

test('verdict is not-steppable for a wrong group, and the reason names its box', () => {
  const [group] = groupBlocks([blockAt(1, 1), blockAt(2, 1)], COLS);
  const v = verdict({ steps: [{ ...STEP, wrongGroups: [group] }] });
  assert.equal(v.verdict, 'difference found');
  assert.match(v.why.join(' '), /step 0: .*24x12 at \(12, 12\)/);
});

test('verdict is not-steppable for a tree difference and for a new page error', () => {
  assert.equal(verdict({ steps: [{ ...STEP, treeDifferences: ['missing 1× button "Save"'] }] }).verdict, 'difference found');
  const v = verdict({ ...GOOD, newErrors: [{ key: 'pageerror: boom #', stepped: 1, real: 0 }] });
  assert.equal(v.verdict, 'difference found');
  assert.match(v.why.join(' '), /pageerror: boom #/);
});

test('verdict is inconclusive when over a fifth of the tree differs among the real runs', () => {
  assert.equal(verdict({ steps: [{ ...STEP, treeLeftOut: 0.21 }] }).verdict, 'inconclusive');
  assert.equal(verdict({ steps: [{ ...STEP, treeLeftOut: 0.2 }] }).verdict, 'no difference found');
});

test('verdict is not-steppable for a wall, and a wall beats a low share', () => {
  assert.equal(verdict({ ...GOOD, wall: 'status 403' }).verdict, 'difference found');
  const v = verdict({ steps: [{ ...STEP, share: 0.1 }], wall: 'status 403' });
  assert.equal(v.verdict, 'difference found');
  assert.match(v.why.join(' '), /status 403/);
});

test('verdict is inconclusive for a run that never settled, and steppable with a note when the page loops (B3)', () => {
  const capped = { runs: [{ run: 'real-2', step: 1, reason: 'time' }], loops: false };
  const v = verdict({ ...GOOD, capped });
  assert.equal(v.verdict, 'inconclusive');
  assert.match(v.why.join(' '), /real-2 step 1 \(time\)/);
  const loops = verdict({ ...GOOD, capped: { ...capped, loops: true } });
  assert.equal(loops.verdict, 'no difference found');
  assert.match(loops.why.join(' '), /loops/);
});

test('verdict is inconclusive when the runs ended on different addresses, and with no step compared', () => {
  assert.equal(verdict({ ...GOOD, finalUrlsEqual: false }).verdict, 'inconclusive');
  assert.equal(verdict({ steps: [] }).verdict, 'inconclusive');
});

test('a NaN share is never a pass', () => {
  assert.notEqual(verdict({ steps: [{ ...STEP, share: Number.NaN }] }).verdict, 'no difference found');
});

const settled = { capped: false, reason: 'still', pendingRequests: 0 };
const gaveUp = { capped: true, reason: 'time', pendingRequests: 0 };
const run = (label, ...settles) => ({ label, steps: settles.map((settle) => ({ settle })) });

test('cappedSteps: a run that gave up makes the site inconclusive unless every run did, with nothing pending and equal trees (B3)', () => {
  const calm = [{ treeDifferences: [] }];
  const one = cappedSteps([run('real-1', settled), run('real-2', gaveUp), run('real-3', settled), run('stepped', settled)], calm);
  assert.deepEqual(one, { runs: [{ run: 'real-2', step: 0, reason: 'time' }], loops: false });
  const all = cappedSteps(['real-1', 'real-2', 'real-3', 'stepped'].map((l) => run(l, gaveUp)), calm);
  assert.equal(all.loops, true);
  const pending = cappedSteps(['real-1', 'real-2', 'real-3', 'stepped'].map((l) => run(l, { ...gaveUp, pendingRequests: 2 })), calm);
  assert.equal(pending.loops, false, 'a request still in flight is not a loop');
  const trees = cappedSteps(['real-1', 'real-2', 'real-3', 'stepped'].map((l) => run(l, gaveUp)), [{ treeDifferences: ['missing 1× x'] }]);
  assert.equal(trees.loops, false, 'the trees must agree');
  assert.deepEqual(cappedSteps([run('real-1', settled)], calm), { runs: [], loops: false });
});

const SITES = JSON.parse(fs.readFileSync(new URL('./feasibility/sites.json', import.meta.url), 'utf8'));
const PLAN_URLS = [
  'https://abhijitbansal.github.io/portable-artifacts/',
  'https://en.wikipedia.org/wiki/Web_browser',
  'https://react.dev/learn',
  'https://excalidraw.com/',
  'https://play.grafana.org/',
];

test('sites.json holds the five sites of the plan, each with two to four valid look steps and no click', () => {
  assert.deepEqual(SITES.map((s) => s.url), PLAN_URLS);
  for (const site of SITES) {
    assert.equal(entryProblem(site), null, site.name);
    assert.ok(site.steps.length >= 2 && site.steps.length <= 4, `${site.name} has ${site.steps.length} steps`);
    assert.deepEqual(site.steps.filter((s) => !['scroll', 'hover'].includes(s.do)), []);
  }
});

test('entryProblem refuses click, typing, submitting and anything that is not a look', () => {
  const base = { name: 'x', url: 'https://example.test/' };
  for (const kind of ['click', 'type', 'fill', 'press', 'select', 'submit', 'goto']) {
    assert.match(entryProblem({ ...base, steps: [{ do: kind, role: 'textbox', name: 'q', value: 'v' }] }), /look/, kind);
  }
  assert.match(entryProblem({ ...base, steps: [{ do: 'hover', role: 'button' }] }), /role/);
  assert.match(entryProblem({ ...base, steps: [] }), /at least one/);
});

test('entryProblem refuses names that leave the output folder, urls with credentials and other schemes (D1, D5)', () => {
  const ok = [{ do: 'scroll', to: 0, seconds: 1 }];
  for (const name of ['..', '.', '../x', 'a/b', '.hidden', 'a..b', '-x', '']) {
    assert.match(entryProblem({ name, url: 'https://example.test/', steps: ok }), /name/, JSON.stringify(name));
  }
  assert.equal(entryProblem({ name: 'a.b-c_d', url: 'https://example.test/', steps: ok }), null);
  assert.match(entryProblem({ name: 'x', url: 'https://user:secret@example.test/', steps: ok }), /credentials/);
  assert.match(entryProblem({ name: 'x', url: 'file:///etc/passwd', steps: ok }), /http/);
  assert.match(entryProblem({ name: 'x', url: 'https://example.test/', steps: [{ do: 'hover', role: 'Button', name: 'q' }] }), /role/);
});
