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
const LIFTABLE = new Set(['hover', 'show', 'type', 'select']); // a card, a field or a panel; a raised button reads badly
const CUT = { keynote: 'zoom', desk: 'crossfade' };

const cut = (text, max) => [...text].slice(0, max).join('').trim();
const sayName = (text) => text.replace(/[^\p{L}\p{N} ,'-]+/gu, ' ').replace(/ +/g, ' ').trim();

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

function walkShot({ useCase, steps, rows, src }) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const lift = liftOf(steps);
  return {
    id: `uc-${useCase.id}`,
    show: 'walk',
    src,
    frame: 'window',
    title: cut(useCase.title, TITLE_MAX),
    say: steps.map((s) => sayLine(byId.get(s.id))).join(' '),
    steps: steps.map((s) => ({ id: s.id })),
    ...(lift ? { lift: [{ step: lift.id }] } : {}),
  };
}

// The cut into the first walk shot, when a shot comes before it: make-motion refuses any cut but the hard cut on a film's first shot.
function walkShots({ spec, rows, take }, look, hasOpening) {
  const rowUseCase = new Map(rows.map((r) => [r.id, r.useCase]));
  const src = take.dir.split(/[\\/]/).at(-1);
  const left = [];
  const shots = [];
  for (const useCase of spec.useCases) {
    const steps = take.steps.filter((s) => rowUseCase.get(s.id) === useCase.id);
    if (steps.length === 0) left.push(`use case ${useCase.id} left out: the take finished none of its steps`);
    else shots.push(walkShot({ useCase, steps, rows, src }));
  }
  if (shots.length > 0 && hasOpening) shots[0] = { ...shots[0], cut: CUT[look] };
  return { shots, left };
}

function endShot(spec) {
  const { ending, brand } = spec;
  const thirdParty = spec.rights === 'third-party';
  const name = brand?.name === undefined ? hostOf(spec) : sayName(brand.name) || hostOf(spec);
  const mark = thirdParty ? `Source: ${hostOf(spec)}` : brand?.name;
  return { id: 'close', show: 'end', say: ending.say ?? `That is ${thirdParty ? hostOf(spec) : name}.`, ask: ending.ask, ...(mark === undefined ? {} : { mark }) };
}

/**
 * -> { film, notes }. `spec` is a valid demo.json, `rows` its planRows rows, `scout` the parsed scout.json, `take` a readDemoTake result.
 * Throws a Refused (with { path, message } errors) for a take of another plan, a take step the plan lacks, or a fact from a page scout did not read.
 */
export function draftFilm({ spec, rows, scout, take }) {
  const errors = problems({ spec, rows, scout, take });
  if (errors.length > 0) throw new Refused(errors);
  const look = spec.look ?? DEFAULT_LOOK;
  const walked = walkShots({ spec, rows, take }, look, spec.opening !== undefined);
  const shots = [...openingShots(spec.opening), ...walked.shots, ...(spec.ending === undefined ? [] : [endShot(spec)])];
  const accent = spec.rights === 'third-party' ? undefined : spec.brand?.accent;
  const film = { version: 2, mode: 'pro', look, format: '16:9', ...(accent === undefined ? {} : { accent }), shots };
  const notes = [...walked.left];
  if (take.stoppedAt !== null) notes.push(`the take stopped at row ${take.stoppedAt}: the film plays the steps it finished`);
  if (spec.ending === undefined) notes.push('demo.json has no ending: the film has no closing card');
  return { film, notes };
}
