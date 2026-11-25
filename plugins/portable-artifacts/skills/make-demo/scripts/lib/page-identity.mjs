// Which address is which page. Pure.
// A hash that starts `#/` or `#!` is a route of a single-page app: two of them are two screens. Any other hash (`#top`, `#section-2`)
// is a place in one document. `documentOf` drops every hash (is it the same document?); `pageIdentity` drops only the second kind
// (is it the same screen?).

const isRoute = (hash) => hash.startsWith('#/') || hash.startsWith('#!');

/** The address without its hash: the document it loads. A text that is not an address comes back as it is. */
export function documentOf(address) {
  try {
    const url = new URL(address);
    url.hash = '';
    return url.href;
  } catch {
    return String(address);
  }
}

/** The address with its hash kept when it is a route (`#/` or `#!`) and dropped otherwise: the screen it shows. */
export function pageIdentity(address) {
  try {
    const url = new URL(address);
    if (!isRoute(url.hash)) url.hash = '';
    return url.href;
  } catch {
    return String(address);
  }
}
