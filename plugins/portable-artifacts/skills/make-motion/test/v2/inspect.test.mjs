// W3 task 5: --inspect <film time> writes one frame as a PNG and a JSON dump. This file holds what needs no browser: the
// node listing (inspectNodes), the cut window the dump names (cutAt), the flag and its refusals. The page run is
// inspect-browser.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { buildTimeline } from '../../engine/script/timing.mjs';
import { inspectNodes } from '../../engine/review/frame.mjs';
import { registries } from '../../engine/registry.mjs';
import { parseMakeArgs } from '../../scripts/v2/cli.mjs';
import { cutAt } from '../../scripts/v2/inspect.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';

const CANVAS = { w: 1920, h: 1080 };
const FPS = 30;
const LOOK = registries.looks.get('desk');
const CTX = { look: LOOK, canvas: CANVAS, mode: 'pro', shotId: 'a', shotIndex: 0, t: 0.5, safe: safeRectFor(CANVAS, LOOK) };
const at = (box, extra = {}) => ({ depth: 0, x: box[0], y: box[1], scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [], bbox: box, spread: 0, ...extra });

// One word of text 20 units tall, its box starting at x = -40: off the frame and outside the safe area.
const word = (id, x, size) => {
  const width = size * 2, height = size * 1.15;
  const line = { x: 0, y: size * 0.9, width, words: [{ text: 'word', index: 0, x: 0, width }] };
  return at([x, 400, width, height], { type: 'text', id, props: { fill: '#000000', role: 'kicker' }, words: [{ opacity: 1, x: 0, y: 0, scale: 1 }], layout: { size, width, height, overflow: false, lines: [line] } });
};
const bar = at([300, 500, 1320, 80], { type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } });
const TREE = [word('edge', -40, 20), bar];

test('a text reports its height in units, its ink and whether it left the safe area and the frame', () => {
  const [text, barNode] = inspectNodes(TREE, CTX);
  assert.equal(text.id, 'edge');
  assert.equal(text.type, 'text');
  assert.equal(text.role, 'kicker');
  assert.equal(text.text.sizeUnits, 20);
  assert.equal(text.text.smallestUnits, 20);
  assert.equal(text.text.outsideSafe, true);
  assert.equal(text.text.landed, true);
  assert.equal(text.offFrame, true);
  assert.equal(text.opacity, 1);
  assert.deepEqual(text.bbox, [-40, 400, 40, 23]);
  assert.equal(text.text.ink.length, 4);
  assert.ok(text.text.ink.every(Number.isFinite));
  assert.equal(barNode.offFrame, false);
  assert.equal(barNode.text, undefined);
  assert.equal(barNode.role, undefined);
});

test('a text inside the safe area is not outside it, and a smaller word on screen sets smallestUnits', () => {
  const inside = word('inside', 400, 40);
  inside.words = [{ opacity: 1, x: 0, y: 0, scale: 0.5 }];
  const [found] = inspectNodes([inside], CTX);
  assert.equal(found.text.outsideSafe, false);
  assert.equal(found.offFrame, false);
  assert.equal(found.text.sizeUnits, 40);
  assert.equal(found.text.smallestUnits, 20);
});

test('a node at opacity 0 is left out, and so is everything inside it; a group passes its opacity down', () => {
  assert.equal(inspectNodes([at([0, 0, 10, 10], { type: 'group', id: 'g', opacity: 0, children: [bar] })], CTX).length, 0);
  const [group, child] = inspectNodes([at([300, 500, 1320, 80], { type: 'group', id: 'g', opacity: 0.5, children: [{ ...bar, opacity: 0.5 }] })], CTX);
  assert.deepEqual([group.id, child.id], ['g', 'bar'], 'parent before child');
  assert.equal(group.opacity, 0.5);
  assert.equal(child.opacity, 0.25);
});

test('a text with no layout is listed as a node without a text report, and never throws', () => {
  const [found] = inspectNodes([at([10, 10, 100, 30], { type: 'text', id: 'bare', props: {} })], CTX);
  assert.equal(found.id, 'bare');
  assert.equal(found.text, undefined);
});

// ---- the cut window the dump names ----------------------------------------------------------------------------------

const shot = (id, cut) => ({ id, show: 'statement', text: `${id.toUpperCase()}.`, hold: 1, ...(cut ? { cut } : {}) });
const filmWith = (cut, extra = {}) => ({ version: 2, mode: 'pro', fps: FPS, ...extra, shots: [shot('a'), shot('b', cut)] });
const cutOf = (film, frame) => cutAt(film, buildTimeline(film, { fps: FPS }), frame);

test('inside a layer cut\'s window the dump names the cut, how far it has come and the outgoing shot, live', () => {
  const film = filmWith('crossfade'); // 0.4 s: frames 30 to 41
  assert.deepEqual(cutOf(film, 36), { name: 'crossfade', family: 'layer', p: 0.5, from: { shot: 'a', seconds: 1.2, live: true } });
  assert.equal(cutOf(film, 30).p, 0, 'the window\'s first frame is the outgoing picture');
  assert.equal(cutOf(film, 41).p, 0.9167);
});

test('outside the window, on the first shot and on a hard cut there is no cut', () => {
  const film = filmWith('crossfade');
  assert.equal(cutOf(film, 42), null, 'the window is over');
  assert.equal(cutOf(film, 29), null, 'the last frame of the outgoing shot');
  assert.equal(cutOf(film, 5), null, 'the first shot has no cut into it');
  assert.equal(cutOf(filmWith('cut'), 31), null, 'a hard cut has no window');
});

test('a node cut\'s window is named too, with its outgoing shot held at its last frame', () => {
  const found = cutOf(filmWith('slide'), 33);
  assert.equal(found.name, 'slide');
  assert.equal(found.family, 'node');
  assert.deepEqual(found.from, { shot: 'a', seconds: 1, live: false });
  assert.ok(found.p > 0 && found.p < 1);
});

test('a look drawn by hand holds the outgoing shot even in a layer cut', () => {
  const found = cutOf(filmWith('crossfade', { look: 'marker' }), 36);
  assert.equal(found.family, 'layer');
  assert.deepEqual(found.from, { shot: 'a', seconds: 1, live: false });
});

test('a shot shorter than its cut\'s window is in the window to its last frame', () => {
  // the timeline is written by hand: a hold shorter than a second cannot be built, a narrated shot shortened by a lead can
  const film = filmWith('crossfade');
  const timeline = { fps: FPS, shots: [{ id: 'a', index: 0, start: 0, duration: 1 }, { id: 'b', index: 1, start: 1, duration: 0.2 }] };
  assert.equal(cutAt(film, timeline, 35).name, 'crossfade');
  assert.equal(cutAt(film, timeline, 35).p, 0.8333, 'the window is the shot: its length is the cut\'s');
});

// ---- the flag ---------------------------------------------------------------------------------------------------------

test('--inspect takes a film time and reads as the mode it is', () => {
  assert.equal(parseMakeArgs(['f.json', '--inspect', 'rows@end']).inspect, 'rows@end');
  assert.equal(parseMakeArgs(['f.json']).inspect, null);
  assert.throws(() => parseMakeArgs(['f.json', '--inspect', '']), /--inspect takes a film time/);
});

test('--inspect does not go with --out, --poster or --sheets-only', () => {
  for (const flag of [['--out', 'a.mp4'], ['--poster', '1'], ['--sheets-only']]) {
    assert.throws(() => parseMakeArgs(['f.json', '--inspect', '1', ...flag]), /--inspect does not go with/, flag.join(' '));
  }
});

test('--inspect refuses every other mode and the render flags, and --preview refuses it', () => {
  const refused = [['--batch', 'rows.json'], ['--no-render'], ['--outline'], ['--phonemes'], ['--poster-out', 'p.png'], ['--subtitles', 'srt'], ['--workers', '2'], ['--exact']];
  for (const flag of refused) assert.throws(() => parseMakeArgs(['f.json', '--inspect', '1', ...flag]), /--inspect does not go with/, flag.join(' '));
  assert.throws(() => parseMakeArgs(['f.json', '--inspect', '1', '--preview']), /does not go with --inspect/);
  assert.throws(() => parseMakeArgs(['f.json', '--preview', '--poster', '1']), /does not go with --poster/);
});
