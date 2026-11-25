// Masks what must not reach a printed line, scout.json or a plan page: emails, long numbers, keys and path ids. Pure.

const EMAIL = /[^\s@<>()[\]",;:]+@[^\s@<>()[\]",;:]+\.[A-Za-z]{2,}/g;
// A run of digits with single separators (space . - ( ) and a leading +) that holds at least this many digits.
const NUMBER_RUN = /\+?\(?\d[\d ().-]*\d/g;
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

/** An all-digit segment of 6 or more digits, or a key-like segment of 16 or more characters, becomes `<id>`. */
export function maskPath(pathname) {
  return String(pathname)
    .split('/')
    .map((segment) => {
      if (new RegExp(`^\\d{${ID_DIGITS_IN_PATH},}$`).test(segment)) return '<id>';
      if (segment.length >= KEY_LENGTH_IN_PATH && /^[A-Za-z0-9_-]+$/.test(segment) && looksLikeKey(segment)) return '<id>';
      return segment;
    })
    .join('/');
}
