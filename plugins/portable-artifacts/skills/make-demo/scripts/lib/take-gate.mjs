// The approval gate: may a take run? Pure, no page, no file. A take runs only when the owner approved this plan:
//   - the answers file passed make-explainer's answers.mjs (`answers` is its parsed --json result),
//   - the plan recomputed from demo.json and scout.json is the plan on the page the owner answered (`demo-<hash>` is the page's key),
//   - the verdict is `approve` (not `approve-with-changes`, not `not-yet`),
//   - every danger row has its own `danger-<step id>` approval answered `approve`; a plan with no danger row has
//     `rows-as-listed` answered `approve`.
// Every refusal is { path, message } and names the row or field. A missing answer is a refusal, never a pass.
import { agentJson } from '../../shared/agent-text.mjs';
import { planRows } from './plan-rows.mjs';

const APPROVE = 'approve';
const ROWS_AS_LISTED = 'rows-as-listed';
const ECHO_MAX = 60; // any value echoed from a file: quoted, escaped and cut
const refuse = (errors) => ({ ok: false, errors });
const echo = (value) => agentJson(value, { max: ECHO_MAX });

// choices.approvals is a plain object read from JSON: own keys only.
const choiceOf = (approvals, id) => (Object.hasOwn(approvals, id) ? approvals[id] : undefined);
const shownChoice = (choice) => (choice === undefined ? 'missing from the answers' : choice === null ? 'not answered' : `answered ${echo(choice)}`);

// The ids, with the words to say about each: one per danger row, or the one for a plan with none.
function requiredApprovals(rows) {
  const danger = rows.filter((r) => r.effect === 'danger');
  if (danger.length === 0) return [{ id: ROWS_AS_LISTED, what: 'the rows as listed (no row is a danger row)' }];
  return danger.map((r) => ({ id: `danger-${r.id}`, what: `danger row ${r.n} (step ${echo(r.id)})` }));
}

function answerErrors(choices, rows) {
  const errors = [];
  if (choices.verdict !== APPROVE) {
    const given = choices.verdict === undefined || choices.verdict === null ? 'none' : echo(choices.verdict);
    errors.push({ path: 'answers.choices.verdict', message: `the verdict is ${given}; a take needs "approve"` });
  }
  const approvals = choices.approvals !== null && typeof choices.approvals === 'object' ? choices.approvals : {};
  for (const { id, what } of requiredApprovals(rows)) {
    const choice = choiceOf(approvals, id);
    if (choice !== APPROVE) errors.push({ path: `answers.choices.approvals.${id}`, message: `${what} needs its own "approve"; ${id} is ${shownChoice(choice)}` });
  }
  return errors;
}

/**
 * `spec` is the validated demo.json, `scout` the parsed scout.json, `clickPlan` the click-plan.json page spec (only its `key` is
 * read) and `answers` the parsed `answers.mjs --json` result.
 * -> { ok: true, rows, hash } | { ok: false, errors: [{ path, message }] }
 */
export function gate({ spec, scout, clickPlan, answers }) {
  if (answers === null || typeof answers !== 'object' || answers.ok !== true) {
    return refuse([{ path: 'answers', message: 'the answers did not pass make-explainer answers.mjs; fix the file or answer the plan page again' }]);
  }
  const { choices } = answers;
  if (choices === null || typeof choices !== 'object') return refuse([{ path: 'answers.choices', message: 'the answers carry no choices; run make-explainer answers.mjs --json on them' }]);
  const planned = planRows(spec, scout);
  if (planned.errors.length > 0) return refuse(planned.errors);
  const key = `demo-${planned.hash}`;
  if (clickPlan?.key !== key) {
    return refuse([{ path: 'clickPlan.key', message: `demo.json and scout.json now make plan ${key}, but the approved plan is ${echo(clickPlan?.key)}; build the plan again and ask for a new yes` }]);
  }
  const errors = answerErrors(choices, planned.rows);
  return errors.length > 0 ? refuse(errors) : { ok: true, rows: planned.rows, hash: planned.hash };
}
