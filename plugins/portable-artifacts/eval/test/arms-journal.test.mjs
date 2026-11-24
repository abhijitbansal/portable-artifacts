// The arms driver's crash journal (arms-journal.mjs): the in-flight ledger, the cases it leaves open, and the driver lock.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { appendDurable, caseDirOf, interruptedRecord, openAttempts, readInflight, takeLock } from '../arms-journal.mjs';
import { failReason, readLedger } from '../arms-lib.mjs';
import { cleanup, tmp } from './helpers/arms-fixtures.mjs';

after(cleanup);

const started = (prompt, arm, chargeUsd = 1) => ({ prompt, arm, started: true, chargeUsd });
const unscored = (prompt, arm, chargeUsd) => ({ prompt, arm, unscored: true, chargeUsd });
const finished = (prompt, arm) => ({ prompt, arm, chargeUsd: 0.5 });

test('appendDurable adds one whole JSON line per call, creating the file', () => {
  const file = path.join(tmp(), 'inflight.jsonl');
  appendDurable(file, { a: 1 });
  appendDurable(file, { b: 2 });
  assert.equal(fs.readFileSync(file, 'utf8'), '{"a":1}\n{"b":2}\n');
});

test('readInflight: records in order; a half-written last line is dropped, a bad middle line throws and names it', () => {
  const lines = [JSON.stringify(started('p1', 'A')), JSON.stringify(unscored('p1', 'A', 0.4))];
  assert.deepEqual(readInflight(`${lines.join('\n')}\n{"prompt":"p2","ar`), [started('p1', 'A'), unscored('p1', 'A', 0.4)]);
  assert.deepEqual(readInflight(''), []);
  assert.throws(() => readInflight(`${lines[0]}\nnot json\n${lines[1]}\n`), /inflight\.jsonl line 2/);
  assert.throws(() => readInflight('[1]\n'), /inflight\.jsonl line 1/);
});

test('openAttempts: a started case with no finished record is open, with its unscored cost when it got that far', () => {
  const inflight = [started('p1', 'A'), unscored('p1', 'A', 0.4), started('p1', 'D'), started('p2', 'D')];
  const open = openAttempts(inflight, [finished('p1', 'A')]);
  assert.deepEqual(open.map((o) => `${o.started.prompt}${o.started.arm}`), ['p1D', 'p2D']);
  assert.equal(open.every((o) => o.unscored === null), true);
  const open2 = openAttempts(inflight, []);
  assert.deepEqual(open2.map((o) => `${o.started.prompt}${o.started.arm}`), ['p1A', 'p1D', 'p2D']);
  assert.equal(open2[0].unscored.chargeUsd, 0.4);
});

test('openAttempts: a retry is a second started record; it is open when only the first attempt has a finished record', () => {
  const inflight = [started('p1', 'A'), unscored('p1', 'A', 0.4), started('p1', 'A')];
  assert.equal(openAttempts(inflight, [finished('p1', 'A')]).length, 1);
  assert.equal(openAttempts(inflight, [finished('p1', 'A'), finished('p1', 'A')]).length, 0);
  assert.equal(openAttempts(inflight, [finished('p1', 'A')])[0].unscored, null, 'the unscored record of the first attempt is not the second\'s');
});

test('openAttempts: cases with no started record (a ledger from before the journal) open nothing', () => {
  assert.deepEqual(openAttempts([], [finished('p1', 'A')]), []);
});

test('interruptedRecord: charged the unscored cost, else the transcript cost, else the whole budget; a failed case that readLedger accepts', () => {
  const s = started('p1', 'A', 1);
  assert.equal(interruptedRecord({ started: s, unscored: unscored('p1', 'A', 0.4) }, 0.7).chargeUsd, 0.4);
  assert.equal(interruptedRecord({ started: s, unscored: null }, 0.7).chargeUsd, 0.7);
  const none = interruptedRecord({ started: s, unscored: null }, null);
  assert.equal(none.chargeUsd, 1);
  assert.equal(none.interrupted, true);
  assert.equal(none.usage.costUsd, null);
  assert.equal(failReason(none), 'interrupted');
  assert.equal(readLedger(`${JSON.stringify(none)}\n`).spentUsd, 1);
  const fault = interruptedRecord({ started: s, unscored: { ...unscored('p1', 'A', 0.3), hostFault: 'result is_error' } }, 0.3);
  assert.equal(fault.hostFault, 'result is_error');
});

test('caseDirOf is <out>/cases/<prompt>/<arm>', () => {
  assert.equal(caseDirOf('/o', 'p1', 'A'), path.join('/o', 'cases', 'p1', 'A'));
});

const deadPid = () => {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(r.stdout);
};

test('takeLock writes the pid, refuses a live holder naming it, and releases only its own lock', () => {
  const file = path.join(tmp(), 'driver.lock');
  const release = takeLock(file);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), String(process.pid));
  assert.throws(() => takeLock(file), (e) => e.holder === process.pid && /driver\.lock/.test(e.message));
  release();
  assert.equal(fs.existsSync(file), false);
  const other = takeLock(file, { pid: 4242, alive: () => false });
  fs.writeFileSync(file, '777\n');
  other();
  assert.equal(fs.existsSync(file), true, 'a lock now held by another pid is not removed');
});

test('takeLock takes over a stale lock whose pid is dead, and one with no readable pid', () => {
  const dir = tmp();
  const file = path.join(dir, 'driver.lock');
  fs.writeFileSync(file, `${deadPid()}\n`);
  const release = takeLock(file);
  assert.equal(fs.readFileSync(file, 'utf8').trim(), String(process.pid));
  release();
  fs.writeFileSync(file, '');
  takeLock(file)();
  assert.equal(fs.existsSync(file), false);
});
