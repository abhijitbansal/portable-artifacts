import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startLiveServer } from '../scripts/lib/live.mjs';
import { launchBrowser, haveBrowser } from './helpers/browser.mjs';
import { request, until } from './helpers/live-harness.mjs';

// Cut only the event connection while the page stays open. Browser offline mode does not reliably
// terminate an established SSE socket; this proxy exercises native EventSource retry after a real close.
async function eventProxy(url) {
  let disconnected = false;
  let blockedRequests = 0;
  const streams = new Set();
  const pending = new Map();
  const forward = (req, res) => {
    const events = req.url === '/events';
    const upstream = http.request(new URL(req.url, url), { method: req.method, headers: { ...req.headers, host: new URL(url).host } }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on('error', () => { if (!res.destroyed) res.destroy(); });
    res.on('close', () => { streams.delete(res); upstream.destroy(); });
    if (events) streams.add(res);
    req.pipe(upstream);
  };
  const server = http.createServer((req, res) => {
    if (req.url === '/events' && disconnected) {
      blockedRequests++;
      // A non-200 response permanently closes EventSource. Keep retries pending until recovery.
      pending.set(res, req);
      res.once('close', () => pending.delete(res));
    } else forward(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    get blockedRequests() { return blockedRequests; },
    disconnect: () => { disconnected = true; for (const res of streams) res.destroy(); },
    reconnect: () => {
      disconnected = false;
      for (const [res, req] of pending) {
        pending.delete(res);
        if (!res.destroyed) forward(req, res);
      }
    },
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}

test('an offline viewer catches up after missing a successful assertion recovery', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-live-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'dashboard.json');
  const csv = path.join(dir, 'sales.csv');
  const target = path.join(dir, 'dist/index.html');
  const spec = {
    title: 'Sales', sources: { sales: { type: 'csv', path: 'sales.csv' } },
    queries: { q: 'SELECT * FROM sales' },
    charts: [{ id: 'revenue', title: 'East leads', query: 'q', kind: 'bar', x: 'region', y: 'revenue', assert: { type: 'max', category: 'East' } }],
  };
  fs.writeFileSync(file, JSON.stringify(spec));
  fs.writeFileSync(csv, 'region,revenue\nEast,90\nWest,10\n');
  // Explicit rebuilds make the disconnect/recovery sequence independent of file-watcher timing.
  const live = await startLiveServer({ specFile: file, watch: () => ({ close() {} }) });
  assert.equal(live.ok, true);
  t.after(() => live.close());
  const proxy = await eventProxy(live.url);
  t.after(() => proxy.close());
  let browser;
  try {
    browser = await launchBrowser();
    const context = await browser.newContext();
    await context.addInitScript(() => {
      window.EventSource = class extends EventSource {
        constructor(url) {
          super(url);
          this.addEventListener('revision', () => { window.revisionSeen = (window.revisionSeen || 0) + 1; });
        }
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const rebuild = () => request(Number(new URL(live.url).port), { method: 'POST', path: '/rebuild', headers: { 'x-pa-token': live.token } });
    await page.goto(proxy.url);
    await page.waitForFunction(() => window.paReady === true);
    await page.evaluate(() => { window.originalPage = true; });
    const good = fs.readFileSync(target, 'utf8');
    fs.writeFileSync(csv, 'region,revenue\nEast,10\nWest,90\n');
    await rebuild();
    await page.waitForFunction(() => document.querySelector('#pa-live-banner')?.textContent.includes('West'));
    assert.equal(fs.readFileSync(target, 'utf8'), good);
    assert.equal(await page.evaluate(() => window.originalPage), true, 'an error keeps the displayed page');
    proxy.disconnect();
    await page.waitForFunction(() => document.querySelector('#pa-live-badge')?.textContent.includes('disconnected'));
    spec.charts[0].title = 'West leads';
    spec.charts[0].assert.category = 'West';
    fs.writeFileSync(file, JSON.stringify(spec));
    await rebuild();
    await until(() => fs.readFileSync(target, 'utf8').includes('West leads'), { label: 'recovery while the viewer is offline' });
    assert.equal(await page.locator('.card h2').innerText(), 'East leads');
    await until(() => proxy.blockedRequests > 0, { ms: 10000, label: 'a native retry while disconnected' });
    proxy.reconnect();
    await page.waitForFunction(() => window.paReady === true && document.querySelector('.card h2')?.textContent === 'West leads', null, { timeout: 10000 });
    assert.equal(await page.locator('#pa-live-banner').isHidden(), true);
    await page.waitForFunction(() => window.revisionSeen === 1);
    await page.evaluate(() => { window.recoveredPage = true; });
    // Reconnecting an already-current page must not cause a reload loop.
    proxy.disconnect();
    await page.waitForFunction(() => document.querySelector('#pa-live-badge')?.textContent.includes('disconnected'));
    proxy.reconnect();
    await page.waitForFunction(() => window.revisionSeen === 2 && document.querySelector('#pa-live-badge')?.textContent.includes('reconnected'));
    assert.equal(await page.evaluate(() => window.recoveredPage), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
  }
});
