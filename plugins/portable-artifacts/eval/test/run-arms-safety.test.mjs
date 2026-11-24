// The arms driver's crash safety, end to end with a fake `claude`: a case that is lost or run twice costs real money, so each way
// it can happen is staged here (the journal, a resume, --retry, signals, the lock). No model, no billing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { failReason } from '../arms-lib.mjs';
import { readInflight } from '../arms-journal.mjs';
import { cleanup, fakeArms, fakeClaude, fakePrompts, fakeRepo, tmp } from './helpers/arms-fixtures.mjs';
import { argvOf, drive, start } from './helpers/arms-drive.mjs';
import { alive, costTranscript, jsonl, leftOpen, until, withLedger } from './helpers/arms-safety.mjs';
import * as F from './helpers/stream-fixtures.mjs';

after(cleanup);

test('1: the case is written to inflight.jsonl, charged the whole budget, before the host is spawned', async () => {
  const out = tmp('pa-arms-out-');
  const r = await drive({ out, claude: fakeClaude({ watch: path.join(out, 'inflight.jsonl') }), arms: fakeArms(['A']), args: { '--limit': 1 } });
  assert.equal(r.code, 0, r.stderr);
  const seen = readInflight(r.calls[0].inflight);
  assert.equal(seen.length, 1, 'only the started record existed when the host began');
  assert.deepEqual({ prompt: seen[0].prompt, arm: seen[0].arm, started: seen[0].started, chargeUsd: seen[0].chargeUsd }, { prompt: 'p1', arm: 'A', started: true, chargeUsd: 1 });
});

test('1: the cost is written the moment the host exits, before scoring starts', async () => {
  const out = tmp('pa-arms-out-');
  const probe = path.join(tmp(), 'probe.txt');
  Object.assign(process.env, { PA_PROBE_FROM: path.join(out, 'inflight.jsonl'), PA_PROBE_TO: probe });
  try {
    const r = await drive({ out, arms: fakeArms(['A']), args: { '--limit': 1 } });
    assert.equal(r.code, 0, r.stderr);
  } finally {
    delete process.env.PA_PROBE_FROM;
    delete process.env.PA_PROBE_TO;
  }
  const atScoring = readInflight(fs.readFileSync(probe, 'utf8'));
  assert.deepEqual(atScoring.map((x) => Object.keys(x).filter((k) => k === 'started' || k === 'unscored')[0]), ['started', 'unscored']);
  assert.equal(atScoring[1].chargeUsd, 0.9);
});

test('1: a scoring that throws after a billed session is a recorded failure with its cost, not a lost case', async () => {
  const dir = tmp('pa-arms-prompts-');
  fs.writeFileSync(path.join(dir, 'motion-budget.json'), JSON.stringify([{ id: 'p1', prompt: 'Make film p1.', expect: [''] }]));
  const r = await drive({ prompts: dir, arms: fakeArms(['A']) });
  assert.equal(r.code, 0, r.stderr);
  const [c] = r.ledger().cases;
  assert.match(c.scoringError, /expect/);
  assert.equal(c.chargeUsd, 0.9);
  assert.equal(failReason(c), 'scoring failed');
  assert.match(r.stdout, /scoring failed/);
});

test('1: a workdir that cannot be removed does not lose a paid case: it is recorded, naming the leftover', async () => {
  const r = await drive({ claude: fakeClaude({ locked: true }), arms: fakeArms(['A']), args: { '--limit': 1 } });
  const work = r.calls[0].cwd;
  try {
    assert.equal(r.code, 0, r.stderr);
    const [c] = r.ledger().cases;
    assert.equal(c.chargeUsd, 0.9);
    assert.equal(failReason(c), null, 'the case itself is fine');
    assert.equal(path.basename(c.workdirLeft), path.basename(work));
    assert.match(r.stdout, /workdir left behind/);
  } finally {
    fs.chmodSync(path.join(work, 'locked'), 0o700);
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('1: a resume charges a case that started and never finished its transcript cost, records it interrupted and does not rerun it', async () => {
  const r = await drive({ args: { '--resume': true }, pre: leftOpen({ transcript: costTranscript(0.7) }) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.calls.length, 3, 'p1 A is not run again');
  const { cases, spentUsd } = r.ledger();
  assert.deepEqual(cases.map((c) => c.prompt + c.arm), ['p1A', 'p1D', 'p2D', 'p2A']);
  assert.equal(cases[0].interrupted, true);
  assert.equal(cases[0].chargeUsd, 0.7);
  assert.equal(failReason(cases[0]), 'interrupted');
  assert.ok(Math.abs(spentUsd - 3.4) < 1e-9);
  assert.match(r.stdout, /p1 A started and never finished: recorded interrupted, charged 0\.70/);
  assert.match(fs.readFileSync(path.join(r.out, 'cases', 'p1', 'A', 'transcript.txt'), 'utf8'), /"total_cost_usd":0.7/, 'a resume deletes no transcript');
});

test('1: with no cost in its transcript the case is charged the whole budget', async () => {
  const r = await drive({ args: { '--resume': true }, pre: leftOpen({ transcript: F.lines([F.init()]) }) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.ledger().cases[0].chargeUsd, 1);
  const none = await drive({ args: { '--resume': true }, pre: leftOpen({}) });
  assert.equal(none.ledger().cases[0].chargeUsd, 1, 'no transcript at all');
});

test('1: an open case counts against the ceiling: 19.00 left open plus a 1.10 reserve does not fit under 20', async () => {
  const r = await drive({ args: { '--resume': true, '--max-total': 20 }, pre: leftOpen({ budget: 19, transcript: costTranscript(0.5) }) });
  assert.equal(r.code, 0, 'charged 0.50 (the transcript), so there is room');
  const full = await drive({ args: { '--resume': true, '--max-total': 20 }, pre: leftOpen({ budget: 19 }) });
  assert.equal(full.code, 3);
  assert.equal(full.calls.length, 0);
  assert.match(full.stderr, /ceiling reached: 19\.00 USD spent/);
});

test('1: --retry reruns an interrupted case, renames its folder aside, and its charge adds to the old one', async () => {
  const r = await drive({ args: { '--resume': true, '--retry': 'p1:A' }, pre: leftOpen({ transcript: costTranscript(0.7) }) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.calls.length, 4);
  const { cases, spentUsd } = r.ledger();
  assert.deepEqual(cases.map((c) => c.prompt + c.arm), ['p1A', 'p1A', 'p1D', 'p2D', 'p2A']);
  assert.ok(Math.abs(spentUsd - 4.3) < 1e-9, `0.7 + 4 x 0.9, got ${spentUsd}`);
  assert.match(fs.readFileSync(path.join(r.out, 'cases', 'p1', 'A.old-1', 'transcript.txt'), 'utf8'), /"total_cost_usd":0.7/, 'the old transcript is moved aside, not deleted');
  assert.match(fs.readFileSync(path.join(r.out, 'cases', 'p1', 'A', 'transcript.txt'), 'utf8'), /"total_cost_usd":0.9/);
});

test('1: --retry needs --resume and a <prompt>:<arm> that this run planned and has already recorded', async () => {
  const bad = [
    [{ '--retry': 'p1:A' }, undefined, /--retry needs --resume/],
    [{ '--resume': true, '--retry': 'p1' }, undefined, /<prompt>:<arm>/],
    [{ '--resume': true, '--retry': 'p9:A' }, withLedger({ prompt: 'p1', arm: 'A', chargeUsd: 1 }), /p9:A is not a case of this plan/],
    [{ '--resume': true, '--retry': 'p2:A' }, withLedger({ prompt: 'p1', arm: 'A', chargeUsd: 1 }), /p2:A has no earlier record/],
  ];
  for (const [args, pre, pattern] of bad) {
    const r = await drive({ args, pre });
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.match(r.stderr, pattern);
    assert.equal(r.calls.length, 0);
  }
});

test('1: --retry runs again only a case that is interrupted, a host fault or a scoring failure, never a finished result', async () => {
  const good = { prompt: 'p1', arm: 'A', chargeUsd: 1, specExists: true, mp4: true, checkOk: true, timedOut: false, capped: false };
  const finishedResults = [['a success', good], ['a timeout', { ...good, timedOut: true }], ['a budget cap', { ...good, capped: true }], ['a failed check', { ...good, checkOk: false }]];
  for (const [what, record] of finishedResults) {
    const r = await drive({ args: { '--resume': true, '--retry': 'p1:A' }, pre: withLedger(record) });
    assert.equal(r.code, 2, what);
    assert.match(r.stderr, /p1:A is not interrupted, a host fault or a scoring failure: re-running a finished result would re-roll it/, what);
    assert.equal(r.calls.length, 0, what);
  }
  const again = await drive({ args: { '--resume': true, '--retry': 'p1:A' }, pre: withLedger({ ...good, interrupted: true }, good) });
  assert.equal(again.code, 2, 'the latest record decides: a retry that succeeded is not run a second time');
  const scoring = await drive({ args: { '--resume': true, '--retry': 'p1:A' }, pre: withLedger({ ...good, scoringError: 'boom' }) });
  assert.equal(scoring.code, 0, scoring.stderr);
  assert.equal(scoring.calls.length, 4);
});

test('1: a case folder a run left is moved aside, never deleted, when the case runs again', async () => {
  const out = tmp('pa-arms-out-');
  const stale = path.join(out, 'cases', 'p1', 'A');
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'transcript.txt'), 'earlier try');
  const r = await drive({ out, arms: fakeArms(['A']), args: { '--limit': 1 } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(stale, '..', 'A.old-1', 'transcript.txt'), 'utf8'), 'earlier try');
});

// --- 2: signals and the lock ----------------------------------------------------------------------------------------------------

test('2: SIGINT kills the running host, keeps its transcript, records the case interrupted and exits 130', { timeout: 30000 }, async () => {
  const claude = fakeClaude({ hang: true });
  const before = process.listenerCount('SIGINT') + process.listenerCount('SIGTERM');
  const run = start({ claude, arms: fakeArms(['A']) });
  const transcript = path.join(run.out, 'cases', 'p1', 'A', 'transcript.txt');
  try {
    await until(() => claude.calls().length > 0 && fs.existsSync(transcript) && fs.readFileSync(transcript, 'utf8').includes('"subtype":"init"'), 'the host runs and its transcript is on disk');
    process.emit('SIGINT');
    assert.equal(await run.done, 130);
  } finally {
    for (const c of claude.calls()) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  const [c] = run.ledger().cases;
  assert.equal(c.interrupted, true);
  assert.equal(c.chargeUsd, 1, 'no cost event: the whole budget');
  assert.equal(failReason(c), 'interrupted');
  assert.equal(claude.calls().length, 1, 'the second case never starts');
  assert.equal(alive(claude.calls()[0].pid), false, 'the host is dead');
  assert.match(fs.readFileSync(transcript, 'utf8'), /"subtype":"init"/);
  assert.match(run.stderr.text + run.stdout.text, /interrupted/);
  assert.equal(fs.existsSync(path.join(run.out, 'driver.lock')), false);
  assert.equal(process.listenerCount('SIGINT') + process.listenerCount('SIGTERM'), before, 'the handlers are removed');
});

test('2: SIGTERM does the same', { timeout: 30000 }, async () => {
  const claude = fakeClaude({ hang: true });
  const run = start({ claude, arms: fakeArms(['A']) });
  try {
    await until(() => claude.calls().length > 0, 'the host runs');
    process.emit('SIGTERM');
    assert.equal(await run.done, 130);
  } finally {
    for (const c of claude.calls()) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  assert.equal(run.ledger().cases[0].interrupted, true);
});

test('2: a real SIGTERM to a driver process kills the host\'s group, records the case and exits 130', { timeout: 30000 }, async () => {
  const claude = fakeClaude({ hang: true });
  const out = tmp('pa-arms-out-');
  const argv = argvOf({ arms: fakeArms(['A']), out });
  const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'arms-driver-proc.mjs');
  const child = spawn(process.execPath, [helper, JSON.stringify({ bin: claude.bin, repo: fakeRepo(), prompts: fakePrompts(), argv })], { stdio: 'ignore' });
  const closed = new Promise((res) => child.on('close', (code, sig) => res({ code, sig })));
  const transcript = path.join(out, 'cases', 'p1', 'A', 'transcript.txt');
  try {
    await until(() => claude.calls().length > 0 && fs.existsSync(transcript) && fs.readFileSync(transcript, 'utf8').includes('"subtype":"init"'), 'the host runs');
    child.kill('SIGTERM');
    assert.deepEqual(await closed, { code: 130, sig: null });
  } finally {
    child.kill('SIGKILL');
    for (const c of claude.calls()) { try { process.kill(c.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  assert.equal(alive(claude.calls()[0].pid), false, 'the host is dead');
  const [c] = jsonl(path.join(out, 'cases.jsonl'));
  assert.equal(c.interrupted, true);
  assert.equal(c.chargeUsd, 1);
  assert.equal(fs.existsSync(path.join(out, 'driver.lock')), false);
});

test('2: a second live driver on the same out folder is refused; the lock is released at the end', async () => {
  const live = await drive({ pre: (out) => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'driver.lock'), `${process.pid}\n`); } });
  assert.equal(live.code, 2);
  assert.match(live.stderr, new RegExp(`another driver \\(pid ${process.pid}\\)`));
  assert.equal(live.calls.length, 0);
  assert.equal(fs.readFileSync(path.join(live.out, 'driver.lock'), 'utf8').trim(), String(process.pid), 'the holder\'s lock is left alone');
  const ok = await drive({ args: { '--limit': 1 } });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(fs.existsSync(path.join(ok.out, 'driver.lock')), false);
});

test('2: a stale lock whose pid is dead is taken over', async () => {
  const dead = Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
  const r = await drive({ args: { '--limit': 1 }, pre: (out) => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'driver.lock'), `${dead}\n`); } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.calls.length, 2);
  assert.equal(fs.existsSync(path.join(r.out, 'driver.lock')), false);
});
