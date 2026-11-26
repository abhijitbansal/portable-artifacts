// openVisit's opt-ins (scale, posts, downloads) and its defaults, in a headless browser on loopback fixtures.
// One browser for the file; run with --test-concurrency=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSites } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { openVisit } from '../scripts/lib/visit.mjs';

const VIEWPORT = { width: 1280, height: 720 };
const READY_MS = 5000;

let sites;
let browser;
before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  sites = await startSites();
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  await sites?.close();
});

async function open(options = {}) {
  sites.reset();
  const visit = await openVisit(browser, { viewport: VIEWPORT, origins: [sites.origin], ...options });
  await visit.page.goto(`${sites.origin}/take/`, { waitUntil: 'load' });
  return visit;
}

const submit = (page, name) => page.getByRole('button', { name }).click({ timeout: READY_MS });

test('with the defaults a same-origin form post is refused, and it never reaches the server', async () => {
  const { context, page, seen } = await open();
  await submit(page, 'Save note').catch(() => {});
  assert.deepEqual(seen.refused, [{ method: 'POST', origin: sites.origin, path: '/take/save' }]);
  assert.deepEqual(sites.saves(), []);
  await context.close();
});

test('with posts on a same-origin form post goes through and is listed as a write; a post to another origin is still refused', async () => {
  const { context, page, seen } = await open({ posts: true });
  await submit(page, 'Save note');
  await page.waitForURL('**/take/saved.html', { timeout: READY_MS });
  assert.equal(sites.saves().length, 1);
  assert.deepEqual(seen.refused, []);
  assert.ok(seen.writes.has(`POST ${sites.origin}/take/save`));

  await page.goBack({ waitUntil: 'load' });
  await submit(page, 'Send away').catch(() => {});
  assert.equal(seen.refused.length, 1);
  assert.equal(seen.refused[0].origin, sites.otherOrigin);
  assert.equal(sites.requests().filter((r) => r.server === 'other').length, 0);
  await context.close();
});

test('with the defaults a download is refused and counted; no queue exists', async () => {
  const { context, page, seen } = await open();
  await page.getByRole('link', { name: 'Get file' }).click({ timeout: READY_MS });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(seen.downloads, 1);
  assert.equal('downloadQueue' in seen, false);
  await context.close();
});

test('with downloads on each download is queued for the caller and still counted', async () => {
  const { context, page, seen } = await open({ downloads: true });
  await page.getByRole('link', { name: 'Get file' }).click({ timeout: READY_MS });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(seen.downloads, 1);
  assert.equal(seen.downloadQueue.length, 1);
  assert.equal(seen.downloadQueue[0].suggestedFilename(), 'file.txt');
  await context.close();
});

test('scale is the context device scale factor, 1 by default', async () => {
  const one = await open();
  assert.equal(await one.page.evaluate(() => window.devicePixelRatio), 1);
  await one.context.close();
  const three = await open({ scale: 3 });
  assert.equal(await three.page.evaluate(() => window.devicePixelRatio), 3);
  await three.context.close();
});
