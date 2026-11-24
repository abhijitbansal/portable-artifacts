// Exercise a real exhausted localStorage quota: reads and storage events can still work when writes fail.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSpec, haveBrowser, openServed, closeSharedBrowser } from './helpers/browser.mjs';
import { exhaustQuota, freeQuota } from './helpers/quota.mjs';

after(closeSharedBrowser);

const STORE = 'pa-plan:quota-review';
const plan = {
  title: 'Quota review', key: 'quota-review', sections: [
    { type: 'text', text: 'Review the rollout.' },
    { type: 'approval', id: 'rollout', item: 'Start the rollout', why: 'The checks passed.' },
    { type: 'question', id: 'owner', text: 'Who owns the rollout?' },
    { type: 'verdict', text: 'Ship it?' },
  ],
};
const exported = (page) => page.evaluate(() => window.PA.planExport());
const answer = (data, id) => data.answers.find((row) => row.id === id);
const ready = (page) => page.waitForFunction(() => window.paReady === true);
const rawEntry = (page) => page.evaluate((key) => localStorage.getItem(key), STORE);
const warningShown = (page) => page.locator('[data-plan-unsaved]').isVisible();
const staleShown = (page) => page.locator('[data-plan-stale]').isVisible();

async function openFullStore(t) {
  if (!await haveBrowser()) { t.skip('no browser (bundled Chromium or system Chrome)'); return null; }
  const opened = await openServed(buildSpec(plan).url);
  t.after(() => opened.context.close());
  const { page } = opened;
  await page.locator('input[name="plan-rollout"][value="approve"]').check();
  await page.locator('[data-id="owner"] [data-answer]').fill('Dana');
  await page.locator('[data-id="rollout"] [data-comment]').fill('Keep the rollback ready');
  await page.locator('[data-reviewer]').fill('Sam');
  // The radio change flushes all pending text edits before filling storage.
  await page.locator('input[name="plan-verdict"][value="approve"]').check();
  const before = await exported(page);
  const raw = await rawEntry(page);
  await exhaustQuota(page);
  await page.reload();
  await ready(page);
  return { ...opened, before, raw };
}

test('full storage still restores readable review answers and exports them unchanged', async (t) => {
  const opened = await openFullStore(t);
  if (!opened) return;
  const { page, before, raw, problems } = opened;
  assert.equal(await warningShown(page), true);
  assert.equal(await rawEntry(page), raw, 'loading preserves the stored review');
  assert.deepEqual(await exported(page), before, 'readable answers survive a failed startup write probe');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-plan-download]').click()]);
  assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(), 'utf8')), before);
  assert.deepEqual(problems, []);
});

test('after quota recovery a successful edit clears the warning, and an edit made while full is carried by it', async (t) => {
  const opened = await openFullStore(t);
  if (!opened) return;
  const { page, raw, problems } = opened;
  assert.equal(await warningShown(page), true, 'the warning is visible before recovery');
  // An edit made while the store is full cannot be saved; it stays on the page and in the warning. The new verdict is
  // longer than the saved one: a replacement of equal or shorter length would still fit.
  await page.locator('input[name="plan-verdict"][value="approve-with-changes"]').check();
  assert.equal(await warningShown(page), true);
  assert.equal(await rawEntry(page), raw, 'the failed edit left the stored review as it was');
  await freeQuota(page);
  await page.locator('input[name="plan-rollout"][value="changes"]').check();
  assert.equal(await warningShown(page), false, 'a successful save clears the startup warning');
  const beforeReload = await exported(page);
  await page.reload();
  await ready(page);
  const after = await exported(page);
  assert.deepEqual(after, beforeReload);
  assert.equal(after.verdict, 'approve-with-changes', 'the edit made while full was saved by the recovery save');
  assert.equal(answer(after, 'rollout').choice, 'changes');
  assert.equal(answer(after, 'owner').text, 'Dana');
  assert.deepEqual(problems, []);
});

test('a tab opened with full storage still receives another tab\'s saved answers', async (t) => {
  const opened = await openFullStore(t);
  if (!opened) return;
  const { page, context, problems } = opened;
  const other = await openServed(page.url(), { context });
  await freeQuota(other.page);
  await other.page.locator('input[name="plan-rollout"][value="reject"]').check();
  await page.waitForFunction(() => document.querySelector('input[name="plan-rollout"][value="reject"]').checked);
  const received = await exported(page);
  assert.equal(answer(received, 'rollout').choice, 'reject', 'the other tab\'s answer is shown');
  assert.deepEqual(received, await exported(other.page));
  assert.deepEqual([...problems, ...other.problems], []);
});

test('a successful save over a stale-plan entry hides the stale note', async (t) => {
  if (!await haveBrowser()) { t.skip('no browser (bundled Chromium or system Chrome)'); return; }
  const stale = JSON.stringify({ hash: 'old', answers: {} });
  const { page, context, problems } = await openServed(buildSpec(plan).url, { seed: { [STORE]: stale } });
  t.after(() => context.close());
  assert.equal(await staleShown(page), true, 'the stale entry is noted on load');
  await page.locator('input[name="plan-rollout"][value="approve"]').check();
  assert.equal(await staleShown(page), false, 'the save replaced the old entry, so its note is gone');
  assert.notEqual(await rawEntry(page), stale);
  assert.deepEqual(problems, []);
});
