// An interrupt (SIGINT) that lands while the browser launch is still pending (claude-skills #51 proposed a fix for this
// window in make-motion 1: the run exited before the browser was stored and closed). In make-motion 2 the launch is not
// cancellable and the signal only aborts the run's controller (make-main.mjs guard), so the launch finishes and the
// session's own cleanup closes the browser it returned. These tests pin that: exit 130, "interrupted", the browser the
// launch returned is closed, and no video is left. The launch is a stand-in module in a copy of the skill that starts,
// waits for the interrupt, then returns: a fake browser (no Chromium needed). The real-Chromium variant instead wraps the
// real launch to record its close and delivers the interrupt as soon as Chromium has been spawned, which is usually
// before the launch returns but not guaranteed (Playwright's own SIGINT handler would be live from the spawn on if
// `ownSignals` were dropped; claude-skills #51 hit that).
// The previous run's sheets must survive the interrupt. ffmpeg is a stub that only has to be executable: the run stops
// before it would encode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable, headlessPidsUnder, isRunning } from './helpers/session.mjs';

const SKILL = path.resolve(HERE, '../../..');
const COPIED = ['engine', 'scripts', 'shared', 'package.json'];
const WAIT_MS = 15_000;
const POLL_MS = 5;
const REAL_POLL_MS = 20; // each poll runs ps and pgrep
const PREVIOUS_SHEET = 'previous.png';
const CLOSE_DELAY_MS = 1_500;
const EXIT_INTERRUPTED = 130;
const FILM = { version: 2, shots: [{ id: 's', show: 'free', hold: 1, background: '#000000', nodes: [] }] };

const until = async (check, pollMs = POLL_MS, waitMs = WAIT_MS) => {
  const end = Date.now() + waitMs;
  while (!check() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, pollMs));
  return check();
};

const parseReport = (stdout, stderr) => {
  try { return JSON.parse(stdout); } catch { assert.fail(`the run printed no JSON report. stdout: ${stdout} stderr: ${stderr}`); }
};

// The launch stand-ins, both of which write `closed` when the browser they return is closed. The fake one writes `ready`
// when the launch starts and waits for SIGINT; the real one launches Chromium at once and leaves the signal to the test.
const standIn = ({ ready, closed }, real) => `
import { writeFileSync } from 'node:fs';
${real ? "import { launchBrowser as launchReal, guardNetwork } from './browser-real.mjs';" : 'export async function guardNetwork() {}'}
export async function launchBrowser(options) {
  ${real ? `const browser = await launchReal(options);
  const close = browser.close.bind(browser);
  // The run's own close comes late on purpose: if Playwright's SIGINT handler is live it closes the browser and exits 130
  // well before this, so the run never reaches its report (what dropping \`ownSignals\` does).
  browser.close = async () => { await new Promise((resolve) => setTimeout(resolve, ${CLOSE_DELAY_MS})); writeFileSync(${JSON.stringify(closed)}, ''); await close(); };
  return browser;` : `writeFileSync(${JSON.stringify(ready)}, '');
  await new Promise((resolve) => process.once('SIGINT', resolve));
  return {
    async close() { writeFileSync(${JSON.stringify(closed)}, ''); },
    async newContext() { throw new Error('stand-in browser: no page'); },
  };`}
}
${real ? 'export { guardNetwork };' : ''}
`;

async function interruptDuringLaunch(t, { real }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-launch-int-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  const skill = path.join(dir, 'skill');
  mkdirSync(skill);
  for (const name of COPIED) cpSync(path.join(SKILL, name), path.join(skill, name), { recursive: true });
  symlinkSync(path.join(SKILL, 'node_modules'), path.join(skill, 'node_modules'), 'dir');
  const files = { ready: path.join(dir, 'launch-ready'), closed: path.join(dir, 'browser-closed') };
  const browserModule = path.join(skill, 'scripts/lib/browser.mjs');
  if (real) renameSync(browserModule, path.join(skill, 'scripts/lib/browser-real.mjs'));
  writeFileSync(browserModule, standIn(files, real));
  const ffmpeg = path.join(dir, 'ffmpeg');
  writeFileSync(ffmpeg, '#!/bin/sh\nexit 0\n');
  chmodSync(ffmpeg, 0o755);
  const filmFile = path.join(dir, 'film.json');
  writeFileSync(filmFile, JSON.stringify(FILM));
  const outDir = path.join(dir, 'out');
  const sheetsDir = path.join(outDir, 'film.sheets');
  mkdirSync(sheetsDir, { recursive: true });
  writeFileSync(path.join(sheetsDir, PREVIOUS_SHEET), 'the last run\'s sheet');
  const child = spawn(process.execPath, [path.join(skill, 'scripts/make.mjs'), filmFile, '--json', '--out', path.join(outDir, 'film.mp4')],
    { env: { ...process.env, FFMPEG_PATH: ffmpeg }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  // Real: Playwright installs its handlers right after it spawns Chromium (spawn and handler install are one synchronous
  // step), so a headless browser below the run means the launch is in flight and the signal meets those handlers if they are on.
  let browsers = new Set();
  const launching = real
    ? () => { browsers = headlessPidsUnder(child.pid); return browsers.size > 0; }
    : () => existsSync(files.ready);
  assert.ok(await until(launching, real ? REAL_POLL_MS : POLL_MS), `the browser launch never started: ${stderr}`);
  child.kill('SIGINT');
  const stopped = await Promise.race([exited, new Promise((resolve) => { setTimeout(resolve, WAIT_MS, null).unref(); })]);
  assert.notEqual(stopped, null,`the process did not exit after the interrupt: ${stderr}`);
  assert.deepEqual([stopped.code, stopped.signal], [EXIT_INTERRUPTED, null], stderr);
  assert.equal(parseReport(stdout, stderr).error.message, 'interrupted');
  assert.ok(existsSync(files.closed), 'the browser the launch returned was closed before the process exited');
  assert.ok(await until(() => [...browsers].every((pid) => !isRunning(pid)), 10_000), 'a headless browser is still running');
  assert.deepEqual(readdirSync(outDir), ['film.sheets'], 'no partial or finished video');
  assert.deepEqual(readdirSync(sheetsDir), [PREVIOUS_SHEET], 'the previous run\'s sheets survive an interrupt that stopped the run before it made new ones');
}

test('SIGINT while the browser launch is pending: a launch that returns a browser which cannot open a page still closes it (130)', async (t) => {
  await interruptDuringLaunch(t, { real: false });
});

test('SIGINT once Chromium has spawned: the run closes the browser, exits 130 and keeps the previous sheets', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  await interruptDuringLaunch(t, { real: true });
});
