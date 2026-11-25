// markShots without a real browser: which boxes are drawn, when no browser is started, the live-browser refusal, cleanup of old pictures,
// and that the browser is closed when drawing fails. The drawing itself runs in build-browser.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { markShots, boxesOf } from '../scripts/lib/mark-shots.mjs';
import { UsageError } from '../scripts/lib/spec.mjs';
import { dangerScout, loginScout } from './fixtures/plan-scouts.mjs';

const row = (n, extra) => ({ n, pageId: 'p1', box: { x: 10, y: 20, width: 30, height: 40 }, effect: 'look', ...extra });
const folder = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-marks-'));
  fs.mkdirSync(path.join(dir, 'scout'));
  fs.writeFileSync(path.join(dir, 'scout', 'p1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
  return dir;
};
const never = () => assert.fail('no browser may be started');

test('boxesOf: one box per control, numbered with every row on it, the strictest effect; rows below the cut and rows with no box are left out', () => {
  const boxes = boxesOf([
    row(1),
    row(2, { effect: 'danger' }),
    row(3, { box: { x: 100, y: 200, width: 5, height: 5 }, effect: 'change' }),
    row(4, { box: null }),
    row(5, { box: { x: 1, y: 4000, width: 5, height: 5 } }),
    row(6, { pageId: 'p2' }),
  ], 'p1');
  assert.deepEqual(boxes, [
    { box: { x: 10, y: 20, width: 30, height: 40 }, numbers: [1, 2], effect: 'danger' },
    { box: { x: 100, y: 200, width: 5, height: 5 }, numbers: [3], effect: 'change' },
  ]);
});

test('signed in: no browser is started, no picture is made, and old click-plan pictures are removed', async () => {
  const dir = folder();
  fs.mkdirSync(path.join(dir, 'click-plan'));
  fs.writeFileSync(path.join(dir, 'click-plan', 'p3.jpg'), 'old');
  fs.writeFileSync(path.join(dir, 'click-plan', 'keep.txt'), 'mine');
  const shown = await markShots(loginScout(), [row(1)], dir, { launch: never, live: () => [] });
  assert.equal(shown.size, 0);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'click-plan')), ['keep.txt']);
});

test('no page with a drawable row: no browser is started', async () => {
  const dir = folder();
  const shown = await markShots(dangerScout(), [row(1, { box: null }), row(2, { pageId: 'p9' })], dir, { launch: never, live: () => [] });
  assert.equal(shown.size, 0);
});

test('a page whose scout picture is missing is not drawn and starts no browser', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-marks-'));
  const shown = await markShots(dangerScout(), [row(1)], dir, { launch: never, live: () => [] });
  assert.equal(shown.size, 0);
});

test('another headless browser live: a usage error, nothing launched', async () => {
  const dir = folder();
  await assert.rejects(markShots(dangerScout(), [row(1)], dir, { launch: never, live: () => ['123 chrome-headless-shell'] }), (e) => e instanceof UsageError && /another headless browser/.test(e.message));
});

test('the browser is closed when drawing fails', async () => {
  const dir = folder();
  let closed = false;
  const browser = { newContext: async () => { throw new Error('boom'); }, close: async () => { closed = true; } };
  await assert.rejects(markShots(dangerScout(), [row(1)], dir, { launch: async () => browser, live: () => [] }), /boom/);
  assert.equal(closed, true);
});
