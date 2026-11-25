// build.mjs, check.mjs and make.mjs as commands, against the loopback fixtures. The commands start their own browsers (scout, the
// picture drawing, make-explainer's check) and refuse to start while another is live, so this file runs them one at a time with spawn
// (async: the in-process fixture server must answer the scout) and waits until no headless browser is left between them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startSites } from './fixtures/sites/server.mjs';
import { liveBrowsers } from '../scripts/lib/browser.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXPLAINER = path.resolve(SKILL, '..', 'make-explainer');
const script = (name) => path.join(SKILL, 'scripts', `${name}.mjs`);
const { planHash } = await import(pathToFileURL(path.join(EXPLAINER, 'scripts/lib/plan-hash.mjs')).href);
const WAIT_MS = 15000;
const JPEG_LIMIT = 1.4 * 1024 * 1024;

let sites;
let work;
let scouted;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function quiet() {
  for (let waited = 0; liveBrowsers().length > 0 && waited < WAIT_MS; waited += 100) await sleep(100);
  assert.deepEqual(liveBrowsers(), [], 'a headless browser is still running');
}

const run = (file, args, env = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [file, ...args], { cwd: os.tmpdir(), env: { ...process.env, ...env } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

const steps = (extra = []) => [
  { id: 'open', do: 'goto', value: '/danger/' },
  { id: 'title', do: 'show', target: { role: 'heading', name: 'Project settings' } },
  { id: 'delete', do: 'click', target: { role: 'button', name: 'Delete' } },
  { id: 'again', do: 'goto', value: '/danger/' },
  ...extra,
];
const demoSpec = (extra = []) => ({
  version: 1,
  source: { url: `${sites.origin}/danger/` },
  origins: [sites.origin],
  rights: 'own',
  useCases: [{ id: 'uc', title: 'Look at the settings', goal: 'See it first', steps: steps(extra) }],
});
const write = (dir, spec) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'demo.json'), JSON.stringify(spec)); return path.join(dir, 'demo.json'); };
const copyOfScouted = (name) => { const dir = path.join(work, name); fs.cpSync(scouted, dir, { recursive: true }); return dir; };
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
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-build-'));
  sites = await startSites();
  scouted = path.dirname(write(path.join(work, 'scouted'), demoSpec()));
  const r = await run(script('scout'), [path.join(scouted, 'demo.json')]);
  assert.equal(r.code, 0, r.stderr);
  await quiet();
});
after(async () => {
  await sites?.close();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

test('build: writes click-plan.json and a picture with boxes, runs make-explainer, and starts no request to the site', { timeout: 180000 }, async () => {
  const dir = copyOfScouted('first');
  fs.mkdirSync(path.join(dir, 'click-plan'));
  fs.writeFileSync(path.join(dir, 'click-plan', 'p9.jpg'), 'an old picture');
  const out = path.join(dir, 'out');
  const before = sites.requests().length;
  const r = await run(script('build'), [path.join(dir, 'demo.json'), '--out', out]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  await quiet();
  assert.equal(sites.requests().length, before, 'drawing the boxes sends no request');
  assert.match(r.stdout, /wrote .*\.html/);
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'click-plan.json'), 'utf8'));
  assert.equal(plan.preset, 'plan');
  assert.match(plan.key, /^demo-[0-9a-f]{12}$/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'click-plan')), ['p1.jpg'], 'the old picture is gone');
  const drawn = fs.readFileSync(path.join(dir, 'click-plan', 'p1.jpg'));
  const original = fs.readFileSync(path.join(dir, 'scout', 'p1.jpg'));
  assert.deepEqual([...drawn.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.ok(drawn.length < JPEG_LIMIT);
  assert.deepEqual(jpegSize(drawn), jpegSize(original), 'the picture keeps the size of the scout picture');
  assert.ok(!drawn.equals(original), 'boxes were drawn');
  assert.ok(plan.sections.some((s) => s.type === 'image' && s.src === 'click-plan/p1.jpg'));
});

test('build --json prints what make-explainer prints: one object with ok and out', { timeout: 180000 }, async () => {
  const dir = copyOfScouted('json');
  const r = await run(script('build'), [path.join(dir, 'demo.json'), '--out', path.join(dir, 'out'), '--json']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  await quiet();
  const body = JSON.parse(r.stdout.trim());
  assert.equal(body.ok, true);
  assert.ok(fs.existsSync(body.out));
});

test('build with no --out writes the page beside demo.json, so two demos never share a file', { timeout: 180000 }, async () => {
  const dir = copyOfScouted('default-out');
  const r = await run(script('build'), [path.join(dir, 'demo.json'), '--json']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  await quiet();
  assert.equal(JSON.parse(r.stdout.trim()).out, path.join(dir, 'click-plan.html'));
  assert.ok(fs.existsSync(path.join(dir, 'click-plan.html')));
});

test('the answers file of a built plan is accepted, and refused after one step of demo.json is edited and rebuilt', { timeout: 240000 }, async () => {
  const dir = copyOfScouted('answers');
  const file = path.join(dir, 'demo.json');
  const built = await run(script('build'), [file, '--out', path.join(dir, 'out')]);
  assert.equal(built.code, 0, built.stdout + built.stderr);
  await quiet();
  const plan = JSON.parse(fs.readFileSync(path.join(dir, 'click-plan.json'), 'utf8'));
  const answers = {
    schema: 'plan-answers/1', planKey: plan.key, planHash: planHash(plan), reviewer: 'Tester', verdict: 'approve',
    answers: plan.sections.filter((s) => s.type === 'approval').map((s) => ({ id: s.id, kind: 'approval', answered: true, choice: 'approve' })),
  };
  const answersFile = path.join(dir, 'answers.json');
  fs.writeFileSync(answersFile, JSON.stringify(answers));
  const accepted = await run(path.join(EXPLAINER, 'scripts', 'answers.mjs'), [path.join(dir, 'click-plan.json'), answersFile, '--json']);
  assert.equal(accepted.code, 0, accepted.stdout);
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  spec.useCases[0].steps[2].target = { role: 'button', name: 'Pay' };
  fs.writeFileSync(file, JSON.stringify(spec));
  const rebuilt = await run(script('build'), [file, '--out', path.join(dir, 'out')]);
  assert.equal(rebuilt.code, 0, rebuilt.stdout + rebuilt.stderr);
  await quiet();
  const refused = await run(path.join(EXPLAINER, 'scripts', 'answers.mjs'), [path.join(dir, 'click-plan.json'), answersFile, '--json']);
  assert.equal(refused.code, 1, refused.stdout);
  const body = JSON.parse(refused.stdout.trim());
  assert.ok(body.errors.some((e) => e.path === 'planKey' || e.path === 'planHash'), refused.stdout);
});

test('a target scout did not see: exit 1 with the path of the step, no click-plan.json', async () => {
  const dir = copyOfScouted('missing-target');
  const file = write(dir, demoSpec([{ id: 'ghost', do: 'click', target: { role: 'button', name: 'Nowhere' } }]));
  const r = await run(script('build'), [file]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /useCases\[0\]\.steps\[4\]\.target/);
  assert.ok(!fs.existsSync(path.join(dir, 'click-plan.json')));
  const j = await run(script('build'), [file, '--json']);
  assert.equal(j.code, 1);
  assert.equal(JSON.parse(j.stdout).ok, false);
});

test('a spec with errors: exit 1 and the errors', async () => {
  const dir = path.join(work, 'bad-spec');
  const file = write(dir, { version: 1 });
  const r = await run(script('build'), [file]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /source/);
});

test('no scout.json, an unreadable one, or one that is not version 1: "run scout first" and the scout command', async () => {
  const none = write(path.join(work, 'no-scout'), demoSpec());
  const unreadable = copyOfScouted('unreadable');
  fs.writeFileSync(path.join(unreadable, 'scout', 'scout.json'), '{ not json');
  const old = copyOfScouted('old-version');
  const scout = JSON.parse(fs.readFileSync(path.join(old, 'scout', 'scout.json'), 'utf8'));
  fs.writeFileSync(path.join(old, 'scout', 'scout.json'), JSON.stringify({ ...scout, version: 2 }));
  for (const file of [none, path.join(unreadable, 'demo.json'), path.join(old, 'demo.json')]) {
    const r = await run(script('build'), [file]);
    assert.equal(r.code, 1, file);
    assert.ok(r.stdout.includes(`run scout first: node ${script('scout')} ${file}`), `${file}: ${r.stdout}`);
  }
});

test('a scout made for other pages is stale: run scout again', async () => {
  const dir = copyOfScouted('stale');
  const file = write(dir, { ...demoSpec(), pages: [`${sites.origin}/scout/`] });
  const r = await run(script('build'), [file]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /run scout again/);
});

test('a missing make-explainer: its install command, exit 2', async () => {
  const dir = copyOfScouted('no-explainer');
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-no-sibling-'));
  const r = await run(script('build'), [path.join(dir, 'demo.json')], { NODE_ENV: 'test', PA_SIBLINGS_ROOT: empty });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /npx --yes skills@.* add .*make-explainer/);
  const c = await run(script('check'), [path.join(dir, 'demo.json')], { NODE_ENV: 'test', PA_SIBLINGS_ROOT: empty });
  assert.equal(c.code, 2);
  assert.match(c.stderr, /make-explainer/);
  fs.rmSync(empty, { recursive: true, force: true });
});

test('usage: --help exits 0, an unknown flag exits 2, for build, check and make', async () => {
  for (const name of ['build', 'check', 'make']) {
    const help = await run(script(name), ['--help']);
    assert.equal(help.code, 0, name);
    assert.match(help.stdout, new RegExp(`usage: node scripts/${name}\\.mjs`), name);
    const bad = await run(script(name), ['--nope']);
    assert.equal(bad.code, 2, name);
    assert.match(bad.stderr + bad.stdout, /usage: node scripts\/|usage/, name);
  }
});

test('make --json on {} exits 1 with one JSON object; on a good demo it builds the page', { timeout: 240000 }, async () => {
  const empty = write(path.join(work, 'empty'), {});
  const bad = await run(script('make'), [empty, '--json']);
  assert.equal(bad.code, 1);
  assert.equal(bad.stdout.trim().split('\n').length, 1);
  assert.equal(JSON.parse(bad.stdout).ok, false);
  const dir = copyOfScouted('make');
  const good = await run(script('make'), [path.join(dir, 'demo.json'), '--json', '--no-check', '--out', path.join(dir, 'out')]);
  assert.equal(good.code, 0, good.stdout + good.stderr);
  await quiet();
  const report = JSON.parse(good.stdout.trim());
  assert.equal(report.ok, true);
  assert.deepEqual(report.stages.map((s) => s.name), ['doctor', 'validate', 'build']);
  assert.ok(fs.existsSync(report.output));
});

test('check passes its arguments to make-explainer: a built plan page passes, a missing file is a usage error', { timeout: 240000 }, async () => {
  const dir = copyOfScouted('check');
  const built = await run(script('build'), [path.join(dir, 'demo.json'), '--out', path.join(dir, 'out'), '--json']);
  assert.equal(built.code, 0, built.stdout + built.stderr);
  await quiet();
  const html = JSON.parse(built.stdout.trim()).out;
  const ok = await run(script('check'), [html, '--json']);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout.trim().split('\n').at(-1)).ok, true);
  await quiet();
  const missing = await run(script('check'), [path.join(dir, 'nothing.html'), '--json']);
  assert.equal(missing.code, 2);
});
