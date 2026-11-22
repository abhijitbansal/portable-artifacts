// The composition measure and its two creative rules (dead-space, scale-contrast): pure, over a sampled tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/kinds/index.mjs';
import { auditFrame, openingFindings, compositionOf, compositionFindings, fillOf, DEFAULT_FILL, COMPOSITION_RULES } from '../../engine/review/frame.mjs';
import { capComposition, restsShotAt, COMPOSITION_CAP } from '../../scripts/v2/review.mjs';

const CANVAS = { w: 1920, h: 1080 };
const SAFE = { left: 96, top: 96, right: 1824, bottom: 984 }; // 1728 by 888
const box = (id, bbox, extra = {}) => ({ type: 'path', id, depth: 0, props: { fill: '#111111', d: 'M0 0H1V1H0Z' }, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, visible: true, children: [], bbox, ...extra });
const FIXED = { props: { fill: '#111111', d: 'M0 0H1V1H0Z', fixed: true } }; // a pinned overlay: a slug, a mark, a caption card
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
test('the calibrated defaults: an empty band of 35% of a side, a hero under 50% of it', () => {
  assert.deepEqual({ ...DEFAULT_FILL }, { band: 0.35, hero: 0.5 });
});
test('the percent in a message is rounded down, so a hero at 54.6% never reads as 55% against a bar it is under', () => {
  const [found] = compositionFindings([box('hero', [100, 100, 0.496 * 1728, 300])], ctx(), { band: 1, hero: 0.5 });
  assert.match(found.message, /^the hero, "hero", reaches 49% of the frame/);
  const [bare] = compositionFindings([box('card', [96, 96, 1728, 285])], ctx(), DEFAULT_FILL); // 603 of 888 is bare: 67.9%
  assert.match(bare.message, /leaves 67% of its height empty/);
});
test('a captioned shot is measured against the safe rectangle less the room its captions reserve (ctx.captionZone): the reserved strip is not empty space and a hero that clears it is not small', () => {
  const zone = [200, 800, 1500, 160]; // the caption layout's zone, in the bottom of the safe rectangle (96..984)
  const wide = [box('body', [96, 96, 1728, 500])];
  assert.deepEqual(rules(compositionFindings(wide, ctx(), DEFAULT_FILL)), ['dead-space'], 'uncaptioned: 388 of 888 bare below it');
  assert.deepEqual(compositionFindings(wide, ctx({ captionZone: zone }), DEFAULT_FILL), [], 'captioned: 204 of 704 bare');
  const c = compositionOf(wide, ctx({ captionZone: zone }));
  assert.ok(Math.abs(c.band.share - 204 / 704) < 1e-9);
  const tall = [box('title', [300, 200, 700, 400])];
  assert.deepEqual(rules(compositionFindings(tall, ctx(), DEFAULT_FILL)).includes('scale-contrast'), true, 'uncaptioned: 45% of the height');
  assert.deepEqual(rules(compositionFindings(tall, ctx({ captionZone: zone }), DEFAULT_FILL)).includes('scale-contrast'), false, 'captioned: 400 of 704 is 57%');
  assert.ok(Math.abs(compositionOf(tall, ctx({ captionZone: zone })).hero.extent - 400 / 704) < 1e-9);
});
test('a caption zone at the top takes the top of the safe rectangle; a zone that is not a box, or takes all of it, changes nothing', () => {
  const tree = [box('body', [96, 400, 1728, 584])];
  const top = compositionOf(tree, ctx({ captionZone: [200, 96, 1500, 150] }));
  assert.ok(Math.abs(top.band.share - (400 - 246) / 738) < 1e-9, 'the safe top moves to 246: 154 of 738 bare above');
  assert.deepEqual(compositionOf(tree, ctx({ captionZone: undefined })).band, compositionOf(tree, ctx()).band);
  assert.deepEqual(compositionOf(tree, ctx({ captionZone: [0, 0, 'x', 1] })).band, compositionOf(tree, ctx()).band);
  assert.deepEqual(compositionOf(tree, ctx({ captionZone: [0, 96, 1920, 888] })).band, compositionOf(tree, ctx()).band);
});
test('a figure over its label with the lower 43% bare: dead-space names the bottom, and a hero at 58% of the width is large enough', () => {
  const found = compositionFindings([box('figure', [400, 220, 1000, 240]), box('label', [400, 520, 1000, 80])], ctx(), DEFAULT_FILL);
  assert.deepEqual(rules(found), ['dead-space']);
  assert.match(found[0].message, /43% of its height empty \(the bottom\)/);
  assert.ok(Math.abs(found[0].measure - (384 / 888 - DEFAULT_FILL.band)) < 1e-9);
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
  assert.ok(Math.abs(found.measure - (DEFAULT_FILL.hero - 400 / 1728)) < 1e-9);
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
test('a poster ground sheet (id ground, full canvas, depth 0) is not an element: the sheet plus a small card gives both findings', () => {
  const sheet = box('ground', [0, 0, 1920, 1080], { fixed: true });
  const tree = [sheet, box('card', [864, 486, 192, 108])];
  const c = compositionOf(tree, ctx());
  assert.deepEqual([c.ground, c.elements.map((e) => e.id)], [false, ['card']]);
  assert.deepEqual(rules(compositionFindings(tree, ctx(), DEFAULT_FILL)), ['dead-space', 'scale-contrast']);
});
test('a shot with only its ground sheet on screen opens on an empty frame; with a card it does not', () => {
  const sheet = box('ground', [0, 0, 1920, 1080]);
  assert.deepEqual(openingFindings([sheet], ctx()).map((f) => f.rule), ['empty-first-frame']);
  assert.deepEqual(openingFindings([sheet, box('card', [864, 486, 192, 108])], ctx()), []);
});
test('an element wholly outside the safe rectangle does not split the band on the other axis', () => {
  const tree = [box('card', [864, 100, 192, 108]), box('slug', [10, 600, 60, 40])];
  const { band } = compositionOf(tree, ctx());
  assert.deepEqual([band.axis, band.where], ['y', 'bottom']);
  assert.ok(Math.abs(band.share - (984 - 208) / 888) < 1e-9);
});
test('the caption boundary is the page\'s: <shot>.captions and <shot>.captions.<n> are captions, <shot>.captionsCard is not', () => {
  const tree = [box('hero.captions', [200, 800, 1500, 120]), box('hero.captions.3', [200, 800, 1500, 120]), box('hero.captionsCard', [864, 486, 192, 108])];
  assert.deepEqual(compositionOf(tree, ctx()).elements.map((e) => e.id), ['hero.captionsCard']);
});
test('a text whose ink cannot be measured does not abort the review: it is skipped here and reported once as "could not be measured"', () => {
  const text = { ...box('title', [300, 300, 200, 120]), type: 'text', props: {}, layout: { size: 100, height: 120, lines: [{ x: 0, y: 100, words: [null] }] } };
  assert.deepEqual(compositionOf([text, box('card', [864, 486, 192, 108])], ctx()).elements.map((e) => e.id), ['card']);
  const found = auditFrame([text, box('card', [864, 486, 192, 108])], ctx());
  assert.deepEqual(found.filter((f) => f.rule === 'measure').map((f) => [f.kind, f.node]), [['mechanical', 'title']]);
  assert.ok(found.some((f) => f.rule === 'dead-space'));
});
test('fillOf ignores a key that is not a finite number above 0 and at most 1, and a key that is not a field', () => {
  assert.deepEqual(fillOf({ fill: { band: undefined, hero: 2 } }), DEFAULT_FILL);
  assert.deepEqual(fillOf({ fill: { band: 0, hero: 0.25 } }), { band: DEFAULT_FILL.band, hero: 0.25 });
  assert.deepEqual(fillOf({ fill: { band: Number.NaN, hero: '0.3' } }), DEFAULT_FILL);
  assert.deepEqual(fillOf({ fill: { constructor: 0.5, toString: 0.2, gap: 0.3 } }), DEFAULT_FILL);
});
test('a fixed overlay (slug, mark, rule) is furniture, not an element; the shot\'s own caption card stays', () => {
  const slug = box('hero.slug', [96, 20, 1728, 40], FIXED);
  const card = box('hero.caption.card', [1200, 800, 500, 120], FIXED);
  const other = box('other.caption.card', [100, 100, 500, 120], FIXED);
  assert.deepEqual(compositionOf([{ ...slug, props: { ...slug.props, fixed: false } }], ctx()).elements.map((e) => e.id), ['hero.slug'], 'the same node, not fixed, is an element');
  assert.deepEqual(compositionOf([slug, card, other, box('title', [400, 300, 800, 300])], ctx()).elements.map((e) => e.id), ['hero.caption.card', 'title']);
});
test('a frame with only a margin slug shows nothing: it is judged empty, in those words', () => {
  const slug = box('hero.slug', [96, 20, 1728, 40], FIXED);
  const [found] = compositionFindings([slug], ctx(), DEFAULT_FILL);
  assert.match(found.message, /^the frame shows nothing: 100% of its width is empty;/);
});
test('peers: scale-contrast is skipped on a shot whose kind lays out equals; dead-space is not', () => {
  const tree = [box('items', [200, 300, 600, 200]), box('rule', [200, 520, 600, 4])];
  assert.deepEqual(rules(compositionFindings(tree, ctx(), DEFAULT_FILL)), ['dead-space', 'scale-contrast']);
  assert.deepEqual(rules(compositionFindings(tree, ctx({ peers: true }), DEFAULT_FILL)), ['dead-space']);
  const peerKinds = registries.kinds.names().filter((name) => registries.kinds.get(name).peers === true).sort();
  assert.deepEqual(peerKinds, ['compare', 'feed', 'list', 'timeline']);
});
test('an empty frame says it is empty, not "a band through the middle"', () => {
  const [found] = compositionFindings([], ctx(), DEFAULT_FILL);
  assert.match(found.message, /^the frame shows nothing: 100% of its width is empty;/);
});
test('the cap keeps the three worst composition findings, says how many it dropped, and leaves other rules alone', () => {
  const f = (rule, measure, t) => ({ kind: 'creative', shot: `s${t}`, path: `shots[${t}]`, message: 'm', t, rule, node: '', ...(measure === undefined ? {} : { measure }) });
  assert.equal(COMPOSITION_CAP, 3);
  const kept = capComposition([f('dead-space', 0.05, 0), f('still', undefined, 1), f('scale-contrast', 0.3, 2), f('dead-space', 0.1, 3), f('dead-space', 0.2, 4), f('scale-contrast', 0.01, 5)]);
  assert.deepEqual(kept.map((x) => x.t), [1, 2, 3, 4]);
  assert.equal(kept.find((x) => x.t === 3).message, 'm (2 more composition findings are left out; fix the worst first)');
  assert.equal(kept.find((x) => x.t === 2).message, 'm');
  assert.deepEqual(capComposition([f('dead-space', 0.05, 0)]).map((x) => x.message), ['m']);
  const one = capComposition([f('dead-space', 0.5, 0), f('dead-space', 0.4, 1), f('dead-space', 0.3, 2), f('dead-space', 0.2, 3)]);
  assert.equal(one.find((x) => x.t === 2).message, 'm (1 more composition finding is left out; fix the worst first)');
});
test('a shot rests on its last frame, audited whole', () => {
  const timeline = { fps: 30, shots: [{ id: 'a', index: 0, start: 0, end: 2, duration: 2 }, { id: 'b', index: 1, start: 2, end: 3, duration: 1 }] };
  assert.equal(restsShotAt(timeline, 59, true), true);
  assert.equal(restsShotAt(timeline, 58, true), false);
  assert.equal(restsShotAt(timeline, 89, false), false);
  assert.equal(restsShotAt(timeline, 89, true), true);
});
test('an empty frame: dead-space fires, scale-contrast does not; an opacity-0 group child is left out of the group\'s box', () => {
  assert.deepEqual(rules(compositionFindings([], ctx(), DEFAULT_FILL)), ['dead-space']);
  const group = { ...box('stack', [0, 0, 0, 0]), type: 'group', props: {}, children: [box('stack.a', [300, 200, 600, 200]), box('stack.b', [300, 450, 600, 100], { opacity: 0 })] };
  const [element] = compositionOf([group], ctx()).elements;
  assert.deepEqual([element.id, element.box], ['stack', [300, 200, 600, 200]]);
});
