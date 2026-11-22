// How far a word has arrived with its letters and its line counted: the one roll-up the draw layer and the review share.
// Pure and DOM-free (no canvas, no document), so the scene graph (graph/sample.mjs), the page (page/glyph-draw.mjs) and the
// review (review/seen.mjs) import the same functions and cannot disagree.
//
// A "glyph" is a grapheme cluster (Intl.Segmenter), never a code point: a decomposed accent or an emoji sequence is one.
//
// glyphRollup is what a word drawn whole stands for its letters by: the mean of their values. seenOf lays the word's own
// values, that mean and the word's line together in the order the draw applies them (the line's transform around the word,
// the word's own, then the mean of its letters about the word's centre).

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** One glyph, or one word's own value, untouched. */
export const GLYPH_IDENTITY = Object.freeze({ opacity: 1, x: 0, y: 0, scale: 1 });

// Sampled values are not clamped (an overshoot ease can leave 0..1), so opacity is clamped wherever it is combined.
export const unit01 = (v) => Math.min(1, Math.max(0, v));
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);

/** The grapheme clusters of `text`. */
export const graphemesOf = (text) => Array.from(segmenter.segment(text), (s) => s.segment);

/** One glyph's values with a missing or non-finite field read as the identity. */
export const normaliseGlyph = (g) => ({
  opacity: finite(g?.opacity, GLYPH_IDENTITY.opacity),
  x: finite(g?.x, GLYPH_IDENTITY.x),
  y: finite(g?.y, GLYPH_IDENTITY.y),
  scale: finite(g?.scale, GLYPH_IDENTITY.scale),
});

/**
 * The one roll-up of a word's glyph values: what a word drawn whole stands for its letters by (and what the review reads a
 * word by): the mean of the glyphs' opacity (each clamped to 0..1), x offset, y offset and scale. The word is then invisible
 * while every glyph is, fades in as they arrive, and ends untouched when they all rest.
 * @param {{ opacity: number, x: number, y: number, scale: number }[]} glyphs normalised glyph values, at least one
 * @returns {{ opacity: number, dx: number, dy: number, scale: number }}
 */
export function glyphRollup(glyphs) {
  const mean = (pick) => glyphs.reduce((sum, g) => sum + pick(g), 0) / glyphs.length;
  return { opacity: mean((g) => unit01(g.opacity)), dx: mean((g) => g.x), dy: mean((g) => g.y), scale: mean((g) => g.scale) };
}

/**
 * `glyphs` as the draw reads them for a word of `count` graphemes: one normalised entry per grapheme, a missing one at the
 * identity (a short list leaves the rest in place).
 * @param {object[] | undefined} glyphs the word's sampled glyph values
 * @param {number} count the word's grapheme count
 */
export const paddedGlyphs = (glyphs, count) => Array.from({ length: count }, (_, k) => normaliseGlyph(glyphs?.[k]));

/**
 * How far a word has arrived, as the draw puts it on screen: { opacity, scale }. The opacity is the word's own (clamped)
 * times the mean of its letters' (glyphRollup) times its line's (clamped); the scale is the word's own times the mean of its
 * letters' times its line's. Each opacity factor is clamped before the product, so an overshoot ease on one cannot make up
 * for another that has not arrived. A word is at rest only when its letters and its line are.
 * @param {{ opacity: number, scale: number }} own the word's own sampled values
 * @param {{ opacity: number, x: number, y: number, scale: number }[] | null} glyphs its letters, one per grapheme (padded), or null
 * @param {{ opacity: number, scale: number } | undefined} line its line's sampled values
 */
export function seenOf(own, glyphs, line) {
  const rolled = glyphs && glyphs.length > 0 ? glyphRollup(glyphs) : null;
  return {
    opacity: unit01(own.opacity) * (rolled ? rolled.opacity : 1) * unit01(line?.opacity ?? 1),
    scale: own.scale * (rolled ? rolled.scale : 1) * (line?.scale ?? 1),
  };
}
