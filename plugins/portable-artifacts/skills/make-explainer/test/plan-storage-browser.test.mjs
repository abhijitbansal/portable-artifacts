// Exercise a real exhausted localStorage quota: reads and storage events can still work when writes fail.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildSpec, haveBrowser, openServed, closeSharedBrowser } from './helpers/browser.mjs';

after(closeSharedBrowser);

const STORE = 'pa-plan:quota-review';
const FILLER = 'pa-test-quota';
const plan = {
  title: 'Quota review', key: 'quota-review', sections: [
    { type: 'text', text: 'Review the rollout.' },
    { type: 'approval', id: 'rollout', item: 'Start the rollout', why: 'The checks passed.' },
    { type: 'question', id: 'owner', text: 'Who owns the rollout?' },
    { type: 'verdict', text: 'Ship it?' },
  ],
};
const exported = (page) => page.evaluate(() => window.PA.planExport());
const ready = (page) => page.waitForFunction(() => window.paReady === true);

async function exhaustQuota(page) {
  const result = await page.evaluate((key) => {
    let filler = '';
    for (let size = 1024 * 1024; size >= 1; size = Math.floor(size / 2)) {
      for (;;) {
        const next = filler + 'x'.repeat(size);
        try { localStorage.setItem(key, next); filler = next; }
        catch (error) {
          if (error.name !== 'QuotaExceededError') throw error;
          break;
        }
      }
    }
    try { localStorage.setItem('pa-probe', '1'); return 'probe succeeded'; }
    catch (error) { return error.name; }
  }, FILLER);
  assert.equal(result, 'QuotaExceededError', 'the page startup probe really cannot write');
}

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
  const raw = await page.evaluate((key) => localStorage.getItem(key), STORE);
  await exhaustQuota(page);
  await page.reload();
  await ready(page);
  return { ...opened, before, raw };
}

test('full storage still restores readable review answers and exports them unchanged', async (t) => {
  const opened = await openFullStore(t);
  if (!opened) return;
  const { page, before, raw, problems } = opened;
  assert.equal(await page.locator('[data-plan-unsaved]').isVisible(), true);
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORE), raw, 'loading preserves the stored review');
  assert.deepEqual(await exported(page), before, 'readable answers survive a failed startup write probe');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-plan-download]').click()]);
  assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(), 'utf8')), before);
  assert.deepEqual(problems, []);
});

test('after quota recovery a successful edit clears the warning and survives reload', async (t) => {
  const opened = await openFullStore(t);
  if (!opened) return;
  const { page, problems } = opened;
  await page.evaluate((key) => localStorage.removeItem(key), FILLER);
  await page.locator('input[name="plan-rollout"][value="changes"]').check();
  assert.equal(await page.locator('[data-plan-unsaved]').isVisible(), false, 'a successful save clears the startup warning');
  const beforeReload = await exported(page);
  await page.reload();
  await ready(page);
  assert.deepEqual(await exported(page), beforeReload);
  assert.equal((await exported(page)).answers.find((row) => row.id === 'owner').text, 'Dana');
  assert.deepEqual(problems, []);
});

test('a tab opened with full storage still receives another tab\'s saved answers', async (t) => {
  const opened = await openFullStore(t);
  if (!opened) return;
  const { page, context, problems } = opened;
  const other = await openServed(page.url(), { context });
  await other.page.evaluate((key) => localStorage.removeItem(key), FILLER);
  await other.page.locator('input[name="plan-rollout"][value="reject"]').check();
  await page.waitForFunction(() => document.querySelector('input[name="plan-rollout"][value="reject"]').checked, null, { timeout: 3000 });
  assert.deepEqual(await exported(page), await exported(other.page));
  assert.deepEqual([...problems, ...other.problems], []);
});
