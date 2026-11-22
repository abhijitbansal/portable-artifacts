// The frame review's `dropped` rule (engine/review/frame.mjs): a text whose kind left out a secondary line to keep its
// secondary text at the look's floor (props.dropped, kinds/secondary.mjs) is a creative finding that names what went.
// Review C I2: the rule existed with no test that it fires.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { safeRectFor, frameContext } from '../../scripts/v2/review.mjs';
import '../../scripts/v2/list.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm } from '../../engine/graph/film.mjs';
import { FPS, measure, IMAGES, canvasOf, viralOf, filmOf } from './helpers/kinds.mjs';

const CANVAS = { w: 1920, h: 1080 };
const ctx = () => {
  const base = { look: registries.looks.get('desk'), canvas: CANVAS, mode: 'pro', shotId: 'c', shotIndex: 0, t: 1.2 };
  return { safe: safeRectFor(base.canvas, base.look), ...base };
};

// A text node as annotate() reports it (as review.test.mjs builds them): one line of `words` words, ascent 0.9 em.
function textNode({ id, size, x, y, words = 2, props = {} }) {
  const line = { x: 0, y: size * 0.9, width: words * size * 2, words: Array.from({ length: words }, (_, k) => ({ text: 'word', index: k, x: k * size * 2, width: size * 2 })) };
  return {
    type: 'text', id, depth: 0, props, x, y, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [],
    words: Array.from({ length: words }, () => ({ opacity: 1, x: 0, y: 0, scale: 1 })),
    layout: { size, width: line.width, height: line.y + size * 0.25, overflow: false, lines: [line] },
    bbox: [x, y, line.width, line.y + size * 0.25], spread: 0,
  };
}

test('a text that left out a line (props.dropped) is a creative "dropped" finding naming the text and what went', () => {
  const title = textNode({ id: 'c.title', size: 160, x: 200, y: 120, props: { role: 'hero', dropped: ['source'] } });
  const label = textNode({ id: 'c.label.0', size: 52, x: 200, y: 700, words: 1, props: { role: 'label' } });
  const found = auditFrame([title, label], ctx()).filter((f) => f.rule === 'dropped');
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0].kind, 'creative');
  assert.equal(found[0].node, 'c.title');
  assert.match(found[0].message, /left out its source/);
});

// A film built by the engine (the test measure leaves a cosmos end card's ask and mark, and a 1:1 quote's byline, out):
// the text that says so (props.dropped, as the engine built it) is audited as the page measures it, under the context the
// review builds for shot 0's last frame.
const everyNode = (nodes) => nodes.flatMap((n) => [n, ...everyNode(n.children ?? [])]);
function droppedFindings(shots, look, format) {
  const film = filmOf(shots, look, format);
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf(format);
  const built = buildFilm({ film, timeline, measure, assets: IMAGES, canvas, viralInsets: viralOf(canvas) });
  const entry = timeline.shots[0];
  const last = Math.round(entry.end * FPS) - 1;
  const tree = built.sampleShot(0, last / FPS - entry.start);
  const dropped = everyNode(tree).find((n) => Array.isArray(n.props?.dropped) && n.props.dropped.length > 0);
  assert.ok(dropped, 'the card left something out (the premise of this case)');
  const title = textNode({ id: dropped.id, size: 160, x: 200, y: 120, props: { role: 'hero', dropped: dropped.props.dropped } });
  const found = auditFrame([title], { ...frameContext(film, timeline, new Map(), { frame: last, whole: true }), restsShot: false });
  return found.filter((f) => f.rule === 'dropped');
}
const NEXT = { id: 'b', show: 'statement', say: 'Next one here.' };

test('a cut or an on event aimed at a part the card left out is named in the dropped finding, with the target it lands on', () => {
  const end = { id: 'e', show: 'end', say: 'Every number, with its source.', ask: 'Start today', mark: 'make-motion', on: [{ at: 'word:1', do: 'highlight', target: 'mark' }] };
  const [found] = droppedFindings([end, { ...NEXT, cut: { type: 'iris', at: 'ask' } }], 'cosmos', '16:9');
  assert.match(found.message, /left out its ask and mark/);
  assert.match(found.message, /shots\[1\]\.cut\.at, aimed at "ask", lands on "title"/);
  assert.match(found.message, /shots\[0\]\.on\[0\]\.target, aimed at "mark", lands on "title"/);
  const [both] = droppedFindings([end, { ...NEXT, cut: { type: 'iris', at: 'mark' } }], 'cosmos', '16:9');
  assert.match(both.message, /shots\[1\]\.cut\.at and shots\[0\]\.on\[0\]\.target, aimed at "mark", land on "title"/, 'two paths: "land"');
  const [plain] = droppedFindings([{ ...end, on: undefined }, NEXT], 'cosmos', '16:9');
  assert.doesNotMatch(plain.message, /aimed at/, 'nothing aimed at it, nothing said');
});

test('a quote byline the card left out is named by its target, "by", not by "attribution"', () => {
  const quote = { id: 'q', show: 'quote', say: 'Every chart should show its work.', by: 'The data desk' };
  const [found] = droppedFindings([quote, { ...NEXT, cut: { type: 'iris', at: 'by' } }], 'cosmos', '1:1');
  assert.match(found.message, /left out its attribution/);
  assert.match(found.message, /shots\[1\]\.cut\.at, aimed at "by", lands on "text"/);
});

test('no dropped finding without props.dropped, or with an empty list', () => {
  for (const props of [{ role: 'hero' }, { role: 'hero', dropped: [] }]) {
    const title = textNode({ id: 'c.title', size: 160, x: 200, y: 120, props });
    assert.deepEqual(auditFrame([title], ctx()).filter((f) => f.rule === 'dropped'), []);
  }
});
