// Frame review: the checks that need no eyes, run on one frame's __snapshot output (a sampled tree with canvas-pixel
// bounding boxes and, on text nodes, the layout with its sizes in pixels). auditFrame returns findings, each
// { kind: 'mechanical' | 'creative', path, message, rule, node, role }: mechanical ones are defects (text off the safe
// area, text too small, text on text, text that cannot be measured), creative ones are judgment calls for the author.
// `rule` and `node` let the film review keep one finding per (shot, rule, node). Pure and DOM-free; sizes are units
// (engine/units.mjs). It never throws: a text with no lines or no words is skipped, and one whose box has a number that
// is not finite is left out of every rule and reported once as "<node id>: could not be measured".
//
// Boxes. The safe-area and overlap checks use the measured ink of a text, not its snapshot bbox (the font's whole
// ascent-to-descent box). Where the snapshot has the page's measurement of each line (`lineInk`, from the canvas'
// actualBoundingBox) the ink runs from the highest glyph to the lowest of every line, accents and descenders included.
// Without it: from the cap line (CAP_HEIGHT) to the baseline of every line, plus WORD_DESCENT below a line with a descender
// glyph and up to the font's ascent over a line with an accented capital. A label set a designed distance under a
// figure, or a kicker over a headline, would otherwise overlap it. Across, each word runs from its measured ink start to
// its ink end (lineInk[k].words[j] = { left, right } from the word's origin) when the snapshot has them, else over its
// advance, so a line or a figure set flush left by its ink (a stack, a count) is judged by its ink, not by the side
// bearing before it.
//
// Stacks. A stack (props.stack: the id of the statement it belongs to) sets each line of one text at its own size; for the
// sizes and hero rules its lines are one size class (the largest), and the viral hook rule counts all of its words.
//
// Landed. A word at opacity 0 on a frame is not on screen on that frame (the number kind stacks every step of its
// count as a word and shows one at a time; a word may also leave before its shot ends); every word shown on a frame is
// judged on it. A text has landed on a frame when every word on screen is at opacity 1 and at its rest scale (not
// mid-pulse), the text itself (with the groups it sits in) is at opacity 1 (a text still fading in is still arriving)
// and it is settled: at the scale it rests at in its shot (not mid-spring, mid-pulse or mid-push). Size, safe-area and
// overlap checks apply to a landed text, using only its words on screen. A text that lands on no sampled frame of its
// shot is reported by the film review (scripts/v2/review.mjs settleFindings).
//
// Roles. A text node's props.role (set by the kinds: hero, affix, label, kicker, caption, tag, body; none means body)
// says what the text is for. An `affix` (prefix, suffix, unit) and a `tag` are small by design: the scale-contrast rule
// leaves them out, and the distinct-sizes rule leaves out affixes. Frame furniture (props.furniture: the texts of a slug
// card or a caption card) is left out of both.
//
// Spoken captions. A text with props.caption (engine/captions: { zone, end, hero, emphasis, marks }) is a caption of the
// spoken words, and five rules judge it: once landed, its ink outside its zone (caption-zone); over any picture
// on screen, the hero's among them, or a hero that is a path (caption-hero; a picture, and only a picture, standing at 1.2
// times its size or more, as a camera push leaves it, or covering 80% of the canvas or more, is the frame's ground and is
// not judged); over a region its shot marks (`marks`: highlight, circle, underline, bracket, focus), by the mark's drawn
// paths while on screen, ground or not, or over a text that has not landed (caption-covers, creative: the caption styles
// keep off every mark they can, so what is left names the shot and what the author can change); on screen more than 0.3 s
// after its last word ends at film second `end` (caption-late, against ctx.t); and, on any frame, an emphasised word
// clipped by its zone (caption-clipped, a pulse included). All but caption-covers are mechanical. A clipping's own caption
// carries no props.caption and is judged by the general rules; the card-overlap and overlap rules keep the two apart (a
// spoken caption over a pinned card is creative too).
//
// What escapes. The audit looks at sampled frames (scripts/v2/review.mjs), and an unlanded text is not judged, so a defect
// that is on screen for less than the sampling step (0.25 s: 7 frames at 30 fps) and falls between two samples can
// escape, and so can one that exists only while a text is still arriving, pulsing or being pushed by the camera when
// the same text lands on another sampled frame.
import { unitOf } from '../units.mjs';
import { CAP_HEIGHT, WORD_DESCENT, unionBox as union } from '../kinds/shared.mjs';
import { contrastFindings } from './contrast.mjs';
import { minSizeSuggest } from './suggest.mjs';
import { markBoxes, showsItself } from './marks.mjs';
import { regionFindings } from './regions.mjs';
import { droppedMessage } from './dropped.mjs';
import { registries } from '../registry.mjs';
import { GROUND_ID } from '../looks/grounds.mjs';
import { DEFAULT_FILL, isFillShare } from '../looks/fill.mjs';
import '../modes/index.mjs';

export const MIN_TEXT_UNITS = 28;
export const MAX_TEXT_SIZES = 3;
export const MIN_HERO_RATIO = 3;
export const OVERLAP_UNITS = 4;
export const WORD_OVERLAP_UNITS = 1; // neighbouring words of a line may not meet by more than this
// Two sizes within this ratio of each other (a camera drift scales every text a little) count as one size.
const SAME_SIZE_RATIO = 1.1;
// A text stands settled within 0.2% of its resting scale. A camera punch (8% in pop) takes a frame or two to come home,
// and at 1% it still carries a line set flush on the safe edge several pixels past it: that is a move, not a layout.
const SETTLE_TOLERANCE = 0.002;
// Text may reach this far past the safe area (units) before it is outside: a line set flush on the edge by its measured
// ink stays within it through the last 0.2% of a punch.
export const SAFE_TOLERANCE_UNITS = 1;
// The safe-area rule also allows this share of the text's size (em) for the ink a canvas reports a little wide. Linux's
// canvas gives a large word's ink as a pixel-rounded outset of the real glyph bounds, and macOS gives them tight. CI run
// 44475322956 (Archivo 900 extra-condensed at 280 px) against macOS: the right edge of "TOTAL" 3.37 units wider, its left
// edge 4.23, "l" 2.04, ascent 2.63; under 120 px the outsets were under 1 unit. 0.015 em is the largest measured, 4.23 of 280.
export const INK_OUTSET_EM = 0.015;
const EPSILON = 1e-6;
const MECHANICAL = 'mechanical';
const CREATIVE = 'creative';
const HALF = 2;
const MIN_SIZES_TO_COMPARE = 2; // a hero needs another size to be compared with
const NO_WORDS = new Set();
// A glyph that reaches below the baseline (Latin g j p q y, cedillas, Cyrillic у р д ц щ, punctuation); a line without
// one (figures, capitals) ends at the baseline.
const DESCENDER_RE = /[gjpqyQ,;()[\]{}|@Ççурдцщ]/;
// An accented capital or a combining mark: the glyph rises above the cap line.
const ACCENT_RE = /[À-ÞĀ-ſ̀-ͯ]/;
const WORD_IDENTITY = Object.freeze({ opacity: 1, x: 0, y: 0, scale: 1 });

// The accumulated scale of a node: its own scale (the camera's zoom is folded into the top-level nodes) times its
// non-uniform scale, which counts as the geometric mean of the two axes.
export const scaleOf = (n) => (n.scale ?? 1) * Math.sqrt((n.scaleX ?? 1) * (n.scaleY ?? 1));
const roleOf = (n) => n.props?.role ?? 'body';
const wordsOf = (layout) => layout.lines.flatMap((line) => line.words);
export const isBox = (box) => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite);
export const hasWords = (layout) => Array.isArray(layout?.lines) && layout.lines.some((line) => Array.isArray(line.words) && line.words.length > 0);

// How far a line's glyphs reach above and below its baseline, in the text's own pixels: measured when the snapshot has it
// for this line, else from the cap line and the line's descender and accent glyphs.
function lineReach(n, line, k, metrics) {
  const measured = n.lineInk?.[k];
  const across = Array.isArray(measured?.words) ? measured.words : [];
  if (measured && Number.isFinite(measured.ascent) && Number.isFinite(measured.descent)) return { up: measured.ascent, down: measured.descent, across };
  const text = line.words.map((word) => word.text).join(' ');
  return {
    up: ACCENT_RE.test(text) ? metrics.ascent : CAP_HEIGHT * n.layout.size,
    down: DESCENDER_RE.test(text) ? WORD_DESCENT * n.layout.size : 0,
    across,
  };
}

// One word in the text node's own space as engine/page/bounds.mjs puts it (scaled about its centre on the baseline):
// `whole` is the font's ascent-to-descent box, `ink` the glyphs' reach.
function wordBoxes(n, line, k, word, metrics) {
  const t = { ...WORD_IDENTITY, ...n.words?.[word.index] };
  const scale = Math.abs(t.scale), half = (word.width / HALF) * scale;
  const left = line.x + word.x + word.width / HALF + t.x - half;
  const reach = lineReach(n, line, k, metrics);
  // a word's ink may start after its origin and end before (or past) its advance: measured, when known
  const own = reach.across[line.words.indexOf(word)];
  const measuredAcross = Number.isFinite(own?.left) && Number.isFinite(own?.right);
  const inkLeft = measuredAcross ? left + own.left * scale : left;
  const inkRight = measuredAcross ? left + own.right * scale : left + HALF * half;
  return {
    whole: [left, line.y + t.y - metrics.ascent * scale, HALF * half, (metrics.ascent + metrics.descent) * scale],
    ink: [inkLeft, line.y + t.y - reach.up * scale, Math.max(0, inkRight - inkLeft), (reach.up + reach.down) * scale],
  };
}

const QUARTER = 90; // degrees
// A local box as it lies after the text's own quarter turn (n.rotate a non-zero multiple of 90, as poster's turned stack
// sets it), so a turned line's ink along the line is judged along the frame's height and its ink across the line along
// the frame's width (gate-poster-tall render 1: the stretch below read a glyph's overhang past the advance, along the
// line, as across it). Any other rotation keeps the box as it is: the stretch onto the bbox is close enough there.
function turnedLocal(n) {
  const turn = n.rotate ?? 0;
  if (turn === 0 || turn % QUARTER !== 0) return (box) => box;
  const angle = (turn * Math.PI) / (HALF * QUARTER);
  const cos = Math.round(Math.cos(angle)), sin = Math.round(Math.sin(angle));
  return ([x, y, w, h]) => {
    const xs = [x, x + w].flatMap((px) => [y, y + h].map((py) => cos * px - sin * py));
    const ys = [x, x + w].flatMap((px) => [y, y + h].map((py) => sin * px + cos * py));
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  };
}

// Each word's whole and ink boxes in the text's own space, after its own quarter turn (turnedLocal).
function localWordBoxes(n) {
  const { layout } = n;
  const metrics = { ascent: layout.lines[0].y, descent: layout.height - layout.lines.at(-1).y };
  const turned = turnedLocal(n);
  return layout.lines.flatMap((line, k) => line.words.map((word) => {
    const { whole, ink } = wordBoxes(n, line, k, word, metrics);
    return { word, whole: turned(whole), ink: turned(ink) };
  }));
}

// The ink box of a text in canvas pixels, from the words that are not hidden (all of them when none is shown): the local
// ink box mapped to the canvas by the same stretch that takes the whole ascent box to the snapshot bbox.
function inkBox(n, hidden) {
  const { bbox } = n;
  const boxes = localWordBoxes(n);
  const whole = union(boxes.map((b) => b.whole));
  const kept = boxes.filter((b) => !hidden.has(b.word.index));
  const part = union((kept.length > 0 ? kept : boxes).map((b) => b.ink));
  const sx = whole[2] > 0 ? bbox[2] / whole[2] : 1, sy = whole[3] > 0 ? bbox[3] / whole[3] : 1;
  return [bbox[0] + (part[0] - whole[0]) * sx, bbox[1] + (part[1] - whole[1]) * sy, part[2] * sx, part[3] * sy];
}

// The ink of each word of a text on screen, in canvas pixels, as { word, box }: each word's local ink mapped to the
// canvas as inkBox maps the whole text (a word scaled by its track is boxed at that scale).
function wordInks(n) {
  const { bbox } = n;
  const boxes = localWordBoxes(n);
  const whole = union(boxes.map((b) => b.whole));
  const sx = whole[2] > 0 ? bbox[2] / whole[2] : 1, sy = whole[3] > 0 ? bbox[3] / whole[3] : 1;
  return boxes.map((b) => ({ word: b.word, box: [bbox[0] + (b.ink[0] - whole[0]) * sx, bbox[1] + (b.ink[1] - whole[1]) * sy, b.ink[2] * sx, b.ink[3] * sy] }));
}

// The words of a text at opacity 0 on this frame: not on screen, so neither in its ink nor waited for. A word shown on
// any other frame is judged there. (A text with every word at 0 is not on screen at all: visibleTexts skips it.)
function hiddenNow(n) {
  const hidden = (Array.isArray(n.words) ? n.words : []).flatMap((w, i) => ((w?.opacity ?? 1) <= 0 ? [i] : []));
  return hidden.length === 0 ? NO_WORDS : new Set(hidden);
}

export const hasVisibleWord = (n) => !Array.isArray(n.words) || n.words.length === 0 || n.words.some((w) => w.opacity > 0);

/** text node id -> { scale, opacity, node } in a sampled tree: its accumulated scale (its own, its groups' and the
 *  camera's), how big it stands, and its accumulated opacity, how much of it shows. */
export function textStatesIn(sampled) {
  const states = new Map();
  const walk = (n, scale, opacity) => {
    const s = scale * scaleOf(n), o = opacity * (n.opacity ?? 1);
    if (n.type === 'text') states.set(n.id, { scale: s, opacity: o, node: n });
    (n.children ?? []).forEach((child) => walk(child, s, o));
  };
  (sampled ?? []).forEach((n) => walk(n, 1, 1));
  return states;
}

/** text node id -> its accumulated scale (its own, its groups' and the camera's) in a sampled tree: how big it stands. */
export const textScalesIn = (sampled) => new Map([...textStatesIn(sampled)].map(([id, state]) => [id, state.scale]));

// A word has arrived when it is at opacity 1, and is at rest when it is also at its resting scale (an emphasis pulse
// scales a word up and back): `rest`, the scale it holds on most of its shot's frames (ctx.restWords), else 1.
const isWordAtRest = (word, rest = 1) => (word?.opacity ?? 1) >= 1 && Math.abs((word?.scale ?? 1) / rest - 1) <= SETTLE_TOLERANCE;

// A text is settled when it stands within SETTLE_TOLERANCE of the scale it has on its shot's last frame: an entrance
// spring, an emphasis pulse or a camera push passes through other scales on its way and is not judged on them.
const isSettled = (id, scale, resting) => !resting?.has(id) || Math.abs(scale / resting.get(id) - 1) <= SETTLE_TOLERANCE;

// One visible text as the rules see it, or null when its box cannot be measured.
export function measured(n, o, s, unit, ctx) {
  const hidden = hiddenNow(n);
  const rests = ctx.restWords?.get(n.id);
  const wordsIn = !Array.isArray(n.words) || wordsOf(n.layout).every((w) => hidden.has(w.index) || isWordAtRest(n.words[w.index], rests?.[w.index]));
  const landed = wordsIn && o >= 1 && isSettled(n.id, s, ctx.restScales);
  try {
    const size = (n.layout.size * s) / unit, ink = inkBox(n, hidden);
    // the smallest a word on screen stands: a word resting at its own smaller scale reads at that size (the size floor)
    const smallest = size * Math.min(1, ...wordsOf(n.layout).filter((w) => !hidden.has(w.index)).map((w) => Math.abs(n.words?.[w.index]?.scale ?? 1)));
    return Number.isFinite(size) && isBox(ink) && isBox(n.bbox) ? { node: n, size, smallest, role: roleOf(n), ink, landed, opacity: o } : null;
  } catch {
    return null;
  }
}

// { texts, unmeasured }: every visible text in the tree, and the ids of those whose box has no usable number. A text
// inside a group inherits the group's opacity and scale; one with no lines or no words is not a text to judge.
function visibleTexts(sampled, unit, ctx) {
  const texts = [], unmeasured = [];
  // ancestors: the ids of the groups a text sits in (the card-overlap rule keeps a card's own texts out of it)
  const walk = (n, opacity, scale, ancestors) => {
    const o = opacity * (n.opacity ?? 1), s = scale * scaleOf(n);
    if (n.type === 'text' && hasWords(n.layout) && o > 0 && hasVisibleWord(n)) {
      const found = measured(n, o, s, unit, ctx);
      if (found) texts.push({ ...found, ancestors });
      else unmeasured.push(n.id);
    }
    for (const child of n.children ?? []) walk(child, o, s, [...ancestors, n.id]);
  };
  (Array.isArray(sampled) ? sampled : []).forEach((n) => walk(n, 1, 1, []));
  return { texts, unmeasured };
}

/**
 * Every text on screen in the frame that can be measured, as { id, landed, role }: whether it is at rest on this frame
 * (see Landed above). The film review counts, per shot, the texts that are at rest on no sampled frame.
 * @param {object[]} sampled @param {object} ctx as for auditFrame
 */
export function textLandings(sampled, ctx) {
  return visibleTexts(sampled, unitOf(ctx.canvas), ctx).texts.map((t) => ({ id: t.node.id, landed: t.landed, role: t.role }));
}

/** Every landed text on screen as { id, ink, role }: what the overlay review sets against the logo's box (overlay.mjs). */
export const landedTexts = (sampled, ctx) => visibleTexts(sampled, unitOf(ctx.canvas), ctx).texts.filter((t) => t.landed).map((t) => ({ id: t.node.id, ink: t.ink, role: t.role }));

const pathOf = (ctx) => `shots[${ctx.shotIndex ?? ctx.shotId}]`;
const finding = (ctx, kind, rule, node, message, role, suggest) => ({ kind, path: pathOf(ctx), message, rule, node, ...(role ? { role } : {}), ...(suggest ? { suggest } : {}) });
const units = (n) => Number(n.toFixed(1));

export function outsideSafe([x, y, w, h], safe, slack) {
  return x < safe.left - slack || y < safe.top - slack || x + w > safe.right + slack || y + h > safe.bottom + slack;
}

// The widest word of a text, as { text, units }: what keeps it from fitting when it will not shrink any further.
function widestWord(node, size) {
  const words = wordsOf(node.layout);
  const widest = words.reduce((best, w) => (w.width > best.width ? w : best), words[0]);
  return { text: widest.text, units: (widest.width * size) / node.layout.size };
}

function overflowMessage(node, size) {
  const widest = widestWord(node, size);
  return `text "${node.id}" does not fit even at the smallest size its kind allows, ${Math.round(size)} units; its widest word is "${widest.text}" (${Math.round(widest.units)} units wide); shorten that word or cut words`;
}

function textRules(texts, ctx) {
  return texts.flatMap(({ node, size, smallest, role, ink, landed }) => {
    const out = [];
    const id = node.id;
    if (node.layout.overflow) out.push(finding(ctx, CREATIVE, 'overflow', id, overflowMessage(node, size), role));
    if (landed && smallest < MIN_TEXT_UNITS - EPSILON) out.push(finding(ctx, MECHANICAL, 'min-size', id, `text "${id}" is ${units(smallest)} units tall; the floor is ${MIN_TEXT_UNITS}`, role, minSizeSuggest(MIN_TEXT_UNITS, smallest)));
    if (landed && outsideSafe(ink, ctx.safe, (SAFE_TOLERANCE_UNITS + INK_OUTSET_EM * size) * unitOf(ctx.canvas))) out.push(finding(ctx, MECHANICAL, 'safe-area', id, `text "${id}" is outside the safe area; move it in or cut words`, role));
    return out;
  });
}

function overlapRules(texts, ctx, unit) {
  const limit = OVERLAP_UNITS * unit + EPSILON;
  const landed = texts.filter((t) => t.landed);
  const out = [];
  landed.forEach((a, i) => landed.slice(i + 1).forEach((b) => {
    const [ax, ay, aw, ah] = a.ink, [bx, by, bw, bh] = b.ink;
    const across = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);
    const down = Math.min(ay + ah, by + bh) - Math.max(ay, by);
    if (across <= limit || down <= limit) return;
    const ids = [a.node.id, b.node.id].sort();
    out.push(finding(ctx, MECHANICAL, 'overlap', ids.join('|'), `texts "${ids[0]}" and "${ids[1]}" overlap by ${units(Math.min(across, down) / unit)} units`));
  }));
  return out;
}

// The words of each line that are on screen, left to right, as { text, left, right } in the text's own pixels, each
// scaled about its own centre by its track (a pulse) and moved by it.
function lineSpans(n) {
  return n.layout.lines.map((line) => line.words
    .filter((word) => (n.words?.[word.index]?.opacity ?? 1) > 0)
    .map((word) => {
      const t = { ...WORD_IDENTITY, ...n.words?.[word.index] };
      const half = (word.width * Math.abs(t.scale)) / HALF, centre = line.x + word.x + word.width / HALF + t.x;
      return { text: word.text, left: centre - half, right: centre + half };
    })
    .sort((a, b) => a.left - b.left));
}

// No frame may have a word overlapping its neighbour on the line (an emphasis pulse that grows a word into the next).
function wordOverlapRules(texts, ctx, unit) {
  // A count (props.steps: the number kind's digits) sets each figure as a word laid out by ink, so its words meet by design.
  return texts.filter(({ node }) => node.props?.steps === undefined).flatMap(({ node, size }) => {
    const perUnit = size / node.layout.size / unit; // the text's own pixels in units
    const found = lineSpans(node).flatMap((spans) => spans.slice(1).flatMap((span, k) => {
      const by = (spans[k].right - span.left) * perUnit;
      return by > WORD_OVERLAP_UNITS ? [{ a: spans[k].text, b: span.text, by }] : [];
    }));
    if (found.length === 0) return [];
    const [first] = found;
    return [finding(ctx, MECHANICAL, 'word-overlap', node.id, `in text "${node.id}" the word "${first.a}" overlaps "${first.b}" by ${units(first.by)} units; an emphasis pulse is growing it into its neighbour`)];
  });
}

// Sizes in ascending order grouped into runs where each is within SAME_SIZE_RATIO of the one below it.
function sizeClusters(texts) {
  const sizes = texts.map((t) => t.size).sort((a, b) => a - b);
  return sizes.reduce((groups, size) => {
    const last = groups.at(-1);
    if (last && size / last.at(-1) <= SAME_SIZE_RATIO) return [...groups.slice(0, -1), [...last, size]];
    return [...groups, [size]];
  }, []);
}

// The texts as size classes: the lines of one stack count once, at the size of its largest line.
function sizeClasses(texts) {
  const stacks = new Map();
  const loose = [];
  for (const t of texts) {
    const stack = t.node.props?.stack;
    if (stack === undefined) loose.push(t);
    else if (!stacks.has(stack) || stacks.get(stack).size < t.size) stacks.set(stack, t);
  }
  return [...loose, ...stacks.values()];
}

// Frame furniture: a text inside a slug card or a caption card (props.furniture, set by the kind). It repeats from shot to
// shot like a page's running head, so the sizes and hero rules leave it out; every other rule still judges it.
const isFurniture = (t) => t.node.props?.furniture === true;

function hierarchyRules(all, ctx) {
  const out = [];
  const texts = sizeClasses(all).filter((t) => !isFurniture(t));
  const sized = sizeClusters(texts.filter((t) => t.role !== 'affix'));
  if (sized.length > MAX_TEXT_SIZES) {
    const sizes = sized.map((c) => Math.round(c[0])).join(', ');
    out.push(finding(ctx, CREATIVE, 'sizes', '', `${sized.length} distinct text sizes are on screen (${sizes} units); use at most ${MAX_TEXT_SIZES}; drop an optional part such as a label or a delta`));
  }
  const contrast = sizeClusters(texts.filter((t) => t.role !== 'affix' && t.role !== 'tag'));
  if (contrast.length >= MIN_SIZES_TO_COMPARE) {
    const ratio = contrast.at(-1).at(-1) / contrast[0][0];
    if (ratio < MIN_HERO_RATIO - EPSILON) out.push(finding(ctx, CREATIVE, 'hero', '', `the hero text is only ${ratio.toFixed(1)} times the smallest; make it at least ${MIN_HERO_RATIO} times larger`));
  }
  // a kind that left out a secondary line to keep its secondary text at the look's floor says so (kinds/secondary.mjs)
  for (const { node } of all.filter((t) => Array.isArray(t.node.props?.dropped) && t.node.props.dropped.length > 0)) {
    out.push(finding(ctx, CREATIVE, 'dropped', node.id, droppedMessage(node, MIN_HERO_RATIO, ctx.aimed)));
  }
  return out;
}

// The words of a line a viewer can see: a word at opacity 0 is not there.
const shownWords = (node, words) => words.filter((word) => (node.words?.[word.index]?.opacity ?? 1) > 0);

// A highlight is a pointer: one run of emphasised words laid out over more than one line (props.highlightLines, set by
// the statement kind in a highlight look) is a creative finding.
function highlightRules(texts, ctx) {
  return texts.filter(({ node }) => node.props?.highlightLines > 1).map(({ node, role }) => finding(ctx, CREATIVE, 'highlight-lines', node.id,
    `one highlight runs across ${node.props.highlightLines} lines; mark fewer words`, role));
}

// The papers on screen of cards that hold text (props.textCard: a slug, a caption card): { card, box } where card is the
// id of the group the paper sits in.
function textCards(sampled) {
  const cards = [];
  const walk = (n, opacity, parent) => {
    const o = opacity * (n.opacity ?? 1);
    if (o <= 0) return;
    // a paper may name its card (props.card: a card whose paper is scaled in a group of its own, quote-desk growingCard)
    if (n.props?.textCard === true && parent && isBox(n.bbox)) cards.push({ card: n.props.card ?? parent, box: n.bbox });
    (n.children ?? []).forEach((child) => walk(child, o, n.id));
  };
  (Array.isArray(sampled) ? sampled : []).forEach((n) => walk(n, 1, null));
  return cards;
}

// A landed text over the paper of a card that holds text, other than its own card, by more than OVERLAP_UNITS both ways:
// mechanical (a statement left under its slug). A spoken caption over one is creative and names the shot: the caption
// styles keep off every pinned card they can (branch review A, I3), so what is left is the author's to change.
function cardRules(texts, cards, ctx, unit) {
  const limit = OVERLAP_UNITS * unit + EPSILON;
  return texts.filter((t) => t.landed).flatMap((t) => cards.filter(({ card }) => !t.ancestors.includes(card)).flatMap(({ card, box }) => {
    const across = Math.min(t.ink[0] + t.ink[2], box[0] + box[2]) - Math.max(t.ink[0], box[0]);
    const down = Math.min(t.ink[1] + t.ink[3], box[1] + box[3]) - Math.max(t.ink[1], box[1]);
    if (across <= limit || down <= limit) return [];
    if (isSpokenCaption(t)) return [finding(ctx, CREATIVE, 'card-overlap', `${t.node.id}|${card}`, `${inShot(t.node.id, ctx)} runs over the card "${card}", and its style found no place in its band clear of it; ${CAPTION_REMEDY}`, t.role)];
    return [finding(ctx, MECHANICAL, 'card-overlap', `${t.node.id}|${card}`, `text "${t.node.id}" runs over the card "${card}"; move it off the card or cut words`, t.role)];
  }));
}

// Where the pictures (image nodes: { id, order, box }) and texts (id -> order) on screen fall in the order they are
// drawn (a node before its children).
function drawOrder(sampled) {
  const pictures = [], textOrder = new Map();
  let order = 0;
  const walk = (n, opacity) => {
    const o = opacity * (n.opacity ?? 1);
    if (o <= 0) return;
    order += 1;
    if (n.type === 'image' && isBox(n.bbox)) pictures.push({ id: n.id, order, box: n.bbox });
    if (n.type === 'text') textOrder.set(n.id, order);
    (n.children ?? []).forEach((child) => walk(child, o));
  };
  (Array.isArray(sampled) ? sampled : []).forEach((n) => walk(n, 1));
  return { pictures, textOrder };
}

// A text drawn before a picture that covers its ink by more than OVERLAP_UNITS both ways: mechanical, the text is hidden
// under it (a pinned slug, kicker tag or caption drawn under a zoomed picture). Any frame: a cover is a cover in motion.
function coverRules(texts, sampled, ctx, unit) {
  const { pictures, textOrder } = drawOrder(sampled);
  const limit = OVERLAP_UNITS * unit + EPSILON;
  return texts.flatMap((t) => pictures.filter((p) => p.order > (textOrder.get(t.node.id) ?? Infinity)).flatMap((p) => {
    const across = Math.min(t.ink[0] + t.ink[2], p.box[0] + p.box[2]) - Math.max(t.ink[0], p.box[0]);
    const down = Math.min(t.ink[1] + t.ink[3], p.box[1] + p.box[3]) - Math.max(t.ink[1], p.box[1]);
    if (across <= limit || down <= limit) return [];
    return [finding(ctx, MECHANICAL, 'covered', `${t.node.id}|${p.id}`, `text "${t.node.id}" is drawn under the picture "${p.id}"; draw it after the picture or move it off`, t.role)];
  }));
}

// The mode's data: the registered mode named by ctx.mode (a name, or a mode object), else the object given, else none.
function modeData(mode) {
  const name = typeof mode === 'string' ? mode : mode?.name;
  if (registries.modes.has(name)) return registries.modes.get(name);
  return typeof mode === 'object' && mode !== null ? mode : {};
}

// Word counts the mode limits (mode data): a line of more than maxLineWords words; on the film's first shot, an opening
// statement of more than maxHookWords. A mode without a limit has no such rule.
function wordRules(texts, ctx) {
  const { name, maxLineWords, maxHookWords } = modeData(ctx.mode);
  const out = [];
  if (Number.isFinite(maxLineWords)) {
    for (const { node, role } of texts) {
      if (node.layout.lines.some((line) => shownWords(node, line.words).length > maxLineWords)) {
        out.push(finding(ctx, CREATIVE, 'line-words', node.id, `text "${node.id}" has a line of more than ${maxLineWords} words; shorten it`, role));
      }
    }
  }
  // the opening statement is the largest text that is not frame furniture (a caption, a slug): never a caption
  const opening = texts.filter((t) => !isFurniture(t));
  if (Number.isFinite(maxHookWords) && ctx.isFirstShot && opening.length > 0) {
    const hero = opening.reduce((best, t) => (t.size > best.size ? t : best));
    const stack = hero.node.props?.stack;
    // every line of the hero's stack, whatever its role (review C I3: the rule as at 9ea68e6; a kind keeps a line it does
    // not want read as the hook out of the stack)
    const parts = stack === undefined ? [hero] : texts.filter((t) => t.node.props?.stack === stack);
    const count = parts.reduce((sum, t) => sum + shownWords(t.node, wordsOf(t.node.layout)).length, 0);
    if (count > maxHookWords) out.push(finding(ctx, CREATIVE, 'hook-words', hero.node.id, `the opening statement has ${count} words; a ${name} hook takes at most ${maxHookWords}`, hero.role));
  }
  return out;
}

// ---- spoken captions (props.caption, set by engine/captions: { zone, end, hero, emphasis }) ----

export const CAPTION_LATE_SECONDS = 0.3; // a caption may stay this long after its last word ends
// A picture covering this share of the canvas or more (a full-bleed picture), or standing at GROUND_ZOOM or more of its
// size (the camera pushing in on it: the smallest push is 1.2, kinds/shared.mjs PUSH.min; a punch is 1.08), is the
// frame's ground, not a figure a caption could cover: captions sit over it as subtitles sit over video.
const GROUND_SHARE = 0.8;
const GROUND_ZOOM = 1.2;

const isSpokenCaption = (t) => t.node.props?.caption !== null && typeof t.node.props?.caption === 'object';
const outsideBox = ([x, y, w, h], [zx, zy, zw, zh], slack) => x < zx - slack || y < zy - slack || x + w > zx + zw + slack || y + h > zy + zh + slack;
const overlapBy = (a, b) => Math.min(Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));

// The share of the canvas a box covers.
function canvasShare([x, y, w, h], canvas) {
  const across = Math.max(0, Math.min(x + w, canvas.w) - Math.max(x, 0)), down = Math.max(0, Math.min(y + h, canvas.h) - Math.max(y, 0));
  return (across * down) / (canvas.w * canvas.h);
}

// The pictures a caption must keep off, as { id, box }: every visible picture (the pictures inside the hero among them;
// never the paper, tape or shadow it is mounted on) less any that is the frame's ground (GROUND_ZOOM, GROUND_SHARE), and
// the hero itself when it is a path, at any scale. Texts are rule 5's and the overlap rule's.
function figuresOf(sampled, heroId, canvas) {
  const found = [];
  const walk = (n, opacity, scale) => {
    const o = opacity * (n.opacity ?? 1), s = scale * scaleOf(n);
    if (o <= 0) return;
    const ground = n.type === 'image' && (s >= GROUND_ZOOM - EPSILON || (isBox(n.bbox) && canvasShare(n.bbox, canvas) >= GROUND_SHARE));
    const counts = n.type === 'image' || (n.id === heroId && n.type === 'path');
    if (counts && isBox(n.bbox) && !ground) found.push({ id: n.id, box: n.bbox });
    (n.children ?? []).forEach((child) => walk(child, o, s));
  };
  (Array.isArray(sampled) ? sampled : []).forEach((n) => walk(n, 1, 1));
  return found;
}

// What the author can change when a caption style finds no place in its band (engine/captions groups.mjs clearZone moves
// the zone off every pinned card and mark it can): no spec field moves the zone itself.
const CAPTION_REMEDY = 'shorten the shot\'s line so its caption groups are narrower, or turn captions off for the film (captions: false)';
const inShot = (id, ctx) => `caption "${id}" in shot "${ctx.shotId}"`;

// Rule 5 (caption-covers): a landed caption over a region its shot marks (props.caption.marks: the mark devices' ids,
// their boxes from marks.mjs, the computation the caption placed itself with), while the mark is drawn on screen,
// whatever the picture under it (ground or not); or over any text that has not landed (a hero mid-pulse or set large:
// two landed texts are the overlap rule's), by more than OVERLAP_UNITS both ways. Creative: the caption styles keep off
// every mark and card they can, so what is left is the author's to change (branch review A, I3).
function captionCoverRules(captions, texts, sampled, ctx, unit) {
  const limit = OVERLAP_UNITS * unit + EPSILON;
  return captions.filter((t) => t.landed).flatMap((t) => {
    const id = t.node.id;
    const mark = markBoxes(sampled, t.node.props.caption.marks ?? []).find((m) => overlapBy(t.ink, m.box) > limit);
    const text = texts.find((o) => !o.landed && !isSpokenCaption(o) && overlapBy(t.ink, o.ink) > limit);
    return [
      ...(mark ? [finding(ctx, CREATIVE, 'caption-covers', `${id}|${mark.id}`, `${inShot(id, ctx)} covers the region marked by "${mark.id}", and its style found no place in its band clear of it; move the mark (its region, its target or its cue), ${CAPTION_REMEDY}`, t.role)] : []),
      ...(text ? [finding(ctx, CREATIVE, 'caption-covers', `${id}|${text.node.id}`, `${inShot(id, ctx)} covers the text "${text.node.id}" while it arrives; shorten that text or ${CAPTION_REMEDY}`, t.role)] : []),
    ];
  });
}

// Rules 1 and 2: a landed caption whose ink leaves its zone, or lies over a picture that is not ground (or a hero that is
// a path) by more than OVERLAP_UNITS both ways.
function captionPlaceRules(captions, sampled, ctx, unit) {
  return captions.filter((t) => t.landed).flatMap((t) => {
    const { zone, hero } = t.node.props.caption;
    const id = t.node.id;
    const out = [];
    if (isBox(zone) && outsideBox(t.ink, zone, SAFE_TOLERANCE_UNITS * unit)) out.push(finding(ctx, MECHANICAL, 'caption-zone', id, `${inShot(id, ctx)} is outside its caption zone; cut words from the shot's line (a long word alone, or many words together)`, t.role));
    const over = figuresOf(sampled, hero, ctx.canvas).find((f) => overlapBy(t.ink, f.box) > OVERLAP_UNITS * unit + EPSILON);
    if (over) out.push(finding(ctx, MECHANICAL, 'caption-hero', `${id}|${over.id}`, `${inShot(id, ctx)} covers "${over.id}"; captions never cover the hero or a picture: make the picture smaller, ${CAPTION_REMEDY}`, t.role));
    return out;
  });
}

// Rule 3: a caption on screen more than CAPTION_LATE_SECONDS after its last word ends (ctx.t and caption.end are film
// seconds; a frame without ctx.t is not judged).
function captionLateRules(captions, ctx) {
  if (!Number.isFinite(ctx.t)) return [];
  return captions.filter((t) => ctx.t - t.node.props.caption.end > CAPTION_LATE_SECONDS + EPSILON).map((t) => finding(ctx, MECHANICAL, 'caption-late', t.node.id,
    `caption "${t.node.id}" is still on screen ${(ctx.t - t.node.props.caption.end).toFixed(2)} s after its last word ends; it must leave within ${CAPTION_LATE_SECONDS} s`, t.role));
}

// Rule 4: on any frame (a pulse included), an emphasised word on screen whose ink leaves the caption's zone.
function captionClipRules(captions, ctx, unit) {
  return captions.flatMap((t) => {
    const { zone, emphasis } = t.node.props.caption;
    if (!isBox(zone) || !Array.isArray(emphasis) || emphasis.length === 0) return [];
    const hidden = hiddenNow(t.node);
    const clipped = wordInks(t.node).find(({ word, box }) => emphasis.includes(word.index) && !hidden.has(word.index) && outsideBox(box, zone, SAFE_TOLERANCE_UNITS * unit));
    if (!clipped) return [];
    return [finding(ctx, MECHANICAL, 'caption-clipped', t.node.id, `in caption "${t.node.id}" the emphasised word "${clipped.word.text}" is clipped by its caption zone; keep room in the layout for its peak scale`, t.role)];
  });
}

function captionRules(texts, sampled, ctx, unit) {
  const captions = texts.filter(isSpokenCaption);
  return [...captionPlaceRules(captions, sampled, ctx, unit), ...captionLateRules(captions, ctx), ...captionClipRules(captions, ctx, unit),
    ...captionCoverRules(captions, texts, sampled, ctx, unit)];
}

// Is anything but the background on screen? Nodes behind the picture plane (depth > 0: the film's field) do not count.
function showsContent(sampled) {
  const walk = (n, opacity) => {
    const o = opacity * (n.opacity ?? 1);
    if (o <= 0 || n.depth > 0) return false;
    return showsItself(n) || (n.children ?? []).some((child) => walk(child, o));
  };
  // the ground sheet of a grounded look (poster) is the background colour as a node, not content
  return (Array.isArray(sampled) ? sampled : []).filter((n) => n.id !== GROUND_ID).some((n) => walk(n, 1));
}

/**
 * A shot that opens on a frame with nothing but the field reads as a dropped frame: on the frame a shot opens on,
 * something else must be on screen.
 * Mechanical. The caller says which frame opens a shot (ctx.opensShot; scripts/v2/review.mjs openingFrameOf).
 */
export function openingFindings(sampled, ctx) {
  if (showsContent(sampled)) return [];
  return [finding(ctx, MECHANICAL, 'empty-first-frame', '', `shot "${ctx.shotId}" opens on an empty frame: only the field is on screen; bring its hero in on the first frame`)];
}

// ---- composition: where a shot's resting frame is empty, and what leads it ----
//
// One measure (compositionOf) and two creative rules over it. An element is a top-level node that shows something (not the
// field behind the picture plane, not a caption, not a fixed overlay such as a slug or a mark: furniture the picture sits
// among); its box is the union of the boxes of the nodes that show themselves. The band is the longest stretch of the safe
// rectangle that no element's box enters. The hero is the largest element when it leads the second by HERO_LEAD or more.
// Both rules are judged once per shot, on its resting frame (ctx.restsShot), and a frame with a ground (an element covering
// GROUND_SHARE of the canvas) is judged by neither. scale-contrast is also skipped on a shot of peers (ctx.peers: the kind
// lays out equals, kind.peers), where a slug or a divider is the "second" element and the ratio means nothing. A captioned
// shot is measured inside the safe rectangle less the zone its caption layout reserves (ctx.captionZone), so the reserved
// strip is not counted as empty and a hero that clears it is not counted as small.

export const COMPOSITION_RULES = Object.freeze(['dead-space', 'scale-contrast']);
// The thresholds and what a look's `fill` may hold are looks/fill.mjs's: one definition for the validator and the review.
export { DEFAULT_FILL };
export const HERO_LEAD = 1.5;
const PERCENT = 100;
const WHERE = Object.freeze({ left: 'the left', right: 'the right', top: 'the top', bottom: 'the bottom', middle: 'a band through the middle' });
const SIDE = Object.freeze({ x: 'width', y: 'height' });
const EPSILON_PERCENT = 1e-9; // so 29% (0.29 * 100 = 28.999...) is not floored to 28
const percentOf = (share) => Math.floor(share * PERCENT + EPSILON_PERCENT); // rounded down: 54.6% never reads as 55% against a 55% bar

/** The fill thresholds of a look: DEFAULT_FILL with the look's optional `fill` laid over it; a key that is not a field, or
 *  not a number above 0 and at most 1, is ignored (looks/index.mjs validateLook refuses both when the look registers), so
 *  it cannot switch a rule off. */
export const fillOf = (look) => ({ ...DEFAULT_FILL, ...Object.fromEntries(Object.entries(look?.fill ?? {}).filter(([key, v]) => Object.hasOwn(DEFAULT_FILL, key) && isFillShare(v))) });

// The safe rectangle less the room the caption layout reserves: a zone in the lower half takes the safe rectangle's bottom
// up to its top, one in the upper half takes the top down to its bottom. A zone that is not a box, or that would leave no
// room, changes nothing. Only a look that composes in the platform safe zone (pop on 9:16) reserves the zone in its layout
// (captions/index.mjs kindContext captionRoom); for desk, cosmos and pop on 16:9 the layout is the same with captions on or
// off, so there the cut only keeps the strip the caption is drawn over out of the measure, and a bare band above scores
// higher against the shorter side.
function safeLessCaptions(safe, zone) {
  if (!isBox(zone)) return safe;
  const [, y, , h] = zone, middle = (safe.top + safe.bottom) / 2;
  const less = y + h / 2 >= middle ? { ...safe, bottom: Math.min(safe.bottom, y) } : { ...safe, top: Math.max(safe.top, y + h) };
  return less.bottom > less.top ? less : safe;
}

// A box cut to the canvas, or null when none of it is on the canvas.
function clipToCanvas([x, y, w, h], canvas) {
  const left = Math.max(x, 0), top = Math.max(y, 0), right = Math.min(x + w, canvas.w), bottom = Math.min(y + h, canvas.h);
  return right > left && bottom > top ? [left, top, right - left, bottom - top] : null;
}

// What a node shows in canvas pixels: a text with a layout by its ink, anything else by its bbox; null when it has no
// usable box. A text whose layout the ink cannot be read from is skipped here: visibleTexts reports it once, as the
// mechanical "could not be measured", so a bad layout never aborts the review.
function ownBox(n) {
  if (!isBox(n.bbox)) return null;
  if (n.type !== 'text' || !hasWords(n.layout)) return n.bbox;
  try {
    const ink = inkBox(n, hiddenNow(n));
    return isBox(ink) ? ink : n.bbox;
  } catch {
    return null;
  }
}

// The boxes of the nodes in a subtree that show themselves at an accumulated opacity above 0.
function shownBoxes(n, opacity) {
  const o = opacity * (n.opacity ?? 1);
  if (o <= 0) return [];
  const own = showsItself(n) ? [ownBox(n)].filter(Boolean) : [];
  return [...own, ...(n.children ?? []).flatMap((child) => shownBoxes(child, o))];
}

// The top-level nodes that show something, as { id, box, area }: not behind the picture plane, not the ground sheet of a
// grounded look, not the shot's captions (the page's own boundary, page/stage.mjs captionFilter), and not a fixed overlay
// (props.fixed: a slug, a mark, a rule across the frame) other than the shot's own caption card (`<shot>.caption`, the
// clipping kind's), which is content placed in the free area on purpose.
function elementsOf(sampled, ctx) {
  const captions = `${ctx.shotId}.captions`;
  const isCaption = (id) => id === captions || id.startsWith(`${captions}.`);
  const card = `${ctx.shotId}.caption`;
  const isCard = (id) => id === card || id.startsWith(`${card}.`);
  const isFurniture = (n) => n.props?.fixed === true && !isCard(String(n.id ?? ''));
  const tops = (Array.isArray(sampled) ? sampled : []).filter((n) => !(n.depth > 0) && n.id !== GROUND_ID && !isCaption(String(n.id ?? '')) && !isFurniture(n));
  return tops.flatMap((n) => {
    const boxes = shownBoxes(n, 1);
    const box = boxes.length > 0 ? clipToCanvas(union(boxes), ctx.canvas) : null;
    return box ? [{ id: n.id, box, area: box[2] * box[3] }] : [];
  });
}

// The longest stretch of [lo, hi] that none of the spans enters, as { size, from, to }; the first of equal ones.
function longestGap(spans, lo, hi) {
  let best = { size: 0, from: lo, to: lo }, cursor = lo;
  const within = spans.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  for (const [a, b] of within) {
    if (a - cursor > best.size) best = { size: a - cursor, from: cursor, to: a };
    cursor = Math.max(cursor, b);
  }
  return hi - cursor > best.size ? { size: hi - cursor, from: cursor, to: hi } : best;
}

function bandAlong(gap, lo, hi, axis, [before, after]) {
  const touches = gap.from === lo ? before : gap.to === hi ? after : 'middle';
  return { share: gap.size / (hi - lo), axis, where: gap.from === lo && gap.to === hi ? 'middle' : touches };
}

const entersSafe = ({ box: [x, y, w, h] }, safe) => x < safe.right && x + w > safe.left && y < safe.bottom && y + h > safe.top;

// The larger of the empty band across the safe width and down its height, `x` on a tie. An element that does not enter
// the safe rectangle (a slug in the margin) splits neither axis.
function bandOf(all, safe) {
  const elements = all.filter((e) => entersSafe(e, safe));
  const across = bandAlong(longestGap(elements.map((e) => [e.box[0], e.box[0] + e.box[2]]), safe.left, safe.right), safe.left, safe.right, 'x', ['left', 'right']);
  const down = bandAlong(longestGap(elements.map((e) => [e.box[1], e.box[1] + e.box[3]]), safe.top, safe.bottom), safe.top, safe.bottom, 'y', ['top', 'bottom']);
  return down.share > across.share ? down : across;
}

/**
 * The composition of one frame: { ground, elements: [{ id, box, area }], band: { share, axis, where }, hero: { id,
 * extent } | null, next: { id, area } | null }. `ground`: an element covers GROUND_SHARE of the canvas. `hero`: the largest
 * element when it stands alone or is HERO_LEAD times the next; `extent` is the larger of its width over the safe width and
 * its height over the safe height; both are measured in the safe rectangle less ctx.captionZone, the room the caption layout
 * reserves. @param {object[]} sampled @param {object} ctx as for auditFrame
 */
export function compositionOf(sampled, ctx) {
  const elements = elementsOf(sampled, ctx);
  const [top, second] = [...elements].sort((a, b) => b.area - a.area);
  const safe = safeLessCaptions(ctx.safe, ctx.captionZone);
  const leads = top !== undefined && (second === undefined || top.area >= HERO_LEAD * second.area);
  return {
    ground: elements.some((e) => canvasShare(e.box, ctx.canvas) >= GROUND_SHARE),
    elements,
    band: bandOf(elements, safe),
    hero: leads ? { id: top.id, extent: Math.max(top.box[2] / (safe.right - safe.left), top.box[3] / (safe.bottom - safe.top)) } : null,
    next: second === undefined ? null : { id: second.id, area: second.area },
  };
}

/**
 * The two composition findings of a frame, each { kind: 'creative', path, message, rule, node: '', measure }: dead-space
 * (the empty band reaches fill.band of its side; measure: how far past) and scale-contrast (a hero that leads the next
 * reaches less than fill.hero of the frame; measure: how far short). A frame with a ground has none.
 */
export function compositionFindings(sampled, ctx, fill = fillOf(ctx.look)) {
  const c = compositionOf(sampled, ctx);
  if (c.ground) return [];
  const out = [];
  if (c.band.share >= fill.band) {
    const percent = percentOf(c.band.share), side = SIDE[c.band.axis];
    const said = c.elements.length === 0 ? `the frame shows nothing: ${percent}% of its ${side} is empty` : `the frame leaves ${percent}% of its ${side} empty (${WHERE[c.band.where]})`;
    out.push({ ...finding(ctx, CREATIVE, 'dead-space', '', `${said}; let the hero take more of the frame, add a second element, or use a look that fills with type`), measure: c.band.share - fill.band });
  }
  if (c.hero && ctx.peers !== true && c.hero.extent < fill.hero) {
    const rest = c.next ? `, and the next largest thing, "${c.next.id}", is smaller still` : ' and stands alone';
    out.push({ ...finding(ctx, CREATIVE, 'scale-contrast', '', `the hero, "${c.hero.id}", reaches ${percentOf(c.hero.extent)}% of the frame${rest}; set it larger, crop in on it, or give it a second mass (a picture, a chart, a card)`), measure: fill.hero - c.hero.extent });
  }
  return out;
}

/**
 * @param {object[]} sampled the tree the page's __snapshot(i) returns for one frame
 * @param {{ look: object, canvas: { w: number, h: number }, mode: string | { name: string }, shotId: string, t: number,
 *   safe: { left: number, top: number, right: number, bottom: number }, shotIndex?: number, isFirstShot?: boolean,
 *   restScales?: Map<string, number>, restWords?: Map<string, number[]>, opensShot?: boolean, background?: string }} ctx
 *   background: the shot's background colour (#rrggbb), the ground of a text with no field or shape under it
 *   (engine/review/contrast.mjs).
 *   safe: the rectangle text must stay inside (scripts/v2/review.mjs safeRectFor). shotIndex: the shot's place in the
 *   film, for the finding's path (`shots[<index>]`; the id when absent). isFirstShot: the frame belongs to the first shot
 *   of the film (the viral hook rule).
 *   restScales: node id -> the accumulated scale it rests at in its shot (textScalesIn); a text is judged only while it
 *   stands within 0.2% of it (SETTLE_TOLERANCE). restWords: node id -> per word index the scale it rests at; a word
 *   is at rest within 0.2% of it (1 when absent). opensShot: the frame is the one its shot opens on (the opening rule,
 *   openingFindings). regionMarks: the ids of the marks the shot draws on its regions (regions.mjs regionMarkIds); a
 *   mark among them that runs past the frame is a finding (region-off-frame), as is a text the frame edge slices during
 *   a close-up (frame-edge). restsShot: the frame is the shot's resting frame (not mid-entrance, not inside a cut's window):
 *   only then are the composition findings (compositionFindings) added. peers: the shot's kind lays out equals (kind.peers),
 *   so scale-contrast is not judged. captionZone: [x, y, w, h], the zone the shot's caption layout reserves (the caption
 *   nodes' props.caption.zone; scripts/v2/review.mjs restingByShot), which the composition measure leaves out of the safe rectangle.
 *   aimed: the spec paths aimed at the shot's targets (dropped.mjs aimedAtOf), for the "dropped" finding.
 * @returns {{ kind: 'mechanical' | 'creative', path: string, message: string, rule: string, node: string, role?: string }[]}
 */
export function auditFrame(sampled, ctx) {
  if (!ctx.safe) throw new Error('auditFrame needs ctx.safe, the rectangle text must stay inside');
  const unit = unitOf(ctx.canvas);
  const { texts, unmeasured } = visibleTexts(sampled, unit, ctx);
  const lost = unmeasured.map((id) => finding(ctx, MECHANICAL, 'measure', id, `${id}: could not be measured`));
  const opening = ctx.opensShot === true ? openingFindings(sampled, ctx) : [];
  const make = (kind, rule, node, message, role, suggest) => finding(ctx, kind, rule, node, message, role, suggest);
  const contrast = contrastFindings(texts, sampled, ctx, make);
  const regions = regionFindings(sampled, texts, ctx, make);
  const composition = ctx.restsShot === true ? compositionFindings(sampled, ctx) : [];
  return [...lost, ...opening, ...contrast, ...regions,...textRules(texts, ctx), ...overlapRules(texts, ctx, unit), ...wordOverlapRules(texts, ctx, unit), ...hierarchyRules(texts, ctx), ...wordRules(texts, ctx), ...highlightRules(texts, ctx), ...cardRules(texts, textCards(sampled), ctx, unit), ...coverRules(texts, sampled, ctx, unit), ...captionRules(texts, sampled, ctx, unit), ...composition];
}
