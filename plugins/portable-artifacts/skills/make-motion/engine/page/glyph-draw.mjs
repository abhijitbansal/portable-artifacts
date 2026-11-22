// A word drawn glyph by glyph (a letter-by-letter entrance), placed so that at rest it is the word drawn whole.
// A "glyph" here is a grapheme cluster (Intl.Segmenter), never a code point: a decomposed accent or an emoji sequence is one.
//
// Glyph k starts at the word's origin plus the advance the whole word gives it: the width of the first k + 1 graphemes less
// the width of grapheme k alone (a kern pair's adjustment sits on the first glyph's advance, so the prefix of k graphemes
// alone would miss it). Measured with the font, stretch and letter spacing already on the context.
//
// A word the glyph path cannot draw faithfully is drawn whole, with the mean of its glyph values (rollupOf) so that it still
// arrives with its letters, as one block: invisible while every letter is, never on screen before them:
//  - a word with a right-to-left character (glyph 0 would go leftmost, and the joining forms would be lost);
//  - a word whose glyph-by-glyph pixels differ from the whole word's (a ligature such as fi, ff or fl, or a contextual
//    form). That is judged by drawing the word both ways once on a scratch canvas in the context's own font and comparing
//    the pixels, not guessed from advances: a ligature's advance can equal the sum of its letters'.
// The decision is made once per word, font and quarter-pixel phase of the word's origin on the page (cached on the font,
// stretch, letter spacing and the other shaping settings, the phase and the text), never per frame. It reads how this browser
// rasterises, so which words animate letter by letter can differ between systems.
import { WORD_IDENTITY } from './text-style.mjs';

const HALF = 2;
const CACHE_MAX = 4096; // distinct (font, word) pairs a film can hold; far above any film, a bound against a runaway
const SCRATCH_PAD = 4; // px of margin on every side of the scratch picture, over the whole word's ink
// Hebrew, Arabic, Syriac, Thaana, N'Ko, Samaritan, Mandaic and the presentation forms; the right-to-left marks and
// embeddings; Phoenician and the other right-to-left scripts of the supplementary planes.
const RTL = /[֐-ࣿ‏‫‮⁧יִ-﷿ﹰ-﻿]|[\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

// Sampled values are not clamped (an overshoot ease can leave 0..1), so opacity is clamped here.
const unit01 = (v) => Math.min(1, Math.max(0, v));
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/** The grapheme clusters of `text`. */
export const graphemesOf = (text) => Array.from(segmenter.segment(text), (s) => s.segment);

// One glyph's values with a missing or non-finite field read as the identity.
const normalise = (g) => ({
  opacity: finite(g?.opacity, WORD_IDENTITY.opacity),
  x: finite(g?.x, WORD_IDENTITY.x),
  y: finite(g?.y, WORD_IDENTITY.y),
  scale: finite(g?.scale, WORD_IDENTITY.scale),
});

// Tests only (window.__setGlyphPath, engine/page/stage.mjs): with `force`, every word is drawn through the glyph path with
// `values` for every glyph (the identity unless given). A film is JSON and reaches no page global, so this cannot be set
// from a spec. `stats` counts, while forced, the words that took the glyph path and those the check rejected
// (window.__glyphStats): a check that rejected every word would leave every pixel test green, so a test asserts the count.
const glyphPath = { force: false, values: normalise(), stats: { glyph: 0, rejected: 0 } };
export function setGlyphPath(force, values) {
  glyphPath.force = force === true;
  glyphPath.values = normalise(values);
  glyphPath.stats = { glyph: 0, rejected: 0 };
}
export const glyphStats = () => ({ ...glyphPath.stats });

/** Whether a normalised glyph is drawn untouched. */
export const isIdentityGlyph = (g) => g.opacity === 1 && g.x === 0 && g.y === 0 && g.scale === 1;

// Each glyph at its origin, with its own values, in one pass; `paint(char, x)` runs inside the glyph's transform.
function eachGlyph(ctx, { chars, origins, widths }, glyphs, left, paint) {
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
      ctx.translate(start + widths[k] / HALF + g.x, g.y);
      ctx.scale(g.scale, g.scale);
      paint(char, -widths[k] / HALF);
    }
    ctx.restore();
  });
}

/**
 * Draw a word's glyphs one by one from `left` (the word's own origin, on the baseline). `glow(char, x)`, when given, strokes a
 * glyph's halo first, for every glyph, inside the glyph's transform and opacity (the halos all lie under the letters).
 * @param {CanvasRenderingContext2D} ctx font, letter spacing and fill already set
 * @param {{ chars: string[], origins: number[], widths: number[] }} placement placementOf's
 * @param {{ opacity: number, x: number, y: number, scale: number }[]} glyphs one per grapheme
 * @param {number} left
 * @param {((char: string, x: number) => void) | null} [glow]
 */
export function drawGlyphs(ctx, placement, glyphs, left, glow = null) {
  if (glow) eachGlyph(ctx, placement, glyphs, left, glow);
  eachGlyph(ctx, placement, glyphs, left, (char, x) => ctx.fillText(char, x, 0));
}

// The canvas settings that change how a run is shaped or placed besides the font, stretch and letter spacing: copied to the
// scratch context and part of the cache key, so a setting a draw sets later cannot leave a stale verdict. Absent on a
// context that lacks one.
const SHAPING = Object.freeze(['fontKerning', 'fontVariantCaps', 'textRendering', 'wordSpacing', 'direction']);
const QUARTER = 4; // sub-pixel steps the glyph rasteriser places a glyph at
// How far one colour channel (of 255) the two draws may differ and still count as the same picture. A glyph drawn alone is
// placed at a float a hair off the whole run's (at path-rendered sizes, over about 256 px, there is no sub-pixel step to hide
// it), which moves a handful of edge pixels by a few levels (4 measured); a ligature, a kern or a mark that moves a glyph
// changes whole pixels by 100 or more.
export const SAME_PICTURE = 8;

// The two draws on a scratch canvas in the context's font, the whole word's origin `phase` px (a quarter) off the pixel
// grid as it is on the page: do they leave the same picture (SAME_PICTURE)?
function sameOnScratch(ctx, text, placement, phase, spacing) {
  const m = ctx.measureText(text);
  const ascent = Math.ceil(Math.max(0, m.actualBoundingBoxAscent));
  const descent = Math.ceil(Math.max(0, m.actualBoundingBoxDescent));
  const pad = SCRATCH_PAD + Math.ceil((ascent + descent) / HALF); // a misplaced glyph strays further than a pixel or two
  const left = pad + Math.ceil(Math.max(0, m.actualBoundingBoxLeft)) + phase;
  const width = Math.ceil(left + Math.max(m.width, m.actualBoundingBoxRight) + pad);
  const height = ascent + descent + HALF * pad;
  const c = new OffscreenCanvas(width, height).getContext('2d');
  c.font = ctx.font;
  c.fontStretch = ctx.fontStretch;
  if (spacing) c.letterSpacing = spacing;
  for (const setting of SHAPING) if (ctx[setting]) c[setting] = ctx[setting];
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.fillStyle = '#000000';
  const baseline = pad + ascent;
  c.save();
  c.translate(0, baseline); // getImageData and clearRect ignore the transform: they are called outside it
  c.fillText(text, left, 0);
  c.restore();
  const whole = c.getImageData(0, 0, width, height).data;
  c.clearRect(0, 0, width, height);
  c.save();
  c.translate(0, baseline);
  drawGlyphs(c, placement, placement.chars.map(() => normalise()), left);
  c.restore();
  const parts = c.getImageData(0, 0, width, height).data;
  return whole.length === parts.length && whole.every((v, i) => Math.abs(v - parts[i]) <= SAME_PICTURE);
}

const placements = new Map();

/**
 * Where each grapheme of `text` goes, and whether the word can be drawn glyph by glyph at all: { chars, origins, widths,
 * faithful }. `faithful` is false for a right-to-left word and for a word whose glyph-by-glyph pixels differ from the whole
 * word's (checked with the word's origin `phase` px off the pixel grid); such a word is drawn whole. Cached per font, shaping
 * settings, phase and word.
 * @param {CanvasRenderingContext2D} ctx the context with the word's font, stretch and letter spacing set
 * @param {string} text
 * @param {number} [phase] 0, 0.25, 0.5 or 0.75
 * @param {string} [spacing] the letter spacing the word is drawn with (CSS px); the context's own getter is not trusted: it reads
 *   empty on a context a text was drawn on before, though the spacing is in force
 */
export function placementOf(ctx, text, phase = 0, spacing = ctx.letterSpacing) {
  const key = [ctx.font, ctx.fontStretch, spacing, ...SHAPING.map((setting) => ctx[setting]), phase, text].join('|');
  const known = placements.get(key);
  if (known) return known;
  const chars = graphemesOf(text);
  const widths = chars.map((char) => ctx.measureText(char).width);
  const origins = chars.map((_, k) => ctx.measureText(chars.slice(0, k + 1).join('')).width - widths[k]);
  const placement = { chars, origins, widths, faithful: false };
  placement.faithful = chars.length > 0 && !RTL.test(text) && (chars.length === 1 || sameOnScratch(ctx, text, placement, phase, spacing));
  if (placements.size >= CACHE_MAX) placements.clear();
  placements.set(key, placement);
  return placement;
}

// How far the word's origin sits off the pixel grid on the page, in quarter pixels (the rasteriser's own steps).
function phaseOf(ctx, left) {
  const { a, e } = ctx.getTransform();
  const x = e + a * left;
  return (Math.round((x - Math.floor(x)) * QUARTER) % QUARTER) / QUARTER;
}

const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;

// A word drawn whole stands for its glyphs by their mean: opacity (each clamped to 0..1), x, y and scale. The word is then
// invisible while every glyph is, fades in as they arrive, and ends untouched when they all rest.
const rollupOf = (glyphs) => ({
  opacity: mean(glyphs.map((g) => unit01(g.opacity))),
  x: mean(glyphs.map((g) => g.x)),
  y: mean(glyphs.map((g) => g.y)),
  scale: mean(glyphs.map((g) => g.scale)),
});

/**
 * How a word with glyph values is drawn, or null when it is drawn whole as it stands (no glyph values, or every one is the
 * identity: the whole word keeps its ligatures and contextual forms):
 *  - { placement, glyphs, settled }: glyph by glyph (settled: every glyph at rest, which only the test seam draws this way);
 *  - { rolled: { opacity, x, y, scale } }: the glyph path cannot draw the word faithfully, so it is drawn whole with the mean
 *    of its glyph values (rollupOf), and so still arrives with its letters instead of standing on screen before them.
 * With the test seam forced, every word takes the glyph path with the seam's values (or its roll-up, when rejected).
 * @param {CanvasRenderingContext2D} ctx the context with the word's font and transform set
 * @param {{ text: string }} word
 * @param {{ glyphs?: object[] }} tracks the word's sampled tracks; `glyphs[k]` is grapheme k's { opacity, x, y, scale }
 * @param {number} left the word's origin in the current transform (draw.mjs's left)
 * @param {() => string} [spacingOf] the letter spacing the word is drawn with (see placementOf); called only when the word has
 *   glyph values
 */
export function glyphRunOf(ctx, word, tracks, left, spacingOf) {
  if (!glyphPath.force && !tracks.glyphs) return null;
  const placement = placementOf(ctx, word.text, phaseOf(ctx, left), spacingOf?.());
  const valueOf = (k) => (glyphPath.force ? glyphPath.values : normalise(tracks.glyphs[k]));
  const glyphs = placement.chars.map((_, k) => valueOf(k));
  const settled = glyphs.every(isIdentityGlyph);
  if (glyphPath.force) glyphPath.stats[placement.faithful ? 'glyph' : 'rejected'] += 1;
  if (!placement.faithful) return settled ? null : { rolled: rollupOf(glyphs) };
  return settled && !glyphPath.force ? null : { placement, glyphs, settled };
}
