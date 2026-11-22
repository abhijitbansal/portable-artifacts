// A word drawn glyph by glyph (a letter-by-letter entrance), placed so that at rest it is the word drawn whole.
// A "glyph" here is a grapheme cluster (Intl.Segmenter), never a code point: a decomposed accent or an emoji sequence is one.
//
// Glyph k starts at the word's origin plus the advance the whole word gives it: the width of the first k + 1 graphemes less
// the width of grapheme k alone (a kern pair's adjustment sits on the first glyph's advance, so the prefix of k graphemes
// alone would miss it). Measured with the font, stretch and letter spacing already on the context.
//
// A word the glyph path cannot draw faithfully is drawn whole, with the mean of its glyph values (glyphRollup) so that it
// still arrives with its letters, as one block: invisible while every letter is, never on screen before them:
//  - a word with a right-to-left character (glyph 0 would go leftmost, and the joining forms would be lost);
//  - a word whose glyph-by-glyph picture differs from the whole word's (a ligature such as fi, ff or fl, or a contextual
//    form, a kern or a mark that moves a glyph). That is judged by drawing the word both ways on a scratch canvas and
//    comparing the pictures, not guessed from advances: a ligature's advance can equal the sum of its letters'.
// The verdict is one per word for the whole film (faithfulOf): the word must pass at all four quarter-pixel phases of its
// origin, on the text's base font AND on its reserved font (the heaviest weight an emphasis sweep reaches, which an
// emphasised word settles in), never on the font a sweep happens to be at, so it cannot change while the word moves, sweeps
// or settles. It is cached on that font, the shaping settings and the text. It reads how this browser rasterises, so which
// words are drawn letter by letter can differ between systems.
import { applyFont, trackingPx } from './text-style.mjs';
import { glyphRollup, graphemesOf, normaliseGlyph as normalise, unit01 } from '../graph/rollup.mjs';

// The roll-up and the grapheme split are pure and shared with the scene graph and the review (graph/rollup.mjs), which read
// a word by the same mean the draw uses; they are exported from here too.
export { glyphRollup, graphemesOf };

const HALF = 2;
const CACHE_MAX = 4096; // distinct (font, word) pairs a film can hold; far above any film, a bound against a runaway
const SCRATCH_PAD = 4; // px of margin on every side of the scratch picture, over the whole word's ink
// Hebrew, Arabic, Syriac, Thaana, N'Ko, Samaritan, Mandaic and the presentation forms; the right-to-left marks and
// embeddings; Phoenician and the other right-to-left scripts of the supplementary planes.
const RTL = /[֐-ࣿ‏‫‮⁧יִ-﷿ﹰ-﻿]|[\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
// Tests only (window.__setGlyphPath, engine/page/stage.mjs): with `force`, every word is drawn through the glyph path with
// `values` for every glyph (the identity unless given). A film is JSON and reaches no page global, so this cannot be set
// from a spec. `stats` collects, while forced, the DISTINCT words that took the glyph path and those the check rejected
// (window.__glyphStats): a check that rejected every word would leave every pixel test green, so a test asserts the count.
const newStats = () => ({ glyph: new Set(), rejected: new Set() });
const glyphPath = { force: false, values: normalise(), stats: newStats() };
export function setGlyphPath(force, values) {
  glyphPath.force = force === true;
  glyphPath.values = normalise(values);
  glyphPath.stats = newStats();
}
export const glyphStats = () => ({
  glyph: glyphPath.stats.glyph.size,
  rejected: glyphPath.stats.rejected.size,
  glyphWords: [...glyphPath.stats.glyph],
  rejectedWords: [...glyphPath.stats.rejected],
});

/** Whether a normalised glyph is drawn untouched. */
export const isIdentityGlyph = (g) => g.opacity === 1 && g.x === 0 && g.y === 0 && g.scale === 1;

// Each glyph at its origin, with its own values, in one pass; `paint(char, x)` runs inside the glyph's transform. A scaled
// glyph pivots on the centre of its ink: its advance less the letter spacing the advance carries after it.
function eachGlyph(ctx, { chars, origins, pivots }, glyphs, left, paint) {
  chars.forEach((char, k) => {
    const g = glyphs[k];
    const opacity = unit01(g.opacity);
    if (opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha *= opacity;
    const start = left + origins[k];
    if (g.scale === 1) {
      // no pivot: a glyph at rest is drawn at exactly its place in the word (a pivot's translate and its undo would round
      // the position in float32 and could move the glyph into the next sub-pixel step)
      ctx.translate(g.x, g.y);
      paint(char, start);
    } else {
      ctx.translate(start + pivots[k] + g.x, g.y);
      ctx.scale(g.scale, g.scale);
      paint(char, -pivots[k]);
    }
    ctx.restore();
  });
}

/**
 * Draw a word's glyphs one by one from `left` (the word's own origin, on the baseline). `glow(char, x)`, when given, strokes a
 * glyph's halo first, for every glyph, inside the glyph's transform and opacity (the halos all lie under the letters).
 * @param {CanvasRenderingContext2D} ctx font, letter spacing and fill already set
 * @param {{ chars: string[], origins: number[], pivots: number[] }} placement placementOf's
 * @param {{ opacity: number, x: number, y: number, scale: number }[]} glyphs one per grapheme
 * @param {number} left
 * @param {((char: string, x: number) => void) | null} [glow]
 */
export function drawGlyphs(ctx, placement, glyphs, left, glow = null) {
  if (glow) eachGlyph(ctx, placement, glyphs, left, glow);
  eachGlyph(ctx, placement, glyphs, left, (char, x) => ctx.fillText(char, x, 0));
}

// The canvas settings that change how a run is shaped or placed besides the font, stretch and letter spacing: copied to the
// scratch context and part of the cache keys, so a setting a draw sets later cannot leave a stale verdict. Absent on a
// context that lacks one.
const SHAPING = Object.freeze(['fontKerning', 'fontVariantCaps', 'textRendering', 'wordSpacing', 'direction']);
const shapingKey = (ctx) => SHAPING.map((setting) => ctx[setting]).join('|');
// Where the whole word's origin sits off the pixel grid, in the quarter pixels the rasteriser places a glyph at.
const PHASES = Object.freeze([0, 0.25, 0.5, 0.75]);
// How far one colour channel (of 255) the two draws may differ and still count as the same picture. A glyph drawn alone is
// placed at a float a hair off the whole run's (at path-rendered sizes, over about 256 px, there is no sub-pixel step to hide
// it), which moves a handful of edge pixels by a few levels (largest seen: 5, on macOS, the pop and poster plain word sets,
// Chromium from Playwright); a ligature, a kern or a mark that moves a glyph changes whole pixels by 100 or more.
export const SAME_PICTURE = 8;

// Where each grapheme goes, measured on `ctx` as it stands (its font, stretch and letter spacing set; `spacing` is that
// spacing in CSS px, which the context's own getter does not give reliably: it reads empty on a context a text was drawn on).
function measurePlacement(ctx, chars, spacing) {
  const letterSpacing = Number.parseFloat(spacing) || 0;
  const widths = chars.map((char) => ctx.measureText(char).width);
  const origins = chars.map((_, k) => ctx.measureText(chars.slice(0, k + 1).join('')).width - widths[k]);
  const pivots = widths.map((w) => (w - letterSpacing) / HALF);
  return { chars, origins, widths, pivots };
}

// A scratch context set up like the text's: font at rest, stretch, tracking, the shaping settings, black fill.
function scratchSetup(c, ctx, resting) {
  applyFont(c, resting, { tracked: true });
  for (const setting of SHAPING) if (ctx[setting]) c[setting] = ctx[setting];
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.fillStyle = '#000000';
}

let probe = null; // one context to measure on, made when first needed

// The two draws on a scratch canvas, the whole word's origin at each quarter pixel: do they leave the same picture
// (SAME_PICTURE) at every one?
function samePicture(ctx, resting, text, chars) {
  probe ??= new OffscreenCanvas(1, 1).getContext('2d');
  scratchSetup(probe, ctx, resting);
  const placement = measurePlacement(probe, chars, trackingPx(resting));
  const m = probe.measureText(text);
  const ascent = Math.ceil(Math.max(0, m.actualBoundingBoxAscent));
  const descent = Math.ceil(Math.max(0, m.actualBoundingBoxDescent));
  const pad = SCRATCH_PAD + Math.ceil((ascent + descent) / HALF); // a misplaced glyph strays further than a pixel or two
  const left = pad + Math.ceil(Math.max(0, m.actualBoundingBoxLeft));
  const width = Math.ceil(left + 1 + Math.max(m.width, m.actualBoundingBoxRight) + pad);
  const height = ascent + descent + HALF * pad;
  const c = new OffscreenCanvas(width, height).getContext('2d');
  scratchSetup(c, ctx, resting);
  const baseline = pad + ascent;
  const identity = chars.map(() => normalise());
  return PHASES.every((phase) => {
    c.clearRect(0, 0, width, height);
    c.save();
    c.translate(0, baseline); // getImageData and clearRect ignore the transform: they are called outside it
    c.fillText(text, left + phase, 0);
    c.restore();
    const whole = c.getImageData(0, 0, width, height).data;
    c.clearRect(0, 0, width, height);
    c.save();
    c.translate(0, baseline);
    drawGlyphs(c, placement, identity, left + phase);
    c.restore();
    const parts = c.getImageData(0, 0, width, height).data;
    return whole.length === parts.length && whole.every((v, i) => Math.abs(v - parts[i]) <= SAME_PICTURE);
  });
}

const verdicts = new Map();

/**
 * Whether `text` can be drawn glyph by glyph faithfully: not right-to-left, and the same picture as the whole word at all four
 * quarter-pixel phases of its origin. One verdict per word and font, cached on that font, its tracking, the shaping
 * settings and the text; it does not depend on where the word is, how it moves, or what weight a sweep has reached. glyphRunOf
 * asks it of the text's base font and of its reserved font, and a word is faithful only if both pass.
 * @param {CanvasRenderingContext2D} ctx read for the shaping settings only
 * @param {object} resting one fixed font of the text, not a swept one ({ family, size, weight?, width?, tracking? })
 * @param {string} text
 */
export function faithfulOf(ctx, resting, text) {
  const key = [resting.family, resting.size, resting.weight, resting.width, resting.tracking, shapingKey(ctx), text].join('|');
  if (verdicts.has(key)) return verdicts.get(key);
  const chars = graphemesOf(text);
  const verdict = chars.length > 0 && !RTL.test(text) && (chars.length === 1 || samePicture(ctx, resting, text, chars));
  if (verdicts.size >= CACHE_MAX) verdicts.clear();
  verdicts.set(key, verdict);
  return verdict;
}

const placements = new Map();

/**
 * Where each grapheme of `text` goes on `ctx` as it stands (the font the word is drawn in, which may be mid-sweep):
 * { chars, origins, widths, pivots }. Cached per font, stretch, spacing, shaping settings and text.
 * @param {CanvasRenderingContext2D} ctx the context with the word's font and stretch set
 * @param {string} text
 * @param {string} [spacing] the letter spacing the word is drawn with (CSS px); the context's own getter is not trusted: it reads
 *   empty on a context a text was drawn on before, though the spacing is in force
 */
export function placementOf(ctx, text, spacing = ctx.letterSpacing) {
  const key = [ctx.font, ctx.fontStretch, spacing, shapingKey(ctx), text].join('|');
  const known = placements.get(key);
  if (known) return known;
  const placement = measurePlacement(ctx, graphemesOf(text), spacing);
  if (placements.size >= CACHE_MAX) placements.clear();
  placements.set(key, placement);
  return placement;
}

/**
 * How a word with glyph values is drawn, or null when it is drawn whole as it stands (no glyph values, or every one is the
 * identity: the whole word keeps its ligatures and contextual forms):
 *  - { placement, glyphs, settled }: glyph by glyph (settled: every glyph at rest, which only the test seam draws this way);
 *  - { rolled: { opacity, dx, dy, scale } }: the glyph path cannot draw the word faithfully, so it is drawn whole with the
 *    glyphRollup of its glyph values, and so still arrives with its letters instead of standing on screen before them.
 * With the test seam forced, every word takes the glyph path with the seam's values (or its roll-up, when rejected).
 * @param {CanvasRenderingContext2D} ctx the context with the word's font set
 * @param {{ text: string }} word
 * @param {{ glyphs?: object[] }} tracks the word's sampled tracks; `glyphs[k]` is grapheme k's { opacity, x, y, scale }
 * @param {() => { spacing: string, base: object, reserved?: object }} styleOf the letter spacing the word is drawn with (CSS px),
 *   the text's base font and its reserved font (the heaviest weight an emphasis sweep reaches; the base font when none);
 *   called only when the word has glyph values
 */
export function glyphRunOf(ctx, word, tracks, styleOf) {
  if (!glyphPath.force && !tracks.glyphs) return null;
  const { spacing, base, reserved = base } = styleOf();
  const placement = placementOf(ctx, word.text, spacing);
  const faithful = faithfulOf(ctx, base, word.text) && (reserved === base || faithfulOf(ctx, reserved, word.text));
  const glyphs = placement.chars.map((_, k) => (glyphPath.force ? glyphPath.values : normalise(tracks.glyphs[k])));
  const settled = glyphs.every(isIdentityGlyph);
  if (glyphPath.force) glyphPath.stats[faithful ? 'glyph' : 'rejected'].add(word.text);
  if (!faithful) return settled ? null : { rolled: glyphRollup(glyphs) };
  return settled && !glyphPath.force ? null : { placement, glyphs, settled };
}
