// W3 task 2: the report keeps a finding's `rule`, and a finding carries `suggest`, the value that fixes it: a colour that
// passes for `contrast` (the palette colour nearest the failing one), the floor and the factor that reaches it for
// `min-size`. Pure: hand-built snapshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { contrastRatio, nearestPassing } from '../../engine/review/contrast.mjs';
import { RULES, SUGGEST_KEYS } from '../../engine/review/rules.mjs';
import { safeRectFor, dedupeFindings } from '../../scripts/v2/review.mjs';
import { reviewFinding } from '../../scripts/v2/report.mjs';

const CANVAS = { w: 1920, h: 1080 };
const ctxWith = (extra = {}) => {
  const base = { look: registries.looks.get('desk'), canvas: CANVAS, mode: 'pro', shotId: 'hero', shotIndex: 0, t: 0.5, ...extra };
  return { safe: safeRectFor(base.canvas, base.look), ...base };
};
const at = (box) => ({ depth: 0, x: box[0], y: box[1], scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [], bbox: box, spread: 0 });
const field = (paper) => ({ ...at([-60, -60, 2040, 1200]), type: 'field', id: 'field', depth: 1, props: { field: 'paper', palette: { paper, ink: '#000000' } } });
// One word of text `sizeUnits` tall, in `fill`, over a field of `ground`.
function treeWith({ fill = '#000000', ground = '#ffffff', sizeUnits = 96 } = {}) {
  const width = sizeUnits * 2, height = sizeUnits * 1.15;
  const line = { x: 0, y: sizeUnits * 0.9, width, words: [{ text: 'word', index: 0, x: 0, width }] };
  return [field(ground), {
    ...at([200, 400, width, height]), type: 'text', id: 't', props: { fill },
    words: [{ opacity: 1, x: 0, y: 0, scale: 1 }],
    layout: { size: sizeUnits, width, height, overflow: false, lines: [line] },
  }];
}
const DESK_PALETTE = registries.looks.get('desk').palette;
const ruled = (found, rule) => found.filter((f) => f.rule === rule);

test('nearestPassing takes the nearest palette colour that passes', () => {
  assert.equal(nearestPassing('#ff1010', '#ffffff', { a: '#000000', b: '#ff0000' }), '#ff0000'); // red on white is 4.00:1
});

test('nearestPassing falls back to black or white when no palette colour passes', () => {
  assert.equal(nearestPassing('#eeeeee', '#ffffff', { a: '#fefefe' }), '#000000');
  assert.equal(nearestPassing('#222222', '#101010', { a: '#111111' }), '#ffffff');
});

test('nearestPassing skips a palette value that is not #rrggbb', () => {
  assert.equal(nearestPassing('#ff1010', '#ffffff', { a: 'red', b: '#000000' }), '#000000');
});

test('nearestPassing measures nearness in OKLab, not in sRGB', () => {
  // from #c83c3c: #965a5a is nearer in sRGB (65.6 against 87.2), #dc0000 is nearer in OKLab (0.056 against 0.102)
  const palette = { a: '#965a5a', b: '#dc0000' };
  assert.ok(Object.values(palette).every((c) => contrastRatio(c, '#ffffff') >= 3), 'both pass');
  assert.equal(nearestPassing('#c83c3c', '#ffffff', palette), '#dc0000');
});

test('nearestPassing breaks a tie by palette order, and returns the colour in lower case', () => {
  // a search over the grey-fill grid found no two distinct #rrggbb colours at the exact same OKLab distance, so the tie is
  // one colour written twice: either order gives it, and a palette written in upper case still gives a lower-case answer
  assert.equal(nearestPassing('#ffe14a', '#ffffff', { a: '#B8860B', b: '#b8860b' }), '#b8860b');
  assert.equal(nearestPassing('#ffe14a', '#ffffff', { a: '#b8860b', b: '#B8860B' }), '#b8860b');
});

test('nearestPassing takes the nearest colour that passes on every ground', () => {
  // #444444 is nearest to #555555 and passes on white, but not on #202020; #808080 passes on both
  const palette = { a: '#444444', b: '#808080' };
  assert.equal(nearestPassing('#555555', '#ffffff', palette), '#444444');
  assert.equal(nearestPassing('#555555', ['#ffffff', '#202020'], palette), '#808080');
});

test('nearestPassing falls back over every ground when none passes them all', () => {
  // black has 1.6:1 on #303030 as its worst, white has 1.0:1 on white as its worst
  assert.equal(nearestPassing('#777777', ['#ffffff', '#303030'], { a: '#fefefe' }), '#000000');
  assert.equal(nearestPassing('#777777', ['#000000', '#cfcfcf'], { a: '#fefefe' }), '#ffffff');
});

test('a contrast finding over two grounds carries a colour that passes on both', () => {
  // a light bar under the first word of a line over a mid-grey field: the colour must pass on the bar and on the field
  const word = (index, x, width) => ({ text: 'word', index, x, width });
  const width = 192, gap = 40, height = 110;
  const line = { x: 0, y: 86, width: width * 2 + gap, words: [word(0, 0, width), word(1, width + gap, width)] };
  const tree = [field('#808080'), { ...at([150, 380, width + 50, height + 40]), type: 'path', id: 'bar', depth: 1, props: { fill: '#f0f0f0' } }, {
    ...at([200, 400, width * 2 + gap, height]), type: 'text', id: 't', props: { fill: '#e8e8e8' },
    words: [{ opacity: 1, x: 0, y: 0, scale: 1 }, { opacity: 1, x: 0, y: 0, scale: 1 }],
    layout: { size: 96, width: width * 2 + gap, height, overflow: false, lines: [line] },
  }];
  const look = { ...registries.looks.get('desk'), palette: { a: '#8a8a8a', b: '#303030' } };
  const [f] = ruled(auditFrame(tree, ctxWith({ look })), 'contrast');
  assert.ok(f, 'the light words on the light bar fail');
  assert.equal(f.suggest.color, '#303030'); // #8a8a8a is nearer, but is 1.1:1 on the field
  assert.ok(['#f0f0f0', '#808080'].every((ground) => contrastRatio(f.suggest.color, ground) >= 3));
});

test('a suggest survives the film review dedupe and the report mapping', () => {
  const finding = { kind: 'mechanical', path: 'shots[0]', message: 'm', rule: 'contrast', node: 't', suggest: { color: '#b8860b' } };
  const [deduped] = dedupeFindings([{ shot: 'hero', t: 1, finding }]);
  assert.deepEqual(deduped.suggest, { color: '#b8860b' });
  assert.deepEqual(reviewFinding(deduped).suggest, { color: '#b8860b' });
});

test('a contrast finding carries the colour, and the colour passes', () => {
  const [f] = ruled(auditFrame(treeWith({ fill: '#ffe14a', ground: '#ffffff' }), ctxWith()), 'contrast');
  assert.match(f.suggest.color, /^#[0-9a-f]{6}$/);
  assert.ok(Object.values(DESK_PALETTE).includes(f.suggest.color), 'a palette colour, not an invented one');
  assert.ok(contrastRatio(f.suggest.color, '#ffffff') >= 3);
  assert.ok(f.message.endsWith(`; ${f.suggest.color} passes`), f.message);
});

test('a min-size finding carries the floor and the factor that reaches it', () => {
  const [f] = ruled(auditFrame(treeWith({ sizeUnits: 20 }), ctxWith()), 'min-size');
  assert.deepEqual(f.suggest, { minSize: 28, factor: 1.4 });
});

test('the factor rounds up, so scaling by it reaches the floor', () => {
  const [f] = ruled(auditFrame(treeWith({ sizeUnits: 27 }), ctxWith()), 'min-size');
  assert.equal(f.suggest.factor, 1.04); // 28 / 27 = 1.0370..., up to 2 decimals
  assert.ok(27 * f.suggest.factor >= 28);
});

test('the report keeps rule and suggest, and drops node and role', () => {
  assert.deepEqual(reviewFinding({ kind: 'mechanical', shot: 'a', path: 'shots[0]', message: 'm', t: 1, rule: 'min-size', node: 'x', role: 'hero', suggest: { minSize: 28, factor: 1.4 } }),
    { kind: 'mechanical', shot: 'a', path: 'shots[0]', message: 'm', t: 1, rule: 'min-size', suggest: { minSize: 28, factor: 1.4 } });
  assert.deepEqual(Object.keys(reviewFinding({ kind: 'creative', shot: 'a', path: 'p', message: 'm', t: 0, rule: 'still', node: '' })), ['kind', 'shot', 'path', 'message', 't', 'rule']);
});

test('a suggest holds only the registered keys, and only a rule the registry gives one', () => {
  const sweep = [
    ...auditFrame(treeWith({ fill: '#ffe14a', ground: '#ffffff' }), ctxWith()),
    ...auditFrame(treeWith({ sizeUnits: 20 }), ctxWith()),
    ...auditFrame(treeWith({ fill: '#151515', ground: '#111111', sizeUnits: 20 }), ctxWith()),
    ...auditFrame(treeWith({ sizeUnits: 96 }), ctxWith({ safe: { left: 900, top: 0, right: 1000, bottom: 1080 } })),
  ];
  assert.ok(sweep.some((f) => f.suggest), 'the sweep has a finding with a suggest');
  assert.ok(sweep.some((f) => !f.suggest), 'and one without');
  for (const f of sweep) {
    assert.ok(Object.keys(f.suggest ?? {}).every((k) => SUGGEST_KEYS.includes(k)), `${f.rule}: ${Object.keys(f.suggest ?? {})}`);
    if (f.suggest) assert.notEqual(RULES.find((r) => r.id === f.rule).suggest, null, `${f.rule} has no suggest in the registry`);
  }
  assert.deepEqual([...SUGGEST_KEYS], ['color', 'minSize', 'factor', 'cuts']);
});
