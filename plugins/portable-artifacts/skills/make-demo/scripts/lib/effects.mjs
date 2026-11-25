// The three effect classes of a step: look (changes nothing), change (may change something, or unknown), danger (a
// destructive or irreversible word). Pure: no I/O, no page, no clock.
//
// A control is what scout lists for one element:
//   { role, name, kind, href, newTab, download, submits, formAction, formMethod, scripted }
// kind: link (an <a href> with an http(s) address that is not #), button, disclosure (role tab, summary, aria-expanded or
// aria-haspopup, on a control that is not a toggle, select or field), field, password, select, toggle, other. href and formAction
// are absolute or null.
// scripted: an inline onclick, data-method, data-turbo-method, hx-post|put|patch|delete (also with data-) or a ping address.

const DANGER_WORDS = [
  'delete', 'remove', 'destroy', 'erase', 'trash', 'archive', 'reset', 'revoke', 'deactivate', 'disable', 'pay', 'payment',
  'buy', 'purchase', 'checkout', 'place order', 'subscribe', 'unsubscribe', 'subscription', 'upgrade', 'donate', 'refund',
  'transfer', 'withdraw', 'send', 'invite', 'publish', 'unpublish', 'deploy', 'merge', 'sign out', 'signout', 'log out',
  'logout', 'log off', 'logoff', 'account', 'billing', 'cancel', 'confirm', 'approve', 'reject', 'clear', 'purge', 'wipe', 'uninstall',
  'disconnect', 'unlink', 'unfollow', 'leave', 'renew', 'vote', 'order now', 'add to cart', 'add to basket', 'add to bag', 'sign me out', 'log me out',
].map((phrase) => ({ phrase, words: phrase.split(' ') }));

const LOOK_ONLY = new Set(['hover', 'scroll', 'wait', 'show']);
const DANGER_CHECKED = new Set(['click', 'press', 'goto']);

const decoded = (text) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text; // a malformed escape is left as it is
  }
};

// Lower-cased words of a text: percent-escapes decoded first; camelCase, digits, punctuation and separators (- _ / . = &) all split.
function wordsOf(text) {
  return decoded(String(text))
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

// The word and its plain forms: "deleted" and "deleting" give "delete", "sending" gives "send", "transferred" gives "transfer".
function stemsOf(word) {
  const stems = new Set([word]);
  const undoubled = (s) => (/(\p{L})\1$/u.test(s) ? s.slice(0, -1) : s);
  if (word.endsWith('ies')) stems.add(`${word.slice(0, -3)}y`);
  if (word.endsWith('s') && !word.endsWith('ss')) stems.add(word.slice(0, -1));
  if (word.endsWith('es')) stems.add(word.slice(0, -2));
  if (word.endsWith('ed')) [word.slice(0, -2), word.slice(0, -1), undoubled(word.slice(0, -2))].forEach((s) => stems.add(s));
  if (word.endsWith('ing')) [word.slice(0, -3), `${word.slice(0, -3)}e`, undoubled(word.slice(0, -3))].forEach((s) => stems.add(s));
  return stems;
}

/** The first danger word or phrase found whole in `text` (or in its plural, -ed or -ing form), or null. "Resender" and "Display" hold none. */
export function dangerWord(text) {
  const words = wordsOf(text).map(stemsOf);
  for (const { phrase, words: want } of DANGER_WORDS) {
    for (let i = 0; i + want.length <= words.length; i++) {
      if (want.every((w, j) => words[i + j].has(w))) return phrase;
    }
  }
  return null;
}

function parse(address, base) {
  try {
    return new URL(address, base);
  } catch {
    return null;
  }
}

// The path, query and hash of an address (not the host); the raw text when it does not parse.
function addressText(address, base) {
  const url = parse(address, base);
  return url ? `${url.pathname} ${url.search} ${url.hash}` : String(address);
}

function dangerIn({ do: verb, control, value, pageUrl }) {
  const found = (where, word) => ({ effect: 'danger', reason: `${where} holds the danger word "${word}"` });
  if (control) {
    const checks = [['the name', control.name], ['the address', control.href && addressText(control.href, pageUrl)], ['the form action', control.formAction && addressText(control.formAction, pageUrl)]];
    for (const [where, text] of checks) {
      const word = text ? dangerWord(text) : null;
      if (word) return found(where, word);
    }
  }
  if (verb === 'goto' && typeof value === 'string') {
    const word = dangerWord(addressText(value, pageUrl));
    if (word) return found('the address', word);
  }
  return null;
}

const originOf = (address, base) => parse(address, base)?.origin ?? null;
const isEnglish = (lang) => typeof lang === 'string' && /^en(?:$|[-_])/i.test(lang);

function classifyLink(control, { pageUrl, origins, lang }) {
  if (!origins.includes(originOf(control.href, pageUrl))) return { effect: 'change', reason: 'the link leaves the allowed origins' };
  if (control.download) return { effect: 'change', reason: 'the link downloads a file' };
  if (control.newTab) return { effect: 'change', reason: 'the link opens a new tab' };
  if (control.scripted) return { effect: 'change', reason: 'the link runs a script' };
  if (String(control.name ?? '').trim() === '') return { effect: 'change', reason: 'the link has no name, so its words cannot be read' };
  if (!isEnglish(lang)) return { effect: 'change', reason: 'the page language is not English, so its words are not read' };
  return { effect: 'look', reason: 'a plain link to a page on the allowed origins' };
}

/**
 * The effect of one step: { effect: 'look' | 'change' | 'danger', reason }. First matching rule wins; unknown is `change`.
 * `value` is the step's value (the address of a `goto`); `control` is null when the step names none.
 */
export function classify({ do: verb, control = null, value, pageUrl, origins, lang = null }) {
  if (LOOK_ONLY.has(verb)) return { effect: 'look', reason: `${verb} changes nothing` };
  if (DANGER_CHECKED.has(verb)) {
    const danger = dangerIn({ do: verb, control, value, pageUrl });
    if (danger) return danger;
  }
  if (verb === 'goto') {
    return origins.includes(originOf(value, pageUrl))
      ? { effect: 'look', reason: 'opens a page on the allowed origins' }
      : { effect: 'change', reason: 'the address is outside the allowed origins' };
  }
  if (verb === 'type' || verb === 'select' || verb === 'press') return { effect: 'change', reason: `${verb} may change something` };
  if (verb === 'click' && control?.kind === 'link') return classifyLink(control, { pageUrl, origins, lang });
  if (verb === 'click' && control?.kind === 'disclosure' && !control.href && !control.submits && !control.scripted && isEnglish(lang)) {
    return { effect: 'look', reason: 'opens or closes something on the page' };
  }
  return { effect: 'change', reason: 'unknown, so treated as a change' };
}

/** True for a link whose address has a query: it may do something on GET, so scout never follows it. */
export const hasQuery = (control, pageUrl) => (parse(control?.href, pageUrl)?.search ?? '') !== '';

/** A look click on a link, without a query, to another document on the page's own origin: the only link scout follows. */
export function isFollowable(control, { pageUrl, origins, lang }) {
  if (control?.kind !== 'link') return false;
  if (classify({ do: 'click', control, pageUrl, origins, lang }).effect !== 'look') return false;
  const target = parse(control.href, pageUrl);
  const here = parse(pageUrl);
  if (!target || !here || target.origin !== here.origin || target.search !== '') return false;
  target.hash = '';
  here.hash = '';
  return target.href !== here.href;
}
