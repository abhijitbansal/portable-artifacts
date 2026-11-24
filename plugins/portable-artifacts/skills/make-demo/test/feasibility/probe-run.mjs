// One run of a site's look-only steps (scroll and hover), either with the page clock stepped or in real time. The safety rules
// of probe-guard.mjs hold in every run: the probe sends nothing beyond what loading the page sends.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installStepper, scrollTo } from '../../scripts/lib/stepper.mjs';
import { frameStore } from '../../scripts/lib/frames.mjs';
import { wallReason } from './compare.mjs';
import { openGuardedContext, watchPages, endLoad } from './probe-guard.mjs';

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
const SETTLE_SHOT = { type: 'jpeg', quality: 70, scale: 'css' };
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

function watchRun(page, run) {
  page.on('pageerror', (e) => run.errors.push(String(e.message)));
  page.on('request', (r) => run.pending.add(r));
  page.on('requestfinished', (r) => run.pending.delete(r));
  page.on('requestfailed', (r) => run.pending.delete(r));
}

async function openRun(browser, entry, stepped) {
  const { context, run: guard } = await openGuardedContext(browser, { origin: new URL(entry.url).origin, viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE });
  const run = { context, guard, errors: [], pending: new Set(), stepper: null, page: null };
  try {
    run.page = await context.newPage();
    watchPages(context, guard, run.page);
    watchRun(run.page, run);
    if (stepped) run.stepper = await installStepper(run.page, { fps: FPS, startTime: Date.now() });
  } catch (error) {
    await context.close();
    throw error;
  }
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

/** Do one look step. Returns { problem } when it cannot be done, else { frames, pad } (film frames or real ms to wait). */
async function applyStep(run, step) {
  if (step.do === 'scroll') {
    await scrollTo(run.page, step.to, step.seconds);
    return { frames: Math.ceil(step.seconds * FPS), pad: step.seconds * 1000 + REAL_SCROLL_PAD_MS };
  }
  const locator = run.page.getByRole(step.role, { name: step.name, exact: true });
  const count = await locator.count();
  if (count === 0) return { problem: `no ${step.role} named "${step.name}" on the page` };
  if (count > 1) return { problem: `${count} ${step.role}s are named "${step.name}"` };
  await locator.hover({ timeout: ACTION_TIMEOUT_MS });
  return { frames: ACTION_FRAMES, pad: REAL_ACT_PAD_MS };
}

async function runStep(run, out, step, index) {
  const applied = await applyStep(run, step);
  if (applied.problem) return applied.problem;
  if (run.stepper) await captureFrames(run, out, applied.frames + HOLD_FRAMES);
  else await run.page.waitForTimeout(applied.pad);
  await recordStep(run, out, `${index + 1}: ${step.do}`);
  return null;
}

async function walk(run, out, entry) {
  const response = await run.page.goto(entry.url, { waitUntil: 'load', timeout: GOTO_MS });
  endLoad(run.guard);
  out.status = response?.status() ?? 0;
  await recordStep(run, out, 'load');
  out.wall = wallReason({ status: out.status, title: await run.page.title(), headings: out.steps[0].headings }) ?? out.wall;
  for (const [index, step] of (out.wall ? [] : entry.steps).entries()) {
    out.problem = await runStep(run, out, step, index);
    if (out.problem || out.wall) break;
  }
  out.finalUrl = run.page.url();
}

/** Open the site and walk its steps once. The result never throws for a site's own trouble: `problem` says what stopped it. */
export async function captureRun(browser, entry, { stepped, label }) {
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-frames-'));
  const out = { label, steps: [], wall: null, status: 0, problem: null, traffic: null, film: { frames: 0, rawBytes: 0, wallMs: 0, bytes: 0, store: frameStore(framesDir) } };
  let run = null;
  try {
    run = await openRun(browser, entry, stepped);
    out.errors = run.errors;
    await walk(run, out, entry);
  } catch (error) {
    out.problem = `${stepped ? 'stepped' : 'real-time'} run failed: ${String(error.message).split('\n')[0]}`;
  } finally {
    out.traffic = run ? { run: label, ...run.guard.traffic, warnings: run.guard.warnings } : null;
    out.film.bytes = out.film.store.bytes();
    try {
      await run?.context.close();
    } finally {
      fs.rmSync(framesDir, { recursive: true, force: true });
    }
  }
  out.errors ??= [];
  return out;
}
