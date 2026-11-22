// The planted-defect films for the second reviewer. No browser, no model: the films validate, each bad film differs
// from the good one only at its planted shot, and the skill's reviewing.md names the reviewer only after a recorded pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFilm } from '../../skills/make-motion/scripts/v2/spec.mjs';
// The registries fill by side effect, as in make-motion's own tests.
import '../../skills/make-motion/engine/looks/index.mjs';
import '../../skills/make-motion/engine/modes/index.mjs';
import '../../skills/make-motion/engine/devices/index.mjs';
import '../../skills/make-motion/engine/kinds/index.mjs';
import '../../skills/make-motion/engine/cuts/index.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const evalDir = path.resolve(here, '..');
const specDir = path.join(evalDir, 'fixtures/review');
const mm = path.resolve(evalDir, '../skills/make-motion');
const read = (name) => JSON.parse(fs.readFileSync(path.join(specDir, `${name}.json`), 'utf8'));
const PLANTED = read('planted');
const FIXTURES = ['good', ...Object.keys(PLANTED)];

// The shot ids whose content differs between two films, added or removed ones included. Root fields must match.
function changedShots(a, b) {
  const { shots: sa, ...rootA } = a;
  const { shots: sb, ...rootB } = b;
  assert.deepEqual(rootA, rootB, 'the root fields are the same');
  const byId = (shots) => new Map(shots.map((s) => [s.id, JSON.stringify(s)]));
  const ma = byId(sa);
  const mb = byId(sb);
  const ids = [...new Set([...ma.keys(), ...mb.keys()])];
  return ids.filter((id) => ma.get(id) !== mb.get(id));
}

test('the five films validate, and each bad film differs from the good one only at its planted shot', () => {
  for (const name of FIXTURES) assert.deepEqual(validateFilm(read(name), { specDir }).errors, [], name);
  for (const [name, { shot }] of Object.entries(PLANTED)) assert.deepEqual(changedShots(read('good'), read(name)), [shot], name);
});

test('planted.json names four films, each with one shot that exists in that film', () => {
  assert.deepEqual(Object.keys(PLANTED).sort(), ['chart-wrong-mark', 'number-mismatch', 'orphan-shot', 'picture-contradicts']);
  for (const [name, { shot }] of Object.entries(PLANTED)) {
    assert.deepEqual(Object.keys(PLANTED[name]), ['shot'], name);
    assert.ok(read(name).shots.some((s) => s.id === shot), `${name} has a shot ${shot}`);
  }
});

test('the good film is silent, has four shots with the ids claim, figure, chart and ask, and one highlighted mark', () => {
  const good = read('good');
  assert.equal(good.look, 'desk');
  assert.equal(good.voice, undefined, 'the voice package is not installed where this runs: the films are silent');
  assert.deepEqual(good.shots.map((s) => [s.id, s.show]), [['claim', 'statement'], ['figure', 'number'], ['chart', 'chart'], ['ask', 'end']]);
  const chart = good.shots[2];
  assert.equal(chart.data.filter((d) => d.label === chart.highlight).length, 1);
  const peak = chart.data.reduce((m, d) => (d.value > m.value ? d : m));
  assert.equal(chart.highlight, peak.label, 'the good chart highlights the month its narration names');
  for (const s of good.shots) assert.ok(s.say, `${s.id} has a line`);
});

test('the good film is true: its number is the drop from the chart peak to the last month, so only the planted defects are wrong', () => {
  const good = read('good');
  const { data } = good.shots.find((s) => s.id === 'chart');
  const peak = Math.max(...data.map((d) => d.value));
  const last = data.at(-1).value;
  assert.equal(Math.round(((peak - last) / peak) * 100), good.shots.find((s) => s.id === 'figure').value);
  assert.ok(data.slice(data.findIndex((d) => d.value === peak) + 1).every((d) => d.value < peak), 'every month after the peak is lower');
});

test('each defect is the one the brief names', () => {
  const good = read('good');
  const figure = (f) => read(f).shots.find((s) => s.id === 'figure');
  assert.equal(good.shots[1].value, 42);
  assert.match(figure('number-mismatch').say, /forty two percent/i);
  assert.equal(figure('number-mismatch').value, 24);

  const chart = read('chart-wrong-mark').shots.find((s) => s.id === 'chart');
  assert.match(chart.say, /March was the peak/);
  assert.equal(chart.highlight, 'May');

  const look = read('picture-contradicts').shots.find((s) => s.id === 'look');
  assert.equal(look.show, 'clipping');
  assert.equal(look.src, 'two-squares.png');
  assert.match(look.say, /the red button/);
  const [x, y, w, h] = look.regions[look.on[0].target.replace('region:', '')];
  // the picture is 1280x720: red top left (154..442, 86..374), blue bottom right (838..1126, 346..634)
  const centre = [(x + w / 2) * 1280, (y + h / 2) * 720];
  assert.ok(centre[0] > 838 && centre[0] < 1126 && centre[1] > 346 && centre[1] < 634, 'the highlight is on the blue square');

  const orphan = read('orphan-shot').shots.map((s) => s.id);
  assert.deepEqual(orphan, ['claim', 'figure', 'chart', 'aside', 'ask'], 'aside sits between chart and ask');
  assert.deepEqual(read('picture-contradicts').shots.map((s) => s.id), ['claim', 'figure', 'chart', 'look', 'ask']);
});

test('two-squares.png is a 1280x720 PNG', () => {
  const buf = fs.readFileSync(path.join(specDir, 'two-squares.png'));
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(buf.readUInt32BE(16), 1280);
  assert.equal(buf.readUInt32BE(20), 720);
  assert.ok(buf.length < 100_000, 'a flat picture stays small');
});

// A summary is copied to results/ whether the proof passed or failed (the failed branch of Step 7 keeps the numbers), so
// only one that says PASSED counts as a recorded pass.
const recordedPass = (files) => files.some(({ name, text }) => /^summary-motion-reviewer-.*\.md$/.test(name) && text.includes('**PASSED**'));

test('references/reviewing.md names the reviewer only once a passing proof is recorded', () => {
  const text = fs.readFileSync(path.join(mm, 'references/reviewing.md'), 'utf8');
  const dir = path.join(evalDir, 'results');
  // results/ also holds the (gitignored) timestamp folders of real runs: read only the committed summaries
  const files = fs.readdirSync(dir).filter((name) => /^summary-.*\.md$/.test(name)).map((name) => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
  assert.equal(text.includes('motion-reviewer'), recordedPass(files));
});

test('a failed proof summary is not a recorded pass; a passed one is', () => {
  const name = 'summary-motion-reviewer-2026-12-01.md';
  assert.equal(recordedPass([{ name, text: '- **FAILED**. Defects found per film: ...' }]), false);
  assert.equal(recordedPass([{ name, text: '- **PASSED**. Defects found per film: ...' }]), true);
  assert.equal(recordedPass([{ name: 'summary-other.md', text: '**PASSED**' }]), false, 'only the reviewer summaries count');
  assert.equal(recordedPass([]), false);
});
