// The arms driver's spend and experiment guards, end to end with a fake `claude`: the ceiling, host faults, the MP4 rule, the
// features a prompt asked for, the resume guard and a ledger with a half-written first line. No model, no billing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { failReason } from '../arms-lib.mjs';
import { cleanup, fakeArms, fakeClaude, fakePrompts, fakeRepo, tmp } from './helpers/arms-fixtures.mjs';
import { drive } from './helpers/arms-drive.mjs';
import { leftOpen, withLedger } from './helpers/arms-safety.mjs';
import * as F from './helpers/stream-fixtures.mjs';

after(cleanup);

// --- 3: the ceiling ----------------------------------------------------------------------------------------------------------------

test('3: 19.00 spent and a 1.00 budget does not start under 20, because the host cap can be overshot', async () => {
  const r = await drive({ args: { '--resume': true }, pre: withLedger({ prompt: 'p1', arm: 'A', chargeUsd: 19 }) });
  assert.equal(r.code, 3);
  assert.equal(r.calls.length, 0);
  assert.match(r.stderr, /ceiling reached: 19\.00 USD spent/);
  assert.match(r.stderr, /1\.10 USD/);
  assert.match(r.stderr, /--raise-ceiling/);
});

test('3: --dry-run states the 10% reserve in the worst case, and counts what an earlier run left in flight', async () => {
  const r = await drive({ args: { '--dry-run': true } });
  assert.match(r.stdout, /4\.40 USD worst case/);
  assert.match(r.stdout, /10% reserve/);
  const open = await drive({ args: { '--dry-run': true, '--resume': true }, pre: leftOpen({}) });
  assert.equal(open.code, 0, open.stderr);
  assert.match(open.stdout, /1 case in flight.*1\.00 USD/);
  assert.equal(fs.existsSync(path.join(open.out, 'cases.jsonl')), false, 'a dry run writes nothing');
  assert.equal(open.calls.length, 0);
});

// --- 4: host faults -----------------------------------------------------------------------------------------------------------------

const FAULT = { subtype: 'error_during_execution', cost: 0.3, exit: 1 };

test('4: an is_error result that is not the budget cap is a host fault: charged its cost, failReason host fault, the driver stops with 4', async () => {
  const r = await drive({ claude: fakeClaude(FAULT) });
  assert.equal(r.code, 4);
  assert.equal(r.calls.length, 1, 'one fault stops the run');
  const [c] = r.ledger().cases;
  assert.match(c.hostFault, /is_error.*error_during_execution/);
  assert.equal(c.chargeUsd, 0.3);
  assert.equal(failReason(c), 'host fault');
  assert.match(r.stderr, /host fault.*p1 A/);
  assert.match(r.stdout, /failed: host fault/);
});

test('4: --retry reruns a host fault and its charge adds; without --retry a resume goes on past it', async () => {
  const fix = { arms: fakeArms(), repo: fakeRepo(), prompts: fakePrompts() };
  const out = tmp('pa-arms-out-');
  assert.equal((await drive({ out, ...fix, claude: fakeClaude(FAULT) })).code, 4);
  const retry = await drive({ out, ...fix, args: { '--resume': true, '--retry': 'p1:A' } });
  assert.equal(retry.code, 0, retry.stderr);
  assert.equal(retry.calls.length, 4);
  const { cases, spentUsd } = retry.ledger();
  assert.deepEqual(cases.map((c) => c.prompt + c.arm), ['p1A', 'p1A', 'p1D', 'p2D', 'p2A']);
  assert.ok(Math.abs(spentUsd - 3.9) < 1e-9, '0.3 + 4 x 0.9');
  const out2 = tmp('pa-arms-out-');
  assert.equal((await drive({ out: out2, ...fix, claude: fakeClaude(FAULT) })).code, 4);
  const past = await drive({ out: out2, ...fix, args: { '--resume': true } });
  assert.equal(past.code, 0, past.stderr);
  assert.equal(past.calls.length, 3, 'the faulted case is recorded, so it is not run again unasked');
});

test('4: a non-zero exit with no result event, and a stream that cannot be read, are host faults charged the whole budget with no cost', async () => {
  const crash = await drive({ claude: fakeClaude({ stream: F.lines([F.init()]), exit: 3 }), arms: fakeArms(['A']) });
  assert.equal(crash.code, 4);
  assert.match(crash.ledger().cases[0].hostFault, /exit 3 with no result/);
  assert.equal(crash.ledger().cases[0].chargeUsd, 1);
  const junk = await drive({ claude: fakeClaude({ stream: 'not a stream\n' }), arms: fakeArms(['A']) });
  assert.equal(junk.code, 4);
  assert.match(junk.ledger().cases[0].hostFault, /unreadable stream/);
  assert.equal(junk.ledger().cases[0].chargeUsd, 1);
});

test('4: the budget cap and a timeout are case failures, not host faults: the run goes on', async () => {
  const cap = await drive({ claude: fakeClaude({ subtype: 'error_max_budget_usd', cost: 1.04, exit: 1 }) });
  assert.equal(cap.code, 0, cap.stderr);
  assert.equal(cap.calls.length, 4);
  const [c] = cap.ledger().cases;
  assert.equal(c.capped, true);
  assert.equal(c.hostFault, null);
  assert.equal(c.chargeUsd, 1.04);
  const slow = await drive({ claude: fakeClaude({ sleep: true }), arms: fakeArms(['A']), args: { '--timeout': 1, '--limit': 1 } });
  assert.equal(slow.code, 0);
  assert.equal(slow.ledger().cases[0].hostFault, null);
});

// --- 7: the MP4 must come from the session ---------------------------------------------------------------------------------------------

test('7: an MP4 older than the session, or empty, is not a delivered film', async () => {
  const old = await drive({ claude: fakeClaude({ mp4Age: 3600000 }), arms: fakeArms(['A']), args: { '--limit': 1 } });
  assert.equal(old.ledger().cases[0].mp4, false);
  assert.equal(fs.existsSync(path.join(old.out, 'cases', 'p1', 'A', 'film.mp4')), false, 'a stale film is not kept as this case\'s');
  const empty = await drive({ claude: fakeClaude({ mp4Bytes: '' }), arms: fakeArms(['A']), args: { '--limit': 1 } });
  assert.equal(empty.ledger().cases[0].mp4, false);
});

test('7: a film at another name under out/ is mp4 false with its name in otherMp4', async () => {
  const r = await drive({ claude: fakeClaude({ mp4Name: 'launch.mp4' }), arms: fakeArms(['A']), args: { '--limit': 1 } });
  const [c] = r.ledger().cases;
  assert.equal(c.mp4, false);
  assert.deepEqual(c.otherMp4, ['launch.mp4']);
  assert.match(r.stdout, /no MP4/);
  const good = await drive({ arms: fakeArms(['A']), args: { '--limit': 1 } });
  assert.equal(good.ledger().cases[0].mp4, true);
  assert.deepEqual(good.ledger().cases[0].otherMp4, []);
});

// --- 8: the features the prompt asked for are kept ---------------------------------------------------------------------------------------

test('8: featureOk and missingFeatures stay in the case record', async () => {
  const dir = tmp('pa-arms-prompts-');
  fs.writeFileSync(path.join(dir, 'motion-budget.json'), JSON.stringify([{ id: 'p1', prompt: 'Make film p1.', expect: ['cut', 'nothere'] }]));
  const r = await drive({ prompts: dir, arms: fakeArms(['A']) });
  const [c] = r.ledger().cases;
  assert.equal(c.featureOk, false);
  assert.deepEqual(c.missingFeatures, ['nothere']);
  assert.equal(failReason(c), null, 'never part of the rule');
});

// --- 9: a resume must be the same experiment ------------------------------------------------------------------------------------------------

async function firstRun(extra = {}) {
  const fix = { arms: fakeArms(), repo: fakeRepo(), prompts: fakePrompts(), out: tmp('pa-arms-out-') };
  const r = await drive({ ...fix, ...extra, args: { '--limit': 1, ...extra.args } });
  assert.equal(r.code, 0, r.stderr);
  return fix;
}
const plan = (out) => JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8'));

test('9: plan.json records the model, budget, timeout, host, ceiling, each arm\'s folder and hash, and the prompts with their hashes', async () => {
  const fix = await firstRun();
  const p = plan(fix.out);
  assert.equal(p.model, 'sonnet');
  assert.equal(p.budget, 1);
  assert.equal(p.timeoutSec, 60);
  assert.equal(p.maxTotal, 20);
  assert.equal(p.host, 'claude-stream');
  assert.match(p.hostHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(p.arms, ['A', 'D']);
  assert.equal(p.armSources.A.folder, fix.arms.A);
  assert.match(p.armSources.A.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(p.prompts, ['p1']);
  assert.match(p.promptHashes.p1, /^[0-9a-f]{64}$/);
});

test('9: the same experiment resumes, and --limit may grow: plan.json then holds the larger list', async () => {
  const fix = await firstRun();
  const r = await drive({ ...fix, args: { '--resume': true } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.calls.length, 2, 'the same plan without --limit would be all prompts; p1 is done, p2 runs');
  assert.deepEqual(plan(fix.out).prompts, ['p1', 'p2']);
});

test('9: a resume with another model, budget, timeout, arm content, prompt list or arm set is refused, naming what differs', async () => {
  const fix = await firstRun();
  const before = fs.readFileSync(path.join(fix.out, 'plan.json'), 'utf8');
  const refuse = async (what, pattern, extra) => {
    const r = await drive({ ...fix, ...extra, args: { '--resume': true, '--limit': 1, ...extra?.args } });
    assert.equal(r.code, 2, what);
    assert.match(r.stderr, pattern, what);
    assert.equal(r.calls.length, 0, what);
    assert.equal(fs.readFileSync(path.join(fix.out, 'plan.json'), 'utf8'), before, `${what}: plan.json is left alone`);
  };
  await refuse('model', /model differs.*sonnet.*opus/, { args: { '--model': 'opus' } });
  await refuse('budget', /budget differs.*1.*2/, { args: { '--budget': 2 } });
  await refuse('timeout', /timeout differs.*60.*90/, { args: { '--timeout': 90 } });
  await refuse('arm set', /arms differ/, { arms: { A: fix.arms.A } });
  await refuse('arm folder', /arm D folder differs/, { arms: { ...fix.arms, D: fakeArms(['D']).D } });
  fs.appendFileSync(path.join(fix.arms.D, 'SKILL.md'), 'changed\n');
  await refuse('arm content', /arm D differs.*SKILL\.md or scripts/, {});
  const other = tmp('pa-arms-prompts-');
  fs.writeFileSync(path.join(other, 'motion-budget.json'), JSON.stringify([{ id: 'p1', prompt: 'A different brief.' }, { id: 'p2', prompt: 'x' }]));
  await refuse('prompt text', /prompt list differs.*p1/, { prompts: other });
});

test('9: --limit may not shrink below what the first run planned', async () => {
  const fix = { arms: fakeArms(), repo: fakeRepo(), prompts: fakePrompts(), out: tmp('pa-arms-out-') };
  assert.equal((await drive({ ...fix })).code, 0);
  const r = await drive({ ...fix, args: { '--resume': true, '--limit': 1 } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /prompt list differs/);
});

test('9: --max-total may be raised on a resume only with --raise-ceiling; lowering it needs nothing', async () => {
  const fix = await firstRun();
  const raised = await drive({ ...fix, args: { '--resume': true, '--limit': 1, '--max-total': 25 } });
  assert.equal(raised.code, 2);
  assert.match(raised.stderr, /--max-total 25 is above the 20 this run was planned with.*--raise-ceiling/);
  assert.equal(raised.calls.length, 0);
  const ok = await drive({ ...fix, args: { '--resume': true, '--limit': 1, '--max-total': 25, '--raise-ceiling': true } });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(plan(fix.out).maxTotal, 25);
  const lower = await drive({ ...fix, args: { '--resume': true, '--limit': 1, '--max-total': 10 } });
  assert.equal(lower.code, 0, lower.stderr);
  assert.equal(plan(fix.out).maxTotal, 10);
});

test('9: --model is required for a host that takes one', async () => {
  const r = await drive({ args: { '--model': undefined } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--model is required for host "claude-stream"/);
  assert.equal(r.calls.length, 0);
});

// --- 11: a ledger with a half-written first line ---------------------------------------------------------------------------------------------------

test('11: a cases.jsonl that holds only a half-written first line is refused without --resume, and left untouched', async () => {
  const half = '{"prompt":"p1","ar';
  const r = await drive({ pre: (out) => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'cases.jsonl'), half); } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /cases\.jsonl already has cases or a half-written line.*--resume/);
  assert.equal(r.calls.length, 0);
  assert.equal(fs.readFileSync(path.join(r.out, 'cases.jsonl'), 'utf8'), half);
});

test('11: an inflight.jsonl left by a run that never finished its first case is refused without --resume', async () => {
  const r = await drive({ pre: leftOpen({}) });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /inflight\.jsonl already has records.*--resume/);
  assert.equal(r.calls.length, 0);
});

test('11: --resume over a half-written first line drops it and runs everything', async () => {
  const r = await drive({ args: { '--resume': true }, pre: (out) => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'cases.jsonl'), '{"prompt":"p1","ar'); } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.ledger().cases.length, 4);
});
