// The node listing of --inspect (scripts/v2/inspect.mjs): every node that shows on one frame, as plain numbers a reader can
// check against the PNG. It measures with the frame review's own measure (engine/review/frame.mjs), so a text's height, ink
// and safe-area verdict here are the numbers the review rules judge. Pure and DOM-free; it never throws: a text that
// cannot be measured is listed without its `text` report. frame.mjs re-exports inspectNodes.
import { unitOf } from '../units.mjs';
import { INK_OUTSET_EM, SAFE_TOLERANCE_UNITS, hasVisibleWord, hasWords, isBox, measured, outsideSafe, scaleOf } from './frame.mjs';

const DECIMALS = 1;
const OPACITY_DECIMALS = 3;
const round = (n, decimals = DECIMALS) => Number(n.toFixed(decimals));
const roundBox = (box) => box.map((n) => round(n));
// The box is wholly inside the canvas (a box with nothing to measure is not off it).
const isInside = ([x, y, w, h], canvas) => x >= 0 && y >= 0 && x + w <= canvas.w && y + h <= canvas.h;

// What a text node reports: its height as a viewer reads it (the smallest word on screen too), its ink box, whether it
// has landed (every word on screen at rest, the text fully opaque; whether a camera move has settled is not judged on one
// frame) and whether its ink leaves the safe rectangle, by the margin the safe-area rule allows. Null when it cannot be
// measured.
function textReport(n, opacity, scale, unit, ctx) {
  if (n.type !== 'text' || !hasWords(n.layout) || !hasVisibleWord(n)) return null;
  const found = measured(n, opacity, scale, unit, ctx);
  if (found === null) return null;
  const slack = (SAFE_TOLERANCE_UNITS + INK_OUTSET_EM * found.size) * unit;
  return { sizeUnits: round(found.size), smallestUnits: round(found.smallest), ink: roundBox(found.ink), landed: found.landed, outsideSafe: outsideSafe(found.ink, ctx.safe, slack) };
}

/**
 * Every node on the frame with an accumulated opacity above 0 (a node at 0 takes its children out with it), parent before
 * child, as { id, type, role?, bbox: [x, y, w, h], opacity, offFrame, text? }. bbox is in canvas pixels, opacity is the
 * node's own times its groups', `offFrame` says the box is not wholly inside the canvas, and a text carries
 * `text: { sizeUnits, smallestUnits, ink, landed, outsideSafe }` (sizes in units, engine/units.mjs, to one decimal).
 * @param {object[]} sampled the tree the page's __snapshot(i) returns
 * @param {{ canvas: { w: number, h: number }, safe: { left: number, top: number, right: number, bottom: number } }} ctx as for
 *   auditFrame (scripts/v2/review.mjs frameContext)
 */
export function inspectNodes(sampled, ctx) {
  const unit = unitOf(ctx.canvas);
  const found = [];
  const walk = (n, inherited, inheritedScale) => {
    const opacity = inherited * (n.opacity ?? 1);
    if (opacity <= 0) return;
    const scale = inheritedScale * scaleOf(n);
    const box = isBox(n.bbox) ? n.bbox : null;
    const text = textReport(n, opacity, scale, unit, ctx);
    found.push({
      id: n.id, type: n.type, ...(n.props?.role === undefined ? {} : { role: n.props.role }),
      bbox: box === null ? null : roundBox(box), opacity: round(opacity, OPACITY_DECIMALS), offFrame: box !== null && !isInside(box, ctx.canvas),
      ...(text === null ? {} : { text }),
    });
    (n.children ?? []).forEach((child) => walk(child, opacity, scale));
  };
  (Array.isArray(sampled) ? sampled : []).forEach((n) => walk(n, 1, 1));
  return found;
}
