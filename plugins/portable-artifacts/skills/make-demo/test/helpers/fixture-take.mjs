// A signed-out take of the walk fixture page, for make-motion's tests (its `walk` shot reads a take folder).
//   node test/helpers/fixture-take.mjs <out-dir>   writes <out-dir>/take.json and <out-dir>/frames/, prints the byte total
// It is a test helper: it scouts the loopback page, builds the rows with planRows and calls runTake directly, so it bypasses the gate and
// never writes an answers file. Loopback only; one headless browser (it stops when another one is live).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSites } from '../fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../../scripts/lib/browser.mjs';
import { runScout } from '../../scripts/lib/scout-run.mjs';
import { planRows } from '../../scripts/lib/plan-rows.mjs';
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

const specOf = (origin, steps) => ({
  version: 1,
  source: { url: `${origin}${PAGE}` },
  origins: [origin],
  rights: 'own',
  pages: [PAGE],
  viewport: WALK_VIEWPORT,
  useCases: [{ id: 'walk', title: 'Look around a small project board', steps }],
});

/** Scout the walk page, plan the rows and take them into `dir`. Returns the take object (the take.json content). */
export async function recordWalkTake({ browser, sites, dir, steps = WALK_STEPS }) {
  const spec = specOf(sites.origin, steps);
  const scouted = await runScout({ browser, spec });
  if (!scouted.ok) throw new Error(`scout failed: ${scouted.reason}`);
  const { rows, errors, hash } = planRows(spec, scouted.scout);
  if (errors.length > 0) throw new Error(`plan failed: ${JSON.stringify(errors)}`);
  sites.reset();
  return runTake({ browser, spec, scout: scouted.scout, rows, hash, dir, now: () => new Date(0) });
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
