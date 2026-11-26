// Acts under the stepped clock: each verb of a plan row runs against the live page with its clock stopped, a take context at scale 3.
// Loopback fixtures only. One browser for the file; run with --test-concurrency=1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSites } from './fixtures/sites/server.mjs';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { openVisit } from '../scripts/lib/visit.mjs';
import { installStepper } from '../scripts/lib/stepper.mjs';
import { runScout } from '../scripts/lib/scout-run.mjs';
import { planRows } from '../scripts/lib/plan-rows.mjs';
import { liveControl, act, ActRefused } from '../scripts/lib/take-act.mjs';

const VIEWPORT = { width: 1280, height: 720 };
const SCALE = 3;
const POINTER_FRAMES = 10;
const TEXT_FRAMES_PER_CHAR = 2;

let sites;
let browser;
let scout;
let scoutPage;
let spec;
before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  sites = await startSites();
  browser = await launchBrowser();
  spec = specWith([]);
  const result = await runScout({ browser, spec });
  assert.equal(result.ok, true, result.reason);
  scout = result.scout;
  scoutPage = scout.pages[0];
});
after(async () => {
  await browser?.close();
  await sites?.close();
});

const GO = { id: 'g', do: 'goto', value: '/take/' };
function specWith(steps) {
  return {
    version: 1, source: { url: `${sites.origin}/take/` }, origins: [sites.origin], rights: 'own', pages: [],
    useCases: [{ id: 'uc', title: 'T', steps: [GO, ...steps] }],
  };
}
/** The plan rows of `steps` after a goto of the start page, from the real scout of the fixture. */
function rowsFor(steps) {
  const { rows, errors } = planRows(specWith(steps), scout);
  assert.deepEqual(errors, []);
  return rows.slice(1);
}
const byName = (role, name) => ({ role, name });

async function open() {
  sites.reset();
  const visit = await openVisit(browser, { viewport: VIEWPORT, origins: [sites.origin], scale: SCALE, posts: true, downloads: true });
  const stepper = await installStepper(visit.page, { fps: 30 });
  await visit.page.goto(`${sites.origin}/take/`, { waitUntil: 'domcontentloaded' });
  await stepper.settle();
  return { ...visit, stepper };
}

/** Run each row in turn on one fresh take context; `check(session, results)` looks at the page after, then the context is closed. */
async function run(steps, check) {
  const session = await open();
  const frames = { n: 0 };
  const results = [];
  try {
    let pointer = null;
    for (const row of rowsFor(steps)) {
      const result = await act(session.page, session.stepper, row, { signedIn: false, pointer, scoutPage, onFrame: async () => { frames.n += 1; } });
      pointer = result.pointer;
      results.push(result);
    }
    await check(session, results, frames);
  } finally {
    await session.context.close();
  }
}
const text = (page, selector) => page.locator(selector).innerText();
const T = { timeout: 120000 };

test('type puts the typed text in the field, one character per 2 frames, and settles', T, async () => {
  await run([{ id: 't', do: 'type', target: byName('textbox', 'Your name'), value: 'Ada' }], async ({ page }, [result], frames) => {
    assert.equal(await page.inputValue('#field'), 'Ada');
    assert.equal(result.settle.capped, false);
    assert.ok(frames.n >= POINTER_FRAMES + 3 * TEXT_FRAMES_PER_CHAR, `frames ${frames.n}`);
    assert.equal(result.settleFrame - result.startFrame, frames.n, 'onFrame ran after every step, settle steps included');
    assert.ok(result.startFrame < result.actFrame && result.actFrame < result.settleFrame);
  });
});

test('select chooses the option', T, async () => {
  await run([{ id: 's', do: 'select', target: byName('combobox', 'Colour'), value: 'green' }], async ({ page }, [result]) => {
    assert.equal(await page.inputValue('#pick'), 'green');
    assert.equal(result.settle.capped, false);
  });
});

test('a click on the transition button shows the new text once the 300 ms transition has run, and settles', T, async () => {
  await run([{ id: 'c', do: 'click', target: byName('button', 'Reveal') }], async ({ page }, [result]) => {
    assert.equal(await text(page, '#status'), 'Revealed');
    assert.equal(result.settle.capped, false);
    assert.equal(result.pointer.x, Math.round(result.box.x + result.box.width / 2));
  });
});

test('press Enter in the field reaches the page', T, async () => {
  const steps = [
    { id: 't', do: 'type', target: byName('textbox', 'Your name'), value: 'Ada' },
    { id: 'p', do: 'press', target: byName('textbox', 'Your name'), value: 'Enter' },
  ];
  await run(steps, async ({ page }, results) => {
    assert.equal(await text(page, '#log'), 'enter:Ada');
    assert.ok(results.every((r) => r.settle.capped === false));
  });
});

test('hover leaves the pointer over the control and settles', T, async () => {
  await run([{ id: 'h', do: 'hover', target: byName('button', 'Hover me') }], async ({ page }, [result]) => {
    assert.equal(await page.evaluate(() => document.getElementById('hov').matches(':hover')), true);
    assert.equal(result.settle.capped, false);
  });
});

test('scroll with a value in pixels moves the page there', T, async () => {
  await run([{ id: 'sc', do: 'scroll', value: 400 }], async ({ page }, [result]) => {
    assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 400);
    assert.equal(result.settle.capped, false);
  });
});

test('wait 0.5 runs 15 frames and then settles', T, async () => {
  await run([{ id: 'w', do: 'wait', value: 0.5 }], async (_session, [result], frames) => {
    assert.ok(frames.n >= 15, `frames ${frames.n}`);
    assert.equal(result.settle.capped, false);
    assert.equal(result.box, null);
  });
});

test('a goto opens the address under the stepper', T, async () => {
  await run([{ id: 'n', do: 'goto', value: '/take/next.html' }], async ({ page }, [result]) => {
    assert.equal(new URL(page.url()).pathname, '/take/next.html');
    assert.equal(result.settle.capped, false);
  });
});

test('a click on a link lands on the next page, and the page is read once it has settled', T, async () => {
  await run([{ id: 'l', do: 'click', target: byName('link', 'Next page') }], async ({ page }, [result]) => {
    assert.equal(new URL(page.url()).pathname, '/take/next.html');
    assert.equal(await text(page, 'h1'), 'Next page');
    assert.equal(result.settle.capped, false);
  });
});

test('a click whose page navigates from a timer, during the settle steps, still ends on the new page', T, async () => {
  await run([{ id: 'z', do: 'click', target: byName('button', 'Leave later') }], async ({ page }, [result]) => {
    assert.equal(new URL(page.url()).pathname, '/take/next.html');
    assert.equal(result.settle.capped, false);
  });
});

test('a same-origin form post reaches /take/save once and lands on the answer page', T, async () => {
  await run([{ id: 'f', do: 'click', target: byName('button', 'Save note') }], async ({ page }, [result]) => {
    assert.equal(sites.saves().length, 1);
    assert.ok(sites.saves()[0] > 0);
    assert.equal(new URL(page.url()).pathname, '/take/saved.html');
    assert.equal(result.settle.capped, false);
  });
});

test('a form whose action is the other origin is refused, and the other origin sees nothing', T, async () => {
  // The act itself finishes; the page is left on the browser's error page, and the take (task 4) stops on `seen.refused`.
  await run([{ id: 'o', do: 'click', target: byName('button', 'Send away') }], async ({ seen }, [result]) => {
    assert.equal(seen.refused.length, 1);
    assert.equal(seen.refused[0].origin, sites.otherOrigin);
    assert.equal(sites.requests().filter((r) => r.server === 'other').length, 0);
    assert.equal(result.settle.capped, false);
  });
});

test('the download link puts one download in the queue', T, async () => {
  await run([{ id: 'd', do: 'click', target: byName('link', 'Get file') }], async ({ seen }) => {
    assert.equal(seen.downloadQueue.length, 1);
  });
});

test('an act on a control something now covers is refused, not clicked at the wrong thing', T, async () => {
  const session = await open();
  try {
    const [row] = rowsFor([{ id: 'c', do: 'click', target: byName('button', 'Reveal') }]);
    await session.page.evaluate(() => {
      const cover = document.createElement('div');
      cover.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0.5';
      document.body.append(cover);
    });
    await assert.rejects(act(session.page, session.stepper, row, { signedIn: false, pointer: null, scoutPage }), ActRefused);
    assert.equal(await text(session.page, '#status'), 'Waiting');
  } finally {
    await session.context.close();
  }
});

// ---- liveControl ----

async function live(row, extra = {}) {
  const session = await open();
  try {
    if (extra.change) await session.page.evaluate(extra.change);
    return await liveControl(session.page, row, { signedIn: extra.signedIn ?? false, scoutPage });
  } finally {
    await session.context.close();
  }
}
const REVEAL = () => rowsFor([{ id: 'c', do: 'click', target: byName('button', 'Reveal') }])[0];
const NEXT = () => rowsFor([{ id: 'l', do: 'click', target: byName('link', 'Next page') }])[0];

test('liveControl finds the approved control and returns its box and facts', T, async () => {
  const result = await live(REVEAL());
  assert.equal(result.ok, true);
  assert.ok(result.box.width > 0 && result.box.height > 0);
  assert.equal(result.facts.tag, 'button');
});

test('liveControl says no match when the control is gone', T, async () => {
  const result = await live(REVEAL(), { change: () => document.getElementById('go').remove() });
  assert.deepEqual(result, { ok: false, reason: 'no match' });
});

test('liveControl says 2 matches when a twin with the same role and name appears beside it', T, async () => {
  const result = await live(REVEAL(), { change: () => { const b = document.getElementById('go'); b.parentNode.append(b.cloneNode(true)); } });
  assert.deepEqual(result, { ok: false, reason: '2 matches' });
});

test('liveControl says which field changed when the link address moved', T, async () => {
  const result = await live(NEXT(), { change: () => document.querySelector('a[href="next.html"]').setAttribute('href', 'other.html') });
  assert.deepEqual(result, { ok: false, reason: 'the control changed: href' });
});

test('liveControl says the name changed when the label changed', T, async () => {
  const result = await live(REVEAL(), { change: () => { document.getElementById('go').textContent = 'Hide'; } });
  assert.deepEqual(result, { ok: false, reason: 'the control changed: name' });
});

test('liveControl says the role changed when the element is another role', T, async () => {
  const result = await live(REVEAL(), { change: () => document.getElementById('go').setAttribute('role', 'link') });
  assert.deepEqual(result, { ok: false, reason: 'the control changed: role' });
});

test('liveControl finds a heading by role and exact name; a second heading with that name is 2 matches', T, async () => {
  const row = rowsFor([{ id: 'h', do: 'show', target: byName('heading', 'Take fixture') }])[0];
  assert.equal(row.target.css, null);
  assert.equal((await live(row)).ok, true);
  const twin = await live(row, { change: () => document.body.insertAdjacentHTML('beforeend', '<h1>Take fixture</h1>') });
  assert.deepEqual(twin, { ok: false, reason: '2 matches' });
});

test('signed in, the live name is masked as scout masked it, so a stored masked name matches', T, async () => {
  const row = REVEAL();
  const stored = { ...row, target: { ...row.target, name: 'Mail <email>' } };
  const change = () => { document.getElementById('go').textContent = 'Mail ada@example.test'; };
  assert.equal((await live(stored, { signedIn: true, change })).ok, true);
  const other = await live({ ...stored, target: { ...stored.target, name: 'Mail someone' } }, { signedIn: true, change });
  assert.deepEqual(other, { ok: false, reason: 'the control changed: name' });
});

test('signed in, a stored <text N> name compares role, kind and css only', T, async () => {
  const row = REVEAL();
  const stored = { ...row, target: { ...row.target, name: '<text 90>' } };
  const change = () => { document.getElementById('go').textContent = 'A much longer label now'; };
  assert.equal((await live(stored, { signedIn: true, change })).ok, true);
  const role = await live(stored, { signedIn: true, change: () => document.getElementById('go').setAttribute('role', 'link') });
  assert.deepEqual(role, { ok: false, reason: 'the control changed: role' });
});
