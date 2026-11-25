// scripts/scout.mjs as a command, against the loopback fixtures. The command starts its own browser and refuses to start while another
// is live, so this file holds none open while a command runs: it signs in once (to make a saved session), closes that browser, and
// waits until no headless browser is left. Commands run with spawn (async), so the in-process fixture server can answer them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startSites, PRIVATE_SEEDS } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { login, saveSession } from '../scripts/lib/session-store.mjs';

const COMMAND = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), 'scripts', 'scout.mjs');
const WAIT_MS = 15000;

let sites;
let data;
let env;
let work;
let state;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-scout-data-'));
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-scout-work-'));
  env = { ...process.env, CLAUDE_PLUGIN_DATA: data };
  sites = await startSites();
  const browser = await launchBrowser();
  try {
    state = await login({
      browser,
      url: `${sites.origin}/login/`,
      origins: [sites.origin],
      untilDone: async (page) => {
        await page.fill('#user', 'maria');
        await page.fill('#pass', 'not-a-real-password');
        await Promise.all([page.waitForURL('**/login/home'), page.click('button[type=submit]')]);
      },
    });
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

/** A demo folder with a demo.json for `start`; returns its file. */
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
const filesUnder = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));

test('signed out: prints each page, then the path of scout.json; writes the pictures and scout.json; drops an old picture', { timeout: 180000 }, async () => {
  sites.reset();
  const file = demo('out', '/scout/docs', {}, ['/danger/']);
  fs.mkdirSync(path.join(path.dirname(file), 'scout'));
  fs.writeFileSync(path.join(path.dirname(file), 'scout', 'p9.jpg'), 'an old picture');
  const r = await run([file]);
  assert.equal(r.code, 0, r.stderr);
  const out = path.join(path.dirname(file), 'scout', 'scout.json');
  const lines = r.stdout.trimEnd().split('\n');
  assert.equal(lines.at(-1), out, 'the path of scout.json is the last line');
  assert.match(r.stdout, /^p1 /m);
  assert.match(r.stdout, /^p2 /m);
  const scout = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(scout.pages.length >= 2, 'the start page and the named page at least');
  const usable = scout.pages.filter((p) => p.wall === null);
  assert.ok(usable.length >= 2 && usable.length <= scout.pages.length);
  const pictures = usable.map((p) => `${p.id}.jpg`);
  assert.deepEqual(fs.readdirSync(path.dirname(out)).sort(), [...pictures, 'scout.json'].sort(), 'one picture per usable page; the old p9.jpg is gone');
  assert.deepEqual(scout.pages.map((p) => p.shot), scout.pages.map((p) => (p.wall === null ? `scout/${p.id}.jpg` : null)));
  assert.deepEqual(scout.named, [`${sites.origin}/danger/`]);
  assert.equal(r.stderr, '');
});

test('--json prints one line { ok, out, pages, errors } and no digest', { timeout: 180000 }, async () => {
  sites.reset();
  const file = demo('json', '/scout/docs');
  const r = await run([file, '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trimEnd().split('\n').length, 1);
  const body = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(body).sort(), ['errors', 'ok', 'out', 'pages']);
  assert.equal(body.ok, true);
  assert.equal(body.out, path.join(path.dirname(file), 'scout', 'scout.json'));
  assert.equal(body.pages, JSON.parse(fs.readFileSync(body.out, 'utf8')).pages.length);
  assert.ok(body.pages >= 2);
  const unusable = JSON.parse(fs.readFileSync(body.out, 'utf8')).pages.filter((p) => p.controls.length === 0 && p.wall !== null);
  assert.deepEqual(body.errors.map((e) => e.message), unusable.map((p) => `${p.id}: ${p.wall}`), 'a page that could not be used is an error entry, the scout still succeeds');
  assert.ok(body.errors.every((e) => /^pages\[\d+\]$/.test(e.path)));
});

test('a spec with errors: exit 1, the errors, nothing written', async () => {
  const file = demo('bad', '/scout/docs', { rights: undefined });
  const r = await run([file]);
  assert.equal(r.code, 1);
  assert.match(r.stdout + r.stderr, /rights/);
  assert.ok(!fs.existsSync(path.join(path.dirname(file), 'scout')));
  const j = await run([file, '--json']);
  assert.equal(j.code, 1);
  assert.equal(JSON.parse(j.stdout).ok, false);
});

test('a wall on the first page: exit 1, one line with the reason, nothing written', async () => {
  sites.reset();
  const file = demo('wall', '/wall/');
  const r = await run([file]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr.trimEnd().split('\n').length, 1);
  assert.match(r.stderr, /status 403/);
  assert.ok(!fs.existsSync(path.join(path.dirname(file), 'scout')));
});

test('usage: --help exits 0 with the usage line, an unknown flag exits 2', async () => {
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /usage: node scripts\/scout\.mjs <demo\.json> \[--json\]/);
  const bad = await run(['--nope']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /usage: node scripts\/scout\.mjs/);
});

test('a spec that names a session nobody saved: exit 2 with how to sign in', async () => {
  const file = demo('nosession', '/login/home', { session: 'nobody' });
  const r = await run([file]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /session\.mjs login/);
});

test('signed in: no private value, no cookie value and no picture in stdout, stderr or any file under the demo folder', { timeout: 180000 }, async () => {
  sites.reset();
  await fetch(`${sites.origin}/login/signin`, { method: 'POST', redirect: 'manual' }); // the fixture answers a cookie only while its signed-in flag is up
  saveSession('fixture', { origins: [sites.origin], state }, env);
  const file = demo('signed', '/login/home', { session: 'fixture' });
  const r = await run([file]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Switch to <email>/, 'control: the page was read');
  const files = filesUnder(path.dirname(file));
  assert.ok(files.some((f) => f.endsWith('scout.json')));
  assert.ok(!files.some((f) => f.endsWith('.jpg')), 'no picture');
  const everything = [r.stdout, r.stderr, ...files.map((f) => fs.readFileSync(f, 'utf8'))].join('\n');
  for (const seed of [...PRIVATE_SEEDS, 'fixture-session']) assert.ok(!everything.includes(seed), `leaked: ${seed}`);
});

test('an expired session: exit 1, "not signed in", and the earlier scout.json is untouched byte for byte', { timeout: 180000 }, async () => {
  sites.reset();
  const expired = { ...state, cookies: state.cookies.map((c) => ({ ...c, value: 'expired' })) };
  saveSession('expired', { origins: [sites.origin], state: expired }, env);
  const file = demo('expired', '/login/home', { session: 'expired' });
  const folder = path.join(path.dirname(file), 'scout');
  fs.mkdirSync(folder);
  const earlier = Buffer.from('{"earlier":"scout"}\n');
  fs.writeFileSync(path.join(folder, 'scout.json'), earlier);
  fs.writeFileSync(path.join(folder, 'p1.jpg'), 'earlier picture');
  const r = await run([file]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr.trimEnd().split('\n').length, 1);
  assert.match(r.stderr, /not signed in/);
  assert.ok(fs.readFileSync(path.join(folder, 'scout.json')).equals(earlier));
  assert.equal(fs.readFileSync(path.join(folder, 'p1.jpg'), 'utf8'), 'earlier picture');
  assert.deepEqual(fs.readdirSync(folder).sort(), ['p1.jpg', 'scout.json']);
});
