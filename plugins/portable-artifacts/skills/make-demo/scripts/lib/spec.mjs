// demo.json: loading and the layered validation (closed schema, then origins, pages, ids, and what each verb needs).
// Nothing here reads a page: a step is checked against the file alone.
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import { formatAjvErrors, makeResult } from '../../shared/errors.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { agentJson } from '../../shared/agent-text.mjs';
import { SCHEMA, LIMITS } from './schema.mjs';

export { UsageError };

const ajv = new Ajv({ allErrors: true, strict: true, verbose: true, allowUnionTypes: true });
const validateSchema = ajv.compile(SCHEMA);
const ECHO_MAX = 80; // the longest user text an error message echoes (see agent-text.mjs)
const echo = (value) => agentJson(value, { max: ECHO_MAX });

export function loadSpec(file) {
  const abs = path.resolve(file);
  let text;
  try {
    text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    throw new UsageError(`cannot read ${file}: ${e.code ?? e.message}`);
  }
  try {
    return { spec: JSON.parse(text), dir: path.dirname(abs) };
  } catch (e) {
    throw new UsageError(`${file} is not valid JSON: ${e.message}`);
  }
}

function parseHttp(address, base) {
  try {
    const url = new URL(address, base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** True for a bare http(s) origin such as "https://example.test": no path, no trailing slash. */
export const isBareOrigin = (origin) => typeof origin === 'string' && parseHttp(origin)?.origin === origin;

/** The origins the demo may visit: `origins` as written, else the origin of `source.url`; [] when neither is usable. */
export function originsOf(spec) {
  if (Array.isArray(spec?.origins)) return spec.origins.filter((o) => typeof o === 'string');
  const own = typeof spec?.source?.url === 'string' ? parseHttp(spec.source.url) : null;
  return own ? [own.origin] : [];
}

// An address (absolute, or a path on the start URL) that must sit on an allowed origin.
function insideOrigins(address, spec) {
  const url = typeof address === 'string' ? parseHttp(address, spec.source.url) : null;
  return url !== null && originsOf(spec).includes(url.origin);
}

function checkOrigins(errors, spec) {
  const own = parseHttp(spec.source.url);
  if (!own) errors.push({ path: 'source.url', message: `must be an http or https address, got ${echo(spec.source.url)}` });
  (spec.origins ?? []).forEach((origin, i) => {
    if (!isBareOrigin(origin)) errors.push({ path: `origins[${i}]`, message: `must be a bare http or https origin such as "https://example.test" (no path, no trailing slash), got ${echo(origin)}` });
  });
  if (own && !originsOf(spec).includes(own.origin)) errors.push({ path: 'origins', message: `must include the origin of source.url, ${own.origin}` });
}

function checkPages(errors, spec) {
  (spec.pages ?? []).forEach((page, i) => {
    if (!insideOrigins(page, spec)) errors.push({ path: `pages[${i}]`, message: `${echo(page)} is not on an allowed origin; allowed: ${originsOf(spec).join(', ')}` });
  });
}

// ---- steps -----------------------------------------------------------------------------------------------------------

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isText = (v) => typeof v === 'string' && v.length > 0;

// What each verb needs of target, value and intent. `at` is the step's path.
const NEEDS = {
  goto: (step, at, errors, spec) => {
    if (!isText(step.value)) errors.push({ path: `${at}.value`, message: 'goto needs a value: an address or a path on an allowed origin' });
    else if (!insideOrigins(step.value, spec)) errors.push({ path: `${at}.value`, message: `${echo(step.value)} is not on an allowed origin; allowed: ${originsOf(spec).join(', ')}` });
  },
  click: (step, at, errors) => needTargetOrIntent(step, at, errors),
  hover: (step, at, errors) => needTargetOrIntent(step, at, errors),
  show: (step, at, errors) => needTargetOrIntent(step, at, errors),
  type: (step, at, errors) => needTargetAndValue(step, at, errors),
  select: (step, at, errors) => needTargetAndValue(step, at, errors),
  press: (step, at, errors) => {
    if (!isText(step.value)) errors.push({ path: `${at}.value`, message: 'press needs a value: the key, such as "Enter"' });
  },
  scroll: (step, at, errors) => {
    if (step.value !== undefined && !isNumber(step.value)) errors.push({ path: `${at}.value`, message: 'scroll takes a number of pixels' });
    else if (step.target === undefined && step.value === undefined) errors.push({ path: at, message: 'scroll needs a target, or a value in pixels' });
  },
  wait: (step, at, errors) => {
    const [min, max] = LIMITS.waitSeconds;
    if (!isNumber(step.value) || step.value < min || step.value > max) errors.push({ path: `${at}.value`, message: `wait needs a value in seconds, ${min} to ${max}` });
  },
};

function needTargetOrIntent(step, at, errors) {
  if (step.target === undefined && step.intent === undefined) errors.push({ path: at, message: `${step.do} needs a target, or an intent for a screen not seen yet` });
}

function needTargetAndValue(step, at, errors) {
  if (step.intent !== undefined) return;
  if (step.target === undefined) errors.push({ path: `${at}.target`, message: `${step.do} needs a target (or an intent alone)` });
  if (!isText(step.value)) errors.push({ path: `${at}.value`, message: `${step.do} needs a value (or an intent alone)` });
}

function checkStep(errors, spec, step, at) {
  if (step.intent !== undefined && (step.target !== undefined || step.value !== undefined)) {
    errors.push({ path: `${at}.intent`, message: 'an intent stands alone: remove the target and the value, or remove the intent' });
    return;
  }
  if (Object.hasOwn(NEEDS, step.do)) NEEDS[step.do](step, at, errors, spec);
}

function checkUseCases(errors, spec) {
  const seen = new Set();
  const claim = (id, at) => {
    if (seen.has(id)) errors.push({ path: at, message: `the id ${echo(id)} is used twice; ids are unique across the file` });
    seen.add(id);
  };
  spec.useCases.forEach((useCase, i) => {
    const base = `useCases[${i}]`;
    claim(useCase.id, `${base}.id`);
    useCase.steps.forEach((step, j) => {
      const at = `${base}.steps[${j}]`;
      claim(step.id, `${at}.id`);
      if (j === 0 && step.do !== 'goto') errors.push({ path: at, message: 'each use case starts with a goto' });
      checkStep(errors, spec, step, at);
    });
  });
}

/**
 * Validate a parsed demo.json. Returns { ok, errors: [{ path, message }] }, plus `warnings` when there are any.
 * Never throws on bad input: a spec that is not an object is a list of errors.
 */
export function validateSpec(spec) {
  if (!validateSchema(spec)) return makeResult(formatAjvErrors(validateSchema.errors));
  const errors = [];
  checkOrigins(errors, spec);
  checkPages(errors, spec);
  checkUseCases(errors, spec);
  return makeResult(errors);
}
