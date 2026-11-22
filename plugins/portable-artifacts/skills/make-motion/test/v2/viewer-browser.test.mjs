// make.mjs <film> --preview: the page in a headless browser with the network guarded (no blocked request), driven
// through its own controls; the child process stopped with SIGTERM exits 0 and closes its port. Skips without a browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { openSession, launchRunBrowser } from '../../scripts/v2/session.mjs';
import { guardNetwork } from '../../scripts/lib/browser.mjs';
import { runPreview, openUrl } from '../../scripts/v2/viewer-run.mjs';
import { startViewer } from '../../scripts/v2/viewer.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const BAR = (fill) => ({ type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill } });
const filmOf = (ground, extra = {}) => ({ version: 2, fps: 30, generatedBy: { model: 'm1' }, ...extra, shots: [
  { id: 'a', show: 'free', hold: 1, background: ground, nodes: [BAR('#15130f')] },
  { id: 'b', show: 'free', hold: 1, background: '#1f4e8c', cut: 'cut', nodes: [BAR('#ffe14a')] },
] });
const READY = () => document.body.dataset.ready === 'true' || document.body.classList.contains('invalid');

let dir, browser, child, url, page;
const blocked = [];
const filmFile = () => path.join(dir, 'film.json');
const writeFilm = (film) => writeFileSync(filmFile(), JSON.stringify(film));

// The preview as a child process: resolves its URL from the first line it prints.
function startPreview(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [MAKE, filmFile(), '--preview', '--json', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stderr.on('data', (d) => { err += d; });
    proc.stdout.on('data', (d) => {
      out += d;
      if (out.includes('\n')) resolve({ proc, line: JSON.parse(out.split('\n')[0]) });
    });
    proc.on('exit', (code) => reject(new Error(`preview exited ${code} before printing: ${out}${err}`)));
  });
}

const sourceHash = (p) => p.evaluate(async () => {
  const blob = await window.__source.convertToBlob({ type: 'image/png' });
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
});
const frameShown = (n) => page.waitForFunction((i) => window.__viewer.p.frame === i && !window.__viewer.p.busy, n);

before(async () => {
  if (!await browserAvailable()) return;
  dir = mkdtempSync(path.join(tmpdir(), 'mm-viewer-b-'));
  writeFilm(filmOf('#f3eee3'));
  ({ proc: child, line: { preview: { url } } } = await startPreview([]));
  browser = await launchRunBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.__copied.push(text); } } });
  });
  page = await context.newPage();
  await guardNetwork(page, new URL(url).origin, (u) => blocked.push(u));
  await page.goto(url);
  await page.waitForFunction(READY);
});
after(async () => {
  await browser?.close();
  if (child && child.exitCode === null) child.kill('SIGKILL');
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test('the scrubber at frame n shows the pixels __seek(n) gives on the render page', async (t) => {
  if (!browser) return t.skip('no browser');
  const session = await openSession(loadFilm(filmFile()), { browser });
  try {
    for (const n of [10, 40]) {
      await page.$eval('#scrub', (el, i) => { el.value = String(i); el.dispatchEvent(new Event('input')); }, n);
      await frameShown(n);
      await session.page.evaluate((i) => window.__seek(i), n);
      assert.equal(await sourceHash(page), await sourceHash(session.page), `frame ${n}`);
    }
  } finally {
    await session.close();
  }
});

test('Space toggles play, and the arrow keys move one frame', async (t) => {
  if (!browser) return t.skip('no browser');
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => window.__viewer.p.playing), true);
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => window.__viewer.p.playing), false);
  await page.$eval('#scrub', (el) => { el.value = '20'; el.dispatchEvent(new Event('input')); });
  await frameShown(20);
  await page.locator('#stage').focus().catch(() => {});
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('ArrowRight');
  await frameShown(21);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await frameShown(19);
});

test('a click on an element copies its path in the film; the footer shows the provenance line', async (t) => {
  if (!browser) return t.skip('no browser');
  await page.$eval('#scrub', (el) => { el.value = '10'; el.dispatchEvent(new Event('input')); });
  await frameShown(10);
  const box = await page.locator('#stage').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + (540 / 1080) * box.height);
  const copied = await page.evaluate(() => window.__copied);
  assert.equal(copied.length, 1);
  assert.equal(copied[0], 'shots[0]  id=a  node=bar');
  assert.match(await page.textContent('#toast'), /^shots\[0\]/);
  assert.match(await page.textContent('#provenance'), /^make-motion · m1 · effort not reported/);
});

test('an edit reloads the page; an invalid edit shows the validator\'s line; a valid one brings the film back', async (t) => {
  if (!browser) return t.skip('no browser');
  const before = await sourceHash(page);
  let reload = page.waitForEvent('load');
  writeFilm(filmOf('#c43d2f'));
  await reload;
  await page.waitForFunction(READY);
  assert.notEqual(await sourceHash(page), before, 'the new background is drawn');
  reload = page.waitForEvent('load');
  writeFileSync(filmFile(), JSON.stringify({ ...filmOf('#c43d2f'), shots: [{ id: 'a', show: 'free', hold: -1, nodes: [] }] }));
  await reload;
  await page.waitForFunction(READY);
  assert.equal(await page.evaluate(() => document.body.classList.contains('invalid')), true);
  assert.match(await page.textContent('#errors'), /shots\[0\]\.hold/);
  reload = page.waitForEvent('load');
  writeFilm(filmOf('#f3eee3', { provenance: false }));
  await reload;
  await page.waitForFunction(READY);
  assert.equal(await page.evaluate(() => document.body.classList.contains('invalid')), false);
  assert.equal(await page.textContent('#provenance'), '', 'provenance: false leaves the footer empty');
});

// ---- the playhead through a reload (engine/page/playhead.mjs) ----

// Each test below runs on its own in-process preview server and its own page (network-guarded, so the "no request left
// the origin" test below sees them too), so any one of them runs alone or in any order.
// The same film with every shot held for `hold` seconds.
const heldFilm = (ground, hold, extra = {}) => { const f = filmOf(ground, extra); return { ...f, shots: f.shots.map((s) => ({ ...s, hold })) }; };
const SOUND_BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A preview of `film` and a page on it. `edit(film)` is an edit that validates; `fail(lines)` one that does not.
async function ownPreview(film, { audio = false, init = null, hash = '' } = {}) {
  const own = mkdtempSync(path.join(tmpdir(), 'mm-viewer-own-'));
  const file = path.join(own, 'film.json');
  writeFileSync(file, JSON.stringify(film));
  if (audio) writeFileSync(path.join(own, 'sound.m4a'), SOUND_BYTES);
  const viewer = await startViewer({ loaded: loadFilm(file), audio: audio ? path.join(own, 'sound.m4a') : null });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (init) await context.addInitScript(init);
  const ownPage = await context.newPage();
  await guardNetwork(ownPage, new URL(viewer.url).origin, (u) => blocked.push(u));
  const edit = (next) => { writeFileSync(file, JSON.stringify(next)); viewer.update({ loaded: loadFilm(file), audio: audio ? path.join(own, 'sound.m4a') : null }); };
  // An edit is picked up on the next poll (one second): wait for the reload, then for the page to be ready.
  const afterEdit = async (change) => {
    const reload = ownPage.waitForEvent('load');
    change();
    await reload;
    await ownPage.waitForFunction(READY);
  };
  const seekTo = async (n) => {
    await ownPage.$eval('#scrub', (el, i) => { el.value = String(i); el.dispatchEvent(new Event('input')); }, n);
    await ownPage.waitForFunction((i) => window.__viewer.p.frame === i && !window.__viewer.p.busy, n);
  };
  // The pixels frame n of the film now on disk has on the render page.
  const renderHash = async (n) => {
    const session = await openSession(loadFilm(file), { browser });
    try {
      await session.page.evaluate((i) => window.__seek(i), n);
      return await sourceHash(session.page);
    } finally {
      await session.close();
    }
  };
  const open = async () => { await ownPage.goto(`${viewer.url}${hash}`); await ownPage.waitForFunction(READY); };
  const close = async () => { await context.close(); await viewer.close(); };
  return { viewer, page: ownPage, edit, afterEdit, seekTo, renderHash, open, close };
}
const withPreview = async (film, opts, run) => {
  const preview = await ownPreview(film, opts);
  try {
    await preview.open();
    await run(preview);
  } finally {
    await preview.close();
  }
};
const isInvalid = (p) => p.evaluate(() => document.body.classList.contains('invalid'));

test('an edit reloads the page on the frame it was showing', async (t) => {
  if (!browser) return t.skip('no browser');
  await withPreview(filmOf('#f3eee3'), {}, async (p) => {
    await p.seekTo(40);
    await p.afterEdit(() => p.edit(filmOf('#dfe6ee'))); // the same length, a new ground
    await p.page.waitForFunction(() => window.__viewer?.p.frame === 40 && document.body.dataset.ready === 'true' && location.hash === '#f=40&p=0');
    assert.equal(await sourceHash(p.page), await p.renderHash(40), "the new film's frame 40");
  });
});

test('a film that got shorter clamps to its last frame', async (t) => {
  if (!browser) return t.skip('no browser');
  await withPreview(filmOf('#f3eee3'), {}, async (p) => {
    await p.seekTo(40);
    await p.afterEdit(() => p.edit({ ...filmOf('#dfe6ee'), shots: filmOf('#dfe6ee').shots.slice(0, 1) })); // one shot of a second: 30 frames (a hold is at least 1)
    assert.equal(await p.page.evaluate(() => document.body.dataset.ready), 'true');
    assert.equal(await p.page.evaluate(() => window.__viewer.p.frame), 29);
    assert.equal(await isInvalid(p.page), false);
  });
});

test('an edit that does not validate keeps the frame for the edit that fixes it', async (t) => {
  if (!browser) return t.skip('no browser');
  await withPreview(filmOf('#f3eee3'), {}, async (p) => {
    await p.seekTo(20);
    await p.afterEdit(() => p.viewer.fail(['shots[0].hold: must be >= 1']));
    assert.equal(await isInvalid(p.page), true);
    await p.afterEdit(() => p.edit(filmOf('#dfe6ee')));
    assert.equal(await isInvalid(p.page), false);
    await p.page.waitForFunction(() => window.__viewer?.p.frame === 20 && !window.__viewer.p.busy);
  });
});

test('a playing silent film is playing again after the reload', async (t) => {
  if (!browser) return t.skip('no browser');
  await withPreview(heldFilm('#f3eee3', 3), {}, async (p) => { // 180 frames: it cannot finish between the poll and the check
    await p.page.click('#play');
    await p.afterEdit(() => p.edit(heldFilm('#dfe6ee', 3)));
    assert.equal(await p.page.evaluate(() => window.__viewer.p.playing), true);
    assert.equal(await p.page.textContent('#play'), 'Pause');
  });
});

test('when the browser refuses to play the sound, the player is paused, not stuck', async (t) => {
  if (!browser) return t.skip('no browser');
  const refuse = () => { HTMLMediaElement.prototype.play = () => Promise.reject(Object.assign(new Error('refused'), { name: 'NotAllowedError' })); };
  await withPreview(filmOf('#f3eee3'), { audio: true, init: refuse, hash: '#f=10&p=1' }, async (p) => {
    await p.page.waitForFunction(() => window.__viewer.p.playing === false && !window.__viewer.p.busy);
    assert.equal(await p.page.textContent('#play'), 'Play');
    assert.equal(await p.page.evaluate(() => window.__viewer.p.frame), 10);
  });
});

test('a play cut short by a pause (AbortError) is not a refusal: the player keeps playing', async (t) => {
  if (!browser) return t.skip('no browser');
  const abort = () => { HTMLMediaElement.prototype.play = () => Promise.reject(Object.assign(new Error('interrupted'), { name: 'AbortError' })); };
  await withPreview(filmOf('#f3eee3'), { audio: true, init: abort, hash: '#f=10&p=1' }, async (p) => {
    await sleep(300); // the rejection has been handled by now
    assert.equal(await p.page.evaluate(() => window.__viewer.p.playing), true);
    assert.equal(await p.page.textContent('#play'), 'Pause');
    await p.page.click('#play');
  });
});

test('the page is marked as a player only once the saved frame is drawn and play has resumed', async (t) => {
  if (!browser) return t.skip('no browser');
  // records the player's state at the moment the page publishes it as window.__viewer
  const record = () => {
    let held;
    Object.defineProperty(window, '__viewer', {
      configurable: true,
      get: () => held,
      set: (v) => { window.__atPublish = { frame: v.p.frame, drawn: v.p.drawn === true, playing: v.p.playing }; held = v; },
    });
  };
  await withPreview(filmOf('#f3eee3'), { init: record, hash: '#f=10&p=1' }, async (p) => {
    assert.deepEqual(await p.page.evaluate(() => window.__atPublish), { frame: 10, drawn: true, playing: true });
    await p.page.click('#play');
  });
});

test('once a reload has started, a later poll tick neither writes the fragment nor asks again', async (t) => {
  if (!browser) return t.skip('no browser');
  // each replaceState call on the page logs a line the test counts (an evaluate on a page with a navigation pending
  // blocks); the new page's document is held back for 3.5 s, so the old page lives on for three more poll ticks
  const count = () => { const original = history.replaceState.bind(history); history.replaceState = (...args) => { console.log('playhead-written'); return original(...args); }; };
  await withPreview(filmOf('#f3eee3'), { init: count }, async (p) => {
    let writes = 0;
    p.page.on('console', (message) => { if (message.text() === 'playhead-written') writes += 1; });
    let hold = true;
    await p.page.route('**/preview', async (route) => {
      if (hold && route.request().resourceType() === 'document') await sleep(3500);
      return route.fallback();
    });
    await p.afterEdit(() => p.edit(filmOf('#dfe6ee')));
    hold = false;
    assert.equal(writes, 1);
  });
});

test('no request left the preview\'s origin', (t) => {
  if (!browser) return t.skip('no browser');
  assert.deepEqual(blocked, []);
});

test('SIGTERM stops the preview cleanly: exit 0 and the port closed', async (t) => {
  if (!browser) return t.skip('no browser');
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 0, signal: null });
  await assert.rejects(fetch(`${url}/state`));
});

test('--open calls the opener once with the URL; nothing is opened without it; a remote URL is refused', async (t) => {
  if (!browser) return t.skip('no browser');
  writeFilm(filmOf('#f3eee3'));
  const run = async (open) => {
    const opened = [];
    const controller = new AbortController();
    const result = runPreview({ specPath: filmFile(), open, json: false, provenance: { noProvenance: false } }, {
      signal: controller.signal, opener: (u) => opened.push(u), say: (line) => { opened.url = line; controller.abort(); },
    });
    assert.deepEqual(await result, { exitCode: 0 });
    return opened;
  };
  const withOpen = await run(true);
  assert.equal(withOpen.length, 1);
  assert.match(withOpen[0], /^http:\/\/127\.0\.0\.1:\d+\/preview$/);
  assert.equal(withOpen.url, `preview: ${withOpen[0]}`);
  assert.equal((await run(false)).length, 0);
  assert.throws(() => openUrl('https://example.com/'), /refusing to open/);
});
