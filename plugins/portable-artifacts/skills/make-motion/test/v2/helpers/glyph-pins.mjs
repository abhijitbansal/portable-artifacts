// The looks glyphs-browser.test.mjs asserts, and how many plain words each must send through the glyph path.
//
// The looks: every look measured equal on every word set (a word the glyph path cannot draw faithfully is drawn whole, so a
// look's face cannot break it), and sending at least one word of the plain set through the glyph path, so a check that
// rejected every word cannot pass. marker is not in it: its script face has contextual forms, so the check sends most of its
// words to the whole-word draw (measured: 3 of 5 plain words, 5 of 5 ligature words), and a letters entrance would run some
// words letter by letter and the rest as one block; Task 4 gives marker `letters: null`. It stays in the table, reported.
export const LETTER_LOOKS = Object.freeze(['desk', 'pop', 'cosmos', 'ledger', 'poster', 'keynote']);

// DISTINCT words of the plain set (5: Typography, AVATAR, fjord, L'été, 10,000) each look sends through the glyph path, as
// measured on macOS: all five in every asserted look. A check that wrongly rejects some words fails here, not only one that
// rejects all.
export const PLAIN_WORDS_BY_GLYPH = Object.freeze({ desk: 5, pop: 5, cosmos: 5, ledger: 5, poster: 5, keynote: 5 });

// The exact pins are macOS measurements. Another platform rasterises text differently, so there the check may send some words
// whole (a valid result), and a look is asserted to send at least one plain word through the glyph path. The test prints the
// counts on every platform.
export const requiredPlainWords = (look, platform = process.platform) => (platform === 'darwin' ? PLAIN_WORDS_BY_GLYPH[look] : 1);
