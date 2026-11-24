// Browser start-up: the bundled Chromium only. make-motion and shared/shot.mjs fall back to Google Chrome; this package does not,
// because the live check below looks for chrome-headless-shell and would not see a Chrome that started in its place.
import { spawnSync } from 'node:child_process';
import { chromium as bundled } from 'playwright';

/**
 * Lines of `pgrep -fl chrome-headless-shell`: another headless browser is already running (the Mac wedges on many at once).
 * Fails closed: if pgrep cannot say, this throws, and the caller must not start a browser.
 */
export function liveBrowsers(run = spawnSync) {
  const r = run('pgrep', ['-fl', 'chrome-headless-shell'], { encoding: 'utf8' });
  if (r.error) throw new Error(`pgrep could not run: ${r.error.message}`);
  if (r.status === null) throw new Error('pgrep did not finish');
  if (r.status === 1) return [];
  if (r.status !== 0) throw new Error(`pgrep exited with status ${r.status}`);
  return String(r.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
}

/** A headless browser: the bundled Chromium. `chromium` is injectable for a test. */
export async function launchBrowser(chromium = bundled) {
  try {
    return await chromium.launch();
  } catch (error) {
    throw new Error(`no browser could start (${String(error.message).split('\n')[0]}); install Chromium with \`npx --no playwright install chromium\` in this skill folder`);
  }
}
