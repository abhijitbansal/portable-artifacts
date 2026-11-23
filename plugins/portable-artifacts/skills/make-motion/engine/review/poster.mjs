// The poster read: does the poster's biggest line still read when the poster is a thumbnail? A feed shows a film's poster
// about 180 px on its short side; a line under about 14 px tall there is a smudge. The check is computed from the layout
// the page reports for the poster frame (the sizes engine/review/inspect-nodes.mjs lists), not from pixels, so it is pure
// and DOM-free. It judges the largest text that is neither a spoken caption (props.caption) nor frame furniture
// (props.furniture: a slug, a kicker, an affix); a frame with no such text is a picture poster and is not judged. The
// finding is creative: a poster is a choice of frame, so the report's exit code stays as it was.
import { REFERENCE_SIDE } from '../units.mjs';
import { inspectNodes } from './inspect-nodes.mjs';
import { minSizeSuggest } from './suggest.mjs';

export const POSTER_THUMB_SHORT_SIDE = 180; // pixels
export const POSTER_MIN_TEXT_PX = 14;
/** The size a thumbnail line needs, in units (a unit is the short side over 1080, engine/units.mjs): 14 px on 180 px is 84. */
export const POSTER_MIN_UNITS = (POSTER_MIN_TEXT_PX * REFERENCE_SIDE) / POSTER_THUMB_SHORT_SIDE;

// A line still sliding in from off the frame, or fading in below this opacity, is not what a thumbnail shows as the poster's
// line (the review has no such floor: it counts any text above 0). Our number, unmeasured.
const POSTER_MIN_OPACITY = 0.5;
const PX_DECIMALS = 1;
const pxOf = (units) => Number(((units * POSTER_THUMB_SHORT_SIDE) / REFERENCE_SIDE).toFixed(PX_DECIMALS));

// The ids of the texts that are not the poster's own: a spoken caption or frame furniture, found by walking the tree
// (inspectNodes lists sizes, not props).
function setAsideIds(sampled) {
  const ids = new Set();
  const walk = (n) => {
    if (n.type === 'text' && (n.props?.caption || n.props?.furniture === true)) ids.add(n.id);
    (n.children ?? []).forEach(walk);
  };
  (Array.isArray(sampled) ? sampled : []).forEach(walk);
  return ids;
}

/**
 * The poster-read finding for one poster frame, as a list of none or one: of the texts that show on the frame (wholly on it,
 * at an opacity of 0.5 or more), the largest
 * by height in units; under POSTER_MIN_UNITS it is `{ kind: 'creative', rule: 'poster-read', node, path, message,
 * suggest: { minSize, factor } }`. `path` is the frame's shot, `shots[i]`.
 * @param {object[]} sampled the tree the page's __snapshot(i) returns for the poster frame
 * @param {object} ctx as for inspectNodes (scripts/v2/review.mjs frameContext)
 */
export function posterReadFindings(sampled, ctx) {
  const aside = setAsideIds(sampled);
  const texts = inspectNodes(sampled, ctx).filter((n) => n.text !== undefined && !aside.has(n.id) && !n.offFrame && n.opacity >= POSTER_MIN_OPACITY);
  if (texts.length === 0) return [];
  const largest = texts.reduce((best, n) => (n.text.sizeUnits > best.text.sizeUnits ? n : best));
  if (largest.text.sizeUnits >= POSTER_MIN_UNITS) return [];
  return [{
    kind: 'creative', rule: 'poster-read', node: largest.id, path: `shots[${ctx.shotIndex}]`,
    message: `the largest text on the poster is ${pxOf(largest.text.sizeUnits)} px tall on a ${POSTER_THUMB_SHORT_SIDE} px thumbnail; it needs ${POSTER_MIN_TEXT_PX} px (${POSTER_MIN_UNITS} units), so pick a frame with a bigger line or enlarge "${largest.id}"`,
    suggest: minSizeSuggest(POSTER_MIN_UNITS, largest.text.sizeUnits),
  }];
}
