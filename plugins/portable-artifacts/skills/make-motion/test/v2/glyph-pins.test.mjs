// The glyph-path pins of glyphs-browser.test.mjs are macOS measurements: exact on darwin, at least one word elsewhere, so a
// different rasteriser (Linux CI) that draws a borderline word whole does not fail the suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { requiredPlainWords, PLAIN_WORDS_BY_GLYPH, LETTER_LOOKS } from './helpers/glyph-pins.mjs';

test('on darwin every asserted look is pinned to the five plain words measured there', () => {
  for (const look of LETTER_LOOKS) assert.equal(requiredPlainWords(look, 'darwin'), 5, look);
  assert.equal(requiredPlainWords('cosmos', 'darwin'), PLAIN_WORDS_BY_GLYPH.cosmos);
});

test('on another platform a look is asserted to send at least one plain word through the glyph path', () => {
  for (const platform of ['linux', 'win32'])
    for (const look of LETTER_LOOKS) assert.equal(requiredPlainWords(look, platform), 1, `${platform} ${look}`);
});

test('the default platform is this one', () => {
  assert.equal(requiredPlainWords('cosmos'), requiredPlainWords('cosmos', process.platform));
});
