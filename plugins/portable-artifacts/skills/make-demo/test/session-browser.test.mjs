// Sign-in state against the loopback login fixture, in a headless browser. One browser for the file; run with --test-concurrency=1.
// The visible window of the real command is not tested here: `untilDone` is the seam, and these tests fill the form in its place.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startSites } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { login, saveSession, readSession, sessionFile, untilClosed } from '../scripts/lib/session-store.mjs';

const COMMAND = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'scripts', 'session.mjs');
const SESSION_VALUE = 'fixture-session';

let sites;
let browser;
let data;
let env;
before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-session-browser-'));
  env = { ...process.env, CLAUDE_PLUGIN_DATA: data };
  sites = await startSites();
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
  await sites?.close();
  if (data) fs.rmSync(data, { recursive: true, force: true });
});

/** The stand-in for the person: fill and submit the fixture's form, and put one value in localStorage. */
const signInByForm = async (page) => {
  await page.fill('#user', 'maria');
  await page.fill('#pass', 'not-a-real-password');
  await Promise.all([page.waitForURL('**/login/home'), page.click('button[type=submit]')]);
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
};

test('login returns the state of a filled and submitted form; stored and read back it opens /login/home', async () => {
  sites.reset();
  const state = await login({ browser, url: `${sites.origin}/login/`, origins: [sites.origin], untilDone: signInByForm });
  assert.ok(state.cookies.some((c) => c.value === SESSION_VALUE), 'the cookie is in the state');
  assert.equal(saveSession('fixture', { origins: [sites.origin], state }, env), 1);

  const context = await browser.newContext({ storageState: readSession('fixture', [sites.origin], env) });
  try {
    const page = await context.newPage();
    await page.goto(`${sites.origin}/login/home`);
    assert.equal(new URL(page.url()).pathname, '/login/home', 'not sent back to the sign-in page');
    assert.equal(await page.textContent('h1'), 'Account');
    assert.equal(await page.evaluate(() => localStorage.getItem('theme')), 'dark', 'localStorage of the origin comes back too');
  } finally {
    await context.close();
  }
});

test('login still reads the state after untilDone closed the last page of the context', async () => {
  sites.reset();
  const state = await login({
    browser,
    url: `${sites.origin}/login/`,
    origins: [sites.origin],
    untilDone: async (page) => { await signInByForm(page); await page.close(); },
  });
  assert.ok(state.cookies.some((c) => c.value === SESSION_VALUE));
  assert.ok(state.origins.some((o) => o.origin === sites.origin && o.localStorage.some((e) => e.name === 'theme')));
});

test('login without a sign-in has no cookie to keep', async () => {
  sites.reset();
  const state = await login({ browser, url: `${sites.origin}/login/`, origins: [sites.origin], untilDone: async () => {} });
  assert.equal(state.cookies.length, 0);
});

test('untilClosed resolves when the last page of the context closes, and not before', async () => {
  const context = await browser.newContext();
  try {
    const first = await context.newPage();
    const second = await context.newPage();
    let done = false;
    const waiting = untilClosed(first).then(() => { done = true; });
    await first.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(done, false, 'one page is still open');
    await second.close();
    await waiting;
    assert.equal(done, true);
  } finally {
    await context.close();
  }
});

test('untilClosed ends with an error when the time is up', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await assert.rejects(untilClosed(page, { timeoutMs: 50 }), /timed out/);
  } finally {
    await context.close();
  }
});

test('no command prints the cookie: list and forget on a stored session show no part of it', async () => {
  sites.reset();
  const state = await login({ browser, url: `${sites.origin}/login/`, origins: [sites.origin], untilDone: signInByForm });
  saveSession('printed', { origins: [sites.origin], state }, env);
  assert.ok(fs.readFileSync(sessionFile('printed', env), 'utf8').includes(SESSION_VALUE), 'control: the value is in the file');
  for (const args of [['list'], ['forget', 'printed'], ['forget', 'printed'], ['--help']]) {
    const r = spawnSync('node', [COMMAND, ...args], { encoding: 'utf8', env, cwd: os.tmpdir() });
    assert.ok(!r.stdout.includes(SESSION_VALUE) && !r.stderr.includes(SESSION_VALUE), `${args.join(' ')} printed the value`);
    assert.ok(!r.stdout.includes('theme') && !r.stderr.includes('theme'), `${args.join(' ')} printed storage`);
  }
});
