// Helpers shared by the arms driver's crash and guard tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as F from './stream-fixtures.mjs';

/** Wait until `ready()` is true (up to ten seconds), or fail naming `what`. */
export const until = async (ready, what) => {
  for (let i = 0; i < 200; i += 1) {
    if (ready()) return;
    await new Promise((res) => setTimeout(res, 50));
  }
  assert.fail(`never happened: ${what}`);
};

export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export const jsonl = (file) => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
export const costTranscript = (cost) => F.lines([F.init(), F.result({ cost })]);

/** What a driver killed in the middle of one case leaves: its started record, and a transcript when it got that far. */
export function leftOpen({ prompt = 'p1', arm = 'A', budget = 1, transcript } = {}) {
  return (out) => {
    fs.mkdirSync(path.join(out, 'cases', prompt, arm), { recursive: true });
    fs.writeFileSync(path.join(out, 'inflight.jsonl'), `${JSON.stringify({ prompt, arm, started: true, chargeUsd: budget })}\n`);
    if (transcript !== undefined) fs.writeFileSync(path.join(out, 'cases', prompt, arm, 'transcript.txt'), transcript);
  };
}

/** A cases.jsonl holding exactly these records. */
export const withLedger = (...records) => (out) => {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'cases.jsonl'), records.map((r) => `${JSON.stringify(r)}\n`).join(''));
};
