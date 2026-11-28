// The draft film, by rule, from demo.json, its rows, scout.json and one take. Pure: no file, no clock, no model.
// It writes a make-motion film (version 2): an opening (a statement, then a statement or number per fact), one `walk` shot per use case with
// one sentence per finished step, and a closing `end` card. The words from the page (control names, typed values) pass through `sayLine`, so
// they add no sentence and no markup. The take must be of this plan: its `planKey` is `demo-<hash>` of the rows, and a demo.json whose bound
// fields (a step, origins, mask, session, brand) changed after the take gives another hash and is refused.
import { sayLine } from './say-line.mjs';
import { DEFAULT_LOOK } from './schema.mjs';
import { Refused } from './demo-out.mjs';
import { planProblems, hostOf } from './take-plan.mjs';

const TITLE_MAX = 40;
const LABEL_MAX = 40;
// make-motion's caps (scripts/v2/spec.mjs SAY_MAX on every shot's say, engine/kinds/end.mjs MARK_MAX on the end card's mark); both are
// unexported there, and test/film-draft.test.mjs reads the source to keep these two equal to them.
const SAY_MAX = 400;
const MARK_MAX = 32;
const SOURCE_LABEL = 'Source: ';
const LIFTABLE = new Set(['hover', 'show', 'type', 'select']); // a card, a field or a panel; a raised button reads badly
// The seams into the product and out of it are hard cuts: in the walk look gate a dissolve laid the opening's type over the page and a fade
// dipped through a blank frame (phase 4 gate record).
const HARD = 'cut';

const cut = (text, max) => [...text].slice(0, max).join('').trim();
const sayName = (text) => text.replace(/[^\p{L}\p{N} ,'-]+/gu, ' ').replace(/ +/g, ' ').trim();
const HALF_ESCAPE = /\\(?:u(?:\{[0-9a-f]*)?)?$/i; // the stub of a \u{202e} escape that a cut left at the end

/** `text` cut to at most `max` characters at a word (a single long word is cut hard), with no trailing space and no half escape. */
function cutAtWord(text, max) {
  const chars = [...text.replace(/\s+/g, ' ').trim()];
  if (chars.length <= max) return chars.join('');
  let head = chars.slice(0, max).join('');
  const space = head.lastIndexOf(' ');
  if (chars[max] !== ' ' && space > 0) head = head.slice(0, space);
  return head.replace(HALF_ESCAPE, '').trim();
}

function problems({ spec, rows, scout, take }) {
  const errors = planProblems({ spec, rows, take });
  const pages = new Set((scout.pages ?? []).map((p) => p.url));
  (spec.opening?.facts ?? []).forEach((fact, i) => {
    if (fact.from !== 'user' && !pages.has(fact.from)) errors.push({ path: `opening.facts[${i}].from`, message: 'is an address scout did not read; use a page of scout.json, or "user"' });
  });
  return errors;
}

function openingShots(opening) {
  if (opening === undefined) return [];
  const facts = (opening.facts ?? []).map((fact, i) => {
    const id = `fact-${i + 1}`;
    if (fact.value === undefined) return { id, show: 'statement', say: fact.text };
    return { id, show: 'number', value: fact.value, label: cut(fact.text, LABEL_MAX), say: fact.text };
  });
  return [{ id: 'hook', show: 'statement', say: opening.hook }, ...facts];
}

// The last finished step of the use case that has a box and shows a card, a field or a panel; else none.
const liftOf = (steps) => steps.findLast((s) => s.hasBox && LIFTABLE.has(s.do));

function walkShot({ id, useCase, steps, lines, src }) {
  const lift = liftOf(steps);
  return {
    id,
    show: 'walk',
    src,
    frame: 'window',
    title: cut(useCase.title, TITLE_MAX),
    say: lines.join(' '),
    steps: steps.map((s) => ({ id: s.id })),
    ...(lift ? { lift: [{ step: lift.id }] } : {}),
  };
}

// The steps in take order, grouped so each group's sentences joined by a space fit in make-motion's say cap; a sentence is never split.
function chunksOf(steps, lines) {
  const chunks = [];
  let now = null;
  steps.forEach((step, i) => {
    if (now === null || now.lines.join(' ').length + 1 + lines[i].length > SAY_MAX) {
      now = { steps: [], lines: [] };
      chunks.push(now);
    }
    now.steps.push(step);
    now.lines.push(lines[i]);
  });
  return chunks;
}

// The cut into the first walk shot, when a shot comes before it (a film's first shot takes no cut). A use case too long for one say is several
// consecutive walk shots, uc-<id>, uc-<id>-2, ...; a number is skipped when it would be another use case's shot id.
function walkShots({ spec, rows, take }, hasOpening) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rowUseCase = new Map(rows.map((r) => [r.id, r.useCase]));
  const src = take.dir.split(/[\\/]/).at(-1);
  const reserved = new Set(spec.useCases.map((u) => `uc-${u.id}`));
  const left = [];
  const shots = [];
  for (const useCase of spec.useCases) {
    const steps = take.steps.filter((s) => rowUseCase.get(s.id) === useCase.id);
    if (steps.length === 0) left.push(`use case ${useCase.id} left out: the take finished none of its steps`);
    let number = 1;
    for (const chunk of chunksOf(steps, steps.map((s) => sayLine(byId.get(s.id))))) {
      let id = number === 1 ? `uc-${useCase.id}` : `uc-${useCase.id}-${number}`;
      while (number > 1 && reserved.has(id)) id = `uc-${useCase.id}-${(number += 1)}`;
      number += 1;
      shots.push(walkShot({ id, useCase, steps: chunk.steps, lines: chunk.lines, src }));
    }
  }
  if (shots.length > 0 && hasOpening) shots[0] = { ...shots[0], cut: HARD };
  return { shots, left };
}

// The end card's mark, cut to make-motion's cap: the source credit for a third party (the host part is cut, "Source: " stays), else the brand
// name; none when the name has no letter or digit. Never an empty string.
function markOf(spec) {
  if (spec.rights === 'third-party') return `${SOURCE_LABEL}${cutAtWord(hostOf(spec), MARK_MAX - SOURCE_LABEL.length).replace(/[.:-]+$/, '')}`;
  const name = spec.brand?.name;
  if (name === undefined || sayName(name) === '') return undefined;
  return cutAtWord(name, MARK_MAX) || undefined;
}

// A third-party demo always closes on the credit, with no ending too (then no ask: the end card takes none).
function endShot(spec) {
  const { ending, brand } = spec;
  const thirdParty = spec.rights === 'third-party';
  const name = brand?.name === undefined ? hostOf(spec) : sayName(brand.name) || hostOf(spec);
  const mark = markOf(spec);
  const say = ending?.say ?? (ending === undefined ? `Shown from ${hostOf(spec)}.` : `That is ${thirdParty ? hostOf(spec) : name}.`);
  return { id: 'close', show: 'end', cut: HARD, say, ...(ending?.ask === undefined ? {} : { ask: ending.ask }), ...(mark === undefined ? {} : { mark }) };
}

/**
 * -> { film, notes }. `spec` is a valid demo.json, `rows` its planRows rows, `scout` the parsed scout.json, `take` a readDemoTake result.
 * Throws a Refused (with { path, message } errors) for a take of another plan, a take step the plan lacks, or a fact from a page scout did not read.
 */
export function draftFilm({ spec, rows, scout, take }) {
  const errors = problems({ spec, rows, scout, take });
  if (errors.length > 0) throw new Refused(errors);
  const look = spec.look ?? DEFAULT_LOOK;
  const walked = walkShots({ spec, rows, take }, spec.opening !== undefined);
  const closes = spec.ending !== undefined || spec.rights === 'third-party';
  const shots = [...openingShots(spec.opening), ...walked.shots, ...(closes ? [endShot(spec)] : [])];
  const accent = spec.rights === 'third-party' ? undefined : spec.brand?.accent;
  const film = { version: 2, mode: 'pro', look, format: '16:9', ...(accent === undefined ? {} : { accent }), shots };
  const notes = [...walked.left];
  if (take.stoppedAt !== null) notes.push(`the take stopped at row ${take.stoppedAt}: the film plays the steps it finished`);
  if (spec.ending === undefined) notes.push(closes ? 'demo.json has no ending: the closing card carries only the source credit' : 'demo.json has no ending: the film has no closing card');
  return { film, notes };
}
