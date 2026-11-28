// The placeholder sentence of one finished step, built from the row's verb, its target name and its value. Pure.
// Page text (a control name, a typed value) goes into a film's `say`, which make-motion reads as markup: a `.` ends a sentence, `*` and `_`
// emphasise, `(0.5)` pauses, `[x](/ipa/)` sets a sound. So every piece goes through `sayable`, which keeps only letters, digits, spaces and
// , ' - and turns anything else into a space. One line is then exactly one sentence, whatever the page called its control.

const PIECE_MAX = 60;
const FALLBACK = 'this step';
const UNSAFE = /[^\p{L}\p{N} ,'-]+/gu;
const HAS_WORD = /[\p{L}\p{N}]/u;

/** `text` reduced to letters, digits, spaces and , ' -, spaces collapsed, cut at 60 characters on a word; `this step` when nothing is left. */
export function sayable(text) {
  const plain = String(text ?? '').replace(UNSAFE, ' ').replace(/ +/g, ' ').trim();
  if (!HAS_WORD.test(plain)) return FALLBACK;
  const chars = [...plain];
  if (chars.length <= PIECE_MAX) return plain;
  const cut = chars.slice(0, PIECE_MAX).join('');
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

const nameOf = (row) => sayable(row.target?.name);

function pathOf(address) {
  try {
    const { pathname, hash } = new URL(address);
    const route = hash.startsWith('#/') ? `${pathname}${hash}` : pathname;
    return route === '/' ? 'the start page' : sayable(route);
  } catch {
    return FALLBACK;
  }
}

const LINES = {
  goto: (row) => `Open ${pathOf(row.address)}`,
  click: (row) => `Click ${nameOf(row)}`,
  hover: (row) => `Point at ${nameOf(row)}`,
  type: (row) => `Type ${sayable(row.value)} into ${nameOf(row)}`,
  select: (row) => `Choose ${sayable(row.value)} in ${nameOf(row)}`,
  press: (row) => `Press ${sayable(row.value)}`,
  scroll: (row) => (row.target ? `Scroll to ${nameOf(row)}` : 'Scroll down'),
  wait: () => 'Wait a moment',
  show: (row) => `Here is ${nameOf(row)}`,
};

/** One sentence for a plan row: capitalised, ending in exactly one `.`, with nothing from the page that make-motion would read as markup. */
export function sayLine(row) {
  const body = row.intent !== null && row.intent !== undefined ? sayable(row.intent) : (LINES[row.do] ?? (() => FALLBACK))(row);
  return `${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
}
