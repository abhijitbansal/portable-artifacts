// make.mjs <film> --shot <id> / --range <from>..<to>: the sheets and the review of a slice. [browser] One at a time: run with
// --test-concurrency=1; skips without a browser. The sheets of a slice are the full run's, byte for byte (the page seeks by
// absolute frame), only the slice's sheets are rewritten, and no MP4 is made.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserAvailable } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs';
import { runMake } from '../../scripts/v2/run.mjs';

const BAR = (id, y) => ({ type: 'path', id, props: { d: `M300 ${y}H1620V${y + 80}H300Z`, fill: '#ffe14a' } });
// the desk look (paper grain on): three still shots; b comes in on a 0.4 s slide, so the strip into b has a window
const FILM = { version: 2, mode: 'pro', look: 'desk', fps: 30, shots: [
  { id: 'a', show: 'free', hold: 2, nodes: [BAR('bar-a', 300)] },
  { id: 'b', show: 'free', hold: 2, cut: { type: 'slide', duration: 0.4 }, nodes: [BAR('bar-b', 500)] },
  { id: 'c', show: 'free', hold: 2, nodes: [BAR('bar-c', 700)] },
] };

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-slice-sheets-'));
  writeFileSync(path.join(dir, 'film.json'), JSON.stringify(FILM));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const SHEETS = () => path.join(dir, 'out', 'film.sheets');
const run = (extra) => runMake({ specPath: path.join(dir, 'film.json'), out: null, noRender: true, ...extra });
const sheetNames = () => readdirSync(SHEETS()).filter((n) => n.endsWith('.png')).sort();
const bytes = (name) => readFileSync(path.join(SHEETS(), name));

test('the sheets of --shot b are the full run\'s sheets, byte for byte; the other sheets are left alone; no MP4', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const full = await run({});
  assert.equal(full.exitCode, 0, JSON.stringify(full.report.findings));
  assert.deepEqual(sheetNames(), ['a.png', 'b.png', 'c.png', 'cut-a-b.png', 'cut-b-c.png']);
  const [b, strip] = [bytes('b.png'), bytes('cut-a-b.png')];
  const marker = Buffer.from('left as the last run made it');
  for (const name of ['a.png', 'b.png', 'cut-a-b.png']) writeFileSync(path.join(SHEETS(), name), name === 'a.png' ? marker : 'stale');
  const part = await run({ shot: 'b' });
  assert.equal(part.exitCode, 0, JSON.stringify(part.report.findings));
  assert.deepEqual(part.report.sheets.map((f) => path.basename(f)), ['b.png', 'cut-a-b.png']);
  assert.ok(bytes('b.png').equals(b), 'b.png is the full run\'s b.png');
  assert.ok(bytes('cut-a-b.png').equals(strip), 'the strip into b is the full run\'s');
  assert.ok(bytes('a.png').equals(marker), 'a.png was not rewritten');
  assert.deepEqual(sheetNames(), ['a.png', 'b.png', 'c.png', 'cut-a-b.png', 'cut-b-c.png'], 'nothing was deleted');
  assert.equal(part.report.output, null);
  assert.equal(existsSync(path.join(dir, 'out', 'film.mp4')), false, 'no MP4');
  assert.deepEqual(part.report.slice, { from: 60, to: 119, frames: 60, shots: ['b'], silent: false, skipped: ['loop', 'cut-variety', 'sameness'] });
  return undefined;
});

test('--range names its frames in the report, writes the sheets of the shots it touches and a strip whose window starts inside it', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const whole = Buffer.from('the whole sheets of the last full run');
  for (const name of ['a.png', 'b.png']) writeFileSync(path.join(SHEETS(), name), whole);
  const part = await run({ range: 'a@1..b@0.5' });
  assert.equal(part.exitCode, 0, JSON.stringify(part.report.findings));
  assert.deepEqual(part.report.sheets.map((f) => path.basename(f)), ['a.partial-range-30-75.png', 'b.partial-range-30-75.png', 'cut-a-b.png']);
  assert.ok(bytes('a.png').equals(whole) && bytes('b.png').equals(whole), 'a partial sheet does not overwrite the full run\'s sheet');
  assert.ok(existsSync(path.join(SHEETS(), 'a.partial-range-30-75.png')));
  assert.deepEqual(part.report.slice, { from: 30, to: 75, frames: 46, shots: ['a', 'b'], silent: false, skipped: ['loop', 'cut-variety', 'sameness'] });
  assert.ok(part.report.stages.some((s) => s.name === 'review' && s.ok));
  return undefined;
});
