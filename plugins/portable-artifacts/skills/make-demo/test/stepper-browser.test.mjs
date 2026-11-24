// Browser tests on loopback fixtures only. One browser for the whole file; run with --test-concurrency=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSites } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { installStepper, scrollTo } from '../scripts/lib/stepper.mjs';

const VIEWPORT = { width: 1280, height: 720 };
const SETTLE_REAL_BUDGET_MS = 12000;

let sites;
let browser;
before(async () => {
  const live = liveBrowsers();
  assert.deepEqual(live, [], 'another headless browser is running: wait for it, never run two');
  sites = await startSites();
  browser = await launchBrowser();
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
  await stepper.step(8);
  const progress = await opacity(page);
  assert.ok(Math.abs(progress - 0.5) <= 0.04, `opacity ${progress} after 267 ms`);
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
  assert.equal(result.frames, 90);
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
