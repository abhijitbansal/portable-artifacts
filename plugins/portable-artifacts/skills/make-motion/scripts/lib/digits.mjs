// A 5 by 7 pixel digit font and a number plate, so the helper pictures carry numbers with no font and no browser. Each
// digit is seven rows of five `0`/`1` characters (`1` is ink).
export const DIGITS = Object.freeze({
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
});

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
export const GLYPH_GAP = 1; // blank columns between two digits
export const PLATE_PAD = 1; // plate cells around the digits, on each side

/** The pixel size { width, height } of the plate `drawNumber` draws for `value` at `scale`. */
export function plateSize(value, scale) {
  const digits = String(value).length;
  return {
    width: (digits * GLYPH_WIDTH + (digits - 1) * GLYPH_GAP + 2 * PLATE_PAD) * scale,
    height: (GLYPH_HEIGHT + 2 * PLATE_PAD) * scale,
  };
}

function fill(pixels, x0, y0, w, h, colour) {
  const { width, height, channels, data } = pixels;
  for (let y = Math.max(0, y0); y < Math.min(height, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(width, x0 + w); x++) {
      const at = (y * width + x) * channels;
      for (let c = 0; c < 3; c++) data[at + c] = colour[c];
      if (channels === 4) data[at + 3] = 255;
    }
  }
}

/**
 * Draws the whole number `value` on a `plate` colour rectangle whose top-left corner is (x, y), the digits in `ink`,
 * each font cell `scale` pixels square; what falls outside `pixels` ({ width, height, channels, data }) is clipped.
 * Returns the plate's { width, height } in pixels.
 */
export function drawNumber(pixels, { x, y, value, scale, ink, plate }) {
  const size = plateSize(value, scale);
  fill(pixels, x, y, size.width, size.height, plate);
  [...String(value)].forEach((digit, index) => {
    const left = x + (PLATE_PAD + index * (GLYPH_WIDTH + GLYPH_GAP)) * scale;
    DIGITS[digit].forEach((row, r) => {
      [...row].forEach((cell, c) => {
        if (cell === '1') fill(pixels, left + c * scale, y + (PLATE_PAD + r) * scale, scale, scale, ink);
      });
    });
  });
  return size;
}
