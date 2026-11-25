// Code that runs inside the page, read-only: it looks at one element, or at the whole document, and returns plain data.
// Each function is serialised into the page, so each holds everything it uses. Nothing here clicks, types, focuses or scrolls,
// and nothing here reads what a field holds (`value`, `text`), only attributes and the form an element belongs to.

/** The facts of one element that decide its control kind and its effect. `el` is the element a snapshot ref points at. */
export function readFacts(el) {
  const tag = el.localName;
  const has = (name) => el.hasAttribute(name);
  const resolve = (text) => { try { return new URL(text, document.baseURI).href; } catch { return null; } };
  const methodOf = (text) => { const m = String(text ?? 'get').toLowerCase(); return m === 'post' || m === 'dialog' ? m : 'get'; };
  const form = el.form ?? null; // only a form-associated element has one (button, input, select, textarea)
  const type = tag === 'input' || tag === 'button' ? String(el.type || (tag === 'input' ? 'text' : 'submit')).toLowerCase() : null;
  const submits = (tag === 'input' && (type === 'submit' || type === 'image')) || (tag === 'button' && form !== null && type === 'submit');
  const own = submits && (tag === 'button' || tag === 'input'); // a submitter's own formaction and formmethod beat its form's
  const isLink = tag === 'a' && has('href');
  return {
    tag,
    type,
    hrefAttr: isLink ? el.getAttribute('href') : null,
    href: isLink ? resolve(el.getAttribute('href')) : null,
    newTab: tag === 'a' && String(el.getAttribute('target')).toLowerCase() === '_blank',
    download: has('download'),
    expandable: has('aria-expanded') || (has('aria-haspopup') && el.getAttribute('aria-haspopup') !== 'false'),
    submits,
    formAction: own && has('formaction') ? resolve(el.getAttribute('formaction')) : form ? resolve(form.getAttribute('action') ?? '') : null,
    formMethod: own && has('formmethod') ? methodOf(el.getAttribute('formmethod')) : form ? methodOf(form.getAttribute('method')) : null,
    scripted: has('onclick') || has('data-method') || has('data-turbo-method') || el.getAttributeNames().some((n) => /^hx-(post|put|patch|delete)$/i.test(n)),
    css: cssPath(el),
  };

  // An nth-of-type path from html, no ids and no classes: one element, one path. A path through an open shadow root joins with a
  // space, which Playwright's css engine pierces.
  function cssPath(start) {
    let css = '';
    let separator = '';
    for (let node = start; node; ) {
      const parent = node.parentNode;
      const name = node.localName;
      let segment = name;
      if (parent && parent.nodeType !== 9) {
        let n = 1;
        for (let s = node.previousElementSibling; s; s = s.previousElementSibling) if (s.localName === name) n += 1;
        segment = `${name}:nth-of-type(${n})`;
      }
      css = css ? `${segment}${separator}${css}` : segment;
      if (!parent || parent.nodeType === 9) break;
      node = parent.nodeType === 11 ? parent.host : parent;
      separator = parent.nodeType === 11 ? ' ' : ' > ';
    }
    return css;
  }
}

/** What the document shows apart from controls: the language, the scroll offset, and whether a video plays. */
export function readDocument() {
  return {
    lang: document.documentElement.getAttribute('lang') || null,
    scrollX: Math.round(window.scrollX),
    scrollY: Math.round(window.scrollY),
    video: [...document.querySelectorAll('video')].some((v) => !v.paused && !v.ended && v.readyState > 2),
  };
}

/** True when a password field is on the page and can be seen: the page asks to be signed in. */
export function hasVisiblePassword() {
  return [...document.querySelectorAll('input[type=password]')].some((input) => {
    const box = input.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(input).visibility !== 'hidden';
  });
}
