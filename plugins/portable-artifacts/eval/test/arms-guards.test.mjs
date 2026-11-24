// The arms driver's spend and verdict guards (arms-lib.mjs): the ceiling reserve, host faults, the two-reader rule, the measured
// cost ratio, and what verdict.md says. Pure functions, no I/O.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OVERSHOOT_RESERVE, failReason, hostFaultOf, isFailed, mayStart, renderVerdict, worseThanA } from '../arms-lib.mjs';
import { decide, world } from './helpers/arms-world.mjs';

test('a case starts only if its budget plus the overshoot reserve still fits', () => {
  assert.equal(OVERSHOOT_RESERVE, 0.1);
  assert.equal(mayStart(18.9, 1, 20), true, '18.90 + 1.10 is exactly 20');
  assert.equal(mayStart(19, 1, 20), false, '19.00 spent + a 1.00 budget must not start under 20: the host cap can be overshot');
  assert.equal(mayStart(18.91, 1, 20), false);
});

test('mayStart counts what is in flight as spent', () => {
  assert.equal(mayStart(10, 1, 20, 8.9), true);
  assert.equal(mayStart(10, 1, 20, 9), false);
});

const sess = (over = {}) => ({ readable: true, capped: false, result: { isError: false, subtype: 'success' }, ...over });

test('hostFaultOf: an is_error result that is not the budget cap, an unreadable stream, a non-zero exit with no result are host faults', () => {
  assert.equal(hostFaultOf({ session: sess(), exit: 0 }), null);
  assert.match(hostFaultOf({ session: sess({ result: { isError: true, subtype: 'success' } }), exit: 1 }), /is_error/);
  assert.match(hostFaultOf({ session: sess({ result: { isError: true, subtype: 'error_during_execution' } }), exit: 1 }), /error_during_execution/);
  assert.match(hostFaultOf({ session: { readable: false, reason: 'no stream events' }, exit: 0 }), /unreadable.*no stream events/);
  assert.match(hostFaultOf({ session: sess({ result: null }), exit: 3 }), /exit 3 with no result/);
});

test('hostFaultOf: the budget cap, a timeout, an interrupt and a clean exit are not host faults', () => {
  assert.equal(hostFaultOf({ session: sess({ capped: true, result: { isError: true, subtype: 'error_max_budget_usd' } }), exit: 1 }), null);
  assert.equal(hostFaultOf({ session: { readable: false, reason: 'x' }, exit: 1, timedOut: true }), null);
  assert.equal(hostFaultOf({ session: sess({ result: null }), exit: 1, timedOut: true }), null);
  assert.equal(hostFaultOf({ session: { readable: false, reason: 'x' }, exit: 1, interrupted: true }), null);
  assert.equal(hostFaultOf({ session: sess({ result: null }), exit: 0 }), null, 'a clean exit with no result is not a fault of the host');
});

const ok = { prompt: 'p', arm: 'A', timedOut: false, capped: false, specExists: true, mp4: true, checkOk: true };

test('failReason: interrupted, a host fault and a scoring error come first, in that order, and are failed cases', () => {
  assert.equal(failReason({ ...ok, interrupted: true, hostFault: 'x', capped: true }), 'interrupted');
  assert.equal(failReason({ ...ok, hostFault: 'is_error', capped: true }), 'host fault');
  assert.equal(failReason({ ...ok, scoringError: 'boom' }), 'scoring failed');
  assert.equal(isFailed({ ...ok, hostFault: 'is_error' }), true);
  assert.equal(failReason({ ...ok, hostFault: null, interrupted: false, scoringError: null }), null);
});

const R = (a, d, c) => ({ ranks: { a, d, c } });

test('worseThanA: with fewer than three readers, two that split 1-1 leave it undecided; one reader is not enough', () => {
  assert.equal(worseThanA([R(1, 2, 3), R(1, 1, 3), null], 'd', 'a'), null, 'the missing third could make it 2 of 3');
  assert.equal(worseThanA([R(1, 2, 3), R(1, 1, 3)], 'd', 'a'), null);
  assert.equal(worseThanA([R(1, 2, 3)], 'd', 'a'), null);
  assert.equal(worseThanA([R(1, 2, 3), R(1, 1, 3), R(1, 1, 3)], 'd', 'a'), false, 'three readers: the majority');
  assert.equal(worseThanA([R(1, 2, 3), R(1, 2, 3), R(1, 1, 3)], 'd', 'a'), true);
});

test('verdict: the ratio is from usage.costUsd; a charge that was only the budget is never a cost', () => {
  const noCost = (who) => (p, arm) => (p === 'old-1' && arm === who ? { usage: { costUsd: null } } : {});
  for (const who of ['A', 'D']) {
    const v = decide(world({ tweak: noCost(who) }));
    assert.equal(v.decision, 'inconclusive', who);
    assert.match(v.reasons.join('\n'), /old-1 has no measured cost ratio/, who);
    assert.equal(v.prompts.find((p) => p.prompt === 'old-1').arms.D.ratio, null, who);
  }
  const cost0 = decide(world({ tweak: (p, arm) => (p === 'old-1' && arm === 'A' ? { usage: { costUsd: 0 } } : {}) }));
  assert.equal(cost0.decision, 'inconclusive', 'a cost of 0 on A is not a measurement either');
  assert.match(renderVerdict(decide(world({ tweak: noCost('D') }))), /unmeasured/);
});

test('verdict: a failed challenger with no cost is a failure, not an unmeasured ratio', () => {
  const v = decide(world({ tweak: (p, arm) => (p === 'old-1' && arm === 'D' ? { timedOut: true, usage: { costUsd: null } } : {}) }));
  assert.equal(v.prompts.find((p) => p.prompt === 'old-1').arms.D.ratio, Infinity);
  assert.doesNotMatch(v.reasons.join('\n'), /no measured cost ratio/);
  assert.equal(v.decision, 'C');
});

test('verdict: an interrupted case and a host fault fail like any case, and show their reason', () => {
  const v = decide(world({ tweak: (p, arm) => (p === 'old-1' && arm === 'D' ? { interrupted: true } : p === 'old-2' && arm === 'C' ? { hostFault: 'is_error' } : {}) }));
  assert.equal(v.prompts.find((p) => p.prompt === 'old-1').arms.D.failReason, 'interrupted');
  assert.equal(v.prompts.find((p) => p.prompt === 'old-2').arms.C.failReason, 'host fault');
  assert.equal(v.decision, 'none');
});

test('verdict: a 1-1 split of two readers is named as an undecided rating, not as a missing reply', () => {
  const w = world();
  w.ratings['film-2'] = [{ ranks: { na: 1, nd: 2, nc: 1 } }, { ranks: { na: 1, nd: 1, nc: 1 } }, null];
  const v = decide(w);
  assert.equal(v.decision, 'inconclusive');
  assert.match(v.reasons.join('\n'), /film-2 has no usable rating \(fewer than two readers covered its films, or two split 1-1 with a third missing\)/);
});

test('renderVerdict: the limit of 2 prompts rated worse is stated as a count, whatever the number of usable prompts', () => {
  assert.match(renderVerdict(decide(world())), /At most 2 prompts may be rated worse, whatever the number of usable prompts \(10 usable here: 2 of 10\)/);
  const nine = renderVerdict(decide(world({ tweak: (p, arm) => (p === 'old-1' && arm === 'A' ? { mp4: false } : {}) })));
  assert.match(nine, /At most 2 prompts may be rated worse, whatever the number of usable prompts \(9 usable here: 2 of 9, not 2 of 10\)/);
});

test('renderVerdict: the features each film missed are reported per prompt and never change the decision', () => {
  const tweak = (p, arm) => (p === 'old-1' && arm === 'D' ? { featureOk: false, missingFeatures: ['chart', 'on'] } : p === 'old-1' && arm === 'A' ? { featureOk: false, missingFeatures: ['hero'] } : {});
  const v = decide(world({ tweak }));
  assert.equal(v.decision, 'C');
  assert.deepEqual(v.prompts.find((p) => p.prompt === 'old-1').missingFeatures, { A: ['hero'], D: ['chart', 'on'] });
  const line = renderVerdict(v).split('\n').find((l) => l.startsWith('| old-1 |'));
  assert.match(line, /A: hero; D: chart, on/);
  assert.match(renderVerdict(v), /missing features/);
});
