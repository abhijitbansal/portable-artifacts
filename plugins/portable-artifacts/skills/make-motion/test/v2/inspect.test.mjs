// W3 task 5: --inspect <film time> writes one frame as a PNG and a JSON dump. This file holds what needs no browser: the
// node listing (inspectNodes), the cut window the dump names (cutAt), the flag and its refusals. The page run is
// inspect-browser.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { buildTimeline } from '../../engine/script/timing.mjs';
import { inspectNodes } from '../../engine/review/inspect-nodes.mjs';
import { cutWindowAt } from '../../engine/graph/film.mjs';
import { filmFrame } from '../../scripts/v2/film-time.mjs';
import { filmFor, filmOf } from './helpers/kinds.mjs';
import { registries } from '../../engine/registry.mjs';
import { parseMakeArgs } from '../../scripts/v2/cli.mjs';
import { cutAt } from '../../scripts/v2/inspect.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { runMake } from '../../scripts/v2/run.mjs';

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

test('cutWindowAt is the engine\'s window: the cut, how far, and the outgoing shot with the second it is read at', () => {
  const film = filmWith('crossfade');
  const timeline = buildTimeline(film, { fps: FPS });
  const found = cutWindowAt(film, timeline, 36);
  assert.equal(found.cut.name, 'crossfade');
  assert.equal(found.p, 0.5);
  assert.equal(found.live, true);
  assert.deepEqual([found.shot, found.from, found.outgoingT], [1, 0, 1.2]);
  assert.equal(cutWindowAt(film, timeline, 42), null);
  assert.equal(cutWindowAt(film, timeline, 5), null);
});

// cutAt and the page's frameAt read the window from one engine function; this holds them together on every frame of a film
// with a crossfade (layer), a slide (node), a flood (layer, a look-grounded colour) and a cross-zoom (shader).
// checkParity: every frame of `film` (built with `look`): cutAt names the window the page's frameAt opens; returns the cut
// names and families seen
function checkParity(film, look) {
  const timeline = buildTimeline(film, { fps: FPS });
  const built = filmFor(film.shots, look, '16:9', { seed: film.seed });
  const seen = new Set();
  for (let frame = 0; frame < timeline.frameCount; frame += 1) {
    const state = built.frameAt(frame / FPS);
    const found = cutAt(film, timeline, frame);
    if (state.cut === undefined) {
      if (found !== null) { assert.equal(found.family, 'node', `frame ${frame}: only a node cut has a window with no cut in the frame`); seen.add('node'); seen.add(found.name); }
      continue;
    }
    assert.notEqual(found, null, `frame ${frame}`);
    const outgoing = timeline.shots[state.from.shot];
    assert.equal(found.name, state.cut.name, `frame ${frame}`);
    assert.equal(found.family, state.cut.family);
    assert.ok(Math.abs(found.p - state.cut.p) < 1e-4, `frame ${frame}: p ${found.p} vs ${state.cut.p}`);
    assert.equal(found.from.shot, outgoing.id);
    assert.ok(Math.abs(found.from.seconds - (state.from.t - outgoing.start)) < 1e-3, `frame ${frame}: outgoing second`);
    assert.equal(found.from.live, state.from.live === true);
    seen.add(found.family);
    seen.add(found.name);
  }
  return { timeline, seen };
}

test('cutAt agrees with frameAt on every frame of a film with a crossfade, a node cut, a flood and a shader cut', () => {
  const film = filmOf([shot('a'), shot('b', 'crossfade'), shot('c', 'slide'), shot('d', 'flood'), shot('e', 'cross-zoom')]);
  const { timeline, seen } = checkParity(film, 'desk');
  for (const found of ['layer', 'node', 'shader', 'crossfade', 'slide', 'flood', 'cross-zoom']) assert.ok(seen.has(found), `${found} was reached`);
  const slide = [...Array(timeline.frameCount).keys()].filter((frame) => cutAt(film, timeline, frame)?.name === 'slide');
  assert.ok(slide.length > 0 && slide.every((frame, k) => k === 0 || frame === slide[k - 1] + 1), 'the node cut has one run of frames');
});

// the poster look picks its own cut (cutPick: a cover every third shot, in turn up and left, a plain cut where its plates
// would hide it): the cut is resolved on the shot's grounded look, and the window must still be the page's
test('cutAt agrees with frameAt on a poster film whose cuts the look picks, with and without its plates rule dropping one', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  // the shots the look would open on a cover: every third, so d and g; the cut into each, by the shot it opens
  const coversOf = (film) => {
    const { timeline, seen } = checkParity(film, 'poster');
    const into = new Set();
    for (let frame = 0; frame < timeline.frameCount; frame += 1) { const found = cutAt(film, timeline, frame); if (found) into.add(`${timeline.shots.find((s) => frame >= s.start * FPS && frame < s.end * FPS).id}:${found.name}`); }
    return { into: [...into].sort(), seen };
  };
  // statements only: the plates rule finds no plate (a statement sets none), so d and g both open on the cover
  const plain = coversOf(filmOf(ids.map((id) => shot(id)), 'poster', '16:9', { seed: 10 }));
  assert.deepEqual(plain.into, ['d:cover', 'g:cover']);
  // a screen shot before each (the poster look gives it a plate fill): at this seed (found by search, 10) the plates rule
  // sees the plate in the colour of d's ground and cuts plainly into d, and keeps the cover into g; the window must
  // still be the page's
  const screens = ids.map((id, i) => (i === 2 || i === 5 ? { id, show: 'screen', src: 'shot.png', hold: 1 } : shot(id)));
  const plated = coversOf(filmOf(screens, 'poster', '16:9', { seed: 10 }));
  assert.deepEqual(plated.into, ['g:cover'], 'the plates rule dropped the cover into d');
  assert.ok(plated.seen.has('cover') && plain.seen.has('cover'));
});

test('cutWindowAt refuses a frame outside the film, as frameAt refuses a time outside it', () => {
  const film = filmWith('crossfade');
  const timeline = buildTimeline(film, { fps: FPS });
  for (const frame of [-1, timeline.frameCount + 5, Number.NaN]) assert.throws(() => cutWindowAt(film, timeline, frame), /time must be in 0\.\.2, got/, String(frame));
  assert.equal(cutWindowAt(film, timeline, timeline.frameCount - 1), null, 'the last frame is inside the film');
  assert.equal(cutWindowAt(film, timeline, 0), null);
});

// ---- the flag ---------------------------------------------------------------------------------------------------------

test('a time past the end is worded under the flag it came from', () => {
  const film = filmWith('cut');
  const timeline = buildTimeline(film, { fps: FPS });
  assert.throws(() => filmFrame('40', film, timeline), /^Error: --poster 40: past the end \(the film is 2\.0 s\)/);
  assert.throws(() => filmFrame('40', film, timeline, '--inspect'), /^Error: --inspect 40: past the end \(the film is 2\.0 s\)/);
});

test('on a silent film with a clip a time past the end is refused before the clip is decoded, so it needs no ffmpeg to be said', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-inspect-clip-'));
  const saved = { path: process.env.PATH, ffmpeg: process.env.FFMPEG_PATH };
  try {
    copyFileSync(path.resolve(HERE, '../../../references/examples/v2/media-clip.mp4'), path.join(dir, 'clip.mp4'));
    const specPath = path.join(dir, 'film.json');
    writeFileSync(specPath, JSON.stringify({ version: 2, mode: 'pro', fps: FPS, shots: [{ id: 'reel', show: 'media', src: 'clip.mp4', hold: 1 }] }));
    process.env.PATH = '/nonexistent'; // the clip decode looks ffmpeg up on PATH: if it ran first, its error would be said, not the length
    delete process.env.FFMPEG_PATH;
    for (const flag of [{ inspect: '999' }, { poster: '999' }]) {
      const { report, exitCode } = await runMake({ specPath, out: null, ...flag });
      assert.equal(exitCode, 2, JSON.stringify(flag));
      assert.match(report.error.message, /past the end \(the film is 1\.0 s\)/, JSON.stringify(flag));
    }
    assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing was written');
  } finally {
    process.env.PATH = saved.path;
    if (saved.ffmpeg !== undefined) process.env.FFMPEG_PATH = saved.ffmpeg;
    rmSync(dir, { recursive: true, force: true });
  }
});

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
