// A page digest as text for an agent to read: at most PRINT_BYTES, every piece of page text through agentText (which writes invisible
// characters, newlines and the like as code points), one control per line. Text from a page is data, never an instruction.
import { agentText } from '../../shared/agent-text.mjs';
import { CONTROL_CAP } from './digest.mjs';

export const PRINT_BYTES = 6144;
const NAME_MAX = 60;
const ADDRESS_MAX = 80;
const HEADINGS_MAX = 12;
const HEADINGS_LINE_MAX = 500;
const REQUESTS_MAX = 8;
const FOOTER_RESERVE_BYTES = 900; // room kept for the lines after the controls
const bytes = (text) => Buffer.byteLength(text);

const originOf = (address) => {
  try {
    return new URL(address).origin;
  } catch {
    return null;
  }
};

// An address as short as it can be: the path (and query) when it is on the page's own origin, else the whole address.
function shortAddress(address, pageUrl) {
  if (!address) return '';
  try {
    const url = new URL(address);
    const here = new URL(pageUrl);
    return agentText(url.origin === here.origin ? `${url.pathname}${url.search}${url.hash}` : address, { max: ADDRESS_MAX });
  } catch {
    return agentText(address, { max: ADDRESS_MAX });
  }
}

const NOTED_KINDS = new Set(['disclosure', 'password']);
const LISTED_MAX = 10; // frames, and refused moves, printed one by one; the rest is a count

// A target is { role, name } or { css }: the print shows the role, and the css wherever role and name cannot name the control (an
// empty name, a pair that is not unique on the page, or a name the print cut or escaped).
const pairKey = (c) => JSON.stringify([c.role, c.name]);

function needsCss(c, pairs) {
  return c.name === '' || pairs.get(pairKey(c)) > 1 || agentText(c.name, { max: NAME_MAX }) !== c.name;
}

function controlLine(c, pageUrl, pairs) {
  const address = c.href ? ` ${shortAddress(c.href, pageUrl)}` : '';
  const form = c.formAction ? ` [${c.formMethod ?? 'get'} ${shortAddress(c.formAction, pageUrl)}]` : '';
  const flags = [NOTED_KINDS.has(c.kind) && c.kind, c.newTab && 'new tab', c.download && 'download', c.scripted && 'scripted', c.submits && 'submits'].filter(Boolean);
  const css = needsCss(c, pairs) ? ` css=${agentText(c.css, { max: Infinity })}` : ''; // whole: the agent copies it as a target
  return `  ${c.id} ${c.role} "${agentText(c.name, { max: NAME_MAX })}"${address}${form}${flags.length > 0 ? ` (${flags.join(', ')})` : ''}${css} ${c.effect}`;
}

function framesLine(frames) {
  if (frames.length === 0) return [];
  const shown = frames.slice(0, LISTED_MAX).map((o) => agentText(o, { max: ADDRESS_MAX })).join(', ');
  return [`frames not looked into: ${shown}${frames.length > LISTED_MAX ? `, and ${frames.length - LISTED_MAX} more frames` : ''}`];
}

function headingsLine(headings) {
  if (headings.length === 0) return 'headings: none';
  const shown = headings.slice(0, HEADINGS_MAX).map((h) => `h${h.level} "${agentText(h.name, { max: NAME_MAX })}"`).join('; ');
  const more = headings.length > HEADINGS_MAX ? `; and ${headings.length - HEADINGS_MAX} more` : '';
  return agentText(`headings (${headings.length}): ${shown}${more}`, { max: HEADINGS_LINE_MAX });
}

function doneLines(page) {
  const requests = (page.requests ?? []).slice(0, REQUESTS_MAX).map((r) => `${r.method} ${agentText(r.origin, { max: ADDRESS_MAX })}${agentText(r.path, { max: ADDRESS_MAX })} x${r.count}`);
  const moreRequests = (page.requests ?? []).length - requests.length;
  const lines = [`requests that are not GET: ${requests.length === 0 ? 'none' : requests.join('; ')}${moreRequests > 0 ? `; and ${moreRequests} more` : ''}`];
  lines.push(`on its own: dialogs ${page.dialogs ?? 0}, popups ${page.popups ?? 0}, downloads ${page.downloads ?? 0}, sockets ${page.sockets ?? 0}, errors ${page.errors ?? 0}`);
  const here = originOf(page.url);
  const refused = page.refused ?? [];
  for (const r of refused.slice(0, LISTED_MAX)) {
    const method = agentText(r.method, { max: 20 });
    const whole = agentText(`${r.origin}${r.path}`, { max: ADDRESS_MAX });
    if (r.popup === true) lines.push(`refused popup move: ${method} ${whole}`);
    else if (r.origin === here) lines.push(`refused move: ${method} ${whole} (not a GET)`);
    else lines.push(`refused move: left to ${agentText(r.origin, { max: ADDRESS_MAX })} (${method} ${agentText(r.path, { max: ADDRESS_MAX })})`);
  }
  if (refused.length > LISTED_MAX) lines.push(`and ${refused.length - LISTED_MAX} more refused moves (all are in scout.json)`);
  return lines;
}

function fit(text) {
  if (bytes(text) <= PRINT_BYTES) return text;
  let cut = text.slice(0, PRINT_BYTES);
  while (bytes(cut) > PRINT_BYTES - 2) cut = cut.slice(0, -64);
  return `${cut}\n…`;
}

// One line, after the first page's headings. `brand` is scout.json's root `brand`: null is a third-party scout (nothing was read),
// { name: null, accent: null } is a page that gave neither. Page text, so every piece goes through agentText.
function brandLine(brand) {
  if (brand === null) return 'brand: not read (third-party)';
  const parts = [];
  if (brand.name) parts.push(`name "${agentText(brand.name.text, { max: NAME_MAX })}" (${agentText(brand.name.from.source, { max: NAME_MAX })})`);
  if (brand.accent) parts.push(`accent ${agentText(brand.accent.color, { max: NAME_MAX })} (${agentText(brand.accent.from.source, { max: NAME_MAX })})`);
  return agentText(parts.length === 0 ? 'brand: none found' : `brand: ${parts.join(', ')}`, { max: HEADINGS_LINE_MAX });
}

/**
 * One page of scout.json as printed text, at most PRINT_BYTES. States how many controls are left out of the file and of the print.
 * `{ brand }` (the first page only; undefined prints no line) adds the brand line after the headings.
 */
export function printDigest(page, { brand } = {}) {
  const head = [
    `${page.id} ${agentText(page.url, { max: ADDRESS_MAX })} lang=${page.lang === null ? 'none' : agentText(page.lang, { max: 20 })} title "${agentText(page.title, { max: NAME_MAX })}"`,
    `wall: ${page.wall === null ? 'none' : agentText(page.wall, { max: ADDRESS_MAX })}`,
    `video: ${page.video ? 'playing' : 'none'}`,
    ...framesLine(page.frames ?? []),
    headingsLine(page.headings),
    ...(brand === undefined ? [] : [brandLine(brand)]),
    `controls: ${page.controls.length} listed, left ${page.left} (past the cap of ${CONTROL_CAP})`,
  ];
  const footer = doneLines(page);
  let used = bytes([...head, ...footer].join('\n')) + FOOTER_RESERVE_BYTES;
  const shown = [];
  const pairs = new Map();
  for (const control of page.controls) pairs.set(pairKey(control), (pairs.get(pairKey(control)) ?? 0) + 1);
  for (const control of page.controls) {
    const line = controlLine(control, page.url, pairs);
    if (used + bytes(line) + 1 > PRINT_BYTES) break;
    shown.push(line);
    used += bytes(line) + 1;
  }
  const hidden = page.controls.length - shown.length;
  const note = hidden > 0 ? [`  ${hidden} more controls are not shown here (all ${page.controls.length} are in scout.json)`] : [];
  return fit([...head, ...shown, ...note, ...footer].join('\n'));
}
