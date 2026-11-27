// smallestText: the smallest visible font size inside a box; and take.json's `textPx` per step, on the walk fixture page.
// Loopback only. One browser for the file; run with --test-concurrency=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSites } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { smallestText } from '../scripts/lib/take-text.mjs';
import { recordWalkTake } from './helpers/fixture-take.mjs';

const T = { timeout: 180000 };
const FIELD_PX = 13;
const CAPTION_PX = 12;
const VIEWPORT = { width: 960, height: 540 };

let sites;
let browser;
let context;
let page;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-take-text-'));

before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  sites = await startSites();
  browser = await launchBrowser();
  context = await browser.newContext({ viewport: VIEWPORT });
  page = await context.newPage();
  await page.goto(`${sites.origin}/walk/`);
});
after(async () => {
  await context?.close();
  await browser?.close();
  await sites?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

test('the search field box gives the field font size, a card box gives its caption size', T, async () => {
  const field = await page.getByRole('searchbox', { name: 'Search projects' }).boundingBox();
  assert.equal(await smallestText(page, field), FIELD_PX);
  const card = await page.locator('.card').first().boundingBox();
  assert.equal(await smallestText(page, card), CAPTION_PX);
});

test('a null box, and a box with no text in it, give null', T, async () => {
  assert.equal(await smallestText(page, null), null);
  assert.equal(await smallestText(page, { x: 5000, y: 5000, width: 40, height: 40 }), null);
});

test('hidden text does not count', T, async () => {
  const card = await page.locator('.card').first().boundingBox();
  await page.evaluate(() => { for (const el of document.querySelectorAll('.card .caption')) el.style.visibility = 'hidden'; });
  const shown = await smallestText(page, card);
  await page.evaluate(() => { for (const el of document.querySelectorAll('.card .caption')) el.style.visibility = ''; });
  assert.ok(shown > CAPTION_PX, `smallest text with the captions hidden is ${shown}`);
});

test('a take of the walk page has textPx on every step: a number where the step has a box with text, else null', T, async () => {
  const dir = path.join(work, 'take');
  const take = await recordWalkTake({ browser, sites, dir });
  assert.equal(take.stopped, null);
  assert.ok(take.steps.length >= 5, `${take.steps.length} steps`);
  for (const step of take.steps) {
    assert.ok('textPx' in step, `${step.id} has textPx`);
    assert.ok(step.textPx === null || (typeof step.textPx === 'number' && step.textPx > 0), `${step.id}: ${step.textPx}`);
    if (step.box === null) assert.equal(step.textPx, null, `${step.id} has no box`);
  }
  assert.equal(take.steps.find((s) => s.do === 'type').textPx, FIELD_PX);
  const hover = take.steps.find((s) => s.do === 'hover');
  assert.equal(hover.textPx, CAPTION_PX);
  const settled = (step) => take.frames[step.settledIndex];
  assert.notEqual(settled(hover), settled(take.steps.find((s) => s.do === 'type')), 'the hover shows: its settled frame is not the typing step\'s');
  assert.deepEqual(JSON.parse(JSON.stringify(take)), take);
});
