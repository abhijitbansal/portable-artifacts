// The arms driver's crash safety. A billed session is written down before it starts (<out>/inflight.jsonl, charged the whole
// budget) and its cost is written down the moment the host exits, before scoring, so a driver that dies anywhere in between leaves
// the spend on disk. A resume reads what was left open and charges it. <out>/driver.lock holds the pid of the live driver.
import fs from 'node:fs';
import path from 'node:path';
import { blankCase } from './arms-lib.mjs';
import { readSession } from './session.mjs';

export const caseDirOf = (out, prompt, arm) => path.join(out, 'cases', prompt, arm);

/** Append one JSON line and force it to disk before returning: the record must survive the driver being killed next. */
export function appendDurable(file, record) {
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeSync(fd, `${JSON.stringify(record)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/** The two records a case leaves in inflight.jsonl, bound to one case. */
export function makeJournal(file, { prompt, arm, budget }) {
  const stamp = () => new Date().toISOString();
  return {
    started: () => appendDurable(file, { prompt, arm, started: true, chargeUsd: budget, ts: stamp() }),
    unscored: (info) => appendDurable(file, { prompt, arm, unscored: true, ...info, ts: stamp() }),
  };
}

/** The records of inflight.jsonl, in order. A half-written last line (a driver killed mid-write) is dropped; any other bad line throws. */
export function readInflight(text) {
  const lines = text.split('\n');
  const last = lines.findLastIndex((l) => l.trim() !== '');
  const records = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      if (i === last) return;
      throw new Error(`inflight.jsonl line ${i + 1} is not JSON`);
    }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec) || typeof rec.prompt !== 'string' || typeof rec.arm !== 'string') {
      throw new Error(`inflight.jsonl line ${i + 1} is not a record (prompt, arm)`);
    }
    records.push(rec);
  });
  return records;
}

const keyOf = (r) => `${r.prompt}\u0000${r.arm}`;

/**
 * The attempts that started and have no finished record: a case's started records outnumber its finished ones, and the last
 * started record is the open one. -> [{ started, unscored }], `unscored` the host-exit record that followed it or null. A ledger
 * from before the journal has no started records and so opens nothing.
 */
export function openAttempts(inflight, cases) {
  const startedCount = new Map();
  const last = new Map();
  for (const rec of inflight) {
    const key = keyOf(rec);
    if (rec.started) {
      startedCount.set(key, (startedCount.get(key) ?? 0) + 1);
      last.set(key, { started: rec, unscored: null });
    } else if (rec.unscored && last.has(key)) {
      last.get(key).unscored = rec;
    }
  }
  const finishedCount = new Map();
  for (const c of cases) finishedCount.set(keyOf(c), (finishedCount.get(keyOf(c)) ?? 0) + 1);
  return [...last].filter(([key]) => startedCount.get(key) > (finishedCount.get(key) ?? 0)).map(([, attempt]) => attempt);
}

/**
 * The failed-case record for an attempt that never finished: charged what its host-exit record says, else the cost in its
 * transcript (`transcriptCostUsd`), else the whole budget it started with. It keeps a host fault the host-exit record found.
 */
export function interruptedRecord({ started, unscored }, transcriptCostUsd) {
  const known = Number.isFinite(transcriptCostUsd) ? transcriptCostUsd : null;
  const chargeUsd = Number.isFinite(unscored?.chargeUsd) ? unscored.chargeUsd : known ?? started.chargeUsd;
  return {
    ...blankCase(started.prompt, started.arm),
    interrupted: true, recovered: true, chargeUsd, usage: { costUsd: known }, hostFault: unscored?.hostFault ?? null,
    seconds: unscored?.seconds ?? 0, timedOut: unscored?.timedOut === true, capped: unscored?.capped === true, exit: unscored?.exit ?? null,
  };
}

/** The cost event in a case's transcript, or null (no transcript, an unreadable one, or none was reached). Never deletes anything. */
function transcriptCost(caseDir) {
  return readSession(path.join(caseDir, 'transcript.txt')).usage?.costUsd ?? null;
}

/** One interrupted-case record for every attempt left open by an earlier driver. */
export function recoverOpen({ out, inflight, cases }) {
  return openAttempts(inflight, cases).map((attempt) => interruptedRecord(attempt, transcriptCost(caseDirOf(out, attempt.started.prompt, attempt.started.arm))));
}

// --- the driver lock ---------------------------------------------------------------------------------------------------------

const pidAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};

function lockHeld(file, holder) {
  return Object.assign(new Error(`another driver (pid ${holder}) holds ${file}; wait for it, or delete the lock if that process is gone`), { holder });
}

/**
 * Create `file` holding this pid, or throw an error with `.holder` when a live process holds it. A lock whose pid is dead (or
 * unreadable) is stale and is taken over. -> a function that removes the lock, if it is still this driver's.
 */
export function takeLock(file, { pid = process.pid, alive = pidAlive } = {}) {
  let holder = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, `${pid}\n`, { flag: 'wx' });
      return () => {
        if (fs.existsSync(file) && Number.parseInt(fs.readFileSync(file, 'utf8'), 10) === pid) fs.rmSync(file, { force: true });
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    holder = Number.parseInt(fs.readFileSync(file, 'utf8'), 10);
    if (Number.isInteger(holder) && alive(holder)) throw lockHeld(file, holder);
    fs.rmSync(file, { force: true });
  }
  throw lockHeld(file, holder);
}
