// The arms driver's pure helpers (arms-lib.mjs): case order, ledger, spend, film counts, why a case failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKILLS } from '../lib.mjs';
import {
  caseOrder, chargeOf, failReason, filmCounts, isFailed, mayStart, median, parseRatings, readLedger, renderVerdict, verdict, worseThanA,
} from '../arms-lib.mjs';

// --- Task 3 ---

test('caseOrder rotates arms', () => {
  assert.deepEqual(caseOrder(['p', 'q'], ['A', 'D', 'C']).map((c) => c.prompt + c.arm), ['pA', 'pD', 'pC', 'qD', 'qC', 'qA']);
});

test('caseOrder: the fourth prompt starts with the first arm again', () => {
  assert.deepEqual(caseOrder(['a', 'b', 'c', 'd'], ['A', 'D', 'C']).filter((c) => c.prompt === 'd').map((c) => c.arm), ['A', 'D', 'C']);
});

test('a case with no cost event is charged the whole budget', () => {
  assert.equal(chargeOf({ readable: true, usage: { costUsd: null } }, 1), 1);
});

test('an unreadable stream is charged the whole budget; a read cost is charged as it was', () => {
  assert.equal(chargeOf({ readable: false, usage: { costUsd: null } }, 1), 1);
  assert.equal(chargeOf({ readable: true, usage: { costUsd: 0.37 } }, 1), 0.37);
  assert.equal(chargeOf({ readable: true, usage: { costUsd: 1.04 } }, 1), 1.04, 'a cost above the cap is real spend');
});

test('a case starts only if the budget still fits', () => {
  assert.equal(mayStart(19, 1, 20), true);
  assert.equal(mayStart(19.01, 1, 20), false);
});

const rec = (prompt, arm, chargeUsd) => JSON.stringify({ prompt, arm, chargeUsd });

test('a half-written last line of the ledger is dropped, a bad middle line throws', () => {
  const half = `${rec('p', 'A', 0.5)}\n${rec('p', 'D', 0.25)}\n{"prompt":"p","arm":"C","charge`;
  const { cases, spentUsd } = readLedger(half);
  assert.deepEqual(cases.map((c) => c.arm), ['A', 'D']);
  assert.equal(spentUsd, 0.75);
  assert.throws(() => readLedger(`${rec('p', 'A', 0.5)}\n{"prompt":"p","ar\n${rec('p', 'C', 0.25)}\n`), /line 2/);
});

test('an empty ledger is no cases and no spend; blank lines are skipped', () => {
  assert.deepEqual(readLedger(''), { cases: [], spentUsd: 0 });
  assert.equal(readLedger(`\n${rec('p', 'A', 1)}\n\n`).cases.length, 1);
});

test('a ledger line that parses but is not a case with a charge throws, even the last one', () => {
  assert.throws(() => readLedger('[1,2]\n'), /line 1/);
  assert.throws(() => readLedger(`${JSON.stringify({ prompt: 'p', arm: 'A' })}\n`), /line 1.*chargeUsd/);
});

const SPEC = {
  cut: 'wipe', // a root cut: not counted
  looks: { desk: { cut: 'slide' } }, // a look's cut: not counted
  shots: [
    { id: 'a', show: 'statement' },
    { id: 'b', show: 'number', cut: 'cut' }, // a plain cut: not counted
    { id: 'c', show: 'chart', cut: 'slide', on: [{ at: 'x', do: 'pulse' }, { at: 'y', do: 'ring', target: 't' }] },
    { id: 'd', show: 'list', cut: { type: 'iris', at: 'mark' }, on: [{ at: 'z', do: 'pulse' }, { at: 'w' }] },
    { id: 'e', show: 'quote', cut: { type: 'cut' } }, // an object whose type is cut: not counted
  ],
};

test('filmCounts: a root cut, a look cut and a plain cut are not designed cuts', () => {
  assert.deepEqual(filmCounts(SPEC), { designedCuts: 2, devices: 3 });
});

test('filmCounts: not a film, or no shots, counts nothing and never throws', () => {
  for (const bad of [null, undefined, 3, 'x', [], {}, { shots: 'no' }, { shots: [null, 4, { on: 'no' }, { on: [null, { do: '' }] }] }]) {
    assert.deepEqual(filmCounts(bad), { designedCuts: 0, devices: 0 });
  }
});

test('median: odd count is the middle, even count the mean of the two middle values, none is null', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([1, Infinity, 2, 3]), 2.5);
  assert.equal(median([1, Infinity, Infinity]), Infinity);
});

const ok = { prompt: 'p', arm: 'A', timedOut: false, capped: false, specExists: true, mp4: true, checkOk: true };

test('failReason: not failed is null; each way to fail has its own reason, the first that applies', () => {
  assert.equal(failReason(ok), null);
  assert.equal(isFailed(ok), false);
  assert.equal(failReason({ ...ok, capped: true, timedOut: true }), 'budget reached');
  assert.equal(failReason({ ...ok, timedOut: true }), 'timed out');
  assert.equal(failReason({ ...ok, specExists: false, mp4: false }), 'no spec');
  assert.equal(failReason({ ...ok, mp4: false }), 'no MP4');
  assert.equal(failReason({ ...ok, checkOk: false }), 'check failed');
  assert.equal(failReason({ ...ok, checkOk: null }), 'check failed', 'a skipped check is not a pass');
  assert.equal(isFailed({ ...ok, checkOk: false }), true);
});

test('SKILLS.motion keeps the MP4 through keepFiles, which no outputOk can depend on', () => {
  assert.deepEqual(SKILLS.motion.keepFiles, ['out/film.mp4']);
  assert.equal(SKILLS.motion.artifacts.includes('out/film.mp4'), false);
});

// --- Task 4: ratings, the pass rule ---

const NAMES = ['alpha-aaaaa-aaaaa', 'bravo-bbbbb-bbbbb', 'charl-ccccc-ccccc'];
const reply = (ranks) => JSON.stringify({ ranks });
const ALL_ONE = Object.fromEntries(NAMES.map((n) => [n, 1]));

test('parseRatings: a reader\'s JSON gives the ranks, ties allowed', () => {
  assert.deepEqual(parseRatings(reply(ALL_ONE), NAMES), { ranks: ALL_ONE });
  assert.deepEqual(parseRatings(reply({ [NAMES[0]]: 1, [NAMES[1]]: 2, [NAMES[2]]: 2 }), NAMES).ranks[NAMES[2]], 2);
});

test('parseRatings: the reply may sit in a fenced block, or be surrounded by text, or nested in another object', () => {
  const json = reply({ [NAMES[0]]: 2, [NAMES[1]]: 1, [NAMES[2]]: 3 });
  const want = { ranks: { [NAMES[0]]: 2, [NAMES[1]]: 1, [NAMES[2]]: 3 } };
  assert.deepEqual(parseRatings(`Here is my ranking:\n\`\`\`json\n${json}\n\`\`\`\nThanks.`, NAMES), want);
  assert.deepEqual(parseRatings(`I think {not json} but ${json} is final; {"x": 1}`, NAMES), want);
  assert.deepEqual(parseRatings(`{"reply": ${json}, "note": "a } in a \\"string\\""}`, NAMES), want);
});

test('parseRatings: a name that is not a film of the prompt gives null (a reply naming a film that does not exist)', () => {
  assert.equal(parseRatings(reply({ ...ALL_ONE, 'delta-ddddd-ddddd': 2 }), NAMES), null);
  assert.equal(parseRatings(reply({ [NAMES[0]]: 1, [NAMES[1]]: 2, 'delta-ddddd-ddddd': 3 }), NAMES), null);
});

test('parseRatings: a missing name gives null', () => {
  assert.equal(parseRatings(reply({ [NAMES[0]]: 1, [NAMES[1]]: 2 }), NAMES), null);
});

test('parseRatings: a rank outside 1..n or not a whole number, and anything that is not a reply, give null and never throw', () => {
  for (const bad of [0, 4, 1.5, '1', null, true]) assert.equal(parseRatings(reply({ ...ALL_ONE, [NAMES[0]]: bad }), NAMES), null, String(bad));
  for (const junk of ['', 'no json', '{', '{"ranks": 5}', '{"ranks": []}', '[]', 'null', '{"ranks":{"__proto__":1}}', undefined, null, 5, {}]) {
    assert.equal(parseRatings(junk, NAMES), null, String(junk));
  }
  assert.equal(parseRatings('{'.repeat(50000), NAMES), null);
});

test('parseRatings: two films are ranked 1..2; the same reply covers a prompt with two packets', () => {
  assert.deepEqual(parseRatings(reply({ x: 1, y: 2 }), ['x', 'y']), { ranks: { x: 1, y: 2 } });
  assert.equal(parseRatings(reply({ x: 1, y: 3 }), ['x', 'y']), null);
});

const R = (a, d, c) => ({ ranks: { a, d, c } });

test('worseThanA: a tie with A is not worse', () => {
  assert.equal(worseThanA([R(1, 1, 1), R(1, 1, 1), R(1, 1, 1)], 'd', 'a'), false);
});

test('worseThanA: two readers of three ranking it strictly below A is worse; one is not', () => {
  assert.equal(worseThanA([R(1, 2, 3), R(1, 3, 2), R(2, 1, 3)], 'd', 'a'), true);
  assert.equal(worseThanA([R(1, 2, 3), R(1, 1, 2), R(2, 1, 3)], 'd', 'a'), false);
  assert.equal(worseThanA([R(1, 2, 3), R(1, 2, 2), R(1, 1, 1)], 'd', 'a'), true, 'two readers, one tie: still two below');
});

test('worseThanA: better than A is not worse; fewer than two readers parsed is null, not a guess', () => {
  assert.equal(worseThanA([R(2, 1, 3), R(2, 1, 3), R(2, 1, 3)], 'd', 'a'), false);
  assert.equal(worseThanA([R(1, 2, 3), null, null], 'd', 'a'), null);
  assert.equal(worseThanA([], 'd', 'a'), null);
  assert.equal(worseThanA([R(1, 2, 3), R(1, 2, 3), null], 'd', 'a'), true, 'two parsed readers are enough');
  assert.equal(worseThanA([R(1, 2, 3), R(1, 1, 3), null], 'd', 'a'), false);
});

// A world: ten prompts (five new briefs, `film-*`, five older), arms A D C, every arm ok. `tweak(prompt, arm, case)` edits a case.
const IDS = ['film-1', 'film-2', 'film-3', 'film-4', 'film-5', 'old-1', 'old-2', 'old-3', 'old-4', 'old-5'];
const COST = { A: 1, D: 0.7, C: 0.6 };
const FILM = { designedCuts: 3, devices: 4 };

function world({ ids = IDS, tweak = () => ({}), worse = () => false } = {}) {
  const cases = ids.flatMap((prompt) => ['A', 'D', 'C'].map((arm) => ({
    prompt, arm, timedOut: false, capped: false, specExists: true, mp4: true, checkOk: true, chargeUsd: COST[arm], film: { ...FILM }, ...tweak(prompt, arm),
  })));
  const key = Object.fromEntries(ids.map((p) => [p, { na: 'A', nd: 'D', nc: 'C' }]));
  // three readers; `worse(prompt, arm)` puts that arm below A for every reader
  const reading = (p) => ({ ranks: { na: 1, nd: worse(p, 'D') ? 2 : 1, nc: worse(p, 'C') ? 2 : 1 } });
  const ratings = Object.fromEntries(ids.map((p) => [p, [reading(p), reading(p), reading(p)]]));
  return { cases, ratings, key };
}
const decide = (w) => verdict(w.cases, w.ratings, w.key);

test('verdict: everything passes and C is at least 0.05 below D: C', () => {
  const v = decide(world());
  assert.equal(v.decision, 'C');
  assert.equal(v.arms.D.pass, true);
  assert.equal(v.arms.C.pass, true);
  assert.equal(v.prompts.length, 10);
  assert.deepEqual(v.reasons, []);
});

test('verdict: the median cost ratio passes at 0.80 and not at 0.8001 (C made to fail, so D alone decides)', () => {
  const costs = (d) => (prompt, arm) => (arm === 'D' ? { chargeUsd: d } : arm === 'C' ? { chargeUsd: 1 } : {});
  assert.equal(decide(world({ tweak: costs(0.8) })).decision, 'D');
  const over = decide(world({ tweak: costs(0.8001) }));
  assert.equal(over.decision, 'none');
  assert.match(over.reasons.join('\n'), /D: median cost ratio 0\.8001 is above 0\.80/);
});

test('verdict: the median of an even count is the mean of the middle two, and one cheap half is not enough', () => {
  const split = (cheap) => (prompt, arm) => (arm === 'D' ? { chargeUsd: IDS.indexOf(prompt) < cheap ? 0.5 : 1 } : arm === 'C' ? { chargeUsd: 1 } : {});
  assert.equal(decide(world({ tweak: split(5) })).arms.D.ratioMedian, 0.75, 'five at 0.5 and five at 1.0: the mean of 0.5 and 1.0');
  assert.equal(decide(world({ tweak: split(5) })).decision, 'D');
  assert.equal(decide(world({ tweak: split(4) })).arms.D.pass, false, 'four cheap prompts of ten: the median is 1.0');
});

test('verdict: rated worse than A in two of ten passes, in three does not', () => {
  const worseIn = (n) => (prompt, arm) => arm === 'D' && IDS.indexOf(prompt) < n;
  const two = decide(world({ worse: worseIn(2) }));
  assert.equal(two.arms.D.worseCount, 2);
  assert.equal(two.arms.D.pass, true);
  const three = decide(world({ worse: worseIn(3) }));
  assert.equal(three.arms.D.worseCount, 3);
  assert.equal(three.arms.D.pass, false);
  assert.equal(three.decision, 'C', 'C passes alone');
  assert.match(three.reasons.join('\n'), /D: rated worse than A in 3 prompts, at most 2 allowed/);
});

test('verdict: a failed case counts as worse than A, as a ratio above 0.80, and fails the arm', () => {
  const v = decide(world({ tweak: (p, arm) => (p === 'old-1' && arm === 'D' ? { checkOk: false } : {}) }));
  const row = v.prompts.find((p) => p.prompt === 'old-1').arms.D;
  assert.equal(row.worse, true);
  assert.ok(row.ratio > 0.8);
  assert.equal(row.failReason, 'check failed');
  assert.equal(v.arms.D.worseCount, 1);
  assert.equal(v.arms.D.failedCount, 1);
  assert.equal(v.arms.D.pass, false);
  assert.equal(v.decision, 'C');
  assert.match(v.reasons.join('\n'), /D: old-1 failed \(check failed\) and A did not/);
});

test('verdict: a failed case needs no rating, so it is never undecided; a live arm on the same prompt still is', () => {
  const w = world({ tweak: (p, arm) => (p === 'old-1' && arm === 'D' ? { timedOut: true } : {}) });
  w.ratings['old-1'] = [];
  const v = decide(w);
  assert.deepEqual(v.arms.D.undecided, []);
  assert.deepEqual(v.arms.C.undecided, ['old-1']);
  assert.equal(v.decision, 'inconclusive');
});

test('verdict: a failed A drops the prompt, and an arm that failed with it is not blamed', () => {
  const v = decide(world({ tweak: (p, arm) => (p === 'old-1' && (arm === 'A' || arm === 'D') ? { mp4: false } : {}) }));
  const row = v.prompts.find((p) => p.prompt === 'old-1');
  assert.equal(row.usable, false);
  assert.equal(row.aFailReason, 'no MP4');
  assert.equal(v.usable, 9);
  assert.equal(v.arms.D.failedCount, 0);
  assert.equal(v.decision, 'C');
});

test('verdict: nine usable prompts are fine, seven are inconclusive', () => {
  const dropA = (n) => (p, arm) => (arm === 'A' && IDS.indexOf(p) >= 10 - n ? { mp4: false } : {});
  assert.equal(decide(world({ tweak: dropA(1) })).decision, 'C');
  const eight = decide(world({ tweak: dropA(2) }));
  assert.equal(eight.usable, 8);
  assert.equal(eight.decision, 'C');
  const seven = decide(world({ tweak: dropA(3) }));
  assert.equal(seven.usable, 7);
  assert.equal(seven.decision, 'inconclusive');
  assert.match(seven.reasons.join('\n'), /only 7 usable prompts, at least 8 are needed/);
});

test('verdict: a prompt with no rating is undecided and the verdict is inconclusive', () => {
  const w = world();
  delete w.ratings['film-2'];
  const v = decide(w);
  assert.equal(v.decision, 'inconclusive');
  assert.match(v.reasons.join('\n'), /film-2 has no usable rating/);
  assert.equal(v.arms.D.undecided.includes('film-2'), true);
  const w2 = world();
  w2.ratings['film-2'] = [{ ranks: { na: 1, nd: 1, nc: 1 } }, null, null];
  assert.equal(decide(w2).decision, 'inconclusive', 'one parsed reader is not a rating');
});

test('verdict: missing cases are inconclusive, whichever arm is missing', () => {
  for (const arm of ['A', 'D', 'C']) {
    const w = world();
    w.cases = w.cases.filter((c) => !(c.prompt === 'film-3' && c.arm === arm));
    const v = decide(w);
    assert.equal(v.decision, 'inconclusive', arm);
    assert.match(v.reasons.join('\n'), new RegExp(`film-3 has no case for ${arm}`));
  }
});

test('verdict: the median designed cuts and devices over the new briefs may not be below A\'s; older prompts do not count', () => {
  const lower = (key, ids) => (p, arm) => (arm === 'D' && ids.includes(p) ? { film: { ...FILM, [key]: 0 } } : {});
  const film = IDS.slice(0, 5);
  const old = IDS.slice(5);
  assert.equal(decide(world({ tweak: lower('designedCuts', old) })).arms.D.pass, true, 'older prompts are not looked at');
  assert.equal(decide(world({ tweak: lower('designedCuts', film.slice(0, 3)) })).arms.D.pass, false, 'median of the five new briefs is 0 when three have none');
  assert.equal(decide(world({ tweak: lower('designedCuts', film.slice(0, 2)) })).arms.D.pass, true, 'two of five: the median is still 3');
  assert.equal(decide(world({ tweak: lower('devices', film.slice(0, 3)) })).arms.D.pass, false);
  const above = decide(world({ tweak: (p, arm) => (arm === 'D' ? { film: { designedCuts: 9, devices: 9 } } : {}) }));
  assert.equal(above.arms.D.pass, true, 'more than A is fine');
  assert.match(decide(world({ tweak: lower('devices', film.slice(0, 3)) })).reasons.join('\n'), /D: median devices 0 is below A's 4 over the new briefs/);
});

test('verdict: a planned prompt that never started (a ceiling stop, a short run) is missing cases: inconclusive', () => {
  const w = world({ ids: IDS.slice(0, 8) });
  assert.equal(verdict(w.cases, w.ratings, w.key).decision, 'C', 'eight complete prompts are enough when nothing more was planned');
  const v = verdict(w.cases, w.ratings, w.key, { planned: IDS });
  assert.equal(v.decision, 'inconclusive');
  assert.equal(v.usable, 8);
  const reasons = v.reasons.join('\n');
  for (const arm of ['A', 'D', 'C']) assert.match(reasons, new RegExp(`old-4 has no case for ${arm}`));
  assert.match(reasons, /old-5 has no case for A/);
  assert.equal(v.prompts.length, 10, 'the unstarted prompts are rows, so the report shows them');
});

test('verdict: with no usable new brief the film rule cannot be judged: inconclusive', () => {
  const v = decide(world({ ids: IDS.slice(5).concat(['old-6', 'old-7', 'old-8']) }));
  assert.equal(v.decision, 'inconclusive');
  assert.match(v.reasons.join('\n'), /no usable new brief/);
});

test('verdict: C wins only if it is at least 0.05 below D; D wins otherwise; neither is none', () => {
  const costs = (d, c) => (p, arm) => (arm === 'D' ? { chargeUsd: d } : arm === 'C' ? { chargeUsd: c } : {});
  assert.equal(decide(world({ tweak: costs(0.7, 0.65) })).decision, 'C', 'exactly 0.05 below');
  assert.equal(decide(world({ tweak: costs(0.7, 0.66) })).decision, 'D', '0.04 below');
  assert.equal(decide(world({ tweak: costs(0.9, 0.7) })).decision, 'C', 'D fails');
  assert.equal(decide(world({ tweak: costs(0.7, 0.9) })).decision, 'D', 'C fails');
  assert.equal(decide(world({ tweak: costs(0.9, 0.9) })).decision, 'none');
});

test('verdict: a later record for the same case replaces an earlier one', () => {
  const w = world();
  w.cases.push({ ...w.cases.find((c) => c.prompt === 'film-1' && c.arm === 'D'), checkOk: false });
  assert.equal(decide(w).arms.D.failedCount, 1);
});

test('renderVerdict: the decision, the reasons, every prompt with its numbers and the reason a case failed', () => {
  const v = decide(world({ tweak: (p, arm) => (p === 'old-1' && arm === 'D' ? { checkOk: false } : {}) }));
  const md = renderVerdict(v);
  assert.match(md, /^# Verdict: C/m);
  for (const id of IDS) assert.ok(md.includes(`| ${id} |`), id);
  assert.match(md, /check failed/);
  assert.match(md, /one model, one host, one machine/);
  assert.match(renderVerdict(decide(world({ ids: ['film-1'] }))), /^# Verdict: inconclusive/m);
});
