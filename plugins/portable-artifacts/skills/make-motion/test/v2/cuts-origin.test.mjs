// A cut that opens from the thing on screen (motion-steals W2 Task 9): a shot's own cut may carry `at`, a target name of
// the shot before, and an iris or a zoom opens about that point instead of the middle. A film with no `at` is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../scripts/v2/list.mjs';
import { registries } from '../../engine/registry.mjs';
import { resolveCut, explicitCut, cutOptionProblems } from '../../engine/cuts/resolve.mjs';
import { pointThroughCamera } from '../../engine/graph/camera.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm } from '../../engine/graph/film.mjs';
import { listEntries, formatList } from '../../scripts/v2/list.mjs';
import { allLookNames, validateLook } from '../../engine/looks/index.mjs';
import { measure, canvasOf, viralOf, IMAGES, CLIP, FPS, filmOf, expandIn } from './helpers/kinds.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const X = path.resolve(HERE, '../../references/examples/v2');
const CANVAS = { w: 1920, h: 1080 };
const recipe = (name, extra) => registries.cuts.get(name).layers({ p: 0.5, direction: 'in', canvas: CANVAS, ...extra });
const origins = () => registries.cuts.names().filter((n) => registries.cuts.get(n).origin === true);

test('iris and zoom open from the point they are given, and from where they did without one', () => {
  assert.deepEqual(recipe('iris', { at: [300, 200] }).to.clip.circle.slice(0, 2), [300, 200]);
  assert.ok(registries.cuts.get('iris').layers({ p: 1, direction: 'in', canvas: CANVAS, at: [300, 200] }).to.clip.circle[2] >= Math.hypot(1920 - 300, 1080 - 200));
  assert.deepEqual(recipe('iris').to.clip.circle.slice(0, 2), [960, 540]);
  assert.deepEqual(recipe('zoom', { at: [300, 200] }).to.origin, [300, 200]);
  assert.equal(recipe('zoom').to.origin, null);
  assert.ok(origins().includes('iris') && origins().includes('zoom') && !origins().includes('wipe'));
});
test('resolveCut reads at from the shot\'s own cut only, and explicitCut keeps it', () => {
  assert.equal(resolveCut({ type: 'iris', at: 'region:r' }).at, 'region:r');
  assert.equal(resolveCut('iris').at, null);
  assert.equal(resolveCut(undefined, { rootCut: { type: 'iris', at: 'region:r' } }).at, null);
  assert.deepEqual(explicitCut(resolveCut({ type: 'iris', at: 'region:r' })), { type: 'iris', direction: 'in', duration: 0.4, smear: false, at: 'region:r' });
  assert.deepEqual(explicitCut(resolveCut('iris')), { type: 'iris', direction: 'in', duration: 0.4, smear: false });
});
test('a cut that opens from no point refuses at, naming the cuts that do', () => {
  assert.deepEqual(cutOptionProblems({ type: 'wipe', at: 'x' }, 'wipe'), [{ key: 'at', message: `the "wipe" cut takes no "at"; the cuts that open from a point: ${origins().join(', ')}` }]);
  const [empty] = cutOptionProblems({ type: 'iris', at: '' }, 'iris');
  assert.equal(empty.key, 'at');
  assert.equal(empty.message, 'must be the name of a target of the shot before (the names an "on" event\'s "target" takes there), got ""');
  assert.deepEqual(cutOptionProblems({ type: 'iris', at: 'region:r' }, 'iris'), []);
});
test('pointThroughCamera: the identity leaves a point; a pan of 100 and a zoom of 2 move it as they move a node', () => {
  const still = { x: 0, y: 0, zoom: 1, rotate: 0 };
  assert.deepEqual(pointThroughCamera([300, 200], still, CANVAS), [300, 200]);
  assert.deepEqual(pointThroughCamera([960, 540], { ...still, x: 100, zoom: 2 }, CANVAS), [860, 540]);
  assert.deepEqual(pointThroughCamera([1060, 540], { ...still, x: 100, zoom: 2 }, CANVAS), [1060, 540]);
});
test('pointThroughCamera: a rotate turns a point about the centre as it turns a node, and a depth softens the pan and the zoom', () => {
  const turned = { x: 0, y: 0, zoom: 1, rotate: 90 };
  const [tx, ty] = pointThroughCamera([1060, 540], turned, CANVAS); // 100 right of the centre, a quarter turn: 100 below it
  assert.ok(Math.abs(tx - 960) < 1e-9 && Math.abs(ty - 640) < 1e-9, `${tx}, ${ty}`);
  const push = { x: 100, y: 0, zoom: 2, rotate: 0 };
  // depth 1: k = 2, so the zoom is 1 + (2 - 1) / 2 = 1.5 and the pan 50: 960 + 100 * 1.5 - 50
  assert.deepEqual(pointThroughCamera([1060, 540], push, CANVAS, 1), [1060, 540]);
  assert.deepEqual(pointThroughCamera([1160, 540], push, CANVAS, 1), [1210, 540]); // 960 + 200 * 1.5 - 50
  assert.deepEqual(pointThroughCamera([1160, 540], push, CANVAS, 0), [1260, 540]); // 960 + 200 * 2 - 100
});
test('--list cuts says which cuts open from a point', () => {
  const cuts = listEntries('cuts');
  assert.equal(cuts.find((c) => c.name === 'iris').at, true);
  assert.equal(cuts.find((c) => c.name === 'wipe').at, false);
  assert.match(formatList('cuts', cuts.filter((c) => c.name === 'iris')), /; opens from a point \(at\)/);
  assert.doesNotMatch(formatList('cuts', cuts.filter((c) => c.name === 'wipe')), /opens from a point/);
});

const A = { ...CLIP({ id: 'a' }), src: 'clipping.png' };
const film = (cut, extra = {}) => ({ version: 2, mode: 'pro', shots: [A, { id: 'b', show: 'statement', say: 'Next.', ...(cut === undefined ? {} : { cut }) }], ...extra });
const errorsOf = (f) => validateFilm(f, { specDir: X }).errors.map((e) => `${e.path}: ${e.message}`);

test('at names a target of the shot before: a known one passes, an unknown one lists the targets there are', () => {
  assert.deepEqual(errorsOf(film({ type: 'iris', at: 'region:r' })), []);
  const [unknown] = errorsOf(film({ type: 'iris', at: 'region:q' }));
  assert.match(unknown, /^shots\[1\]\.cut\.at: unknown target "region:q"; .*the targets of shot "a" \(clipping\) are: .*region:r/);
  assert.deepEqual(errorsOf(film({ type: 'wipe', at: 'region:r' })), [`shots[1].cut.at: the "wipe" cut takes no "at"; the cuts that open from a point: ${origins().join(', ')}`]);
  assert.deepEqual(errorsOf(film(undefined, { cut: { type: 'iris', at: 'region:r' } })), ['cut.at: "at" names a target of the shot before, so it goes on a shot\'s own cut, not the film\'s']);
});
test('a shot with no targets cannot be opened from', () => {
  const f = { version: 2, mode: 'pro', shots: [{ id: 'a', show: 'free', hold: 1, background: '#101820', nodes: [] }, { id: 'b', show: 'statement', say: 'Next.', cut: { type: 'iris', at: 'x' } }] };
  assert.deepEqual(errorsOf(f), ['shots[1].cut.at: shot "a" (free) has no targets for a cut to open from; remove "at"']);
});
test('the built film gives the window one fixed point inside the frame, and a name the boxes lack is an error by name', () => {
  const b = { id: 'b', show: 'statement', say: 'Next.', cut: { type: 'iris', at: 'region:r' } };
  const f = { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: 30, seed: 1, shots: [CLIP({ id: 'a' }), b] }; // CLIP's src is shot.png, which IMAGES holds
  const timeline = buildTimeline(f, { fps: 30 });
  const built = buildFilm({ film: f, timeline, measure, assets: IMAGES, canvas: canvasOf('16:9') });
  const start = timeline.shots[1].start;
  const [x, y] = built.frameAt(start + 0.1).cut.at;
  assert.ok(x > 0 && x < 1920 && y > 0 && y < 1080);
  assert.deepEqual(built.frameAt(start + 0.3).cut.at, [x, y]);
  const bad = { ...f, shots: [f.shots[0], { ...f.shots[1], cut: { type: 'iris', at: 'region:zzz' } }] };
  assert.throws(() => buildFilm({ film: bad, timeline, measure, assets: IMAGES, canvas: canvasOf('16:9') }), /^Error: shot "b": cut at "region:zzz" has no box in shot "a" \(have: /);
  const plain = buildFilm({ film: { ...f, shots: [f.shots[0], { ...f.shots[1], cut: 'iris' }] }, timeline, measure, assets: IMAGES, canvas: canvasOf('16:9') });
  assert.deepEqual(Object.keys(plain.frameAt(start + 0.1).cut), ['name', 'family', 'p', 'direction']);
});

// The origin is where the target is DRAWN on the cut's first frame (the outgoing shot at its end), not where its box was
// laid out. A film of a captioned clipping with a region push, then a statement whose iris opens `at` a target.
const centre = ([x, y, w, h]) => [x + w / 2, y + h / 2];
const NEAR = 1e-6;
const close = (got, want, msg) => assert.ok(Math.abs(got[0] - want[0]) < NEAR && Math.abs(got[1] - want[1]) < NEAR, `${msg}: ${got} vs ${want}`);
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function drawnFilm(look, at, format = '16:9') {
  const clip = CLIP({ id: 'a', caption: 'The query', on: [{ at: 'word:behind', do: 'circle', target: 'region:r' }] });
  const f = filmOf([clip, { id: 'b', show: 'statement', say: 'Next.', cut: { type: 'iris', at } }], look, format);
  const timeline = buildTimeline(f, { fps: FPS });
  const built = buildFilm({ film: f, timeline, measure, assets: IMAGES, canvas: canvasOf(format), viralInsets: viralOf(canvasOf(format)) });
  const cut = built.frameAt(timeline.shots[1].start + 0.05).cut;
  const end = timeline.shots[0].duration;
  return { f, built, origin: cut.at, end, rest: expandIn(filmOf([clip], look, format), 0) };
}

test('a camera target after a push: the origin is the target as the camera draws it at the end of the shot', () => {
  const { built, origin, end, rest } = drawnFilm('desk', 'image');
  const hero = built.sampleShot(0, end).find((n) => n.id === rest.hero);
  assert.ok(hero.bbox !== undefined, 'the hero node carries its drawn box');
  close(origin, centre(hero.bbox), 'the image box as drawn, which the page also reports');
  assert.ok(apart(origin, centre(rest.boxes.image)) > 5, 'the push moved the picture, so a box at rest is the wrong point');
});
test('a pinned caption card follows the push on its own tracks and skips the camera: the origin is where the card is drawn', () => {
  const { built, origin, end, rest } = drawnFilm('desk', 'caption');
  const id = 'a.caption.card';
  const card = rest.nodes.find((n) => n.id === id);
  assert.equal(card.props.fixed, true);
  const drawn = built.sampleShot(0, end).find((n) => n.id === id);
  const moved = [drawn.x - card.props.x, drawn.y - card.props.y];
  assert.ok(Math.hypot(...moved) > 5, 'the card followed the push');
  const at = centre(rest.boxes.caption);
  close(origin, [at[0] + moved[0], at[1] + moved[1]], 'the caption box moved with its card');
});
test('a pinned caption of a stack look is drawn where it was laid out, whatever the camera does', () => {
  const { built, origin, end, rest } = drawnFilm('pop', 'caption', '9:16');
  const drawn = built.sampleShot(0, end).find((n) => n.id === 'a.caption');
  assert.equal(drawn.props.fixed, true);
  close(origin, centre(rest.boxes.caption), 'a fixed text with no tracks of its own');
});

// The colour flood (Task 10): the look's accent grows from a point over the outgoing picture, then the incoming one opens
// from the same point over the colour.
const flood = (p, extra = {}) => registries.cuts.get('flood').layers({ p, direction: null, canvas: CANVAS, look: registries.looks.get('desk'), ...extra });
const CORNER = Math.hypot(960, 540);

test('flood: the outgoing picture at p 0, the flat accent at p 0.5, the incoming picture at p 1', () => {
  assert.equal(flood(0).flood.circle[2], 0);
  assert.equal(flood(0).to.opacity === 0 || flood(0).to.clip.circle[2] === 0, true);
  const mid = flood(0.5);
  assert.equal(mid.flood.color, registries.looks.get('desk').palette.accent);
  assert.ok(mid.flood.circle[2] >= CORNER && mid.to.clip.circle[2] === 0);
  assert.ok(flood(1).to.clip.circle[2] >= CORNER && flood(1).to.opacity === 1);
});
test('flood opens from at, takes no direction, lasts 0.5 s, and every other layer recipe has no flood', () => {
  assert.deepEqual(flood(0.25, { at: [300, 200] }).flood.circle.slice(0, 2), [300, 200]);
  assert.deepEqual(flood(0.75, { at: [300, 200] }).to.clip.circle.slice(0, 2), [300, 200]);
  const entry = registries.cuts.get('flood');
  assert.deepEqual([entry.family, entry.dur, entry.directions, entry.origin, entry.smearable], ['layer', 0.5, null, true, false]);
  for (const name of ['crossfade', 'fade', 'wipe', 'iris', 'zoom', 'blur']) assert.equal(registries.cuts.get(name).layers({ p: 0.5, direction: registries.cuts.get(name).directions?.[0] ?? null, canvas: CANVAS }).flood, null, name);
});
test('a flood may name a target of the shot before: it validates, and the built film gives its window a point', () => {
  assert.deepEqual(errorsOf(film({ type: 'flood', at: 'region:r' })), []);
  assert.match(errorsOf(film({ type: 'flood', at: 'region:q' }))[0], /^shots\[1\]\.cut\.at: unknown target "region:q"/);
  const f = { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: 30, seed: 1, shots: [CLIP({ id: 'a' }), { id: 'b', show: 'statement', say: 'Next.', cut: { type: 'flood', at: 'region:r' } }] };
  const timeline = buildTimeline(f, { fps: 30 });
  const built = buildFilm({ film: f, timeline, measure, assets: IMAGES, canvas: canvasOf('16:9') });
  const [x, y] = built.frameAt(timeline.shots[1].start + 0.1).cut.at;
  assert.ok(x > 0 && x < 1920 && y > 0 && y < 1080);
});
// A flood never paints the colour of a ground it covers (fix round 1): poster's accent is also one of its grounds, so the
// look lists the colours to try (`cutFlood.colors`) and the flood takes the first one that differs from both grounds.
const poster = () => registries.looks.get('poster');
const ground = (key) => poster().palette[key];
const floodOn = (...grounds) => flood(0.5, { look: poster(), grounds }).flood.color;

test('a poster flood out of, or into, the red ground is not red; the accent stays the colour where no ground is red', () => {
  assert.deepEqual([...poster().cutFlood.colors], ['accent', 'ink', 'paper']);
  assert.equal(floodOn(ground('accent'), ground('accent2')), ground('ink'));
  assert.equal(floodOn(ground('accent2'), ground('accent')), ground('ink'));
  assert.equal(floodOn(ground('paper'), ground('accent2')), ground('accent'));
  assert.equal(floodOn(ground('ink'), ground('paper')), ground('accent'));
});
test('a flood between the red and the ink ground takes the next colour, and when every colour is a ground, the last', () => {
  assert.equal(floodOn(ground('accent'), ground('ink')), ground('paper'));
  assert.equal(floodOn(ground('ink'), ground('accent')), ground('paper'));
  assert.equal(floodOn(ground('accent'), ground('ink').toUpperCase(), ground('paper')), ground('paper'), 'all three are grounds: the last colour');
  assert.equal(floodOn(ground('accent').toUpperCase(), ground('accent2')), ground('ink'), 'hex case does not matter');
});
test('a look with no cutFlood floods in its accent, even over a ground of that colour, and a film with no grounds gets it', () => {
  assert.equal(registries.looks.get('desk').cutFlood, undefined);
  const desk = registries.looks.get('desk');
  assert.equal(flood(0.5, { look: desk }).flood.color, desk.palette.accent);
  assert.equal(flood(0.5, { look: desk, grounds: [desk.palette.accent, desk.palette.paper] }).flood.color, desk.palette.accent);
});
test('every look that lists colours for the flood names palette keys it has', () => {
  for (const name of allLookNames()) {
    const look = registries.looks.get(name);
    for (const key of look.cutFlood?.colors ?? []) assert.equal(Object.hasOwn(look.palette, key), true, `${name}: ${key}`);
  }
});

const withFlood = (cutFlood) => ({ ...registries.looks.get('desk'), name: 'flood-test', cutFlood });
test('validateLook refuses a cutFlood that is not { colors: [palette keys] }, naming the field', () => {
  assert.doesNotThrow(() => validateLook(withFlood({ colors: ['accent', 'ink'] })));
  assert.doesNotThrow(() => validateLook(withFlood(undefined)));
  assert.throws(() => validateLook(withFlood('accent')), /look "flood-test": cutFlood must be an object of colors, got accent/);
  assert.throws(() => validateLook(withFlood({ colors: [] })), /look "flood-test": cutFlood\.colors must be a non-empty list of palette colours/);
  assert.throws(() => validateLook(withFlood({ colors: 'accent' })), /cutFlood\.colors must be a non-empty list of palette colours/);
  assert.throws(() => validateLook(withFlood({ colors: ['accent', 'teal'] })), /look "flood-test": cutFlood\.colors\.1 "teal" is not a palette colour \(paper, ink, ink2, accent/);
  assert.throws(() => validateLook(withFlood({ colors: ['toString'] })), /cutFlood\.colors\.0 "toString" is not a palette colour/);
  assert.throws(() => validateLook(withFlood({ colors: ['accent'], color: 'ink' })), /cutFlood\.color is not a field; it takes colors/);
});

test('every look names a cue for the flood, lists it where it lists the iris, and pop and poster reach for it', () => {
  for (const name of allLookNames()) {
    const look = registries.looks.get(name);
    assert.ok(look.sounds.cut.flood === null || typeof look.sounds.cut.flood === 'string', name);
    assert.equal(look.cuts.includes('flood'), look.cuts.includes('iris'), name);
  }
  assert.deepEqual(allLookNames().filter((n) => registries.looks.get(n).cutPalette.includes('flood')).sort(), ['pop', 'poster']);
});
