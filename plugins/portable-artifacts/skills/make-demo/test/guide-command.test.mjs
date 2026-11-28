// scripts/guide.mjs as a command, on a real demo folder made by the fixture take (one headless browser, closed before any command runs).
// The written guide is checked by make-explainer's own validate.mjs, which sniffs the MP4 for an `ftyp` box and copies it: a 12-byte
// placeholder is enough, no decoder is involved.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startSites } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { recordDemoFolder } from './helpers/fixture-take.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDE = path.join(SKILL, 'scripts', 'guide.mjs');
const EXPLAINER = path.join(SKILL, '..', 'make-explainer', 'scripts');
const T = { timeout: 300000 };
const WAIT_MS = 15000;
const MB = 1024 * 1024;
const PLACEHOLDER_MP4 = Buffer.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]); // size 12, "ftyp", "isom"
const EXTRA = { brand: { name: 'Harbor', accent: '#1f6feb' } };

let work;
let demo;
let sites;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function quiet() {
  for (let waited = 0; liveBrowsers().length > 0 && waited < WAIT_MS; waited += 100) await sleep(100);
  assert.deepEqual(liveBrowsers(), [], 'a headless browser is still running');
}

const run = (file, args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [file, ...args], { cwd: os.tmpdir() });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

const copyOf = (name) => {
  const dir = path.join(work, name);
  fs.cpSync(demo.dir, dir, { recursive: true });
  fs.rmSync(path.join(dir, 'guide.json'), { force: true });
  return dir;
};
const video = (dir, name = 'film.mp4') => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, PLACEHOLDER_MP4);
  return file;
};

before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-guide-cmd-'));
  sites = await startSites();
  const browser = await launchBrowser();
  try {
    const dir = path.join(work, 'demo');
    demo = { ...(await recordDemoFolder({ browser, sites, dir, extra: EXTRA })), dir };
    video(dir);
  } finally {
    await browser.close();
  }
  await quiet();
});
after(async () => {
  await sites?.close();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

test('a take of the approved plan: exit 0, guide.json beside demo.json, the build command printed, and make-explainer validates it', T, async () => {
  const r = await run(GUIDE, [demo.file, '--take', 'take-1', '--video', path.join(demo.dir, 'film.mp4')]);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const file = path.join(demo.dir, 'guide.json');
  assert.ok(r.stdout.includes(`wrote ${file}`), r.stdout);
  assert.ok(r.stdout.includes(`next: node ${path.join(EXPLAINER, 'build.mjs')} ${file} --out ${path.join(demo.dir, 'guide.html')}`), r.stdout);
  assert.doesNotMatch(r.stdout, /notice:/, 'signed out: no notice');
  const guide = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(guide.title, 'Harbor walkthrough');
  assert.deepEqual(guide.sections.map((s) => s.type), ['motion', 'steps', 'image', 'image', 'image', 'image', 'image']);
  assert.equal(guide.sections[0].video, 'film.mp4');
  assert.match(guide.sections[2].src, /^take-1\/frames\/[0-9a-f]{16}\.(jpg|png)$/);
  const checked = await run(path.join(EXPLAINER, 'validate.mjs'), [file, '--json']);
  assert.equal(checked.code, 0, checked.stdout + checked.stderr);
  assert.equal(JSON.parse(checked.stdout).ok, true, checked.stdout);
});

test('make-explainer refuses the same guide with its video missing, so the validation is real', T, async () => {
  const dir = path.join(work, 'video-gone');
  fs.cpSync(demo.dir, dir, { recursive: true }); // with the guide the first test wrote
  assert.ok(fs.existsSync(path.join(dir, 'guide.json')));
  fs.rmSync(path.join(dir, 'film.mp4'));
  const checked = await run(path.join(EXPLAINER, 'validate.mjs'), [path.join(dir, 'guide.json'), '--json']);
  assert.equal(checked.code, 1, checked.stdout + checked.stderr);
});

test('a second run without --out exits 1 and leaves the first file as it was', T, async () => {
  const file = path.join(demo.dir, 'guide.json');
  const before = fs.readFileSync(file);
  const r = await run(GUIDE, [demo.file, '--take', 'take-1', '--video', path.join(demo.dir, 'film.mp4')]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /guide\.json exists; pass --out with a new name/);
  assert.deepEqual(fs.readFileSync(file), before);
  const second = await run(GUIDE, [demo.file, '--take', 'take-1', '--video', path.join(demo.dir, 'film.mp4'), '--out', path.join(demo.dir, 'guide-2.json')]);
  assert.equal(second.code, 0, second.stdout + second.stderr);
  assert.ok(fs.existsSync(path.join(demo.dir, 'guide-2.json')));
});

test('a --video outside the demo folder, a missing one, a link out, a folder and a file that is not .mp4 are each refused and nothing is written', T, async () => {
  const dir = copyOf('video-refused');
  const file = path.join(dir, 'demo.json');
  const argsFor = (movie) => [file, '--take', 'take-1', '--video', movie];
  const outside = video(work, 'outside.mp4');
  for (const movie of [outside, path.join(dir, 'missing.mp4'), path.join(dir, 'take-1'), path.join(dir, 'demo.json')]) {
    const r = await run(GUIDE, argsFor(movie));
    assert.equal(r.code, 1, `${movie}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /video/);
  }
  fs.symlinkSync(outside, path.join(dir, 'link.mp4'));
  const linked = await run(GUIDE, argsFor(path.join(dir, 'link.mp4')));
  assert.equal(linked.code, 1, 'a link to a file outside the folder is outside by realpath');
  assert.ok(!fs.existsSync(path.join(dir, 'guide.json')));
});

test('an .mp4 over 50 MB is refused, and one of exactly 50 MB is not', T, async () => {
  const dir = copyOf('video-big');
  const big = video(dir, 'big.mp4');
  fs.truncateSync(big, 50 * MB + 1);
  const over = await run(GUIDE, [path.join(dir, 'demo.json'), '--take', 'take-1', '--video', big]);
  assert.equal(over.code, 1, over.stdout + over.stderr);
  assert.match(over.stdout, /50 MB/);
  fs.truncateSync(big, 50 * MB);
  const exact = await run(GUIDE, [path.join(dir, 'demo.json'), '--take', 'take-1', '--video', big]);
  assert.equal(exact.code, 0, exact.stdout + exact.stderr);
});

test('--out outside the demo folder, not .json, or in a sub folder is refused', T, async () => {
  const dir = copyOf('out-refused');
  const args = (out) => [path.join(dir, 'demo.json'), '--take', 'take-1', '--video', path.join(dir, 'film.mp4'), '--out', out];
  const outside = path.join(work, 'elsewhere.json');
  assert.equal((await run(GUIDE, args(outside))).code, 1);
  assert.ok(!fs.existsSync(outside));
  assert.equal((await run(GUIDE, args(path.join(dir, 'guide.txt')))).code, 1);
  fs.mkdirSync(path.join(dir, 'sub'));
  const sub = await run(GUIDE, args(path.join(dir, 'sub', 'guide.json')));
  assert.equal(sub.code, 1, 'the guide\'s paths are relative to its own folder, so it sits beside demo.json');
  assert.ok(!fs.existsSync(path.join(dir, 'sub', 'guide.json')));
});

test('a demo.json whose brand changed after the take exits 1 with the film command\'s message and the command to plan again', T, async () => {
  const dir = copyOf('brand-changed');
  const file = path.join(dir, 'demo.json');
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...spec, brand: { ...spec.brand, accent: '#ff0000' } }));
  const r = await run(GUIDE, [file, '--take', 'take-1', '--video', path.join(dir, 'film.mp4'), '--json']);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const body = JSON.parse(r.stdout);
  assert.ok(body.errors.some((e) => e.path === 'take.planKey' && /another plan/.test(e.message)));
  assert.ok(body.errors.some((e) => /build\.mjs/.test(e.message)), 'the command to plan again');
  assert.ok(!fs.existsSync(path.join(dir, 'guide.json')));
});

test('a signed-in take prints the notice, in text and in --json; a missing --video or --take is usage', T, async () => {
  const dir = copyOf('signed');
  const takeFile = path.join(dir, 'take-1', 'take.json');
  fs.writeFileSync(takeFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(takeFile, 'utf8')), signedIn: true }));
  const movie = path.join(dir, 'film.mp4');
  const signed = await run(GUIDE, [path.join(dir, 'demo.json'), '--take', 'take-1', '--video', movie]);
  assert.equal(signed.code, 0, signed.stdout + signed.stderr);
  assert.match(signed.stdout, /notice: this guide shows a signed-in take's frames: it is the user's to open; do not open it or its check pictures/);
  const json = await run(GUIDE, [path.join(dir, 'demo.json'), '--take', 'take-1', '--video', movie, '--json', '--out', path.join(dir, 'again.json')]);
  assert.match(JSON.parse(json.stdout).notice, /signed-in take/);
  const noVideo = await run(GUIDE, [demo.file, '--take', 'take-1']);
  assert.equal(noVideo.code, 2);
  assert.match(noVideo.stderr, /--video/);
  const noTake = await run(GUIDE, [demo.file, '--video', movie]);
  assert.equal(noTake.code, 2);
  assert.match(noTake.stderr, /--take/);
  const help = await run(GUIDE, ['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /usage: node scripts\/guide\.mjs <demo\.json> --take take-<n> --video <file\.mp4> \[--out <file>\] \[--json\]/);
});
