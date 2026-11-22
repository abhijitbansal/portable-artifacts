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
import { pngOf } from './helpers/png.mjs';

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
const BLANK_SPREAD = 20; // a picture whose red channel varies by less than this over the whole frame is one flat colour

// The PNG, read once: its size, and the spread of its red channel (a blank frame has none).
function pictureOf(report) {
  const { width, height, channels, data } = readPng(readFileSync(report.inspect.png));
  let low = 255, high = 0;
  for (let i = 0; i < data.length; i += channels) { low = Math.min(low, data[i]); high = Math.max(high, data[i]); }
  return { width, height, spread: high - low };
}

test('make.mjs --inspect writes the PNG and the JSON, and the report names both', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const { report, exitCode } = await inspect('off@start+0.5');
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.equal(report.inspect.png, path.join(dir, 'out', 'fade.inspect', '15.png'));
  assert.equal(report.inspect.json, path.join(dir, 'out', 'fade.inspect', '15.json'));
  assert.deepEqual([report.inspect.frame, report.inspect.seconds, report.inspect.shot], [15, 0.5, 'off']);
  const picture = pictureOf(report);
  assert.deepEqual([picture.width, picture.height], [1920, 1080]);
  assert.ok(picture.spread > BLANK_SPREAD, `the picture is not blank (red spread ${picture.spread})`);
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
  const picture = pictureOf(report); // the cut's composition at p 0.5: the outgoing shot is already cleared, the incoming one arriving
  assert.deepEqual([picture.width, picture.height], [1920, 1080]);
  assert.ok(picture.spread > BLANK_SPREAD, `the picture is not blank (red spread ${picture.spread})`);
  const dump = dumpOf(report);
  assert.equal(dump.shot, 'next', 'the shot the frame belongs to is the incoming one');
  assert.equal(dump.cut.name, 'crossfade');
  assert.equal(dump.cut.family, 'layer');
  assert.ok(dump.cut.p > 0 && dump.cut.p < 1, `p ${dump.cut.p}`);
  assert.equal(dump.cut.from.shot, 'off');
  assert.equal(dump.cut.from.live ? dump.cut.from.seconds > 1 : dump.cut.from.seconds === 1, true, `outgoing second ${dump.cut.from.seconds}`);
  assert.deepEqual(dump.nodes.map((n) => n.id).filter((id) => ['edge', 'bar'].includes(id)), ['bar'], 'the nodes list the incoming shot alone, whatever the picture shows of the outgoing one at this p');
  return undefined;
});

test('the dump lists the film\'s overlays beside the nodes, in the same shape, and none for a film without them', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'assets', 'logo.png'), pngOf(16, 16, () => [0, 255, 0]));
  writeFileSync(path.join(dir, 'overlaid.json'), JSON.stringify({ ...FILM, overlays: { logo: { src: 'assets/logo.png' }, progress: true } }));
  const { report, exitCode } = await runMake({ specPath: path.join(dir, 'overlaid.json'), inspect: 'off@start+0.5', out: null });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  const dump = dumpOf(report);
  assert.deepEqual(dump.overlays.map((n) => n.id), ['overlay.logo', 'overlay.progress.track', 'overlay.progress.bar']);
  const shape = (n) => Object.keys(n).filter((k) => k !== 'text').sort(); // the node entries' keys, text apart
  assert.deepEqual(shape(dump.overlays[0]), shape(dump.nodes[0]));
  assert.ok(dump.overlays.every((n) => Array.isArray(n.bbox) && n.bbox.length === 4 && n.offFrame === false), JSON.stringify(dump.overlays));
  assert.ok(dump.nodes.every((n) => !n.id.startsWith('overlay.')), 'the nodes stay the shot\'s alone');
  const plain = dumpOf((await inspect('off@start+0.5')).report);
  assert.deepEqual(plain.overlays, []);
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
