// The report of a take, as text for the director to read: at most REPORT_BYTES, every piece of text that came from the site or the
// demo file through agentText (invisible characters written as code points, long text cut). It holds nothing take.json does not, and
// take.json holds nothing scout.json would not: signed in, names are already masked there, and a stop that came from an error carries
// the error's name only. It never holds a request body, and signed in it says the frames and the contact sheet are for the user.
//   takeReport(take, { dir, total }) -> string       `total` is the number of rows in the plan (the take does not carry it)
// Lists show at most LIST_MAX entries; the rest, and any line the byte cap pushes out, are counted in the last line.
import path from 'node:path';
import { agentText } from '../../shared/agent-text.mjs';

export const REPORT_BYTES = 6144;
const LIST_MAX = 12;
const ITEM_MAX = 80; // one origin, address or row id
const NAME_MAX = 60; // a download's suggested name
const REASON_MAX = 200;
const METHOD_MAX = 20;
const PATH_MAX = 300;
const ESSENTIAL = 0; // never dropped
const INLINE = 1; // dropped second
const ITEM = 2; // one entry of a list, dropped first, from the end
const FILM_DIGITS = 1;
const bytes = (text) => Buffer.byteLength(text);
const text = (value, max = ITEM_MAX) => agentText(value, { max });
const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const essential = (line) => ({ text: line, rank: ESSENTIAL });

/** A list of lines: one header (the whole count) and at most LIST_MAX entries under it. */
function listed(label, all, render) {
  const shown = all.slice(0, LIST_MAX);
  return {
    lines: [essential(all.length === 0 ? `${label}: none` : `${label} (${all.length}):`), ...shown.map((item) => ({ text: `  ${render(item)}`, rank: ITEM }))],
    hidden: all.length - shown.length,
  };
}

/** One line with at most LIST_MAX entries after `head`. */
function inline(head, all, { open = ': ', close = '' } = {}) {
  const shown = all.slice(0, LIST_MAX).map((item) => text(item));
  return { lines: [{ text: `${head}${open}${shown.join(', ')}${close}`, rank: INLINE }], hidden: all.length - shown.length };
}

const requestLine = (r) => `${text(r.method, METHOD_MAX)} ${text(r.origin)}${text(r.path)} x${count(r.count)}`;
const refusedLine = (r) => `${r.popup === true ? 'popup ' : ''}${text(r.method, METHOD_MAX)} ${text(r.origin)}${text(r.path)}`;
function downloadLine(d) {
  const kept = d.file === null || d.file === undefined ? `not kept (${text(d.skipped ?? 'not saved', NAME_MAX)})` : text(d.file);
  return `row ${text(d.row)}: ${kept}, ${count(d.bytes)} bytes, name "${text(d.name, NAME_MAX)}"`;
}

function startLines(take, total) {
  const ran = take.steps.length;
  const stop = take.stopped === null ? 'stopped: no, every row ran' : `stopped: row ${text(take.stopped.row)}, ${text(take.stopped.reason, REASON_MAX)}`;
  return [
    essential(`rows run: ${total === undefined ? ran : `${ran} of ${total}`}`),
    essential(stop),
    essential(`film time: ${(take.frames.length / take.fps).toFixed(FILM_DIGITS)} s at ${take.fps} fps`),
    essential(`frames: ${take.frames.length} (${new Set(take.frames).size} distinct files)`),
    essential(`bytes: ${take.bytes}`),
  ];
}

function boxLines(take) {
  const covered = take.steps.filter((s) => count(s.covered) > 0);
  const moved = take.steps.filter((s) => s.boxMoved === true);
  const sum = covered.reduce((n, s) => n + count(s.covered), 0);
  const most = Math.max(0, ...covered.map((s) => count(s.covered)));
  const coveredLine = covered.length === 0 ? 'boxes covered: none' : `boxes covered: ${sum} over ${covered.length} steps (most on one step: ${most})`;
  const movedPart = moved.length === 0 ? { lines: [essential('boxes that moved: none')], hidden: 0 } : inline(`boxes that moved: ${moved.length} steps`, moved.map((s) => s.id), { open: ' (', close: ')' });
  const again = take.again.length === 0 ? { lines: [essential('rows run again: none')], hidden: 0 } : inline('rows run again', take.again);
  return [{ lines: [essential(coveredLine)], hidden: 0 }, movedPart, again];
}

function sections(take, { dir, total }) {
  const { seen } = take;
  const pieces = [
    { lines: startLines(take, total), hidden: 0 },
    inline(`origins contacted (${seen.origins.length})`, seen.origins),
    listed('non-GET requests', seen.requests, requestLine),
    listed('refused moves', seen.refused, refusedLine),
    { lines: [essential(`dialogs: ${count(seen.dialogs)} (dismissed), popups: ${count(seen.popups)} (closed), page errors: ${count(seen.errors)}`)], hidden: 0 },
    listed('downloads', seen.downloads, downloadLine),
    ...boxLines(take),
    { lines: [essential(`folder: ${text(dir, PATH_MAX)}`), essential(`contact sheet: ${text(path.join(dir, 'contact.jpg'), PATH_MAX)}`)], hidden: 0 },
  ];
  if (take.signedIn === true) {
    pieces.push({ lines: [essential('signed in: the frames and the contact sheet show signed-in pages for the user to look at; do not open them, or any file in frames/. Work from this report.')], hidden: 0 });
  }
  return pieces;
}

/** Join the pieces; while over REPORT_BYTES drop entries from the end, then inline lines, and say how many lines were left out. */
function fit(pieces) {
  const lines = pieces.flatMap((p) => p.lines);
  let left = pieces.reduce((n, p) => n + p.hidden, 0);
  const render = () => [...lines.map((l) => l.text), ...(left > 0 ? [`left out of this report: ${left} lines (all are in take.json)`] : [])].join('\n');
  while (bytes(render()) > REPORT_BYTES) {
    const rank = lines.some((l) => l.rank === ITEM) ? ITEM : INLINE;
    const at = lines.findLastIndex((l) => l.rank === rank);
    if (at < 0) break;
    lines.splice(at, 1);
    left += 1;
  }
  let out = render();
  while (bytes(out) > REPORT_BYTES) out = out.slice(0, -1); // essential lines alone are over: cut rather than overflow
  return out;
}

export function takeReport(take, { dir, total } = {}) {
  return fit(sections(take, { dir, total }));
}
