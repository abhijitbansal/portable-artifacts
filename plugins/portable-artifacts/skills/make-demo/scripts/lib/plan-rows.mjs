// The click plan's rows: demo.json steps joined with scout.json, offline. Pure: no page, no clock, no file.
// A row is one step: { n, useCase, id, do, page, pageId, target, value, intent, effect, reason, box, viaCss }.
//   viaCss  true when the step named its target by css (the plan page then shows the css)
//   page    the address of the page the step is on (a goto: the one it opens); null when the screen is not seen yet
//   target  { role, name, css } of the one control scout saw (a heading has css null), or null
// Where a step is: `goto` sets the page; a look click on a link to a scouted page moves there; a look disclosure, type, select, hover,
// scroll, wait and show stay; a change or danger click, a press, or a goto or link to an unscouted page makes the screen unknown until
// the next goto, and a step with a target there is an error ("not seen yet: use intent"). An intent row has effect change and cannot run.
// Signed in, names and addresses in scout.json are masked, so a click takes the stored effect and a press the stricter of stored and
// recomputed; signed out every effect is computed again from the names and addresses as scout saw them.
import { createHash } from 'node:crypto';
import { agentText } from '../../shared/agent-text.mjs';
import { classify } from './effects.mjs';
import { originsOf } from './spec.mjs';
import { maskedAddress } from './digest.mjs';

/** Fields that hold only words: changing one does not change the hash. Every other field of demo.json is bound by it. */
export const WORD_FIELDS = ['generatedBy', 'useCases[].title', 'useCases[].goal'];

const HASH_CHARS = 12;
const ECHO_MAX = 80;
const RANK = { look: 0, change: 1, danger: 2 };
const NOT_SEEN = 'not seen yet: use intent';
const INTENT_REASON = 'not seen yet, so it cannot run until it names a target';
const STAYS_ON_PAGE = new Set(['type', 'select', 'hover', 'scroll', 'wait', 'show']);

const echo = (text) => `"${agentText(text, { max: ECHO_MAX })}"`;

function withoutHash(address) {
  try {
    const url = new URL(address);
    url.hash = '';
    return url.href;
  } catch {
    return String(address);
  }
}

// ---- the hash --------------------------------------------------------------------------------------------------------------

// JSON with every object's keys sorted, so key order never changes the hash.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v ?? null)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const body = Object.keys(value).filter((k) => value[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`);
    return `{${body.join(',')}}`;
  }
  return JSON.stringify(value);
}

function withoutWords(spec) {
  const { generatedBy, ...rest } = spec;
  if (!Array.isArray(rest.useCases)) return rest;
  return { ...rest, useCases: rest.useCases.map(({ title, goal, ...useCase }) => useCase) };
}

/** First 12 hex characters of SHA-256 over the spec without its word fields, plus every row's id, page address and effect. */
export function planHash(spec, rows) {
  const body = { spec: withoutWords(spec), rows: rows.map((r) => ({ id: r.id, page: r.page, effect: r.effect })) };
  return createHash('sha256').update(canonical(body)).digest('hex').slice(0, HASH_CHARS);
}

// ---- is the scout this demo's ------------------------------------------------------------------------------------------------

function staleErrors(spec, scout) {
  const want = { url: spec.source.url, origins: originsOf(spec), session: spec.session ?? null, named: (spec.pages ?? []).map((p) => new URL(p, spec.source.url).href) };
  const problems = [];
  if (scout?.version !== 1) problems.push('is not a version 1 file');
  for (const [key, label] of [['url', 'url'], ['origins', 'origins'], ['session', 'session'], ['named', 'pages']]) {
    if (JSON.stringify(scout?.[key]) !== JSON.stringify(want[key])) problems.push(`was made for other ${label}`);
  }
  return problems.map((p) => ({ path: 'scout', message: `scout.json ${p}; run scout again` }));
}

const isWall = (page) => page.controls.length === 0 && page.wall !== null;
const wallText = (page) => `page ${page.id} is a wall (${echo(page.wall)})`;

// ---- finding pages and controls ----------------------------------------------------------------------------------------------

function makeWorld(spec, scout) {
  const signedIn = scout.session !== null;
  const key = (address, masked = false) => (signedIn ? (masked ? address : maskedAddress(address)) : withoutHash(address));
  return {
    spec, scout, signedIn, origins: originsOf(spec),
    absolute: (value) => new URL(value, spec.source.url).href,
    /** The one scouted page at this address, or null. `masked`: the address is already origin plus masked path. */
    pageAt(address, masked = false) {
      const wanted = key(address, masked);
      const hits = scout.pages.filter((p) => (signedIn ? p.url : withoutHash(p.url)) === wanted);
      if (hits.length === 0 && !signedIn && key(address) === key(scout.url)) return scout.pages[0] ?? null;
      return hits.length === 1 ? hits[0] : null;
    },
  };
}

const headingAsControl = (h) => ({ id: null, role: 'heading', name: h.name, css: null, box: h.box, kind: 'heading', href: null, newTab: false, download: false, submits: false, formAction: null, formMethod: null, scripted: false, effect: null, reason: null });

function matchesOf(page, target) {
  if (target.css !== undefined) return page.controls.filter((c) => c.css === target.css);
  const found = page.controls.filter((c) => c.role === target.role && c.name === target.name);
  if (target.role !== 'heading') return found;
  return [...found, ...page.headings.filter((h) => h.name === target.name).map(headingAsControl)];
}

const describeTarget = (t) => (t.css !== undefined ? `css ${echo(t.css)}` : `role ${echo(t.role)} and name ${echo(t.name)}`);
const listed = (c) => (c.css === null ? `a heading at y ${c.box.y}` : agentText(c.css, { max: ECHO_MAX }));

/** { control } for exactly one match, else { error } (no match, or several with each css listed). */
function resolveTarget(page, target, at) {
  const hits = matchesOf(page, target);
  if (hits.length === 1) return { control: hits[0] };
  const what = describeTarget(target);
  if (hits.length === 0) {
    const cap = page.left > 0 ? `; ${page.left} controls past the cap were not read` : '';
    return { error: { path: `${at}.target`, message: `no control with ${what} on page ${page.id}${cap}` } };
  }
  return { error: { path: `${at}.target`, message: `${hits.length} controls match ${what} on page ${page.id}; name one with css: ${hits.map(listed).join(' | ')}` } };
}

// ---- effects and transitions -------------------------------------------------------------------------------------------------

const stricter = (a, b) => (RANK[b.effect] > RANK[a.effect] ? b : a);

function effectOf(world, page, step, control) {
  const computed = classify({ do: step.do, control, value: step.value, pageUrl: page.url, origins: world.origins, lang: page.lang });
  if (!world.signedIn || !control?.effect) return computed;
  const stored = { effect: control.effect, reason: control.reason };
  if (step.do === 'click') return stored;
  return step.do === 'press' ? stricter(computed, stored) : computed;
}

/** The page the screen is on after a step: a look click on a link goes to the one scouted page at its address, else it is unknown. */
function nextPage(world, page, step, { effect, control }) {
  if (step.do === 'press') return null;
  if (step.do !== 'click') return page;
  if (effect !== 'look') return null;
  if (control.kind !== 'link') return page;
  return control.href === null ? null : world.pageAt(control.href, world.signedIn);
}

// ---- one step ----------------------------------------------------------------------------------------------------------------

function baseRow(n, useCase, step) {
  return { n, useCase: useCase.id, id: step.id, do: step.do, page: null, pageId: null, target: null, value: step.value ?? null, intent: step.intent ?? null, effect: 'look', reason: '', box: null, viaCss: false };
}

function gotoStep(world, row, step) {
  const address = world.absolute(step.value);
  const page = world.pageAt(address);
  const effect = classify({ do: 'goto', value: address, pageUrl: world.spec.source.url, origins: world.origins });
  const shown = world.signedIn ? maskedAddress(address) : address;
  return { row: { ...row, ...effect, page: page?.url ?? shown, pageId: page?.id ?? null }, page };
}

function intentStep(row, step, page) {
  const stays = step.do !== 'click' && step.do !== 'press' && page !== null;
  return { row: { ...row, effect: 'change', reason: INTENT_REASON, page: page?.url ?? null, pageId: page?.id ?? null }, page: stays ? page : null };
}

function plainStep(world, row, step, page) {
  const effect = effectOf(world, page ?? { url: world.spec.source.url, lang: null }, step, null);
  const here = { page: page?.url ?? null, pageId: page?.id ?? null };
  return { row: { ...row, ...effect, ...here }, page: step.do === 'press' ? null : page };
}

function targetStep(world, row, step, page, at, errors) {
  if (page === null) {
    errors.push({ path: at, message: NOT_SEEN });
    return { page: null };
  }
  if (isWall(page)) {
    errors.push({ path: `${at}.target`, message: `${wallText(page)}, so it has no controls to name` });
    return { page };
  }
  const found = resolveTarget(page, step.target, at);
  if (found.error) {
    errors.push(found.error);
    return { page };
  }
  const { control } = found;
  if (step.do === 'type' && control.kind === 'password') {
    errors.push({ path: `${at}.target`, message: 'typing into a password field is refused: sign in with session.mjs instead' });
    return { page };
  }
  const effect = effectOf(world, page, step, control);
  const target = { role: control.role, name: control.name, css: control.css };
  return {
    row: { ...row, ...effect, page: page.url, pageId: page.id, target, box: control.box, viaCss: step.target.css !== undefined },
    page: nextPage(world, page, step, { effect: effect.effect, control }),
  };
}

function runStep(world, state, step, at, errors) {
  const row = baseRow(state.n, state.useCase, step);
  if (step.do === 'goto') return gotoStep(world, row, step);
  if (step.intent !== undefined) return intentStep(row, step, state.page);
  if (step.target === undefined) return plainStep(world, row, step, state.page);
  return targetStep(world, row, step, state.page, at, errors);
}

function runUseCase(world, useCase, i, first, errors) {
  const rows = [];
  let page = null;
  useCase.steps.forEach((step, j) => {
    const state = { n: first + rows.length, useCase, page };
    const done = runStep(world, state, step, `useCases[${i}].steps[${j}]`, errors);
    if (done.row) rows.push(done.row);
    page = done.page;
  });
  return rows;
}

/**
 * The rows of a demo, the errors that stop a plan (each { path, message }), the warnings and the hash that binds the plan.
 * `spec` is a valid demo.json, `scout` the parsed scout.json. A stale or unusable scout gives errors, no rows and a null hash.
 */
export function planRows(spec, scout) {
  const stale = staleErrors(spec, scout);
  if (stale.length > 0) return { rows: [], errors: stale, warnings: [], hash: null };
  const first = scout.pages[0];
  if (!first || isWall(first)) return { rows: [], errors: [{ path: 'scout.pages[0]', message: first ? `the start ${wallText(first)}; run scout again once it opens` : 'scout.json has no page; run scout again' }], warnings: [], hash: null };
  const world = makeWorld(spec, scout);
  const errors = [];
  const rows = [];
  spec.useCases.forEach((useCase, i) => rows.push(...runUseCase(world, useCase, i, rows.length + 1, errors)));
  const warnings = scout.pages.filter((p) => p.left > 0 && rows.some((r) => r.pageId === p.id)).map((p) => ({ path: `scout.pages[${scout.pages.indexOf(p)}]`, message: `page ${p.id} has ${p.left} controls past the cap that scout did not read` }));
  return { rows, errors, warnings, hash: planHash(spec, rows) };
}
