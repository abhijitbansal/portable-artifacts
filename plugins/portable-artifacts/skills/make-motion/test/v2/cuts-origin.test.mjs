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
import { measure, canvasOf, IMAGES, CLIP } from './helpers/kinds.mjs';

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
  assert.deepEqual(cutOptionProblems({ type: 'iris', at: '' }, 'iris').map((p) => p.key), ['at']);
  assert.deepEqual(cutOptionProblems({ type: 'iris', at: 'region:r' }, 'iris'), []);
});
test('pointThroughCamera: the identity leaves a point; a pan of 100 and a zoom of 2 move it as they move a node', () => {
  const still = { x: 0, y: 0, zoom: 1, rotate: 0 };
  assert.deepEqual(pointThroughCamera([300, 200], still, CANVAS), [300, 200]);
  assert.deepEqual(pointThroughCamera([960, 540], { ...still, x: 100, zoom: 2 }, CANVAS), [860, 540]);
  assert.deepEqual(pointThroughCamera([1060, 540], { ...still, x: 100, zoom: 2 }, CANVAS), [1060, 540]);
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
