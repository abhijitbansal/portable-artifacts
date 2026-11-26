// The take's stops that guard the approved plan against a page that changes under it: the control that moves during the pointer glide,
// a server redirect off the demo's origins, a page that is stuck, and the record of rows whose act began (`ran`).
// Loopback fixtures only. One browser for the file; run with --test-concurrency=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSites } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { runScout } from '../scripts/lib/scout-run.mjs';
import { planRows } from '../scripts/lib/plan-rows.mjs';
import { runTake } from '../scripts/lib/take-run.mjs';

const VIEWPORT = { width: 800, height: 500 };
const T = { timeout: 240000 };

let sites;
let browser;
let scout;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-take-stops-'));
let folders = 0;

const specOf = (steps) => ({
  version: 1,
  source: { url: `${sites.origin}/take/` },
  origins: [sites.origin],
  rights: 'own',
  pages: [],
  viewport: VIEWPORT,
  useCases: [{ id: 'uc', title: 'T', steps }],
});

before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  sites = await startSites();
  browser = await launchBrowser();
  const result = await runScout({ browser, spec: specOf([{ id: 'g', do: 'goto', value: '/take/' }]) });
  assert.equal(result.ok, true, result.reason);
  scout = result.scout;
});
after(async () => {
  await browser?.close();
  await sites?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

const goto = (id, value) => ({ id, do: 'goto', value });
const by = (role, name) => ({ role, name });

/** Run a take of `steps` against the fixtures (server reset first, then `rewrite`, if any). */
async function take(steps, { rewrite = null, mutate = (rows) => rows, limits } = {}) {
  const spec = specOf(steps);
  const { rows, errors, hash } = planRows(spec, scout);
  assert.deepEqual(errors, []);
  sites.reset();
  if (rewrite) sites.rewriteHtml(rewrite);
  const dir = path.join(work, `take-${(folders += 1)}`);
  return runTake({ browser, spec, scout, rows: mutate(rows), hash, dir, now: () => new Date(0), limits });
}
const stepIds = (result) => result.steps.map((s) => s.id);

// A control is inserted before the approved one on the first pointer move, so its positional css now points at another control.
const INSERT_ON_MOVE = `<script>
  let armed = true;
  document.addEventListener('mousemove', () => {
    if (!armed) return;
    armed = false;
    setTimeout(() => document.querySelector('form').insertAdjacentHTML('beforebegin', '<form action="/take/flag" method="post"><button type="submit">Flag it</button></form>'), 50);
  });
</script>`;

test('a control that is replaced during the pointer glide is not clicked: the take stops at that row and the other control sends nothing', T, async () => {
  const steps = [goto('g', '/take/'), { id: 's', do: 'click', target: by('button', 'Save note') }];
  const result = await take(steps, { rewrite: (html) => html.replace('<div class="tall"></div>', `<div class="tall"></div>${INSERT_ON_MOVE}`) });
  assert.equal(result.stopped.row, 's');
  assert.match(result.stopped.reason, /^the control changed: /);
  assert.equal(sites.flags(), 0, 'the control that took its place was not clicked');
  assert.deepEqual(sites.saves(), []);
  assert.deepEqual(stepIds(result), ['g']);
});

// ---- the page moved to another origin ----

test('a goto that the server redirects to another origin: the take stops at that row, and the next row does not run', T, async () => {
  const result = await take([goto('g', '/take/'), goto('b', '/scout/bounce'), { id: 'w', do: 'wait', value: 1 }]);
  assert.deepEqual(result.stopped, { row: 'b', reason: `the page moved to ${sites.otherOrigin}` });
  assert.deepEqual(stepIds(result), ['g', 'b'], 'the row ran, so it is a step');
  assert.equal(result.seen.refused.length, 0, 'a redirect is not a refused move');
});

test('a link that the server redirects to another origin: the take stops at that row', T, async () => {
  const steps = [goto('g', '/take/'), { id: 'l', do: 'click', target: by('link', 'Next page') }, { id: 'w', do: 'wait', value: 1 }];
  const bounce = new URL('/scout/bounce', sites.origin).href;
  const result = await take(steps, {
    rewrite: (html) => html.replace('href="next.html"', 'href="/scout/bounce"'),
    mutate: (rows) => rows.map((row) => (row.id === 'l' ? { ...row, control: { ...row.control, href: bounce } } : row)),
  });
  assert.deepEqual(result.stopped, { row: 'l', reason: `the page moved to ${sites.otherOrigin}` });
  assert.deepEqual(stepIds(result), ['g', 'l']);
});

// ---- a stuck page ----

test('a page that busy-waits on the stopped clock: the take stops at that row with "the page is stuck"; the row is a step', T, async () => {
  const result = await take([goto('g', '/take/'), goto('b', '/busy/'), { id: 'w', do: 'wait', value: 1 }]);
  assert.deepEqual(result.stopped, { row: 'b', reason: 'the page is stuck' });
  assert.deepEqual(stepIds(result), ['g', 'b']);
  assert.deepEqual([result.steps[1].settle.capped, result.steps[1].settle.reason], [true, 'time']);
});

test('a page that is still animating when the settle is capped (by frames, or by the 20 s real-time cap with the page open) is not a stop', T, async () => {
  const result = await take([goto('p', '/slow/poll')]);
  assert.equal(result.stopped, null);
  assert.equal(result.steps[0].settle.capped, true);
  assert.ok(['frames', 'time'].includes(result.steps[0].settle.reason), result.steps[0].settle.reason);
});

// ---- the rows whose act began ----

test('ran lists every row whose act began, a row cut off by a cap too; steps does not hold the cut row', T, async () => {
  const steps = [goto('g', '/take/'), { id: 't', do: 'type', target: by('textbox', 'Your name'), value: 'Ada' }];
  const result = await take(steps, { limits: { filmSeconds: 1.6 } });
  assert.deepEqual(result.stopped, { row: 't', reason: 'film time cap' });
  assert.deepEqual(stepIds(result), ['g']);
  assert.deepEqual(result.ran, [{ id: 'g', effect: 'look' }, { id: 't', effect: 'change' }]);
});

test('ran does not list a row that was refused before its act: a control that is gone', T, async () => {
  const steps = [goto('g', '/take/'), { id: 'c', do: 'click', target: by('button', 'Reveal') }];
  const result = await take(steps, { rewrite: (html) => html.replace('<button type="button" id="go">Reveal</button>', '') });
  assert.deepEqual(result.stopped, { row: 'c', reason: 'no match' });
  assert.deepEqual(result.ran, [{ id: 'g', effect: 'look' }]);
});
