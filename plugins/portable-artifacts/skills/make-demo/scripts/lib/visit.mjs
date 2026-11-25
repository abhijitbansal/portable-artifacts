// A guarded, read-only visit: one fresh browser context for one page.
//   - Service workers are blocked, downloads refused, permissions none, dialogs dismissed, popups closed (each counted).
//   - A navigation of a page's main frame that leaves `origins`, or is not a GET, is aborted before it is sent, and written to `refused`.
//     That covers a script that moves the page, a link and a form submitted by script. A server redirect is not covered: its GET goes out
//     before it can be refused (scout-page.mjs then takes no digest; a test pins this).
//     A popup's navigation is refused the same way and listed with `popup: true`; it does not make the visit page unusable.
//   - The page's own requests run, as they do for any visitor. Those that are not GET, HEAD or OPTIONS (a fetch, a beacon, an XHR) are
//     listed: { method, origin, path (masked), count }. No query, no body, no header is kept.
//   - Page errors and console errors are counted, never read. WebSockets are counted, not blocked.
// Nothing here clicks, types, scrolls or focuses.
import { maskPath } from './mask.mjs';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** A fresh record of what the page did on its own. `statuses` are the answers to its main-frame navigations. */
export const newSeen = () => ({ dialogs: 0, popups: 0, downloads: 0, sockets: 0, errors: 0, refused: [], statuses: [], writes: new Map() });

/** The non-GET requests as a sorted list of { method, origin, path, count }. */
export function listRequests(seen) {
  return [...seen.writes.values()].sort((a, b) => `${a.method} ${a.origin} ${a.path}`.localeCompare(`${b.method} ${b.origin} ${b.path}`));
}

function addWrite(seen, method, url) {
  const origin = url.origin;
  const pathText = maskPath(url.pathname);
  const key = `${method} ${origin}${pathText}`;
  const entry = seen.writes.get(key) ?? { method, origin, path: pathText, count: 0 };
  seen.writes.set(key, { ...entry, count: entry.count + 1 });
}

/**
 * 'own' for a navigation of the main frame of the visit page, 'popup' for one of a popup's main frame (a request made before its frame
 * exists, a popup's first, is one), null for anything else. `own` is the visit page.
 */
function mainNavigation(request, own) {
  if (!request.isNavigationRequest()) return null;
  let frame;
  try {
    frame = request.frame();
  } catch (error) {
    if (/not available/.test(error.message)) return 'popup';
    throw error;
  }
  if (frame.parentFrame() !== null) return null;
  return frame === own.page?.mainFrame() ? 'own' : 'popup';
}

async function decide(route, { origins, seen, own }) {
  const request = route.request();
  const method = request.method();
  const url = new URL(request.url());
  const navigation = mainNavigation(request, own);
  if (navigation !== null && (!origins.includes(url.origin) || method !== 'GET')) {
    seen.refused.push({ method, origin: url.origin, path: maskPath(url.pathname), ...(navigation === 'popup' ? { popup: true } : {}) });
    return route.abort('blockedbyclient');
  }
  if (!SAFE_METHODS.has(method)) addWrite(seen, method, url);
  return route.continue();
}

function watchPage(page, seen) {
  page.on('dialog', (dialog) => {
    seen.dialogs += 1;
    dialog.dismiss().catch(() => {});
  });
  page.on('download', () => { seen.downloads += 1; });
  page.on('websocket', () => { seen.sockets += 1; });
  page.on('pageerror', () => { seen.errors += 1; });
  page.on('console', (message) => { if (message.type() === 'error') seen.errors += 1; });
}

/**
 * Open a guarded context and its page. `state` is a stored sign-in (storageState) or null. The caller closes `context`.
 * Origins are bare origins; `viewport` is { width, height }.
 */
export async function openVisit(browser, { viewport, origins, state = null }) {
  const context = await browser.newContext({ viewport, storageState: state ?? undefined, serviceWorkers: 'block', acceptDownloads: false, permissions: [] });
  const seen = newSeen();
  const own = { page: null }; // the route is set before the page exists
  try {
    await context.route('**/*', (route) => decide(route, { origins, seen, own }).catch(() => {}));
    const page = await context.newPage();
    own.page = page;
    watchPage(page, seen);
    page.on('response', (response) => {
      const request = response.request();
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) seen.statuses.push(response.status());
    });
    context.on('page', (popup) => {
      if (popup === page) return;
      seen.popups += 1;
      watchPage(popup, seen);
      popup.close().catch(() => {});
    });
    return { context, page, seen };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}
