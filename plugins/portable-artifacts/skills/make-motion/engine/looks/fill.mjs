// Where the review's composition rules fire (engine/review/frame.mjs): the one place the defaults, the field names a look's
// `fill` may use and what a valid value is are written, read by the look validator (looks/index.mjs) and by the review.
// Pure and DOM-free.

/**
 * The share of the safe rectangle's side left empty, and the share a hero reaches of it, at which dead-space and
 * scale-contrast fire. Calibrated on ten shipped films (91 shots), fixed overlays left out: at a band of 0.35 only the
 * look-cosmos film has more than a third of its shots flagged, and every shot that reads empty is caught; the calibration
 * outcome for the hero is the same from 0.50 to 0.55, and 0.50 clears the cluster of near misses at 51 to 54%.
 */
export const DEFAULT_FILL = Object.freeze({ band: 0.35, hero: 0.5 });

/** The fields a look's `fill` may name. */
export const FILL_KEYS = Object.freeze(Object.keys(DEFAULT_FILL));

/** Is `v` a share a rule can fire at: a finite number above 0 and at most 1? */
export const isFillShare = (v) => Number.isFinite(v) && v > 0 && v <= 1;
