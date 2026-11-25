// The first page once more, under the stepped clock: does it settle, or why not. A page that does not settle, or that plays a video,
// cannot be filmed frame by frame (a later phase), and the plan page says so. A failure here never fails the scout.
import { installStepper } from './stepper.mjs';
import { openVisit } from './visit.mjs';
import { maskText } from './mask.mjs';

const FPS = 30;
const GOTO_MS = 30000;

/** Why the stepped load failed. Signed in, only the kind of error: its message may hold what the page said. */
const failureReason = (error, signedIn) => (signedIn ? `stopped: ${error?.name ?? 'Error'}` : maskText(String(error?.message ?? error).split('\n')[0]));

/** { ok, reason, realTime }: realTime is what the page still runs in real time (counts and flags), or null when the load failed. */
export async function steppedLoad(browser, { url, origins, viewport, state, signedIn }) {
  let visit = null;
  try {
    visit = await openVisit(browser, { viewport, origins, state });
    const stepper = await installStepper(visit.page, { fps: FPS, startTime: Date.now() });
    // Not `load`: under a stopped clock a playing video (a MediaStream) keeps `load` from firing, and settle() waits for what is left.
    await visit.page.goto(url, { waitUntil: 'domcontentloaded', timeout: GOTO_MS });
    const settle = await stepper.settle();
    const realTime = await stepper.report();
    if (realTime.playingVideos > 0) return { ok: false, reason: 'a video plays in real time', realTime };
    if (settle.capped) return { ok: false, reason: `did not settle (${settle.reason})`, realTime };
    return { ok: true, reason: 'still', realTime };
  } catch (error) {
    return { ok: false, reason: failureReason(error, signedIn), realTime: null };
  } finally {
    await visit?.context.close().catch(() => {});
  }
}
