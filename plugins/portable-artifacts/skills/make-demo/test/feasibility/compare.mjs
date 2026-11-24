// Picture comparison for the feasibility probe and the verdict it gives a site. Pictures are { width, height, channels, data }.
//
// A block is stable when the real-time runs agree within `tolerance` on every channel of every pixel. A stable block of the
// stepped picture is wrong when more than `minPixels` of its pixels differ by more than `delta` on any channel from every real
// run. Two touching wrong blocks, or one that is mostly wrong, fail the site. SSIM is reported and never judged: a mean over
// every block hides a local change and cannot see colour or a flat shift.
import { LEFT_OUT_MAX } from './signals.mjs';

export { wallReason } from './signals.mjs';

export const BLOCK = 12;
export const TOLERANCE = 6;
export const WRONG_DELTA = 24;
export const WRONG_PIXELS = 8;
const SHARE_MIN = 0.5;
const SOLID_FRACTION = 0.5;
const SSIM_C1 = 6.5025; // (0.01 * 255) squared
const SSIM_C2 = 58.5225; // (0.03 * 255) squared
const LUMA_R = 77; // BT.601 in integers that add to 256, so a grey pixel keeps its own value
const LUMA_G = 150;
const LUMA_B = 29;
const LUMA_SHIFT = 8;
const RGB = 3;

function assertSameSize(pictures) {
  const [first] = pictures;
  for (const p of pictures) {
    if (p.width !== first.width || p.height !== first.height) throw new Error(`pictures differ in size: ${first.width}x${first.height} and ${p.width}x${p.height}`);
  }
}

/** Calls `visit(index, x0, y0, x1, y1)` for each block of a width by height picture, row by row. */
function eachBlock(width, height, block, visit) {
  const cols = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  for (let by = 0; by < rows; by += 1) {
    for (let bx = 0; bx < cols; bx += 1) {
      visit(by * cols + bx, bx * block, by * block, Math.min(width, (bx + 1) * block), Math.min(height, (by + 1) * block));
    }
  }
  return { cols, rows };
}

function blockIsStable(pictures, width, [x0, y0, x1, y1], tolerance) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      for (let c = 0; c < RGB; c += 1) {
        let lo = 255;
        let hi = 0;
        for (const p of pictures) {
          const v = p.data[(y * width + x) * p.channels + c];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (hi - lo > tolerance) return false;
      }
    }
  }
  return true;
}

/** The blocks (1) on which every real-time picture agrees within `tolerance` on every channel; `share` is their share of all blocks. */
export function stableMask(pictures, { block = BLOCK, tolerance = TOLERANCE } = {}) {
  assertSameSize(pictures);
  const { width, height } = pictures[0];
  const mask = new Uint8Array(Math.ceil(width / block) * Math.ceil(height / block));
  const { cols, rows } = eachBlock(width, height, block, (index, x0, y0, x1, y1) => {
    mask[index] = blockIsStable(pictures, width, [x0, y0, x1, y1], tolerance) ? 1 : 0;
  });
  return { mask, share: mask.reduce((sum, v) => sum + v, 0) / mask.length, cols, rows, block };
}

const channelGap = (a, b, ia, ib) => Math.max(Math.abs(a.data[ia] - b.data[ib]), Math.abs(a.data[ia + 1] - b.data[ib + 1]), Math.abs(a.data[ia + 2] - b.data[ib + 2]));

function wrongPixelCount(stepped, reals, width, [x0, y0, x1, y1], delta) {
  let wrong = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const at = (y * width + x);
      if (reals.every((r) => channelGap(stepped, r, at * stepped.channels, at * r.channels) > delta)) wrong += 1;
    }
  }
  return wrong;
}

/** Stable blocks of `stepped` that are wrong against every picture in `reals`: [{ index, box: { x, y, width, height }, pixels, area }]. */
export function wrongBlocks(stepped, reals, { mask, block = BLOCK }, { delta = WRONG_DELTA, minPixels = WRONG_PIXELS } = {}) {
  assertSameSize([stepped, ...reals]);
  const found = [];
  eachBlock(stepped.width, stepped.height, block, (index, x0, y0, x1, y1) => {
    if (!mask[index]) return;
    const pixels = wrongPixelCount(stepped, reals, stepped.width, [x0, y0, x1, y1], delta);
    if (pixels > minPixels) found.push({ index, box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, pixels, area: (x1 - x0) * (y1 - y0) });
  });
  return found;
}

/** Wrong blocks joined where they touch, corners too: [{ blocks, box }]. */
export function groupBlocks(blocks, cols) {
  const byIndex = new Map(blocks.map((b) => [b.index, b]));
  const seen = new Set();
  const groups = [];
  for (const start of blocks) {
    if (seen.has(start.index)) continue;
    const members = [];
    const queue = [start.index];
    seen.add(start.index);
    while (queue.length > 0) {
      const index = queue.pop();
      members.push(byIndex.get(index));
      for (const dy of [-1, 0, 1]) {
        for (const dx of [-1, 0, 1]) {
          const x = (index % cols) + dx;
          const next = index + dy * cols + dx;
          if ((dx === 0 && dy === 0) || x < 0 || x >= cols || !byIndex.has(next) || seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
    }
    groups.push({ blocks: members, box: boundingBox(members.map((m) => m.box)) });
  }
  return groups;
}

function boundingBox(boxes) {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The groups that fail a site: two or more touching wrong blocks, or one block that is mostly wrong. */
export function failingGroups(blocks, cols) {
  return groupBlocks(blocks, cols).filter((g) => g.blocks.length >= 2 || g.blocks.some((b) => b.pixels >= b.area * SOLID_FRACTION));
}

const lumaOf = ({ width, height, channels, data }) => {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += channels) out[i] = (LUMA_R * data[p] + LUMA_G * data[p + 1] + LUMA_B * data[p + 2]) >> LUMA_SHIFT;
  return out;
};

function blockSsim(la, lb, width, [x0, y0, x1, y1]) {
  const n = (x1 - x0) * (y1 - y0);
  let sa = 0;
  let sb = 0;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) { sa += la[y * width + x]; sb += lb[y * width + x]; }
  const ma = sa / n;
  const mb = sb / n;
  let va = 0;
  let vb = 0;
  let cov = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const da = la[y * width + x] - ma;
      const db = lb[y * width + x] - mb;
      va += da * da; vb += db * db; cov += da * db;
    }
  }
  va /= n; vb /= n; cov /= n;
  return ((2 * ma * mb + SSIM_C1) * (2 * cov + SSIM_C2)) / ((ma * ma + mb * mb + SSIM_C1) * (va + vb + SSIM_C2));
}

/** Mean block SSIM on luma over the stable blocks: a figure for the report, never a verdict. 0 when the mask leaves no block. */
export function maskedSsim(a, b, mask, { block = BLOCK } = {}) {
  assertSameSize([a, b]);
  const [la, lb] = [lumaOf(a), lumaOf(b)];
  let sum = 0;
  let used = 0;
  eachBlock(a.width, a.height, block, (index, x0, y0, x1, y1) => {
    if (!mask[index]) return;
    sum += blockSsim(la, lb, a.width, [x0, y0, x1, y1]);
    used += 1;
  });
  return used === 0 ? 0 : sum / used;
}

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : String(n));
const boxText = ({ x, y, width, height }) => `${width}x${height} at (${x}, ${y})`;

/** Hard evidence against stepping: a wall, wrong picture groups, tree differences, new page errors. Each is a line of `why`. */
function hardReasons({ wall, steps, newErrors }) {
  const why = [];
  if (wall) why.push(`wall: ${typeof wall === 'string' ? wall : 'the site answered with a wall'}`);
  for (const [i, step] of steps.entries()) {
    for (const group of step.wrongGroups ?? []) why.push(`step ${i}: the stepped picture is wrong in ${group.blocks.length} block(s), ${boxText(group.box)}`);
    for (const line of step.treeDifferences ?? []) why.push(`step ${i}: accessible tree: ${line}`);
  }
  for (const e of newErrors ?? []) why.push(`the stepped run had ${e.stepped} of "${e.key}" where real time had at most ${e.real}`);
  return why;
}

/** Reasons the numbers cannot be trusted either way: too little agreement, a run that never settled, a different address. */
function doubts({ steps, capped, finalUrlsEqual }) {
  const why = [];
  if (steps.length === 0) why.push('no step was compared');
  for (const [i, step] of steps.entries()) {
    if (!(step.share >= SHARE_MIN)) why.push(`step ${i}: only ${fmt(step.share)} of the page is stable between three real-time runs`);
    if (step.treeLeftOut > LEFT_OUT_MAX) why.push(`step ${i}: ${fmt(step.treeLeftOut)} of the accessible tree differs among the real-time runs`);
  }
  if (capped.runs.length > 0 && !capped.loops) why.push(`no settled picture: ${capped.runs.map((c) => `${c.run} step ${c.step} (${c.reason})`).join(', ')}`);
  if (finalUrlsEqual === false) why.push('the runs ended on different addresses');
  return why;
}

/**
 * What the numbers of one site say. `steps` is [{ share, wrongGroups, treeDifferences, treeLeftOut }], `capped` lists the
 * runs and steps that never settled, `{ runs, loops }` (`loops: true` when all four did, with nothing pending and equal trees).
 */
export function verdict({ steps, newErrors = [], wall = null, capped = { runs: [], loops: false }, finalUrlsEqual = true }) {
  const hard = hardReasons({ wall, steps, newErrors });
  if (hard.length > 0) return { verdict: 'not-steppable', why: hard };
  const unsure = doubts({ steps, capped, finalUrlsEqual });
  if (unsure.length > 0) return { verdict: 'inconclusive', why: unsure };
  const note = capped.loops ? ' (the page loops: compared as it stood at the cap)' : '';
  return { verdict: 'steppable', why: [`${steps.length} step(s) matched real time${note}`] };
}
