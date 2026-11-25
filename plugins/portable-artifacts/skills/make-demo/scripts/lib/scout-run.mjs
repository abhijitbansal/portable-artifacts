// The scout walk: the start URL, then the named `pages`, then plain links, breadth first, 6 pages in all (a page that cannot be used
// counts). Nothing is clicked, typed or submitted; a link is followed only when `isFollowable` says it is a look without a query
// (effects.mjs). With a session (`state`) only the start URL and the named pages are opened, and links are not listed one by one.
//
// A page that cannot be used is a page of scout.json with an empty `controls` and its reason in `wall`: `left to <origin>` (a redirect
// or a script moved it to another origin: no digest of that site, and the request to it was refused before it was sent unless the
// server redirected, see the tests), `did not load (<code>)`, `could not be read (<error name>)`, a wall reason, or `not signed in`.
// The first page unusable stops the scout (`{ ok: false, reason }`, nothing written); a later one is listed and the walk goes on.
// `skipped` lists links not followed, by reason. Each page opened for the start URL or a named page records `fromEntry`, its index in
// [start URL, ...named pages]: a number, never an address, so a signed-in plan can say which page a `goto` opened (plan-rows.mjs).
// A hash that starts `#/` or `#!` is a route of its own page; a link to one is the same document and is not followed (page-identity.mjs).
import { classify, isFollowable, hasQuery } from './effects.mjs';
import { originsOf } from './spec.mjs';
import { visitPage } from './scout-page.mjs';
import { steppedLoad, mergeSteppedSeen } from './scout-stepped.mjs';
import { documentOf, pageIdentity } from './page-identity.mjs';

export { writeScout } from './scout-write.mjs';

const MAX_PAGES = 6;
const SKIPPED_MAX = 100;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

/** The start URL and the named pages as { url, entry } (entry: the index in [start, ...named]); a named page with a danger word is left out and listed as skipped. */
function startQueue(spec, origins) {
  const start = spec.source.url;
  const queue = [{ url: start, entry: 0 }];
  const skipped = [];
  (spec.pages ?? []).forEach((named, i) => {
    const url = new URL(named, start).href;
    const effect = classify({ do: 'goto', value: url, pageUrl: start, origins });
    if (effect.effect === 'danger') skipped.push({ name: 'named page', url, reason: `danger: ${effect.reason}` });
    else if (!queue.some((q) => pageIdentity(q.url) === pageIdentity(url))) queue.push({ url, entry: i + 1 });
  });
  return { queue, skipped };
}

/** Sort the links of a read page: those to follow, and those skipped with a reason. A link to the same document is neither. */
function sortLinks({ links, linkLang, linkPage }, origins) {
  const follow = [];
  const skipped = [];
  for (const control of links.filter((c) => c.kind === 'link')) {
    const ctx = { pageUrl: linkPage, origins, lang: linkLang };
    if (control.effect !== 'look') skipped.push({ name: control.name, url: control.href, reason: `${control.effect}: ${control.reason}` });
    else if (isFollowable(control, ctx)) follow.push(control.href);
    else if (documentOf(control.href) !== documentOf(linkPage)) {
      const why = hasQuery(control, linkPage) ? 'look: the address has a query, so it may do something on GET; not followed' : 'look: on another origin of the demo, not followed';
      skipped.push({ name: control.name, url: control.href, reason: why });
    }
  }
  return { follow, skipped };
}

function addSkipped(list, more) {
  for (const entry of more) if (list.length < SKIPPED_MAX && !list.some((e) => e.url === entry.url)) list.push(entry);
}

async function walk(options, queue, skipped) {
  const { origins, signedIn } = options;
  const pages = [];
  const shots = new Map();
  const queued = new Set(queue.map((q) => pageIdentity(q.url)));
  for (let i = 0; i < queue.length && pages.length < MAX_PAGES; i += 1) {
    const id = `p${pages.length + 1}`;
    const result = await visitPage(options.browser, { ...options, url: queue[i].url, id });
    if (!result.ok && pages.length === 0) return { stop: `the start page: ${result.wall}` };
    pages.push({ ...result.entry, ...(queue[i].entry === null ? {} : { fromEntry: queue[i].entry }) });
    if (!result.ok) continue;
    if (result.shot) shots.set(id, result.shot);
    if (signedIn) continue;
    const sorted = sortLinks(result, origins);
    addSkipped(skipped, sorted.skipped);
    for (const href of sorted.follow) {
      if (!queued.has(pageIdentity(href))) {
        queued.add(pageIdentity(href));
        queue.push({ url: href, entry: null });
      }
    }
  }
  return { pages, shots };
}

/**
 * Scout a demo. `spec` is a valid demo.json; `state` a stored sign-in or null. Returns { ok: true, scout, shots } or { ok: false, reason }.
 * Writes nothing: the caller writes (writeScout) when ok.
 */
export async function runScout({ browser, spec, state = null, now = () => new Date() }) {
  const origins = originsOf(spec);
  const options = { browser, origins, viewport: spec.viewport ?? DEFAULT_VIEWPORT, state, signedIn: state !== null };
  const { queue, skipped } = startQueue(spec, origins);
  const walked = await walk(options, queue, skipped);
  if (walked.stop) return { ok: false, reason: walked.stop };
  const { stepped, seen } = await steppedLoad(browser, { ...options, url: spec.source.url });
  const scout = {
    version: 1,
    url: spec.source.url,
    origins,
    session: spec.session ?? null,
    named: (spec.pages ?? []).map((p) => new URL(p, spec.source.url).href),
    scoutedAt: now().toISOString(),
    stepped,
    pages: [mergeSteppedSeen(walked.pages[0], seen), ...walked.pages.slice(1)],
    skipped,
  };
  return { ok: true, scout, shots: walked.shots };
}
