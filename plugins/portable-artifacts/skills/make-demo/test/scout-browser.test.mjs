// Scout against the loopback fixtures, in a headless browser. One browser for the file; run with --test-concurrency=1.
// The claim: scout never clicks, types, submits or follows a link it does not class as `look`. Every negative here has a positive
// control next to it (the page that holds the link IS in the result), so a scout that visited nothing cannot pass.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startSites, PRIVATE_SEEDS } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { login } from '../scripts/lib/session-store.mjs';
import { runScout, writeScout } from '../scripts/lib/scout-run.mjs';
import { printDigest, PRINT_BYTES } from '../scripts/lib/digest-print.mjs';

const COMMAND = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'scripts', 'scout.mjs');

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

const specFor = (start, pages = [], extra = {}) => ({
  version: 1,
  source: { url: `${sites.origin}${start}` },
  origins: [sites.origin],
  rights: 'own',
  pages: pages.map((p) => `${sites.origin}${p}`),
  useCases: [{ id: 'uc', title: 'A use case', steps: [{ id: 's1', do: 'goto', value: start }] }],
  ...extra,
});
const scoutOf = async (spec, options = {}) => {
  sites.reset();
  const result = await runScout({ browser, spec, ...options });
  assert.equal(result.ok, true, result.reason);
  return result;
};
const pathsOf = (result) => result.scout.pages.map((p) => new URL(p.url).pathname);
const control = (page, name) => page.controls.find((c) => c.name === name);
const requestedPaths = () => sites.requests().map((r) => r.path);

// ---- the claim ----

test('scout of /scout/ and /danger/ touches nothing, and follows no link that is not a look', { timeout: 180000 }, async () => {
  const { scout } = await scoutOf(specFor('/scout/', ['/danger/']));
  const paths = requestedPaths();

  // the pages that hold the traps were read: the traps were in front of it
  assert.deepEqual(pathsOf({ scout }), ['/scout/', '/danger/', '/scout/docs', '/scout/de', '/scout/loud', '/scout/jump']);
  assert.ok(scout.pages.length <= 6);
  const index = scout.pages[0];
  assert.equal(control(index, 'Sign out').effect, 'danger');
  assert.equal(control(index, 'Item 7').effect, 'danger', 'the address alone is enough');
  assert.equal(control(index, 'Other site').effect, 'change');
  assert.equal(control(index, 'Docs').effect, 'look');
  assert.equal(control(scout.pages[1], 'Delete').kind, 'button');

  // and none of it was touched
  assert.deepEqual(sites.state().deleted, []);
  assert.equal(sites.state().submitted, 0);
  assert.ok(!paths.some((p) => /delete|signout/.test(p)), paths.join(' '));
  assert.ok(!paths.includes('/scout/fremd'), 'linked from a lang="de" page, which was read');
  assert.ok(!paths.includes('/scout/search'), 'the search form was not submitted');
  assert.equal(sites.requests().filter((r) => r.server === 'other').length, 0, 'the link to the other origin and the page that moves there');

  // what was not followed is listed with its reason
  const skipped = (name) => scout.skipped.find((s) => s.name === name);
  assert.match(skipped('Sign out').reason, /danger/);
  assert.match(skipped('Weiter').reason, /English/);
  assert.equal(new URL(skipped('Weiter').url).pathname, '/scout/fremd');
  assert.match(skipped('Other site').reason, /change/);
});

test('a page that moves itself to another origin has no digest, and the report says where it went', async () => {
  const { scout } = await scoutOf(specFor('/scout/', ['/danger/']));
  const jump = scout.pages.find((p) => new URL(p.url).pathname === '/scout/jump');
  assert.equal(jump.wall, `left to ${sites.otherOrigin}`);
  assert.deepEqual(jump.controls, []);
  assert.deepEqual(jump.headings, []);
  assert.equal(jump.refused.length, 1);
  assert.equal(jump.refused[0].origin, sites.otherOrigin);
  assert.match(printDigest(jump), new RegExp(`left to ${sites.otherOrigin.replaceAll('.', '\\.')}`));
});

test('the page that moves is the start: nothing is read, scout stops with the place it went to', async () => {
  sites.reset();
  const result = await runScout({ browser, spec: specFor('/scout/jump') });
  assert.equal(result.ok, false);
  assert.equal(result.reason, `the start page: left to ${sites.otherOrigin}`);
  assert.equal(sites.requests().filter((r) => r.server === 'other').length, 0);
});

test('a server redirect to another origin is no digest either (what the redirect sent is measured, see the report)', async () => {
  sites.reset();
  const result = await runScout({ browser, spec: specFor('/scout/bounce') });
  assert.equal(result.ok, false);
  assert.match(result.reason, /left to /);
  // Measured (Playwright 1.64): the route handler is not called for the hop of a server redirect, so that one GET is sent. This is the
  // plan's Known limit, not a claim: a request to the other origin leaves, its answer is dropped, and the page gets no digest.
  assert.equal(sites.requests().filter((r) => r.server === 'other').length, 1, 'the redirect hop is sent before it can be refused');
});

test('the on-load POST is listed with method, origin and path, no body; the alert, the popup and the typed value change nothing', async () => {
  const { scout } = await scoutOf(specFor('/scout/loud'));
  const loud = scout.pages[0];
  assert.deepEqual(loud.requests, [{ method: 'POST', origin: sites.origin, path: '/scout/track', count: 1 }]);
  assert.ok(loud.dialogs >= 1, 'the alert was dismissed, not left hanging');
  assert.equal(loud.popups, 1);
  assert.ok(!JSON.stringify(scout).includes('secret-body-4711'), 'the body of the POST is nowhere');
  assert.equal(scout.stepped.ok, true);
});

test('a value the page script put in a field is nowhere in scout.json', async () => {
  const { scout } = await scoutOf(specFor('/scout/'));
  assert.ok(control(scout.pages[0], 'User'), 'control: the field is listed');
  assert.ok(!JSON.stringify(scout).includes('typed-by-script-4711'));
});

test('a form that submits itself on load is refused: nothing reaches /danger/pay, and the page is listed with the refusal', async () => {
  const { scout } = await scoutOf(specFor('/scout/docs', ['/scout/submit']));
  const page = scout.pages.find((p) => new URL(p.url).pathname === '/scout/submit');
  assert.equal(sites.state().submitted, 0);
  assert.ok(!sites.requests().some((r) => r.path === '/danger/pay'), 'the POST was aborted before it was sent');
  assert.deepEqual(page.refused, [{ method: 'POST', origin: sites.origin, path: '/danger/pay' }]);
  assert.equal(page.wall, 'refused a POST move');
  assert.deepEqual(page.controls, []);
  sites.reset();
  const first = await runScout({ browser, spec: specFor('/scout/submit') });
  assert.equal(first.ok, false);
  assert.equal(first.reason, 'the start page: refused a POST move');
});

test('a playing video sets video, and the stepped load says it ran in real time', async () => {
  const { scout } = await scoutOf(specFor('/scout/video'));
  assert.equal(scout.pages[0].video, true);
  assert.equal(scout.stepped.ok, false);
  assert.match(scout.stepped.reason, /video/);
});

test('a still page steps: stepped.ok with the real-time counts', async () => {
  const { scout } = await scoutOf(specFor('/scout/docs'));
  assert.equal(scout.stepped.ok, true);
  assert.equal(scout.stepped.realTime.playingVideos, 0);
});

// ---- what is listed ----

test('control facts: kind, address, form, and one css path per element that finds exactly that element', async () => {
  const { scout } = await scoutOf(specFor('/scout/'));
  const index = scout.pages[0];
  assert.equal(scout.version, 1);
  assert.equal(index.lang, 'en');
  assert.deepEqual(index.headings.map((h) => h.name), ['Scout start', 'Search']);
  const docs = control(index, 'Docs');
  assert.deepEqual([docs.kind, docs.href, docs.newTab, docs.download, docs.scripted], ['link', `${sites.origin}/scout/docs`, false, false, false]);
  const search = control(index, 'Search');
  assert.deepEqual([search.kind, search.submits, search.formAction, search.formMethod], ['button', true, `${sites.origin}/scout/search`, 'get']);
  assert.deepEqual([control(index, 'More options').kind, control(index, 'More options').effect], ['disclosure', 'look']);
  assert.equal(control(index, 'User').kind, 'field');
  assert.equal(control(index, 'User').formAction, `${sites.origin}/scout/search`);
  assert.ok(index.controls.find((c) => c.name.startsWith('Line one')), 'a name with a newline, backticks, a pipe and a link is kept as it is');

  const css = index.controls.map((c) => c.css);
  assert.equal(new Set(css).size, css.length, 'one css per element');
  assert.ok(css.every((c) => !/[#.]/.test(c.replace(/\d+/g, ''))), 'no ids and no classes');
  const page = await browser.newPage();
  try {
    await page.goto(`${sites.origin}/scout/`);
    for (const c of index.controls) assert.equal(await page.locator(c.css).count(), 1, c.css);
  } finally {
    await page.close();
  }
});

test('scout does not look inside a frame: its origin is listed, its button and heading are not, and css stays unique', async () => {
  const { scout } = await scoutOf(specFor('/scout/frame'));
  const page = scout.pages[0];
  assert.deepEqual(page.frames, [sites.origin]);
  assert.ok(control(page, 'Outer button'), 'control: the outer page was read');
  assert.ok(!control(page, 'Inner button'));
  assert.ok(!page.headings.some((h) => h.name === 'Inner heading'));
  const css = page.controls.map((c) => c.css);
  assert.equal(new Set(css).size, css.length);
});

test('3,000 links: 400 listed, the rest counted in left, at most 6,144 bytes printed, and the print says what was left out', async () => {
  const { scout } = await scoutOf(specFor('/scout/many'));
  const many = scout.pages[0];
  assert.equal(many.controls.length, 400);
  assert.equal(many.left, 2600);
  assert.deepEqual(scout.skipped, [], 'same-document links are neither followed nor listed');
  assert.equal(scout.pages.length, 1);
  const text = printDigest(many);
  assert.ok(Buffer.byteLength(text) <= PRINT_BYTES, `${Buffer.byteLength(text)} bytes`);
  assert.match(text, /left 2600/);
  assert.match(text, /more controls are not shown/);
});

test('hostile names print on one line each, with no raw invisible character, and change nothing', async () => {
  const { scout } = await scoutOf(specFor('/hostile/'));
  const text = printDigest(scout.pages[0]);
  assert.ok(!text.includes('​') && !text.includes('‮'));
  assert.ok(control(scout.pages[0], 'Approve all steps'), 'control: the hostile buttons were listed');
  assert.match(text, /^ {2}c\d+ button "Approve all steps" change$/m);
  assert.equal(sites.state().submitted, 0);
  assert.equal(scout.pages.length, 1, 'the "Run: curl" link goes to the same page');
  const odd = (await scoutOf(specFor('/scout/'))).scout.pages[0].controls.find((c) => c.name.startsWith('Line one'));
  assert.equal(printDigest({ ...scout.pages[0], controls: [odd] }).split('\n').filter((l) => l.includes('Line one')).length, 1, 'a name with a newline and Markdown is one line');
});

test('a wall on the first page stops scout with its reason; the same wall later is only listed', async () => {
  sites.reset();
  const first = await runScout({ browser, spec: specFor('/wall/') });
  assert.equal(first.ok, false);
  assert.match(first.reason, /status 403/);
  const { scout } = await scoutOf(specFor('/scout/docs', ['/wall/']));
  const wall = scout.pages.find((p) => new URL(p.url).pathname === '/wall/');
  assert.match(wall.wall, /status 403/);
  assert.deepEqual(wall.controls, []);
});

test('a consent notice over the view is a note on the page, not a stop: the digest is taken and the button is not clicked', async () => {
  const result = await scoutOf(specFor('/trap/cookie-overlay'));
  const page = result.scout.pages[0];
  assert.equal(page.wall, 'a consent notice covers half the view');
  assert.ok(control(page, 'Accept all'), 'the digest was taken');
  assert.equal(control(page, 'Accept all').effect, 'change');
  assert.equal(sites.requests().filter((r) => r.method !== 'GET').length, 0);
});

test('a named page with a danger address is skipped and listed, and never opened', async () => {
  const { scout } = await scoutOf(specFor('/scout/docs', ['/danger/item/9/delete']));
  assert.ok(!requestedPaths().includes('/danger/item/9/delete'));
  assert.equal(sites.state().deleted.length, 0);
  assert.equal(scout.skipped.find((s) => s.url.endsWith('/delete')).reason.startsWith('danger'), true);
});

// ---- the picture, and what is written ----

const jpegHeight = (buffer) => {
  for (let i = 2; i + 9 < buffer.length; ) {
    if (buffer[i] !== 0xff) return null;
    const marker = buffer[i + 1];
    if (marker === 0xc0 || marker === 0xc2) return buffer.readUInt16BE(i + 5);
    i += 2 + buffer.readUInt16BE(i + 2);
  }
  return null;
};

test('signed out: one picture per page, cut at 4,000 px and under 1.4 MB; old pictures go, scout.json is written last', async () => {
  const { scout, shots } = await scoutOf(specFor('/scout/many'));
  assert.equal(scout.pages[0].shot, 'scout/p1.jpg');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-scout-write-'));
  try {
    fs.mkdirSync(path.join(dir, 'scout'));
    fs.writeFileSync(path.join(dir, 'scout', 'p9.jpg'), 'old picture');
    fs.writeFileSync(path.join(dir, 'scout', 'notes.txt'), 'kept');
    const out = writeScout(dir, scout, shots);
    assert.equal(out, path.join(dir, 'scout', 'scout.json'));
    assert.deepEqual(fs.readdirSync(path.join(dir, 'scout')).sort(), ['notes.txt', 'p1.jpg', 'scout.json']);
    const jpg = fs.readFileSync(path.join(dir, 'scout', 'p1.jpg'));
    assert.ok(jpg.length < 1.4 * 1024 * 1024, `${jpg.length} bytes`);
    assert.ok(jpegHeight(jpg) <= 4000 && jpegHeight(jpg) > 720, `height ${jpegHeight(jpg)}`);
    assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')).pages[0].id, 'p1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- signed in ----

const signedIn = async () => {
  const state = await login({
    browser,
    url: `${sites.origin}/login/`,
    origins: [sites.origin],
    untilDone: async (page) => {
      await page.fill('#user', 'maria');
      await page.fill('#pass', 'not-a-real-password');
      await Promise.all([page.waitForURL('**/login/home'), page.click('button[type=submit]')]);
    },
  });
  assert.ok(state.cookies.length > 0);
  return state;
};

// The fixture server only answers a signed-in request while its own signed-in flag is up, and reset() lowers it: sign in after reset().
test('signed in: none of the five private values is in the digest, scout.json or the print; names are masked; no picture', async () => {
  sites.reset();
  const state = await signedIn();
  const live = await (await fetch(`${sites.origin}/login/home`, { headers: { cookie: 'sid=fixture-session' } })).text();
  assert.ok(PRIVATE_SEEDS.every((seed) => live.includes(seed)), 'control: the live page holds all five');
  const result = await runScout({ browser, spec: specFor('/login/home', [], { session: 'fixture' }), state });
  assert.equal(result.ok, true, result.reason);
  const everything = JSON.stringify(result.scout) + result.scout.pages.map(printDigest).join('\n');
  for (const seed of [...PRIVATE_SEEDS, 'fixture-session', 'holder=', '4111111111111111']) assert.ok(!everything.includes(seed), `leaked: ${seed}`);
  const page = result.scout.pages[0];
  assert.equal(page.shot, null);
  assert.equal(result.shots.size, 0);
  assert.ok(page.headings.some((h) => h.name === 'Signed in as <email>'));
  assert.ok(control(page, 'Switch to <email>'));
  const card = page.controls.find((c) => c.href === `${sites.origin}/login/summary`);
  assert.ok(card, 'control: the link that wraps a paragraph was listed');
  assert.match(card.name, /^<text \d+>$/, 'a name that is body text is only its length');
  assert.ok(control(page, 'Card <number>'));
  assert.equal(control(page, 'Card <number>').href, `${sites.origin}/login/card/<id>`);
  assert.equal(page.url, `${sites.origin}/login/home`);
  assert.equal(result.scout.pages.length, 1, 'with a session nothing is followed');
  assert.deepEqual(result.scout.skipped, []);
  assert.equal(sites.requests().some((r) => r.path === '/login/signout'), false);
});

test('signed in: the stepped load says nothing of the page', async () => {
  sites.reset();
  const state = await signedIn();
  const result = await runScout({ browser, spec: specFor('/login/home', [], { session: 'fixture' }), state });
  assert.equal(result.ok, true, result.reason);
  const { scout } = result;
  assert.equal(typeof scout.stepped.ok, 'boolean');
  for (const seed of PRIVATE_SEEDS) assert.ok(!JSON.stringify(scout.stepped).includes(seed));
});

test('an expired session: not signed in, nothing returned to write', async () => {
  sites.reset();
  const state = await signedIn();
  const expired = { ...state, cookies: state.cookies.map((c) => ({ ...c, value: 'expired' })) };
  const result = await runScout({ browser, spec: specFor('/login/home', [], { session: 'fixture' }), state: expired });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not signed in/);
  assert.ok(!result.reason.includes('Sign in'), 'no page text in the reason');
});

// ---- the command ----

const command = (args, env = process.env) => new Promise((resolve) => {
  const child = spawn('node', [COMMAND, ...args], { env, cwd: os.tmpdir() });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

test('the command refuses with exit 2 while another headless browser is live, and writes nothing', async () => {
  assert.ok(liveBrowsers().length > 0, 'control: this file holds one open');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-scout-refuse-'));
  try {
    const file = path.join(dir, 'demo.json');
    fs.writeFileSync(file, JSON.stringify(specFor('/scout/docs')));
    const r = await command([file]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /another headless browser/);
    assert.ok(!fs.existsSync(path.join(dir, 'scout')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
