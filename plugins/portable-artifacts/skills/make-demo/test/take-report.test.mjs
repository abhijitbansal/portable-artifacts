// takeReport: the text a director reads after a take. Pure: no browser, no file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeReport, stoppedJson, REPORT_BYTES } from '../scripts/lib/take-report.mjs';

const DIR = '/work/demo/take-1';
const ORIGIN = 'http://127.0.0.1:4100';
const OTHER = 'http://127.0.0.1:4200';
const bytes = (text) => Buffer.byteLength(text);

const step = (id, extra = {}) => ({ id, do: 'click', effect: 'change', startFrame: 0, actFrame: 1, settleFrame: 2, pointer: { x: 1, y: 1 }, box: null, boxMoved: false, covered: 0, settle: { capped: false }, settledIndex: 1, ...extra });

const takeOf = (over = {}) => ({
  version: 1,
  planKey: 'demo-abc123',
  startedAt: '1970-01-01T00:00:00.000Z',
  viewport: { width: 800, height: 500 },
  scale: 3,
  fps: 30,
  mode: 'stepped',
  signedIn: false,
  frames: Array.from({ length: 60 }, (_, i) => `${String(i % 3).repeat(16)}.jpg`),
  steps: [step('g', { do: 'goto', effect: 'look' }), step('t'), step('f')],
  stopped: null,
  again: [],
  seen: { origins: [ORIGIN, OTHER], requests: [], refused: [], dialogs: 0, popups: 0, downloads: [], errors: 0 },
  bytes: 123456,
  ...over,
});

const seenWith = (over) => ({ origins: [ORIGIN], requests: [], refused: [], dialogs: 0, popups: 0, downloads: [], errors: 0, ...over });

test('a finished take: rows run of total, no stop, film seconds, frames and distinct files, bytes, origins and the folder', () => {
  const text = takeReport(takeOf(), { dir: DIR, total: 3 });
  assert.match(text, /rows run: 3 of 3/);
  assert.match(text, /stopped: no, every row ran/);
  assert.match(text, /film time: 2\.0 s/);
  assert.match(text, /frames: 60 \(3 distinct files\)/);
  assert.match(text, /bytes: 123456/);
  assert.ok(text.includes(`origins contacted (2): ${ORIGIN}, ${OTHER}`), text);
  assert.ok(text.includes(`folder: ${DIR}`), text);
  assert.ok(text.includes(`contact sheet: ${DIR}/contact.jpg`), text);
});

test('a stopped take says which row and why, and how many rows ran of the total', () => {
  const text = takeReport(takeOf({ steps: [step('g'), step('t')], stopped: { row: 'i', reason: 'not seen yet' } }), { dir: DIR, total: 5 });
  assert.match(text, /rows run: 2 of 5/);
  assert.match(text, /stopped: row i, not seen yet/);
  assert.ok(!/every row ran/.test(text));
});

test('a stop reason and a row id are written out through agentText: a newline and a bidi mark are code points, not characters', () => {
  const text = takeReport(takeOf({ stopped: { row: 'a\nb', reason: 'the control changed: name\n‮txt.exe' } }), { dir: DIR, total: 3 });
  assert.ok(!text.includes('‮'));
  assert.match(text, /stopped: row a\\u\{000a\}b, the control changed: name\\u\{000a\}\\u\{202e\}txt\.exe/);
});

test('--json: stoppedJson is null for a finished take, and for a stop it writes the row id and the reason out through agentText', () => {
  assert.equal(stoppedJson(null), null);
  const hostile = stoppedJson({ row: 'a\nb', reason: 'the control changed: name\n‮txt.exe' });
  assert.deepEqual(Object.keys(hostile), ['row', 'reason']);
  assert.ok(!/[\n‮]/.test(hostile.row + hostile.reason), 'no newline and no bidi mark is left');
  assert.equal(hostile.row, 'a\\u{000a}b');
  assert.equal(hostile.reason, 'the control changed: name\\u{000a}\\u{202e}txt.exe');
  assert.ok(stoppedJson({ row: 'r', reason: 'x'.repeat(1000) }).reason.length < 260, 'a long reason is cut');
});

test('non-GET requests are listed as method, origin, masked path and count, never a body; so are refused moves, dialogs, popups, errors', () => {
  const seen = seenWith({
    requests: [{ method: 'POST', origin: ORIGIN, path: '/take/save', count: 1 }, { method: 'POST', origin: OTHER, path: '/foreign/', count: 3 }],
    refused: [{ method: 'GET', origin: OTHER, path: '/away' }, { method: 'POST', origin: ORIGIN, path: '/p', popup: true }],
    dialogs: 2,
    popups: 1,
    errors: 4,
  });
  const text = takeReport(takeOf({ seen }), { dir: DIR, total: 3 });
  assert.ok(text.includes(`non-GET requests (2):`), text);
  assert.ok(text.includes(`POST ${ORIGIN}/take/save x1`), text);
  assert.ok(text.includes(`POST ${OTHER}/foreign/ x3`), text);
  assert.match(text, /refused moves \(2\)/);
  assert.ok(text.includes(`GET ${OTHER}/away`), text);
  assert.match(text, /dialogs: 2 \(dismissed\), popups: 1 \(closed\), page errors: 4/);
});

test('downloads: the kept file, its bytes and the suggested name; one not kept says why', () => {
  const seen = seenWith({
    downloads: [
      { row: 'dl', file: 'downloads/dl-1.txt', bytes: 18, name: 'file.txt' },
      { row: 'big', file: null, bytes: 105906176, name: 'big.bin', skipped: 'too large' },
    ],
  });
  const text = takeReport(takeOf({ seen }), { dir: DIR, total: 3 });
  assert.match(text, /downloads \(2\)/);
  assert.match(text, /row dl: downloads\/dl-1\.txt, 18 bytes, name "file\.txt"/);
  assert.match(text, /row big: not kept \(too large\), 105906176 bytes, name "big\.bin"/);
});

test('a hostile download name is escaped: no newline, no bidi mark, no path of its own in the report', () => {
  const name = '../../x\ny.txt‮';
  const seen = seenWith({ downloads: [{ row: 'odd', file: 'downloads/odd-1.txt', bytes: 4, name }] });
  const text = takeReport(takeOf({ seen }), { dir: DIR, total: 3 });
  assert.ok(!text.includes('‮'));
  const line = text.split('\n').find((l) => l.includes('row odd:'));
  assert.ok(line, text);
  assert.ok(line.includes('x\\u{000a}y.txt\\u{202e}'), line);
  assert.equal(text.split('\n').filter((l) => l.startsWith('y.txt')).length, 0, 'the newline did not start a line');
});

test('a long download name is cut by agentText', () => {
  const seen = seenWith({ downloads: [{ row: 'long', file: 'downloads/long-1', bytes: 1, name: 'n'.repeat(300) }] });
  const text = takeReport(takeOf({ seen }), { dir: DIR, total: 3 });
  assert.ok(!text.includes('n'.repeat(100)));
  assert.match(text, /more characters\]/);
});

test('boxes covered, controls that moved and rows run again are counted and named', () => {
  const steps = [step('g', { covered: 0 }), step('t', { covered: 3 }), step('f', { covered: 5, boxMoved: true }), step('h', { covered: 5, boxMoved: true })];
  const text = takeReport(takeOf({ steps, again: ['t', 'f'] }), { dir: DIR, total: 4 });
  assert.match(text, /boxes covered: 13 over 3 steps \(most on one step: 5\)/);
  assert.match(text, /boxes that moved: 2 steps \(f, h\)/);
  assert.match(text, /rows run again: t, f/);
});

test('a take with no row run again and no cover says none', () => {
  const text = takeReport(takeOf(), { dir: DIR, total: 3 });
  assert.match(text, /boxes covered: none/);
  assert.match(text, /boxes that moved: none/);
  assert.match(text, /rows run again: none/);
});

test('signed in: the report says the frames and the contact sheet are for the user, and that the model must not open them', () => {
  const text = takeReport(takeOf({ signedIn: true }), { dir: DIR, total: 3 });
  assert.match(text, /signed in: .*do not open/i);
  const out = takeReport(takeOf(), { dir: DIR, total: 3 });
  assert.ok(!/do not open/i.test(out));
});

test('a take of 3,000 requests prints at most 6,144 bytes and says how many lines it left out', () => {
  const requests = Array.from({ length: 3000 }, (_, i) => ({ method: 'POST', origin: ORIGIN, path: `/api/item/${i}/${'p'.repeat(60)}`, count: 1 }));
  const text = takeReport(takeOf({ seen: seenWith({ requests }) }), { dir: DIR, total: 3 });
  assert.ok(bytes(text) <= REPORT_BYTES, `${bytes(text)} bytes`);
  assert.equal(REPORT_BYTES, 6144);
  const left = /left out of this report: (\d+) lines/.exec(text);
  assert.ok(left, text);
  assert.ok(Number(left[1]) >= 2900, `left out ${left[1]}`);
  assert.match(text, /non-GET requests \(3000\)/);
});

test('every list is long and every line is long: still at most 6,144 bytes, and the count of lines left out is there', () => {
  const long = 'z'.repeat(400);
  const seen = {
    origins: Array.from({ length: 200 }, (_, i) => `http://host-${i}.test${long}`),
    requests: Array.from({ length: 200 }, (_, i) => ({ method: 'PUT', origin: `http://o${i}.test`, path: `/${long}`, count: 2 })),
    refused: Array.from({ length: 200 }, (_, i) => ({ method: 'GET', origin: `http://r${i}.test`, path: `/${long}` })),
    dialogs: 1,
    popups: 1,
    downloads: Array.from({ length: 200 }, (_, i) => ({ row: `d${i}`, file: `downloads/d${i}-1`, bytes: 1, name: long })),
    errors: 1,
  };
  const again = Array.from({ length: 200 }, (_, i) => `row-${i}-${long}`);
  const text = takeReport(takeOf({ seen, again, stopped: { row: 'x', reason: long } }), { dir: DIR, total: 3 });
  assert.ok(bytes(text) <= REPORT_BYTES, `${bytes(text)} bytes`);
  assert.match(text, /left out of this report: \d+ lines/);
  assert.match(text, /rows run: 3 of 3/, 'the essential lines survive');
  assert.ok(text.includes(`folder: ${DIR}`));
});

test('a small take leaves nothing out and does not say so', () => {
  const text = takeReport(takeOf(), { dir: DIR, total: 3 });
  assert.ok(!/left out/.test(text));
});

test('without a total the report says how many rows ran and does not invent a total', () => {
  const text = takeReport(takeOf(), { dir: DIR });
  assert.match(text, /rows run: 3\b/);
  assert.ok(!/ of \d/.test(text.split('\n').find((l) => l.startsWith('rows run'))));
});
