// A page to its digest: the headings and the controls scout may list, each with its facts and its effect.
// Read-only: one accessibility snapshot, then per control a look at its element (page-facts.mjs). Only `role`, `name`, `ref`, `level`,
// `box` and `children` of a snapshot node are read; `text` is what a field holds (a password too) and is never read.
import { classify } from './effects.mjs';
import { maskText, maskPath } from './mask.mjs';
import { wallProbe, wallReason } from './wall.mjs';
import { readFacts, readDocument, hasVisiblePassword } from './page-facts.mjs';

export const CONTROL_CAP = 400;
const FACT_BATCH = 40;
const SNAPSHOT_TIMEOUT_MS = 10000;

const CONTROL_ROLES = new Set([
  'link', 'button', 'textbox', 'searchbox', 'combobox', 'listbox', 'option', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton',
  'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
]);
// A named element of no listed role is looked at by its tag: a <summary> is a "generic" with a name.
const BY_TAG_ROLE = 'generic';
const TOGGLE_ROLES = new Set(['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio']);
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'spinbutton', 'slider']);
const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image']);

const hasSize = (box) => Boolean(box) && box.width > 0 && box.height > 0;
const round = (n) => Math.round(n);

/**
 * The headings and the control candidates of a snapshot (an array of roots, whose children may be bare strings), in document order.
 * A candidate has a ref and a box with a size; an option inside a closed select has no ref and so is not one. `scrollX` and `scrollY`
 * move the viewport boxes to page coordinates.
 */
export function walkTree(roots, { scrollX = 0, scrollY = 0 } = {}) {
  const headings = [];
  const candidates = [];
  const pageBox = (b) => ({ x: round(b.x + scrollX), y: round(b.y + scrollY), width: round(b.width), height: round(b.height) });
  const visit = (node) => {
    if (node === null || typeof node !== 'object') return;
    const { role, ref, box } = node;
    if (role === 'heading' && typeof node.name === 'string' && node.name !== '' && hasSize(box)) headings.push({ level: node.level ?? 0, name: node.name, box: pageBox(box) });
    const isControl = CONTROL_ROLES.has(role);
    const byTag = role === BY_TAG_ROLE && typeof node.name === 'string' && node.name !== '';
    if (ref && hasSize(box) && (isControl || byTag)) candidates.push({ role, name: node.name ?? '', ref, box: pageBox(box), ...(byTag ? { viaTag: true } : {}) });
    if (role === 'iframe') return; // no descent into a frame: its origin is listed (frameOrigins), what is inside is not
    for (const child of node.children ?? []) visit(child);
  };
  for (const root of Array.isArray(roots) ? roots : [roots]) visit(root);
  return { headings, candidates };
}

// ---- kind ------------------------------------------------------------------------------------------------------------------

// A toggle, select or field, by role and then by tag; null for anything else. Before disclosure: a checkbox, a switch, a select or a
// combobox that carries aria-expanded is still what it is, and a `change`.
function inputKind(node, f) {
  const { role } = node;
  if (TOGGLE_ROLES.has(role)) return 'toggle';
  if (FIELD_ROLES.has(role)) return 'field';
  if (role === 'combobox') return f.tag === 'input' ? 'field' : 'select';
  if (role === 'listbox') return 'select';
  if (role !== BY_TAG_ROLE) return null;
  if (f.tag === 'select') return 'select';
  if (f.tag === 'textarea') return 'field';
  if (f.tag !== 'input' || BUTTON_INPUT_TYPES.has(f.type)) return null;
  return f.type === 'checkbox' || f.type === 'radio' ? 'toggle' : 'field';
}

// What is left once link, password, input and disclosure are ruled out.
function restKind(node, f) {
  if (node.role === BY_TAG_ROLE) {
    if (f.tag === 'a') return 'other';
    return f.tag === 'button' || (f.tag === 'input' && BUTTON_INPUT_TYPES.has(f.type)) ? 'button' : null;
  }
  return node.role === 'button' || node.role === 'menuitem' ? 'button' : 'other'; // option on its own, a link with no usable address
}

/** The control kind of an element, or null when a named element of no listed role turns out not to be one. Order: link, password, input, disclosure, rest. */
function kindOf(node, f) {
  const link = f.tag === 'a' && f.hrefAttr !== null && f.hrefAttr !== '' && f.hrefAttr !== '#' && /^https?:/i.test(f.href ?? '');
  if (link) return 'link';
  if (f.tag === 'input' && f.type === 'password') return 'password';
  const input = inputKind(node, f);
  if (input) return input;
  if (f.tag === 'summary' || node.role === 'tab' || f.expandable) return 'disclosure';
  return restKind(node, f);
}

/** A control from a snapshot node and the facts of its element; null when the element is not a control. */
export function controlOf(node, f) {
  const kind = kindOf(node, f);
  if (kind === null) return null;
  return {
    role: node.role,
    name: node.name ?? '',
    css: f.css,
    box: node.box,
    kind,
    href: f.tag === 'a' ? f.href : null,
    newTab: f.newTab,
    download: f.download,
    submits: f.submits,
    formAction: f.formAction,
    formMethod: f.formMethod,
    scripted: f.scripted,
    ...(f.holdsField ? { holdsField: true } : {}), // its name may carry what a field holds: maskDigest keeps only the length
  };
}

// ---- reading a page --------------------------------------------------------------------------------------------------------

async function factsOf(page, candidate) {
  try {
    return await page.getByRef(candidate.ref).evaluate(readFacts, undefined, { timeout: SNAPSHOT_TIMEOUT_MS });
  } catch {
    return null; // the element went away between the snapshot and now
  }
}

/**
 * The first CONTROL_CAP controls, in batches. `left` counts the listed-role candidates not looked at past the cap, and those whose
 * facts could not be read (gone, or a form that clobbered its own properties): they are not listed, so they are not silently lost.
 */
export async function readControls(page, candidates) {
  const controls = [];
  let unread = 0;
  let next = 0;
  while (next < candidates.length && controls.length < CONTROL_CAP) {
    const batch = candidates.slice(next, next + FACT_BATCH);
    const facts = await Promise.all(batch.map((c) => factsOf(page, c)));
    for (let i = 0; i < batch.length && controls.length < CONTROL_CAP; i += 1) {
      const control = facts[i] ? controlOf(batch[i], facts[i]) : null;
      if (control) controls.push(control);
      else if (!facts[i] && !batch[i].viaTag) unread += 1;
      next += 1;
    }
  }
  return { controls, left: unread + candidates.slice(next).filter((c) => !c.viaTag).length };
}

const originOfFrame = (frame) => {
  try {
    const url = new URL(frame.url());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
};

/** Origins of the child frames (not looked into), once each. */
export const frameOrigins = (page) => [...new Set(page.frames().filter((f) => f !== page.mainFrame()).map(originOfFrame).filter(Boolean))];

/**
 * Read the page as it is: { digest, wall, loginForm }. `digest` has no id, no shot and no counts of what the page did (the walk adds
 * them). `wall` is wallReason's text, which may quote the page: the caller prints it only as a kind when signed in. `loginForm` is
 * true when a password field can be seen. Controls carry their effect, computed from the real names and addresses; masking comes after.
 */
export async function digestPage(page, { origins, statuses = [], requestedUrl }) {
  const roots = await page.ariaSnapshotJSON({ mode: 'ai', boxes: true, timeout: SNAPSHOT_TIMEOUT_MS });
  const doc = await page.evaluate(readDocument);
  const { headings, candidates } = walkTree(roots, doc);
  const { controls, left } = await readControls(page, candidates);
  const title = await page.title();
  const pageUrl = page.url();
  const probe = await page.evaluate(wallProbe);
  const frames = frameOrigins(page);
  const wall = wallReason({ statuses, title, headings: headings.map((h) => h.name), probe, frameUrls: page.frames().map((f) => f.url()), finalUrl: pageUrl, requestedUrl });
  const listed = controls.map((control, i) => ({ id: `c${i + 1}`, ...control, ...classify({ do: 'click', control, pageUrl, origins, lang: doc.lang }) }));
  return {
    digest: { url: pageUrl, lang: doc.lang, title, video: doc.video, frames, headings, controls: listed, left },
    wall,
    loginForm: await page.evaluate(hasVisiblePassword),
  };
}

// ---- signed in -------------------------------------------------------------------------------------------------------------

/** An address as origin and masked path: no query, no hash. A non-http address keeps only its scheme. */
export function maskedAddress(address) {
  if (address === null || address === undefined) return null;
  try {
    const url = new URL(address);
    return url.origin === 'null' ? url.protocol : `${url.origin}${maskPath(url.pathname)}`;
  } catch {
    return null;
  }
}

const NAME_MAX = 60;

/** A name or heading, masked. Over NAME_MAX characters it is body text (a card that is one link), so only its length is kept: `<text N>`. */
export function maskName(text) {
  const masked = [...maskText(text)];
  return masked.length > NAME_MAX ? `<text ${masked.length}>` : masked.join('');
}

/** True when masking the address dropped something: a query, a hash, or an id in the path. Then the stored address is not the real one. */
function addressWasCut(address) {
  try {
    const url = new URL(address);
    return url.search !== '' || url.hash !== '' || maskPath(url.pathname) !== url.pathname;
  } catch {
    return false;
  }
}

/**
 * A signed-in control. Its name is only its length when the element held a field (its accessible name may carry what the field holds)
 * and for every option (a list's options are values). `hrefCut` says the stored address lost a query, a hash or an id.
 */
export function maskControl(control) {
  const { holdsField, ...c } = control;
  const name = (holdsField || c.role === 'option') && c.name !== '' ? `<text ${[...String(c.name)].length}>` : maskName(c.name);
  return { ...c, name, href: maskedAddress(c.href), ...(c.href ? { hrefCut: addressWasCut(c.href) } : {}), formAction: maskedAddress(c.formAction) };
}

/** A signed-in page digest: names and headings masked (long ones reduced to their length), title masked, addresses cut to origin and masked path. A new object. */
export function maskDigest(page) {
  return {
    ...page,
    url: maskedAddress(page.url),
    title: maskName(page.title),
    headings: page.headings.map((h) => ({ ...h, name: maskName(h.name) })),
    controls: page.controls.map(maskControl),
  };
}
