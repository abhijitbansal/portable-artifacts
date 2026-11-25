// scripts/scout.mjs as a command, for what must not reach the agent: a field value that rides in a control's name (signed in), and a
// wall reason that quotes the page. The command starts its own browser, so this file signs in once in its own, closes it, waits until
// none is left, and then runs commands (the same shape as scout-command.test.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startSites } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { login, saveSession } from '../scripts/lib/session-store.mjs';

const COMMAND = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'scripts', 'scout.mjs');
const WAIT_MS = 15000;
const ESC = String.fromCharCode(27);

let sites;
let data;
let env;
let work;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-leaks-data-'));
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-leaks-work-'));
  env = { ...process.env, CLAUDE_PLUGIN_DATA: data };
  sites = await startSites();
  const browser = await launchBrowser();
  try {
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
    saveSession('fixture', { origins: [sites.origin], state }, env);
  } finally {
    await browser.close();
  }
  for (let waited = 0; liveBrowsers().length > 0 && waited < WAIT_MS; waited += 100) await sleep(100);
  assert.deepEqual(liveBrowsers(), [], 'the sign-in browser did not quit');
});
after(async () => {
  await sites?.close();
  for (const dir of [data, work]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

const run = (args) => new Promise((resolve) => {
  const child = spawn('node', [COMMAND, ...args], { env, cwd: os.tmpdir() });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

function demo(name, start, extra = {}, pages = []) {
  const dir = path.join(work, name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'demo.json');
  fs.writeFileSync(file, JSON.stringify({
    version: 1,
    source: { url: `${sites.origin}${start}` },
    origins: [sites.origin],
    rights: 'own',
    pages: pages.map((p) => `${sites.origin}${p}`),
    useCases: [{ id: 'uc', title: 'A use case', steps: [{ id: 's1', do: 'goto', value: start }] }],
    ...extra,
  }));
  return file;
}

test('signed in: a value that sits in a label, a labelledby target, a select, a textarea, a range or an option is in no output, and a plain label keeps its name', { timeout: 180000 }, async () => {
  sites.reset();
  const file = demo('values', '/login/values', { session: 'fixture' });
  const r = await run([file]);
  assert.equal(r.code, 0, r.stderr);
  const json = fs.readFileSync(path.join(path.dirname(file), 'scout', 'scout.json'), 'utf8');
  const everything = [r.stdout, r.stderr, json].join('\n');
  assert.match(r.stdout, /Agree to terms/, 'control: the page was read and a plain label keeps its name');
  const names = JSON.parse(json).pages[0].controls.map((c) => c.name);
  assert.equal(names.filter((n) => /^<text \d+>$/.test(n)).length, 7, `seven names carried a value (label, labelledby, select, textarea, range, two options): ${JSON.stringify(names)}`);
  assert.deepEqual(everything.match(/SECRET-[A-Z]+-[A-Z]/g) ?? [], [], 'a seed reached an output');
});

test('a wall reason that quotes the page is escaped on stderr and in the JSON line, signed out', { timeout: 180000 }, async () => {
  sites.reset();
  const file = demo('wall-start', '/hostile/wall');
  const plain = await run([file]);
  assert.equal(plain.code, 1);
  assert.match(plain.stderr, /^scout: the start page: reads like a bot check or wall: "captcha/, 'control: the reason quotes the heading');
  assert.ok(!plain.stderr.includes(ESC) && !plain.stderr.includes('‮') && !plain.stderr.includes('​'), 'no raw invisible character on stderr');
  assert.match(plain.stderr, /\\u\{001b\}/);
  assert.ok(plain.stderr.length < 400);
  const asJson = await run([file, '--json']);
  assert.equal(asJson.code, 1);
  assert.ok(!asJson.stdout.includes('‮') && !asJson.stdout.includes('​'), 'no raw bidi or zero-width character in the JSON line');
  assert.equal(JSON.parse(asJson.stdout).ok, false);
});

test('a later page that is a wall is listed with an escaped reason in the --json errors', { timeout: 180000 }, async () => {
  sites.reset();
  const file = demo('wall-later', '/scout/docs', {}, ['/hostile/wall']);
  const r = await run([file, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const body = JSON.parse(r.stdout);
  assert.ok(body.errors.length >= 1, 'control: the wall page is an error entry');
  assert.ok(!r.stdout.includes('‮') && !r.stdout.includes('​') && !r.stdout.includes(ESC));
  assert.match(body.errors[0].message, /\\u\{202e\}|captcha/);
});
