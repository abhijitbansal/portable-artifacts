// Untrusted text (a commit subject, a CSV cell, a file name) made safe to read where an agent reads it.
// It escapes and never deletes: every character a person cannot see, or that reorders or hides text from a person but
// not from a model, is written out as a code point, so nothing can ride along unseen and nothing is lost.
//   Cc control, Cf format (zero-width, bidi controls, the byte order mark, Unicode Tag characters U+E0000-E007F),
//   Co private use, Cn unassigned, Cs lone surrogate, Zl and Zp (U+2028, U+2029) and every variation selector.
// Letters, digits, punctuation, spaces and emoji stay as they are. A ZWJ emoji or a tag-sequence flag therefore
// prints with its joiner or tag characters shown as code points; that is deliberate.
// Two forms:
//   agentText, agentJson, agentRow: text for stdout and stderr, code points as \u{xxxx}. Never use these on data that is
//     written into a page or a file.
//   escapeJsonInvisible: JSON text (stdout or a facts file) with the same characters as legal JSON escapes, so a reader
//     sees them and JSON.parse still returns the exact original string.
// The source holds escapes only, never a literal invisible character.

export const DEFAULT_MAX = 200;

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}\p{Variation_Selector}]/u;
const INVISIBLE_ALL = new RegExp(INVISIBLE.source, 'gu');
const MIN_HEX_DIGITS = 4;
const BMP = 0xFFFF;
const SURROGATE_OFFSET = 0x10000;
const HIGH_SURROGATE_BASE = 0xD800;
const LOW_SURROGATE_BASE = 0xDC00;
const SURROGATE_SHIFT = 10;
const LOW_TEN_BITS = 0x3FF;

const hex4 = (code) => code.toString(16).padStart(MIN_HEX_DIGITS, '0');
const codePoint = (char) => `\\u{${hex4(char.codePointAt(0))}}`;
const dropped = (count) => `\u{2026}[${count} more characters]`;

/**
 * `text` with invisible characters written as \u{xxxx}, cut after `max` printed characters (an escape counts as one and is
 * never split) with an ellipsis that says how many were dropped: `[N more characters]`. `max: Infinity` never cuts.
 */
export function agentText(text, { max = DEFAULT_MAX } = {}) {
  const parts = [...String(text)].map((char) => (INVISIBLE.test(char) ? codePoint(char) : char));
  if (parts.length <= max) return parts.join('');
  return `${parts.slice(0, max).join('')}${dropped(parts.length - max)}`;
}

/** Only the cut: `text` limited to `max` code points with the same ellipsis marker; nothing is escaped. */
export function capText(text, { max = DEFAULT_MAX } = {}) {
  const chars = [...String(text)];
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max).join('')}${dropped(chars.length - max)}`;
}

/** `value` as JSON text, escaped once (a code point is `\u{xxxx}`, never doubled) and capped. undefined prints as null. */
export const agentJson = (value, options) => agentText(JSON.stringify(value) ?? 'null', options);

/** A row as one JSON object whose keys and cells are each escaped and capped on their own, so one long cell cannot push the rest out. */
export function agentRow(row, options) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return Array.isArray(row) ? `[${row.map((cell) => agentJson(cell, options)).join(',')}]` : agentJson(row, options);
  }
  return `{${Object.entries(row).map(([key, cell]) => `${agentJson(key, options)}:${agentJson(cell, options)}`).join(',')}}`;
}

/**
 * JSON text from JSON.stringify with every invisible character written as a JSON escape (backslash, u, four hex digits;
 * a surrogate pair for a character above U+FFFF). The newline of pretty-printed JSON stays: JSON.stringify already
 * escapes every control character inside a string, so a raw newline is only layout.
 */
export function escapeJsonInvisible(jsonText) {
  return jsonText.replace(INVISIBLE_ALL, (char) => {
    if (char === '\n') return char;
    const code = char.codePointAt(0);
    if (code <= BMP) return `\\u${hex4(code)}`;
    const offset = code - SURROGATE_OFFSET;
    const high = HIGH_SURROGATE_BASE + (offset >> SURROGATE_SHIFT);
    const low = LOW_SURROGATE_BASE + (offset & LOW_TEN_BITS);
    return `\\u${hex4(high)}\\u${hex4(low)}`;
  });
}
