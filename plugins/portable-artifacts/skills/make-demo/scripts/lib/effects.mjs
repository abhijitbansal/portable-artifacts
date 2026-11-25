// The three effect classes of a step: look (changes nothing), change (may change something, or unknown), danger (a
// destructive or irreversible word). Pure: no I/O, no page, no clock.
//
// A control is what scout lists for one element:
//   { role, name, kind, href, newTab, download, submits, formAction, formMethod, scripted }
// kind: link (an <a href> with an http(s) address that is not #), button, disclosure (role tab, summary, aria-expanded or
// aria-haspopup), field, password, select, toggle, other. href and formAction are absolute or null.
// scripted: an inline onclick, data-method, data-turbo-method or hx-post|put|patch|delete.

const DANGER_WORDS = [
  'delete', 'remove', 'destroy', 'erase', 'trash', 'archive', 'reset', 'revoke', 'deactivate', 'disable', 'pay', 'payment',
  'buy', 'purchase', 'checkout', 'place order', 'subscribe', 'unsubscribe', 'subscription', 'upgrade', 'donate', 'refund',
  'transfer', 'withdraw', 'send', 'invite', 'publish', 'unpublish', 'deploy', 'merge', 'sign out', 'signout', 'log out',
  'logout', 'log off', 'logoff', 'account', 'billing',
].map((phrase) => ({ phrase, words: phrase.split(' ') }));

const LOOK_ONLY = new Set(['hover', 'scroll', 'wait', 'show']);
const DANGER_CHECKED = new Set(['click', 'press', 'goto']);

// Lower-cased words of a text: camelCase, digits, punctuation and separators (- _ / . = &) all split.
function wordsOf(text) {
  return String(text)
    .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** The first danger word or phrase found whole in `text`, or null. "Resender" and "Display" hold none. */
export function dangerWord(text) {
  const words = wordsOf(text);
  for (const { phrase, words: want } of DANGER_WORDS) {
    for (let i = 0; i + want.length <= words.length; i++) {
      if (want.every((w, j) => words[i + j] === w)) return phrase;
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
  if (verb === 'click' && control?.kind === 'disclosure' && !control.href && !control.submits && !control.scripted) {
    return { effect: 'look', reason: 'opens or closes something on the page' };
  }
  return { effect: 'change', reason: 'unknown, so treated as a change' };
}

/** A look click on a link to another document on the page's own origin: the only link scout follows. */
export function isFollowable(control, { pageUrl, origins, lang }) {
  if (control?.kind !== 'link') return false;
  if (classify({ do: 'click', control, pageUrl, origins, lang }).effect !== 'look') return false;
  const target = parse(control.href, pageUrl);
  const here = parse(pageUrl);
  if (!target || !here || target.origin !== here.origin) return false;
  target.hash = '';
  here.hash = '';
  return target.href !== here.href;
}
