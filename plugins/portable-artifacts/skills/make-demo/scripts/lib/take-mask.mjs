// What must not be filmed, hidden in the page itself before each picture: one layer of opaque boxes that takes no pointer and no film time.
//   coverPage(page, { mask, signedIn })  -> { covered }   draw the boxes in every frame; covered is how many
//   uncoverPage(page)                                     take the layer away again (the page is as it was)
// Always covered: each `mask` target (demo.json), `{ css }` or `{ role, name }`, every element it matches.
// Signed in also covered: every password field, every field (and selected option) whose text maskText would change, and every text range
// maskText would change (an email, a long number, a key), in the page, in open shadow roots and in every frame. A match that a markup
// split in two (`<b>name</b>@host.test`) is covered in whole, node by node. The ranges come from `maskRanges` (mask.mjs): the patterns
// of maskText are passed into the page, never copied, so the page and the printed text cannot disagree.
// Where it cannot help: text a stylesheet makes (`content: attr(...)`), text inside an image, a canvas or a video, a name or any other
// word no pattern knows (that is what `mask` is for), and a closed shadow root.
//
// How it is drawn: absolutely positioned boxes at page coordinates in one layer on the document element, so a full-page picture (scout)
// and a viewport picture (a take frame) both line up. The layer sits in the top layer (a manual popover) so an open modal dialog does not
// paint above it. Styles are set through CSSOM, never an attribute, so a page with a strict style-src still shows them. The layer is the
// only thing added, and it is held on `window.__makeDemoCover` so uncoverPage removes exactly it.
import { maskRanges, MASK_PATTERNS } from './mask.mjs';

export const COVER_COLOR = '#2b2b2b';
const PAD = 2; // CSS px the box reaches past what it hides (glyphs overhang, and a picture is cut into blocks)

const hasRole = (target) => target.role !== undefined;

// ---- runs in a page ------------------------------------------------------------------------------------------------------------
// Each function below is sent to the page as source text (`coverExpression`), so each names only its arguments, the browser's own
// globals and the other functions of IN_PAGE.

/** Page-coordinate boxes [x, y, w, h] of anything with client rects (an element, a Range). */
function boxesOfElements(things) {
  return things.flatMap((el) => [...el.getClientRects()].filter((r) => r.width > 0 && r.height > 0).map((r) => [r.left + window.scrollX, r.top + window.scrollY, r.width, r.height]));
}

/** The document and every open shadow root in it. */
function pageRoots() {
  const roots = [document];
  for (let i = 0; i < roots.length; i += 1) for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
  return roots;
}

/** A Range over one text node's [from, to), or over the whole contents of `node` when `to` is left out. */
function rangeOf(node, from, to) {
  const range = document.createRange();
  if (to === undefined) range.selectNodeContents(node);
  else { range.setStart(node, from); range.setEnd(node, to); }
  return range;
}

/** The boxes of every element a css selector of the mask matches. A selector the browser refuses matches nothing. */
function cssBoxes(selectors) {
  const found = [];
  for (const selector of selectors) {
    for (const root of pageRoots()) {
      try { found.push(...root.querySelectorAll(selector)); } catch { /* refused: nothing */ }
    }
  }
  return boxesOfElements(found);
}

/** The boxes of every password field and every field (or selected option) whose text maskText would change. */
function fieldBoxes(patterns) {
  const found = [];
  for (const root of pageRoots()) {
    for (const field of root.querySelectorAll('input, textarea, select')) {
      const shown = field.tagName === 'SELECT' ? [...field.selectedOptions].map((o) => o.textContent).join(' ') : `${field.value} ${field.placeholder ?? ''}`;
      if (field.type === 'password' || maskRanges(shown, patterns).length > 0) found.push(field);
    }
  }
  return boxesOfElements(found);
}

/** Tags whose text is never drawn as text. */
function isSkippedTag(tag) {
  return ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TITLE', 'HEAD'].includes(tag);
}

/** Long enough for a pattern to match (the shortest is "a@b.cc"), and short enough to scan (a whole page of text is not). */
function isScannable(text) {
  return text.length >= 6 && text.length <= 100000;
}

/** The boxes of every text range, inside one text node, that maskText would change. */
function textBoxes(patterns) {
  const found = [];
  for (const root of pageRoots()) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (isSkippedTag(node.parentElement?.tagName) || !isScannable(node.data)) continue;
      for (const [from, to] of maskRanges(node.data, patterns)) found.push(rangeOf(node, from, to));
    }
  }
  return boxesOfElements(found);
}

/** A match that no single child of an element holds (a tag cut it): every child it touches, whole. */
function splitBoxes(patterns) {
  const found = [];
  for (const root of pageRoots()) {
    for (const el of root.querySelectorAll('*')) {
      const children = [...el.childNodes].filter((c) => c.nodeType === 1 || c.nodeType === 3);
      const text = isSkippedTag(el.tagName) ? '' : el.textContent;
      if (children.length < 2 || !isScannable(text)) continue;
      let offset = 0;
      const spans = children.map((child) => ({ child, start: offset, end: (offset += child.textContent.length) }));
      for (const [from, to] of maskRanges(text, patterns)) {
        if (spans.some((s) => from >= s.start && to <= s.end)) continue;
        for (const s of spans) if (s.start < to && s.end > from) found.push(rangeOf(s.child));
      }
    }
  }
  return boxesOfElements(found);
}

/** Draw one box per distinct rectangle in one layer on the document element; replaces a layer drawn before. Returns the box count. */
function drawLayer(boxes, color, pad) {
  const seen = new Set();
  const unique = boxes.filter((box) => { const key = box.map(Math.round).join(','); const fresh = !seen.has(key); seen.add(key); return fresh; });
  const style = (el, props) => { for (const [name, value] of Object.entries(props)) el.style.setProperty(name, value, 'important'); };
  window.__makeDemoCover?.remove();
  const layer = document.createElement('div');
  style(layer, { position: 'absolute', left: '0', top: '0', right: 'auto', bottom: 'auto', width: '0', height: '0', margin: '0', padding: '0', border: '0', overflow: 'visible', background: 'none', 'pointer-events': 'none', 'z-index': '2147483647', transform: 'none', filter: 'none', opacity: '1' });
  for (const [x, y, w, h] of unique) {
    const box = document.createElement('div');
    style(box, { position: 'absolute', left: `${x - pad}px`, top: `${y - pad}px`, width: `${w + 2 * pad}px`, height: `${h + 2 * pad}px`, margin: '0', padding: '0', border: '0', background: color, opacity: '1', 'pointer-events': 'none', transform: 'none', filter: 'none' });
    layer.append(box);
  }
  document.documentElement.append(layer);
  try { layer.popover = 'manual'; layer.showPopover(); } catch { /* a browser without popovers: the layer still sits at the top of the page */ }
  window.__makeDemoCover = layer;
  return unique.length;
}

/** The whole cover of one frame. `extra` are boxes the node side already found (role targets). */
function coverInPage({ css, extra, signedIn, patterns, color, pad }) {
  const boxes = [...extra, ...cssBoxes(css)];
  if (signedIn) boxes.push(...fieldBoxes(patterns), ...textBoxes(patterns), ...splitBoxes(patterns));
  return drawLayer(boxes, color, pad);
}

/** Take the layer away. */
function uncoverInPage() {
  window.__makeDemoCover?.remove();
  delete window.__makeDemoCover;
}

const IN_PAGE = [maskRanges, boxesOfElements, pageRoots, rangeOf, cssBoxes, fieldBoxes, isSkippedTag, isScannable, textBoxes, splitBoxes, drawLayer, coverInPage];

/** An expression that defines IN_PAGE (a page cannot import) and runs the cover of one frame with `arg`. */
const coverExpression = (arg) => `(() => {\n${IN_PAGE.map((fn) => `const ${fn.name} = ${fn.toString()};`).join('\n')}\nreturn coverInPage(${JSON.stringify(arg)});\n})()`;

// ---- runs here -------------------------------------------------------------------------------------------------------------------

/** The boxes of the elements `{ role, name }` targets find in one frame (a css target is found inside the page, by its selector). */
async function roleBoxes(frame, targets) {
  const boxes = [];
  for (const target of targets.filter(hasRole)) {
    boxes.push(...await frame.getByRole(target.role, { name: target.name, exact: true }).evaluateAll(boxesOfElements));
  }
  return boxes;
}

/** Cover one frame. A frame that is gone by now is nothing to cover; any other failure is the caller's. */
async function coverFrame(frame, { mask, signedIn }) {
  try {
    const extra = await roleBoxes(frame, mask);
    const css = mask.filter((target) => !hasRole(target)).map((target) => target.css);
    return await frame.evaluate(coverExpression({ css, extra, signedIn, patterns: MASK_PATTERNS, color: COVER_COLOR, pad: PAD }));
  } catch (error) {
    if (frame.isDetached()) return 0;
    throw error;
  }
}

/** Draw the boxes in the page and every frame of it. `mask` is the targets of demo.json (default none). Returns { covered }, the boxes drawn. */
export async function coverPage(page, { mask = [], signedIn }) {
  let covered = 0;
  for (const frame of page.frames()) covered += await coverFrame(frame, { mask, signedIn });
  return { covered };
}

/** Remove the layer from the page and every frame. A frame that cannot answer has nothing of ours that outlives it. */
export async function uncoverPage(page) {
  for (const frame of page.frames()) await frame.evaluate(`(${uncoverInPage.toString()})()`).catch(() => {});
}
