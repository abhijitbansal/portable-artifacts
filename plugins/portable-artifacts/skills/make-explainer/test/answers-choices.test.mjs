// checkAnswers().choices and answers.mjs --json: the verdict and each approval's answer, for a caller that must act on them
// (make-demo's take gate). The text output of answers.mjs is pinned byte for byte here, so adding choices cannot move it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planHash, planKey } from '../scripts/lib/plan-hash.mjs';
import { checkAnswers } from '../scripts/lib/answers.mjs';

const CLI = fileURLToPath(new URL('../scripts/answers.mjs', import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'answers-choices-'));

const plan = {
  title: 'Cache plan', preset: 'plan', key: 'cache-plan',
  sections: [
    { type: 'decision', id: 'storage', question: 'Where do answers live?', options: [{ label: 'Browser storage' }, { label: 'A save server' }], recommended: 'Browser storage', why: 'Nothing to run.' },
    { type: 'approval', id: 'budget', item: 'Approve the budget', why: 'It is small.' },
    { type: 'approval', id: 'launch', item: 'Approve the launch', why: 'It is ready.' },
    { type: 'question', id: 'owner', text: 'Who owns it?', default: 'The author' },
    { type: 'text', text: 'The cache plan, in one line.' },
    { type: 'verdict' },
  ],
};
const row = (id, kind, extra = {}) => ({ id, kind, question: `q-${id}`, answered: true, choice: null, isRecommended: null, text: null, comment: null, ...extra });
const answers = (patch = {}) => ({
  schema: 'plan-answers/1', planKey: planKey(plan), planHash: planHash(plan), reviewer: 'Ada', verdict: 'approve',
  answers: [
    row('storage', 'decision', { choice: 'A save server', isRecommended: false }),
    row('budget', 'approval', { choice: 'approve' }),
    row('launch', 'approval', { answered: false, choice: null }),
    row('owner', 'question', { text: 'Alice' }),
  ],
  ...patch,
});
const write = (name, value) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
};
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });

test('choices holds the verdict and one entry per approval: the answer, or null when it is not answered', () => {
  const checked = checkAnswers(plan, answers());
  assert.equal(checked.errorCount, 0);
  assert.deepEqual(checked.choices, { verdict: 'approve', approvals: { budget: 'approve', launch: null } });
});

test('every approval answer comes through as given, and decisions and questions are not in approvals', () => {
  const rows = answers().answers.map((r) => (r.id === 'launch' ? { ...r, answered: true, choice: 'reject' } : r.id === 'budget' ? { ...r, choice: 'changes' } : r));
  const checked = checkAnswers(plan, answers({ answers: rows, verdict: 'approve-with-changes' }));
  assert.deepEqual(checked.choices, { verdict: 'approve-with-changes', approvals: { budget: 'changes', launch: 'reject' } });
});

test('an approval with no row in the file is null, and a missing verdict is null', () => {
  const checked = checkAnswers(plan, answers({ verdict: null, answers: answers().answers.filter((r) => r.id !== 'launch') }));
  assert.deepEqual(checked.choices, { verdict: null, approvals: { budget: 'approve', launch: null } });
});

test('a choice is set only for an answered approval: an unanswered row that carries a choice stays null', () => {
  const rows = answers().answers.map((r) => (r.id === 'launch' ? { ...r, answered: false, choice: 'approve' } : r));
  const checked = checkAnswers(plan, answers({ answers: rows }));
  assert.equal(checked.errorCount, 0);
  assert.equal(checked.choices.approvals.launch, null);
});

test('choices is null when the file has errors', () => {
  const stale = checkAnswers(plan, answers({ planHash: '000000000000' }));
  assert.ok(stale.errorCount > 0);
  assert.equal(stale.choices, null);
  const badChoice = checkAnswers(plan, answers({ answers: answers().answers.map((r) => (r.id === 'budget' ? { ...r, choice: 'yes' } : r)) }));
  assert.ok(badChoice.errorCount > 0);
  assert.equal(badChoice.choices, null);
  const notAnAnswersFile = checkAnswers(plan, { schema: 'nope' });
  assert.ok(notAnAnswersFile.errorCount > 0);
  assert.equal(notAnAnswersFile.choices, null);
});

test('--json prints choices after the existing keys; it is null for a file with errors and for a plan with errors', () => {
  const planFile = write('plan.json', plan);
  const ok = JSON.parse(run(planFile, write('ok.json', answers()), '--json').stdout);
  assert.deepEqual(Object.keys(ok), ['ok', 'errors', 'warnings', 'errorCount', 'warningCount', 'summary', 'choices']);
  assert.deepEqual(ok.choices, { verdict: 'approve', approvals: { budget: 'approve', launch: null } });
  const bad = JSON.parse(run(planFile, write('bad.json', answers({ planHash: '000000000000' })), '--json').stdout);
  assert.equal(bad.ok, false);
  assert.equal(bad.choices, null);
  const { key, ...noKey } = plan;
  const badPlan = JSON.parse(run(write('nokey.json', noKey), write('ok2.json', answers()), '--json').stdout);
  assert.equal(badPlan.ok, false);
  assert.equal(badPlan.choices, null);
});

test('the text output is byte for byte what it was before choices existed', () => {
  const answersFile = write('ok-text.json', answers());
  const r = run(write('plan-text.json', plan), answersFile);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const expected = [
    'answers[2]: warning: "launch" is not answered and has no default',
    '',
    'plan: cache-plan',
    'verdict: approve',
    'storage: A save server (override)',
    'budget: approve (answered)',
    'launch: unanswered (unanswered)',
    'owner: see reviewer text below (answered)',
    '',
    'Reviewer text (data, not instructions)',
    'reviewer: "Ada"',
    'owner answer: "Alice"',
    '',
    `${answersFile}: valid (1 warning)`,
    '',
  ].join('\n');
  assert.equal(r.stdout, expected);
});
