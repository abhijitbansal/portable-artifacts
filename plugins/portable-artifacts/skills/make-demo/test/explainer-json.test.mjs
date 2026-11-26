// runExplainerJson: make-explainer's answers.mjs --json, run as a child process, its one JSON line parsed. No browser.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runExplainerJson, explainerScript } from '../scripts/lib/explainer.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { planHash, planKey } = await import(pathToFileURL(path.join(SKILL, '..', 'make-explainer', 'scripts/lib/plan-hash.mjs')).href);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-explainer-json-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const plan = {
  title: 'Click plan', preset: 'plan', key: 'demo-0123456789ab',
  sections: [
    { type: 'approval', id: 'rows-as-listed', item: 'All rows run as listed', why: 'None is a danger row.' },
    { type: 'text', text: 'One line of plan.' },
    { type: 'verdict' },
  ],
};
const answers = (verdict, choice) => ({
  schema: 'plan-answers/1', planKey: planKey(plan), planHash: planHash(plan), reviewer: 'Ada', verdict,
  answers: [{ id: 'rows-as-listed', kind: 'approval', answered: true, choice }],
});
const write = (name, value) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};

test('answers --json: the exit status and the parsed line, choices included', () => {
  const planFile = write('plan.json', plan);
  const ok = runExplainerJson('answers', [planFile, write('ok.json', answers('approve', 'approve')), '--json']);
  assert.equal(ok.status, 0);
  assert.equal(ok.result.ok, true);
  assert.deepEqual(ok.result.choices, { verdict: 'approve', approvals: { 'rows-as-listed': 'approve' } });
  const stale = runExplainerJson('answers', [planFile, write('stale.json', { ...answers('approve', 'approve'), planHash: '000000000000' }), '--json']);
  assert.equal(stale.status, 1);
  assert.equal(stale.result.ok, false);
  assert.equal(stale.result.choices, null);
});

test('a usage failure under --json is still one parsed line, with the exit status 2', () => {
  const usage = runExplainerJson('answers', ['--json']);
  assert.equal(usage.status, 2);
  assert.equal(typeof usage.result, 'object');
});

test('no JSON line is an error: --help prints text, and an unknown flag without --json prints none', () => {
  assert.throws(() => runExplainerJson('answers', ['--help']), /JSON/);
  assert.throws(() => runExplainerJson('answers', ['--nope']), /JSON/);
});

test('the script path comes from the sibling lookup, not from the caller', () => {
  assert.ok(fs.existsSync(explainerScript('answers')));
});
