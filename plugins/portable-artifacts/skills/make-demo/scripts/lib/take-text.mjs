// The smallest text a step's box shows, in CSS px, for take.json's `textPx` (make-motion compares it with what a film makes of it).
//   smallestText(page, box)  box is { x, y, width, height } in viewport px, or null  ->  a number rounded to 0.5 (above 0, at most
//   4096: the range make-motion's take reader accepts), or null
// Visible text nodes and filled fields whose rects cross the box, in the main frame only: text in a canvas, an image or another origin's
// frame is not measured. One `evaluate` and no clock step, so it costs no film time. It returns a number, never the text.
const ROUND_TO = 2; // halves
const TEXT_PX_MAX = 4096; // make-motion scripts/v2/take.mjs TEXT_PX_MAX

/** Runs in the page, so it can use nothing outside itself. */
function measure(box) {
  const skippedTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TITLE'];
  const textlessInputs = ['hidden', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'button', 'submit', 'reset'];
  const crosses = (r) => r.width > 0 && r.height > 0 && r.right > box.x && r.left < box.x + box.width && r.bottom > box.y && r.top < box.y + box.height;
  const sizes = [];
  const note = (el) => {
    const style = getComputedStyle(el);
    if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) return;
    sizes.push(Number.parseFloat(style.fontSize));
  };
  const walker = document.createTreeWalker(document.body ?? document, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || skippedTags.includes(el.tagName) || node.data.trim() === '') continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    if ([...range.getClientRects()].some(crosses)) note(el);
  }
  for (const field of document.querySelectorAll('input, textarea, select')) {
    if (field.tagName === 'INPUT' && textlessInputs.includes(field.type)) continue;
    const filled = field.tagName === 'SELECT' || field.value !== '' || field.placeholder !== '';
    if (filled && crosses(field.getBoundingClientRect())) note(field);
  }
  const real = sizes.filter((n) => Number.isFinite(n) && n > 0);
  return real.length === 0 ? null : Math.min(...real);
}

export async function smallestText(page, box) {
  if (box === null || box === undefined) return null;
  const smallest = await page.evaluate(measure, box);
  if (smallest === null) return null;
  const rounded = Math.round(smallest * ROUND_TO) / ROUND_TO;
  return rounded > 0 && rounded <= TEXT_PX_MAX ? rounded : null; // a size make-motion's take reader refuses would lose the whole take
}
