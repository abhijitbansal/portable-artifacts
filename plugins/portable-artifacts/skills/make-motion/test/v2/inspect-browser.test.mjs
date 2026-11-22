// make.mjs <film> --inspect <film time>: one frame as a PNG and a JSON dump, and no MP4, no sheets. [browser] One at a time:
// run with --test-concurrency=1; skips without a browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserAvailable } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { readPng } from '../../scripts/v2/png.mjs';

const EDGE = { type: 'text', id: 'edge', props: { x: 10, y: 400, text: 'Off the edge', font: { family: 'Geist', weight: 600, size: 96 }, maxWidth: 900, fill: '#ffffff' } };
const BAR = { type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#ffe14a' } };
// the first shot of make.test.mjs's `off` film, and a second shot that comes in on a crossfade (0.4 s: frames 30 to 41)
const FILM = { version: 2, fps: 30, shots: [
  { id: 'off', show: 'free', hold: 1, background: '#101820', nodes: [EDGE] },
  { id: 'next', show: 'free', hold: 1, background: '#1f4e8c', cut: 'crossfade', nodes: [BAR] },
] };

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-inspect-'));
  mkdirSync(path.join(dir, 'refused'));
  // the same film twice: the runs that draw write beside the first, the refused ones beside the second
  for (const folder of [dir, path.join(dir, 'refused')]) writeFileSync(path.join(folder, 'fade.json'), JSON.stringify(FILM));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const inspect = (time, folder = dir) => runMake({ specPath: path.join(folder, 'fade.json'), inspect: time, out: null });
const dumpOf = (report) => JSON.parse(readFileSync(report.inspect.json, 'utf8'));

test('make.mjs --inspect writes the PNG and the JSON, and the report names both', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const { report, exitCode } = await inspect('off@start+0.5');
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.equal(report.inspect.png, path.join(dir, 'out', 'fade.inspect', '15.png'));
  assert.equal(report.inspect.json, path.join(dir, 'out', 'fade.inspect', '15.json'));
  assert.deepEqual([report.inspect.frame, report.inspect.seconds, report.inspect.shot], [15, 0.5, 'off']);
  const picture = readPng(readFileSync(report.inspect.png));
  assert.deepEqual([picture.width, picture.height], [1920, 1080]);
  const dump = dumpOf(report);
  assert.equal(dump.shot, 'off');
  assert.equal(dump.cut, null);
  assert.equal(dump.frame, 15);
  assert.deepEqual(dump.canvas, { w: 1920, h: 1080 });
  assert.equal(dump.unit, 1);
  assert.equal(dump.timed, 'estimated');
  assert.ok(dump.safe.left > 0 && dump.safe.right < 1920, 'the safe rectangle is inside the canvas');
  const edge = dump.nodes.find((n) => n.id === 'edge');
  assert.equal(edge.text.outsideSafe, true);
  assert.equal(edge.text.sizeUnits, 96);
  assert.equal(edge.offFrame, false, 'at x = 10 the box is on the canvas, though its ink is outside the safe area');
  assert.equal(report.output, null);
  assert.equal(existsSync(path.join(dir, 'out', 'fade.mp4')), false, 'no MP4');
  assert.equal(existsSync(path.join(dir, 'out', 'fade.sheets')), false, 'no sheets');
  return undefined;
});

test('inside a crossfade the dump says which cut, how far, and which shot is going out; nodes are the incoming shot\'s alone', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const { report, exitCode } = await inspect('1.2'); // frame 36: 0.2 s into the 0.4 s window
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  const dump = dumpOf(report);
  assert.equal(dump.shot, 'next', 'the shot the frame belongs to is the incoming one');
  assert.equal(dump.cut.name, 'crossfade');
  assert.equal(dump.cut.family, 'layer');
  assert.ok(dump.cut.p > 0 && dump.cut.p < 1, `p ${dump.cut.p}`);
  assert.equal(dump.cut.from.shot, 'off');
  assert.equal(dump.cut.from.live ? dump.cut.from.seconds > 1 : dump.cut.from.seconds === 1, true, `outgoing second ${dump.cut.from.seconds}`);
  assert.deepEqual(dump.nodes.map((n) => n.id).filter((id) => ['edge', 'bar'].includes(id)), ['bar'], 'the PNG shows both shots; the nodes only the incoming one');
  return undefined;
});

test('a time the film does not have is refused before a browser starts, and nothing is written', async () => {
  const folder = path.join(dir, 'refused');
  const past = await inspect('40', folder);
  assert.equal(past.exitCode, 2);
  assert.match(past.report.error.message, /^--inspect 40: past the end \(the film is 2\.0 s\)/);
  const unknown = await inspect('nope', folder);
  assert.equal(unknown.exitCode, 2);
  assert.match(unknown.report.error.hint, /the shots are: off, next/);
  assert.equal(existsSync(path.join(folder, 'out')), false);
});
