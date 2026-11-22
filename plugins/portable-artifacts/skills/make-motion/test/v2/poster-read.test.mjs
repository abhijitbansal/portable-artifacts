// W4 task 2: the poster is checked for how it reads as a thumbnail. posterReadFindings (engine/review/poster.mjs) takes the
// page's snapshot of the poster frame and judges the largest text that is neither a spoken caption nor frame furniture:
// under 14 px on a 180 px-tall thumbnail (84 units) is one creative finding. This file needs no browser; the page run is
// poster-browser.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { registries } from '../../engine/registry.mjs';
import { posterReadFindings, POSTER_THUMB_SHORT_SIDE, POSTER_MIN_TEXT_PX, POSTER_MIN_UNITS } from '../../engine/review/poster.mjs';
import { ruleOf } from '../../engine/review/rules.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';

const CANVAS = { w: 1920, h: 1080 };
const LOOK = registries.looks.get('desk');
const CTX = { look: LOOK, canvas: CANVAS, mode: 'pro', shotId: 'a', shotIndex: 2, t: 0, safe: safeRectFor(CANVAS, LOOK) };
const at = (box, extra = {}) => ({ depth: 0, x: box[0], y: box[1], scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [], bbox: box, spread: 0, ...extra });

// One word of text `size` units tall.
const text = (id, size, props = {}, y = 400, extra = {}) => {
  const width = size * 2, height = size * 1.15;
  const line = { x: 0, y: size * 0.9, width, words: [{ text: 'word', index: 0, x: 0, width }] };
  return at([extra.x ?? 400, y, width, height], { type: 'text', id, ...(extra.opacity === undefined ? {} : { opacity: extra.opacity }), props: { fill: '#000000', ...props }, words: [{ opacity: 1, x: 0, y: 0, scale: 1 }], layout: { size, width, height, overflow: false, lines: [line] } });
};
const treeWithTexts = (sizes) => sizes.map((size, k) => text(`t${k}`, size, {}, 100 + k * 200));

test('the numbers: a 180 px thumbnail, 14 px, so 84 units', () => {
  assert.equal(POSTER_THUMB_SHORT_SIDE, 180);
  assert.equal(POSTER_MIN_TEXT_PX, 14);
  assert.equal(POSTER_MIN_UNITS, 84);
});

test('a poster whose largest text is 40 units is a finding with the size to reach', () => {
  const [f, ...rest] = posterReadFindings(treeWithTexts([40, 30]), CTX);
  assert.equal(rest.length, 0);
  assert.equal(f.rule, 'poster-read');
  assert.equal(f.kind, 'creative');
  assert.equal(f.node, 't0');
  assert.equal(f.path, 'shots[2]');
  assert.deepEqual(f.suggest, { minSize: 84, factor: 2.1 });
  assert.match(f.message, /is 6\.7 px tall on a 180 px thumbnail; it needs 14 px \(84 units\)/);
  assert.match(f.message, /pick a frame with a bigger line or enlarge "t0"/);
});

test('84 units passes; so does a frame with no text', () => {
  assert.deepEqual(posterReadFindings(treeWithTexts([84]), CTX), []);
  assert.deepEqual(posterReadFindings(treeWithTexts([]), CTX), []);
});

test('a caption and a slug do not count as the poster text', () => {
  const tree = [text('caption', 200, { role: 'caption', furniture: true, caption: { zone: [0, 800, 1920, 200], end: 1, hero: 'hero', emphasis: [], marks: [] } }, 700),
    text('slug', 150, { role: 'slug', furniture: true }, 50), text('hero', 40, {}, 300)];
  const found = posterReadFindings(tree, CTX);
  assert.equal(found.length, 1);
  assert.equal(found[0].node, 'hero');
  assert.match(found[0].message, /is 6\.7 px tall/);
});

test('a frame whose only texts are captions or furniture is a picture poster: no finding', () => {
  assert.deepEqual(posterReadFindings([text('slug', 20, { furniture: true })], CTX), []);
});

test('a text in a scaled group is judged at the size it stands on the frame', () => {
  const group = at([0, 0, 1920, 1080], { type: 'group', id: 'g', scale: 2, children: [text('inner', 30)] });
  const [f] = posterReadFindings([group], CTX);
  assert.match(f.message, /is 10 px tall/, 'a 30-unit line in a group scaled by 2 stands 60 units, 10 px');
  assert.deepEqual(posterReadFindings([{ ...group, scale: 3 }], CTX), [], '90 units reads');
});

test('a furniture text inside a group is set aside too', () => {
  const card = at([0, 0, 1920, 1080], { type: 'group', id: 'card', children: [text('kicker', 200, { role: 'kicker', furniture: true }, 100)] });
  const found = posterReadFindings([card, text('hero', 40, {}, 500)], CTX);
  assert.equal(found.length, 1);
  assert.equal(found[0].node, 'hero');
});

test('a spoken caption is set aside on its own props.caption, without the furniture flag', () => {
  const found = posterReadFindings([text('c', 200, { caption: { zone: [0, 800, 1920, 200], end: 1, hero: 'hero', emphasis: [], marks: [] } }, 700), text('hero', 40, {}, 300)], CTX);
  assert.equal(found.length, 1);
  assert.equal(found[0].node, 'hero');
});

test('a big line still sliding in from off the frame does not hide a small line that is on it', () => {
  const sliding = text('sliding', 200, {}, 100, { x: -300 });
  const [f, ...rest] = posterReadFindings([sliding, text('small', 40, {}, 500)], CTX);
  assert.equal(rest.length, 0);
  assert.equal(f.node, 'small');
  assert.deepEqual(posterReadFindings([text('sliding', 200, {}, 100, { x: -300 })], CTX), [], 'a frame whose only text is off it is a picture poster');
});

test('a big line that is barely visible does not hide a small one that is', () => {
  const [f] = posterReadFindings([text('fading', 200, {}, 100, { opacity: 0.2 }), text('small', 40, {}, 500)], CTX);
  assert.equal(f.node, 'small');
  assert.deepEqual(posterReadFindings([text('fading', 200, {}, 100, { opacity: 0.9 }), text('small', 40, {}, 500)], CTX), [], 'a line at 0.9 reads');
});

test('the opacity floor is 0.5 and a text at exactly 0.5 counts: a big line at 0.5 hides a small one, one just under does not', () => {
  const small = text('small', 40, {}, 500);
  assert.deepEqual(posterReadFindings([text('half', 200, {}, 100, { opacity: 0.5 }), small], CTX), [], 'at exactly 0.5 the big line is the poster\'s');
  // inspectNodes reports an opacity to two decimals, so 0.49 is the nearest value under the floor
  const [f] = posterReadFindings([text('almost', 200, {}, 100, { opacity: 0.49 }), small], CTX);
  assert.equal(f.node, 'small', 'under 0.5 it is left out');
});

test('the rule is registered as a creative, uncapped poster rule that suggests a minimum size', () => {
  const rule = ruleOf('poster-read');
  assert.deepEqual([rule.kinds, rule.stage, rule.capped, rule.suggest, rule.evidence], [['creative'], 'poster', false, 'minSize', 'unmeasured']);
  assert.match(rule.ask, /\?$/);
});
