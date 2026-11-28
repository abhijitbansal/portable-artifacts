// The check film.mjs and guide.mjs share before they draft anything from a take: the take must be of this plan. Its `planKey` is
// `demo-<hash>` of the plan's rows, so a demo.json whose bound fields (a step, origins, mask, session, brand) changed after the take gives
// another hash. Every take step must also be a row of the plan. Each problem is { path, message }, the form `Refused` carries.
import { planHash } from './plan-rows.mjs';

export const STALE = 'this take is of another plan: demo.json changed after the take (a step, origins, mask, session or brand). Undo the change, or plan, approve and take again';

/** The problems of `take` (a readDemoTake result) against `spec` and its planRows `rows`; an empty list when it is a take of this plan. */
export function planProblems({ spec, rows, take }) {
  const errors = [];
  if (planHash(spec, rows) !== take.planKey.replace(/^demo-/, '') || !take.planKey.startsWith('demo-')) errors.push({ path: 'take.planKey', message: STALE });
  const ids = new Set(rows.map((r) => r.id));
  take.steps.forEach((step, i) => {
    if (!ids.has(step.id)) errors.push({ path: `take.steps[${i}].id`, message: `the take has step ${step.id}, which the plan does not have; ${STALE}` });
  });
  return errors;
}

/** The host of the demo's start address, reduced to what cannot read as make-motion markup: a host can hold * _ ( and repeated dots. */
export const hostOf = (spec) => new URL(spec.source.url).host.replace(/[^\p{L}\p{N}.:-]/gu, '').replace(/\.{2,}/g, '.');
