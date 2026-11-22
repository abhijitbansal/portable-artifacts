// Glyph and line tracks (W6 Task 3) as the review reads them. A word drawn letter by letter keeps its own opacity and scale
// (the first letter must draw at full strength), so the review reads every word through `wordSeen`: the word, its letters
// (glyphRollup) and its line laid together (engine/review/seen.mjs). Each reader of a word's opacity or scale is held here:
// landing (textLandings, landedTexts, --inspect), the ink and the size floor, the rest scale, word overlap, line and hook word
// counts, contrast and whether a text shows at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import { track } from '../../engine/time/track.mjs';
import { node } from '../../engine/graph/node.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { annotate } from '../../engine/page/bounds.mjs';
import { glyphRollup as drawsRollup } from '../../engine/page/glyph-draw.mjs';
import { glyphRollup } from '../../engine/graph/rollup.mjs';
import { auditFrame, hasVisibleWord, landedTexts, textLandings, wordSeen } from '../../engine/review/frame.mjs';
import { inspectNodes } from '../../engine/review/inspect-nodes.mjs';
import { showsItself } from '../../engine/review/marks.mjs';
import '../../engine/kinds/index.mjs';
import { safeRectFor, restingByShot, hookFindings } from '../../scripts/v2/review.mjs';

const CANVAS = { w: 1920, h: 1080 };
const ctx = (extra = {}) => {
  const base = { look: registries.looks.get('desk'), canvas: CANVAS, mode: 'pro', shotId: 'hero', shotIndex: 0, t: 0.5, ...extra };
  return { safe: safeRectFor(base.canvas, base.look), ...base };
};
const hold = (v) => track([{ t: 0, v }]);
const AT = (a, b) => track([{ t: a, v: 0 }, { t: b, v: 1, ease: 'linear' }]);

// One 96 px line of `count` words, 192 px apart, as the page lays a statement out.
function layoutOf(count, texts = []) {
  const size = 96, width = count * 192;
  const words = Array.from({ length: count }, (_, k) => ({ text: texts[k] ?? 'word', index: k, x: k * 192, width: 192 }));
  return { size, width, height: size * 1.15, overflow: false, lines: [{ x: 0, y: size * 0.9, width, words }] };
}
// A sampled text (engine/graph) with the page's boxes and layout added (annotate).
const sampledText = (opts, count = 2) => node('text', 't', { layout: layoutOf(count), font: { family: 'Fraunces', size: 96 }, fill: '#000000', x: 200, y: 400 }, opts);
const annotatedAt = (n, t) => annotate(sampleGraph([n], t));

// ---- the review reads the roll-up ----

test('a text whose letters are still arriving has not landed; once they are in it has', () => {
  const n = sampledText({ wordTracks: [{}, {}], glyphTracks: [[{ opacity: AT(0, 1) }, { opacity: AT(1, 2) }]] });
  assert.equal(textLandings(annotatedAt(n, 1), ctx())[0].landed, false);
  assert.equal(textLandings(annotatedAt(n, 2), ctx())[0].landed, true);
  assert.deepEqual(landedTexts(annotatedAt(n, 1), ctx()), [], 'not a landed text for the overlay review either');
  assert.equal(landedTexts(annotatedAt(n, 2), ctx()).length, 1);
});

test('a line still arriving has not landed, though no word has a track of its own', () => {
  const n = sampledText({ lineTracks: [{ opacity: AT(0, 1), scale: AT(0, 1) }] });
  assert.deepEqual(textLandings(annotatedAt(n, 0), ctx()), [], 'at 0 every word is invisible: the text is not on screen');
  assert.equal(textLandings(annotatedAt(n, 0.5), ctx())[0].landed, false);
  assert.equal(textLandings(annotatedAt(n, 1), ctx())[0].landed, true);
});

test('a text whose first line has not arrived but whose second line has no track still shows: the roll-up covers every word', () => {
  const words = (indices, y) => indices.map((index) => ({ text: 'word', index, x: index * 192, width: 192 }));
  const layout = { ...layoutOf(4), lines: [{ x: 0, y: 86, width: 384, words: words([0, 1]) }, { x: 0, y: 200, width: 384, words: words([2, 3]) }] };
  const n = node('text', 't', { layout, font: { family: 'Fraunces', size: 96 }, fill: '#000000', x: 200, y: 400 }, { lineTracks: [{ opacity: hold(0) }] });
  const [s] = annotate(sampleGraph([n], 0));
  assert.deepEqual(s.seen.map((w) => w?.opacity), [0, 0, undefined, undefined], 'four words: the first line unseen, the second its own');
  assert.equal(hasVisibleWord(s), true);
  assert.equal(showsItself(s), true);
  assert.equal(textLandings([s], ctx()).length, 1, 'the text is on screen through its second line');
});

// A word has landed only when every letter and the line rest: a mean hides the one still moving.
test('letters fully opaque but still sliding have not landed; once they rest the text has', () => {
  const slide = track([{ t: 0, v: 24 }, { t: 1, v: 0, ease: 'linear' }]);
  const n = sampledText({ glyphTracks: [[{ opacity: hold(1), x: slide }, { opacity: hold(1) }]] });
  assert.equal(textLandings(annotatedAt(n, 0.5), ctx())[0].landed, false);
  assert.equal(textLandings(annotatedAt(n, 1), ctx())[0].landed, true);
  assert.equal(sampleGraph([n], 0.5)[0].seen[0].rest, false);
  assert.equal(sampleGraph([n], 1)[0].seen[0].rest, true);
});

test('letters that overshoot and undershoot, their mean scale about 1, have not landed', () => {
  // 'word' has four letters: 1.2, 0.8, 1, 1 is a mean of exactly 1
  const n = sampledText({ glyphTracks: [[{ scale: hold(1.2) }, { scale: hold(0.8) }]] });
  const [s] = sampleGraph([n], 0);
  assert.equal(s.seen[0].scale, 1);
  assert.equal(s.seen[0].rest, false);
  assert.equal(textLandings(annotatedAt(n, 0), ctx())[0].landed, false);
});

test('a line fully opaque and at scale but still moving has not landed', () => {
  const n = sampledText({ lineTracks: [{ y: track([{ t: 0, v: 30 }, { t: 1, v: 0, ease: 'linear' }]) }] });
  assert.equal(textLandings(annotatedAt(n, 0.5), ctx())[0].landed, false);
  assert.equal(textLandings(annotatedAt(n, 1), ctx())[0].landed, true);
});

// ---- the frame-0 hook check counts words as the viewer sees them ----

const heroNode = (opts) => node('text', 'hero', { layout: layoutOf(2), font: { family: 'Fraunces', size: 96 }, fill: '#000000', x: 200, y: 400, role: 'hero' }, opts);
const filmOf = (mode = 'viral') => ({ mode, shots: [{ id: 'hook', show: 'statement' }] });
const zero = (n) => [{ frame: 0, tree: annotate(sampleGraph([n], 0)) }];

test('a hero whose letters are not on frame 0 is a hook finding, whatever its words say', () => {
  const hidden = heroNode({ wordTracks: [{}, {}], glyphTracks: [[{ opacity: hold(0) }], [{ opacity: hold(0) }]] });
  const [found] = hookFindings(filmOf(), {}, zero(hidden));
  assert.equal(found.rule, 'hook');
  assert.match(found.message, /2 of its 2 words are not on screen yet/);
  const first = heroNode({ glyphTracks: [[{ opacity: hold(1) }, { opacity: hold(0) }]] });
  assert.equal(hookFindings(filmOf(), {}, zero(first)).length, 1, 'the first letter alone is not all of its text');
});

test('a hero whose line is not on frame 0 is a hook finding, with or without word tracks', () => {
  assert.equal(hookFindings(filmOf(), {}, zero(heroNode({ lineTracks: [{ opacity: hold(0) }] }))).length, 1);
  assert.equal(hookFindings(filmOf(), {}, zero(heroNode({ wordTracks: [{}, {}], lineTracks: [{ opacity: hold(0) }] }))).length, 1);
  assert.equal(hookFindings(filmOf(), {}, zero(heroNode({ lineTracks: [{ y: hold(30) }] }))).length, 1, 'a line still sliding is not all on screen');
});

test('a hero with letters and line at rest on frame 0 is not a hook finding, and a pro film is not held to it', () => {
  const rest = heroNode({ wordTracks: [{}, {}], glyphTracks: [[{ opacity: hold(1) }]], lineTracks: [{ opacity: hold(1) }] });
  assert.deepEqual(hookFindings(filmOf(), {}, zero(rest)), []);
  assert.deepEqual(hookFindings(filmOf('pro'), {}, zero(heroNode({ lineTracks: [{ opacity: hold(0) }] }))), []);
});

test('a line at rest opacity but off its scale has not landed', () => {
  const n = sampledText({ lineTracks: [{ scale: track([{ t: 0, v: 0.9 }, { t: 1, v: 1, ease: 'linear' }]) }] });
  assert.equal(textLandings(annotatedAt(n, 0.5), ctx())[0].landed, false);
});

test('the reading survives the page.evaluate round trip: holes in the roll-up arrive as null', () => {
  const n = sampledText({ glyphTracks: [undefined, [{ opacity: AT(0, 1) }, {}]] });
  const direct = annotatedAt(n, 0.5);
  const sent = JSON.parse(JSON.stringify(direct));
  assert.equal(sent[0].seen[0], null);
  assert.deepEqual(textLandings(sent, ctx()), textLandings(direct, ctx()));
  assert.deepEqual(wordSeen(sent[0], 0), wordSeen(direct[0], 0), 'a null entry reads as the word');
});

test('--inspect reports a text mid-entrance as not landed', () => {
  const n = sampledText({ lineTracks: [{ opacity: AT(0, 1) }] });
  const text = (t) => inspectNodes(annotatedAt(n, t), ctx()).find((item) => item.id === 't').text;
  assert.equal(text(0.5).landed, false);
  assert.equal(text(1).landed, true);
});

test('wordSeen is the roll-up laid over the word where there is one, and the word where there is none', () => {
  const rolled = sampleGraph([sampledText({ wordTracks: [{ x: hold(7) }, {}], glyphTracks: [[{ opacity: hold(0) }, { opacity: hold(1) }]] })], 0)[0];
  // 'word' has four graphemes: the two with tracks (0 and 1) and two at the identity, a mean of 0.75
  assert.deepEqual(wordSeen(rolled, 0), { opacity: 0.75, x: 7, y: 0, scale: 1, fill: '#000000', rest: false }, "the word's other values stay; a letter at 0 is not at rest");
  assert.deepEqual(wordSeen(rolled, 1), { opacity: 1, x: 0, y: 0, scale: 1, fill: '#000000' }, 'a word with neither is as it is');
  const bare = sampleGraph([sampledText({ wordTracks: [{ opacity: hold(0.25) }, {}] })], 0)[0];
  assert.equal(bare.seen, undefined);
  assert.equal(wordSeen(bare, 0).opacity, 0.25);
  assert.deepEqual(wordSeen({ type: 'text' }, 3), { opacity: 1, x: 0, y: 0, scale: 1 }, 'a text with no words at all');
});

test('the roll-up the review reads is the function the draw uses', () => {
  assert.equal(drawsRollup, glyphRollup);
});

// ---- hand-built snapshots: each reader of a word's opacity and scale goes through wordSeen ----

const at = (box) => ({ depth: 0, x: box[0], y: box[1], scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [], bbox: box, spread: 0 });
const field = (paper) => ({ ...at([-60, -60, 2040, 1200]), type: 'field', id: 'field', depth: 1, props: { field: 'paper', palette: { paper, ink: '#000000' } } });
function textNode({ x = 200, count = 2, fill = '#000000', words, seen, size = 96 } = {}) {
  const layout = { ...layoutOf(count), size };
  const own = words ?? Array.from({ length: count }, () => ({}));
  return {
    ...at([x, 400, layout.width, layout.height]), type: 'text', id: 't', props: { fill }, layout,
    words: own.map((w) => ({ opacity: 1, x: 0, y: 0, scale: 1, ...w })),
    ...(seen ? { seen } : {}),
  };
}
const rule = (name, tree, extra) => auditFrame(tree, ctx(extra)).filter((f) => f.rule === name);
const SEEN_NONE = { opacity: 0, scale: 1 };
const SEEN_ALL = { opacity: 1, scale: 1 };

test('a word whose letters have not arrived is not in the ink: the safe-area rule judges only the words seen', () => {
  // x 1400: word 0 (1400 to 1592) is inside, word 1 (1592 to 1784) too, a third (1784 to 1976) runs past the right edge
  const three = (seen) => [textNode({ x: 1400, count: 3, seen })];
  assert.deepEqual(rule('safe-area', three([SEEN_ALL, SEEN_ALL, SEEN_NONE])), [], 'the third word is not on screen yet');
  assert.equal(rule('safe-area', three([SEEN_ALL, SEEN_ALL, SEEN_ALL])).length, 1);
  assert.equal(rule('safe-area', three(undefined)).length, 1, 'with no roll-up the word is read as it is');
});

test('a text whose every word is unseen shows nothing: it is not judged, not listed, and shows nothing of itself', () => {
  const unseen = textNode({ x: 1400, count: 3, seen: [SEEN_NONE, SEEN_NONE, SEEN_NONE] });
  assert.equal(hasVisibleWord(unseen), false);
  assert.equal(showsItself(unseen), false);
  assert.deepEqual(auditFrame([unseen], ctx()), []);
  assert.equal(hasVisibleWord(textNode({ seen: [SEEN_NONE, SEEN_ALL] })), true);
  assert.equal(showsItself(textNode({ seen: [SEEN_NONE, { opacity: 0.1, scale: 1 }] })), true);
});

test('a word seen at half scale counts at half size: the size floor and the rest scale read the roll-up', () => {
  // 44 px words resting at half scale are 22 units tall: under the floor of 28 on a landed text
  const half = { opacity: 1, scale: 0.5 };
  const tree = [textNode({ size: 44, seen: [half, half] })];
  const resting = { restWords: new Map([['t', [0.5, 0.5]]]) };
  assert.equal(rule('min-size', tree, resting).length, 1);
  assert.deepEqual(rule('min-size', [textNode({ size: 44 })], resting), [], 'with no roll-up the word is at scale 1, off its rest, and not landed');
});

test('a word that overlaps its neighbour only while unseen is not an overlap', () => {
  const closer = [{ x: 0 }, { x: -120 }]; // the second word 120 px into the first
  assert.equal(rule('word-overlap', [textNode({ words: closer, seen: [SEEN_ALL, SEEN_ALL] })]).length, 1);
  assert.deepEqual(rule('word-overlap', [textNode({ words: closer, seen: [SEEN_ALL, SEEN_NONE] })]), []);
});

test('a line of words counts only the words seen', () => {
  const many = (seen) => [textNode({ count: 13, seen })];
  assert.equal(rule('line-words', many(Array(13).fill(SEEN_ALL))).length, 1);
  assert.deepEqual(rule('line-words', many([...Array(11).fill(SEEN_ALL), SEEN_NONE, SEEN_NONE])), [], '11 words are seen, the limit is 12');
});

test('the contrast rule judges the colours of the words seen, not those still arriving', () => {
  const same = (seen) => [field('#111111'), textNode({ fill: '#151515', count: 1, seen })];
  assert.equal(rule('contrast', same([SEEN_ALL])).length, 1);
  assert.deepEqual(rule('contrast', same([{ opacity: 0.4, scale: 1 }])), [], 'a word still fading in is not read yet');
});

test('the rest scale of a word is the one it holds where it is seen in full', () => {
  const frame = (seen) => ({ frame: seen.frame, tree: [textNode({ seen: [seen.word, SEEN_ALL] })] });
  const timeline = { fps: 30, frameCount: 4, duration: 4 / 30, shots: [{ id: 'hero', index: 0, start: 0, end: 4 / 30, duration: 4 / 30 }] };
  const arriving = { opacity: 0.5, scale: 0.4 }, settled = { opacity: 1, scale: 0.9 };
  const snapshots = [frame({ frame: 0, word: arriving }), frame({ frame: 1, word: arriving }), frame({ frame: 2, word: settled }), frame({ frame: 3, word: settled })];
  assert.deepEqual(restingByShot(timeline, snapshots).get('hero').restWords.get('t'), [0.9, 1]);
});
