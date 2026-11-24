// Browser tests on loopback fixtures only. One browser for the whole file; run with --test-concurrency=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSites } from './fixtures/sites/server.mjs';
import { chromium } from 'playwright';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import * as stepperModule from '../scripts/lib/stepper.mjs';

const { installStepper, scrollTo } = stepperModule;

const VIEWPORT = { width: 1280, height: 720 };
const SETTLE_REAL_BUDGET_MS = 12000;

let sites;
let browser;
before(async () => {
  const live = liveBrowsers();
  assert.deepEqual(live, [], 'another headless browser is running: wait for it, never run two');
  sites = await startSites();
  // Site isolation on, so a frame from another site (localhost against 127.0.0.1) is out of process, as on a real site.
  browser = await launchBrowser({ launch: () => chromium.launch({ args: ['--site-per-process'] }) });
});
after(async () => {
  await browser?.close();
  await sites?.close();
});

async function open(path, { scale = 1 } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: scale });
  const page = await context.newPage();
  const stepper = await installStepper(page, { fps: 30 });
  await page.goto(sites.origin + path);
  return { context, page, stepper };
}

const times = (page) => page.evaluate(() => ({ date: Date.now(), perf: performance.now() }));

/** A box that fades in with a transition the page starts now, with the given transition value. */
const startFade = (page, transition) => page.evaluate((value) => {
  const box = document.createElement('div');
  box.id = 'fade';
  box.style.cssText = `position:fixed;left:10px;top:10px;width:50px;height:50px;background:#000;opacity:0;transition:${value}`;
  document.body.append(box);
  getComputedStyle(box).opacity;
  box.style.opacity = '1';
  getComputedStyle(box).opacity;
}, transition);

const opacity = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.getElementById('fade')).opacity));

test('30 steps move Date.now() and performance.now() by exactly 1000 each, and now() agrees', async () => {
  const { context, page, stepper } = await open('/plain/');
  const before1 = await times(page);
  await stepper.step();
  assert.equal(stepper.now(), 33);
  await stepper.step();
  assert.equal(stepper.now(), 67);
  await stepper.step(28);
  const after1 = await times(page);
  assert.equal(after1.date - before1.date, 1000);
  assert.equal(after1.perf - before1.perf, 1000);
  assert.equal(stepper.now(), 1000);
  await context.close();
});

test('with no step the page time does not move', async () => {
  const { context, page } = await open('/plain/');
  const a = await times(page);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const b = await times(page);
  assert.deepEqual(b, a);
  await context.close();
});

test('on /spa/ after the search the count-up shows the same text at the same film time in two runs', async () => {
  const texts = [];
  for (let run = 0; run < 2; run += 1) {
    const { context, page, stepper } = await open('/spa/');
    await page.fill('#q', 'o');
    await page.click('#go');
    await stepper.step(20);
    texts.push(await page.textContent('#count'));
    await context.close();
  }
  assert.equal(texts[0], texts[1]);
  assert.ok(Number(texts[0]) > 0 && Number(texts[0]) < 247, `mid-count at 20 frames, got ${texts[0]}`);
});

test('the count-up ends at 247 once its 1200 ms of film time are over', async () => {
  const { context, page, stepper } = await open('/spa/');
  await page.click('#go');
  await stepper.step(40);
  assert.equal(await page.textContent('#count'), '247');
  await context.close();
});

test('a 500 ms transition started in the middle of a take is at 0.5 (±0.04) after 250 ms and done after 500', async () => {
  const { context, page, stepper } = await open('/plain/');
  await stepper.step(10);
  await startFade(page, 'opacity 500ms linear');
  const startedAt = stepper.now();
  await stepper.step(8);
  const progress = await opacity(page);
  const elapsed = stepper.now() - startedAt;
  assert.ok(Math.abs(progress - 0.5) <= 0.04, `opacity ${progress} after ${elapsed} ms`);
  assert.ok(Math.abs(progress - elapsed / 500) <= 0.01, `opacity ${progress} is not the linear progress of ${elapsed} ms`);
  await stepper.step(7);
  assert.equal(await opacity(page), 1);
  assert.equal(await page.evaluate(() => document.getAnimations().length), 0, 'a finished transition is gone');
  await context.close();
});

test('a transition with a delay waits the delay in film time', async () => {
  const { context, page, stepper } = await open('/plain/');
  await startFade(page, 'opacity 500ms linear 200ms');
  await stepper.step(5);
  assert.equal(await opacity(page), 0, 'still inside the 200 ms delay at 167 ms');
  await stepper.step(3);
  const progress = await opacity(page);
  assert.ok(Math.abs(progress - 0.134) <= 0.04, `opacity ${progress} at 267 ms`);
  await stepper.step(14);
  assert.equal(await opacity(page), 1);
  await context.close();
});

test('an infinite animation keeps going after 90 frames and the page can see its time', async () => {
  const { context, page, stepper } = await open('/plain/');
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '@keyframes pa-spin { to { transform: rotate(360deg); } }';
    document.head.append(style);
    const box = document.createElement('div');
    box.id = 'spin';
    box.style.cssText = 'position:fixed;left:10px;top:10px;width:50px;height:50px;background:#000;animation:pa-spin 1300ms linear infinite';
    document.body.append(box);
  });
  const transform = () => page.evaluate(() => getComputedStyle(document.getElementById('spin')).transform);
  await stepper.step(1);
  const early = await transform();
  await stepper.step(89);
  const time = await page.evaluate(() => document.getAnimations().find((a) => a.animationName === 'pa-spin').currentTime);
  assert.ok(Math.abs(time - 3000) <= 1, `animation time ${time}`);
  assert.notEqual(await transform(), early);
  await context.close();
});

test('an animation the page pauses is left alone until the page runs it again', async () => {
  const { context, page, stepper } = await open('/plain/');
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '@keyframes pa-slide { to { transform: translateX(100px); } }';
    document.head.append(style);
    const box = document.createElement('div');
    box.id = 'slide';
    box.style.cssText = 'position:fixed;left:10px;top:10px;width:50px;height:50px;background:#000;animation:pa-slide 1000ms linear forwards paused';
    document.body.append(box);
  });
  const slideTime = () => page.evaluate(() => document.getAnimations().find((a) => a.animationName === 'pa-slide').currentTime);
  await stepper.step(30);
  assert.equal(await slideTime(), 0);
  await page.evaluate(() => { document.getElementById('slide').style.animationPlayState = 'running'; });
  await stepper.step(15);
  assert.ok(Math.abs(await slideTime() - 500) <= 1);
  await context.close();
});

test('/canvas/ gives a byte-equal 3x frame at film second 1 in two runs, and a different one at half a second', async () => {
  const shots = [];
  for (let run = 0; run < 2; run += 1) {
    const { context, page, stepper } = await open('/canvas/', { scale: 3 });
    await stepper.step(15);
    const half = await page.screenshot({ type: 'png' });
    await stepper.step(15);
    shots.push({ half, full: await page.screenshot({ type: 'png' }) });
    await context.close();
  }
  assert.ok(shots[0].full.equals(shots[1].full), 'the frames at film second 1 are equal');
  assert.ok(shots[0].half.equals(shots[1].half), 'the frames at half a second are equal');
  assert.ok(!shots[0].half.equals(shots[0].full), 'the chart moved between half a second and one');
});

test('settle() on /slow/ waits for the 1200 ms content and returns reason still', async () => {
  const { context, page, stepper } = await open('/slow/');
  const result = await stepper.settle();
  assert.equal(result.reason, 'still');
  assert.equal(result.capped, false);
  assert.match(await page.textContent('#out'), /Quarterly report/);
  assert.ok(stepper.now() >= 1200, `settled at ${stepper.now()} ms`);
  await context.close();
});

test('settle() on /slow/poll stops at its cap and says capped, in under 12 s', async () => {
  const { context, stepper } = await open('/slow/poll');
  const began = Date.now();
  const result = await stepper.settle();
  assert.equal(result.capped, true);
  assert.equal(result.reason, 'frames');
  assert.equal(result.frames, 240, '8 s of film at 30 fps');
  assert.ok(Date.now() - began < SETTLE_REAL_BUDGET_MS, `took ${Date.now() - began} ms`);
  await context.close();
});

test('settle() with a real-time cap stops at that cap and says time', async () => {
  const { context, stepper } = await open('/slow/poll');
  const result = await stepper.settle({ maxRealMs: 1, maxFrames: 1000 });
  assert.deepEqual([result.capped, result.reason], [true, 'time']);
  await context.close();
});

test('scrollTo(page, 600, 1) ends at scrollY 600 after 30 steps, and is halfway at half a second', async () => {
  const { context, page, stepper } = await open('/plain/');
  await scrollTo(page, 600, 1);
  await stepper.step(15);
  const middle = await page.evaluate(() => window.scrollY);
  assert.ok(middle > 250 && middle < 350, `scrollY ${middle} at half a second`);
  await stepper.step(15);
  assert.equal(await page.evaluate(() => window.scrollY), 600);
  await context.close();
});

test('scrollTo also finishes in real time', async () => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(sites.origin + '/plain/');
  await scrollTo(page, 400, 0.2);
  await page.waitForFunction(() => window.scrollY === 400, undefined, { timeout: 3000 });
  await context.close();
});

// ---- Fix round 1: what the review measured ----

const REAL_IDLE_MS = 500;
const idle = (ms = REAL_IDLE_MS) => new Promise((resolve) => setTimeout(resolve, ms));
const near = (actual, wanted, slack = 1) => assert.ok(Math.abs(actual - wanted) <= slack, `${actual} is not within ${slack} of ${wanted}`);

/** A box with a Web Animation the page keeps in `window.an`. */
const startWaapi = (page, options) => page.evaluate((opts) => {
  const box = document.createElement('div');
  box.id = 'wa';
  box.style.cssText = 'position:fixed;left:0;top:0;width:20px;height:20px;background:#000';
  document.body.append(box);
  window.an = box.animate([{ left: '0px' }, { left: '100px' }], opts);
}, options);
const waapi = (page) => page.evaluate(() => [Math.round(an.currentTime), an.playState, an.playbackRate]);

test('animations in an iframe and in a shadow root move only when stepped (C6)', async () => {
  const { context, page, stepper } = await open('/anim/');
  await stepper.step(3);
  const inner = page.frames().find((f) => f !== page.mainFrame());
  const innerTime = () => inner.evaluate(() => document.getAnimations()[0].currentTime);
  const shadowTime = () => page.evaluate(() => document.getElementById('host').shadowRoot.getAnimations()[0].currentTime);
  near(await innerTime(), 100);
  near(await shadowTime(), 100);
  await idle();
  near(await innerTime(), 100);
  near(await shadowTime(), 100);
  await context.close();
});

test('a page that pauses a Web Animation in the middle of a take holds it (C2)', async () => {
  const { context, page, stepper } = await open('/plain/');
  await startWaapi(page, { duration: 1000 });
  await stepper.step(6);
  await page.evaluate(() => an.pause());
  await stepper.step(9);
  near((await waapi(page))[0], 200);
  assert.equal((await waapi(page))[1], 'paused');
  await context.close();
});

test('a CSS animation-play-state paused in the middle of a take holds it (C2)', async () => {
  const { context, page, stepper } = await open('/plain/');
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '@keyframes pa-k { to { transform: translateX(100px); } }';
    document.head.append(style);
    const box = document.createElement('div');
    box.id = 'css';
    box.style.cssText = 'position:fixed;left:0;top:0;width:20px;height:20px;background:#000;animation:pa-k 1s linear forwards';
    document.body.append(box);
  });
  await stepper.step(6);
  await page.evaluate(() => { document.getElementById('css').style.animationPlayState = 'paused'; });
  await stepper.step(9);
  near(await page.evaluate(() => document.getAnimations().find((a) => a.animationName === 'pa-k').currentTime), 200);
  await context.close();
});

test('an animation the page plays again after it ended runs from its new start (C3)', async () => {
  const { context, page, stepper } = await open('/plain/');
  await startWaapi(page, { duration: 300, fill: 'forwards' });
  await stepper.step(15);
  assert.equal((await waapi(page))[1], 'finished');
  await page.evaluate(() => { an.currentTime = 0; an.play(); });
  await stepper.step(3);
  const [time, state] = await waapi(page);
  near(time, 100);
  assert.equal(state, 'running');
  await context.close();
});

test('an animation the page seeks before the first step starts from its seek (C4)', async () => {
  const { context, page, stepper } = await open('/plain/');
  await startWaapi(page, { duration: 1000 });
  await page.evaluate(() => { an.currentTime = 500; });
  await stepper.step(3);
  near((await waapi(page))[0], 600);
  await context.close();
});

test('a playback rate of 2 set mid-take doubles the film time it gains', async () => {
  const { context, page, stepper } = await open('/plain/');
  await startWaapi(page, { duration: 2000 });
  await stepper.step(6);
  await page.evaluate(() => { an.playbackRate = 2; });
  await stepper.step(3);
  near((await waapi(page))[0], 200 + 200);
  await context.close();
});

test('reverse() mid-take plays back at the film rate (C5)', async () => {
  const { context, page, stepper } = await open('/plain/');
  await startWaapi(page, { duration: 2000 });
  await stepper.step(6);
  await page.evaluate(() => an.reverse());
  await stepper.step(3);
  const [time, state, rate] = await waapi(page);
  near(time, 200 - 100);
  assert.deepEqual([state, rate], ['running', -1]);
  await context.close();
});

test('the finish event of a 100 ms animation reaches the page within a frame of its end (C9)', async () => {
  const { context, page, stepper } = await open('/plain/');
  await page.evaluate(() => {
    window.finished = [];
    window.began = performance.now();
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;width:20px;height:20px;background:#000';
    document.body.append(box);
    window.an = box.animate([{ left: '0px' }, { left: '100px' }], { duration: 100 });
    an.onfinish = () => finished.push(performance.now() - began);
  });
  await stepper.step(5);
  assert.equal(await page.evaluate(() => finished.length), 1);
  const at = await page.evaluate(() => finished[0]);
  assert.ok(at >= 100 && at <= 134, `finish reached the page at ${at} ms of film`);
  await context.close();
});

test('the animation timeline stays stopped across a navigation (C3, C8)', async () => {
  const { context, page, stepper } = await open('/anim/');
  await stepper.step(3);
  await page.goto(sites.origin + '/anim/');
  await idle();
  assert.ok(await page.evaluate(() => document.getAnimations()[0].currentTime) <= 34, 'the new document runs in real time');
  await context.close();
});

test('after 30 steps a new document sees film time in performance.now() and Date.now() (C8, pinned)', async () => {
  const { context, page, stepper } = await open('/plain/');
  const first = await times(page);
  await stepper.step(30);
  await page.goto(sites.origin + '/plain/two');
  const second = await times(page);
  assert.equal(second.date - first.date, 1000);
  near(second.perf - first.perf, 1000, 2);
  assert.equal(stepper.now(), 1000);
  await context.close();
});

test('fps must be a positive number', async () => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await assert.rejects(installStepper(page, { fps: 0 }), RangeError);
  await assert.rejects(installStepper(page, { fps: Number.NaN }), RangeError);
  await context.close();
});

test('settle() waits for content a timer adds 1200 ms after load, with no spinner and no request (B11)', async () => {
  const { context, page, stepper } = await open('/slow/late');
  const result = await stepper.settle();
  assert.equal(result.reason, 'still');
  assert.match(await page.textContent('#out'), /Arrived/);
  assert.ok(stepper.now() >= 1200);
  await context.close();
});

test('settle() on a page that busy-waits on Date.now() ends capped, never hangs (C1)', { timeout: 30000 }, async () => {
  const { context, stepper } = await open('/busy/');
  const began = Date.now();
  const result = await stepper.settle();
  assert.deepEqual([result.capped, result.reason], [true, 'time']);
  assert.ok(Date.now() - began < 20000, `took ${Date.now() - began} ms`);
  await context.close();
});

test('step() on a page that busy-waits throws StepTimeout and closes the context (C1)', { timeout: 30000 }, async () => {
  const { context, page, stepper } = await open('/busy/');
  await assert.rejects(stepper.step(5), (error) => error instanceof stepperModule.StepTimeout);
  assert.equal(page.isClosed(), true);
  await context.close();
});

test('settle() on a zero-delay timer loop ends capped: a page with a timer always due is not settled (C1)', { timeout: 30000 }, async () => {
  const { context, stepper } = await open('/zero/');
  const result = await stepper.settle({ maxRealMs: 5000 });
  assert.equal(result.capped, true);
  assert.ok(result.timersDue > 0, 'the cap is because a timer is always due');
  await context.close();
});

test('report() names what still runs in real time (C7)', async () => {
  const { context, stepper } = await open('/realtime/');
  await stepper.step(2);
  const report = await stepper.report();
  assert.equal(report.workers, 1);
  assert.equal(report.closedShadowRoots, 1);
  assert.equal(report.smoothScrolls >= 1, true);
  assert.equal(report.smoothScrollCss, true);
  assert.equal(report.playingVideos, 1);
  assert.equal(report.animatedImages, 1);
  assert.equal(report.smil, 1);
  assert.equal(report.audioContexts, 0);
  await context.close();
});

test('an exception a page timer throws does not stop the film, and timerErrors() names it (B8)', async () => {
  const { context, page, stepper } = await open('/plain/');
  await page.evaluate(() => {
    setTimeout(() => { throw new Error('boom 123'); }, 50);
    // Words a lost page would use must not end the step, and a TypeError must read as real time reports it: with no class name.
    setTimeout(() => { throw new Error('WebSocket connection closed, retrying'); }, 100);
    setTimeout(() => { null.x; }, 150);
  });
  await stepper.step(7);
  assert.equal(stepper.now(), 233, 'every step ran');
  assert.deepEqual(stepper.timerErrors(), ['boom 123', 'WebSocket connection closed, retrying', "Cannot read properties of null (reading 'x')"]);
  await stepper.step(2);
  assert.equal(stepper.timerErrors().length, 3, 'the next steps add none');
  await context.close();
});

test('an animation that starts in an off-screen cross-site frame does not stop the step (C1 of review 2)', { timeout: 30000 }, async () => {
  const { context, page, stepper } = await open('/oop/');
  const began = Date.now();
  await stepper.step(20);
  // Each step may wait the 250 ms give-up for a frame that never comes, so 20 steps are bounded by 20 x 250 ms plus their own work.
  assert.ok(Date.now() - began < 20 * 250 + 3000, `20 steps took ${Date.now() - began} ms`);
  const far = page.frames().find((f) => f.url().includes('localhost'));
  assert.ok(far, 'the cross-site frame is there');
  const time = await far.evaluate(() => window.slide?.currentTime);
  assert.ok(time > 300 && time < 420, `the animation, started at 300 ms of film, reads ${time} at 667 ms`);
  await context.close();
});

test('report() on a plain page is empty', async () => {
  const { context, stepper } = await open('/plain/');
  const report = await stepper.report();
  assert.deepEqual(Object.values(report).filter((v) => v !== 0 && v !== false), []);
  await context.close();
});
