// Stepped page clock: the page's own time (Date, performance.now, timers, requestAnimationFrame) and its animations move only
// when step() says so, so the same steps give the same frames.
//
// How: Playwright's clock is stopped and run for one frame at a time. The animation timeline is frozen over CDP
// (Animation.setPlaybackRate 0, kept across navigations), and after each clock run every running animation on the document
// timeline, in every frame and every open shadow root, gains the frame's time. No animation is ever paused by us, so a pause,
// a seek, a replay or a rate change made by the page behaves as it would. Chromium's virtual time was tried and rejected: it
// moves neither CSS animations nor requestAnimationFrame, and a busy wait hangs it.
//
// Limits a test shows:
//  - A page that blocks its thread waiting for Date.now() never ends: each step has a deadline, and past it the context is
//    closed and step() throws StepTimeout (settle() returns it as capped, reason 'time').
//  - report() names what still runs in real time: workers, playing video, animated images, SMIL, Web Audio, closed shadow
//    roots and smooth scrolling. None of them is stepped.
//  - A document loaded after film time T sees performance.now() near T and Date.now() at startTime + 1000 + T.
//  - Not tested: a cross-site (out-of-process) frame. It is frozen through its own CDP session, but loopback frames share a
//    process, so no fixture reaches that path.

const CLOCK_LEAD_MS = 1000;
const NETWORK_WAIT_MS = 2000;
const NETWORK_POLL_MS = 5;
const STEP_DEADLINE_MS = 4000;
const CLOSE_GRACE_MS = 5000;
const SHORT_TIMER_MS = 2000;
const MS_PER_SECOND = 1000;
const SETTLE_SECONDS = 1;
const SETTLE_CAP_SECONDS = 8;
const SETTLE_REAL_CAP_MS = 20000;
const SETTLE_SHOT = { type: 'jpeg', quality: 70, scale: 'css' };
const NO_SEPARATE_SESSION = /does not have a separate CDP session/;

/** A step or settle that did not finish in time: the page is stuck (a busy wait on a stopped clock). The context is closed. */
export class StepTimeout extends Error {
  constructor(message, closeError) {
    super(message);
    this.name = 'StepTimeout';
    this.closeError = closeError ?? null;
  }
}

// ---- Code that runs in the page ----

/** Init script, before the page's own: keep the real requestAnimationFrame, and count what the stepper cannot move. */
function setupPage() {
  window.__nativeRAF = window.requestAnimationFrame.bind(window);
  window.__nativeSetTimeout = window.setTimeout.bind(window);
  const counts = (window.__makeDemoCounts = { workers: 0, audioContexts: 0, closedShadowRoots: 0, smoothScrolls: 0 });
  const counted = (name, key) => {
    if (typeof window[name] !== 'function') return;
    window[name] = new Proxy(window[name], { construct(target, args, newTarget) { counts[key] += 1; return Reflect.construct(target, args, newTarget); } });
  };
  counted('Worker', 'workers');
  counted('SharedWorker', 'workers');
  counted('AudioContext', 'audioContexts');
  counted('webkitAudioContext', 'audioContexts');
  const attach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function attachShadow(init) {
    if (init && init.mode === 'closed') counts.closedShadowRoots += 1;
    return attach.call(this, init);
  };
  const smooth = (owner, name) => {
    const original = owner[name];
    if (typeof original !== 'function') return;
    owner[name] = function wrapped(...args) {
      if (args[0] && typeof args[0] === 'object' && args[0].behavior === 'smooth') counts.smoothScrolls += 1;
      return original.apply(this, args);
    };
  };
  for (const name of ['scrollTo', 'scrollBy', 'scroll']) { smooth(window, name); smooth(Element.prototype, name); }
  smooth(Element.prototype, 'scrollIntoView');
}

/** Add `dt` ms (times the playback rate) to every running animation on the document timeline: the document and open shadow roots. */
async function syncAnimations(dt) {
  const roots = [document];
  for (let i = 0; i < roots.length; i += 1) {
    for (const element of roots[i].querySelectorAll('*')) if (element.shadowRoot) roots.push(element.shadowRoot);
  }
  const seen = new Set();
  for (const root of roots) for (const animation of root.getAnimations()) seen.add(animation);
  // A play(), reverse() or rate change the page made is pending until a frame: its rate is not the new one yet, so wait for
  // `ready` (a few real frames at most, in case a frozen timeline never settles it, and at most 250 ms: a frame that is off
  // screen or hidden gets no frames from the browser, so a frame callback alone would wait for ever).
  const pending = [...seen].filter((animation) => animation.pending);
  if (pending.length > 0 && typeof window.__nativeRAF === 'function') {
    const frames = (n) => new Promise((resolve) => window.__nativeRAF(() => (n > 1 ? frames(n - 1).then(resolve) : resolve())));
    const giveUp = new Promise((resolve) => window.__nativeSetTimeout(resolve, 250));
    await Promise.race([Promise.all(pending.map((animation) => animation.ready)), frames(5), giveUp]);
  }
  for (const animation of seen) {
    if (animation.playState !== 'running' || animation.timeline !== document.timeline || animation.playbackRate === 0) continue;
    animation.currentTime = (animation.currentTime ?? 0) + dt * animation.playbackRate;
  }
}

/** Real macrotask turns, so a fetch's `.then` has run before we look. */
const flushPage = () => new Promise((resolve) => {
  let turns = 4;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => { turns -= 1; if (turns > 0) channel.port2.postMessage(0); else resolve(); };
  channel.port2.postMessage(0);
});

/** One real rendered frame (the page's own requestAnimationFrame is fake), so finish events and style changes are delivered. */
const nativeFrame = () => new Promise((resolve) => {
  if (typeof window.__nativeRAF === 'function') window.__nativeRAF(() => resolve());
  else resolve();
});

/** Timeouts due within `limit` ms of film on this frame's fake clock: the page has said it will do something soon. */
function timersDue(limit) {
  const clock = globalThis.__pwClock?.controller;
  if (!clock) return 0;
  return [...clock._timers.values()].filter((t) => (t.type === 'Timeout' || t.type === 'IdleCallback') && t.callAt - clock._now.ticks <= limit).length;
}

/** What this frame runs in real time. */
function scanRealTime() {
  const counts = window.__makeDemoCounts ?? {};
  const animatedSrc = /\.(gif|apng|webp)([?#]|$)|^data:image\/(gif|apng|webp)/i;
  return {
    workers: counts.workers ?? 0,
    audioContexts: counts.audioContexts ?? 0,
    closedShadowRoots: counts.closedShadowRoots ?? 0,
    smoothScrolls: counts.smoothScrolls ?? 0,
    smoothScrollCss: getComputedStyle(document.documentElement).scrollBehavior === 'smooth',
    playingVideos: [...document.querySelectorAll('video')].filter((v) => !v.paused && !v.ended).length,
    animatedImages: [...document.images].filter((i) => animatedSrc.test(i.currentSrc || i.src)).length,
    smil: document.querySelectorAll('svg animate, svg animateTransform, svg animateMotion, svg set').length,
  };
}

// ---- Node side ----

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `promise`, or a StepTimeout after `ms`. The promise stays attached, so a late rejection is not left unhandled. */
function withDeadline(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new StepTimeout(`${label} did not finish in ${ms} ms: the page is stuck`)), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

const liveFrames = (page) => page.frames().filter((frame) => !frame.isDetached());
const inEveryFrame = (page, fn, arg) => Promise.all(liveFrames(page).map((frame) => frame.evaluate(fn, arg)));

/** Requests started (a running count) and not yet finished (request to its number), so a step can wait for the ones it caused. */
function watchRequests(page) {
  const watch = { started: 0, pending: new Map() };
  page.on('request', (r) => { watch.started += 1; watch.pending.set(r, watch.started); });
  page.on('requestfinished', (r) => watch.pending.delete(r));
  page.on('requestfailed', (r) => watch.pending.delete(r));
  return watch;
}

/** Freeze the document timeline of the page and of every frame that has a CDP session of its own. */
async function freezeTimeline(page, warnings) {
  const context = page.context();
  const freeze = async (target) => {
    const session = await context.newCDPSession(target);
    await session.send('Animation.enable');
    await session.send('Animation.setPlaybackRate', { playbackRate: 0 });
  };
  await freeze(page);
  const onFrame = async (frame) => {
    if (frame === page.mainFrame()) return;
    try {
      await freeze(frame);
    } catch (error) {
      if (!NO_SEPARATE_SESSION.test(error.message)) warnings.push(`frame ${frame.url()}: ${error.message}`);
    }
  };
  page.on('frameattached', onFrame);
  page.on('framenavigated', onFrame);
}

const sumReports = (reports) => reports.reduce((all, one) => Object.fromEntries(Object.entries(one).map(([key, value]) => [key, typeof value === 'boolean' ? (all[key] ?? false) || value : (all[key] ?? 0) + value])), {});

/**
 * The page's clock, stepped. Install before `goto`. `fps` frames make a second: the step lengths are the whole
 * milliseconds between rounded frame times, so `fps` steps always add to exactly 1000.
 */
export async function installStepper(page, { fps = 30, startTime = 0, stepDeadlineMs = STEP_DEADLINE_MS } = {}) {
  if (!Number.isFinite(fps) || fps <= 0) throw new RangeError(`fps must be a positive number, got ${fps}`);
  await page.context().addInitScript(setupPage);
  await page.clock.install({ time: startTime });
  await page.clock.pauseAt(startTime + CLOCK_LEAD_MS);
  const warnings = [];
  await freezeTimeline(page, warnings);
  const watch = watchRequests(page);
  const driver = createDriver(page, watch, { fps, stepDeadlineMs });
  const countTimersDue = async () => (await inEveryFrame(page, timersDue, SHORT_TIMER_MS)).reduce((a, b) => a + b, 0);
  const { advanceOnce, guarded } = driver;
  return {
    warnings,
    now: driver.now,
    timerErrors: driver.timerErrors,
    async step(n = 1) {
      for (let i = 0; i < n; i += 1) await guarded(advanceOnce, 'a step');
    },
    async report() {
      return sumReports(await inEveryFrame(page, scanRealTime));
    },
    // `onStep`, when given, is awaited after each advance, before settle's own screenshot (a take stores its frame there).
    async settle({ stillFrames = Math.round(fps * SETTLE_SECONDS), maxFrames = Math.round(fps * SETTLE_CAP_SECONDS), maxRealMs = SETTLE_REAL_CAP_MS, onStep = null } = {}) {
      return settleLoop({ stillFrames, maxFrames, maxRealMs }, { page, watch, guarded, advanceOnce, countTimersDue, onStep });
    },
  };
}

/** The film clock of one page: how far it has run, one step of it, and a deadline around any call into the page. */
function createDriver(page, watch, { fps, stepDeadlineMs }) {
  const state = { frames: 0, drained: 0, timerErrors: [], crashed: false };
  const filmMs = (n) => Math.round((n * MS_PER_SECOND) / fps);

  // The fake clock catches an exception a timer callback throws and rethrows it from runFor, after the whole step has run. Real
  // time reports it as a page error and carries on, so the stepper keeps it (timerErrors) and carries on too, whatever the text says.
  // A lost page is a closed page or a crash, nothing else. Real time's page error has no class name, so the prefix is dropped.
  page.on('crash', () => { state.crashed = true; });
  async function runClock(dt) {
    try {
      await page.clock.runFor(dt);
    } catch (error) {
      if (page.isClosed() || state.crashed) throw error;
      state.timerErrors.push(String(error.message).split('\n')[0].replace(/^clock\.runFor: (\w*Error: )?/, ''));
    }
  }

  // Waits only for requests started since the last step: a request that never ends (a stream) must not stall every frame.
  async function waitForNetwork() {
    const deadline = Date.now() + NETWORK_WAIT_MS;
    const caused = () => [...watch.pending.values()].some((seq) => seq > state.drained);
    while (caused() && Date.now() < deadline) await wait(NETWORK_POLL_MS);
  }

  async function advanceOnce() {
    const from = filmMs(state.frames);
    state.frames += 1;
    const dt = filmMs(state.frames) - from;
    await runClock(dt);
    await waitForNetwork();
    await page.evaluate(flushPage);
    await inEveryFrame(page, syncAnimations, dt);
    await page.evaluate(nativeFrame);
    const startedRequests = watch.started - state.drained;
    state.drained = watch.started;
    return { startedRequests };
  }

  /** Run `work()` against the step deadline; past it, close the context so nothing is left running, and throw. */
  async function guarded(work, label) {
    try {
      return await withDeadline(work(), stepDeadlineMs, label);
    } catch (error) {
      if (!(error instanceof StepTimeout)) throw error;
      const closing = page.context().close().then(() => null, (closeError) => closeError);
      throw new StepTimeout(error.message, await Promise.race([closing, wait(CLOSE_GRACE_MS)]));
    }
  }

  return { advanceOnce, guarded, now: () => filmMs(state.frames), timerErrors: () => [...state.timerErrors] };
}

/** Step until the picture is still for `stillFrames` frames with nothing pending, or a cap. Never throws for a stuck page. */
async function settleLoop({ stillFrames, maxFrames, maxRealMs }, { page, watch, guarded, advanceOnce, countTimersDue, onStep }) {
  const began = Date.now();
  let previous = null;
  let still = 0;
  let used = 0;
  const result = (capped, reason) => ({ frames: used, capped, reason, pendingRequests: watch.pending.size, timersDue: capped ? lastTimersDue : 0 });
  let lastTimersDue = 0;
  try {
    while (still < stillFrames) {
      if (used >= maxFrames) return result(true, 'frames');
      if (Date.now() - began >= maxRealMs) return result(true, 'time');
      const { startedRequests } = await guarded(advanceOnce, 'a settle step');
      used += 1;
      if (onStep) await onStep();
      const shot = await guarded(() => page.screenshot(SETTLE_SHOT), 'a settle screenshot');
      lastTimersDue = await guarded(countTimersDue, 'reading timers');
      const same = previous !== null && shot.equals(previous) && startedRequests === 0 && watch.pending.size === 0 && lastTimersDue === 0;
      still = same ? still + 1 : 0;
      previous = shot;
    }
  } catch (error) {
    if (error instanceof StepTimeout) return result(true, 'time');
    throw error;
  }
  return result(false, 'still');
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
