// What besides the picture says a stepped run differs from real time: the accessible tree of the whole body, the page's errors,
// and whether the page is a wall (a bot check, an error, a sign-in or consent page, an empty page; see wall.mjs). Pure functions on data.

const TEXT_LIMIT = 200;
const LEFT_OUT_MAX = 0.2;
const SKIPPED_KEYS = new Set(['role', 'name', 'text', 'children', 'ref', 'cursor', 'box']);

export { LEFT_OUT_MAX };

const clean = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT);

/** An ariaSnapshotJSON tree as an ordered list of lines: role, name, state flags, address and text, indented by depth. */
export function treeLines(nodes, depth = 0) {
  const lines = [];
  for (const node of nodes ?? []) {
    const flags = Object.keys(node).filter((k) => !SKIPPED_KEYS.has(k)).sort().map((k) => `[${k}=${node[k]}]`).join('');
    const name = node.name === undefined ? '' : ` "${clean(node.name)}"`;
    const text = node.text !== undefined && !node.children ? ` = ${clean(node.text)}` : '';
    lines.push(`${'  '.repeat(depth)}${node.role}${name}${flags}${text}`);
    lines.push(...treeLines(node.children, depth + 1));
  }
  return lines;
}

const countLines = (lines) => lines.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map());

/** Lines of the first run that every run has, in the first run's order, each as often as the run that has it least. */
function stableSequence(reals, counts) {
  const used = new Map();
  return reals[0].filter((line) => {
    const have = used.get(line) ?? 0;
    const keep = have < Math.min(...counts.map((c) => c.get(line) ?? 0));
    if (keep) used.set(line, have + 1);
    return keep;
  });
}

/**
 * The stepped tree against the real-time trees. Lines the real runs do not all share are left out (`leftOutShare` is the
 * worst run's share of them); the rest must be in the stepped tree, in order, and the stepped tree may hold no more
 * unknown lines than the real runs' own variation explains.
 */
export function diffTrees(stepped, reals) {
  const counts = reals.map(countLines);
  const mine = countLines(stepped);
  const sequence = stableSequence(reals, counts);
  const stable = countLines(sequence);
  const differences = [];
  for (const [line, n] of stable) {
    const short = n - (mine.get(line) ?? 0);
    if (short > 0) differences.push(`missing ${short}× ${line.trim()}`);
  }
  let extra = 0;
  for (const [line, n] of mine) {
    const over = n - Math.max(0, ...counts.map((c) => c.get(line) ?? 0));
    if (over > 0) { extra += over; differences.push(`extra ${over}× ${line.trim()}`); }
  }
  const leftOut = reals.map((r, i) => r.length - [...stable].reduce((sum, [line, n]) => sum + Math.min(n, counts[i].get(line) ?? 0), 0));
  const allowed = Math.max(...leftOut);
  const inOrder = stepped.filter((l) => stable.has(l));
  const reordered = differences.length === 0 && inOrder.join('\n') !== sequence.join('\n');
  if (reordered) differences.push('the stable lines are in a different order');
  const leftOutShare = Math.max(...reals.map((r, i) => (r.length === 0 ? 0 : leftOut[i] / r.length)));
  const explained = extra <= allowed && !differences.some((d) => d.startsWith('missing') || d === 'the stable lines are in a different order');
  return { leftOutShare, differences: explained ? [] : differences, variation: differences };
}

/** A page error without its ids and numbers, so the same error twice is one key. */
export function errorKey(kind, message) {
  return `${kind}: ${String(message).replace(/[0-9a-f]{8,}/gi, '#').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, TEXT_LIMIT)}`;
}

/** Error keys the stepped run has more often than any real run does: [{ key, stepped, real }]. */
export function newErrors(stepped, reals) {
  const found = [];
  for (const [key, n] of countLines(stepped)) {
    const real = Math.max(0, ...reals.map((r) => countLines(r).get(key) ?? 0));
    if (n > real) found.push({ key, stepped: n, real });
  }
  return found;
}

// The wall check lives in scripts/lib/wall.mjs (scout uses it); it is re-exported here so the probe and its tests are unchanged.
export { wallProbe, wallReason } from '../../scripts/lib/wall.mjs';
