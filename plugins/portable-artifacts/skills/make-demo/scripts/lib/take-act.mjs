// One approved row of a take, run against the live page under the stepped clock (stepper.mjs).
//   liveControl(page, row, { signedIn, scoutPage })  is the control still the one the owner approved? { ok, locator, box, facts } or { ok: false, reason }
//   act(page, stepper, row, { signedIn, pointer, onFrame, scoutPage, live })  move the pointer over 10 frames, do the act, settle
//
// What the stopped clock needed (phase 2 task 1, measured on the loopback fixtures in test/take-act-browser.test.mjs):
//  - Playwright's own actionability waits use animation frames, which do not come while the clock is stopped, so no act uses a
//    waiting variant. liveControl does the visibility and single-match check itself; click is `mouse.click` at the box centre,
//    typing is `keyboard.type`, select is `selectOption({ force: true })`, press is `keyboard.press`, and focus is `locator.focus()`
//    (it waits only for the element to exist). Every call into the page is held to ACT_DEADLINE_MS of real time and throws StepTimeout past it.
//  - Before a click the point under the pointer is checked (`elementFromPoint`): when something else covers the control, the act is
//    refused (ActRefused), never clicked at the wrong thing.
//  - Nothing hung: every verb finished under the stopped clock with no waiting variant, `force` or fallback of the plan's Step 3 other
//    than the one below. What a click that navigates needed: a step that runs while a navigation commits fails with "Execution
//    context was destroyed" (a same-origin form post with its redirect did; a plain link got lucky), so after a click or a key the
//    clock is not stepped until the navigation has landed (`awaitNavigation`: real time only, film time does not move), and a
//    settle that still meets one (a timer that navigates) waits for it and settles again (`settleAfterNavigation`).
//
// Frame numbers are film frames, `round(stepper.now() * 30 / 1000)`, so `settleFrame - startFrame` is the number of steps the act took
// and `onFrame` ran once after each. `scroll` with a `value` scrolls to that many pixels from the top; with a target it centres the target.
import { StepTimeout, scrollTo } from './stepper.mjs';
import { controlOf, maskControl, maskName, walkTree } from './digest.mjs';
import { readFacts } from './page-facts.mjs';

const FPS = 30;
const POINTER_FRAMES = 10;
const CHAR_FRAMES = 2;
const SCROLL_SECONDS = 0.8;
const LOCATE_MS = 4000;
const ACT_DEADLINE_MS = 8000;
const GOTO_MS = 30000;
const NAV_GRACE_MS = 60;
const NAV_POLL_MS = 5;
const NAV_REAL_MS = 4000;
const SETTLE_TRIES = 3;
const LENGTH_ONLY_NAME = /^<text \d+>$/;
const COMPARED = ['role', 'name', 'kind', 'href', 'formAction', 'formMethod'];

/** The act was refused before it touched the page (the control changed, or something covers it). The take stops at this row. */
export class ActRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'ActRefused';
  }
}

// ---- finding the live control ------------------------------------------------------------------------------------------------

const locate = (page, target) => (target.css === null ? page.getByRole('heading', { name: target.name, exact: true }) : page.locator(target.css));

/** The visible elements a locator matches. A selector the browser refuses matches none. */
async function visibleOnes(locator) {
  try {
    const all = await locator.all();
    const flags = await Promise.all(all.map((one) => one.isVisible()));
    return all.filter((_, i) => flags[i]);
  } catch {
    return [];
  }
}

/** The element as scout read it: role and name from its accessibility node, the rest from `readFacts`, and its box. */
async function readElement(locator) {
  const [facts, tree, box] = await Promise.all([
    locator.evaluate(readFacts, undefined, { timeout: LOCATE_MS }),
    locator.ariaSnapshotJSON({ mode: 'ai', timeout: LOCATE_MS }),
    locator.boundingBox({ timeout: LOCATE_MS }),
  ]);
  const node = tree[0] ?? {};
  return { facts, box, role: node.role ?? '', name: node.name ?? '' };
}

/** What the page lists with this role and name, counted the way scout lists controls (a candidate with a size). */
async function liveTwins(page, target) {
  const roots = await page.ariaSnapshotJSON({ mode: 'ai', boxes: true, timeout: LOCATE_MS });
  return walkTree(roots).candidates.filter((c) => c.role === target.role && c.name === target.name).length;
}

const scoutTwins = (scoutPage, target) => scoutPage.controls.filter((c) => c.role === target.role && c.name === target.name).length;

/** The live control in the shape of a plan row's control: signed in, masked exactly as scout masked it. `null` when the element is no control. */
function liveShape(read, row, signedIn) {
  if (row.target.css === null) return { role: read.role, name: signedIn ? maskName(read.name) : read.name, kind: 'heading', href: null, formAction: null, formMethod: null };
  const control = controlOf({ role: read.role, name: read.name, box: read.box }, read.facts);
  if (control === null) return null;
  const shaped = signedIn ? maskControl(control) : control;
  return { role: shaped.role, name: shaped.name, kind: shaped.kind, href: shaped.href, formAction: shaped.formAction, formMethod: shaped.formMethod };
}

/** The first field that differs from what the plan bound, or null. A stored `<text N>` name is only a length, so the name is not compared. */
function firstDifference(live, row) {
  const wanted = { role: row.target.role, name: row.target.name, ...row.control };
  const lengthOnly = LENGTH_ONLY_NAME.test(row.target.name);
  if (live === null) return 'kind';
  return COMPARED.find((field) => {
    if (field === 'name' && lengthOnly) return false;
    if (row.target.css === null && !['role', 'name'].includes(field)) return false;
    return live[field] !== wanted[field];
  }) ?? null;
}

/**
 * Is the live control the approved one? Located by the row's css (a heading, css null: by role and exact name); exactly one visible
 * element, else `no match` or `2 matches`. Signed out a twin elsewhere on the page (more of this role and name than scout listed) is
 * `2 matches` too. Signed in names and addresses are masked as scout masked them, and twins are not counted (names are masked).
 * `scoutPage` is the scouted page entry; without it twins are not counted.
 */
export async function liveControl(page, row, { signedIn, scoutPage = null }) {
  const found = await visibleOnes(locate(page, row.target));
  if (found.length === 0) return { ok: false, reason: 'no match' };
  if (found.length > 1) return { ok: false, reason: `${found.length} matches` };
  const locator = found[0];
  const read = await readElement(locator);
  if (!signedIn && scoutPage && row.target.css !== null && row.target.name !== '' && (await liveTwins(page, row.target)) > scoutTwins(scoutPage, row.target)) {
    return { ok: false, reason: '2 matches' };
  }
  const different = firstDifference(liveShape(read, row, signedIn), row);
  if (different) return { ok: false, reason: `the control changed: ${different}` };
  return { ok: true, locator, box: read.box, facts: read.facts };
}

// ---- doing the act -----------------------------------------------------------------------------------------------------------

/** `promise`, or a StepTimeout after ACT_DEADLINE_MS of real time: the page is stuck under the stopped clock. */
function limited(promise, label) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeout(`${label} did not finish in ${ACT_DEADLINE_MS} ms: the page is stuck`)), ACT_DEADLINE_MS);
  });
  promise.catch(() => {}); // a late rejection after the deadline is not left unhandled
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

const frameOf = (stepper) => Math.round((stepper.now() * FPS) / 1000);
const centre = (box) => ({ x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);

/** The pointer glides from `from` to `to` in POINTER_FRAMES steps, one `mouse.move` and one frame each. */
async function movePointer(page, frames, from, to) {
  for (let i = 1; i <= POINTER_FRAMES; i += 1) {
    const e = easeInOut(i / POINTER_FRAMES);
    await limited(page.mouse.move(Math.round(from.x + (to.x - from.x) * e), Math.round(from.y + (to.y - from.y) * e)), 'a pointer move');
    await frames(1);
  }
}

/** True when the element is what sits under its own centre: nothing covers it. */
const isUncovered = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  const hit = el.getRootNode().elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return Boolean(hit) && (el.contains(hit) || hit.closest('label')?.control === el);
}, undefined, { timeout: LOCATE_MS });

async function clickAt(page, live, at) {
  if (!(await isUncovered(live.locator))) throw new ActRefused('the control is covered by something else');
  await limited(page.mouse.click(at.x, at.y), 'a click');
}

// ---- navigation ----------------------------------------------------------------------------------------------------------------

const realWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isMainNavigation = (page, request) => {
  try {
    return request.isNavigationRequest() && request.frame() === page.mainFrame();
  } catch {
    return false; // a popup's request has no frame yet
  }
};

/** Counts the main frame's navigation requests (a form post and its redirect, a refused move) from now until `stop()`. */
function watchNavigation(page) {
  const watch = { pending: new Set(), total: 0 };
  const started = (request) => { if (isMainNavigation(page, request)) { watch.pending.add(request); watch.total += 1; } };
  const ended = (request) => { watch.pending.delete(request); };
  page.on('request', started);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  watch.stop = () => { page.off('request', started); page.off('requestfinished', ended); page.off('requestfailed', ended); };
  return watch;
}

/**
 * NAVIGATION, what the stopped clock needed: a step that runs while a navigation commits fails ("Execution context was destroyed"),
 * so after a click or a key the clock is NOT stepped until the navigation has landed. A navigation request starts within a few ms of
 * the input that causes it, so wait NAV_GRACE_MS of real time, then (real time again, no step) until no main-frame navigation
 * request is in flight and the document has reached domcontentloaded, or NAV_REAL_MS. Film time does not move meanwhile.
 */
async function awaitNavigation(page, watch) {
  const until = Date.now() + NAV_REAL_MS;
  await realWait(NAV_GRACE_MS);
  while (watch.pending.size > 0 && Date.now() < until) await realWait(NAV_POLL_MS);
  if (watch.total > 0) await page.waitForLoadState('domcontentloaded', { timeout: Math.max(1, until - Date.now()) }).catch(() => {});
}

const NAVIGATION_RACE = /Execution context was destroyed|navigation/i;

/**
 * Settle, and when a navigation that began later (a timer, after the first steps) destroys the page under a step, wait for it to land
 * and settle again; at most SETTLE_TRIES times, so a page that navigates for ever still ends in the error.
 */
async function settleAfterNavigation(page, stepper, onFrame, watch) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await stepper.settle({ onStep: onFrame });
    } catch (error) {
      if (attempt >= SETTLE_TRIES || !NAVIGATION_RACE.test(String(error?.message))) throw error;
      await awaitNavigation(page, watch);
    }
  }
}

async function typeText(page, live, text, frames) {
  await limited(live.locator.focus({ timeout: LOCATE_MS }), 'focus');
  for (const character of String(text)) {
    await limited(page.keyboard.type(character), 'typing');
    await frames(CHAR_FRAMES);
  }
}

async function scrollAct(page, row, live, frames) {
  let y = Number(row.value);
  if (row.value === null || row.value === undefined) {
    const here = await page.evaluate(() => ({ top: window.scrollY, height: window.innerHeight }));
    y = Math.max(0, Math.round(live.box.y + here.top - (here.height - live.box.height) / 2));
  }
  await scrollTo(page, y, SCROLL_SECONDS);
}

async function doAct(ctx) {
  const { page, row, live, frames, at, watch } = ctx;
  switch (row.do) {
    case 'click':
      await clickAt(page, live, at);
      return awaitNavigation(page, watch);
    case 'type': return typeText(page, live, row.value, frames);
    case 'select': return limited(live.locator.selectOption(String(row.value), { force: true, timeout: LOCATE_MS }), 'select');
    case 'press':
      if (live) await limited(live.locator.focus({ timeout: LOCATE_MS }), 'focus');
      await limited(page.keyboard.press(String(row.value)), 'a key press');
      return awaitNavigation(page, watch);
    case 'scroll': return scrollAct(page, row, live, frames);
    case 'wait': return frames(Math.round(Number(row.value) * FPS));
    case 'goto': return gotoAddress(page, row.address);
    default: return undefined; // hover and show: the pointer move was the act
  }
}

/** Open the address; a move the guard refuses is not an error here (the visit's `refused` list says so and the take stops on it). */
async function gotoAddress(page, address) {
  try {
    await limited(page.goto(address, { waitUntil: 'domcontentloaded', timeout: GOTO_MS }), 'goto');
  } catch (error) {
    if (!/ERR_BLOCKED_BY_CLIENT/.test(String(error?.message))) throw error;
  }
}

const sameBox = (a, b) => Boolean(a) && Boolean(b) && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Run one row. `live` is the result of liveControl when the caller already has it (else it is read here for a row with a target, and a
 * control that is not the approved one is an ActRefused). Returns { startFrame, actFrame, settleFrame, pointer, box, boxMoved, settle }:
 * `box` is where the control was when the act began, `boxMoved` whether it had moved when the pointer arrived (the click goes to where
 * it is then). `onFrame()` is awaited after every step, settle steps included.
 */
export async function act(page, stepper, row, { signedIn, pointer = null, onFrame = null, scoutPage = null, live = null }) {
  const startFrame = frameOf(stepper);
  const found = row.target ? (live ?? await liveControl(page, row, { signedIn, scoutPage })) : null;
  if (found && !found.ok) throw new ActRefused(found.reason);
  const frames = async (n) => {
    for (let i = 0; i < n; i += 1) {
      await stepper.step();
      if (onFrame) await onFrame();
    }
  };
  let at = pointer ?? { x: 0, y: 0 };
  let boxMoved = false;
  const box = found?.box ?? null;
  if (found) {
    await movePointer(page, frames, at, centre(box));
    const arrived = await found.locator.boundingBox({ timeout: LOCATE_MS });
    boxMoved = !sameBox(box, arrived);
    at = arrived ? centre(arrived) : centre(box);
  }
  const actFrame = frameOf(stepper);
  const watch = watchNavigation(page);
  try {
    await doAct({ page, row, live: found, frames, at, watch });
    const settle = await settleAfterNavigation(page, stepper, onFrame, watch);
    return { startFrame, actFrame, settleFrame: frameOf(stepper), pointer: at, box, boxMoved, settle };
  } finally {
    watch.stop();
  }
}
