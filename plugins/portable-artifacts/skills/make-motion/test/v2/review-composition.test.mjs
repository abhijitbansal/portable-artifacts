// The composition measure and its two creative rules (dead-space, scale-contrast): pure, over a sampled tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import { auditFrame, compositionOf, compositionFindings, fillOf, DEFAULT_FILL, COMPOSITION_RULES } from '../../engine/review/frame.mjs';

const CANVAS = { w: 1920, h: 1080 };
const SAFE = { left: 96, top: 96, right: 1824, bottom: 984 }; // 1728 by 888
const box = (id, bbox, extra = {}) => ({ type: 'path', id, depth: 0, props: { fill: '#111111', d: 'M0 0H1V1H0Z' }, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, visible: true, children: [], bbox, ...extra });
const ctx = (extra = {}) => ({ look: registries.looks.get('desk'), canvas: CANVAS, mode: 'pro', shotId: 'hero', shotIndex: 0, t: 1.2, safe: SAFE, restsShot: true, ...extra });
const rules = (findings) => findings.map((f) => f.rule).sort();

test('the rule ids are exported', () => {
  assert.deepEqual([...COMPOSITION_RULES], ['dead-space', 'scale-contrast']);
});
test('a small card alone in the frame: the empty band is 768 of 1728 across, the hero reaches 12% of the frame, and both rules fire', () => {
  const tree = [box('card', [864, 486, 192, 108])];
  const c = compositionOf(tree, ctx());
  assert.equal(c.band.axis, 'x');
  assert.ok(Math.abs(c.band.share - 768 / 1728) < 1e-9);
  assert.deepEqual([c.hero.id, c.next, c.ground], ['card', null, false]);
  assert.ok(Math.abs(c.hero.extent - 108 / 888) < 1e-9);
  assert.deepEqual(rules(compositionFindings(tree, ctx(), DEFAULT_FILL)), ['dead-space', 'scale-contrast']);
});
test('a block across the safe width and most of its height fires neither', () => {
  assert.deepEqual(compositionFindings([box('block', [96, 96, 1728, 700])], ctx(), DEFAULT_FILL), []);
});
test('a figure over its label with the lower 43% bare: dead-space names the bottom, and a hero at 40.5% of the width is large enough', () => {
  const found = compositionFindings([box('figure', [600, 220, 700, 240]), box('label', [600, 520, 700, 80])], ctx(), DEFAULT_FILL);
  assert.deepEqual(rules(found), ['dead-space']);
  assert.match(found[0].message, /43% of its height empty \(the bottom\)/);
  assert.ok(Math.abs(found[0].measure - (384 / 888 - 0.4)) < 1e-9);
  assert.deepEqual([found[0].kind, found[0].path, found[0].node], ['creative', 'shots[0]', '']);
});
test('two peers of one size have no hero: scale-contrast is silent, and the bare lower 43% is still dead space', () => {
  const tree = [box('left', [200, 300, 600, 300]), box('right', [1000, 300, 600, 300])];
  assert.equal(compositionOf(tree, ctx()).hero, null);
  assert.deepEqual(rules(compositionFindings(tree, ctx(), DEFAULT_FILL)), ['dead-space']);
});
test('a small title five times its label is a hero, and at 23% of the frame it is a scale-contrast finding', () => {
  const tree = [box('title', [700, 400, 400, 150]), box('label', [700, 570, 300, 40])];
  const c = compositionOf(tree, ctx());
  assert.deepEqual([c.hero.id, c.next.id], ['title', 'label']);
  assert.ok(Math.abs(c.hero.extent - 400 / 1728) < 1e-9);
  const found = compositionFindings(tree, ctx(), DEFAULT_FILL).find((f) => f.rule === 'scale-contrast');
  assert.match(found.message, /^the hero, "title", reaches 23% of the frame, and the next largest thing, "label", is smaller still/);
  assert.ok(Math.abs(found.measure - (0.4 - 400 / 1728)) < 1e-9);
});
test('what is not judged: a full-bleed picture, the field, a caption, a node at opacity 0, a path not yet drawn', () => {
  const picture = { ...box('photo', [0, 0, 1920, 1080]), type: 'image', props: {} };
  assert.equal(compositionOf([picture], ctx()).ground, true);
  assert.deepEqual(compositionFindings([picture, box('card', [864, 486, 192, 108])], ctx(), DEFAULT_FILL), []);
  const ignored = [box('field', [0, 0, 1920, 1080], { depth: 1 }), box('hero.captions', [200, 800, 1500, 120]), box('gone', [96, 96, 1728, 800], { opacity: 0 }), box('undrawn', [96, 96, 1728, 800], { draw: 0 })];
  assert.deepEqual(compositionOf([...ignored, box('card', [864, 486, 192, 108])], ctx()).elements.map((e) => e.id), ['card']);
});
test('the rules run only on a shot\'s resting frame, and a look\'s fill overrides the defaults', () => {
  const tree = [box('card', [864, 486, 192, 108])];
  assert.deepEqual(rules(auditFrame(tree, ctx({ restsShot: false }))), []);
  assert.deepEqual(rules(auditFrame(tree, ctx())), ['dead-space', 'scale-contrast']);
  assert.deepEqual(compositionFindings(tree, ctx(), { band: 0.5, hero: 0.1 }), []);
  assert.deepEqual(fillOf({ fill: { band: 0.55 } }), { band: 0.55, hero: DEFAULT_FILL.hero });
});
test('an empty frame, and a frame with one element, never throw', () => {
  assert.deepEqual(compositionOf([], ctx()).hero, null);
  assert.equal(compositionOf([], ctx()).band.share, 1);
});
test('a text is boxed by its ink (cap line to baseline), not its whole ascent-to-descent bbox; a text with no layout falls back to its bbox', () => {
  const layout = { size: 100, height: 120, lines: [{ x: 0, y: 100, words: [{ index: 0, text: 'HI', x: 0, width: 200 }] }] };
  const text = { ...box('title', [300, 300, 200, 120]), type: 'text', props: {}, layout };
  const [ink] = compositionOf([text], ctx()).elements;
  assert.deepEqual(ink.box.map((v) => Math.round(v * 1000) / 1000), [300, 330, 200, 70]);
  const [bare] = compositionOf([{ ...text, layout: undefined }], ctx()).elements;
  assert.deepEqual(bare.box, [300, 300, 200, 120]);
});
test('an empty frame: dead-space fires, scale-contrast does not; a caption box over a group child counts the child only', () => {
  assert.deepEqual(rules(compositionFindings([], ctx(), DEFAULT_FILL)), ['dead-space']);
  const group = { ...box('stack', [0, 0, 0, 0]), type: 'group', props: {}, children: [box('stack.a', [300, 200, 600, 200]), box('stack.b', [300, 450, 600, 100], { opacity: 0 })] };
  const [element] = compositionOf([group], ctx()).elements;
  assert.deepEqual([element.id, element.box], ['stack', [300, 200, 600, 200]]);
});
