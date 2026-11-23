// The fix value a frame finding carries as `suggest` (engine/review/rules.mjs SUGGEST_KEYS), for the rules whose value
// is not a colour (contrast.mjs builds that one). Pure.

const FACTOR_DECIMALS = 100;
const ROUNDING_SLACK = 1e-9; // a ratio that is exact in decimal (28 / 20 = 1.4) must not round up a step on float error

/**
 * The size floor and the factor that reaches it: { minSize, factor }, `factor` = floor / smallest rounded up to 2
 * decimals, so scaling the text by it never leaves it under the floor. A word with no size (0 units, or none that can be
 * read) has no factor that reaches the floor: { minSize } alone, so the report never carries an infinite number (JSON
 * writes it as null).
 * @param {number} floor units @param {number} smallest the text's smallest word, in units
 */
export function minSizeSuggest(floor, smallest) {
  const factor = Math.ceil((floor / smallest) * FACTOR_DECIMALS - ROUNDING_SLACK) / FACTOR_DECIMALS;
  return Number.isFinite(factor) && factor > 0 ? { minSize: floor, factor } : { minSize: floor };
}
