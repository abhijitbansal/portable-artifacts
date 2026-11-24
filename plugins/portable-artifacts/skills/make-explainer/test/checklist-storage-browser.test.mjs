// A checklist on a real exhausted localStorage quota: saved ticks can still be read, and a write that fails must not
// cost the ticks that are already saved. After the fill an equal or shorter replacement still succeeds, so a failing
// write is one that adds a tick.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpec, haveBrowser, openServed, closeSharedBrowser } from './helpers/browser.mjs';
import { exhaustQuota, freeQuota, deafToStorage } from './helpers/quota.mjs';
import { itemId } from '../scripts/lib/render/checklist.mjs';

after(closeSharedBrowser);

const KEY = 'pa-checklist:demo';
const G1 = { title: 'Install', items: [{ text: 'one' }, { text: 'two' }, { text: 'three' }, { text: 'four' }] };
const G2 = { title: 'Themes', items: [{ text: 'five' }, { text: 'six' }] };
const spec = { title: 'T', sections: [{ type: 'checklist', title: 'Tests', key: 'demo', groups: [G1, G2] }] };
const id = (group, text) => itemId(group.title, text);
const ONE = id(G1, 'one'); const TWO = id(G1, 'two'); const THREE = id(G1, 'three'); const FOUR = id(G1, 'four'); const FIVE = id(G2, 'five');

const tick = (page, text) => page.locator('.cl-label', { hasText: text }).locator('input').check();
const rawStore = (page) => page.evaluate((key) => localStorage.getItem(key), KEY);
const storedIds = async (page) => Object.keys(JSON.parse(await rawStore(page) ?? '{}')).sort();
const ticked = (page) => page.evaluate(() => [...document.querySelectorAll('.cl-box:checked')].map((b) => b.closest('.cl-label').querySelector('.cl-text').textContent).sort());
const warningShown = (page) => page.locator('[data-unsaved]').isVisible();
const waitForStoredId = (page, itemKey) => page.waitForFunction(([key, needle]) => (localStorage.getItem(key) || '').includes(needle), [KEY, itemKey]);
const ready = (page) => page.waitForFunction(() => window.paReady === true);

// A checklist with "one" and "two" saved, then a full store, then a reload.
async function openFullStore(t, options) {
  if (!await haveBrowser()) { t.skip('no browser (bundled Chromium or system Chrome)'); return null; }
  const opened = await openServed(buildSpec(spec).url, options);
  t.after(() => opened.context.close());
  const { page } = opened;
  await tick(page, 'one');
  await tick(page, 'two');
  const raw = await rawStore(page);
  assert.deepEqual(await storedIds(page), [ONE, TWO].sort());
  await exhaustQuota(page);
  await page.reload();
  await ready(page);
  return { ...opened, raw, url: page.url() };
}

test('full storage still restores the saved ticks and shows the warning', async (t) => {
  const opened = await openFullStore(t);
  if (!opened) return;
  const { page, raw, problems } = opened;
  assert.deepEqual(await ticked(page), ['one', 'two']);
  assert.equal(await page.locator('[data-done]').textContent(), '2');
  assert.equal(await warningShown(page), true, 'the startup probe cannot write, so the note shows');
  assert.equal(await rawStore(page), raw, 'loading changes nothing in storage');
  assert.deepEqual(problems, []);
});

test('one more tick after space is freed keeps the earlier ticks, and the warning clears', async (t) => {
  const opened = await openFullStore(t);
  if (!opened) return;
  const { page, problems } = opened;
  await freeQuota(page);
  await tick(page, 'four');
  assert.deepEqual(await storedIds(page), [ONE, TWO, FOUR].sort(), 'the saved ticks are still there');
  assert.equal(await warningShown(page), false, 'a write that held clears the note');
  await page.reload();
  await ready(page);
  assert.deepEqual(await ticked(page), ['four', 'one', 'two']);
  assert.equal(await warningShown(page), false);
  assert.deepEqual(problems, []);
});

test('a tick made while the store is still full never replaces the saved ticks; the next save carries it', async (t) => {
  const opened = await openFullStore(t);
  if (!opened) return;
  const { page, raw, problems } = opened;
  await tick(page, 'three'); // adds an id, so the entry grows and cannot be written
  assert.deepEqual(await ticked(page), ['one', 'three', 'two'], 'the tick shows for this visit');
  assert.equal(await warningShown(page), true);
  assert.equal(await rawStore(page), raw, 'the saved ticks are untouched');
  await freeQuota(page);
  await tick(page, 'four');
  assert.deepEqual(await storedIds(page), [ONE, TWO, THREE, FOUR].sort(), 'the tick that failed earlier was carried');
  assert.equal(await warningShown(page), false);
  assert.deepEqual(problems, []);
});

test('a tick that failed to save survives another tab\'s save, and that tab\'s tick is not erased by the next write', async (t) => {
  const opened = await openFullStore(t);
  if (!opened) return;
  const { page, context, url, problems } = opened;
  await tick(page, 'three');
  assert.equal(await warningShown(page), true);
  const other = await openServed(url, { context });
  await freeQuota(other.page);
  await tick(other.page, 'five');
  await waitForStoredId(other.page, FIVE);
  await page.waitForFunction(() => document.querySelector('[data-done]').textContent === '4');
  assert.deepEqual(await ticked(page), ['five', 'one', 'three', 'two'], 'the other tab\'s tick arrived and this tab\'s own tick stayed');
  assert.equal(await warningShown(page), true, 'the tick made here is still unsaved');
  await tick(page, 'four');
  assert.deepEqual(await storedIds(page), [ONE, TWO, THREE, FOUR, FIVE].sort(), 'one write holds every tick');
  assert.equal(await warningShown(page), false);
  assert.deepEqual([...problems, ...other.problems], []);
});

test('a write from a tab that missed another tab\'s tick still keeps it, after recovery from a full store', async (t) => {
  const opened = await openFullStore(t, { init: deafToStorage });
  if (!opened) return;
  const { page, context, url, problems } = opened;
  const other = await openServed(url, { context });
  await freeQuota(other.page);
  await tick(other.page, 'five');
  await waitForStoredId(page, FIVE); // in the tab that writes next: its own view of storage must hold the tick
  assert.deepEqual(await ticked(page), ['one', 'two'], 'this tab never saw the tick');
  await tick(page, 'four');
  assert.deepEqual(await storedIds(page), [ONE, TWO, FOUR, FIVE].sort(), 'only the id changed here was written over the stored ticks');
  assert.deepEqual([...problems, ...other.problems], []);
});

test('reset after recovery clears every tick, including one that never saved, and it stays cleared on reload', async (t) => {
  const opened = await openFullStore(t);
  if (!opened) return;
  const { page, problems } = opened;
  await tick(page, 'three');
  await freeQuota(page);
  await page.locator('[data-reset]').click();
  await page.locator('[data-reset-yes]').click();
  assert.deepEqual(await ticked(page), []);
  assert.equal(await rawStore(page), null, 'the key is removed');
  assert.equal(await warningShown(page), false);
  await page.reload();
  await ready(page);
  assert.deepEqual(await ticked(page), []);
  assert.deepEqual(problems, []);
});

// ---- the key is gone from storage --------------------------------------------------------------------------------

async function openPlain(t) {
  if (!await haveBrowser()) { t.skip('no browser (bundled Chromium or system Chrome)'); return null; }
  const opened = await openServed(buildSpec(spec).url);
  t.after(() => opened.context.close());
  return { ...opened, url: opened.page.url() };
}

test('storage cleared in this tab with no event: the next tick writes every tick on screen', async (t) => {
  const opened = await openPlain(t);
  if (!opened) return;
  const { page, problems } = opened;
  await tick(page, 'one');
  await tick(page, 'two');
  await page.evaluate(() => localStorage.clear()); // the tab that clears gets no storage event
  await tick(page, 'three');
  assert.deepEqual(await storedIds(page), [ONE, TWO, THREE].sort(), 'the ticks shown are the ticks saved');
  await page.reload();
  await ready(page);
  assert.deepEqual(await ticked(page), ['one', 'three', 'two']);
  assert.deepEqual(problems, []);
});

test('a reset in another tab that reached this tab is not undone by this tab\'s next tick', async (t) => {
  const opened = await openPlain(t);
  if (!opened) return;
  const { page, context, url, problems } = opened;
  const other = await openServed(url, { context });
  await tick(page, 'one');
  await tick(page, 'two');
  await other.page.waitForFunction(() => document.querySelector('[data-done]').textContent === '2');
  await other.page.locator('[data-reset]').click();
  await other.page.locator('[data-reset-yes]').click();
  await page.waitForFunction(() => document.querySelector('[data-done]').textContent === '0');
  await tick(page, 'three');
  assert.deepEqual(await storedIds(page), [THREE], 'only the tick made after the reset is stored');
  assert.deepEqual([...problems, ...other.problems], []);
});
