// One run of a site's look-only steps, either with the page clock stepped or in real time. The probe never types and never submits:
// a click is allowed only on a plain link or on a button outside any form, never on a control whose name or address says delete, pay, send...
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installStepper, scrollTo } from '../../scripts/lib/stepper.mjs';
import { frameStore } from '../../scripts/lib/frames.mjs';
import { wallReason } from './compare.mjs';

export const FPS = 30;
const VIEWPORT = { width: 1280, height: 720 };
const DEVICE_SCALE = 3;
const ACTION_FRAMES = 15;
const HOLD_FRAMES = 15;
const FRAME_JPEG_QUALITY = 95;
const GOTO_MS = 30000;
const ACTION_TIMEOUT_MS = 10000;
const REAL_POLL_MS = 200;
const REAL_STILL_POLLS = 3;
const REAL_SETTLE_MS = 8000;
const REAL_SCROLL_PAD_MS = 150;
const REAL_ACT_PAD_MS = 500;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SETTLE_SHOT = { type: 'jpeg', quality: 70, scale: 'css' };
const DANGER = /\b(delete|remove|pay|buy|purchase|checkout|send|invite|publish|sign[ -]?out|log[ -]?out|billing|account|subscribe|unsubscribe|submit|confirm|archive|transfer|upload|save|create|post|reset)\b/i;
const CONTROL_ROLES = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'tab', 'menuitem', 'switch', 'searchbox', 'slider', 'spinbutton', 'option', 'treeitem']);
const ROLE_LINE = /^\s*- ([a-z]+) "((?:[^"\\]|\\.)*)"/;

/** Controls (role and name) and headings out of an ariaSnapshot. */
export function parseSnapshot(text) {
  const controls = [];
  const headings = [];
  for (const line of text.split('\n')) {
    const m = ROLE_LINE.exec(line);
    if (!m) continue;
    if (m[1] === 'heading') headings.push(m[2]);
    else if (CONTROL_ROLES.has(m[1])) controls.push(`${m[1]} ${m[2]}`);
  }
  return { controls, headings };
}

/** Why a click on this control is not a look, or null. `info` is what the page says about the element. */
export function clickRefusal({ role, name }, info) {
  const text = `${name} ${info.href ?? ''}`;
  if (DANGER.test(text)) return `the name or address reads as a change (${text.trim().slice(0, 60)})`;
  if (role === 'tab') return null;
  if (role === 'link') {
    if (!info.href || /^javascript:/i.test(info.href)) return 'a link with no plain address';
    if (info.download || (info.target && info.target !== '_self')) return 'a link that downloads or opens another window';
    return null;
  }
  if (role === 'button') return info.inForm || info.type === 'submit' ? 'a button inside a form submits it' : null;
  return `role ${role} is not listed as a look`;
}

function watchRun(page, run) {
  page.on('pageerror', (e) => run.errors.push(String(e.message)));
  page.on('request', (r) => {
    if (!SAFE_METHODS.has(r.method())) run.nonGet += 1;
    run.pending.add(r);
  });
  page.on('requestfinished', (r) => run.pending.delete(r));
  page.on('requestfailed', (r) => run.pending.delete(r));
}

async function openRun(browser, stepped) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE });
  const page = await context.newPage();
  const run = { context, page, errors: [], nonGet: 0, blocked: [], pending: new Set(), stepper: null };
  watchRun(page, run);
  if (stepped) run.stepper = await installStepper(page, { fps: FPS, startTime: Date.now() });
  return run;
}

async function settleReal(run) {
  const began = Date.now();
  let previous = null;
  let equal = 0;
  let polls = 0;
  while (Date.now() - began < REAL_SETTLE_MS) {
    await run.page.waitForTimeout(REAL_POLL_MS);
    polls += 1;
    const shot = await run.page.screenshot(SETTLE_SHOT);
    equal = previous && shot.equals(previous) && run.pending.size === 0 ? equal + 1 : 0;
    previous = shot;
    if (equal >= REAL_STILL_POLLS) return { frames: polls, capped: false, reason: 'still' };
  }
  return { frames: polls, capped: true, reason: 'time' };
}

async function recordStep(run, out, label) {
  const settle = run.stepper ? await run.stepper.settle() : await settleReal(run);
  const png = await run.page.screenshot({ type: 'png', scale: 'css' });
  const { controls, headings } = parseSnapshot(await run.page.locator('body').ariaSnapshot());
  out.steps.push({ label, png, controls, headings, settle });
  out.wall ??= wallReason({ title: await run.page.title(), headings });
}

async function captureFrames(run, out, count) {
  const began = Date.now();
  for (let i = 0; i < count; i += 1) {
    await run.stepper.step(1);
    const frame = await run.page.screenshot({ type: 'jpeg', quality: FRAME_JPEG_QUALITY });
    out.film.store.add(frame);
    out.film.rawBytes += frame.length;
    out.film.frames += 1;
  }
  out.film.wallMs += Date.now() - began;
}

/** Stop writes while a click settles: a look must not send anything but a GET. */
async function guardWrites(run) {
  const handler = (route) => {
    const request = route.request();
    if (SAFE_METHODS.has(request.method())) return route.continue();
    run.blocked.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.abort('blockedbyclient');
  };
  await run.page.route('**/*', handler);
  return () => run.page.unroute('**/*', handler);
}

async function findControl(run, step) {
  const locator = run.page.getByRole(step.role, { name: step.name, exact: true });
  const count = await locator.count();
  if (count === 0) return { problem: `no ${step.role} named "${step.name}" on the page` };
  if (count > 1) return { problem: `${count} ${step.role}s are named "${step.name}"` };
  const info = await locator.evaluate((el) => ({ href: el.getAttribute('href'), inForm: Boolean(el.closest('form')), type: el.getAttribute('type'), download: el.hasAttribute('download'), target: el.getAttribute('target') }));
  return { locator, info };
}

/** Do one step. Returns { problem } when the step cannot be a look, else { frames, pad } (film frames or real ms to wait). */
async function applyStep(run, step) {
  if (step.do === 'scroll') {
    await scrollTo(run.page, step.to, step.seconds);
    return { frames: Math.ceil(step.seconds * FPS), pad: step.seconds * 1000 + REAL_SCROLL_PAD_MS };
  }
  const found = await findControl(run, step);
  if (found.problem) return found;
  if (step.do === 'click') {
    const refusal = clickRefusal(step, found.info);
    if (refusal) return { problem: `refused to click ${step.role} "${step.name}": ${refusal}` };
    await found.locator.click({ timeout: ACTION_TIMEOUT_MS });
    await run.page.waitForLoadState('load', { timeout: ACTION_TIMEOUT_MS });
  } else {
    await found.locator.hover({ timeout: ACTION_TIMEOUT_MS });
  }
  return { frames: ACTION_FRAMES, pad: REAL_ACT_PAD_MS };
}

async function runStep(run, out, step, index) {
  const unguard = step.do === 'click' ? await guardWrites(run) : async () => {};
  try {
    const applied = await applyStep(run, step);
    if (applied.problem) return applied.problem;
    if (run.stepper) await captureFrames(run, out, applied.frames + HOLD_FRAMES);
    else await run.page.waitForTimeout(applied.pad);
    await recordStep(run, out, `${index + 1}: ${step.do}`);
    return null;
  } finally {
    await unguard();
  }
}

/** Open the site and walk its steps once. The result never throws for a site's own trouble: `problem` says what stopped it. */
export async function captureRun(browser, entry, { stepped }) {
  const run = await openRun(browser, stepped);
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-frames-'));
  const out = { steps: [], wall: null, status: 0, problem: null, errors: run.errors, film: { frames: 0, rawBytes: 0, wallMs: 0, store: frameStore(framesDir) } };
  try {
    const response = await run.page.goto(entry.url, { waitUntil: 'load', timeout: GOTO_MS });
    out.status = response?.status() ?? 0;
    await recordStep(run, out, 'load');
    out.wall = wallReason({ status: out.status, title: await run.page.title(), headings: out.steps[0].headings }) ?? out.wall;
    for (const [index, step] of (out.wall ? [] : entry.steps).entries()) {
      out.problem = await runStep(run, out, step, index);
      if (out.problem || out.wall) break;
    }
  } catch (error) {
    out.problem = `${stepped ? 'stepped' : 'real-time'} run failed: ${String(error.message).split('\n')[0]}`;
  } finally {
    out.nonGet = run.nonGet;
    out.blocked = run.blocked;
    await run.context.close();
  }
  out.film.bytes = out.film.store.bytes();
  fs.rmSync(framesDir, { recursive: true, force: true });
  return out;
}
