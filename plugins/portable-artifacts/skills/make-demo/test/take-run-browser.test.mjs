// The take: approved rows run once, frame by frame, in one guarded context at scale 3; the stops, the limits, the downloads and the
// signed-in rules. Loopback fixtures only. One browser for the file; run with --test-concurrency=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSites, PRIVATE_SEEDS } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { runScout } from '../scripts/lib/scout-run.mjs';
import { planRows } from '../scripts/lib/plan-rows.mjs';
import { runTake } from '../scripts/lib/take-run.mjs';
import { spreads, FLAT_SPREAD } from './pixels.mjs';

const VIEWPORT = { width: 800, height: 500 };
const TALL_VIEWPORT = { width: 800, height: 900 };
const SCALE = 3;
const MB = 1024 * 1024;
const INSET = 3; // CSS px inside a measured box (a JPEG shares colour over blocks, so an edge bleeds a little)
const T = { timeout: 180000 };
const SIGNED_IN = { cookies: [{ name: 'sid', value: 'fixture-session', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] };

let sites;
let browser;
let blankContext;
let blank;
let scout;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-take-run-'));
let folders = 0;

const specOf = (steps, extra = {}) => ({
  version: 1,
  source: { url: `${sites.origin}/take/` },
  origins: [sites.origin],
  rights: 'own',
  pages: ['/take/files.html', '/take/sneaky.html', '/take/beacon.html', '/take/loadpost.html'],
  viewport: VIEWPORT,
  useCases: [{ id: 'uc', title: 'T', steps }],
  ...extra,
});

before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  sites = await startSites();
  browser = await launchBrowser();
  blankContext = await browser.newContext();
  blank = await blankContext.newPage(); // decodes pictures
  const result = await runScout({ browser, spec: specOf([{ id: 'g', do: 'goto', value: '/take/' }]) });
  assert.equal(result.ok, true, result.reason);
  scout = result.scout;
});
after(async () => {
  await blankContext?.close();
  await browser?.close();
  await sites?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

const goto = (id, value) => ({ id, do: 'goto', value });
const by = (role, name) => ({ role, name });
const folder = () => path.join(work, `take-${(folders += 1)}`);

function planOf(steps, { spec = specOf(steps), scouted = scout } = {}) {
  const { rows, errors, hash } = planRows(spec, scouted);
  assert.deepEqual(errors, []);
  return { spec, rows, hash, scouted };
}

/** Run a take of `steps` against the fixtures (server reset first, then `rewrite`, if any). Returns { take, dir }. */
async function take(steps, { rewrite = null, limits, state = null, plan = planOf(steps), mutate = (rows) => rows } = {}) {
  sites.reset();
  if (state) await fetch(`${sites.origin}/login/signin`, { method: 'POST', redirect: 'manual' });
  if (rewrite) sites.rewriteHtml(rewrite);
  const dir = folder();
  const result = await runTake({ browser, spec: plan.spec, scout: plan.scouted, rows: mutate(plan.rows), hash: plan.hash, state, dir, now: () => new Date(0), limits });
  return { take: result, dir };
}

const stepIds = (result) => result.steps.map((s) => s.id);
const writes = () => sites.requests().filter((r) => r.method !== 'GET' && r.server !== 'other');
const framePath = (dir, file) => path.join(dir, 'frames', file);
const jpegSize = (buf) => {
  for (let i = 2; i + 9 < buf.length; ) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
};

const MAIN_PLAN = [
  goto('g', '/take/'),
  { id: 't', do: 'type', target: by('textbox', 'Your name'), value: 'Ada' },
  { id: 's', do: 'select', target: by('combobox', 'Colour'), value: 'green' },
  { id: 'c', do: 'click', target: by('button', 'Reveal') },
  goto('g2', '/take/'), // a click that may change something leaves the screen unknown to the plan until the next goto
  { id: 'f', do: 'click', target: by('button', 'Save note') },
];

let mainRun;
const mainTake = () => { mainRun ??= take(MAIN_PLAN); return mainRun; };

test('goto, type, select, click and a form submit: every step has frames, nothing stops it, and the site saw one save and nothing else', T, async () => {
  const { take: result, dir } = await mainTake();
  assert.equal(result.stopped, null);
  assert.deepEqual(stepIds(result), ['g', 't', 's', 'c', 'g2', 'f']);
  for (const step of result.steps) assert.ok(step.settleFrame > step.startFrame && step.actFrame >= step.startFrame, `${step.id} ran frames`);
  assert.equal(result.steps.at(-1).settleFrame, result.frames.length, 'one stored frame per film frame');
  assert.equal(sites.saves().length, 1);
  assert.deepEqual(sites.state(), { signedIn: false, deleted: [], submitted: 0 });
  assert.equal(sites.flags(), 0);
  assert.deepEqual(writes().map((r) => `${r.method} ${r.path}`), ['POST /take/save']);
  assert.equal(result.seen.requests.length, 1);
  assert.deepEqual({ ...result.seen.requests[0], count: 1 }, { method: 'POST', origin: sites.origin, path: '/take/save', count: 1 });
  assert.ok(result.seen.origins.includes(sites.origin));
  for (const file of result.frames) assert.ok(fs.existsSync(framePath(dir, file)), file);
  const first = fs.readFileSync(framePath(dir, result.frames[0]));
  assert.deepEqual(jpegSize(first), { width: VIEWPORT.width * SCALE, height: VIEWPORT.height * SCALE });
  const sizes = [...new Set(result.frames)].map((file) => fs.statSync(framePath(dir, file)).size);
  assert.equal(result.bytes, sizes.reduce((sum, n) => sum + n, 0));
});

test('take.json holds the plan key, the context and one entry per step, and survives a JSON round trip', T, async () => {
  const { take: result } = await mainTake();
  const { hash } = planOf(MAIN_PLAN);
  assert.equal(result.version, 1);
  assert.equal(result.planKey, `demo-${hash}`);
  assert.equal(result.startedAt, new Date(0).toISOString());
  assert.deepEqual({ viewport: result.viewport, scale: result.scale, fps: result.fps, mode: result.mode, signedIn: result.signedIn, again: result.again }, { viewport: VIEWPORT, scale: 3, fps: 30, mode: 'stepped', signedIn: false, again: [] });
  const typed = result.steps.find((s) => s.id === 't');
  assert.deepEqual(Object.keys(typed).sort(), ['actFrame', 'box', 'boxMoved', 'covered', 'do', 'effect', 'id', 'pointer', 'settle', 'settleFrame', 'settledIndex', 'startFrame']);
  assert.equal(typed.do, 'type');
  assert.equal(typed.effect, 'change');
  assert.equal(typed.covered, 0, 'signed out with no mask: nothing covered');
  assert.equal(result.steps.find((s) => s.id === 'g').box, null);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test('the same plan twice on the fixed fixture gives the same list of frame hashes (repeatable)', T, async () => {
  const first = (await mainTake()).take;
  const second = (await take(MAIN_PLAN)).take;
  assert.ok(new Set(first.frames).size >= 10, `control: the picture changed (${new Set(first.frames).size} distinct frames of ${first.frames.length})`);
  assert.equal(second.frames.length, first.frames.length);
  assert.deepEqual(second.frames, first.frames);
  assert.deepEqual(second.steps.map(({ id, startFrame, actFrame, settleFrame }) => [id, startFrame, actFrame, settleFrame]), first.steps.map(({ id, startFrame, actFrame, settleFrame }) => [id, startFrame, actFrame, settleFrame]));
});

test('an intent row as the third row: rows 1 and 2 ran, the take stops on it, and nothing was sent after row 2', T, async () => {
  const steps = [goto('g', '/take/'), { id: 't', do: 'type', target: by('textbox', 'Your name'), value: 'Ada' }, { id: 'i', do: 'click', intent: 'press the thing that is not on a scouted page' }, goto('g2', '/take/'), { id: 'f', do: 'click', target: by('button', 'Save note') }];
  const { take: result } = await take(steps);
  assert.deepEqual(stepIds(result), ['g', 't']);
  assert.deepEqual(result.stopped, { row: 'i', reason: 'not seen yet' });
  assert.deepEqual(writes(), []);
  assert.ok(sites.requests().every((r) => r.path === '/take/' || r.path === '/favicon.ico'), JSON.stringify(sites.requests()));
});

test('a button removed between scout and take: the take stops at that row with "no match", and the row after it does not run', T, async () => {
  const steps = [goto('g', '/take/'), { id: 'c', do: 'click', target: by('button', 'Reveal') }, goto('g2', '/take/'), { id: 'f', do: 'click', target: by('button', 'Save note') }];
  const { take: result } = await take(steps, { rewrite: (html) => html.replace('<button type="button" id="go">Reveal</button>', '') });
  assert.deepEqual(stepIds(result), ['g']);
  assert.deepEqual(result.stopped, { row: 'c', reason: 'no match' });
  assert.deepEqual(sites.saves(), []);
});

test('a twin of the approved button that scout did not see: the take stops, it does not pick one', T, async () => {
  const steps = [goto('g', '/take/'), { id: 'c', do: 'click', target: by('button', 'Reveal') }];
  const { take: result } = await take(steps, { rewrite: (html) => html.replace('<button type="button" id="go">Reveal</button>', '<button type="button" id="go">Reveal</button><button type="button" id="go2">Reveal</button>') });
  assert.deepEqual(stepIds(result), ['g']);
  assert.match(result.stopped.reason, /^(2 matches|the control changed)/);
  assert.equal(result.stopped.row, 'c');
});

test('a form whose action moved to another origin: the move is refused, the take stops at that row, and the other origin saw nothing', T, async () => {
  const steps = [goto('g', '/take/'), { id: 'o', do: 'click', target: by('button', 'Send away') }, goto('g2', '/take/')];
  const { take: result } = await take(steps);
  assert.deepEqual(stepIds(result), ['g', 'o']);
  assert.deepEqual(result.stopped, { row: 'o', reason: `a move to ${sites.otherOrigin} was refused` });
  assert.equal(result.seen.refused.length, 1);
  assert.equal(sites.requests().filter((r) => r.server === 'other').length, 0);
});

test('a look row whose click posts to the site (a handler scout could not see) stops the take, and the row after it does not run', T, async () => {
  const steps = [goto('g', '/take/sneaky.html'), { id: 'd', do: 'click', target: by('link', 'Details') }, { id: 'h', do: 'wait', value: 1 }];
  const plan = planOf(steps);
  assert.equal(plan.rows[1].effect, 'look', 'control: scout read the link as a look');
  const { take: result } = await take(steps, { plan });
  assert.deepEqual(stepIds(result), ['g', 'd']);
  assert.deepEqual(result.stopped, { row: 'd', reason: `a look row sent POST ${sites.origin}/take/flag` });
  assert.equal(sites.flags(), 1, 'the request had gone before the take stopped');
});

test('a page that posts to another origin on load: listed, not a stop', T, async () => {
  const { take: result } = await take([goto('g', '/take/beacon.html'), { id: 'h', do: 'show', target: by('heading', 'Beacon fixture') }]);
  assert.equal(result.stopped, null);
  assert.deepEqual(stepIds(result), ['g', 'h']);
  const listed = result.seen.requests.find((r) => r.origin === sites.otherOrigin);
  assert.deepEqual({ method: listed.method, path: listed.path }, { method: 'POST', path: '/foreign/' });
  assert.ok(result.seen.origins.includes(sites.otherOrigin));
  assert.equal(sites.requests().filter((r) => r.server === 'other' && r.method === 'POST').length, 1);
});

test('a look link to a scouted page that posts to the site on load is not a stop: scout listed that write on the page it belongs to', T, async () => {
  const steps = [goto('g', '/take/beacon.html'), { id: 'p', do: 'click', target: by('link', 'Poster page') }, { id: 'w', do: 'wait', value: 1 }];
  const plan = planOf(steps);
  assert.equal(plan.rows[1].effect, 'look', 'control: scout read the link as a look');
  const poster = scout.pages.find((p) => p.url.endsWith('/take/loadpost.html'));
  assert.ok(poster.requests.some((r) => r.method === 'POST' && r.path === '/take/ping'), 'control: scout listed the ping on the poster page');
  const { take: result } = await take(steps, { plan });
  assert.equal(result.stopped, null);
  assert.deepEqual(stepIds(result), ['g', 'p', 'w']);
  assert.deepEqual(writes().map((r) => `${r.method} ${r.path}`), ['POST /take/ping']);
});

// ---- downloads ----

const DOWNLOAD_STEPS = [
  goto('g1', '/take/files.html'), { id: 'dl', do: 'click', target: by('link', 'Get file') },
  goto('g2', '/take/files.html'), { id: 'big', do: 'click', target: by('link', 'Get big file') },
  goto('g3', '/take/files.html'), { id: 'odd', do: 'click', target: by('link', 'Get odd file') },
];

test('downloads: a file is kept under a name of our own, one over 100 MB is deleted and listed too large, a hostile name stays a listing', T, async () => {
  const { take: result, dir } = await take(DOWNLOAD_STEPS);
  assert.equal(result.stopped, null);
  const [small, big, odd] = result.seen.downloads;
  assert.deepEqual(small, { row: 'dl', file: 'downloads/dl-1.txt', bytes: 'take fixture file\n'.length, name: 'file.txt' });
  assert.equal(fs.readFileSync(path.join(dir, small.file), 'utf8'), 'take fixture file\n');
  assert.deepEqual(big, { row: 'big', file: null, bytes: 101 * MB, name: 'big.bin', skipped: 'too large' });
  assert.ok(!fs.existsSync(path.join(dir, 'downloads', 'big-1.bin')), 'the big file is gone');
  assert.equal(odd.row, 'odd');
  assert.match(odd.file, /^downloads\/odd-1(\.[A-Za-z0-9]{1,8})?$/, 'our name, whatever the site suggested');
  assert.ok(fs.existsSync(path.join(dir, odd.file)));
  // Chromium cleans the suggested name before the take sees it (measured: `_.._x_y.txt`), so this proves only that the stored name is ours;
  // test/take-download.test.mjs gives saveDownload the raw hostile names.
  assert.ok(!/[\u0000-\u001f/]/.test(odd.name), 'no control character or slash in the listed name');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'downloads')).sort(), [path.basename(small.file), path.basename(odd.file)].sort());
  assert.deepEqual(fs.readdirSync(dir).sort(), ['downloads', 'frames'], 'nothing was written outside downloads/ and frames/');
});

// ---- limits ----

test('a film time cap of 2 s stops a wait of 3 s with "film time cap", and keeps the frames so far', T, async () => {
  const { take: result } = await take([goto('g', '/take/'), { id: 'w', do: 'wait', value: 3 }], { limits: { filmSeconds: 2 } });
  assert.deepEqual(stepIds(result), ['g']);
  assert.deepEqual(result.stopped, { row: 'w', reason: 'film time cap' });
  assert.ok(result.frames.length > 60 && result.frames.length < 90, `frames ${result.frames.length}`);
});

test('a size cap of 1 MB stops the take with "size cap" and keeps the frames so far', T, async () => {
  const steps = [goto('g', '/take/'), { id: 't', do: 'type', target: by('textbox', 'Your name'), value: 'Ada' }, { id: 'c', do: 'click', target: by('button', 'Reveal') }, goto('g2', '/take/'), { id: 's', do: 'select', target: by('combobox', 'Colour'), value: 'green' }];
  const { take: result, dir } = await take(steps, { limits: { bytes: MB } });
  assert.equal(result.stopped.reason, 'size cap');
  assert.ok(result.bytes > MB, `bytes ${result.bytes}`);
  assert.ok(result.frames.every((file) => fs.existsSync(framePath(dir, file))));
  assert.ok(!stepIds(result).includes('s'), 'the last row did not run');
});

// ---- signed in ----

const NAMES = [{ css: 'dd:nth-child(2)' }, { css: 'td:first-child' }, { css: 'a[href="/login/summary"]' }]; // a name is not a pattern: the plan masks it

/** Runs in a page: the boxes (CSS px) of every text range and field value holding `needle`. */
function boxesWithText(needle) {
  const out = [];
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const at = node.data.indexOf(needle);
    if (at < 0 || ['SCRIPT', 'STYLE', 'TITLE'].includes(node.parentElement?.tagName)) continue;
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + needle.length);
    for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) out.push([r.left, r.top, r.width, r.height]);
  }
  for (const field of document.querySelectorAll('input, textarea')) {
    const r = field.getBoundingClientRect();
    if (String(field.value).includes(needle) && r.width > 0) out.push([r.left, r.top, r.width, r.height]);
  }
  return out;
}

/** The boxes of every private seed on /login/home at the take's viewport, once the late value is there (a plain page, real time). */
async function seedBoxes() {
  const context = await browser.newContext({ viewport: TALL_VIEWPORT, storageState: SIGNED_IN });
  try {
    const page = await context.newPage();
    await page.goto(`${sites.origin}/login/home`);
    await page.locator('#late').waitFor();
    const boxes = [];
    for (const seed of PRIVATE_SEEDS) boxes.push(...(await page.evaluate(boxesWithText, seed)).map((box) => ({ seed, box })));
    return boxes;
  } finally {
    await context.close();
  }
}

const SIGNED_STEPS = [goto('g', '/login/home'), { id: 'h', do: 'show', target: by('heading', 'Account') }, { id: 'b', do: 'hover', target: by('button', 'Switch to <email>') }];

async function signedPlan() {
  sites.reset();
  await fetch(`${sites.origin}/login/signin`, { method: 'POST', redirect: 'manual' });
  const spec = specOf(SIGNED_STEPS, { source: { url: `${sites.origin}/login/home` }, pages: [], session: 'fixture', mask: NAMES, viewport: TALL_VIEWPORT });
  const result = await runScout({ browser, spec, state: SIGNED_IN });
  assert.equal(result.ok, true, result.reason);
  return planOf(SIGNED_STEPS, { spec, scouted: result.scout });
}

test('signed in: no private value is in take.json, and on the settled frame of every step the box of each one is flat', T, async () => {
  const plan = await signedPlan();
  const { take: result, dir } = await take(SIGNED_STEPS, { plan, state: SIGNED_IN });
  assert.equal(result.stopped, null);
  assert.equal(result.signedIn, true);
  const everything = JSON.stringify(result);
  for (const seed of [...PRIVATE_SEEDS, 'fixture-session']) assert.ok(!everything.includes(seed), `leaked: ${seed}`);
  const seeds = await seedBoxes();
  assert.ok(seeds.length >= PRIVATE_SEEDS.length, `control: ${seeds.length} seed boxes on screen`);
  for (const step of result.steps) {
    assert.ok(step.covered >= PRIVATE_SEEDS.length, `${step.id} covered ${step.covered}`);
    const jpeg = fs.readFileSync(framePath(dir, result.frames[step.settledIndex]));
    const boxes = seeds.map(({ box: [x, y, w, h] }) => [x + INSET, y + INSET, w - 2 * INSET, h - 2 * INSET]);
    const measured = await spreads(blank, jpeg, 'image/jpeg', boxes, SCALE);
    measured.forEach((spread, i) => assert.ok(spread !== null && spread <= FLAT_SPREAD, `step ${step.id}: seed ${seeds[i].seed} at ${seeds[i].box.map(Math.round)} is flat (spread ${spread})`));
  }
});

test('signed in: a stop that comes from an error carries the error name only', T, async () => {
  const plan = await signedPlan();
  const select = (rows) => rows.map((row) => (row.id === 'b' ? { ...row, do: 'select', value: 'x' } : row)); // selecting in a button: the browser's error text is not ours
  const { take: result } = await take(SIGNED_STEPS, { plan, state: SIGNED_IN, mutate: select });
  assert.deepEqual(result.stopped, { row: 'b', reason: 'stopped: Error' });
});
