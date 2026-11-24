// PNG to RGB pixels, decoded by the browser that took the screenshot: no PNG library, and no import from another skill.

/** Runs in the page: PNG bytes (base64) in, packed RGB bytes (base64) and the size out. */
async function decodeInPage(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
  const rgb = new Uint8Array(bitmap.width * bitmap.height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2]; }
  let binary = '';
  for (let i = 0; i < rgb.length; i += 0x8000) binary += String.fromCharCode(...rgb.subarray(i, i + 0x8000));
  return { width: bitmap.width, height: bitmap.height, base64: btoa(binary) };
}

/** `page` is any blank page of the running browser. Returns { width, height, channels: 3, data } for the PNG `buffer`. */
export async function decodePng(page, buffer) {
  const { width, height, base64 } = await page.evaluate(decodeInPage, buffer.toString('base64'));
  const data = Buffer.from(base64, 'base64');
  if (data.length !== width * height * 3) throw new Error(`decoded ${data.length} bytes for a ${width}x${height} picture`);
  return { width, height, channels: 3, data };
}
