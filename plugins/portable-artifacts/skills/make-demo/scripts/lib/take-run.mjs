// The take: the approved rows of a plan, run once, frame by frame, in one guarded context at scale 3 under the stepped clock.
//   runTake({ browser, spec, scout, rows, hash, state, dir, now, limits, again })  -> take, the object take.json holds
// `dir` is the take folder (take-folder.mjs); frames go to `<dir>/frames` and downloads to `<dir>/downloads`. `rows` and `hash` are what
// the gate returned (take-gate.mjs); `state` is a stored sign-in or null. `now` gives the start time: the page's clock starts there, so a
// date on the page is today's (a test passes a fixed one and gets the same frames every time). `limits` is { filmSeconds, bytes }.
// `again` is the list of rows that run a second time (takeDir).
//
// The take ENDS, keeping the frames so far, with `stopped: { row, reason }` when: a row is an intent row (`not seen yet`); the live
// control is not the approved one (take-act.mjs: `no match`, `2 matches`, `the control changed: <field>`, ...); a move off the origins
// was refused (the page is left on the browser's error page); a `look` row was followed by a write to an origin of the demo that scout
// did not list on any scouted page (the request has gone by then); the page is stuck (StepTimeout); 180 s of film time (`film time cap`); 3 GB
// of distinct frames (`size cap`). Whether the row that stops is in `steps` depends on the stop: a row that never ran (an intent row, a
// control that is not the approved one) or that was cut off by an error or a cap is NOT in `steps` (the frames it made are in `frames`);
// a row that ran to its end and was judged afterwards (a refused move, a look row's write) IS the last entry of `steps`. So `steps` is
// the rows that finished; `stopped.row` is the row the take ended on, whether or not it is also a step.
// Not stops, listed in `seen`: dialogs (dismissed), popups (closed), writes to other origins, writes of a `change` row, a settle that hit
// its cap (`steps[].settle.capped`).
//
// Frames: after every step (pointer, typing and settle steps alike) the page is covered (take-mask.mjs), shot at scale 3 as a JPEG,
// uncovered and stored. Film frame f is `frames[f - 1]`; `steps[].settledIndex` is the index of the step's last frame, which is the
// settled picture of that step (the two agree unless a step was lost to a navigation, so use settledIndex).
// Downloads are saved as `downloads/<row id>-<k><ext>` (ext: the last `.xxx` of the suggested name when it is 1 to 8 letters or digits),
// a file over 100 MB is deleted and listed `skipped: 'too large'`. A name the site suggested is never a path.
// Signed in, take.json holds no text from the page that scout.json does not: stop reasons from an error are the error's name only,
// and a download's name is masked first.
import fs from 'node:fs';
import path from 'node:path';
import { agentText } from '../../shared/agent-text.mjs';
import { openVisit, listRequests } from './visit.mjs';
import { installStepper, StepTimeout } from './stepper.mjs';
import { act, ActRefused } from './take-act.mjs';
import { coverPage, uncoverPage } from './take-mask.mjs';
import { frameStore } from './frames.mjs';
import { originsOf } from './spec.mjs';
import { maskText } from './mask.mjs';
import { failureReason } from './scout-stepped.mjs';

const FPS = 30;
const SCALE = 3;
const JPEG_QUALITY = 90;
const MS_PER_SECOND = 1000;
const GIGABYTE = 1024 ** 3;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
export const DEFAULT_LIMITS = { filmSeconds: 180, bytes: 3 * GIGABYTE };
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
const EXTENSION = /\.[A-Za-z0-9]{1,8}$/;
const NOT_SEEN = 'not seen yet';

/** A cap of the take was passed: it ends here and keeps what it has. `message` is the reason. */
class TakeLimit extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'TakeLimit';
  }
}

const writeKey = (write) => `${write.method} ${write.origin}${write.path}`;
const isMissing = (value) => value === null || value === undefined;

// ---- the frames --------------------------------------------------------------------------------------------------------------------

/** `onFrame` for act(): cover, shoot, uncover, store, then the caps. Nothing is covered signed out with no `mask`, so the page is left untouched. */
function frameTaker({ page, stepper, store, signedIn, mask, limits, tally }) {
  const covers = signedIn || mask.length > 0;
  return async function onFrame() {
    tally.covered = covers ? (await coverPage(page, { mask, signedIn })).covered : 0;
    let picture;
    try {
      picture = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY });
    } finally {
      if (covers) await uncoverPage(page);
    }
    store.add(picture);
    if (stepper.now() > limits.filmSeconds * MS_PER_SECOND) throw new TakeLimit('film time cap');
    if (store.bytes() > limits.bytes) throw new TakeLimit('size cap');
  };
}

// ---- downloads ---------------------------------------------------------------------------------------------------------------------

/** Save one Playwright Download under a name of our own; the entry for `seen.downloads`. `owner` is { dir, signedIn }. Exported for its test. */
export async function saveDownload({ dir, signedIn }, row, download, k) {
  const suggested = download.suggestedFilename();
  const name = agentText(signedIn ? maskText(suggested) : suggested);
  const file = `downloads/${row.id}-${k}${EXTENSION.exec(suggested)?.[0] ?? ''}`;
  const target = path.join(dir, file);
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await download.saveAs(target);
    const { size } = fs.statSync(target);
    if (size <= MAX_DOWNLOAD_BYTES) return { row: row.id, file, bytes: size, name };
    fs.unlinkSync(target);
    return { row: row.id, file: null, bytes: size, name, skipped: 'too large' };
  } catch {
    return { row: row.id, file: null, bytes: 0, name, skipped: 'could not be saved' };
  }
}

/** Save every download the row queued. */
async function keepDownloads(ctx, row) {
  const queued = ctx.seen.downloadQueue.splice(0);
  for (const [i, download] of queued.entries()) ctx.downloads.push(await saveDownload(ctx, row, download, i + 1));
}

// ---- stops after a row -------------------------------------------------------------------------------------------------------------

/** A main-frame move off the origins was refused during the row. A popup's refused move is not the page's. */
function movedAway(ctx, row, before) {
  const moved = ctx.seen.refused.slice(before.refused).find((r) => r.popup !== true);
  return moved ? { row: row.id, reason: `a move to ${moved.origin} was refused` } : null;
}

/**
 * A `look` row that was followed by a write to an origin of the demo that scout did not list on ANY scouted page of scout.json. The
 * union, not the row's page alone: a look link to a scouted page makes that page's own on-load writes, which scout listed on it.
 * (A write that scout saw on one page and a look row now sends from another is therefore not caught.)
 */
function sentWrite(ctx, row, before) {
  if (row.effect !== 'look') return null;
  const listed = new Set(ctx.scout.pages.flatMap((p) => p.requests ?? []).map(writeKey));
  for (const write of ctx.seen.writes.values()) {
    const grew = write.count > (before.writes.get(writeKey(write))?.count ?? 0);
    if (grew && ctx.origins.includes(write.origin) && !listed.has(writeKey(write))) return { row: row.id, reason: `a look row sent ${writeKey(write)}` };
  }
  return null;
}

/** Why a row stopped, from what it threw. Ours say it in words; anything else is the browser's text (signed in: its name only). */
function reasonOf(error, signedIn) {
  if (error instanceof TakeLimit || error instanceof ActRefused || error instanceof StepTimeout) return error.message;
  return failureReason(error, signedIn);
}

// ---- the rows ----------------------------------------------------------------------------------------------------------------------

const stepEntry = (row, result, ctx) => ({
  id: row.id,
  do: row.do,
  effect: row.effect,
  startFrame: result.startFrame,
  actFrame: result.actFrame,
  settleFrame: result.settleFrame,
  pointer: result.pointer,
  box: result.box,
  boxMoved: result.boxMoved,
  covered: ctx.tally.covered,
  settle: result.settle,
  settledIndex: ctx.store.index().length - 1,
});

/** One row: null when the take goes on, or the `stopped` it ends with. */
async function runRow(ctx, row) {
  if (!isMissing(row.intent)) return { row: row.id, reason: NOT_SEEN };
  const before = { refused: ctx.seen.refused.length, writes: new Map(ctx.seen.writes) };
  const scoutPage = ctx.scout.pages.find((p) => p.id === row.pageId) ?? null;
  let result;
  try {
    result = await act(ctx.page, ctx.stepper, row, { signedIn: ctx.signedIn, pointer: ctx.pointer, onFrame: ctx.onFrame, scoutPage });
  } catch (error) {
    await keepDownloads(ctx, row);
    return { row: row.id, reason: reasonOf(error, ctx.signedIn) };
  }
  ctx.pointer = result.pointer;
  ctx.steps.push(stepEntry(row, result, ctx));
  await keepDownloads(ctx, row);
  return movedAway(ctx, row, before) ?? sentWrite(ctx, row, before);
}

async function runRows(ctx, rows) {
  for (const row of rows) {
    const stopped = await runRow(ctx, row);
    if (stopped) return stopped;
  }
  return null;
}

// ---- the take ----------------------------------------------------------------------------------------------------------------------

/** The origins that answered the page, from its responses; the writes that went out count too (a beacon's answer is opaque). */
function watchOrigins(context) {
  const contacted = new Set();
  context.on('response', (response) => {
    const url = new URL(response.url());
    if (url.protocol === 'http:' || url.protocol === 'https:') contacted.add(url.origin);
  });
  return contacted;
}

function describe(ctx, { hash, startedAt, viewport, stopped, again }) {
  const { seen } = ctx;
  const origins = new Set([...ctx.contacted, ...[...seen.writes.values()].map((w) => w.origin)]);
  return {
    version: 1,
    planKey: `demo-${hash}`,
    startedAt,
    viewport,
    scale: SCALE,
    fps: FPS,
    mode: 'stepped',
    signedIn: ctx.signedIn,
    frames: ctx.store.index(),
    steps: ctx.steps,
    stopped,
    again,
    seen: {
      origins: [...origins].sort(),
      requests: listRequests(seen),
      refused: seen.refused.map((r) => ({ ...r })),
      dialogs: seen.dialogs,
      popups: seen.popups,
      downloads: ctx.downloads,
      errors: seen.errors,
    },
    bytes: ctx.store.bytes(),
  };
}

export async function runTake({ browser, spec, scout, rows, hash, state = null, dir, now = () => new Date(), limits = {}, again = [] }) {
  const caps = { ...DEFAULT_LIMITS, ...limits };
  const viewport = spec.viewport ?? DEFAULT_VIEWPORT;
  const signedIn = state !== null;
  const origins = originsOf(spec);
  const began = now();
  const visit = await openVisit(browser, { viewport, origins, state, scale: SCALE, posts: true, downloads: true });
  try {
    const stepper = await installStepper(visit.page, { fps: FPS, startTime: began.getTime() }); // before the first goto
    const store = frameStore(path.join(dir, 'frames'));
    const tally = { covered: 0 };
    const onFrame = frameTaker({ page: visit.page, stepper, store, signedIn, mask: spec.mask ?? [], limits: caps, tally });
    const ctx = { page: visit.page, seen: visit.seen, stepper, store, tally, onFrame, signedIn, origins, scout, dir, pointer: null, steps: [], downloads: [], contacted: watchOrigins(visit.context) };
    const stopped = await runRows(ctx, rows);
    return describe(ctx, { hash, startedAt: began.toISOString(), viewport, stopped, again });
  } finally {
    await visit.context.close().catch(() => {});
  }
}
