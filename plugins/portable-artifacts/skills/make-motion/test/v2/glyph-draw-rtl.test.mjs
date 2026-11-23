// Characterisation of the right-to-left detector in engine/page/glyph-draw.mjs (the RTL regex). The source must not hold
// bidi control characters as literals (the Trojan Source pattern), so the class is written with escapes; this test pins
// the exact code-point set it matches, so the rewrite from literals to escapes cannot change behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('../../engine/page/glyph-draw.mjs', import.meta.url));

// The inclusive code-point ranges the detector matches, as measured on the literal-character form of the class.
const RANGES = [
  [0x0590, 0x08ff], // Hebrew, Arabic, Syriac, Thaana, N'Ko, Samaritan, Mandaic, Arabic extended
  [0x200f, 0x200f], // RIGHT-TO-LEFT MARK
  [0x202b, 0x202b], // RIGHT-TO-LEFT EMBEDDING
  [0x202e, 0x202e], // RIGHT-TO-LEFT OVERRIDE
  [0x2067, 0x2067], // RIGHT-TO-LEFT ISOLATE
  [0xfb1d, 0xfdff], // Hebrew and Arabic presentation forms A
  [0xfe70, 0xfeff], // Arabic presentation forms B, up to and including U+FEFF
  [0x10800, 0x10fff], // Phoenician and the other right-to-left scripts of the supplementary planes
  [0x1e800, 0x1efff],
];

function loadRtl() {
  const line = fs.readFileSync(SOURCE, 'utf8').split('\n').find((l) => l.startsWith('const RTL = '));
  assert.ok(line, 'glyph-draw.mjs defines const RTL');
  const m = line.match(/^const RTL = \/(.*)\/u;/);
  assert.ok(m, 'RTL is a single /u regex literal');
  return new RegExp(m[1], 'u');
}

const inRanges = (c) => RANGES.some(([lo, hi]) => c >= lo && c <= hi);
const test1 = (re, c) => re.test(String.fromCodePoint(c));

test('RTL class matches exactly the characterised code-point set', () => {
  const re = loadRtl();
  const probes = new Set();
  for (const [lo, hi] of RANGES) for (const c of [lo - 1, lo, lo + 1, hi - 1, hi, hi + 1]) probes.add(c);
  for (let c = 0; c <= 0x10ffff; c += 0x61) probes.add(c);
  for (const c of probes) {
    if (c < 0 || c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) continue; // a lone surrogate is not a character
    assert.equal(test1(re, c), inRanges(c), `U+${c.toString(16).toUpperCase().padStart(4, '0')}`);
  }
});

test('RTL class agrees with the range set across the whole code-point space', () => {
  const re = loadRtl();
  for (let c = 0; c <= 0x10ffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    if (test1(re, c) !== inRanges(c)) assert.fail(`U+${c.toString(16).toUpperCase().padStart(4, '0')} differs`);
  }
});

test('glyph-draw.mjs holds no literal invisible or bidi characters', () => {
  const src = fs.readFileSync(SOURCE, 'utf8');
  assert.equal(/[\p{Cf}\p{Zl}\p{Zp}]/u.test(src), false);
});
