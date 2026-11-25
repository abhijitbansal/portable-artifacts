// The picture of a signed-out page: one JPEG, the full page cut at MAX_HEIGHT px, quality lowered until it is under MAX_BYTES
// (make-explainer takes 1.5 MB). A page that stays over at the lowest quality gives that picture anyway.

export const MAX_HEIGHT = 4000;
export const MAX_BYTES = 1.4 * 1024 * 1024;
export const QUALITIES = [70, 55, 40, 25, 10];

export async function takeShot(page, viewport) {
  const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0));
  const clip = { x: 0, y: 0, width: viewport.width, height: Math.min(Math.max(height, viewport.height), MAX_HEIGHT) };
  let picture = null;
  for (const quality of QUALITIES) {
    picture = await page.screenshot({ type: 'jpeg', quality, clip, fullPage: true });
    if (picture.length < MAX_BYTES) break;
  }
  return picture;
}
