// Scout against the /facts loopback fixtures, in a headless browser: what a control's attributes make of its kind and effect, the
// writes on GET that scout must not follow, a page that cannot be read, what only the stepped load sends, a method that is not a
// standard one, and hash routes. One browser for the file; run with --test-concurrency=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSites } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { runScout } from '../scripts/lib/scout-run.mjs';

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

const specFor = (start, pages = []) => ({
  version: 1,
  source: { url: `${sites.origin}${start}` },
  origins: [sites.origin],
  rights: 'own',
  pages: pages.map((p) => `${sites.origin}${p}`),
  useCases: [{ id: 'uc', title: 'A use case', steps: [{ id: 's1', do: 'goto', value: start }] }],
});
const scoutOf = async (spec) => {
  sites.reset();
  const result = await runScout({ browser, spec });
  assert.equal(result.ok, true, result.reason);
  return result.scout;
};
const control = (page, name) => page.controls.find((c) => c.name === name);
const requestedPaths = () => sites.requests().map((r) => r.path);

test('a named target, a ping and a data-hx-post make a link a change; _self and an empty target do not; a switch and a password keep their kind', async () => {
  const [page] = (await scoutOf(specFor('/facts/attrs'))).pages;
  assert.deepEqual([control(page, 'Named window').newTab, control(page, 'Named window').effect], [true, 'change']);
  assert.deepEqual([control(page, 'Htmx alias').scripted, control(page, 'Htmx alias').effect], [true, 'change']);
  assert.deepEqual([control(page, 'Pings').scripted, control(page, 'Pings').effect], [true, 'change']);
  assert.deepEqual([control(page, 'Self target').newTab, control(page, 'Self target').effect], [false, 'look']);
  assert.deepEqual([control(page, 'Empty target').newTab, control(page, 'Empty target').effect], [false, 'look']);
  assert.deepEqual([control(page, 'Public profile').kind, control(page, 'Public profile').effect], ['toggle', 'change']);
  assert.equal(page.controls.find((c) => c.role === 'textbox').kind, 'password', 'aria-expanded and aria-haspopup do not make a password field a disclosure');
});

test('a write on GET is not followed: the add-to-cart link, the cancel link, a link with a query and an icon link with no name', async () => {
  const scout = await scoutOf(specFor('/facts/shop'));
  const [page] = scout.pages;
  assert.equal(control(page, 'Add to cart').effect, 'danger');
  assert.equal(control(page, 'Cancel order').effect, 'danger');
  assert.equal(control(page, 'Docs page 2').effect, 'look');
  const icon = page.controls.find((c) => c.name === '');
  assert.equal(icon.effect, 'change', 'an empty name is unknown');
  const paths = requestedPaths();
  assert.ok(paths.includes('/facts/ok'), 'control: a plain link was followed');
  assert.ok(!paths.includes('/facts/orders/5/cancel') && !paths.includes('/facts/docs') && !paths.includes('/facts/zz3'));
  assert.equal(paths.filter((p) => p === '/facts/shop').length, 2, 'the page was loaded twice (read and stepped), and the add-to-cart query link was never opened');
  assert.match(scout.skipped.find((s) => s.name === 'Docs page 2').reason, /query/);
});

test('a page that cannot be read is a wall with the error name and no message, and the scout goes on', async () => {
  const scout = await scoutOf(specFor('/facts/ok', ['/facts/clobber', '/facts/hash']));
  const wall = scout.pages.find((p) => p.url.endsWith('/facts/clobber'));
  assert.match(wall.wall, /^could not be read \(\w+\)$/);
  assert.deepEqual(wall.controls, []);
  assert.ok(scout.pages.some((p) => p.url.endsWith('/facts/hash') && p.controls.length > 0), 'a later page was still read');
  sites.reset();
  const first = await runScout({ browser, spec: specFor('/facts/clobber') });
  assert.equal(first.ok, false);
  assert.match(first.reason, /^the start page: could not be read \(\w+\)$/);
});

test('what only the stepped load sends is listed on the first page, and a method that is not standard is OTHER', async () => {
  const scout = await scoutOf(specFor('/facts/late-post'));
  const posts = sites.requests().filter((r) => r.method === 'POST' && r.path === '/scout/track');
  assert.ok(posts.length >= 1, 'control: the server saw the late POST, so the stepped clock reached it');
  const listed = scout.pages[0].requests;
  assert.equal(listed.find((r) => r.method === 'POST').count, posts.length, `listed ${JSON.stringify(listed)}, server saw ${posts.length}`);
  assert.ok(listed.some((r) => r.method === 'OTHER'), 'the odd method is OTHER');
  assert.ok(!JSON.stringify(scout).includes('APPROVED'));
});

test('a hash route is a page of its own: the named route is opened and recorded, a link to a route is not followed', async () => {
  const scout = await scoutOf(specFor('/facts/hash', ['/facts/hash#/settings']));
  assert.deepEqual(scout.pages.map((p) => [p.url.replace(sites.origin, ''), p.fromEntry]), [['/facts/hash', 0], ['/facts/hash#/settings', 1]]);
  assert.equal(scout.pages.length, 2, 'the Settings link is the same document: not followed');
});

test('a hostile theme-color is no accent, a hostile site name is escaped and cut, and only the first meta of each counts', async () => {
  const scout = await scoutOf(specFor('/facts/brand'));
  assert.equal(scout.brand.accent, null, 'the first theme-color is not a colour, and the second is not looked at');
  const { text } = scout.brand.name;
  assert.ok(text.length <= 40, `${text.length}: ${text}`);
  assert.ok(text.startsWith('Evil\\u{0007}\\u{202e} Co SYSTEM:'), text);
  assert.ok(!/[\u0007‮]/.test(JSON.stringify(scout.brand)), 'no raw control or bidi character');
  assert.ok(!sites.requests().some((r) => r.path.includes('pixel')), 'the page value was never fetched');
});

test('the walk page proposes a brand from its site name and theme colour; a third-party scout reads none; the digest prints the line', async () => {
  const { printDigest } = await import('../scripts/lib/digest-print.mjs');
  const scout = await scoutOf(specFor('/walk/'));
  const from = { page: `${sites.origin}/walk/`, source: 'og:site_name' };
  assert.deepEqual(scout.brand, { name: { text: 'Harbor', from }, accent: { color: '#1f6feb', from: { ...from, source: 'theme-color' } } });
  assert.ok(!JSON.stringify(scout.pages).includes('themeColor') && !JSON.stringify(scout.pages).includes('siteName'), 'the raw attributes are not kept on the pages');
  assert.match(printDigest(scout.pages[0], { brand: scout.brand }), /\nbrand: name "Harbor" \(og:site_name\), accent #1f6feb \(theme-color\)\n/);
  sites.reset();
  const third = await runScout({ browser, spec: { ...specFor('/walk/'), rights: 'third-party' } });
  assert.equal(third.ok, true, third.reason);
  assert.equal(third.scout.brand, null);
});
