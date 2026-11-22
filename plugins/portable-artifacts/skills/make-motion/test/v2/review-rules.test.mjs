// The rule registry (engine/review/rules.mjs) is the list every finding's `rule` comes from. Three things are held equal
// to it: the rules the code emits (a source scan), the rows of references/rules.md, and the registry's own shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, RULE_IDS, ruleOf } from '../../engine/review/rules.mjs';
import { MIN_TEXT_UNITS, MAX_TEXT_SIZES, MIN_HERO_RATIO, OVERLAP_UNITS, WORD_OVERLAP_UNITS, CAPTION_LATE_SECONDS } from '../../engine/review/frame.mjs';
import { MIN_CONTRAST } from '../../engine/review/contrast.mjs';
import { COVER_SECONDS } from '../../engine/hand/index.mjs';
import { DEFAULT_FILL } from '../../engine/looks/fill.mjs';
import { MIN_SEAMS, REPEATED_CUT_SHARE, SAME_RUN, CREATIVE_CAP } from '../../engine/review/outline.mjs';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';

const MOTION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Every file that raises a review finding. A later wave that adds a file that emits a rule (a poster check, say) adds it
// here: a file not listed is never scanned, so its ids would be neither checked against the registry nor required to be
// emitted. Never add engine/kinds: a kind's own `finding('creative', 'top', ...)` is advice that review.mjs wraps as the
// rule `kind`, and its first argument is not a rule id.
const SCANNED = ['engine/review/frame.mjs', 'engine/review/contrast.mjs', 'engine/review/regions.mjs', 'engine/review/outline.mjs',
  'engine/review/poster.mjs', 'engine/review/overlay.mjs', 'engine/hand/index.mjs', 'scripts/v2/review.mjs', 'scripts/v2/loop.mjs'];
// The forms a rule must be written in to be seen: a literal `rule: 'x'` field, and the two helpers' `finding(ctx?, KIND, 'x', ...)`,
// single-quoted, on one line, with the id in lowercase letters, digits and hyphens. A rule built any other way is invisible here.
const FORMS = [/rule: '([a-z0-9-]+)'/g, /\bfinding\((?:ctx, )?(?:MECHANICAL|CREATIVE|'mechanical'|'creative'), '([a-z0-9-]+)'/g];
// Rules registered before the file that emits them exists: none now (engine/review/outline.mjs emits the two outline rules).
// A later wave that registers a rule ahead of its emitter lists the id here until the emitter lands.
const EXPECTED_LATER = [];

// Limit of the comment strip: a string holding whitespace then `//`, or holding `/*`, would hide the code after it from the
// scan. No scanned file has one today.
/** `source` without its block and line comments (a JSDoc `@returns {{ rule: 'x' }}` is not an emission). */
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

/** Every rule id any of FORMS finds in `source`, comments left out. */
const idsIn = (source) => FORMS.flatMap((form) => [...withoutComments(source).matchAll(form)].map((m) => m[1]));

/** Every rule id any of FORMS finds in the scanned files that exist. */
function emittedIds(files) {
  const found = new Set();
  for (const rel of files) {
    const file = path.join(MOTION, rel);
    if (fs.existsSync(file)) for (const id of idsIn(fs.readFileSync(file, 'utf8'))) found.add(id);
  }
  return found;
}

/** The ids in `emitted` the registry does not hold. */
const unregistered = (emitted) => [...emitted].filter((id) => !RULE_IDS.includes(id));
/** The ids of `ids` that have no row among `rows`. */
const missingRows = (ids, rows) => ids.filter((id) => !rows.some((row) => row.id === id));

const DOC_COLUMNS = 7;

/** The rows of references/rules.md's table: { id, kind, checked, meaning, ask, fix, evidence }. */
function docRows() {
  const lines = fs.readFileSync(path.join(MOTION, 'references/rules.md'), 'utf8').split('\n');
  return lines.filter((line) => line.startsWith('| `')).map((line) => {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    assert.equal(cells.length, DOC_COLUMNS, `a row of rules.md has ${cells.length} cells, not ${DOC_COLUMNS} (a "|" inside a cell?): ${line.slice(0, 60)}`);
    const [rule, kind, checked, meaning, ask, fix, evidence] = cells;
    return { id: rule.replaceAll('`', ''), kind, checked, meaning, ask, fix, evidence };
  });
}

test('every rule the code emits is registered, and every registered rule is emitted', () => {
  assert.deepEqual(unregistered(emittedIds(SCANNED)), []);
  assert.deepEqual(RULE_IDS.filter((id) => !emittedIds(SCANNED).has(id) && !EXPECTED_LATER.includes(id)), []);
});

// The scan finds all 40 registered ids (the plan's 38 counts W2's dead-space and scale-contrast and the two outline rules;
// W1's render-check problems are errors, not findings, so they add none; W4's poster-read is the 39th and its
// overlay-covers the 40th).
test('the registry holds 40 rules, each id once, each with a summary', () => {
  assert.equal(RULE_IDS.length, 40);
  assert.equal(new Set(RULE_IDS).size, 40);
  for (const rule of RULES) assert.ok(rule.summary.length > 0, rule.id);
});

test('references/rules.md lists exactly the registered rules, with their kinds and stages', () => {
  assert.deepEqual(docRows().map((r) => r.id).sort(), [...RULE_IDS].sort());
  for (const row of docRows()) {
    assert.equal(row.kind, ruleOf(row.id).kinds.join(', '), row.id);
    assert.equal(row.checked, ruleOf(row.id).stage, row.id);
    assert.equal(row.meaning, ruleOf(row.id).summary, row.id);
  }
});

test('guardrail: a rule renamed in the code, in the registry or in the page is caught', () => {
  assert.deepEqual(unregistered(new Set(['min-sise'])), ['min-sise']);
  assert.deepEqual(missingRows(RULE_IDS, [{ id: 'min-sise' }]).includes('min-size'), true);
  assert.throws(() => ruleOf('min-sise'), /unknown rule "min-sise"; did you mean "min-size"\?/);
});

test('the hand rule and the frame rule no longer share an id', () => {
  assert.equal(ruleOf('covered').stage, 'frame');
  assert.equal(ruleOf('hand-covered').stage, 'hand');
});

test('the registry is frozen, and its fields are the ones the report and the rules page read', () => {
  assert.ok(Object.isFrozen(RULES) && RULES.every((rule) => Object.isFrozen(rule)));
  for (const rule of RULES) {
    assert.ok(rule.kinds.length > 0 && rule.kinds.every((k) => k === 'mechanical' || k === 'creative'), rule.id);
    assert.ok(['frame', 'film', 'outline', 'hand', 'poster'].includes(rule.stage), rule.id);
    assert.equal(typeof rule.capped, 'boolean', rule.id);
    assert.ok([null, 'color', 'minSize', 'cuts'].includes(rule.suggest), rule.id);
  }
  assert.deepEqual(RULES.filter((r) => r.capped).map((r) => r.id).sort(), ['cut-variety', 'dead-space', 'overlay-covers', 'sameness', 'scale-contrast']);
  assert.deepEqual(RULES.filter((r) => r.suggest !== null).map((r) => [r.id, r.suggest]).sort(),
    [['contrast', 'color'], ['cut-variety', 'cuts'], ['min-size', 'minSize'], ['poster-read', 'minSize'], ['sameness', 'cuts']]);
  for (const id of ['card-overlap', 'cut-window', 'kind']) assert.deepEqual(ruleOf(id).kinds, ['mechanical', 'creative'], id);
});

test('[R2-12] every rule states its evidence, and every creative rule asks a question', () => {
  for (const rule of RULES) {
    assert.ok(['measured', 'convention', 'unmeasured'].includes(rule.evidence), rule.id);
    assert.equal(rule.kinds.includes('creative'), typeof rule.ask === 'string' && rule.ask.endsWith('?'), rule.id);
  }
  // cut-variety is not here: no example film is flagged by it, so its 2/3 share is the plan's number (references/calibration.md)
  assert.deepEqual(RULES.filter((r) => r.evidence === 'measured').map((r) => r.id).sort(), ['dead-space', 'sameness', 'scale-contrast']);
  assert.equal(ruleOf('cut-variety').evidence, 'unmeasured');
  assert.deepEqual(RULES.filter((r) => r.evidence === 'convention').map((r) => r.id), ['contrast']);
  for (const row of docRows()) {
    assert.equal(row.evidence.split(':')[0], ruleOf(row.id).evidence, row.id);
    assert.equal(row.ask, ruleOf(row.id).ask ?? '', row.id);
  }
});

// A path a cell cites: a file under references/ or engine/ (the shipped skill), never a scratch folder or a commit.
const CITED = /\b(?:references|engine)\/[\w./-]*\w\.(?:md|mjs)/g;

test('[R2-12] a measured row cites files that ship, a convention row names its standard', () => {
  const rows = new Map(docRows().map((row) => [row.id, row]));
  for (const id of ['dead-space', 'scale-contrast']) {
    const cell = rows.get(id).evidence;
    const cited = cell.match(CITED) ?? [];
    for (const rel of ['references/calibration.md', 'engine/looks/fill.mjs']) assert.ok(cited.includes(rel), `${id} cites ${rel}`);
    for (const rel of cited) assert.ok(fs.existsSync(path.join(MOTION, rel)), `${id} cites ${rel}, which does not exist`);
    assert.ok(cell.includes('DEFAULT_FILL'), id);
    assert.doesNotMatch(cell, /\.scratch|\b[0-9a-f]{7}\b/, `${id}: a scratch path or a commit does not survive a squash merge`);
  }
  for (const id of ['cut-variety', 'sameness']) {
    const cell = rows.get(id).evidence;
    const cited = cell.match(CITED) ?? [];
    for (const rel of ['references/calibration.md', 'engine/review/outline.mjs']) assert.ok(cited.includes(rel), `${id} cites ${rel}`);
    for (const rel of cited) assert.ok(fs.existsSync(path.join(MOTION, rel)), `${id} cites ${rel}, which does not exist`);
    assert.match(cell, /\(29 example films/, id);
    assert.doesNotMatch(cell, /\.scratch|\b[0-9a-f]{7}\b/, `${id}: a scratch path or a commit does not survive a squash merge`);
  }
  assert.match(rows.get('contrast').evidence, /^convention: WCAG 2/);
  for (const row of rows.values()) if (row.evidence === 'unmeasured') assert.equal(ruleOf(row.id).evidence, 'unmeasured', row.id);
});

const percent = (share) => Math.round(share * 100);

// A threshold a summary or a Fix value states is the one in the code: change a constant and one of these goes red.
test('[R2-12] the numbers rules.md and the registry state are the ones the code holds', () => {
  const desk = registries.looks.get('desk').fill, ledger = registries.looks.get('ledger').fill;
  assert.equal(desk.band, ledger.band, 'the summary says "in desk and ledger" for one number');
  const checks = [
    ['min-size', ['summary', 'fix'], `${MIN_TEXT_UNITS} units`],
    ['overlap', ['summary'], `by more than ${OVERLAP_UNITS} units`],
    ['overlay-covers', ['summary'], `by more than ${OVERLAP_UNITS} units`],
    ['word-overlap', ['summary'], `more than ${WORD_OVERLAP_UNITS} unit`],
    ['sizes', ['summary'], `More than ${MAX_TEXT_SIZES} distinct`],
    ['sizes', ['fix'], `${MAX_TEXT_SIZES} sizes or fewer`],
    ['hero', ['summary', 'fix'], `${MIN_HERO_RATIO} times`],
    ['dropped', ['summary'], `${MIN_HERO_RATIO} times`],
    ['contrast', ['summary', 'fix', 'evidence'], `${MIN_CONTRAST}:1`],
    ['caption-late', ['summary', 'fix'], `${CAPTION_LATE_SECONDS} s`],
    ['hand-covered', ['summary'], `${COVER_SECONDS} s`],
    ['dead-space', ['summary'], `reaches ${percent(DEFAULT_FILL.band)}% of`],
    ['dead-space', ['summary'], `(${percent(desk.band)}% in desk and ledger)`],
    ['scale-contrast', ['summary'], `under ${percent(DEFAULT_FILL.hero)}% of the safe area`],
    ['scale-contrast', ['summary'], `(${percent(ledger.hero)}% in ledger)`],
    ['cut-variety', ['fix'], `fewer than ${MIN_SEAMS} cuts`],
    ['cut-variety', ['summary'], 'two thirds'],
    ['sameness', ['fix'], `first ${CREATIVE_CAP} findings`],
    ['overlay-covers', ['fix'], `first ${CREATIVE_CAP} findings`],
  ];
  assert.equal(REPEATED_CUT_SHARE, 2 / 3, 'the summary says "two thirds"');
  assert.equal(SAME_RUN, 3, 'the summary says "Three or more"');
  assert.ok(ruleOf('sameness').summary.startsWith('Three or more'));
  const rows = new Map(docRows().map((row) => [row.id, row]));
  for (const [id, fields, text] of checks) {
    for (const field of fields) {
      const cell = field === 'summary' ? ruleOf(id).summary : rows.get(id)[field];
      assert.ok(cell.includes(text), `${id} ${field} says "${cell}", not "${text}"`);
    }
  }
});

test('guardrail: a rule named only in a comment is not an emission', () => {
  const source = "// rule: 'a-comment'\n/** @returns {{ rule: 'in-jsdoc' }} */\n/* rule: 'block' */\nconst f = { rule: 'real' }; // rule: 'trailing'\n";
  assert.deepEqual(idsIn(source), ['real']);
  assert.deepEqual(idsIn("const g = finding(ctx, MECHANICAL, 'two2', id, 'm');"), ['two2']);
});

test('references/rules.md says an id is never renamed or reused', () => {
  assert.ok(fs.readFileSync(path.join(MOTION, 'references/rules.md'), 'utf8').includes('A rule id is never renamed or reused after 2.3.0; a new rule takes a new id.'));
});

test('every rule an emitter writes sits in the stage its file belongs to', () => {
  const byFile = { 'engine/review/poster.mjs': 'poster', 'engine/review/overlay.mjs': 'frame', 'engine/hand/index.mjs': 'hand', 'scripts/v2/loop.mjs': 'film', 'scripts/v2/review.mjs': 'film' };
  for (const [rel, stage] of Object.entries(byFile)) {
    for (const id of emittedIds([rel])) assert.equal(ruleOf(id).stage, stage, `${rel}: ${id}`);
  }
});
