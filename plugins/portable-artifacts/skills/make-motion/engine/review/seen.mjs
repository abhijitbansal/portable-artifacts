// How the review reads a word of a text node. A word drawn letter by letter, or in a line that moves as one block, keeps its
// own sampled opacity and scale (the draw puts the first letter on screen at the word's full strength, and a line's
// transform is the line's, not the word's), so the word's own values say nothing about how much of it has arrived. The scene
// graph rolls them up (graph/sample.mjs `seen`: the word, the mean of its letters and its line, graph/rollup.mjs seenOf),
// and every review reader of a word's opacity or scale reads it through wordSeen here, so the draw and the review agree.
// A file of its own because frame.mjs is at its size limit and contrast.mjs and marks.mjs, which frame.mjs imports, read
// words too. Pure and DOM-free.

/** A word with no sampled values: untouched. */
export const WORD_IDENTITY = Object.freeze({ opacity: 1, x: 0, y: 0, scale: 1 });

/**
 * Word `index` of text node `n` as the review reads it: the node's roll-up for it (`n.seen[index]`, set only on a node with
 * glyph or line tracks) laid over the word's own values, else the word as it is (the identity for a word with no values).
 * A hole in either is null once the page's snapshot has crossed page.evaluate, and reads as absent.
 * @param {{ words?: object[], seen?: object[] }} n
 * @param {number} index
 * @returns {{ opacity: number, scale: number, x: number, y: number }} and the word's other values (fill, ghost, glow ...)
 */
export const wordSeen = (n, index) => ({ ...WORD_IDENTITY, ...n.words?.[index], ...n.seen?.[index] });

/** Does a text show any word: a text with no words at all does (it is judged whole), one whose every word is unseen does not. */
export const hasVisibleWord = (n) => { const words = seenWords(n); return words.length === 0 || words.some((w) => w.opacity > 0); };

/** Every word of `n` that has sampled values or a roll-up, in index order, each through wordSeen: [] for a text with none. */
export const seenWords = (n) => Array.from({ length: Math.max(n.words?.length ?? 0, n.seen?.length ?? 0) }, (_, i) => wordSeen(n, i));
