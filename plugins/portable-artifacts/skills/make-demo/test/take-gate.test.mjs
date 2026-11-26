// gate: may a take run? Pure, from the demo spec, scout.json, the click plan's page spec and the parsed answers.mjs --json result.
// Built from the phase 1 plan fixtures; no browser, no file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gate } from '../scripts/lib/take-gate.mjs';
import { planRows } from '../scripts/lib/plan-rows.mjs';
import { planPage } from '../scripts/lib/plan-page.mjs';
import { control, page, scoutOf, specOf, dangerScout, dangerSpec } from './fixtures/plan-scouts.mjs';

const text = (result) => (result.ok ? '' : result.errors.map((e) => `${e.path}: ${e.message}`).join('\n'));

// A plan with no danger row: a goto, a hover and a wait.
const calmScout = () => scoutOf([page({ controls: [control({ name: 'More', css: 'more', kind: 'disclosure', effect: 'look' })] })]);
const calmSpec = (seconds = 1) => specOf([{ id: 'over', do: 'hover', target: { role: 'button', name: 'More' } }, { id: 'rest', do: 'wait', value: seconds }]);

/** The click plan's page spec and everything gate takes, for one spec and scout. */
function setup(spec, scout) {
  const planned = planRows(spec, scout);
  assert.deepEqual(planned.errors, [], 'the fixture plan is valid');
  return { spec, scout, clickPlan: planPage(spec, scout, planned), rows: planned.rows, hash: planned.hash };
}
const approvalIds = (clickPlan) => clickPlan.sections.filter((s) => s.type === 'approval').map((s) => s.id);
const answersOf = (clickPlan, { verdict = 'approve', approvals } = {}) => ({
  ok: true, errors: [], warnings: [], errorCount: 0, warningCount: 0, summary: 'plan: x',
  choices: { verdict, approvals: approvals ?? Object.fromEntries(approvalIds(clickPlan).map((id) => [id, 'approve'])) },
});
const calm = () => setup(calmSpec(), calmScout());
const danger = () => setup(dangerSpec(), dangerScout());
const gateOf = (made, answers) => gate({ spec: made.spec, scout: made.scout, clickPlan: made.clickPlan, answers });
const paths = (result) => result.errors.map((e) => e.path);

test('an approved plan passes and returns its rows and its hash', () => {
  const made = calm();
  assert.deepEqual(approvalIds(made.clickPlan), ['rows-as-listed']);
  const result = gateOf(made, answersOf(made.clickPlan));
  assert.equal(result.ok, true, text(result));
  assert.deepEqual(result.rows, made.rows);
  assert.equal(result.hash, made.hash);
  assert.equal(made.clickPlan.key, `demo-${made.hash}`);
});

test('a plan with danger rows passes when each danger row has its own approve', () => {
  const made = danger();
  assert.deepEqual(approvalIds(made.clickPlan), ['danger-archive', 'danger-delete']);
  const result = gateOf(made, answersOf(made.clickPlan));
  assert.equal(result.ok, true, text(result));
  assert.equal(result.rows.length, made.rows.length);
});

test('answers that did not pass answers.mjs are refused, and so are answers with no choices', () => {
  const made = calm();
  const bad = { ...answersOf(made.clickPlan), ok: false, errorCount: 1, errors: [{ path: 'planHash', message: 'stale' }], choices: null };
  const refused = gateOf(made, bad);
  assert.equal(refused.ok, false);
  assert.deepEqual(paths(refused), ['answers']);
  assert.match(text(refused), /answers\.mjs/);
  const noChoices = gateOf(made, { ...answersOf(made.clickPlan), choices: null });
  assert.equal(noChoices.ok, false);
  assert.deepEqual(paths(noChoices), ['answers.choices']);
  for (const junk of [null, undefined, 'approve', {}]) {
    const result = gateOf(made, junk);
    assert.equal(result.ok, false, String(junk));
    assert.equal(result.errors[0].path, 'answers');
  }
});

test('a step of demo.json changed after the approval: the hash moves, the plan key does not match, nothing runs', () => {
  const approved = calm();
  const answers = answersOf(approved.clickPlan);
  const edited = setup(calmSpec(2), calmScout());
  assert.notEqual(edited.hash, approved.hash);
  const result = gate({ spec: edited.spec, scout: edited.scout, clickPlan: approved.clickPlan, answers });
  assert.equal(result.ok, false);
  assert.deepEqual(paths(result), ['clickPlan.key']);
  assert.match(text(result), new RegExp(`demo-${edited.hash}`));
  assert.match(text(result), new RegExp(`demo-${approved.hash}`));
});

test('a changed word field (title, goal) does not move the hash, so the approval stands', () => {
  const approved = calm();
  const reworded = structuredClone(approved.spec);
  reworded.useCases[0].title = 'Another title';
  reworded.useCases[0].goal = 'Another goal';
  const result = gate({ spec: reworded, scout: approved.scout, clickPlan: approved.clickPlan, answers: answersOf(approved.clickPlan) });
  assert.equal(result.ok, true, text(result));
});

test('a plan the scout cannot back is refused with planRows\' own paths', () => {
  const made = calm();
  const ghost = specOf([{ id: 'ghost', do: 'click', target: { role: 'button', name: 'Nowhere' } }]);
  const result = gate({ spec: ghost, scout: made.scout, clickPlan: made.clickPlan, answers: answersOf(made.clickPlan) });
  assert.equal(result.ok, false);
  assert.deepEqual(paths(result), ['useCases[0].steps[1].target']);
  const stale = gate({ spec: calmSpec(), scout: { ...made.scout, version: 2 }, clickPlan: made.clickPlan, answers: answersOf(made.clickPlan) });
  assert.equal(stale.ok, false);
  assert.deepEqual(paths(stale), ['scout']);
  assert.match(text(stale), /run scout again/);
});

test('a verdict other than approve is refused: approve-with-changes, not-yet and none', () => {
  const made = calm();
  for (const verdict of ['approve-with-changes', 'not-yet', null]) {
    const result = gateOf(made, answersOf(made.clickPlan, { verdict }));
    assert.equal(result.ok, false, String(verdict));
    assert.deepEqual(paths(result), ['answers.choices.verdict'], String(verdict));
    assert.match(result.errors[0].message, /approve/);
  }
  const { verdict, ...noVerdict } = answersOf(made.clickPlan).choices;
  const missing = gateOf(made, { ...answersOf(made.clickPlan), choices: noVerdict });
  assert.deepEqual(paths(missing), ['answers.choices.verdict'], 'a choices object with no verdict key');
});

test('every danger row needs its own approve: changes, reject, no answer and a missing approval are each refused by row', () => {
  const made = danger();
  for (const choice of ['changes', 'reject', null, undefined]) {
    const approvals = { 'danger-archive': 'approve', 'danger-delete': choice };
    const result = gateOf(made, answersOf(made.clickPlan, { approvals }));
    assert.equal(result.ok, false, String(choice));
    assert.deepEqual(paths(result), ['answers.choices.approvals.danger-delete'], String(choice));
    assert.match(result.errors[0].message, /delete/);
    assert.match(result.errors[0].message, /row 5/, 'the row number is named');
  }
  const noApprovals = gateOf(made, answersOf(made.clickPlan, { approvals: {} }));
  assert.deepEqual(paths(noApprovals), ['answers.choices.approvals.danger-archive', 'answers.choices.approvals.danger-delete']);
});

test('one approved danger row does not cover another, and rows-as-listed does not cover a danger row', () => {
  const made = danger();
  const result = gateOf(made, answersOf(made.clickPlan, { approvals: { 'danger-archive': 'approve', 'rows-as-listed': 'approve' } }));
  assert.equal(result.ok, false);
  assert.deepEqual(paths(result), ['answers.choices.approvals.danger-delete']);
});

test('a plan with no danger row needs rows-as-listed to be approve', () => {
  const made = calm();
  for (const choice of ['changes', 'reject', null, undefined]) {
    const result = gateOf(made, answersOf(made.clickPlan, { approvals: { 'rows-as-listed': choice } }));
    assert.equal(result.ok, false, String(choice));
    assert.deepEqual(paths(result), ['answers.choices.approvals.rows-as-listed'], String(choice));
  }
});

test('several refusals are all reported, and gate does not change what it was given', () => {
  const made = danger();
  const answers = answersOf(made.clickPlan, { verdict: 'not-yet', approvals: { 'danger-archive': 'reject', 'danger-delete': 'approve' } });
  const before = structuredClone({ spec: made.spec, scout: made.scout, clickPlan: made.clickPlan, answers });
  const result = gateOf(made, answers);
  assert.deepEqual(paths(result), ['answers.choices.verdict', 'answers.choices.approvals.danger-archive']);
  assert.deepEqual({ spec: made.spec, scout: made.scout, clickPlan: made.clickPlan, answers }, before);
});
