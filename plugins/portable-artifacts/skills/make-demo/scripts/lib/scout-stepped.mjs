// The first page once more, under the stepped clock: does it settle, or why not. A page that does not settle, or that plays a video,
// cannot be filmed frame by frame (a later phase); that is kept in scout.json as `stepped`, and a later phase reads it. A failure here
// never fails the scout. What the page sent in this second load is added to the first page (mergeSteppedSeen), so it is listed once.
import { installStepper } from './stepper.mjs';
import { openVisit, listRequests } from './visit.mjs';
import { maskText } from './mask.mjs';

const FPS = 30;
const GOTO_MS = 30000;
const COUNTERS = ['dialogs', 'popups', 'downloads', 'sockets', 'errors'];

/** Why the stepped load failed. Signed in, only the kind of error: its message may hold what the page said. */
export const failureReason = (error, signedIn) => (signedIn ? `stopped: ${error?.name ?? 'Error'}` : maskText(String(error?.message ?? error).split('\n')[0]));

/**
 * The first page's entry with what the stepped load saw added: its requests (by method, origin and path, counts added), its refused
 * moves, and its counts. A new object; `seen` null or empty changes nothing.
 */
export function mergeSteppedSeen(entry, seen) {
  if (!seen) return entry;
  const requests = new Map((entry.requests ?? []).map((r) => [`${r.method} ${r.origin}${r.path}`, r]));
  for (const r of listRequests(seen)) {
    const key = `${r.method} ${r.origin}${r.path}`;
    requests.set(key, { ...r, count: (requests.get(key)?.count ?? 0) + r.count });
  }
  const counts = Object.fromEntries(COUNTERS.map((name) => [name, (entry[name] ?? 0) + (seen[name] ?? 0)]));
  const merged = [...requests.values()].sort((a, b) => `${a.method} ${a.origin} ${a.path}`.localeCompare(`${b.method} ${b.origin} ${b.path}`));
  return { ...entry, ...counts, requests: merged, refused: [...(entry.refused ?? []), ...seen.refused] };
}

/**
 * { stepped, seen }. `stepped` is { ok, reason, realTime }: realTime is what the page still runs in real time (counts and flags), or
 * null when the load failed. `seen` is what the page did in this load (see visit.mjs), or null when no visit was opened.
 */
export async function steppedLoad(browser, { url, origins, viewport, state, signedIn }) {
  let visit = null;
  try {
    visit = await openVisit(browser, { viewport, origins, state });
    const stepper = await installStepper(visit.page, { fps: FPS, startTime: Date.now() });
    // Not `load`: under a stopped clock a playing video (a MediaStream) keeps `load` from firing, and settle() waits for what is left.
    await visit.page.goto(url, { waitUntil: 'domcontentloaded', timeout: GOTO_MS });
    const settle = await stepper.settle();
    const realTime = await stepper.report();
    if (realTime.playingVideos > 0) return { stepped: { ok: false, reason: 'a video plays in real time', realTime }, seen: visit.seen };
    if (settle.capped) return { stepped: { ok: false, reason: `did not settle (${settle.reason})`, realTime }, seen: visit.seen };
    return { stepped: { ok: true, reason: 'still', realTime }, seen: visit.seen };
  } catch (error) {
    return { stepped: { ok: false, reason: failureReason(error, signedIn), realTime: null }, seen: visit?.seen ?? null };
  } finally {
    await visit?.context.close().catch(() => {});
  }
}
