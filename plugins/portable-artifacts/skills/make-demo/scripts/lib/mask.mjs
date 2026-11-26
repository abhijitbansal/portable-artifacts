// Masks what must not reach a printed line, scout.json or a plan page: emails, long numbers, keys and path ids. Pure.

const EMAIL = /[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[A-Za-z]{2,}/g;
// A run of digits with separators (space, no-break space, . - en and em dash, ( ) and a leading +) that holds at least this many digits.
const NUMBER_RUN = /\+?\(?\d[\d  ().‐-―-]*\d/g;
const NUMBER_DIGITS = 7;
// A token of 20 or more letters, digits, _ and - that holds a digit and a letter: an API key, a token, a UUID.
const KEY = /[A-Za-z0-9_-]{20,}/g;
const KEY_LENGTH_IN_PATH = 16;
const ID_DIGITS_IN_PATH = 6;

const looksLikeKey = (token) => /\d/.test(token) && /[A-Za-z]/.test(token);
const digitCount = (text) => (text.match(/\d/g) ?? []).length;

/** Emails become `<email>`, keys `<key>`, runs of 7 or more digits `<number>`. Short numbers and plain words stay. */
export function maskText(text) {
  return String(text)
    .replace(EMAIL, '<email>')
    .replace(KEY, (token) => (looksLikeKey(token) ? '<key>' : token))
    .replace(NUMBER_RUN, (run) => (digitCount(run) >= NUMBER_DIGITS ? '<number>' : run));
}

/** The patterns of maskText as plain strings and a number, so a page can run them (take-mask.mjs): one source of truth. */
export const MASK_PATTERNS = { email: EMAIL.source, key: KEY.source, number: NUMBER_RUN.source, numberDigits: NUMBER_DIGITS };

/**
 * The [from, to) ranges of `text` that maskText replaces: every email, every key (a token with a digit and a letter), every run with
 * `numberDigits` digits. They are found on the text as it is, so a range may overlap another (a key inside an email); a caller covers
 * the union. SELF-CONTAINED ON PURPOSE: it is sent to a page as source text, so it names nothing outside its two arguments.
 */
export function maskRanges(text, patterns) {
  const ranges = [];
  const add = (source, keeps) => {
    for (const match of String(text).matchAll(new RegExp(source, 'g'))) if (keeps(match[0])) ranges.push([match.index, match.index + match[0].length]);
  };
  add(patterns.email, () => true);
  add(patterns.key, (token) => /\d/.test(token) && /[A-Za-z]/.test(token));
  add(patterns.number, (run) => (run.match(/\d/g) ?? []).length >= patterns.numberDigits);
  return ranges;
}

const decoded = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text; // a malformed escape is left as it is
  }
};

// A run of letters and digits this long that holds both is an id part (a hex id, a token); "v2" and "2026" are not.
const MIXED_RUN_LENGTH = 8;
const mixedRun = (text) => (text.match(/[A-Za-z0-9]+/g) ?? []).some((run) => run.length >= MIXED_RUN_LENGTH && looksLikeKey(run));

function isIdLike(text) {
  if (text.includes('@') || digitCount(text) >= NUMBER_DIGITS) return true;
  if (new RegExp(`^\\d{${ID_DIGITS_IN_PATH},}$`).test(text)) return true;
  if (text.length >= KEY_LENGTH_IN_PATH && (/[=~]/.test(text) || mixedRun(text))) return true;
  const parts = text.split('.');
  return parts.length >= 3 && parts.some((part) => part.length >= KEY_LENGTH_IN_PATH); // a JWT
}

/**
 * Per segment: percent-decoded for the test, cut at `;` (a session id rides there), run through maskText. A segment with an `@`, 7 or
 * more digits, an all-digit run of 6, a long mixed token, `=` or `~` in a long one, or a JWT shape becomes `<id>`. "v2", a year and
 * "file.tar.gz" stay.
 */
export function maskPath(pathname) {
  return String(pathname)
    .split('/')
    .map((segment) => {
      const cut = decoded(segment).split(';')[0];
      if (isIdLike(cut)) return '<id>';
      const masked = maskText(cut);
      return masked === cut ? segment.split(/;|%3b/i)[0] : masked;
    })
    .join('/');
}
