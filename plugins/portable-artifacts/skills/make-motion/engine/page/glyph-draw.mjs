// A word drawn glyph by glyph (a letter-by-letter entrance), placed so that at rest it is the word drawn whole.
// A "glyph" here is a grapheme cluster (Intl.Segmenter), never a code point: a decomposed accent or an emoji sequence is one.
//
// Glyph k starts at the word's origin plus the advance the whole word gives it: the width of the first k + 1 graphemes less
// the width of grapheme k alone (a kern pair's adjustment sits on the first glyph's advance, so the prefix of k graphemes
// alone would miss it). Measured with the font, stretch and letter spacing already on the context.
//
// A word the glyph path cannot draw faithfully is drawn whole, so it falls back to the word's own entrance:
//  - a word with a right-to-left character (glyph 0 would go leftmost, and the joining forms would be lost);
//  - a word whose glyph-by-glyph pixels differ from the whole word's (a ligature such as fi, ff or fl, or a contextual
//    form). That is judged by drawing the word both ways once on a scratch canvas in the context's own font and comparing
//    the pixels, not guessed from advances: a ligature's advance can equal the sum of its letters'.
// The decision is made once per word and font (cached on the font, stretch, letter spacing and text), never per frame.
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

// Tests only (window.__setGlyphPath, engine/page/stage.mjs): with `force`, every word is drawn through drawGlyphs with
// identity values. A film is JSON and reaches no page global, so this cannot be set from a spec.
const glyphPath = { force: false };
export const setGlyphPath = (force) => { glyphPath.force = force === true; };

/** The grapheme clusters of `text`. */
export const graphemesOf = (text) => Array.from(segmenter.segment(text), (s) => s.segment);

// One glyph's values with a missing or non-finite field read as the identity.
const normalise = (g) => ({
  opacity: finite(g?.opacity, WORD_IDENTITY.opacity),
  x: finite(g?.x, WORD_IDENTITY.x),
  y: finite(g?.y, WORD_IDENTITY.y),
  scale: finite(g?.scale, WORD_IDENTITY.scale),
});

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

// The two draws on a scratch canvas in the context's font: do they leave the same pixels?
function sameOnScratch(ctx, text, placement) {
  const m = ctx.measureText(text);
  const ascent = Math.ceil(Math.max(0, m.actualBoundingBoxAscent));
  const descent = Math.ceil(Math.max(0, m.actualBoundingBoxDescent));
  const pad = SCRATCH_PAD + Math.ceil((ascent + descent) / HALF); // a misplaced glyph strays further than a pixel or two
  const left = pad + Math.ceil(Math.max(0, m.actualBoundingBoxLeft));
  const width = left + Math.ceil(Math.max(m.width, m.actualBoundingBoxRight)) + pad;
  const height = ascent + descent + HALF * pad;
  const c = new OffscreenCanvas(width, height).getContext('2d');
  c.font = ctx.font;
  c.fontStretch = ctx.fontStretch;
  c.letterSpacing = ctx.letterSpacing;
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
  return whole.length === parts.length && whole.every((v, i) => v === parts[i]);
}

const placements = new Map();

/**
 * Where each grapheme of `text` goes, and whether the word can be drawn glyph by glyph at all: { chars, origins, widths,
 * faithful }. `faithful` is false for a right-to-left word and for a word whose glyph-by-glyph pixels differ from the whole
 * word's; such a word is drawn whole. Cached per font and word.
 * @param {CanvasRenderingContext2D} ctx the context with the word's font, stretch and letter spacing set
 */
export function placementOf(ctx, text) {
  const key = `${ctx.font}|${ctx.fontStretch}|${ctx.letterSpacing}|${text}`;
  const known = placements.get(key);
  if (known) return known;
  const chars = graphemesOf(text);
  const widths = chars.map((char) => ctx.measureText(char).width);
  const origins = chars.map((_, k) => ctx.measureText(chars.slice(0, k + 1).join('')).width - widths[k]);
  const placement = { chars, origins, widths, faithful: false };
  placement.faithful = chars.length > 0 && !RTL.test(text) && (chars.length === 1 || sameOnScratch(ctx, text, placement));
  if (placements.size >= CACHE_MAX) placements.clear();
  placements.set(key, placement);
  return placement;
}

/**
 * The glyph run for a word, or null when it is drawn whole: it has no glyph values, every value is the identity (the whole
 * word keeps its ligatures and contextual forms), or the glyph path cannot draw it faithfully. With the test seam forced, a
 * word that can be drawn glyph by glyph is drawn so with identity values.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ text: string }} word
 * @param {{ glyphs?: object[] }} tracks the word's sampled tracks; `glyphs[k]` is grapheme k's { opacity, x, y, scale }
 * @returns {{ placement: object, glyphs: object[], settled: boolean } | null}
 */
export function glyphRunOf(ctx, word, tracks) {
  const given = glyphPath.force ? [] : tracks.glyphs;
  if (!given) return null;
  const placement = placementOf(ctx, word.text);
  if (!placement.faithful) return null;
  const glyphs = placement.chars.map((_, k) => normalise(given[k]));
  const settled = glyphs.every(isIdentityGlyph);
  return settled && !glyphPath.force ? null : { placement, glyphs, settled };
}
