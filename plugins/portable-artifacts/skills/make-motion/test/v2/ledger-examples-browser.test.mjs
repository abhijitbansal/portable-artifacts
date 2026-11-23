// The `ledger` look (experimental) against the review rules in the page: every kind's example (as --list kinds prints
// it) that ledger ships unparked, in pro at 16:9 and 9:16, reviewed at the sheet moments, comes back with no finding
// beyond those in KNOWN, and no page error. The kinds come from the registry, not from a listing: a hidden look is in none, so a sweep built on
// listEntries(...).looks would test nothing (the count is asserted). Run with --test-concurrency=1; skips without a
// browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { supportsKind, isParkedKind } from '../../engine/looks/index.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { reviewFilm } from '../../scripts/v2/review.mjs';
import { sessionOrNull } from './helpers/session.mjs';

const FPS = 30;
const FORMATS = Object.freeze(['16:9', '9:16']);
const look = registries.looks.get('ledger');
const SHIPPED = registries.kinds.names().filter((kind) => supportsKind(look, kind) && !isParkedKind(look, kind));
const exampleOf = (kind) => listEntries('kinds').find((e) => e.name === kind)?.example ?? registries.kinds.get(kind).example;
// The composition findings (W2 Task 3) ledger gives on a kind's example, by "<kind> <format>", as "<kind> <rule> <path>"; the
// examples are shared with the other looks, so their copy stays:
// - free: one 80-unit bar on an empty page (the kind's minimal example): dead-space is right;
// - diagram 16:9: three small boxes in one row, 43% of the height bare above and below (the same frame as keynote's, which
//   was viewed): dead-space is right;
// - timeline 9:16: viewed (.scratch/motion-steals-w2/t3/png-ledger/history.png), three years in a column hugging the
//   left rule, the right 48% of the width bare: dead-space is right.
// (Ledger's band is 0.40: its timeline 16:9 at 36% bare above, not viewed, and its left-flush statement 16:9 with 39% of the
// width bare, viewed and read filled, are not findings.)
const KNOWN = Object.freeze({
  'free 16:9': ['creative dead-space shots[0]'],
  'free 9:16': ['creative dead-space shots[0]'],
  'diagram 16:9': ['creative dead-space shots[0]'],
  'timeline 9:16': ['creative dead-space shots[0]'],
});

// A striped PNG, built by hand so a browser can decode it: a stand-in screenshot.
function stripedPng(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Array.from({ length: h }, (_, y) => Buffer.concat([Buffer.from([0]), ...Array.from({ length: w }, () => Buffer.from(Math.floor(y / 10) % 2 ? [40, 90, 200] : [235, 240, 245]))]));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-ledger-examples-'));
  mkdirSync(path.join(specDir, 'assets'));
  // as wide as the node helper's shot.png: the screen kind's zoom asks for a picture at least 1560 px wide at 9:16
  writeFileSync(path.join(specDir, 'assets', 'screenshot.png'), stripedPng(1600, 1000));
});
after(() => rmSync(specDir, { recursive: true, force: true }));

test('the sweep covers every kind ledger ships: sixteen less the one it parks (number)', () => {
  assert.equal(SHIPPED.length, 15);
  assert.deepEqual(registries.kinds.names().filter((kind) => isParkedKind(look, kind)), ['number']);
});

for (const format of FORMATS) {
  for (const kind of SHIPPED) {
    test(`look ledger: the ${kind} example at ${format} has only its known findings`, async (t) => {
      const film = { version: 2, mode: 'pro', look: 'ledger', format, fps: FPS, seed: 3, shots: [exampleOf(kind)] };
      const session = await sessionOrNull(film, { specDir });
      if (!session) { t.skip('no browser'); return; }
      t.after(() => session.close());
      const findings = await reviewFilm({ session });
      assert.deepEqual(findings.map((f) => `${f.kind} ${f.rule} ${f.path}`), KNOWN[`${kind} ${format}`] ?? [], findings.map((f) => f.message).join('\n'));
      assert.deepEqual(session.errors, []);
    });
  }
}
