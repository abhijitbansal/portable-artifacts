// Test helper: how flat is a picture inside a box? The picture is decoded by the browser that took it (a page canvas), so there is no
// image library; tests may import this file, shipped code never does.

/** Runs in the page: image bytes (base64) and boxes (CSS px) in, the largest spread of any colour channel inside each box out. */
async function spreadsInPage({ base64, mime, boxes, scale }) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }), { colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return boxes.map(([x, y, w, h]) => {
    const left = Math.max(0, Math.round(x * scale));
    const top = Math.max(0, Math.round(y * scale));
    const width = Math.min(bitmap.width - left, Math.round(w * scale));
    const height = Math.min(bitmap.height - top, Math.round(h * scale));
    if (width <= 0 || height <= 0) return null; // the box is off the picture
    const data = ctx.getImageData(left, top, width, height).data;
    const low = [255, 255, 255];
    const high = [0, 0, 0];
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c += 1) {
        if (data[i + c] < low[c]) low[c] = data[i + c];
        if (data[i + c] > high[c]) high[c] = data[i + c];
      }
    }
    return Math.max(high[0] - low[0], high[1] - low[1], high[2] - low[2]);
  });
}

/**
 * `page` is any blank page of the running browser (not one of a guarded context: it closes new pages). `boxes` are [x, y, width, height]
 * in CSS px of the picture; `scale` is its device scale factor. Returns the spread per box (null for a box off the picture).
 */
export function spreads(page, buffer, mime, boxes, scale) {
  return page.evaluate(spreadsInPage, { base64: buffer.toString('base64'), mime, boxes, scale });
}

export const FLAT_SPREAD = 8;
