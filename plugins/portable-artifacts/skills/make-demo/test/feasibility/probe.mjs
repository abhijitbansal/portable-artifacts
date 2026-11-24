// Feasibility probe: can a site be captured frame by frame? For each site it runs the same look-only steps four times
// (real time three times, page clock stepped once), then compares the settled pictures and accessible trees where the three
// real-time runs agree.
//   node test/feasibility/probe.mjs <sites.json> --out <dir>
// Exit 0 when it ran, 2 for a usage error or a live headless browser. Run by hand: no test and no CI job visits a public site.
// Its claim, in short: after load it blocks explicit writes, new page sockets and top-level navigation, and lists the reads a
// scroll or hover causes (see probe-guard.mjs); it claims no more. It cannot tell a GET that changes state from a read.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, liveBrowsers } from '../../scripts/lib/browser.mjs';
import { captureRun, FPS } from './probe-run.mjs';
import { stableMask, wrongBlocks, failingGroups, maskedSsim, verdict } from './compare.mjs';
import { diffTrees, newErrors } from './signals.mjs';
import { decodePng } from './decode.mjs';
import { ownOriginBlocks, otherHostNotes } from './probe-guard.mjs';

const NAME_PATTERN = /^[A-Za-z0-9][\w.-]*$/;
const LOOK_KINDS = new Set(['scroll', 'hover']);
const MAX_SCROLL_SECONDS = 10;
const EXIT_USAGE = 2;
const RUNS = [['real-1', false], ['real-2', false], ['real-3', false], ['stepped', true]];

/** Why a sites.json entry is not usable, or null. The probe is look only: scroll, and hover over a named control. */
export function entryProblem(entry) {
  if (!entry || typeof entry !== 'object') return 'an entry is not an object';
  if (!NAME_PATTERN.test(entry.name ?? '') || /\.\.|\.$/.test(entry.name)) return `name "${entry.name}" must start with a letter or digit and hold letters, digits, dot, dash or underscore`;
  if (!/^https?:\/\//.test(entry.url ?? '')) return `${entry.name}: url must start with http:// or https://`;
  if (/^https?:\/\/[^/]*@/.test(entry.url)) return `${entry.name}: url must not carry credentials`;
  if (!Array.isArray(entry.steps) || entry.steps.length === 0) return `${entry.name}: steps must be a list of at least one look step`;
  for (const [i, step] of entry.steps.entries()) {
    if (!LOOK_KINDS.has(step?.do)) return `${entry.name}: step ${i + 1} is "${step?.do}", but the probe takes look steps only (scroll, hover)`;
    if (step.do === 'scroll' && !(step.to >= 0 && step.seconds > 0 && step.seconds <= MAX_SCROLL_SECONDS)) return `${entry.name}: step ${i + 1} needs "to" (px) and "seconds" up to ${MAX_SCROLL_SECONDS}`;
    if (step.do === 'hover' && !(/^[a-z]+$/.test(step.role ?? '') && step.name)) return `${entry.name}: step ${i + 1} needs a "role" (lower-case letters) and a "name"`;
  }
  return null;
}

const verdictRecord = (entry, result, extra = {}) => ({ name: entry.name, url: entry.url, ...result, ...extra });
const NO_STEPS = { steps: [] };

/** Why this run ends the probe before any comparison, as a verdict result, or null. */
function stopResult(run) {
  // A blocked request comes first: an aborted navigation leaves an error page that would read as a wall.
  const blocked = ownOriginBlocks(run.traffic ?? { blocked: [] });
  if (blocked.length > 0) {
    const what = blocked.map((b) => `${b.kind} ${b.method} ${b.path}`).join(', ');
    return { verdict: 'inconclusive', why: [`the ${run.label} run tried to send ${what} after the page loaded, and the probe blocked it: the picture may show a state the real site does not`] };
  }
  if (run.wall) return verdict({ ...NO_STEPS, wall: run.wall });
  if (!run.problem) return null;
  // Both real-time runs came first: a step only the stepped run cannot do is evidence against stepping.
  return run.stepped
    ? { verdict: 'difference found', why: [`the stepped run failed where real time did not: ${run.problem}`] }
    : { verdict: 'inconclusive', why: [`${run.label} run: ${run.problem}`] };
}

const withNotes = (result, traffic) => ({ ...result, why: [...result.why, ...otherHostNotes(traffic)] });

function stopped(entry, runs, result) {
  return verdictRecord(entry, withNotes(result, runs.map((r) => r.traffic).filter(Boolean)), { status: runs.at(-1).status, steps: [], film: null, traffic: runs.map((r) => r.traffic), finalUrls: runs.map((r) => r.finalUrl ?? null) });
}

/** Probe one site: four runs, then the verdict and the numbers. Pictures go to `<outDir>/<name>/`. */
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
  return compareRuns(browser, entry, outDir, runs);
}

const sameAddress = (urls) => new Set(urls.map((u) => { const x = new URL(u); return `${x.origin}${x.pathname}`; })).size === 1;

async function compareStep(util, dir, index, stepped, reals) {
  const [mine, ...theirs] = await Promise.all([stepped, ...reals].map((s) => decodePng(util, s.png)));
  for (const [tag, s] of [['stepped', stepped], ...reals.map((r, i) => [`rt${i + 1}`, r])]) fs.writeFileSync(path.join(dir, `step${index}-${tag}.png`), s.png);
  const maskInfo = stableMask(theirs);
  const wrong = wrongBlocks(mine, theirs, maskInfo);
  const tree = diffTrees(stepped.tree, reals.map((r) => r.tree));
  return {
    label: stepped.label,
    share: maskInfo.share,
    ssim: maskedSsim(mine, theirs[0], maskInfo.mask),
    wrongBlocks: wrong.length,
    wrongGroups: failingGroups(wrong, maskInfo.cols),
    treeLeftOut: tree.leftOutShare,
    treeDifferences: tree.differences,
    settle: stepped.settle,
    settleRealTime: reals[0].settle,
    noEffect: [stepped, ...reals].every((s) => s.same === true),
  };
}

/** Runs and steps that never settled; `loops` when all four runs did, with nothing pending, and the trees agree. */
export function cappedSteps(runs, steps) {
  const entries = runs.flatMap((run) => run.steps.flatMap((s, step) => (s.settle.capped ? [{ run: run.label, step, reason: s.settle.reason, pending: s.settle.pendingRequests ?? 0 }] : [])));
  const everyRun = new Set(entries.map((e) => e.run)).size === runs.length;
  const calm = entries.every((e) => e.pending === 0) && steps.every((s) => s.treeDifferences.length === 0);
  return { runs: entries.map(({ run, step, reason }) => ({ run, step, reason })), loops: everyRun && calm };
}

function filmNumbers({ film }) {
  const seconds = film.frames / FPS;
  if (seconds === 0) return null;
  return { frames: film.frames, seconds, wallMsPerFilmSecond: film.wallMs / seconds, bytesPerSecond: film.bytes / seconds, bytesPerSecondWithoutRepeats: film.rawBytes / seconds };
}

async function compareRuns(browser, entry, outDir, runs) {
  const [reals, stepped] = [runs.slice(0, 3), runs[3]];
  const dir = path.join(outDir, entry.name);
  fs.mkdirSync(dir, { recursive: true });
  const context = await browser.newContext();
  try {
    const util = await context.newPage();
    const steps = [];
    for (let i = 0; i < stepped.steps.length; i += 1) steps.push(await compareStep(util, dir, i, stepped.steps[i], reals.map((r) => r.steps[i])));
    const fresh = newErrors(stepped.errors, reals.map((r) => r.errors));
    const result = verdict({ steps, newErrors: fresh, capped: cappedSteps(runs, steps), finalUrlsEqual: sameAddress(runs.map((r) => r.finalUrl)) });
    return verdictRecord(entry, withNotes(result, runs.map((r) => r.traffic)), {
      status: stepped.status,
      steps,
      film: filmNumbers(stepped),
      realTime: stepped.realTime,
      traffic: runs.map((r) => r.traffic),
      finalUrls: runs.map((r) => r.finalUrl),
      pageErrors: { stepped: stepped.errors, realTime: reals.map((r) => r.errors), newInStepped: fresh },
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
  const names = Array.isArray(entries) ? entries.map((e) => e?.name) : [];
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);
  const problem = Array.isArray(entries) ? (duplicate === undefined ? entries.map(entryProblem).find(Boolean) : `two sites are named "${duplicate}"`) : 'the file must hold a list of sites';
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
      fs.writeFileSync(path.join(outDir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
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
  let running;
  try {
    running = live();
  } catch (error) {
    err(`cannot tell whether a headless browser is running (${error.message}): not starting one`);
    return EXIT_USAGE;
  }
  if (running.length > 0) { err(`another headless browser is running (${running.length} processes): wait for it, never run two`); return EXIT_USAGE; }
  const entries = readEntries(file, err);
  if (!entries) return EXIT_USAGE;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    await probeAll(entries, outDir, { launch, out });
  } catch (error) {
    err(`the probe could not run: ${String(error.message).split('\n')[0]}`);
    return EXIT_USAGE;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
