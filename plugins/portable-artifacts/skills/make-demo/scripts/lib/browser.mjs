// Browser start-up, with the same behaviour as make-motion's and shared/shot.mjs's: the bundled Chromium, then Google Chrome.
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

/** Lines of `pgrep -fl chrome-headless-shell`: another headless browser is already running (the Mac wedges on many at once). */
export function liveBrowsers(run = spawnSync) {
  const r = run('pgrep', ['-fl', 'chrome-headless-shell'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return [];
  return String(r.stdout ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
}

/** A headless browser: the bundled Chromium, else Google Chrome; the error names the first failure. */
export async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (bundled) {
    try {
      return await chromium.launch({ channel: 'chrome' });
    } catch {
      throw new Error(`no browser could start (${String(bundled.message).split('\n')[0]}); install one with \`npx playwright install chromium\` or install Google Chrome`);
    }
  }
}
