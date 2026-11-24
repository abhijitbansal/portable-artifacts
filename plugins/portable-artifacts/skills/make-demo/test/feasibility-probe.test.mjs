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
  assert.equal(typeof record.nonGetRequests, 'number');
  assert.ok(fs.existsSync(path.join(outDir, 'plain', 'step0-stepped.png')));
  assert.ok(record.steps.every((s) => ['still', 'frames', 'time'].includes(s.settle.reason)));
});

test('/spa/ is steppable after a click that starts a count-up and fades rows in', async () => {
  const record = await probeSite(browser, entry('spa', '/spa/', [{ do: 'click', role: 'button', name: 'Search' }, { do: 'click', role: 'tab', name: 'Accounts' }]), outDir);
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
  const record = await probeSite(browser, entry('missing', '/plain/', [{ do: 'click', role: 'link', name: 'No such link' }]), outDir);
  assert.equal(record.verdict, 'inconclusive');
  assert.match(record.why.join(' '), /No such link/);
});

test('the probe never sends a POST or follows a GET delete link on /danger/', async () => {
  sites.reset();
  for (const step of [
    { do: 'click', role: 'button', name: 'Delete' },
    { do: 'click', role: 'button', name: 'Pay' },
    { do: 'click', role: 'link', name: 'Archive item 1' },
  ]) {
    const record = await probeSite(browser, entry('danger', '/danger/', [step]), outDir);
    assert.equal(record.verdict, 'inconclusive');
    assert.match(record.why.join(' '), /refus/i);
  }
  assert.deepEqual(sites.requests().filter((r) => r.path.startsWith('/danger/') && r.method !== 'GET'), []);
  assert.equal(sites.requests().some((r) => r.path.includes('/delete')), false);
  assert.deepEqual(sites.state(), { signedIn: false, deleted: [], submitted: 0 });
});

test('a hover is allowed on a danger control and sends nothing', async () => {
  sites.reset();
  const record = await probeSite(browser, entry('danger-hover', '/danger/', [{ do: 'hover', role: 'button', name: 'Delete' }]), outDir);
  assert.notEqual(record.verdict, 'inconclusive', record.why.join('; '));
  assert.deepEqual(sites.state(), { signedIn: false, deleted: [], submitted: 0 });
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
  const { file } = sitesFile([entry('missing', '/plain/', [{ do: 'click', role: 'link', name: 'No such link' }]), entry('plain', '/plain/', [scroll(300)])]);
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
  const code = await main([file, '--out', out], { live: () => [], launch: lend, out: stdout.write, err: stdout.write });
  assert.equal(code, 0);
  const results = JSON.parse(fs.readFileSync(path.join(out, 'results.json'), 'utf8'));
  assert.deepEqual(results.map((r) => [r.name, r.verdict]), [['missing', 'inconclusive'], ['plain', 'steppable']]);
  assert.equal(stdout.lines.length, 2);
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
