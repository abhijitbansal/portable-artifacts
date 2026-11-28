// What this skill needs, per doctor target. Side-effect free: imports only built-ins and ../../shared/.
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { nodeVersion, nodeModules, browser, sisterSkill, builderAgent } from '../../shared/doctor.mjs';

export const targets = ['check'];

// This skill starts Playwright's bundled Chromium only (scripts/lib/browser.mjs says why), so an installed Google Chrome
// is not a browser here. The shared browser() check accepts one, so this one asks Playwright where its own Chromium is.
async function bundledChromiumPresent(ctx) {
  if (!ctx.exists(path.join(ctx.skillDir, 'node_modules', 'playwright-core'))) return false;
  try {
    const require = createRequire(path.join(ctx.skillDir, 'package.json'));
    const mod = await import(pathToFileURL(require.resolve('playwright')).href);
    const chromium = mod.chromium ?? mod.default?.chromium;
    return Boolean(chromium) && ctx.exists(chromium.executablePath());
  } catch {
    return false;
  }
}

const bundledBrowser = () => ({
  ...browser({ required: true }),
  why: "opens pages in Playwright's bundled Chromium (an installed Chrome is not used)",
  check: bundledChromiumPresent,
});

// Every target needs the same things: playwright is a production dependency here, so node_modules keeps it, and scout
// needs the browser. make-explainer draws the plan page and the guide, make-motion renders the film. The builder agent is optional.
export const requirementsFor = () => [
  nodeVersion(20),
  nodeModules({ omitDev: false }),
  bundledBrowser(),
  sisterSkill('make-explainer'),
  sisterSkill('make-motion'),
  builderAgent(),
];
