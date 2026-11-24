import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stableMask, maskedSsim, verdict } from './feasibility/compare.mjs';
import { entryProblem } from './feasibility/probe.mjs';

const BLOCK = 24;
const SIZE = 48; // two by two blocks

/** A flat grey RGB picture, with `paint(x, y)` able to give any pixel another grey. */
function picture(paint = () => null, size = SIZE) {
  const data = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const grey = paint(x, y) ?? 128;
      data.fill(grey, (y * size + x) * 3, (y * size + x) * 3 + 3);
    }
  }
  return { width: size, height: size, channels: 3, data };
}

const inBlock = (bx, by) => (x, y) => Math.floor(x / BLOCK) === bx && Math.floor(y / BLOCK) === by;
const changeBlock = (bx, by, grey) => picture((x, y) => (inBlock(bx, by)(x, y) ? grey : null));
const checkerBlock = (bx, by) => picture((x, y) => (inBlock(bx, by)(x, y) ? ((x + y) % 2 ? 0 : 255) : null));

test('equal pictures give share 1 and SSIM 1', () => {
  const a = picture();
  const { mask, share } = stableMask(a, picture());
  assert.equal(share, 1);
  assert.deepEqual([...mask], [1, 1, 1, 1]);
  assert.equal(maskedSsim(a, picture(), mask), 1);
});

test('one changed block of four gives share 0.75 and that block is not in the mask', () => {
  const { mask, share } = stableMask(picture(), changeBlock(1, 1, 200));
  assert.equal(share, 0.75);
  assert.deepEqual([...mask], [1, 1, 1, 0]);
});

test('a change within the tolerance leaves the block stable, a change past it does not', () => {
  assert.equal(stableMask(picture(), changeBlock(0, 0, 134), { tolerance: 6 }).share, 1);
  assert.equal(stableMask(picture(), changeBlock(0, 0, 135), { tolerance: 6 }).share, 0.75);
});

test('a mask hides only its blocks: a difference in a stable block lowers SSIM below 0.98, one in a hidden block does not', () => {
  const a = picture();
  const differs = checkerBlock(1, 0);
  assert.ok(maskedSsim(a, differs, Uint8Array.from([1, 1, 1, 1])) < 0.98);
  assert.ok(maskedSsim(a, differs, Uint8Array.from([1, 0, 1, 1])) >= 0.98);
});

test('pictures of different sizes are an error, not a pass', () => {
  assert.throws(() => stableMask(picture(), picture(undefined, 24)), /size/i);
});

test('a picture with an alpha channel is read as its RGB', () => {
  const rgb = picture();
  const rgba = { width: SIZE, height: SIZE, channels: 4, data: Buffer.alloc(SIZE * SIZE * 4, 128) };
  assert.equal(stableMask(rgb, rgba).share, 1);
});

const GOOD = { ssims: [1, 1], shares: [1, 1], controlsEqual: true, newErrors: 0, wall: null };

test('verdict is inconclusive for a stable share of 0.49 at any step', () => {
  const v = verdict({ ...GOOD, shares: [1, 0.49] });
  assert.equal(v.verdict, 'inconclusive');
  assert.match(v.why.join(' '), /0\.49/);
});

test('verdict keeps a share of exactly 0.5', () => {
  assert.equal(verdict({ ...GOOD, shares: [0.5, 1] }).verdict, 'steppable');
});

test('verdict is not-steppable for SSIM 0.979 and says which step', () => {
  const v = verdict({ ...GOOD, ssims: [1, 0.979] });
  assert.equal(v.verdict, 'not-steppable');
  assert.match(v.why.join(' '), /0\.979/);
});

test('verdict is not-steppable for unequal controls', () => {
  assert.equal(verdict({ ...GOOD, controlsEqual: false }).verdict, 'not-steppable');
});

test('verdict is not-steppable for a new page error', () => {
  assert.equal(verdict({ ...GOOD, newErrors: 1 }).verdict, 'not-steppable');
});

test('verdict is not-steppable for a wall, with every SSIM 1, and the reason names the wall', () => {
  const v = verdict({ ...GOOD, wall: 'status 403' });
  assert.equal(v.verdict, 'not-steppable');
  assert.match(v.why.join(' '), /status 403/);
});

test('a wall beats a low share: it is never called inconclusive', () => {
  assert.equal(verdict({ ...GOOD, shares: [0.1], wall: 'status 403' }).verdict, 'not-steppable');
});

test('verdict is steppable for SSIM [0.98, 1]', () => {
  assert.equal(verdict({ ...GOOD, ssims: [0.98, 1] }).verdict, 'steppable');
});

test('verdict with no steps compared is inconclusive, never steppable', () => {
  assert.equal(verdict({ ...GOOD, ssims: [], shares: [] }).verdict, 'inconclusive');
});

test('verdict does not take a NaN SSIM as a pass', () => {
  assert.notEqual(verdict({ ...GOOD, ssims: [Number.NaN, 1] }).verdict, 'steppable');
});

const SITES = JSON.parse(fs.readFileSync(new URL('./feasibility/sites.json', import.meta.url), 'utf8'));
const PLAN_URLS = [
  'https://abhijitbansal.github.io/portable-artifacts/',
  'https://en.wikipedia.org/wiki/Web_browser',
  'https://react.dev/learn',
  'https://excalidraw.com/',
  'https://play.grafana.org/',
];

test('sites.json holds the five sites of the plan, each with two to four valid look steps', () => {
  assert.deepEqual(SITES.map((s) => s.url), PLAN_URLS);
  for (const site of SITES) {
    assert.equal(entryProblem(site), null, site.name);
    assert.ok(site.steps.length >= 2 && site.steps.length <= 4, `${site.name} has ${site.steps.length} steps`);
  }
});

test('entryProblem refuses typing, submitting and anything that is not a look', () => {
  const base = { name: 'x', url: 'https://example.test/' };
  for (const kind of ['type', 'fill', 'press', 'select', 'submit', 'goto']) {
    assert.match(entryProblem({ ...base, steps: [{ do: kind, role: 'textbox', name: 'q', value: 'v' }] }), /look/, kind);
  }
  assert.match(entryProblem({ ...base, steps: [{ do: 'click', role: 'button' }] }), /role/);
  assert.match(entryProblem({ ...base, url: 'file:///etc/passwd', steps: [] }), /http/);
  assert.match(entryProblem({ ...base, name: '../x', steps: [] }), /name/);
});
