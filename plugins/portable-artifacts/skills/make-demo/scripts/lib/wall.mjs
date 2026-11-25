// Is this page a wall (a bot check, an error, a sign-in or consent page, an empty page)? Moved from test/feasibility/signals.mjs,
// which re-exports both functions; the text and the order of the checks are unchanged. Pure functions on data, except wallProbe,
// which is serialised into the page and so holds nothing from outside itself.

const SHORT_PAGE_CHARS = 1500;
const EMPTY_PAGE_CHARS = 20;
const WALL_PATTERN = /verify you are human|access denied|captcha|just a moment|enable javascript|are you (a )?(human|robot)|unusual traffic|checking (if|your) (the )?(site )?connection|checking your browser/i;
const CONSENT_PATTERN = /we value your privacy|accept (all )?cookies|cookie (consent|preferences|settings)|your privacy choices|manage (your )?consent/i;
const CHALLENGE_FRAME = /challenges\.cloudflare\.com|hcaptcha\.com|recaptcha|turnstile|arkoselabs|funcaptcha|datadome|perimeterx/i;
const SIGN_IN_PATH = /\/(log-?in|sign-?in|signin|auth|sso|consent|captcha|challenge|verify)(\/|$|\?)/i;

/** The reason wallReason gives for a consent notice over half the view: scout takes a note of it and goes on. */
export const CONSENT_COVER_REASON = 'a consent notice covers half the view';

/** What the page says about itself, run in the page: text length and sample, control count, and a consent overlay over half the view. */
export function wallProbe() {
  const text = document.body?.innerText ?? '';
  const view = innerWidth * innerHeight;
  const consent = /we value your privacy|accept (all )?cookies|cookie (consent|preferences|settings)|your privacy choices|manage (your )?consent/i;
  let consentCover = false;
  const candidates = [...document.querySelectorAll('[role=dialog],[role=alertdialog],[aria-modal=true],dialog')];
  for (const element of document.querySelectorAll('body *')) {
    if (candidates.length > 4000) break;
    const position = getComputedStyle(element).position;
    if (position === 'fixed' || position === 'sticky') candidates.push(element);
  }
  for (const element of candidates) {
    const box = element.getBoundingClientRect();
    if (box.width * box.height >= view / 2 && consent.test(element.innerText || '')) { consentCover = true; break; }
  }
  return { textLength: text.length, sample: text.slice(0, 3000), controls: document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link]').length, consentCover };
}

/**
 * Why this page is a wall, or null. `info` is { statuses, title, headings, probe (wallProbe's result), frameUrls, finalUrl,
 * requestedUrl }. A page that holds nothing, answers with an error, asks for a sign-in or consent, or says it is a bot check is.
 */
export function wallReason(info) {
  const bad = (info.statuses ?? []).find((s) => s >= 400);
  if (bad !== undefined) return `status ${bad}`;
  const named = [info.title ?? '', ...(info.headings ?? [])].find((t) => WALL_PATTERN.test(t));
  if (named !== undefined) return `reads like a bot check or wall: "${named.slice(0, 80)}"`;
  const probe = info.probe;
  if (probe && probe.textLength < EMPTY_PAGE_CHARS && probe.controls === 0) return 'the page holds no text and no control';
  if (probe && probe.textLength < SHORT_PAGE_CHARS && (WALL_PATTERN.test(probe.sample) || CONSENT_PATTERN.test(probe.sample))) return 'a short page whose text reads like a bot check or consent wall';
  if (probe?.consentCover) return CONSENT_COVER_REASON;
  const frame = (info.frameUrls ?? []).find((u) => CHALLENGE_FRAME.test(u));
  if (frame !== undefined) return `a challenge frame is on the page (${new URL(frame).host})`;
  return redirectedToSignIn(info.requestedUrl, info.finalUrl);
}

function redirectedToSignIn(requested, final) {
  if (!requested || !final) return null;
  const [a, b] = [new URL(requested), new URL(final)];
  if (SIGN_IN_PATH.test(b.pathname) && !SIGN_IN_PATH.test(a.pathname)) return `redirected to a sign-in or consent address (${b.pathname})`;
  return null;
}

/** A reason without what the page said: the quoted title and the trailing host or path are cut. For a signed-in scout, which prints no page text. */
export function wallKind(reason) {
  if (reason === null || reason === undefined) return null;
  return String(reason).replace(/: ".*"$/s, '').replace(/ \([^)]*\)$/, '');
}

/** True for the consent notice over half the view: scout may not click it away, so it is a note and not a stop. */
export const isConsentNote = (reason) => reason === CONSENT_COVER_REASON;

/** True for the sign-in redirect reason. */
export const isSignInRedirect = (reason) => typeof reason === 'string' && reason.startsWith('redirected to a sign-in or consent address');
