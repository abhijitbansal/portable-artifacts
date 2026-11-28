// scripts/film.mjs as a command, on a real demo folder made by the fixture take (one headless browser, closed before any command runs).
// The written film is checked by make-motion itself: `make.mjs <film> --outline --json` validates the film and builds its timeline with no
// browser (--no-render would still open one for the review sheets).
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
const FILM = path.join(SKILL, 'scripts', 'film.mjs');
const MAKE = path.join(SKILL, '..', 'make-motion', 'scripts', 'make.mjs');
const T = { timeout: 300000 };
const WAIT_MS = 15000;
const EXTRA = {
  brand: { name: 'Harbor', accent: '#1f6feb' },
  opening: { hook: 'Every project, on one *board*.', facts: [{ text: 'Five steps', value: 5, from: 'user' }] },
  ending: { ask: 'harbor.example/board' },
};

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
  fs.rmSync(path.join(dir, 'film.json'), { force: true });
  return dir;
};

before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-film-cmd-'));
  sites = await startSites();
  const browser = await launchBrowser();
  try {
    const dir = path.join(work, 'demo');
    demo = { ...(await recordDemoFolder({ browser, sites, dir, extra: EXTRA })), dir };
  } finally {
    await browser.close();
  }
  await quiet();
});
after(async () => {
  await sites?.close();
  if (work) fs.rmSync(work, { recursive: true, force: true });
});

test('a take of the approved plan: exit 0, film.json beside demo.json, the shots, the notes and the next command printed', T, async () => {
  const r = await run(FILM, [demo.file, '--take', 'take-1']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const file = path.join(demo.dir, 'film.json');
  assert.ok(r.stdout.includes(`wrote ${file}`), r.stdout);
  assert.match(r.stdout, /shots: 4/);
  assert.match(r.stdout, /walk uc-walk: 5 steps/);
  assert.ok(r.stdout.includes(`next: node ${MAKE} ${file} --json`), r.stdout);
  assert.doesNotMatch(r.stdout, /notice:/, 'signed out: no notice');
  const film = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(film.shots.map((s) => s.id), ['hook', 'fact-1', 'uc-walk', 'close']);
  assert.equal(film.accent, '#1f6feb');
  const walk = film.shots[2];
  assert.equal(walk.src, 'take-1');
  assert.deepEqual(walk.lift, [{ step: 'hover' }], 'the last step with a box is a click, so the hover gets the lift');
});

// make-motion's own validation of the written film: `--outline` validates the spec (the take folder and its frames included) and builds the
// timeline in Node alone. (`--no-render` would still open a browser session for the review sheets.)
test('make-motion accepts the written film, and refuses the same film with a sentence missing', T, async () => {
  const file = path.join(demo.dir, 'film.json');
  const ok = await run(MAKE, [file, '--outline', '--json']);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(ok.stdout).ok, true, ok.stdout);
  const film = JSON.parse(fs.readFileSync(file, 'utf8'));
  const walk = film.shots.find((s) => s.show === 'walk');
  walk.say = walk.say.replace(/ [^.]*\.$/, '');
  const broken = path.join(demo.dir, 'broken.json');
  fs.writeFileSync(broken, JSON.stringify(film));
  const bad = await run(MAKE, [broken, '--outline', '--json']);
  assert.equal(bad.code, 1, 'the check is real: a film with fewer sentences than steps is refused');
  assert.match(bad.stdout, /sentences/);
});

test('a demo with no opening gives a film that starts on the walk shot, and make-motion accepts it', T, async () => {
  const dir = copyOf('no-opening');
  const file = path.join(dir, 'demo.json');
  const { opening, ...rest } = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify(rest));
  const r = await run(FILM, [file, '--take', 'take-1']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  const film = JSON.parse(fs.readFileSync(path.join(dir, 'film.json'), 'utf8'));
  assert.equal(film.shots[0].id, 'uc-walk');
  assert.equal(film.shots[0].cut, undefined);
  const made = await run(MAKE, [path.join(dir, 'film.json'), '--outline', '--json']);
  assert.equal(made.code, 0, made.stdout + made.stderr);
});

test('a second run without --out exits 1 and leaves the first file as it was', T, async () => {
  const file = path.join(demo.dir, 'film.json');
  const before = fs.readFileSync(file);
  const r = await run(FILM, [demo.file, '--take', 'take-1']);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /film\.json exists; pass --out with a new name/);
  assert.deepEqual(fs.readFileSync(file), before);
  const second = await run(FILM, [demo.file, '--take', 'take-1', '--out', path.join(demo.dir, 'film-2.json')]);
  assert.equal(second.code, 0, second.stdout + second.stderr);
  assert.ok(fs.existsSync(path.join(demo.dir, 'film-2.json')));
});

test('--out outside the demo folder, or not .json, exits 1 and writes nothing', T, async () => {
  const outside = path.join(work, 'elsewhere.json');
  const r = await run(FILM, [demo.file, '--take', 'take-1', '--out', outside]);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(outside));
  const text = await run(FILM, [demo.file, '--take', 'take-1', '--out', path.join(demo.dir, 'film.txt')]);
  assert.equal(text.code, 1);
  assert.ok(!fs.existsSync(path.join(demo.dir, 'film.txt')));
});

test('a demo.json whose brand changed after the take exits 1 and names the command to plan again; an edited opening is accepted', T, async () => {
  const dir = copyOf('brand-changed');
  const file = path.join(dir, 'demo.json');
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...spec, brand: { ...spec.brand, accent: '#ff0000' } }));
  const r = await run(FILM, [file, '--take', 'take-1', '--json']);
  assert.equal(r.code, 1, r.stdout + r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.ok, false);
  assert.ok(body.errors.some((e) => e.path === 'take.planKey' && /another plan/.test(e.message)));
  assert.ok(body.errors.some((e) => /build\.mjs/.test(e.message)), 'the command to plan again');
  assert.ok(!fs.existsSync(path.join(dir, 'film.json')));
  const moved = JSON.parse(JSON.stringify(spec));
  moved.useCases[0].steps[1].target.name = 'Another tab';
  fs.writeFileSync(file, JSON.stringify(moved));
  const stepChanged = await run(FILM, [file, '--take', 'take-1']);
  assert.equal(stepChanged.code, 1, 'a changed step makes another plan (or a scout that no longer finds it)');
  assert.ok(!fs.existsSync(path.join(dir, 'film.json')));
  fs.writeFileSync(file, JSON.stringify({ ...spec, opening: { hook: 'A new hook' }, look: 'desk' }));
  const ok = await run(FILM, [file, '--take', 'take-1']);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'film.json'), 'utf8')).shots[0].say, 'A new hook');
});

test('a signed-in take prints the notice; a missing take, a missing --take and a bad name are refused', T, async () => {
  const dir = copyOf('signed');
  const takeFile = path.join(dir, 'take-1', 'take.json');
  fs.writeFileSync(takeFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(takeFile, 'utf8')), signedIn: true }));
  const signed = await run(FILM, [path.join(dir, 'demo.json'), '--take', 'take-1']);
  assert.equal(signed.code, 0, signed.stdout + signed.stderr);
  assert.match(signed.stdout, /notice: this film plays a signed-in take: its sheets and MP4 are the user's to look at; do not open them or send them to an agent\./);
  const json = await run(FILM, [path.join(dir, 'demo.json'), '--take', 'take-1', '--json', '--out', path.join(dir, 'again.json')]);
  assert.match(JSON.parse(json.stdout).notice, /signed-in take/);
  const none = await run(FILM, [demo.file]);
  assert.equal(none.code, 2);
  assert.match(none.stderr, /--take/);
  const missing = await run(FILM, [demo.file, '--take', 'take-9', '--out', path.join(demo.dir, 'x.json')]);
  assert.equal(missing.code, 1);
  const bad = await run(FILM, [demo.file, '--take', '../take-1', '--out', path.join(demo.dir, 'y.json')]);
  assert.equal(bad.code, 1);
  const help = await run(FILM, ['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /usage: node scripts\/film\.mjs <demo\.json> --take take-<n> \[--out <file>\] \[--json\]/);
});
