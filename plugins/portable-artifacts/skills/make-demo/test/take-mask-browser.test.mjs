// Masking in the page: boxes are drawn over what must not be filmed, and the pictures prove it (flat colour inside each box).
// Loopback fixtures only. One browser for the file; run with --test-concurrency=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSites, PRIVATE_SEEDS } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { openVisit } from '../scripts/lib/visit.mjs';
import { installStepper } from '../scripts/lib/stepper.mjs';
import { runScout } from '../scripts/lib/scout-run.mjs';
import { coverPage, uncoverPage } from '../scripts/lib/take-mask.mjs';
import { spreads, FLAT_SPREAD } from './pixels.mjs';

const VIEWPORT = { width: 800, height: 900 };
const SCALE = 3;
const INSET = 3; // CSS px inside a measured box: a JPEG shares colour over 16 px blocks, so the edge of a box bleeds a little into it
const T = { timeout: 180000 };

let sites;
let browser;
let blankContext;
let blank;
before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  sites = await startSites();
  browser = await launchBrowser();
  blankContext = await browser.newContext();
  blank = await blankContext.newPage(); // decodes pictures: a page of a guarded context would be closed as a popup
});
after(async () => {
  await blankContext?.close();
  await browser?.close();
  await sites?.close();
});

const SIGNED_IN = { cookies: [{ name: 'sid', value: 'fixture-session', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' }], origins: [] };

/** A take context at scale 3 with the stepper installed before the page opens; `path` is opened but not settled. */
async function openTake(path, { state = null } = {}) {
  sites.reset();
  if (state) await fetch(`${sites.origin}/login/signin`, { method: 'POST', redirect: 'manual' });
  const visit = await openVisit(browser, { viewport: VIEWPORT, origins: [sites.origin], state, scale: SCALE, posts: true, downloads: true });
  const stepper = await installStepper(visit.page, { fps: 30 });
  await visit.page.goto(`${sites.origin}${path}`, { waitUntil: 'domcontentloaded' });
  return { ...visit, stepper };
}

/** Runs in a frame: the boxes (viewport CSS px) of every text range holding `needle` and every field whose value holds it. */
function boxesWithText(needle) {
  const out = [];
  const roots = [document];
  for (let i = 0; i < roots.length; i += 1) for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(needle);
      if (at < 0 || ['SCRIPT', 'STYLE', 'TITLE'].includes(node.parentElement?.tagName)) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) out.push([r.left, r.top, r.width, r.height]);
    }
  }
  for (const field of document.querySelectorAll('input, textarea')) {
    const r = field.getBoundingClientRect();
    if (String(field.value).includes(needle) && r.width > 0) out.push([r.left, r.top, r.width, r.height]);
  }
  return out;
}

/** Runs in a frame: the box of the first element matching `selector`, or null. */
function boxOf(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [r.left, r.top, r.width, r.height];
}

async function frameOffset(frame) {
  if (frame.parentFrame() === null) return [0, 0];
  const box = await (await frame.frameElement()).boundingBox();
  return [box.x, box.y];
}

/** Every box on the page (every frame, the frame's own offset added) of the text `needle`. */
async function textBoxes(page, needle) {
  const out = [];
  for (const frame of page.frames()) {
    const [dx, dy] = await frameOffset(frame);
    for (const [x, y, w, h] of await frame.evaluate(boxesWithText, needle)) out.push([x + dx, y + dy, w, h]);
  }
  return out;
}

async function elementBox(page, selector) {
  for (const frame of page.frames()) {
    const box = await frame.evaluate(boxOf, selector);
    if (!box) continue;
    const [dx, dy] = await frameOffset(frame);
    return [box[0] + dx, box[1] + dy, box[2], box[3]];
  }
  throw new Error(`no ${selector} on the page`);
}

const inset = ([x, y, w, h]) => [x + INSET, y + INSET, w - 2 * INSET, h - 2 * INSET];
const pageShot = (page) => page.screenshot({ type: 'jpeg', quality: 90, scale: 'device' });

/** The spread of each box in the picture of the page as it is now. */
async function spreadsOf(page, boxes) {
  return spreads(blank, await pageShot(page), 'image/jpeg', boxes.map(inset), SCALE);
}
const flat = (spread, label) => assert.ok(spread !== null && spread <= FLAT_SPREAD, `${label} is flat (spread ${spread})`);
const notFlat = (spread, label) => assert.ok(spread !== null && spread > FLAT_SPREAD, `${label} is not flat (spread ${spread})`);

test('signed out, only the mask target is covered: its box is one flat colour, the heading and the email are not', T, async () => {
  const { context, page } = await openTake('/take/secret.html');
  try {
    await page.waitForLoadState('load');
    const [card, title, mail] = [await elementBox(page, '#card'), await elementBox(page, '#title'), (await textBoxes(page, 'ada.lovelace@example.test'))[0]];
    notFlat((await spreadsOf(page, [card]))[0], 'control: the card before it is covered');
    const { covered } = await coverPage(page, { mask: [{ css: '#card' }], signedIn: false });
    assert.equal(covered, 1);
    const [cardSpread, titleSpread, mailSpread] = await spreadsOf(page, [card, title, mail]);
    flat(cardSpread, '#card');
    notFlat(titleSpread, 'the heading');
    notFlat(mailSpread, 'the email, signed out');
  } finally {
    await context.close();
  }
});

test('a { role, name } target is covered too, and a target that matches nothing covers nothing', T, async () => {
  const { context, page } = await openTake('/take/secret.html');
  try {
    await page.waitForLoadState('load');
    const title = await elementBox(page, '#title');
    const { covered } = await coverPage(page, { mask: [{ role: 'heading', name: 'Secret fixture' }, { css: '#nothing-here' }, { role: 'link', name: 'No such link' }], signedIn: false });
    assert.equal(covered, 1);
    flat((await spreadsOf(page, [title]))[0], 'the heading');
  } finally {
    await context.close();
  }
});

test('signed in, every email, long number, key, password and field value that maskText would change is covered, in the page, a shadow root and a frame', T, async () => {
  const { context, page } = await openTake('/take/secret.html');
  try {
    await page.waitForLoadState('load');
    await page.frames()[1].waitForLoadState('load');
    const wanted = {
      email: (await textBoxes(page, 'ada.lovelace@example.test'))[0],
      splitFirst: await elementBox(page, '#split b'),
      splitSecond: await elementBox(page, '#split i'),
      number: await elementBox(page, '#num'),
      password: await elementBox(page, '#pw'),
      field: await elementBox(page, '#mailfield'),
      shadow: (await textBoxes(page, 'shadow.person@example.test'))[0],
      frame: (await textBoxes(page, 'frame.person@example.test'))[0],
    };
    const kept = { title: await elementBox(page, '#title'), plain: await elementBox(page, '#plain'), short: (await textBoxes(page, 'the short number 42'))[0] };
    for (const [name, box] of Object.entries({ ...wanted, ...kept })) assert.ok(box, `control: the page shows ${name}`);
    const before = await spreadsOf(page, Object.values(wanted));
    before.forEach((spread, i) => notFlat(spread, `control: ${Object.keys(wanted)[i]} before the cover`));
    const { covered } = await coverPage(page, { mask: [], signedIn: true });
    assert.ok(covered >= Object.keys(wanted).length, `covered ${covered}`);
    (await spreadsOf(page, Object.values(wanted))).forEach((spread, i) => flat(spread, Object.keys(wanted)[i]));
    (await spreadsOf(page, Object.values(kept))).forEach((spread, i) => notFlat(spread, `${Object.keys(kept)[i]} stays`));
  } finally {
    await context.close();
  }
});

test('signed in: text inside an open modal dialog (the top layer) is covered too', T, async () => {
  const { context, page } = await openTake('/take/secret-dialog.html');
  try {
    await page.waitForLoadState('load');
    const [mail] = await textBoxes(page, 'dialog.person@example.test');
    notFlat((await spreadsOf(page, [mail]))[0], 'control: the dialog email before the cover');
    await coverPage(page, { mask: [], signedIn: true });
    flat((await spreadsOf(page, [mail]))[0], 'the dialog email');
  } finally {
    await context.close();
  }
});

test('uncoverPage leaves nothing behind: the markup of the page and of its frame is as it was', T, async () => {
  const { context, page } = await openTake('/take/secret.html');
  try {
    await page.waitForLoadState('load');
    const markup = () => Promise.all(page.frames().map((frame) => frame.evaluate(() => `${document.documentElement.outerHTML}|${document.querySelectorAll('*').length}`)));
    const before = await markup();
    const { covered } = await coverPage(page, { mask: [{ css: '#card' }], signedIn: true });
    assert.ok(covered > 1);
    assert.notDeepEqual(await markup(), before, 'control: the cover is in the DOM while it is drawn');
    await uncoverPage(page);
    assert.deepEqual(await markup(), before);
    await uncoverPage(page); // twice is fine
    assert.deepEqual(await markup(), before);
  } finally {
    await context.close();
  }
});

test('signed in: a value that lands 400 ms after load, through a fetch, is covered once the clock has run past it', T, async () => {
  const { context, page, stepper } = await openTake('/login/home', { state: SIGNED_IN });
  try {
    assert.equal(await page.locator('#late').count(), 0, 'control: not there at load');
    await stepper.step(30);
    assert.equal(await page.locator('#late').count(), 1, 'control: it has landed');
    const names = [{ css: 'dd:nth-child(2)' }, { css: 'td:first-child' }, { css: 'a[href="/login/summary"]' }]; // a name is not a pattern: the plan masks it
    const { covered } = await coverPage(page, { mask: names, signedIn: true });
    assert.ok(covered >= PRIVATE_SEEDS.length, `covered ${covered}`);
    let checked = 0;
    for (const [n, seed] of PRIVATE_SEEDS.entries()) {
      const boxes = await textBoxes(page, seed);
      assert.ok(boxes.length > 0, `control: seed ${n} is on screen`);
      (await spreadsOf(page, boxes)).forEach((spread, i) => flat(spread, `seed ${n}, box ${i} at ${boxes[i].map(Math.round)}`));
      checked += boxes.length;
    }
    assert.ok(checked >= PRIVATE_SEEDS.length);
    const [, lateTop, , lateHeight] = await elementBox(page, '#late');
    const lateEmail = (await textBoxes(page, PRIVATE_SEEDS[0])).filter(([, y]) => y >= lateTop && y < lateTop + lateHeight);
    assert.equal(lateEmail.length, 1, 'control: the email of the late line is on screen');
    flat((await spreadsOf(page, lateEmail))[0], 'the email of the late line');
  } finally {
    await context.close();
  }
});

// ---- scout's signed-out picture ----

const scoutSpec = (extra) => ({ version: 1, source: { url: `${sites.origin}/take/secret.html` }, origins: [sites.origin], rights: 'own', useCases: [{ id: 'uc', title: 'T', steps: [{ id: 'g', do: 'goto', value: '/take/secret.html' }] }], ...extra });

test('scout: the signed-out picture hides the mask targets and scout.json records the mask', T, async () => {
  const mask = [{ css: '#card' }];
  const { context, page } = await openTake('/take/secret.html');
  let card;
  try {
    await page.waitForLoadState('load');
    card = await elementBox(page, '#card');
  } finally {
    await context.close();
  }
  const measure = async (result) => {
    assert.equal(result.ok, true, result.reason);
    const jpeg = result.shots.get('p1');
    assert.ok(jpeg, 'a picture was taken');
    return (await spreads(blank, jpeg, 'image/jpeg', [inset(card)], 1))[0];
  };
  const plain = await runScout({ browser, spec: scoutSpec({}) });
  notFlat(await measure(plain), 'control: the card without a mask');
  assert.deepEqual(plain.scout.mask, []);
  const masked = await runScout({ browser, spec: scoutSpec({ mask }) });
  flat(await measure(masked), '#card in the scout picture');
  assert.deepEqual(masked.scout.mask, mask);
});
