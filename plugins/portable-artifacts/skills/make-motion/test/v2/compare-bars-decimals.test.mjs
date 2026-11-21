// Deep review MOTE-1 (compare bars keep sign, magnitude and unit, or are not drawn) and MOTE-2 (number decimals default to
// the value's own decimal places). Pure scene-graph work with the fake text measure (helpers/kinds.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { expandShot, textNode } from './helpers/kinds.mjs';

const allNodes = (nodes) => nodes.flatMap((n) => [n, ...allNodes(n.children ?? [])]);
const byId = (nodes, id) => allNodes(nodes).find((n) => n.id === id);
const barLength = (nodes, id) => {
  const bar = byId(nodes, id);
  if (!bar) return null;
  const nums = (bar.props.d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  return Math.max(...xs) - Math.min(...xs);
};
const compare = (left, right) => ({
  id: 'gap', show: 'compare', say: 'The gap between the two.',
  left: { title: 'North', value: left, points: ['orders'] }, right: { title: 'West', value: right, points: ['orders'] },
});
const lengths = (left, right) => {
  const { nodes } = expandShot(compare(left, right), 'marker', '16:9');
  return [barLength(nodes, 'gap.left.bar'), barLength(nodes, 'gap.right.bar')];
};

test('compare bars: a negative value draws no bars', () => {
  assert.deepEqual(lengths(-5, 10), [null, null]);
  assert.deepEqual(lengths('-5', '10'), [null, null]);
});

test('compare bars: magnitude suffixes put both sides on one scale (1.5M against 800k)', () => {
  const [l, r] = lengths('1.5M', '800k');
  assert.ok(l > 0 && r > 0, 'both bars are drawn');
  assert.ok(Math.abs(r / l - 800000 / 1500000) < 0.02, `bars ${l} and ${r} are in the ratio of 1.5M to 800k`);
});

test('compare bars: percent against a bare number, or two different units, draw no bars', () => {
  assert.deepEqual(lengths('5%', '10'), [null, null]);
  assert.deepEqual(lengths('$5', '10'), [null, null]);
});

test('compare bars: two percentages and two plain numbers still draw at their true ratio', () => {
  const [pl, pr] = lengths('5%', '10%');
  assert.ok(Math.abs(pl / pr - 0.5) < 0.02, `percent bars ${pl} and ${pr}`);
  const [nl, nr] = lengths('182', '59');
  assert.ok(Math.abs(nl / nr - 182 / 59) < 0.03 * (182 / 59), `plain bars ${nl} and ${nr}`);
});

test('compare bars: an unparsable value draws no bars', () => {
  assert.deepEqual(lengths('about 5', '10'), [null, null]);
  assert.deepEqual(lengths('5 of 10', '10'), [null, null], 'digits after the suffix: not plainly a number');
  assert.deepEqual(lengths('Q3', '10'), [null, null]);
});

test('compare bars: any trailing suffix is the unit, and the same suffix on both sides draws at the true ratio', () => {
  for (const [left, right, ratio] of [['12 min', '40 min', 12 / 40], ['3x', '10x', 3 / 10], ['5€', '7€', 5 / 7], ['40+', '60+', 40 / 60], ['5 m', '10 m', 0.5], ['2 kg', '8 kg', 0.25], ['3M users', '12M users', 0.25]]) {
    const [l, r] = lengths(left, right);
    assert.ok(l > 0 && r > 0, `${left} vs ${right}: both bars are drawn`);
    assert.ok(Math.abs(l / r - ratio) < 0.03 * ratio, `${left} vs ${right}: bars ${l} and ${r} are in ratio ${ratio}`);
  }
});

test('compare bars: different suffixes draw no bars', () => {
  assert.deepEqual(lengths('12 min', '40 h'), [null, null]);
  assert.deepEqual(lengths('3x', '10'), [null, null]);
  assert.deepEqual(lengths('5€', '7$'), [null, null]);
});

test('compare bars: only k, M, B, bn and % are magnitudes; a lone m or b is a unit, not million or billion', () => {
  assert.deepEqual(lengths('5 m', '1 M'), [null, null], '5 m (metres) and 1M (million) are on different scales');
  const [l, r] = lengths('2 km', '8 km');
  assert.ok(Math.abs(l / r - 0.25) < 0.01, 'km is a unit, not a thousand m');
  const [bl, br] = lengths('2B', '500M');
  assert.ok(Math.abs(bl / br - 4) < 0.1, '2B against 500M share one scale');
});

test('compare bars: negatives and zero draw no bars whatever the suffix', () => {
  assert.deepEqual(lengths('-5x', '10x'), [null, null]);
  assert.deepEqual(lengths('0 min', '10 min'), [null, null]);
});

test('number: a non-integer value with no decimals keeps its own decimal places', () => {
  const finalText = (value) => textNode(expandShot({ id: 'n', show: 'number', hold: 2, value, label: 'rate' }).nodes, 'n.value.digits').props.steps.at(-1).text;
  assert.equal(finalText(0.4), '0.4');
  assert.equal(finalText(4.2), '4.2');
  assert.equal(finalText(1204.5), '1,204.5');
  assert.equal(finalText(459), '459');
  assert.equal(finalText(0.1 + 0.2), '0.300', 'capped at the kind\'s three decimals');
});

test('number: an explicit decimals still wins over the value\'s own', () => {
  const { nodes } = expandShot({ id: 'n', show: 'number', hold: 2, value: 4.2, decimals: 0, label: 'rate' });
  assert.equal(textNode(nodes, 'n.value.digits').props.steps.at(-1).text, '4');
});
