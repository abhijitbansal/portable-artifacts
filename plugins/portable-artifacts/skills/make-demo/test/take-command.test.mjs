// scripts/take.mjs as a command, against the loopback fixtures. The command starts its own browser and refuses to start while another is
// live, so this file holds none open while a command runs (it signs in once, closes that browser, and waits until none is left) and runs
// the commands one at a time with spawn (async: the in-process fixture server must answer them). A fake `pgrep` first on PATH records
// whether the command looked for a live browser, so a refusal can be shown to come before any browser start.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startSites, PRIVATE_SEEDS } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { login, saveSession } from '../scripts/lib/session-store.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPLAINER = path.resolve(SKILL, '..', 'make-explainer');
const script = (name) => path.join(SKILL, 'scripts', `${name}.mjs`);
const { planHash } = await import(pathToFileURL(path.join(EXPLAINER, 'scripts/lib/plan-hash.mjs')).href);
const WAIT_MS = 15000;
const JPEG_LIMIT = 1.4 * 1024 * 1024;
const REPORT_LIMIT = 6144;
const VIEWPORT = { width: 800, height: 500 };
const TALL_VIEWPORT = { width: 800, height: 900 };
const T = { timeout: 300000 };
const REAL_TIME_SENTENCE = /this page cannot be filmed frame by frame; real-time capture is not built yet/;

let sites;
let work;
let data;
let fakeBin;
let state;
let main;
let marks = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function quiet() {
  for (let waited = 0; liveBrowsers().length > 0 && waited < WAIT_MS; waited += 100) await sleep(100);
  assert.deepEqual(liveBrowsers(), [], 'a headless browser is still running');
}

const run = (file, args, env = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [file, ...args], { cwd: os.tmpdir(), env: { ...process.env, CLAUDE_PLUGIN_DATA: data, ...env } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

/** A take run with a fake pgrep first on PATH: `mark` is the file it appends to when the command looks for a live browser. */
async function runWatched(args, { live = false } = {}) {
  marks += 1;
  const mark = path.join(work, `pgrep-${marks}.log`);
  const r = await run(script('take'), args, { PATH: `${fakeBin}${path.delimiter}${process.env.PATH}`, PGREP_MARK: mark, PGREP_MODE: live ? 'live' : 'none' });
  return { ...r, looked: fs.existsSync(mark) };
}

const goto = (id, value) => ({ id, do: 'goto', value });
const by = (role, name) => ({ role, name });
const MAIN_STEPS = [
  goto('g', '/take/'),
  { id: 't', do: 'type', target: by('textbox', 'Your name'), value: 'Ada' },
  { id: 'c', do: 'click', target: by('button', 'Reveal') },
  goto('g2', '/take/'),
  { id: 'f', do: 'click', target: by('button', 'Save note') },
];
const demoSpec = (steps, extra = {}) => ({
  version: 1,
  source: { url: `${sites.origin}/take/` },
  origins: [sites.origin],
  rights: 'own',
  viewport: VIEWPORT,
  useCases: [{ id: 'uc', title: 'The take page', goal: 'Film it', steps }],
  ...extra,
});
const writeSpec = (dir, spec) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'demo.json'), JSON.stringify(spec)); return path.join(dir, 'demo.json'); };
const copyOf = (from, name) => { const dir = path.join(work, name); fs.cpSync(from, dir, { recursive: true }); return dir; };
const read = (...parts) => JSON.parse(fs.readFileSync(path.join(...parts), 'utf8'));

/** Scout, build and approve a demo in work/<name>: the folder a take starts from. Returns { dir, file, answers }. */
async function approved(name, spec, { verdict = 'approve', signedIn = false } = {}) {
  sites.reset();
  if (signedIn) await fetch(`${sites.origin}/login/signin`, { method: 'POST', redirect: 'manual' });
  const dir = path.join(work, name);
  const file = writeSpec(dir, spec);
  const scouted = await run(script('scout'), [file]);
  assert.equal(scouted.code, 0, scouted.stderr);
  await quiet();
  const built = await run(script('build'), [file, '--out', path.join(dir, 'out')]);
  assert.equal(built.code, 0, built.stdout + built.stderr);
  await quiet();
  const plan = read(dir, 'click-plan.json');
  const answers = path.join(dir, 'answers.json');
  fs.writeFileSync(answers, JSON.stringify({
    schema: 'plan-answers/1', planKey: plan.key, planHash: planHash(plan), reviewer: 'Tester', verdict,
    answers: plan.sections.filter((s) => s.type === 'approval').map((s) => ({ id: s.id, kind: 'approval', answered: true, choice: 'approve' })),
  }));
  return { dir, file, answers, plan };
}

const everyText = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && /\.(json|html|md)$/.test(e.name))
  .map((e) => fs.readFileSync(path.join(e.parentPath, e.name), 'utf8'));
const isJpeg = (buf) => buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
const jpegSize = (buf) => {
  for (let i = 2; i + 9 < buf.length; ) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
};

before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-take-cmd-work-'));
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-take-cmd-data-'));
  fakeBin = path.join(work, 'fakebin');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'pgrep'), '#!/bin/sh\necho "$@" >> "$PGREP_MARK"\nif [ "$PGREP_MODE" = live ]; then echo "4242 chrome-headless-shell --fake"; exit 0; fi\nexit 1\n', { mode: 0o755 });
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
  await quiet();
  saveSession('fixture', { origins: [sites.origin], state }, { ...process.env, CLAUDE_PLUGIN_DATA: data });
  main = await approved('main', demoSpec(MAIN_STEPS));
});
after(async () => {
  await sites?.close();
  for (const dir of [work, data]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

// ---- usage and refusals: no browser starts ----

test('usage: --help exits 0 with the usage line; an unknown flag, no demo file and no --answers exit 2', async () => {
  const help = await run(script('take'), ['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /usage: node scripts\/take\.mjs <demo\.json> --answers <file> \[--again\] \[--json\]/);
  const bad = await run(script('take'), ['--nope']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /usage: node scripts\/take\.mjs/);
  const none = await run(script('take'), []);
  assert.equal(none.code, 2);
  const noAnswers = await runWatched([main.file]);
  assert.equal(noAnswers.code, 2);
  assert.match(noAnswers.stderr, /--answers/);
  assert.equal(noAnswers.looked, false);
  assert.ok(!fs.existsSync(path.join(main.dir, 'take-1')));
});

test('no scout.json, or no click-plan.json: exit 1 and the command to run; no browser is looked for', async () => {
  const bare = writeSpec(path.join(work, 'bare'), demoSpec(MAIN_STEPS));
  const noScout = await runWatched([bare, '--answers', main.answers]);
  assert.equal(noScout.code, 1);
  assert.ok((noScout.stdout + noScout.stderr).includes(`run scout first: node ${script('scout')} ${bare}`), noScout.stdout + noScout.stderr);
  assert.equal(noScout.looked, false);
  const dir = copyOf(main.dir, 'no-plan');
  fs.rmSync(path.join(dir, 'click-plan.json'));
  const noPlan = await runWatched([path.join(dir, 'demo.json'), '--answers', path.join(dir, 'answers.json')]);
  assert.equal(noPlan.code, 1);
  assert.ok((noPlan.stdout + noPlan.stderr).includes(`run build first: node ${script('build')} ${path.join(dir, 'demo.json')}`), noPlan.stdout + noPlan.stderr);
  assert.equal(noPlan.looked, false);
  assert.ok(!fs.existsSync(path.join(dir, 'take-1')));
});

test('answers for another plan: exit 1, nothing written, no browser looked for', async () => {
  const dir = copyOf(main.dir, 'other-plan');
  const answers = read(dir, 'answers.json');
  fs.writeFileSync(path.join(dir, 'answers.json'), JSON.stringify({ ...answers, planKey: 'demo-000000000000' }));
  const r = await runWatched([path.join(dir, 'demo.json'), '--answers', path.join(dir, 'answers.json')]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.equal(r.looked, false);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('take-')), []);
});

test('a verdict of approve-with-changes: exit 1, nothing written, no browser looked for', async () => {
  const changes = await approved('changes', demoSpec(MAIN_STEPS), { verdict: 'approve-with-changes' });
  const r = await runWatched([changes.file, '--answers', changes.answers]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.equal(r.looked, false);
  assert.deepEqual(fs.readdirSync(changes.dir).filter((n) => n.startsWith('take-')), []);
});

test('a stale plan (demo.json changed after the plan page was built): exit 1, nothing written, no browser looked for', async () => {
  const dir = copyOf(main.dir, 'stale');
  const file = path.join(dir, 'demo.json');
  const spec = read(file);
  spec.useCases[0].steps.push({ id: 'extra', do: 'wait', value: 1 });
  fs.writeFileSync(file, JSON.stringify(spec));
  const r = await runWatched([file, '--answers', path.join(dir, 'answers.json')]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /build the plan again/);
  assert.equal(r.looked, false);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('take-')), []);
});

test('scout says the page cannot be filmed frame by frame: exit 1 with the real-time sentence, no browser looked for', async () => {
  const dir = copyOf(main.dir, 'unsteppable');
  const scout = read(dir, 'scout', 'scout.json');
  fs.writeFileSync(path.join(dir, 'scout', 'scout.json'), JSON.stringify({ ...scout, stepped: { ok: false, reason: 'did not settle (a timer)', realTime: null } }));
  const r = await runWatched([path.join(dir, 'demo.json'), '--answers', path.join(dir, 'answers.json')]);
  assert.equal(r.code, 1);
  assert.match(r.stdout + r.stderr, REAL_TIME_SENTENCE);
  assert.equal(r.looked, false);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('take-')), []);
  const json = await runWatched([path.join(dir, 'demo.json'), '--answers', path.join(dir, 'answers.json'), '--json']);
  assert.equal(json.code, 1);
  assert.equal(JSON.parse(json.stdout).ok, false);
});

test('another headless browser is live: exit 2, no take folder is left, and the command did look', async () => {
  const dir = copyOf(main.dir, 'busy');
  const r = await runWatched([path.join(dir, 'demo.json'), '--answers', path.join(dir, 'answers.json')], { live: true });
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.equal(r.looked, true);
  assert.match(r.stderr, /another headless browser is running/);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.startsWith('take-')), []);
});

// ---- takes ----

test('an approved plan: exit 0, take-1/take.json (pretty), take-1/contact.jpg (a JPEG under 1.4 MB, grid of 640 px columns), and the printed report', T, async () => {
  const r = await run(script('take'), [main.file, '--answers', main.answers]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  await quiet();
  const dir = path.join(main.dir, 'take-1');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['contact.jpg', 'frames', 'take.json']);
  const raw = fs.readFileSync(path.join(dir, 'take.json'), 'utf8');
  assert.ok(raw.includes('\n  "version": 1'), 'pretty JSON');
  const take = JSON.parse(raw);
  assert.equal(take.stopped, null);
  assert.deepEqual(take.steps.map((s) => s.id), MAIN_STEPS.map((s) => s.id));
  assert.equal(take.planKey, main.plan.key);
  const sheet = fs.readFileSync(path.join(dir, 'contact.jpg'));
  assert.ok(isJpeg(sheet), 'a JPEG');
  assert.ok(sheet.length < JPEG_LIMIT, `${sheet.length} bytes`);
  assert.ok(jpegSize(sheet).width >= 3 * 640, `${JSON.stringify(jpegSize(sheet))}: three columns of 640 px at least`);
  assert.match(r.stdout, /rows run: 5 of 5/);
  assert.match(r.stdout, /stopped: no, every row ran/);
  assert.ok(r.stdout.includes(`folder: ${dir}`), r.stdout);
  assert.ok(Buffer.byteLength(r.stdout) <= REPORT_LIMIT, `${Buffer.byteLength(r.stdout)} bytes printed`);
  assert.match(r.stdout, new RegExp(`POST ${sites.origin.replaceAll('.', '\\.')}/take/save x1`));
  assert.equal(sites.saves().length, 1);
  assert.equal(r.stderr, '');
});

test('a second take of the same plan after a row that changes something needs --again; with it the rows that run twice are named', T, async () => {
  const refused = await runWatched([main.file, '--answers', main.answers]);
  assert.equal(refused.code, 1, refused.stdout + refused.stderr);
  assert.match(refused.stdout + refused.stderr, /--again/);
  assert.equal(refused.looked, false, 'refused before any browser is looked for');
  assert.ok(!fs.existsSync(path.join(main.dir, 'take-2')));
  const again = await run(script('take'), [main.file, '--answers', main.answers, '--again']);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  await quiet();
  const take = read(main.dir, 'take-2', 'take.json');
  assert.ok(take.again.includes('f'), `again: ${take.again}`);
  assert.match(again.stdout, /rows run again: .*\bf\b/);
});

test('--json prints one line { ok, stopped, dir, report }', T, async () => {
  const dir = copyOf(path.join(work, 'main'), 'json');
  fs.rmSync(path.join(dir, 'take-1'), { recursive: true, force: true });
  fs.rmSync(path.join(dir, 'take-2'), { recursive: true, force: true });
  const r = await run(script('take'), [path.join(dir, 'demo.json'), '--answers', path.join(dir, 'answers.json'), '--json']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  await quiet();
  assert.equal(r.stdout.trimEnd().split('\n').length, 1);
  const body = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(body).sort(), ['dir', 'ok', 'report', 'stopped']);
  assert.equal(body.ok, true);
  assert.equal(body.stopped, null);
  assert.equal(body.dir, path.join(dir, 'take-1'));
  assert.match(body.report, /rows run: 5 of 5/);
});

test('a take that stops early still writes take.json, contact.jpg and the report, then exits 1', T, async () => {
  const steps = [goto('g', '/take/'), { id: 't', do: 'type', target: by('textbox', 'Your name'), value: 'Ada' }, { id: 'i', do: 'click', intent: 'press the thing that is not on a scouted page' }, goto('g2', '/take/')];
  const stop = await approved('stop', demoSpec(steps));
  const r = await run(script('take'), [stop.file, '--answers', stop.answers]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  await quiet();
  const dir = path.join(stop.dir, 'take-1');
  const take = read(dir, 'take.json');
  assert.deepEqual(take.stopped, { row: 'i', reason: 'not seen yet' });
  assert.deepEqual(take.steps.map((s) => s.id), ['g', 't']);
  const sheet = fs.readFileSync(path.join(dir, 'contact.jpg'));
  assert.ok(isJpeg(sheet));
  assert.ok(sheet.length < JPEG_LIMIT);
  assert.match(r.stdout, /rows run: 2 of 4/);
  assert.match(r.stdout, /stopped: row i, not seen yet/);
  assert.deepEqual(sites.saves(), []);
});

const NAMES = [{ css: 'dd:nth-child(2)' }, { css: 'td:first-child' }, { css: 'a[href="/login/summary"]' }];
const SIGNED_STEPS = [goto('g', '/login/home'), { id: 'h', do: 'show', target: by('heading', 'Account') }, { id: 'b', do: 'hover', target: by('button', 'Switch to <email>') }];

test('signed in: stdout, stderr and every text file hold no private value or cookie value; the contact sheet is written; the report says the model must not open it', T, async () => {
  const spec = demoSpec(SIGNED_STEPS, { source: { url: `${sites.origin}/login/home` }, session: 'fixture', mask: NAMES, viewport: TALL_VIEWPORT });
  const signed = await approved('signed', spec, { signedIn: true });
  const r = await run(script('take'), [signed.file, '--answers', signed.answers]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  await quiet();
  const dir = path.join(signed.dir, 'take-1');
  assert.ok(isJpeg(fs.readFileSync(path.join(dir, 'contact.jpg'))), 'the sheet is written, for the user');
  assert.equal(read(dir, 'take.json').signedIn, true);
  assert.match(r.stdout, /do not open/i);
  assert.match(r.stdout, /rows run: 3 of 3/);
  const everything = [r.stdout, r.stderr, ...everyText(signed.dir)].join('\n');
  for (const seed of [...PRIVATE_SEEDS, 'fixture-session']) assert.ok(!everything.includes(seed), `leaked: ${seed}`);
  const json = await run(script('take'), [signed.file, '--answers', signed.answers, '--json', '--again']);
  await quiet();
  assert.equal(json.code, 0, json.stdout + json.stderr);
  for (const seed of [...PRIVATE_SEEDS, 'fixture-session']) assert.ok(!(json.stdout + json.stderr).includes(seed), `leaked in --json: ${seed}`);
  const lost = await run(script('take'), [signed.file, '--answers', signed.answers], { CLAUDE_PLUGIN_DATA: fs.mkdtempSync(path.join(work, 'empty-data-')) });
  assert.equal(lost.code, 2, 'a session nobody saved: exit 2');
  assert.match(lost.stderr, /session\.mjs login/);
  assert.deepEqual(fs.readdirSync(signed.dir).filter((n) => n.startsWith('take-')).sort(), ['take-1', 'take-2'], 'no empty take folder is left behind');
});
