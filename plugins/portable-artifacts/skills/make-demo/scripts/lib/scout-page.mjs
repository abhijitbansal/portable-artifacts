// Read one page of the demo site, read-only, and say whether it is usable. Returns
//   { ok: true, entry, shot, links }   entry is the page of scout.json; shot a JPEG buffer or null; links the raw controls (signed out only)
//   { ok: false, wall, entry }         the page is unusable: `wall` is why, `entry` is its (empty) page of scout.json
// What makes a page unusable: it moved to another origin (left to <origin>), did not load, is a wall (every wallReason but the consent
// notice, which is only noted), or, with a session, asks for a sign-in (not signed in).
// With a session no page text reaches the entry: names, headings and the title are masked, addresses are origin plus masked path, the
// wall is its kind only, and there is no picture.
import { openVisit, listRequests } from './visit.mjs';
import { digestPage, maskDigest, maskedAddress } from './digest.mjs';
import { wallKind, isConsentNote, isSignInRedirect } from './wall.mjs';
import { takeShot } from './shot.mjs';

const GOTO_MS = 30000;
const QUIET_MS = 5000;
const NOT_SIGNED_IN = 'not signed in';

/** `goto`, `load`, then up to QUIET_MS for the network to go quiet. Returns the error code of a failed load, or null. */
async function load(page, url) {
  let failure = null;
  try {
    await page.goto(url, { waitUntil: 'load', timeout: GOTO_MS });
  } catch (error) {
    failure = /net::ERR_[A-Z_]+/.exec(String(error.message))?.[0] ?? (/Timeout/.test(String(error.message)) ? 'timeout' : 'error');
  }
  await page.waitForLoadState('networkidle', { timeout: QUIET_MS }).catch(() => {});
  return failure;
}

/** The origin the page left to (a refused move of its own main frame, or a page that already sits on another origin), or null. A popup's refused move does not count. */
function leftTo(page, seen, origins) {
  const own = seen.refused.filter((r) => r.popup !== true);
  const refused = own.find((r) => !origins.includes(r.origin));
  if (refused) return `left to ${refused.origin}`;
  if (own.length > 0) return `refused a ${own[0].method} move`; // the page tried to post itself away; what is left is an error page
  try {
    const here = new URL(page.url());
    return (here.protocol === 'http:' || here.protocol === 'https:') && !origins.includes(here.origin) ? `left to ${here.origin}` : null;
  } catch {
    return null;
  }
}

function counts(seen) {
  return { requests: listRequests(seen), dialogs: seen.dialogs, popups: seen.popups, downloads: seen.downloads, sockets: seen.sockets, refused: seen.refused, errors: seen.errors };
}

function emptyEntry(id, url, wall, seen, signedIn) {
  return {
    id, url: signedIn ? maskedAddress(url) : url, lang: null, title: '', wall, video: false, shot: null, frames: [], headings: [], controls: [], left: 0, ...counts(seen),
  };
}

/** The reason to stop on a page that did read, or null. Consent is a note, not a stop. */
function verdict(read, { signedIn, hasSession }) {
  if (hasSession && (read.loginForm || isSignInRedirect(read.wall))) return NOT_SIGNED_IN;
  if (read.wall === null || isConsentNote(read.wall)) return null;
  return signedIn ? wallKind(read.wall) : read.wall;
}

/** One page: open a guarded visit, read it, close it. Never throws for the site's own trouble. */
export async function visitPage(browser, { url, origins, viewport, state, signedIn, id }) {
  const { context, page, seen } = await openVisit(browser, { viewport, origins, state });
  try {
    const stopped = (wall, at = url) => ({ ok: false, wall, entry: emptyEntry(id, at, wall, seen, signedIn) });
    const failure = await load(page, url);
    const away = leftTo(page, seen, origins);
    if (away) return stopped(away);
    if (failure) return stopped(`did not load (${failure})`);
    const read = await digestPage(page, { origins, statuses: seen.statuses, requestedUrl: url });
    const lateAway = leftTo(page, seen, origins); // a script that moved the page while it was being read
    if (lateAway) return stopped(lateAway);
    const stop = verdict(read, { signedIn, hasSession: state !== null });
    if (stop) return stopped(stop, read.digest.url);
    return await usable({ id, read, page, seen, viewport, signedIn });
  } finally {
    await context.close().catch(() => {});
  }
}

async function usable({ id, read, page, seen, viewport, signedIn }) {
  const shot = signedIn ? null : await takeShot(page, viewport);
  const note = read.wall === null ? null : signedIn ? wallKind(read.wall) : read.wall; // only the consent notice gets here
  const whole = { id, ...read.digest, wall: note, shot: shot ? `scout/${id}.jpg` : null, ...counts(seen) };
  const entry = signedIn ? maskDigest(whole) : whole;
  return { ok: true, entry, shot, links: signedIn ? [] : read.digest.controls, linkLang: read.digest.lang, linkPage: read.digest.url };
}
