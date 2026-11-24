// Picture comparison for the feasibility probe: which blocks two real-time runs agree on, how alike a stepped picture is
// to a real-time one over those blocks, and what that means for a site. Pictures are { width, height, channels, data }.

const DEFAULT_BLOCK = 24;
const DEFAULT_TOLERANCE = 6;
const SSIM_C1 = 6.5025; // (0.01 * 255) squared
const SSIM_C2 = 58.5225; // (0.03 * 255) squared
const SSIM_PASS = 0.98;
const SHARE_MIN = 0.5;
// BT.601 luma in integers that add to 256, so a grey pixel keeps its own value exactly.
const LUMA_R = 77;
const LUMA_G = 150;
const LUMA_B = 29;
const LUMA_SHIFT = 8;
const WALL_PATTERN = /verify you are human|access denied|captcha|just a moment|enable javascript|are you (a )?(human|robot)|unusual traffic/i;

function lumaOf({ width, height, channels, data }) {
  const out = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < out.length; i += 1, p += channels) {
    out[i] = (LUMA_R * data[p] + LUMA_G * data[p + 1] + LUMA_B * data[p + 2]) >> LUMA_SHIFT;
  }
  return out;
}

function sameSizeLuma(a, b) {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`pictures differ in size: ${a.width}x${a.height} and ${b.width}x${b.height}`);
  }
  return [lumaOf(a), lumaOf(b)];
}

/** Calls `visit(bx, by, x0, y0, x1, y1)` for each block of a width by height picture, row by row. */
function eachBlock(width, height, block, visit) {
  const cols = Math.ceil(width / block);
  const rows = Math.ceil(height / block);
  for (let by = 0; by < rows; by += 1) {
    for (let bx = 0; bx < cols; bx += 1) {
      visit(by * cols + bx, bx * block, by * block, Math.min(width, (bx + 1) * block), Math.min(height, (by + 1) * block));
    }
  }
  return cols * rows;
}

/** A block is stable (1) when its largest luma difference is at most `tolerance`; `share` is the stable share of all blocks. */
export function stableMask(a, b, { block = DEFAULT_BLOCK, tolerance = DEFAULT_TOLERANCE } = {}) {
  const [la, lb] = sameSizeLuma(a, b);
  const width = a.width;
  const total = Math.ceil(a.width / block) * Math.ceil(a.height / block);
  const mask = new Uint8Array(total);
  eachBlock(width, a.height, block, (index, x0, y0, x1, y1) => {
    let worst = 0;
    for (let y = y0; y < y1 && worst <= tolerance; y += 1) {
      for (let x = x0; x < x1; x += 1) worst = Math.max(worst, Math.abs(la[y * width + x] - lb[y * width + x]));
    }
    mask[index] = worst <= tolerance ? 1 : 0;
  });
  return { mask, share: mask.reduce((sum, v) => sum + v, 0) / total };
}

function blockSsim(la, lb, width, [x0, y0, x1, y1]) {
  const n = (x1 - x0) * (y1 - y0);
  let sa = 0;
  let sb = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) { sa += la[y * width + x]; sb += lb[y * width + x]; }
  }
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

/** Mean block SSIM on luma over the blocks the mask marks stable; 0 when the mask leaves no block. */
export function maskedSsim(a, b, mask, { block = DEFAULT_BLOCK } = {}) {
  const [la, lb] = sameSizeLuma(a, b);
  let sum = 0;
  let used = 0;
  eachBlock(a.width, a.height, block, (index, x0, y0, x1, y1) => {
    if (!mask[index]) return;
    sum += blockSsim(la, lb, a.width, [x0, y0, x1, y1]);
    used += 1;
  });
  return used === 0 ? 0 : sum / used;
}

/** The reason a page is a wall, or null: an error status, or a title or heading that reads like a bot check. */
export function wallReason({ status, title = '', headings = [] }) {
  if (status >= 400) return `status ${status}`;
  const text = [title, ...headings].find((t) => WALL_PATTERN.test(t));
  return text === undefined ? null : `reads like a bot check or wall: "${text.slice(0, 80)}"`;
}

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(3) : String(n));

/** What the numbers of one site say. A wall and hard mismatches are not-steppable; too little agreement is inconclusive. */
export function verdict({ ssims, shares, controlsEqual, newErrors, wall }) {
  if (wall) return { verdict: 'not-steppable', why: [`wall: ${typeof wall === 'string' ? wall : 'the site answered with a wall'}`] };
  const hard = [];
  if (controlsEqual === false) hard.push('the stepped run listed different controls than real time');
  if (newErrors > 0) hard.push(`the stepped run had ${newErrors} page error(s) that real time did not`);
  if (hard.length > 0) return { verdict: 'not-steppable', why: hard };
  if (ssims.length === 0 || shares.length === 0) return { verdict: 'inconclusive', why: ['no step was compared'] };
  const thin = shares.map((share, i) => [share, i]).filter(([share]) => !(share >= SHARE_MIN));
  if (thin.length > 0) {
    return { verdict: 'inconclusive', why: thin.map(([share, i]) => `step ${i}: only ${fmt(share)} of the page is stable between two real-time runs`) };
  }
  const low = ssims.map((ssim, i) => [ssim, i]).filter(([ssim]) => !(ssim >= SSIM_PASS));
  if (low.length > 0) return { verdict: 'not-steppable', why: low.map(([ssim, i]) => `step ${i}: SSIM ${fmt(ssim)} is under ${SSIM_PASS}`) };
  return { verdict: 'steppable', why: [`${ssims.length} step(s) matched real time at SSIM ${fmt(Math.min(...ssims))} or more`] };
}
