// The rows of a click plan as a make-explainer plan page: a summary, the use case's words and one table per use case, the rows that
// change something, a picture per scouted page with numbered boxes (signed out only), what scout saw the site send, links it left
// alone, one approval per danger row, and the verdict. Our own words pass make-explainer's lint (no filler, titles that state a
// claim, under 8 words). Anything a page said, or the demo author typed, goes in as inline code only: backticks become quotes,
// "TODO:" is broken, invisible characters are written as code points, and text is cut (names and addresses at 80 and 200 characters,
// a typed value at 300, which demo.json cannot pass). A typed value is the author's own words: it is shown as written, signed in too.
import { agentText } from '../../shared/agent-text.mjs';
import { maskedAddress } from './digest.mjs';
import { MAX_HEIGHT } from './shot.mjs';
import { cutLeft } from './text-cut.mjs';

const TEXT_MAX = 80;
const ADDRESS_MAX = 200; // an address shown after a name, or a goto's
const VALUE_MAX = 300; // a typed value; spec.mjs refuses a longer one, so nothing is hidden
const MAX_TABLE_ROWS = 60;
const SCROLL_ROWS = 4; // from this many rows the table scrolls inside the page
const NOT_SEEN = 'not seen yet';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Page text as one inline code span; '(empty)' for no text. make-explainer rejects "TODO:" and "lorem ipsum" in any string, code or not.
 * `verbatim` keeps the spaces as they are; `left` cuts a long text from the left, so its end shows.
 */
export function code(text, { max = TEXT_MAX, verbatim = false, left = false } = {}) {
  const raw = verbatim ? String(text) : String(text).replace(/\s+/g, ' ').trim();
  const flat = raw.replaceAll('`', "'").replaceAll('TODO:', 'TODO :').replace(/(lorem)\s+(ipsum)/gi, '$1 - $2');
  if (flat === '') return '(empty)';
  return `\`${left ? cutLeft(flat, { max }) : agentText(flat, { max })}\``;
}

const readable = (text) => text.replaceAll('%3Cid%3E', '<id>'); // a masked path id

const pathOf = (address) => {
  try { return readable(new URL(address).pathname); } catch { return String(address); }
};

/** An address as the owner needs to read it: path, query and hash, and the origin whenever it is not the start page's. */
function shown(address, startOrigin) {
  try {
    const url = new URL(address);
    const where = readable(`${url.pathname}${url.search}${url.hash}`);
    return url.origin === startOrigin ? where : `${url.origin}${where}`;
  } catch {
    return String(address);
  }
}

const capped = (rows) => rows.slice(0, MAX_TABLE_ROWS);
const moreNote = (rows) => (rows.length > MAX_TABLE_ROWS ? `The first ${MAX_TABLE_ROWS} of ${rows.length} are shown.` : undefined);
const scrollNote = (rows) => (rows.length >= SCROLL_ROWS ? `Scroll the table to see all ${capped(rows).length} rows.` : undefined);
function table(title, label, columns, rows, caption) {
  const notes = [caption, scrollNote(rows), moreNote(rows)].filter(Boolean);
  return { type: 'table', title, label, columns, rows: capped(rows), ...(notes.length > 0 ? { caption: notes.join(' ') } : {}) };
}

function tally(rows) {
  return rows.reduce((t, r) => ({ ...t, [r.effect]: t[r.effect] + 1 }), { look: 0, change: 0, danger: 0 });
}

// ---- the rows as table cells -------------------------------------------------------------------------------------------------

const isBelowPicture = (row, pictures) => pictures.has(row.pageId) && row.box !== null && row.box.y >= MAX_HEIGHT;

// A goto shows the address it opens, whole, from demo.json; any other row the page it sits on.
function pageCell(row, ctx) {
  if (row.intent !== null || row.page === null) return NOT_SEEN;
  if (row.do === 'goto') return `${row.pageId ?? 'not scouted'} ${code(shown(row.address ?? row.page, ctx.startOrigin), { max: ADDRESS_MAX })}`;
  return row.pageId === null ? `not scouted ${code(pathOf(row.page))}` : `${row.pageId} ${code(pathOf(row.page))}`;
}

// Where the control leads: a link its address, a control in a form the form's method and action.
function leadsTo(row, ctx) {
  const { control } = row;
  if (!control) return '';
  if (control.href) return ` to ${code(shown(control.href, ctx.startOrigin), { max: ADDRESS_MAX })}`;
  if (control.formAction) return ` in form ${code(`${String(control.formMethod ?? 'get').toUpperCase()} ${shown(control.formAction, ctx.startOrigin)}`, { max: ADDRESS_MAX })}`;
  return '';
}

// Starts with the page and the control id (`p1 c12`): two rows whose names and css read the same still differ there.
function targetCell(row, ctx) {
  if (row.intent !== null) return `intent ${code(row.intent)}`;
  if (row.target === null) return '';
  const below = isBelowPicture(row, ctx.pictures) ? ' (below the picture, no box)' : '';
  const where = [row.pageId, row.target.id].filter(Boolean).join(' ');
  return `${where} ${row.target.role} ${nameAndCss(row.target, row.viaCss)}${leadsTo(row, ctx)}${below}`.trim();
}

// The name; the css where there is no name, and after the name when the step named its target by css. Css is cut from the left.
function nameAndCss({ name, css }, viaCss) {
  if (css === null) return code(name);
  if (name === '') return code(css, { left: true });
  return viaCss ? `${code(name)} at ${code(css, { left: true })}` : code(name);
}

const valueCell = (row) => (row.do === 'goto' || row.value === null ? '' : code(String(row.value), { max: VALUE_MAX, verbatim: true }));

const useCaseRow = (row, ctx) => [row.n, row.effect, row.do, targetCell(row, ctx), pageCell(row, ctx), valueCell(row), row.reason];
const changeRow = (row, ctx) => [row.n, row.effect, row.useCase, row.do, targetCell(row, ctx), row.reason];

// ---- sections ----------------------------------------------------------------------------------------------------------------

function summary(spec, rows, hash) {
  const counts = tally(rows);
  const text = `Nothing has been clicked. Approving this page approves exactly these ${rows.length} rows, bound by the hash ${code(hash)}. After your yes, the take records exactly these rows.`;
  return {
    type: 'tldr', title: 'Nothing has run; the yes binds these rows', label: 'Plan', tone: counts.danger > 0 ? 'warn' : 'neutral', text,
    points: [
      `Site ${code(new URL(spec.source.url).host)}, rights ${spec.rights}, session ${spec.session ?? 'none'}.`,
      `${counts.look} look, ${counts.change} change, ${counts.danger} danger.`,
      'Each danger row has its own approval below.',
      'Answer every approval row before you choose Approve.',
    ],
  };
}

// The use case's own words stand before its table; they are the author's, so they are code.
function useCaseWords(useCase, i, own) {
  const scrolls = own.length >= SCROLL_ROWS ? ` The table below scrolls; it has ${own.length} rows.` : '';
  const goal = useCase.goal === undefined ? '' : ` Goal ${code(useCase.goal)}.`;
  return {
    type: 'text', title: useCase.goal === undefined ? `Use case ${i + 1} has a title` : `Use case ${i + 1} states its goal`, label: `Use case ${i + 1}`,
    text: `Title ${code(useCase.title)}.${goal}${scrolls}`,
  };
}

function useCaseTables(spec, rows, ctx) {
  return spec.useCases.flatMap((useCase, i) => {
    const own = rows.filter((r) => r.useCase === useCase.id);
    return [
      useCaseWords(useCase, i, own),
      table(`Use case ${i + 1} runs ${plural(own.length, 'step')}`, `Use case ${i + 1}`, ['n', 'effect', 'do', 'target', 'page', 'value', 'reason'], own.map((r) => useCaseRow(r, ctx))),
    ];
  });
}

function changesTable(rows, ctx) {
  const own = rows.filter((r) => r.effect !== 'look');
  if (own.length === 0) return [];
  return [table(`${plural(own.length, 'row')} may change something`, 'Changes', ['n', 'effect', 'use case', 'do', 'target', 'reason'], own.map((r) => changeRow(r, ctx)))];
}

function intentNote(rows) {
  const intents = rows.filter((r) => r.intent !== null);
  if (intents.length === 0) return [];
  return [{ type: 'callout', tone: 'warn', title: 'Intent rows cannot run yet', text: `${plural(intents.length, 'row')} not seen yet. Each one counts as a change and cannot run until it names a target scout saw.` }];
}

function images(rows, ctx) {
  if (ctx.signedIn) return [];
  return [...ctx.pictures].filter(([id]) => rows.some((r) => r.pageId === id)).map(([id, src]) => ({
    type: 'image', title: `Boxes number the rows on ${id}`, label: 'Screenshot', src,
    alt: `Page ${id} of the scouted site, with a numbered box on each control a row uses.`,
    caption: `Page ${id}. Colour marks the effect: red danger, amber change, blue look.`,
  }));
}

function requestsSection(scout) {
  const seen = scout.pages.flatMap((p) => (p.requests ?? []).map((r) => [p.id, r.method, code(`${r.origin}${r.path}`), r.count]));
  if (seen.length === 0) return [{ type: 'text', title: 'Scout saw no request except GET', label: 'Requests', text: 'No page sent a POST, PUT, PATCH or DELETE while scout read it.' }];
  return [table('The site sent requests of its own', 'Requests', ['page', 'method', 'where', 'times'], seen, 'Scout saw these while it read the pages. This plan does not allow them yet.')];
}

function skippedSection(scout, signedIn) {
  const rows = (scout.skipped ?? []).map((s) => [code(s.name), code(signedIn ? maskedAddress(s.url) ?? '' : s.url), s.reason]);
  if (rows.length === 0) return [];
  return [table('Scout left some links alone', 'Skipped', ['name', 'address', 'reason'], rows, 'Scout opened none of these.')];
}

// make-explainer's plan preset needs at least one item to answer, so a plan with no danger row still gets one approval for the rows.
function approvals(rows, ctx) {
  const danger = rows.filter((r) => r.effect === 'danger');
  if (danger.length === 0) {
    return [{ type: 'approval', id: 'rows-as-listed', title: 'No row is a danger row', label: 'Rows', item: `All ${rows.length} rows run as listed. None of them is a danger row.`, why: 'Every row is a look or a change. Nothing has been clicked.' }];
  }
  return danger.map((row) => ({
    type: 'approval', id: `danger-${row.id}`, title: `Row ${row.n} needs its own yes`, label: `Danger ${row.n}`,
    item: row.do === 'goto' ? `Row ${row.n}: goto ${pageCell(row, ctx)}.` : `Row ${row.n}: ${row.do} ${targetCell(row, ctx)} on ${pageCell(row, ctx)}.`,
    why: `The classifier says: ${row.reason}. Nothing has been clicked.`,
  }));
}

/**
 * The explainer spec for a click plan. `result` is planRows' answer (no errors); `pictures` maps a page id to the path of its picture
 * beside the plan (signed out only; a signed-in plan shows none whatever is passed).
 */
export function planPage(spec, scout, result, pictures = new Map()) {
  const { rows, hash } = result;
  const signedIn = scout.session !== null;
  const ctx = { signedIn, pictures: signedIn ? new Map() : pictures, startOrigin: new URL(spec.source.url).origin };
  return {
    title: 'Click plan, nothing clicked yet',
    subtitle: `${plural(rows.length, 'step')} in ${plural(spec.useCases.length, 'use case')}; none of them has run.`,
    preset: 'plan',
    key: `demo-${hash}`,
    meta: { status: 'Needs your approval' },
    ...(spec.generatedBy === undefined ? {} : { generatedBy: spec.generatedBy }),
    sections: [
      summary(spec, rows, hash),
      ...intentNote(rows),
      ...useCaseTables(spec, rows, ctx),
      ...changesTable(rows, ctx),
      ...images(rows, ctx),
      ...requestsSection(scout),
      ...skippedSection(scout, signedIn),
      ...approvals(rows, ctx),
      { type: 'verdict', id: 'verdict', title: 'Approve, change or stop this plan', label: 'Your verdict', text: `Approve exactly these ${rows.length} rows, bound by the hash ${code(hash)}?` },
    ],
  };
}
