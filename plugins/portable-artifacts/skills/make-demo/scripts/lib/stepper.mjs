// Stepped page clock: the page's own time (Date, performance.now, timers, requestAnimationFrame) moves only when step() says so,
// and every running animation is set to the film time, so the same steps give the same frames.
//
// Limits, stated so nobody trusts it further than it goes:
//  - An animation the page creates in the middle of a step is dated from the start of that step (up to one frame early).
//  - An animation the page resumes after pausing it continues from the time it was held at, not from real time.
//  - Scroll-driven animations and animations with a negative playback rate are left alone.
//  - The pause is set a fixed lead after install, so a document loaded later sees performance.now() differ by the
//    lead minus the install round trip; Date and every delta between steps are exact.

const CLOCK_LEAD_MS = 1000;
const NETWORK_WAIT_MS = 2000;
const NETWORK_POLL_MS = 5;
const MS_PER_SECOND = 1000;
const SETTLE_SHOT = { type: 'jpeg', quality: 70, scale: 'css' };

/** Walk every running animation to film time: the code runs in the page. `from` and `to` are film ms around one step. */
function syncAnimations({ from, to }) {
  const dt = to - from;
  const state = (window.__makeDemoAnimations ??= new WeakMap());
  const EPS = 1e-3;
  for (const a of document.getAnimations()) {
    if (a.timeline !== document.timeline || !a.effect || a.playbackRate <= 0 || a.playState === 'idle' || a.playState === 'finished') continue;
    let rec = state.get(a);
    if (!rec) {
      rec = { last: 0, ours: false, held: a.playState === 'paused' };
      state.set(a, rec);
    }
    if (rec.held) {
      // paused by the page: leave it alone until the page runs it again
      if (a.playState === 'paused') { rec.last = a.currentTime ?? rec.last; continue; }
      rec.held = false;
    } else if (rec.ours && a.playState === 'paused' && Math.abs((a.currentTime ?? 0) - rec.last) > EPS) {
      rec.last = a.currentTime; // the page seeked it: keep its time and carry on from there
    } else if (rec.ours && a.playState !== 'paused') {
      rec.ours = false; // the page played it again: carry on from where we held it
    }
    rec.last += dt * a.playbackRate;
    const end = a.effect.getComputedTiming().endTime;
    if (Number.isFinite(end) && rec.last >= end) {
      a.finish();
      continue;
    }
    a.pause();
    a.currentTime = rec.last;
    rec.ours = true;
  }
}

/** After the page has run its own tasks: a few real macrotask turns, so a fetch's `.then` has painted before we look. */
const flushPage = () => new Promise((resolve) => {
  let turns = 4;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { turns -= 1; if (turns > 0) channel.port2.postMessage(0); else resolve(); };
  channel.port2.postMessage(0);
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Requests started (a running count) and not yet finished (request to its number), so a step can wait for the ones it caused. */
function watchRequests(page) {
  const watch = { started: 0, pending: new Map() };
  page.on('request', (r) => { watch.started += 1; watch.pending.set(r, watch.started); });
  page.on('requestfinished', (r) => watch.pending.delete(r));
  page.on('requestfailed', (r) => watch.pending.delete(r));
  return watch;
}

/**
 * The page's clock, stepped. Install before `goto`. `fps` frames make a second: the step lengths are the whole
 * milliseconds between rounded frame times, so `fps` steps always add to exactly 1000.
 */
export async function installStepper(page, { fps = 30, startTime = 0 } = {}) {
  await page.clock.install({ time: startTime });
  await page.clock.pauseAt(startTime + CLOCK_LEAD_MS);
  const watch = watchRequests(page);
  let frames = 0;
  let drained = 0; // requests numbered up to here have been waited for (or were already old)
  const filmMs = (n) => Math.round((n * MS_PER_SECOND) / fps);

  // Waits only for requests started since the last step: a request that never ends (a stream) must not stall every frame.
  async function waitForNetwork() {
    const deadline = Date.now() + NETWORK_WAIT_MS;
    const caused = () => [...watch.pending.values()].some((seq) => seq > drained);
    while (caused() && Date.now() < deadline) await wait(NETWORK_POLL_MS);
  }

  async function advanceOne() {
    const from = filmMs(frames);
    frames += 1;
    const to = filmMs(frames);
    await page.evaluate(syncAnimations, { from, to: from });
    await page.clock.runFor(to - from);
    await waitForNetwork();
    await page.evaluate(flushPage);
    await page.evaluate(syncAnimations, { from, to });
    const startedRequests = watch.started - drained;
    drained = watch.started;
    return { startedRequests };
  }

  const stepper = {
    async step(n = 1) {
      for (let i = 0; i < n; i += 1) await advanceOne();
    },
    now: () => filmMs(frames),
    async settle({ stillFrames = 6, maxFrames = 90, maxRealMs = 10000 } = {}) {
      const began = Date.now();
      let previous = null;
      let still = 0;
      let used = 0;
      while (still < stillFrames) {
        if (used >= maxFrames) return { frames: used, capped: true, reason: 'frames' };
        if (Date.now() - began >= maxRealMs) return { frames: used, capped: true, reason: 'time' };
        const { startedRequests } = await advanceOne();
        used += 1;
        const shot = await page.screenshot(SETTLE_SHOT);
        const same = previous !== null && shot.equals(previous) && startedRequests === 0 && watch.pending.size === 0;
        still = same ? still + 1 : 0;
        previous = shot;
      }
      return { frames: used, capped: false, reason: 'still' };
    },
  };
  return stepper;
}

/** Start an eased scroll to `y` over `seconds`, driven by requestAnimationFrame so it follows the page clock or real time. */
export function scrollTo(page, y, seconds) {
  return page.evaluate(({ to, ms }) => {
    const from = window.scrollY;
    const t0 = performance.now();
    const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
    const at = (p) => window.scrollTo({ top: from + (to - from) * ease(p), behavior: 'instant' });
    (function frame() {
      const p = Math.min(1, (performance.now() - t0) / ms);
      at(p);
      if (p < 1) requestAnimationFrame(frame);
    })();
    setTimeout(() => at(1), ms);
  }, { to: y, ms: seconds * MS_PER_SECOND });
}
