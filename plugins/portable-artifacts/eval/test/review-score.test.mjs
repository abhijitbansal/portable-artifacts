// The pass bar for the second reviewer: pure scoring, no model, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreProof, PROOF_RUNS, MAX_FALSE_FAILS } from '../review-score.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLANTED = JSON.parse(fs.readFileSync(path.join(here, '../fixtures/review/planted.json'), 'utf8'));
const bad = Object.keys(PLANTED);
const RUNS = [1, 2, 3];

const result = (fixture, run, verdict, notes = []) => ({ fixture, run, verdict, notes });
const found = (f, run) => result(f, run, 'fail', [{ level: 'P0', shot: PLANTED[f].shot }]);
const ALL_FOUND = [
  ...bad.flatMap((f) => RUNS.map((run) => found(f, run))),
  ...RUNS.map((run) => result('good', run, 'pass')),
];
const without = (results, fixture, run) => results.filter((r) => !(r.fixture === fixture && r.run === run));
const replace = (results, fixture, run, next) => [...without(results, fixture, run), next];
const withGoodFails = (results, n) => results.map((r) => (r.fixture === 'good' && r.run <= n ? { ...r, verdict: 'fail', notes: [{ level: 'P1', shot: 'claim' }] } : r));

test('the constants are three runs and one allowed false fail', () => {
  assert.equal(PROOF_RUNS, 3);
  assert.equal(MAX_FALSE_FAILS, 1);
});

test('every defect found in every run and a clean good film passes', () => {
  const out = scoreProof(ALL_FOUND, PLANTED);
  assert.equal(out.pass, true);
  assert.deepEqual(out.problems, []);
  assert.equal(out.falseFails, 0);
  for (const f of bad) assert.equal(out.found[f], 3, f);
});

test('one false fail on the good film still passes; two do not', () => {
  assert.equal(scoreProof(withGoodFails(ALL_FOUND, 1), PLANTED).pass, true);
  const two = scoreProof(withGoodFails(ALL_FOUND, 2), PLANTED);
  assert.equal(two.pass, false);
  assert.equal(two.falseFails, 2);
  assert.match(two.problems.join('\n'), /good: 2 false fails/);
});

test('a defect missed in one run fails, naming the fixture and the run', () => {
  const out = scoreProof(replace(ALL_FOUND, 'chart-wrong-mark', 2, result('chart-wrong-mark', 2, 'pass')), PLANTED);
  assert.equal(out.pass, false);
  assert.equal(out.found['chart-wrong-mark'], 2);
  assert.match(out.problems[0], /chart-wrong-mark: run 2/);
});

test('a fail verdict that names another shot is not a find', () => {
  const other = result('number-mismatch', 1, 'fail', [{ level: 'P0', shot: 'claim' }]);
  const out = scoreProof(replace(ALL_FOUND, 'number-mismatch', 1, other), PLANTED);
  assert.equal(out.pass, false);
  assert.equal(out.found['number-mismatch'], 2);
  assert.match(out.problems[0], /number-mismatch: run 1/);
});

test('a note at P2 only is not a find, even with a fail verdict', () => {
  const soft = result('orphan-shot', 3, 'fail', [{ level: 'P2', shot: 'aside' }]);
  const out = scoreProof(replace(ALL_FOUND, 'orphan-shot', 3, soft), PLANTED);
  assert.equal(out.pass, false);
  assert.equal(out.found['orphan-shot'], 2);
});

test('a P1 note on the planted shot counts, and so does one among other notes', () => {
  const p1 = result('picture-contradicts', 1, 'fail', [{ level: 'P2', shot: 'claim' }, { level: 'P1', shot: 'look' }]);
  const out = scoreProof(replace(ALL_FOUND, 'picture-contradicts', 1, p1), PLANTED);
  assert.equal(out.pass, true);
  assert.equal(out.found['picture-contradicts'], 3);
});

test('a pass verdict that carries a P0 note on the planted shot is not a find', () => {
  const odd = result('chart-wrong-mark', 1, 'pass', [{ level: 'P0', shot: 'chart' }]);
  const out = scoreProof(replace(ALL_FOUND, 'chart-wrong-mark', 1, odd), PLANTED);
  assert.equal(out.found['chart-wrong-mark'], 2);
  assert.equal(out.pass, false);
});

test('a reviewer that fails everything does not pass', () => {
  const everything = [...bad, 'good'].flatMap((f) => RUNS.map((run) => result(f, run, 'fail', [{ level: 'P0', shot: PLANTED[f]?.shot ?? 'claim' }])));
  const out = scoreProof(everything, PLANTED);
  assert.equal(out.falseFails, 3);
  assert.equal(out.pass, false);
  for (const f of bad) assert.equal(out.found[f], 3, 'it finds every planted defect, which is why the good film counts');
});

test('a run that is absent is a problem, not a pass', () => {
  const out = scoreProof(without(ALL_FOUND, 'orphan-shot', 2), PLANTED);
  assert.equal(out.pass, false);
  assert.equal(out.found['orphan-shot'], 2);
  assert.match(out.problems.join('\n'), /orphan-shot: run 2 is missing/);
});

test('a missing good-film run is a problem too', () => {
  const out = scoreProof(without(ALL_FOUND, 'good', 3), PLANTED);
  assert.equal(out.pass, false);
  assert.match(out.problems.join('\n'), /good: run 3 is missing/);
});

test('the number of runs is a parameter: two runs, two results each', () => {
  const two = ALL_FOUND.filter((r) => r.run <= 2);
  assert.equal(scoreProof(two, PLANTED, { runs: 2 }).pass, true);
  assert.equal(scoreProof(two, PLANTED).pass, false, 'the default is three runs, so two are not enough');
});

test('a result with a verdict that is neither pass nor fail is a problem, never a find', () => {
  const junk = result('chart-wrong-mark', 1, 'maybe', [{ level: 'P0', shot: 'chart' }]);
  const out = scoreProof(replace(ALL_FOUND, 'chart-wrong-mark', 1, junk), PLANTED);
  assert.equal(out.pass, false);
  assert.match(out.problems.join('\n'), /chart-wrong-mark: run 1/);
});

test('an empty result list passes nothing', () => {
  const out = scoreProof([], PLANTED);
  assert.equal(out.pass, false);
  assert.ok(out.problems.length >= bad.length);
});
