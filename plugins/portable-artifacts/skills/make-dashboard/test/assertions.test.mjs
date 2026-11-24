import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { expandCharts } from '../scripts/lib/views.mjs';
import { buildDashboard, chartData } from '../scripts/lib/pipeline.mjs';
import { compile } from 'vega-lite';
import * as vega from 'vega';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chart = {
  id: 'revenue', title: 'East earns the most revenue', query: 'q',
  kind: 'bar', x: 'region', y: 'revenue', assert: { type: 'max', category: 'East' },
};
const rows = (east, west) => [{ region: 'East', revenue: east }, { region: 'West', revenue: west }];
const result = (data, extra = {}) => ({ columns: ['region', 'revenue'], types: ['VARCHAR', 'DOUBLE'], rows: data, rowCount: data.length, truncated: false, ...extra });
const spec = (c = chart, sql = "SELECT * FROM (VALUES ('East', 90), ('West', 10)) AS t(region, revenue)") => ({ title: 'Sales', sources: {}, queries: { q: sql }, charts: [c] });
const expand = (data, extra = {}, c = chart) => expandCharts(spec(c), { q: result(data, extra) });

test('assertions are opt-in and a passing rule does not change any rendered view', () => {
  const { assert: ignored, ...plain } = chart;
  const data = rows(90, 10);
  const before = structuredClone(data);
  assert.deepEqual(expand(data), expand(data, {}, plain));
  assert.deepEqual(data, before, 'the render rows are unchanged');
  assert.deepEqual(expand(rows(10, 90), {}, plain).errors, [], 'a title alone remains unchecked');
  assert.deepEqual(expand(rows(-1, -9)).errors, [], 'negative maxima work');
  assert.deepEqual(expand(rows(0, -1)).errors, [], 'zero is a value');
  assert.deepEqual(expand([{ region: 'East', revenue: 1 }]).errors, []);
});

test('a false maximum names the expected category, actual winner and both values', () => {
  const out = expand(rows(10, 90));
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].path, 'charts[0].assert');
  assert.match(out.errors[0].message, /East.*10/);
  assert.match(out.errors[0].message, /West.*90/);
  assert.deepEqual(out.charts[0].views, [], 'do not expand a contradicted chart');
});

for (const [name, data, extra, message] of [
  ['tie at maximum', rows(90, 90), {}, /tie/i],
  ['tie at zero', rows(-0, 0), {}, /tie/i],
  ['missing category', [{ region: 'West', revenue: 90 }], {}, /East.*not found/i],
  ['case-sensitive category', [{ region: 'east', revenue: 90 }], {}, /East.*not found/i],
  ['empty result', [], {}, /no rows/i],
  ['truncated result', rows(90, 10), { truncated: true }, /truncated.*maxRows/i],
  ['duplicate category', [...rows(90, 10), { region: 'West', revenue: 100 }], {}, /duplicate.*West.*SQL/i],
  ['null category', [{ region: null, revenue: 1 }, ...rows(90, 10)], {}, /region.*string/i],
  ['boolean category', [{ region: true, revenue: 1 }, ...rows(90, 10)], {}, /region.*string/i],
  ['temporal category', rows(90, 10), { types: ['DATE', 'DOUBLE'] }, /categorical.*x/i],
  ['null value', rows(90, null), {}, /revenue.*finite number/i],
  ['nonfinite value', rows(90, Infinity), {}, /revenue.*finite number/i],
  ['NaN value', rows(90, NaN), {}, /revenue.*finite number/i],
  ['numeric string', rows('9007199254740993', '9007199254740992'), {}, /without.*precision/i],
  ['unsafe integer', rows(1e20, 90), {}, /without.*precision/i],
]) {
  test(`max assertion refuses ${name}`, () => {
    const errors = expand(data, extra).errors;
    assert.equal(errors.length, 1);
    assert.equal(errors[0].path, 'charts[0].assert');
    assert.match(errors[0].message, message);
  });
}

test('matching uses literal column names and category text', () => {
  const c = { ...chart, x: 'a.b', y: 'total[0]', assert: { type: 'max', category: '__proto__' } };
  const r = { columns: ['a.b', 'total[0]'], types: ['VARCHAR', 'DOUBLE'], rows: [{ 'a.b': '__proto__', 'total[0]': 9 }, { 'a.b': 'constructor', 'total[0]': 1 }], rowCount: 2, truncated: false };
  assert.deepEqual(expandCharts(spec(c), { q: r }).errors, []);
});

test('asserted bars preserve source columns that collide with rendering helpers in every view', async () => {
  for (const x of ['paClaim', 'paValueText', 'pa_total', 'pa_share']) {
    const y = x === 'paClaim' ? 'paValueText' : 'paClaim';
    const c = { ...chart, x, y, format: 'compact' };
    // Also reserve the first suffix: a generated name must avoid all source columns.
    const data = [{ [x]: 'East', [y]: 90, paClaim2: 'keep' }, { [x]: 'West', [y]: 10, paClaim2: 'keep' }];
    const r = { columns: [x, y, 'paClaim2'], types: ['VARCHAR', 'DOUBLE', 'VARCHAR'], rows: data, rowCount: 2, truncated: false };
    const out = expandCharts(spec(c), { q: r });
    assert.deepEqual(out.errors, []);
    for (const { name, vegaLite } of out.charts[0].views.filter((v) => v.vegaLite)) {
      const compiled = compile({ ...vegaLite, data: { values: data }, config: { range: { paHighlight: ['#000000', '#999999'] } } }).spec;
      const view = new vega.View(vega.parse(compiled), { renderer: 'none' });
      try {
        await view.runAsync();
        for (const mark of compiled.marks.filter((m) => ['rect', 'text'].includes(m.type))) {
          const drawn = view.data(mark.from.data);
          assert.equal(drawn.length, 2, `${x}/${name}/${mark.type}: both categories rendered`);
          assert.deepEqual(drawn.map((row) => [row[x], row[y], row.paClaim2]).sort(), [['East', 90, 'keep'], ['West', 10, 'keep']], `${x}/${name}/${mark.type}: plotted data survives`);
        }
      } finally { view.finalize(); }
    }
  }
});

test('assertion diagnostics expose invisible text without changing exact category matching', () => {
  const hidden = '\u202e';
  const x = `region${hidden}`;
  const y = `revenue${hidden}`;
  const c = { ...chart, x, y, query: `q${hidden}`, assert: { type: 'max', category: `East${hidden}` } };
  const r = { columns: [x, y], types: ['VARCHAR', 'DOUBLE'], rows: [{ [x]: c.assert.category, [y]: 10 }, { [x]: `West${hidden}`, [y]: 90 }], rowCount: 2, truncated: false };
  const check = (input) => expandCharts({ ...spec(c), queries: { [c.query]: 'SELECT 1' } }, { [c.query]: input }).errors;
  for (const input of [r, { ...r, rows: r.rows.slice(1) }, { ...r, rows: [...r.rows, r.rows[1]] }, { ...r, truncated: true }, { ...r, rows: [] }, { ...r, rows: [{ [x]: null, [y]: 1 }] }, { ...r, rows: [{ [x]: c.assert.category, [y]: null }] }]) {
    const errors = check(input);
    assert.equal(errors.length, 1);
    assert.ok(!errors[0].message.includes(hidden), 'no raw bidi control in diagnostics');
    assert.ok(errors[0].message.includes('\\u{202e}'), 'the hidden character is visible');
  }
  assert.deepEqual(check({ ...r, rows: [{ [x]: c.assert.category, [y]: 100 }, r.rows[1]] }), [], 'matching still uses exact source strings');
});

test('schema accepts only the explicit max rule on bar charts', async () => {
  assert.equal((await validateSpec(spec(), { dir: ROOT, stage: 'static' })).ok, true);
  for (const rule of [null, [], {}, { type: 'min', category: 'East' }, { type: 'max' }, { type: 'max', category: 1 }, { type: 'max', category: 'East', typo: true }]) {
    const out = await validateSpec(spec({ ...chart, assert: rule }), { dir: ROOT, stage: 'static' });
    assert.equal(out.ok, false, JSON.stringify(rule));
    assert.ok(out.errors.some((e) => e.path.startsWith('charts[0].assert')));
  }
  for (const c of [{ ...chart, kind: 'line' }, { ...chart, color: 'region' }, { id: 'raw', title: 'T', query: 'q', vegaLite: { mark: 'bar' }, assert: chart.assert }]) {
    const out = await validateSpec(spec(c), { dir: ROOT, stage: 'static' });
    assert.equal(out.ok, false);
    assert.ok(out.errors.some((e) => e.path === 'charts[0].assert'));
  }
});

test('bind checks structure; full validation checks the actual query result', async () => {
  const s = spec(chart, "SELECT * FROM (VALUES ('East', 10), ('West', 90)) AS t(region, revenue)");
  assert.equal((await validateSpec(s, { dir: ROOT, stage: 'bind' })).ok, true);
  const full = await validateSpec(s, { dir: ROOT, stage: 'full' });
  assert.equal(full.ok, false);
  assert.equal(full.errors[0].path, 'charts[0].assert');
  assert.match(full.errors[0].message, /West.*90/);
});

test('real DuckDB results refuse precision loss, nulls and truncation', async () => {
  for (const sql of [
    "SELECT * FROM (VALUES ('East', 9007199254740993::BIGINT), ('West', 9007199254740992::BIGINT)) AS t(region, revenue)",
    "SELECT * FROM (VALUES ('East', 1.000000000000000001::DECIMAL(38,18)), ('West', 1.000000000000000002::DECIMAL(38,18))) AS t(region, revenue)",
    "SELECT * FROM (VALUES ('East', 90), ('West', NULL)) AS t(region, revenue)",
    "SELECT * FROM (VALUES ('East', 90::DOUBLE), ('West', 'NaN'::DOUBLE)) AS t(region, revenue)",
  ]) {
    const out = await validateSpec(spec(chart, sql), { dir: ROOT, stage: 'full' });
    assert.equal(out.ok, false, sql);
    assert.equal(out.errors[0].path, 'charts[0].assert');
  }
  const out = await validateSpec({ ...spec(), maxRows: 1 }, { dir: ROOT, stage: 'full' });
  assert.equal(out.ok, false);
  assert.match(out.errors[0].message, /truncated/);
});

test('failed build and embedded chart retain the diagnostic; a corrected rebuild recovers', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-assert-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'dashboard.json');
  const csv = path.join(dir, 'sales.csv');
  const s = { ...spec(chart, 'SELECT * FROM sales'), sources: { sales: { type: 'csv', path: 'sales.csv' } } };
  fs.writeFileSync(file, JSON.stringify(s));
  fs.writeFileSync(csv, 'region,revenue\nEast,90\nWest,10\n');
  const good = await buildDashboard(file);
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  const html = fs.readFileSync(good.target, 'utf8');
  assert.equal((await chartData(file, 'revenue')).ok, true);
  fs.writeFileSync(csv, 'region,revenue\nEast,10\nWest,90\n');
  const bad = await buildDashboard(file);
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].path, 'charts[0].assert');
  assert.equal(fs.readFileSync(good.target, 'utf8'), html, 'last good file is byte-for-byte unchanged');
  const embedded = await chartData(file, 'revenue');
  assert.equal(embedded.ok, false);
  assert.deepEqual(embedded.errors, bad.errors);
  const cli = spawnSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs'), file, '--out', path.join(dir, 'failed')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(cli.status, 1, cli.stderr + cli.stdout);
  assert.match(cli.stderr + cli.stdout, /charts\[0\]\.assert/);
  assert.equal(fs.existsSync(path.join(dir, 'failed/index.html')), false);
  s.charts = [{ ...chart, title: 'West earns the most revenue', assert: { type: 'max', category: 'West' } }];
  fs.writeFileSync(file, JSON.stringify(s));
  const fixed = await buildDashboard(file);
  assert.equal(fixed.ok, true, JSON.stringify(fixed.errors));
  assert.match(fs.readFileSync(fixed.target, 'utf8'), /West earns the most revenue/);
});
