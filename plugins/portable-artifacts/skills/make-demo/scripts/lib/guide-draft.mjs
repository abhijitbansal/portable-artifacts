// The guide spec, by rule, from demo.json, its rows and one take: a make-explainer spec (a `motion` section for the film, then per use case a
// `steps` list of its sentences and one `image` per finished step, the step's own settled frame). Pure: no file, no clock, no model.
// Every path is relative to the folder that holds the guide, which is the demo folder: `video` as given, frames as `take-<n>/frames/<name>`.
// The take must be of this plan (take-plan.mjs), the same check film.mjs makes.
import { sayLine } from './say-line.mjs';
import { Refused } from './demo-out.mjs';
import { planProblems, hostOf } from './take-plan.mjs';

const MAX_SECTIONS = 40; // make-explainer's limit
const TITLE_MAX = 90; // make-explainer's section and page title limit
const NAME_MAX = 60;

const cut = (text, max) => [...text].slice(0, max).join('').trim();
// The page title is rendered as markup by make-explainer (a link, bold, code), so a brand name reaches it as letters, digits, spaces and
// , ' - . & only (sayable's set, plus . and &); a name with no letter or digit gives the host.
function titleName(text, fallback) {
  const plain = text.replace(/[^\p{L}\p{N} ,'.&-]+/gu, ' ').replace(/ +/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(plain) ? plain : fallback;
}

function useCaseSection({ useCase, steps, byId, take }) {
  const lines = steps.map((s) => sayLine(byId.get(s.id)));
  const src = take.dir.split(/[\\/]/).at(-1);
  const images = steps.map((s, i) => ({ type: 'image', src: `${src}/frames/${take.frames[s.settledIndex]}`, alt: lines[i], caption: lines[i] }));
  const list = { type: 'steps', id: `uc-${useCase.id}`, title: cut(useCase.title, TITLE_MAX), items: lines.map((title) => ({ title })) };
  return { list, images };
}

function useCaseSections({ spec, rows, take }) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const rowUseCase = new Map(rows.map((r) => [r.id, r.useCase]));
  const left = [];
  const found = [];
  for (const useCase of spec.useCases) {
    const steps = take.steps.filter((s) => rowUseCase.get(s.id) === useCase.id);
    if (steps.length === 0) left.push(`use case ${useCase.id} left out: the take finished none of its steps`);
    else found.push(useCaseSection({ useCase, steps, byId, take }));
  }
  return { found, left };
}

/**
 * -> { guide, notes }. `spec` is a valid demo.json, `rows` its planRows rows, `take` a readDemoTake result, `video` the film's path relative to
 * the demo folder. Throws a Refused (with { path, message } errors) for a take of another plan or a take step the plan lacks.
 */
export function draftGuide({ spec, rows, take, video }) {
  const errors = planProblems({ spec, rows, take });
  if (errors.length > 0) throw new Refused(errors);
  const thirdParty = spec.rights === 'third-party';
  const host = hostOf(spec);
  const name = cut(thirdParty || spec.brand?.name === undefined ? host : titleName(spec.brand.name, host), NAME_MAX);
  const head = [{ type: 'motion', video, caption: 'The whole walkthrough, played as a short film.' }];
  if (thirdParty) head.push({ type: 'callout', tone: 'info', title: 'Source', text: `Source: ${host}. Not made by its owner.` });
  const { found, left } = useCaseSections({ spec, rows, take });
  const notes = [...left];
  if (take.stoppedAt !== null) notes.push(`the take stopped at row ${take.stoppedAt}: the guide shows the steps it finished`);
  const total = head.length + found.reduce((sum, uc) => sum + 1 + uc.images.length, 0);
  const trim = total > MAX_SECTIONS;
  if (trim) notes.push(`the guide would have more than ${MAX_SECTIONS} sections: only the last step of each use case keeps its picture`);
  const body = found.flatMap((uc) => [uc.list, ...(trim ? uc.images.slice(-1) : uc.images)]);
  return { guide: { title: `${name} walkthrough`, sections: [...head, ...body] }, notes };
}
