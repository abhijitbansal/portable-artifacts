import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUERY = path.join(ROOT, 'scripts/query.mjs');
const DATA = path.join(ROOT, 'test/fixtures/data');
const run = (args) => spawnSync(process.execPath, [QUERY, ...args], { encoding: 'utf8', cwd: os.tmpdir() });

function project(spec) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-query-')));
  fs.cpSync(DATA, path.join(dir, 'data'), { recursive: true });
  const file = path.join(dir, 'dashboard.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  return file;
}

const SPEC = {
  title: 'T',
  sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
  queries: {
    by_region: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC',
    rows: 'SELECT * FROM sales ORDER BY date',
  },
  charts: [
    { id: 'rev', title: 'Revenue by region', query: 'by_region', kind: 'bar', x: 'region', y: 'revenue' },
    { id: 'all', title: 'All sales', query: 'rows', kind: 'histogram', value: 'amount' },
  ],
};

test('prints the chart query rows, so a title can state what they show', () => {
  const r = run([project(SPEC), '--chart', 'rev']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^chart rev \(query by_region\): 4 rows$/m);
  assert.match(r.stdout, /^columns: region VARCHAR, revenue DOUBLE$/m);
  const rows = r.stdout.split('\n').filter((l) => l.startsWith('  {')).map((l) => JSON.parse(l));
  assert.equal(rows.length, 4);
  assert.deepEqual(Object.keys(rows[0]), ['region', 'revenue']);
  assert.ok(rows[0].revenue >= rows[1].revenue, 'query order is kept');
});

test('printed cells show hidden characters as code points and cap a long cell; --json stays exact', () => {
  const file = project(SPEC);
  const hidden = String.fromCodePoint(0xE0069, 0xE0067); // two Unicode tag characters
  fs.writeFileSync(path.join(path.dirname(file), 'data/notes.csv'), `note,n\nhi\u{202E}evil${hidden},1\n${'w'.repeat(500)},2\n`);
  fs.writeFileSync(file, JSON.stringify({
    title: 'T',
    sources: { notes: { type: 'csv', path: 'data/notes.csv' } },
    queries: { rows: 'SELECT * FROM notes ORDER BY n' },
    charts: [{ id: 'all', title: 'All notes', query: 'rows', kind: 'histogram', value: 'n' }],
  }));
  const r = run([file, '--chart', 'all']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /[\u{202E}\u{E0000}-\u{E007F}]/u, 'no raw bidi or tag character reaches the agent');
  assert.match(r.stdout, /^ {2}\{"note":"hi\\u\{202e\}evil\\u\{e0069\}\\u\{e0067\}","n":1\}$/m);
  const long = r.stdout.split('\n').find((l) => l.includes('wwww'));
  assert.match(long, /…\[\d+ more characters\],"n":2\}$/);
  assert.ok(long.length < 260, `a 500-character cell is capped, got ${long.length}`);
  const j = JSON.parse(run([file, '--chart', 'all', '--json']).stdout);
  assert.equal(j.rows[0].note, `hi\u{202E}evil${hidden}`, '--json keeps the data exact');
});

test('--limit caps the printed rows and says how many were left out', () => {
  const r = run([project(SPEC), '--chart', 'all', '--limit', '3']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^chart all \(query rows\): 40 rows$/m);
  assert.equal(r.stdout.split('\n').filter((l) => l.startsWith('  {')).length, 3);
  assert.match(r.stdout, /^ {2}… 37 more rows$/m);
});

test('--json prints rows, columns and counts', () => {
  const j = JSON.parse(run([project(SPEC), '--chart', 'rev', '--json']).stdout);
  assert.equal(j.ok, true);
  assert.equal(j.chart, 'rev');
  assert.equal(j.query, 'by_region');
  assert.equal(j.rowCount, 4);
  assert.deepEqual(j.columns, [{ name: 'region', type: 'VARCHAR' }, { name: 'revenue', type: 'DOUBLE' }]);
  assert.equal(j.rows.length, 4);
});

test('inspection returns rows with assertion errors so a failed finding can be repaired', (t) => {
  const spec = {
    title: 'T', sources: {},
    queries: { q: "SELECT * FROM (VALUES ('East', 10), ('West', 90)) AS t(region, revenue)" },
    charts: [{ id: 'rev', title: 'East leads', query: 'q', kind: 'bar', x: 'region', y: 'revenue', assert: { type: 'max', category: 'East' } }],
  };
  const file = project(spec);
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  const plain = run([file, '--chart', 'rev']);
  assert.equal(plain.status, 1, 'failed assertions remain a nonzero exit');
  assert.match(plain.stdout, /chart rev \(query q\): 2 rows/);
  assert.match(plain.stdout, /"region":"West","revenue":90/);
  assert.match(plain.stdout, /charts\[0\]\.assert/);
  const json = run([file, '--chart', 'rev', '--json']);
  assert.equal(json.status, 1);
  const body = JSON.parse(json.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.errors[0].path, 'charts[0].assert');
  assert.deepEqual(body.rows, [{ region: 'East', revenue: 10 }, { region: 'West', revenue: 90 }]);
  assert.equal(body.rowCount, 2);
  assert.equal(body.truncated, false);
});

test('an unknown chart id suggests the close one and exits 1', () => {
  const r = run([project(SPEC), '--chart', 'revv']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /chart "revv" not found in the dashboard; did you mean "rev"\?/);
});

test('inspection preserves chart validation errors, including errors in sibling charts', (t) => {
  const spec = {
    title: 'T', sources: {},
    queries: { q: "SELECT 'slice ' || x AS slice, 1 AS n FROM range(7) t(x)" },
    charts: [
      { id: 'd', title: 'Seven slices', query: 'q', kind: 'donut', x: 'slice', y: 'n' },
      { id: 'b', title: 'Seven bars', query: 'q', kind: 'bar', x: 'slice', y: 'n' },
    ],
  };
  const file = project(spec);
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  for (const id of ['d', 'b']) {
    const r = run([file, '--chart', id, '--json']);
    assert.equal(r.status, 1, `${id}: invalid charts must not be reported as valid`);
    const body = JSON.parse(r.stdout);
    assert.equal(body.ok, false);
    assert.deepEqual(body.errors, [{ path: 'charts[0].kind', message: 'donut needs <= 6 slices (slice has 7); use kind "bar"' }]);
    assert.equal(body.rows, undefined, 'the row exception is only for the selected assertion');
  }
});

test('usage problems exit 2; --help exits 0', () => {
  assert.equal(run([project(SPEC)]).status, 2, 'needs --chart');
  assert.equal(run([project(SPEC), '--chart', 'rev', '--limit', '0']).status, 2);
  assert.equal(run([project(SPEC), '--chart', 'rev', '--bogus']).status, 2);
  assert.equal(run(['/nonexistent.json', '--chart', 'rev']).status, 2);
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /usage: node scripts\/query\.mjs <spec\.json> --chart <id>/);
});

test('a failed assertion does not hide an invalid requested view during inspection', (t) => {
  const spec = {
    title: 'T', sources: {},
    queries: { q: "SELECT * FROM (VALUES ('East', 10), ('West', 90), ('North', -1)) AS t(region, revenue)" },
    charts: [{ id: 'rev', title: 'East leads', query: 'q', kind: 'bar', x: 'region', y: 'revenue', views: ['share'], assert: { type: 'max', category: 'East' } }],
  };
  const file = project(spec);
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  const r = run([file, '--chart', 'rev', '--json']);
  assert.equal(r.status, 1);
  const body = JSON.parse(r.stdout);
  assert.equal(body.ok, false);
  assert.deepEqual(body.errors.map((e) => e.path), ['charts[0].assert', 'charts[0].views[0]']);
  assert.match(body.errors[1].message, /share.*>= 0/);
  assert.equal(body.rows, undefined);
});
