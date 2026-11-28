// demo.json: the closed ajv schema (additionalProperties false everywhere) and the limits the semantic checks in spec.mjs use.
import { GENERATED_BY_SCHEMA } from '../../shared/provenance.mjs';

export const RIGHTS = ['own', 'permitted', 'third-party'];
export const VERBS = ['goto', 'click', 'hover', 'show', 'type', 'select', 'press', 'scroll', 'wait'];

export const LIMITS = {
  origins: 5, pages: 5, useCases: 5, steps: 20, mask: 20,
  viewportWidth: [320, 1920], viewportHeight: [320, 1200],
  waitSeconds: [0.1, 10],
  typedValue: 300, // characters in a `type` or `select` value: the plan page shows it whole
  defaultViewport: { width: 1280, height: 720 },
  hook: 120, facts: 3, factText: 80, ask: 60, say: 120, brandName: 40, // characters, or a count for facts
};

export const LOOKS = ['keynote', 'desk'];
export const DEFAULT_LOOK = 'keynote';
export const ACCENT_PATTERN = '^#[0-9a-f]{6}$';

export const ID_PATTERN = '^[a-z][a-z0-9-]{0,40}$';
export const SESSION_PATTERN = '^[a-z0-9][a-z0-9-]{0,40}$';

const word = { type: 'string', minLength: 1 };
const id = { type: 'string', pattern: ID_PATTERN, description: 'lower-case letters, digits and hyphens, starting with a letter, up to 41 characters' };

// A control named as the digest lists it ({ role, name }) or by a css selector copied from the digest.
const TARGET_SCHEMA = {
  anyOf: [
    { type: 'object', additionalProperties: false, required: ['role', 'name'], properties: { role: word, name: word } },
    { type: 'object', additionalProperties: false, required: ['css'], properties: { css: word } },
  ],
};

const STEP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'do'],
  properties: {
    id,
    do: { enum: VERBS },
    target: TARGET_SCHEMA,
    value: { type: ['string', 'number'] },
    intent: word,
  },
};

const USE_CASE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'steps'],
  properties: {
    id,
    title: word,
    goal: word,
    steps: { type: 'array', minItems: 1, maxItems: LIMITS.steps, items: STEP_SCHEMA },
  },
};

const text = (max) => ({ type: 'string', minLength: 1, maxLength: max });

// A fact for the film's opening: its words, an optional number to show big, and where it came from (the user, or a page of the site).
const FACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'from'],
  properties: {
    text: text(LIMITS.factText),
    value: { type: 'number' },
    from: { type: 'string', pattern: '^(user|https?://.+)$', description: '"user", or an http or https address on an allowed origin' },
  },
};

const OPENING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hook'],
  properties: {
    hook: text(LIMITS.hook),
    facts: { type: 'array', minItems: 1, maxItems: LIMITS.facts, items: FACT_SCHEMA },
  },
};

const ENDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['ask'],
  properties: { ask: text(LIMITS.ask), say: text(LIMITS.say) },
};

const BRAND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: text(LIMITS.brandName),
    accent: { type: 'string', pattern: ACCENT_PATTERN, description: 'six lower-case hex digits after #' },
  },
};

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'source', 'rights', 'useCases'],
  properties: {
    version: { const: 1 },
    source: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: word } },
    origins: { type: 'array', minItems: 1, maxItems: LIMITS.origins, items: word },
    rights: { enum: RIGHTS },
    viewport: {
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height'],
      properties: {
        width: { type: 'integer', minimum: LIMITS.viewportWidth[0], maximum: LIMITS.viewportWidth[1] },
        height: { type: 'integer', minimum: LIMITS.viewportHeight[0], maximum: LIMITS.viewportHeight[1] },
      },
    },
    mask: { type: 'array', maxItems: LIMITS.mask, items: TARGET_SCHEMA, description: 'targets hidden in every picture of a take (and in scout\'s signed-out pictures)' },
    session: { type: 'string', pattern: SESSION_PATTERN, description: 'lower-case letters, digits and hyphens, starting with a letter or digit, up to 41 characters' },
    pages: { type: 'array', maxItems: LIMITS.pages, items: word },
    useCases: { type: 'array', minItems: 1, maxItems: LIMITS.useCases, items: USE_CASE_SCHEMA },
    look: { enum: LOOKS },
    opening: OPENING_SCHEMA,
    ending: ENDING_SCHEMA,
    brand: BRAND_SCHEMA,
    generatedBy: GENERATED_BY_SCHEMA,
  },
};
