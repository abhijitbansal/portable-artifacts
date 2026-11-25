// The pictures of a signed-out click plan: scout's picture of each page with a numbered box on every control a row uses, written to
// click-plan/<page id>.jpg beside demo.json (under 1.4 MB; make-explainer takes 1.5). The drawing page has every request aborted and loads
// the picture as a data URL, so nothing leaves the machine. A signed-in plan has no picture, and then no browser is started.
// A control below the 4,000 px cut of the picture has no box; its row says so (plan-page.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, liveBrowsers } from './browser.mjs';
import { UsageError } from './spec.mjs';
import { MAX_HEIGHT, MAX_BYTES, QUALITIES } from './shot.mjs';

const OLD_PICTURE = /^p\d+\.jpg$/;
const SCOUT_PICTURE = /^scout\/p\d+\.jpg$/;
const RANK = { look: 0, change: 1, danger: 2 };
const COLORS = { look: '#1f6feb', change: '#d98a00', danger: '#c62828' };
const DRAW_VIEWPORT = { width: 1280, height: 720 };
const BADGE_HEIGHT = 20;
const DECODE_MS = 10000;

/** The boxes to draw on one page: one per control, numbered by every row on it, in the strictest effect. Rows below the cut have none. */
export function boxesOf(rows, pageId) {
  const merged = new Map();
  for (const row of rows) {
    if (row.pageId !== pageId || row.box === null || row.box.y >= MAX_HEIGHT) continue;
    const key = `${row.box.x},${row.box.y},${row.box.width},${row.box.height}`;
    const hit = merged.get(key) ?? { box: row.box, numbers: [], effect: row.effect };
    hit.numbers.push(row.n);
    if (RANK[row.effect] > RANK[hit.effect]) hit.effect = row.effect;
    merged.set(key, hit);
  }
  return [...merged.values()];
}

function overlay({ box, numbers, effect }) {
  const color = COLORS[effect];
  const above = box.y >= BADGE_HEIGHT;
  return `<div style="position:absolute;box-sizing:border-box;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;outline:3px solid ${color};outline-offset:0">`
    + `<span style="position:absolute;left:-3px;${above ? `top:-${BADGE_HEIGHT + 3}px` : 'top:0'};background:${color};color:#fff;font:700 14px/${BADGE_HEIGHT - 4}px system-ui,sans-serif;padding:2px 6px;white-space:nowrap">${numbers.join(', ')}</span></div>`;
}

const documentOf = (bytes, boxes) => `<!doctype html><body style="margin:0;background:#fff"><div id="wrap" style="position:relative;display:block;width:max-content;overflow:hidden">`
  + `<img id="pic" alt="" src="data:image/jpeg;base64,${bytes.toString('base64')}" style="display:block;max-width:none">${boxes.map(overlay).join('')}</div>`;

async function draw(browser, bytes, boxes) {
  const context = await browser.newContext({ viewport: DRAW_VIEWPORT });
  try {
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent(documentOf(bytes, boxes));
    await page.evaluate((ms) => Promise.race([document.getElementById('pic').decode(), new Promise((_, reject) => setTimeout(() => reject(new Error('the picture did not decode')), ms))]), DECODE_MS);
    const size = await page.evaluate(() => { const r = document.getElementById('wrap').getBoundingClientRect(); return { width: Math.ceil(r.width), height: Math.ceil(r.height) }; });
    await page.setViewportSize(size);
    let picture = null;
    for (const quality of QUALITIES) {
      picture = await page.screenshot({ type: 'jpeg', quality, fullPage: true });
      if (picture.length < MAX_BYTES) break;
    }
    return picture;
  } finally {
    await context.close().catch(() => {});
  }
}

function removeOld(folder) {
  if (!fs.existsSync(folder)) return;
  for (const name of fs.readdirSync(folder)) if (OLD_PICTURE.test(name)) fs.rmSync(path.join(folder, name));
}

/**
 * Write click-plan/<id>.jpg beside demo.json (`dir`) for every scouted page that has a picture and a row with a box. Returns a Map of
 * page id to the path of its picture relative to `dir`. Old click-plan/p*.jpg go first. Signed in, or nothing to draw: no browser.
 * Another headless browser live is a UsageError (the machine wedges on many).
 */
export async function markShots(scout, rows, dir, { launch = launchBrowser, live = liveBrowsers } = {}) {
  const folder = path.join(dir, 'click-plan');
  removeOld(folder);
  const shown = new Map();
  if (scout.session !== null) return shown;
  const todo = scout.pages.filter((p) => SCOUT_PICTURE.test(p.shot ?? '') && fs.existsSync(path.join(dir, p.shot)) && boxesOf(rows, p.id).length > 0);
  if (todo.length === 0) return shown;
  if (live().length > 0) throw new UsageError('another headless browser is running (pgrep -fl chrome-headless-shell); wait for it to end, then build again');
  const browser = await launch();
  try {
    fs.mkdirSync(folder, { recursive: true });
    for (const page of todo) {
      const picture = await draw(browser, fs.readFileSync(path.join(dir, page.shot)), boxesOf(rows, page.id));
      fs.writeFileSync(path.join(folder, `${page.id}.jpg`), picture);
      shown.set(page.id, `click-plan/${page.id}.jpg`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return shown;
}
