// Feasibility probe: can a site be captured frame by frame? For each site it runs the same look-only steps three times
// (real time twice, page clock stepped once), then compares the settled pictures where the two real-time runs agree.
//   node test/feasibility/probe.mjs <sites.json> --out <dir>
// Exit 0 when it ran, 2 for a usage error or a live headless browser. Run by hand: no test and no CI job visits a public site.
// The probe sends nothing beyond what loading the page sends: see probe-guard.mjs. It cannot tell a GET that changes state
// (a redirect chain, a fetch of a URL like /delete?id=1) from a read; the final address of each run is recorded for that reason.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, liveBrowsers } from '../../scripts/lib/browser.mjs';
import { captureRun, FPS } from './probe-run.mjs';
import { stableMask, maskedSsim, verdict } from './compare.mjs';
import { decodePng } from './decode.mjs';
import { ownOriginBlocks } from './probe-guard.mjs';

const NAME_PATTERN = /^[\w.-]+$/;
const LOOK_KINDS = new Set(['scroll', 'hover']);
const MAX_SCROLL_SECONDS = 10;
const EXIT_USAGE = 2;

/** Why a sites.json entry is not usable, or null. The probe is look only: scroll, and hover over a named control. */
export function entryProblem(entry) {
  if (!entry || typeof entry !== 'object') return 'an entry is not an object';
  if (!NAME_PATTERN.test(entry.name ?? '')) return `name "${entry.name}" must be letters, digits, dot, dash or underscore`;
  if (!/^https?:\/\//.test(entry.url ?? '')) return `${entry.name}: url must start with http:// or https://`;
  if (!Array.isArray(entry.steps) || entry.steps.length === 0) return `${entry.name}: steps must be a list of at least one look step`;
  for (const [i, step] of entry.steps.entries()) {
    if (!LOOK_KINDS.has(step?.do)) return `${entry.name}: step ${i + 1} is "${step?.do}", but the probe takes look steps only (scroll, hover)`;
    if (step.do === 'scroll' && !(step.to >= 0 && step.seconds > 0 && step.seconds <= MAX_SCROLL_SECONDS)) return `${entry.name}: step ${i + 1} needs "to" (px) and "seconds" up to ${MAX_SCROLL_SECONDS}`;
    if (step.do !== 'scroll' && !(step.role && step.name)) return `${entry.name}: step ${i + 1} needs "role" and "name"`;
  }
  return null;
}

/** Controls agree when everything both real-time runs list is in the stepped run, and the stepped run lists nothing neither saw. */
function controlsAgree(stepped, real1, real2) {
  const [s, a, b] = [new Set(stepped), new Set(real1), new Set(real2)];
  const stable = [...a].filter((c) => b.has(c));
  return stable.every((c) => s.has(c)) && [...s].every((c) => a.has(c) || b.has(c));
}

async function compareStep(util, outDir, index, [stepped, real1, real2]) {
  const files = { stepped: stepped.png, rt1: real1.png, rt2: real2.png };
  for (const [tag, png] of Object.entries(files)) fs.writeFileSync(path.join(outDir, `step${index}-${tag}.png`), png);
  const [a, b, c] = await Promise.all([decodePng(util, stepped.png), decodePng(util, real1.png), decodePng(util, real2.png)]);
  const { mask, share } = stableMask(b, c);
  return {
    label: stepped.label,
    share,
    ssim: maskedSsim(a, b, mask),
    controlsEqual: controlsAgree(stepped.controls, real1.controls, real2.controls),
    settle: stepped.settle,
    settleRealTime: real1.settle,
  };
}

const verdictRecord = (entry, result, extra = {}) => ({ name: entry.name, url: entry.url, ...result, ...extra });

function filmNumbers({ film }) {
  const seconds = film.frames / FPS;
  if (seconds === 0) return null;
  return { frames: film.frames, seconds, wallMsPerFilmSecond: film.wallMs / seconds, bytesPerSecond: film.bytes / seconds, bytesPerSecondWithoutRepeats: film.rawBytes / seconds };
}

const RUNS = [['real-1', false], ['real-2', false], ['stepped', true]];

/** Why this run ends the probe before any comparison, as a verdict result, or null. */
function stopResult(run) {
  if (run.wall) return verdict({ ssims: [], shares: [], controlsEqual: true, newErrors: 0, wall: run.wall });
  const blocked = ownOriginBlocks(run.traffic ?? { blocked: [] });
  if (blocked.length > 0) {
    const what = blocked.map((b) => `${b.kind} ${b.method} ${b.path}`).join(', ');
    return { verdict: 'inconclusive', why: [`the ${run.label} run tried to send ${what} after the page loaded, and the probe blocked it: the picture may show a state the real site does not`] };
  }
  if (run.problem) return { verdict: 'inconclusive', why: [`${run.label} run: ${run.problem}`] };
  return null;
}

/** Probe one site: three runs, then the verdict and the numbers. Pictures go to `<outDir>/<name>/`. */
export async function probeSite(browser, entry, outDir) {
  const invalid = entryProblem(entry);
  if (invalid) throw new Error(invalid);
  const runs = [];
  for (const [label, stepped] of RUNS) {
    const run = await captureRun(browser, entry, { stepped, label });
    runs.push(run);
    const stop = stopResult(run);
    if (stop) return stopped(entry, runs, stop);
  }
  const [real1, real2, stepped] = runs;
  return compareRuns(browser, entry, outDir, { stepped, real1, real2 }, runs.map((r) => r.traffic));
}

function stopped(entry, runs, result) {
  return verdictRecord(entry, result, { status: runs.at(-1).status, steps: [], film: null, traffic: runs.map((r) => r.traffic) });
}

async function compareRuns(browser, entry, outDir, { stepped, real1, real2 }, traffic) {
  const dir = path.join(outDir, entry.name);
  fs.mkdirSync(dir, { recursive: true });
  const context = await browser.newContext();
  try {
    const util = await context.newPage();
    const steps = [];
    for (let i = 0; i < stepped.steps.length; i += 1) {
      steps.push(await compareStep(util, dir, i, [stepped.steps[i], real1.steps[i], real2.steps[i]]));
    }
    const realMessages = new Set([...real1.errors, ...real2.errors]);
    const newErrors = stepped.errors.filter((m) => !realMessages.has(m));
    const result = verdict({ ssims: steps.map((s) => s.ssim), shares: steps.map((s) => s.share), controlsEqual: steps.every((s) => s.controlsEqual), newErrors: newErrors.length, wall: null });
    return verdictRecord(entry, result, {
      status: stepped.status,
      steps,
      film: filmNumbers(stepped),
      traffic,
      finalUrls: [real1.finalUrl, real2.finalUrl, stepped.finalUrl],
      pageErrors: { stepped: stepped.errors, realTime: [...realMessages], newInStepped: newErrors },
    });
  } finally {
    await context.close();
  }
}

function parseArgs(argv) {
  const out = argv.indexOf('--out');
  const file = argv.find((a, i) => !a.startsWith('--') && i !== out + 1);
  return { file, outDir: out >= 0 ? argv[out + 1] : undefined };
}

const USAGE = 'usage: node test/feasibility/probe.mjs <sites.json> --out <dir>';

function readEntries(file, err) {
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    err(`cannot read ${file}: ${error.message}`);
    return null;
  }
  const problem = Array.isArray(entries) ? entries.map(entryProblem).find(Boolean) : 'the file must hold a list of sites';
  if (problem) { err(problem); return null; }
  return entries;
}

async function probeAll(entries, outDir, { launch, out }) {
  const browser = await launch();
  const results = [];
  try {
    for (const entry of entries) {
      let record;
      try {
        record = await probeSite(browser, entry, outDir);
      } catch (error) {
        record = verdictRecord(entry, { verdict: 'inconclusive', why: [`probe error: ${String(error.message).split('\n')[0]}`] }, { steps: [], film: null });
      }
      results.push(record);
      out(`${record.name}\t${record.verdict}\t${record.why[0] ?? ''}`);
    }
  } finally {
    await browser.close();
  }
  return results;
}

/** The CLI. `deps` lets a test inject the live-browser check, the launcher and the output. Returns the exit code. */
export async function main(argv, { live = liveBrowsers, launch = launchBrowser, out = console.log, err = console.error } = {}) {
  const { file, outDir } = parseArgs(argv);
  if (!file || !outDir) { err(USAGE); return EXIT_USAGE; }
  const running = live();
  if (running.length > 0) { err(`another headless browser is running (${running.length} processes): wait for it, never run two`); return EXIT_USAGE; }
  const entries = readEntries(file, err);
  if (!entries) return EXIT_USAGE;
  fs.mkdirSync(outDir, { recursive: true });
  const results = await probeAll(entries, outDir, { launch, out });
  fs.writeFileSync(path.join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
