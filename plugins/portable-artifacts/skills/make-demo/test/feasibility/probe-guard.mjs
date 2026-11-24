// What the probe claims: it visits named, signed-out sites in a fresh browser and scrolls and hovers. While the page loads, its
// own requests run (many apps are blank without them). From `goto` returning, whatever the step, in every page of the context
// (popups too): the explicit writes the browser lets it see (POST, PUT, PATCH, DELETE, form submits, beacons) are aborted, a
// top-level navigation is aborted, a new WebSocket is closed. The reads a scroll or hover causes are let through and listed
// (`readsAfterLoad`). Service workers are blocked, downloads refused, permissions none, popups closed and counted.
// It claims no more: workers, WebRTC, WebTransport, fetchLater and sockets opened during load are the site's own, as for any visitor.

export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const newTraffic = () => ({
  writesAtLoad: [], // { method, path }: the page's own writes during load, sent
  readsAfterLoad: [], // { method, path }: reads a scroll or hover caused, let through after load
  blocked: [], // { kind: 'write' | 'navigation' | 'websocket', method, path, sameOrigin }: aborted after load
  websocketsAtLoad: 0,
  popups: 0,
  downloads: 0,
  serviceWorkers: 'blocked', // the site differs from what a visitor gets when it relies on one
});

const pathOf = (url) => { const u = new URL(url); return `${u.pathname}${u.search ? '?…' : ''}`; };
// The host, not the origin: a WebSocket to the site is ws://host and the site is http://host.
const hostOf = (url) => new URL(url).host;

function blockedEntry(run, kind, method, url) {
  return { kind, method, path: pathOf(url), host: hostOf(url), sameOrigin: hostOf(url) === hostOf(run.origin) };
}

/** A navigation of the page's main frame. A request made before its frame exists (a popup's first) is one too. */
function isTopLevelNavigation(request) {
  if (!request.isNavigationRequest()) return false;
  try {
    return request.frame().parentFrame() === null;
  } catch (error) {
    if (/not available/.test(error.message)) return true;
    throw error;
  }
}

async function routeRequest(run, route) {
  const request = route.request();
  const method = request.method();
  if (run.phase === 'load') {
    if (!SAFE_METHODS.has(method)) run.traffic.writesAtLoad.push({ method, path: pathOf(request.url()) });
    return route.continue();
  }
  const kind = isTopLevelNavigation(request) ? 'navigation' : (SAFE_METHODS.has(method) ? null : 'write');
  if (kind === null) {
    run.traffic.readsAfterLoad.push({ method, path: pathOf(request.url()) });
    return route.continue();
  }
  run.traffic.blocked.push(blockedEntry(run, kind, method, request.url()));
  return route.abort('blockedbyclient');
}

function routeSocket(run, ws) {
  if (run.phase === 'load') {
    run.traffic.websocketsAtLoad += 1;
    return ws.connectToServer();
  }
  run.traffic.blocked.push(blockedEntry(run, 'websocket', 'GET', ws.url()));
  return ws.close();
}

/** A context with the safety rules on, and the `run` record they write to. `origin` is the site's own. */
export async function openGuardedContext(browser, { origin, viewport, deviceScaleFactor }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor, serviceWorkers: 'block', acceptDownloads: false, permissions: [] });
  const run = { phase: 'load', origin, traffic: newTraffic(), warnings: [] };
  await context.route('**/*', (route) => routeRequest(run, route));
  await context.routeWebSocket(/.*/, (ws) => routeSocket(run, ws));
  return { context, run };
}

/** Count and close every page but `main`, and count downloads (refused by the context). Call once `main` exists. */
export function watchPages(context, run, main) {
  const countDownloads = (page) => page.on('download', () => { run.traffic.downloads += 1; });
  countDownloads(main);
  context.on('page', async (page) => {
    if (page === main) return;
    run.traffic.popups += 1;
    countDownloads(page);
    try {
      await page.close();
    } catch (error) {
      run.warnings.push(`could not close a popup: ${error.message}`);
    }
  });
}

/** The page has loaded: from here, only reads. */
export function endLoad(run) {
  run.phase = 'after';
}

/** Blocked requests to the site's own origin: the picture may show a state the real site does not. */
export const ownOriginBlocks = (traffic) => traffic.blocked.filter((b) => b.sameOrigin);

/** Blocked writes and sockets to another host: a note in `why`, once each, not a reason to doubt the site. */
export function otherHostNotes(traffics) {
  const seen = new Set(traffics.flatMap((t) => t.blocked.filter((b) => !b.sameOrigin).map((b) => `blocked, to another host: ${b.kind} ${b.method} ${b.path} (${b.host})`)));
  return [...seen];
}
