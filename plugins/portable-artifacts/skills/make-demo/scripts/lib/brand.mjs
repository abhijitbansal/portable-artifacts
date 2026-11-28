// What scout proposes as the demo's brand, from the first page's theme-color and site name. The page's values are raw attributes
// (page-facts.mjs cleans nothing in the page): every value is cleaned here, outside the page, and never trusted as the page wrote it.
// A colour is a lower-case #rrggbb or null; a name is escaped (agentText), flattened and cut to NAME_MAX characters at a word.
import { agentText } from '../../shared/agent-text.mjs';

export const NAME_MAX = 40;
const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#[0-9a-f]{6}$/i;
const RGB = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;
const CHANNEL_MAX = 255;
const COLOR_INPUT_MAX = 64; // the page reads at most this much of a theme-color; a longer text here is not a colour
const HEX_RADIX = 16;
const REDUCED = /^<text \d+>$/; // maskName's form of a text too long to be a name
const HALF_ESCAPE = /\\(u(\{[0-9a-f]*)?)?$/;

/** A lower-case `#rrggbb` for `#rgb`, `#rrggbb` and `rgb(r, g, b)` (each 0 to 255), else null. */
export function accentOf(text) {
  if (typeof text !== 'string' || text.length > COLOR_INPUT_MAX) return null;
  const value = text.trim();
  if (HEX6.test(value)) return value.toLowerCase();
  const short = HEX3.exec(value);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const rgb = RGB.exec(value);
  if (!rgb) return null;
  const channels = rgb.slice(1).map(Number);
  if (channels.some((c) => c > CHANNEL_MAX)) return null;
  return `#${channels.map((c) => c.toString(HEX_RADIX).padStart(2, '0')).join('')}`;
}

// Cut at a word when the cut falls inside one; never leave half an escape (`\u{20`) at the end.
function cutAtWord(text, max) {
  const chars = [...text];
  if (chars.length <= max) return text;
  let cut = chars.slice(0, max);
  if (chars[max] !== ' ') {
    const space = cut.lastIndexOf(' ');
    if (space > 0) cut = cut.slice(0, space);
  }
  return cut.join('').replace(HALF_ESCAPE, '').trimEnd();
}

function clean(text) {
  if (typeof text !== 'string') return null;
  const flat = agentText(text.replace(/\s+/g, ' ').trim(), { max: Infinity }); // whitespace first: agentText would write a newline as a code point
  return flat === '' ? null : cutAtWord(flat, NAME_MAX);
}

/** The site name, else the title, escaped and cut to 40 characters at a word; null when both are empty. */
export function nameOf(siteName, title) {
  return clean(siteName) ?? clean(title);
}

const reduced = (text, mask) => {
  if (typeof text !== 'string') return null;
  const masked = mask(text);
  return REDUCED.test(masked) ? null : masked;
};

/**
 * The proposal for `first` ({ url, title, siteName, themeColor }: the first page, its address as it will be stored). Null for
 * `third-party`: a third party's brand is not taken, so nothing of the page is read. Otherwise { name, accent }, each
 * { text | color, from: { page, source } } or null. `mask` (signed in) runs over the name's raw texts first, and a text it reduces
 * to its length is no name.
 */
export function proposeBrand(first, { rights, mask = (text) => text }) {
  if (rights === 'third-party') return null;
  const site = reduced(first.siteName, mask);
  const title = reduced(first.title, mask);
  const text = nameOf(site, title);
  const color = accentOf(first.themeColor);
  const where = (source) => ({ page: first.url, source });
  return {
    name: text === null ? null : { text, from: where(clean(site) === null ? 'title' : 'og:site_name') },
    accent: color === null ? null : { color, from: where('theme-color') },
  };
}
