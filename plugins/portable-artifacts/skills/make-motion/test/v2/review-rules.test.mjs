// The rule registry (engine/review/rules.mjs) is the list every finding's `rule` comes from. Three things are held equal
// to it: the rules the code emits (a source scan), the rows of references/rules.md, and the registry's own shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, RULE_IDS, ruleOf } from '../../engine/review/rules.mjs';

const MOTION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const SCANNED = ['engine/review/frame.mjs', 'engine/review/contrast.mjs', 'engine/review/regions.mjs', 'engine/review/outline.mjs',
  'engine/hand/index.mjs', 'scripts/v2/review.mjs', 'scripts/v2/loop.mjs'];
// The three forms a rule is written in: a literal `rule: 'x'` field, and the two helpers' `finding(ctx?, KIND, 'x', ...)`.
const FORMS = [/rule: '([a-z-]+)'/g, /\bfinding\((?:ctx, )?(?:MECHANICAL|CREATIVE|'mechanical'|'creative'), '([a-z-]+)'/g];
// Rules registered before the file that emits them exists: Task 3 creates engine/review/outline.mjs and empties this.
const EXPECTED_LATER = ['cut-variety', 'sameness'];

/** Every rule id any of FORMS finds in the scanned files that exist. */
function emittedIds(files) {
  const found = new Set();
  for (const rel of files) {
    const file = path.join(MOTION, rel);
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const form of FORMS) for (const m of source.matchAll(form)) found.add(m[1]);
  }
  return found;
}

/** The ids in `emitted` the registry does not hold. */
const unregistered = (emitted) => [...emitted].filter((id) => !RULE_IDS.includes(id));
/** The ids of `ids` that have no row among `rows`. */
const missingRows = (ids, rows) => ids.filter((id) => !rows.some((row) => row.id === id));

/** The rows of references/rules.md's table: { id, kind, checked, meaning, ask, fix, evidence }. */
function docRows() {
  const lines = fs.readFileSync(path.join(MOTION, 'references/rules.md'), 'utf8').split('\n');
  return lines.filter((line) => line.startsWith('| `')).map((line) => {
    const [rule, kind, checked, meaning, ask, fix, evidence] = line.split('|').slice(1, -1).map((cell) => cell.trim());
    return { id: rule.replaceAll('`', ''), kind, checked, meaning, ask, fix, evidence };
  });
}

test('every rule the code emits is registered, and every registered rule is emitted', () => {
  assert.deepEqual(unregistered(emittedIds(SCANNED)), []);
  assert.deepEqual(RULE_IDS.filter((id) => !emittedIds(SCANNED).has(id) && !EXPECTED_LATER.includes(id)), []);
});

// 38 is what the scan finds at HEAD (W2 added dead-space and scale-contrast to the plan's 36 at W3 start; W1 added render-check
// errors, which are errors and not findings).
test('the registry holds 38 rules, each id once, each with a summary', () => {
  assert.equal(RULE_IDS.length, 38);
  assert.equal(new Set(RULE_IDS).size, 38);
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
  assert.deepEqual(RULES.filter((r) => r.capped).map((r) => r.id).sort(), ['cut-variety', 'dead-space', 'sameness', 'scale-contrast']);
  assert.deepEqual(RULES.filter((r) => r.suggest !== null).map((r) => [r.id, r.suggest]).sort(),
    [['contrast', 'color'], ['cut-variety', 'cuts'], ['min-size', 'minSize'], ['sameness', 'cuts']]);
  for (const id of ['card-overlap', 'cut-window', 'kind']) assert.deepEqual(ruleOf(id).kinds, ['mechanical', 'creative'], id);
});

test('[R2-12] every rule states its evidence, and every creative rule asks a question', () => {
  for (const rule of RULES) {
    assert.ok(['measured', 'convention', 'unmeasured'].includes(rule.evidence), rule.id);
    assert.equal(rule.kinds.includes('creative'), typeof rule.ask === 'string' && rule.ask.endsWith('?'), rule.id);
  }
  assert.deepEqual(RULES.filter((r) => r.evidence === 'measured').map((r) => r.id).sort(), ['dead-space', 'scale-contrast']);
  assert.deepEqual(RULES.filter((r) => r.evidence === 'convention').map((r) => r.id), ['contrast']);
  for (const row of docRows()) {
    assert.equal(row.evidence.split(':')[0], ruleOf(row.id).evidence, row.id);
    assert.equal(row.ask, ruleOf(row.id).ask ?? '', row.id);
  }
});

test('[R2-12] a measured row names its table and commits, a convention row names its standard', () => {
  const rows = new Map(docRows().map((row) => [row.id, row]));
  for (const id of ['dead-space', 'scale-contrast']) {
    for (const part of ['calibration.md', '04f1a1e', '6794ae9', '0786f60']) assert.ok(rows.get(id).evidence.includes(part), `${id}: ${part}`);
  }
  assert.match(rows.get('contrast').evidence, /^convention: WCAG 2/);
  for (const row of rows.values()) if (row.evidence === 'unmeasured') assert.equal(ruleOf(row.id).evidence, 'unmeasured', row.id);
});

test('references/rules.md says an id is never renamed or reused', () => {
  assert.ok(fs.readFileSync(path.join(MOTION, 'references/rules.md'), 'utf8').includes('A rule id is never renamed or reused after 2.3.0; a new rule takes a new id.'));
});

test('every rule an emitter writes sits in the stage its file belongs to', () => {
  const byFile = { 'engine/hand/index.mjs': 'hand', 'scripts/v2/loop.mjs': 'film', 'scripts/v2/review.mjs': 'film' };
  for (const [rel, stage] of Object.entries(byFile)) {
    for (const id of emittedIds([rel])) assert.equal(ruleOf(id).stage, stage, `${rel}: ${id}`);
  }
});
