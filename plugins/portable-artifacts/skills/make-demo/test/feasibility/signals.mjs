// What besides the picture says a stepped run differs from real time: the accessible tree of the whole body, the page's errors,
// and whether the page is a wall (a bot check, an error, a sign-in or consent page, an empty page). Pure functions on data.

const TEXT_LIMIT = 200;
const LEFT_OUT_MAX = 0.2;
const SHORT_PAGE_CHARS = 1500;
const EMPTY_PAGE_CHARS = 20;
const WALL_PATTERN = /verify you are human|access denied|captcha|just a moment|enable javascript|are you (a )?(human|robot)|unusual traffic|checking (if|your) (the )?(site )?connection|checking your browser/i;
const CONSENT_PATTERN = /we value your privacy|accept (all )?cookies|cookie (consent|preferences|settings)|your privacy choices|manage (your )?consent/i;
const CHALLENGE_FRAME = /challenges\.cloudflare\.com|hcaptcha\.com|recaptcha|turnstile|arkoselabs|funcaptcha|datadome|perimeterx/i;
const SIGN_IN_PATH = /\/(log-?in|sign-?in|signin|auth|sso|consent|captcha|challenge|verify)(\/|$|\?)/i;
const SKIPPED_KEYS = new Set(['role', 'name', 'text', 'children', 'ref', 'cursor', 'box']);

export { LEFT_OUT_MAX };

const clean = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT);

/** An ariaSnapshotJSON tree as an ordered list of lines: role, name, state flags, address and text, indented by depth. */
export function treeLines(nodes, depth = 0) {
  const lines = [];
  for (const node of nodes ?? []) {
    const flags = Object.keys(node).filter((k) => !SKIPPED_KEYS.has(k)).sort().map((k) => `[${k}=${node[k]}]`).join('');
    const name = node.name === undefined ? '' : ` "${clean(node.name)}"`;
    const text = node.text !== undefined && !node.children ? ` = ${clean(node.text)}` : '';
    lines.push(`${'  '.repeat(depth)}${node.role}${name}${flags}${text}`);
    lines.push(...treeLines(node.children, depth + 1));
  }
  return lines;
}

const countLines = (lines) => lines.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map());

/** Lines of the first run that every run has, in the first run's order, each as often as the run that has it least. */
function stableSequence(reals, counts) {
  const used = new Map();
  return reals[0].filter((line) => {
    const have = used.get(line) ?? 0;
    const keep = have < Math.min(...counts.map((c) => c.get(line) ?? 0));
    if (keep) used.set(line, have + 1);
    return keep;
  });
}

/**
 * The stepped tree against the real-time trees. Lines the real runs do not all share are left out (`leftOutShare` is the
 * worst run's share of them); the rest must be in the stepped tree, in order, and the stepped tree may hold no more
 * unknown lines than the real runs' own variation explains.
 */
export function diffTrees(stepped, reals) {
  const counts = reals.map(countLines);
  const mine = countLines(stepped);
  const sequence = stableSequence(reals, counts);
  const stable = countLines(sequence);
  const differences = [];
  for (const [line, n] of stable) {
    const short = n - (mine.get(line) ?? 0);
    if (short > 0) differences.push(`missing ${short}× ${line.trim()}`);
  }
  let extra = 0;
  for (const [line, n] of mine) {
    const over = n - Math.max(0, ...counts.map((c) => c.get(line) ?? 0));
    if (over > 0) { extra += over; differences.push(`extra ${over}× ${line.trim()}`); }
  }
  const leftOut = reals.map((r, i) => r.length - [...stable].reduce((sum, [line, n]) => sum + Math.min(n, counts[i].get(line) ?? 0), 0));
  const allowed = Math.max(...leftOut);
  const inOrder = stepped.filter((l) => stable.has(l));
  const reordered = differences.length === 0 && inOrder.join('\n') !== sequence.join('\n');
  if (reordered) differences.push('the stable lines are in a different order');
  const leftOutShare = Math.max(...reals.map((r, i) => (r.length === 0 ? 0 : leftOut[i] / r.length)));
  const explained = extra <= allowed && !differences.some((d) => d.startsWith('missing') || d === 'the stable lines are in a different order');
  return { leftOutShare, differences: explained ? [] : differences, variation: differences };
}

/** A page error without its ids and numbers, so the same error twice is one key. */
export function errorKey(kind, message) {
  return `${kind}: ${String(message).replace(/[0-9a-f]{8,}/gi, '#').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT)}`;
}

/** Error keys the stepped run has more often than any real run does: [{ key, stepped, real }]. */
export function newErrors(stepped, reals) {
  const found = [];
  for (const [key, n] of countLines(stepped)) {
    const real = Math.max(0, ...reals.map((r) => countLines(r).get(key) ?? 0));
    if (n > real) found.push({ key, stepped: n, real });
  }
  return found;
}

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
  if (probe?.consentCover) return 'a consent notice covers half the view';
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
