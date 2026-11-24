// Browser tests on loopback fixtures only; the probe visits a public site only when run by hand.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSites } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { probeSite, main } from './feasibility/probe.mjs';
import { decodePng } from './feasibility/decode.mjs';
import { readPng } from '../../make-motion/scripts/v2/png.mjs';

let sites;
let browser;
let outDir;
before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  sites = await startSites();
  browser = await launchBrowser();
  outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-probe-'));
});
after(async () => {
  await browser?.close();
  await sites?.close();
});

const entry = (name, urlPath, steps) => ({ name, url: sites.origin + urlPath, steps });
const scroll = (to, seconds = 0.5) => ({ do: 'scroll', to, seconds });

test('/plain/ is steppable, with the numbers a later phase needs', async () => {
  const record = await probeSite(browser, entry('plain', '/plain/', [scroll(600, 1), { do: 'hover', role: 'link', name: 'Go to the second page' }]), outDir);
  assert.equal(record.verdict, 'steppable', record.why.join('; '));
  assert.equal(record.steps.length, 3, 'the load and two steps');
  for (const step of record.steps) assert.ok(step.ssim >= 0.98 && step.share >= 0.5);
  assert.ok(record.film.wallMsPerFilmSecond > 0);
  assert.ok(record.film.bytesPerSecond > 0 && record.film.bytesPerSecond <= record.film.bytesPerSecondWithoutRepeats);
  assert.deepEqual(record.traffic.map((t) => t.run), ['real-1', 'real-2', 'real-3', 'stepped'], 'the traffic of every run is kept');
  for (const t of record.traffic) assert.deepEqual([t.blocked, t.popups, t.downloads], [[], 0, 0]);
  assert.ok(fs.existsSync(path.join(outDir, 'plain', 'step0-stepped.png')));
  assert.ok(record.steps.every((s) => ['still', 'frames', 'time'].includes(s.settle.reason)));
});

test('/spa/ is steppable when scrolled and hovered', async () => {
  const record = await probeSite(browser, entry('spa', '/spa/', [{ do: 'hover', role: 'button', name: 'Search' }, { do: 'hover', role: 'tab', name: 'Accounts' }]), outDir);
  assert.equal(record.verdict, 'steppable', record.why.join('; '));
});

test('/canvas/ is steppable', async () => {
  const record = await probeSite(browser, entry('canvas', '/canvas/', [scroll(0, 0.5)]), outDir);
  assert.equal(record.verdict, 'steppable', record.why.join('; '));
});

test('/wall/ is not-steppable and the reason names the status', async () => {
  const record = await probeSite(browser, entry('wall', '/wall/', [scroll(0)]), outDir);
  assert.equal(record.verdict, 'not-steppable');
  assert.match(record.why.join(' '), /403/);
});

test('/random/ is not steppable: two real-time runs already disagree', async () => {
  const record = await probeSite(browser, entry('random', '/random/', [scroll(0)]), outDir);
  assert.notEqual(record.verdict, 'steppable');
  assert.ok(record.steps[0].share < 0.5, `stable share ${record.steps[0].share}`);
});

test('a step naming a control that is not there is a record with a reason', async () => {
  const record = await probeSite(browser, entry('missing', '/plain/', [{ do: 'hover', role: 'link', name: 'No such link' }]), outDir);
  assert.equal(record.verdict, 'inconclusive');
  assert.match(record.why.join(' '), /No such link/);
});

test('the reads a page makes after load are listed, with method and path, for every run (scope cut, item 1)', async () => {
  const record = await probeSite(browser, entry('reads', '/slow/', [scroll(0, 0.5)]), outDir);
  assert.equal(record.traffic.length, 4);
  for (const t of record.traffic) {
    assert.ok(Array.isArray(t.readsAfterLoad), `${t.run} has readsAfterLoad`);
    assert.ok(t.readsAfterLoad.some((r) => r.method === 'GET' && r.path === '/slow/data'), `${t.run}: ${JSON.stringify(t.readsAfterLoad)}`);
    assert.ok(t.readsAfterLoad.every((r) => ['GET', 'HEAD', 'OPTIONS'].includes(r.method)), 'only reads are let through');
  }
});

test('a hover on a danger control sends nothing: the probe only looks', async () => {
  sites.reset();
  const record = await probeSite(browser, entry('danger-hover', '/danger/', [{ do: 'hover', role: 'button', name: 'Delete' }]), outDir);
  assert.notEqual(record.verdict, 'inconclusive', record.why.join('; '));
  assert.deepEqual(sites.state(), { signedIn: false, deleted: [], submitted: 0 });
  assert.deepEqual(sites.requests().filter((r) => r.method !== 'GET'), []);
});

const writesToW = () => sites.requests().filter((r) => r.path === '/w');
const kindsBlocked = (record) => record.traffic.flatMap((t) => t.blocked.map((b) => b.kind));

test('a POST sent by a hover handler is blocked, reaches no server, and makes the site inconclusive (A3, A5, B4)', async () => {
  sites.reset();
  const record = await probeSite(browser, entry('hover-post', '/trap/hover-post', [{ do: 'hover', role: 'button', name: 'Continue' }]), outDir);
  assert.deepEqual(writesToW(), []);
  assert.equal(record.verdict, 'inconclusive');
  assert.match(record.why.join(' '), /POST \/w/);
  assert.ok(kindsBlocked(record).includes('write'));
});

test('a POST a timer sends after load is blocked in every step, not only the first (A4)', async () => {
  sites.reset();
  const record = await probeSite(browser, entry('late-post', '/trap/late-post', [scroll(0, 0.5), scroll(0, 0.5)]), outDir);
  assert.deepEqual(writesToW(), []);
  assert.equal(record.verdict, 'inconclusive');
});

test('a popup is closed and counted, and its POST never leaves (A5)', async () => {
  sites.reset();
  const record = await probeSite(browser, entry('popup', '/trap/popup', [scroll(0, 0.5)]), outDir);
  assert.deepEqual(writesToW(), []);
  assert.ok(record.traffic.some((t) => t.popups >= 1), 'a popup was counted');
  assert.equal(record.verdict, 'inconclusive');
});

test('service workers are blocked, so a worker cannot POST, and the record says the site differs from a visitor\'s (A6)', async () => {
  sites.reset();
  const record = await probeSite(browser, entry('sw', '/trap/sw', [scroll(0, 0.5)]), outDir);
  assert.deepEqual(writesToW(), []);
  assert.ok(record.traffic.every((t) => t.serviceWorkers === 'blocked'));
});

test('a WebSocket opened after load is closed before it reaches the server (A7)', async () => {
  sites.reset();
  const record = await probeSite(browser, entry('ws', '/trap/ws', [scroll(0, 0.5)]), outDir);
  assert.equal(sites.requests().some((r) => r.method === 'UPGRADE'), false);
  assert.ok(kindsBlocked(record).includes('websocket'));
  assert.equal(record.verdict, 'inconclusive');
});

test('a download is refused and counted (A10)', async () => {
  sites.reset();
  const record = await probeSite(browser, entry('download', '/trap/download', [scroll(0, 0.5)]), outDir);
  assert.ok(record.traffic.some((t) => t.downloads >= 1), 'a download was counted');
});

test('a navigation the page starts after load is aborted before any request (A5, A11)', async () => {
  sites.reset();
  const record = await probeSite(browser, entry('nav', '/trap/nav', [scroll(0, 0.5)]), outDir);
  assert.equal(sites.requests().some((r) => r.path === '/trap/other'), false);
  assert.ok(kindsBlocked(record).includes('navigation'));
  assert.equal(record.verdict, 'inconclusive');
});

// ---- Fix round 1: false steppable (B1 to B11). The stepped run is told apart from real time by performance.now being fake. ----

const whyText = (record) => record.why.join(' | ');
const probeTrap = (name, trap, steps = [scroll(0, 0.5)]) => probeSite(browser, entry(name, `/trap/${trap}`, steps), outDir);

for (const [trap, label, finding] of [
  ['digit', 'a heading that reads 241 where real time reads 247', 'B1'],
  ['panel', 'a 260 x 60 panel that real time shows and the stepped run lacks', 'B1'],
  ['color', 'a 1200 x 600 field that is red in real time and green when stepped, at the same brightness', 'B2'],
  ['flat', 'a whole page 37 grey levels brighter when stepped', 'B1'],
  ['rows', 'six Edit buttons in real time against one when stepped', 'B7'],
]) {
  test(`${label} is not steppable (${finding})`, async () => {
    const record = await probeTrap(trap, trap);
    assert.equal(record.verdict, 'not-steppable', whyText(record));
  });
}

test('an accessible name that differs with no change to the picture is not steppable, and the reason names both (B7)', async () => {
  const record = await probeTrap('label', 'label');
  assert.equal(record.verdict, 'not-steppable', whyText(record));
  assert.match(whyText(record), /missing 1× button "Save"/);
  assert.match(whyText(record), /extra 1× button "Store"/);
  assert.ok(record.steps.every((s) => s.wrongBlocks === 0), 'the pictures agree: only the tree can tell');
});

test('page errors, console errors and failed requests only the stepped run has are named (B8)', async () => {
  const record = await probeTrap('errors', 'errors');
  assert.equal(record.verdict, 'not-steppable', whyText(record));
  assert.match(whyText(record), /pageerror: boom #/);
  assert.match(whyText(record), /console: hydration mismatch at #/);
  assert.match(whyText(record), /request: /);
});

test('a page whose block jumps to a new place forever is not steppable: the stepped run shows it where no real run does (B3)', async () => {
  const record = await probeTrap('cap', 'cap');
  assert.equal(record.verdict, 'not-steppable', whyText(record));
});

test('a spinner that outlasts every run is compared as it stands and the record says it loops (B3)', { timeout: 120000 }, async () => {
  const record = await probeTrap('stuck', 'stuck');
  assert.equal(record.verdict, 'steppable', whyText(record));
  assert.match(whyText(record), /loops/);
  assert.ok(record.steps.every((s) => s.settle.capped && s.settleRealTime.capped), 'every run gave up waiting');
});

test('a control the stepped run never shows is not-steppable, naming the run (B9)', async () => {
  const record = await probeTrap('stepped-lacks', 'stepped-lacks', [{ do: 'hover', role: 'link', name: 'Open item' }]);
  assert.equal(record.verdict, 'not-steppable', whyText(record));
  assert.match(whyText(record), /stepped run/);
});

for (const [trap, pattern] of [
  ['cookie', /consent|bot check/],
  ['cookie-overlay', /consent/],
  ['bodywall', /bot check|wall/],
  ['blank', /no text and no control/],
  ['needs-login', /sign-in/],
  ['challenge', /challenge frame/],
  ['missing-page', /status 404/],
]) {
  test(`/trap/${trap} is a wall, not a page to step (B5)`, async () => {
    const record = await probeTrap(trap, trap);
    assert.equal(record.verdict, 'not-steppable', whyText(record));
    assert.match(whyText(record), pattern);
  });
}

test('/random/ with near-equal grounds in a different colour each load is not steppable (E2)', async () => {
  const record = await probeSite(browser, entry('random-near-equal', '/random/', [scroll(0, 0.5)]), outDir);
  assert.notEqual(record.verdict, 'steppable', whyText(record));
});

test('the record says what still runs in real time on the page (C7)', async () => {
  const record = await probeSite(browser, entry('realtime', '/realtime/', [scroll(0, 0.5)]), outDir);
  assert.ok(record.realTime.workers >= 1 && record.realTime.smil >= 1, JSON.stringify(record.realTime));
});

test('a step that changed nothing in any run is marked noEffect (B12)', async () => {
  const record = await probeSite(browser, entry('no-effect', '/plain/', [{ do: 'hover', role: 'link', name: 'Go to the second page' }, scroll(0, 0.5)]), outDir);
  assert.ok(record.steps.slice(1).some((s) => s.noEffect === true), JSON.stringify(record.steps.map((s) => s.noEffect)));
});

test('decodePng agrees with make-motion readPng on a real screenshot', async () => {
  const context = await browser.newContext({ viewport: { width: 320, height: 200 } });
  const page = await context.newPage();
  await page.goto(sites.origin + '/plain/');
  const png = await page.screenshot({ type: 'png' });
  const mine = await decodePng(page, png);
  const theirs = readPng(png);
  assert.deepEqual([mine.width, mine.height], [theirs.width, theirs.height]);
  const rgb = Buffer.alloc(theirs.width * theirs.height * 3);
  for (let i = 0; i < theirs.width * theirs.height; i += 1) theirs.data.copy(rgb, i * 3, i * theirs.channels, i * theirs.channels + 3);
  assert.ok(mine.data.equals(rgb));
  await context.close();
});

function sitesFile(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-sites-'));
  const file = path.join(dir, 'sites.json');
  fs.writeFileSync(file, JSON.stringify(entries));
  return { file, dir };
}

const collect = () => { const lines = []; return { lines, write: (s) => lines.push(String(s)) }; };

test('the CLI writes results.json, prints one line a site and runs the next site after a failed one', async () => {
  const { file } = sitesFile([entry('missing', '/plain/', [{ do: 'hover', role: 'link', name: 'No such link' }]), entry('plain', '/plain/', [scroll(300)])]);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-cli-')), 'out');
  const stdout = collect();
  // The file's own browser is already open: lend it to the CLI (its close is a no-op) so two never run at once.
  const lend = async () => new Proxy(browser, {
    get(target, prop) {
      if (prop === 'close') return async () => {};
      const value = Reflect.get(target, prop);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const written = [];
  const printed = (line) => {
    stdout.write(line);
    written.push(JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8')).length); // results.json is already there when a line prints (D4)
  };
  const code = await main([file, '--out', out], { live: () => [], launch: lend, out: printed, err: stdout.write });
  assert.equal(code, 0);
  const results = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
  assert.deepEqual(results.map((r) => [r.name, r.verdict]), [['missing', 'inconclusive'], ['plain', 'steppable']]);
  assert.deepEqual(written, [1, 2]);
  assert.equal(stdout.lines.length, 2);
});

test('the CLI exits 2 with one line when the browser cannot start, when the output folder cannot be made, and when the live check fails (D2, D4)', async () => {
  const { file } = sitesFile([entry('plain', '/plain/', [scroll(300)])]);
  const lines = collect();
  const base = { out: lines.write, err: lines.write };
  assert.equal(await main([file, '--out', os.tmpdir()], { ...base, live: () => [], launch: async () => { throw new Error('no browser here'); } }), 2);
  assert.match(lines.lines.at(-1), /could not run: no browser here/);
  const blocker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-blocker-')), 'a-file');
  fs.writeFileSync(blocker, 'x');
  assert.equal(await main([file, '--out', path.join(blocker, 'out')], { ...base, live: () => [] }), 2);
  assert.equal(await main([file, '--out', os.tmpdir()], { ...base, live: () => { throw new Error('pgrep is missing'); } }), 2);
  assert.match(lines.lines.at(-1), /pgrep is missing/);
});

test('the CLI refuses a sites file with two sites of one name, which would overwrite each other (D1)', async () => {
  const { file } = sitesFile([entry('same', '/plain/', [scroll(300)]), entry('same', '/spa/', [scroll(300)])]);
  const lines = collect();
  assert.equal(await main([file, '--out', os.tmpdir()], { live: () => [], out: lines.write, err: lines.write }), 2);
  assert.match(lines.lines.join(' '), /two sites are named "same"/);
});

test('the CLI exits 2 with a live headless browser, and starts none', async () => {
  const { file } = sitesFile([entry('plain', '/plain/', [scroll(300)])]);
  const lines = collect();
  let launched = false;
  const code = await main([file, '--out', os.tmpdir()], { live: () => ['4242 chrome-headless-shell'], launch: async () => { launched = true; }, out: lines.write, err: lines.write });
  assert.equal(code, 2);
  assert.equal(launched, false);
  assert.match(lines.lines.join(' '), /headless browser/);
});

test('the CLI exits 2 for usage errors and for a step that is not a look', async () => {
  const quiet = collect();
  const deps = { live: () => [], out: quiet.write, err: quiet.write };
  assert.equal(await main([], deps), 2);
  assert.equal(await main(['no-such-file.json', '--out', os.tmpdir()], deps), 2);
  const { file } = sitesFile([entry('typing', '/plain/', [{ do: 'type', role: 'textbox', name: 'q', value: 'x' }])]);
  assert.equal(await main([file, '--out', os.tmpdir()], deps), 2);
  assert.match(quiet.lines.join(' '), /look/);
});
