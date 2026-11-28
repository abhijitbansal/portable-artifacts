// A signed-out take of the walk fixture page, for make-motion's tests (its `walk` shot reads a take folder).
//   node test/helpers/fixture-take.mjs <out-dir>   writes <out-dir>/take.json and <out-dir>/frames/, prints the byte total
// recordDemoFolder writes a whole demo folder instead (demo.json, scout/, click-plan.json, take-1/) for the film and guide command tests.
// It is a test helper: it scouts the loopback page, builds the rows with planRows and calls runTake directly, so it bypasses the gate and
// never writes an answers file. Loopback only; one headless browser (it stops when another one is live).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSites } from '../fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../../scripts/lib/browser.mjs';
import { runScout, writeScout } from '../../scripts/lib/scout-run.mjs';
import { planRows } from '../../scripts/lib/plan-rows.mjs';
import { planPage } from '../../scripts/lib/plan-page.mjs';
import { runTake } from '../../scripts/lib/take-run.mjs';

export const WALK_VIEWPORT = { width: 960, height: 540 };
const PAGE = '/walk/';
const by = (role, name) => ({ role, name });

// The hover comes before "Add project": a click that may change something leaves the screen unknown to the plan until the next goto.
export const WALK_STEPS = [
  { id: 'open', do: 'goto', value: PAGE },
  { id: 'tab', do: 'click', target: by('tab', 'Activity') },
  { id: 'search', do: 'type', target: by('searchbox', 'Search projects'), value: '42' },
  { id: 'hover', do: 'hover', target: by('button', 'Mobile onboarding') },
  { id: 'add', do: 'click', target: by('button', 'Add project') },
];

// `extra` adds demo.json fields (brand, opening, ending, look, ...); a bound one such as brand is part of the plan the take is of.
const specOf = (origin, steps, extra = {}) => ({
  version: 1,
  source: { url: `${origin}${PAGE}` },
  origins: [origin],
  rights: 'own',
  pages: [PAGE],
  viewport: WALK_VIEWPORT,
  useCases: [{ id: 'walk', title: 'Look around a small project board', steps }],
  ...extra,
});

async function scoutAndPlan({ browser, spec }) {
  const scouted = await runScout({ browser, spec });
  if (!scouted.ok) throw new Error(`scout failed: ${scouted.reason}`);
  const planned = planRows(spec, scouted.scout);
  if (planned.errors.length > 0) throw new Error(`plan failed: ${JSON.stringify(planned.errors)}`);
  return { scouted, planned };
}

/** Scout the walk page, plan the rows and take them into `dir`. Returns the take object (the take.json content). */
export async function recordWalkTake({ browser, sites, dir, steps = WALK_STEPS, extra = {} }) {
  const spec = specOf(sites.origin, steps, extra);
  const { scouted, planned } = await scoutAndPlan({ browser, spec });
  sites.reset();
  return runTake({ browser, spec, scout: scouted.scout, rows: planned.rows, hash: planned.hash, dir, now: () => new Date(0) });
}

/**
 * A real demo folder in `dir` (made if missing): demo.json, scout/scout.json, click-plan.json (no pictures) and take-1/ with its take.json.
 * Returns { file, spec, take } where `file` is demo.json. It bypasses the approval gate, as recordWalkTake does.
 */
export async function recordDemoFolder({ browser, sites, dir, steps = WALK_STEPS, extra = {} }) {
  const spec = specOf(sites.origin, steps, extra);
  const { scouted, planned } = await scoutAndPlan({ browser, spec });
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'demo.json');
  fs.writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`);
  writeScout(dir, scouted.scout, scouted.shots);
  fs.writeFileSync(path.join(dir, 'click-plan.json'), `${JSON.stringify(planPage(spec, scouted.scout, planned), null, 2)}\n`);
  sites.reset();
  const takeDir = path.join(dir, 'take-1');
  const take = await runTake({ browser, spec, scout: scouted.scout, rows: planned.rows, hash: planned.hash, dir: takeDir, now: () => new Date(0) });
  fs.writeFileSync(path.join(takeDir, 'take.json'), `${JSON.stringify(take, null, 2)}\n`);
  return { file, spec, take };
}

async function main(outDir) {
  const live = liveBrowsers();
  if (live.length > 0) throw new Error('another headless browser is running: wait for it, never run two');
  const dir = path.resolve(outDir);
  const sites = await startSites();
  const browser = await launchBrowser();
  try {
    const take = await recordWalkTake({ browser, sites, dir });
    fs.writeFileSync(path.join(dir, 'take.json'), `${JSON.stringify(take, null, 2)}\n`);
    const distinct = new Set(take.frames).size;
    console.log(`${take.steps.map((s) => s.id).join(', ')}; stopped: ${JSON.stringify(take.stopped)}; ${take.frames.length} frames in ${distinct} files, ${take.bytes} bytes of frames`);
  } finally {
    await browser.close();
    await sites.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('usage: node test/helpers/fixture-take.mjs <out-dir>');
    process.exit(2);
  }
  main(process.argv[2]).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
