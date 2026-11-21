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
