// Explicit data assertions, independent of title wording and visual highlighting.
// Read the same materialized rows as the renderer; never rerun SQL or aggregate here.
import { classOf } from './kinds.mjs';
import { agentJson } from '../../shared/agent-text.mjs';

export function assertionErrors(chart, result, path) {
  if (!chart.assert) return [];
  const fail = (message) => [{ path: `${path}.assert`, message }];
  const { category } = chart.assert;
  const { x, y } = chart;
  const expected = agentJson(category);
  const xName = agentJson(x);
  const yName = agentJson(y);
  if (classOf(result.types[result.columns.indexOf(x)]) !== 'nominal') return fail('max assertion needs a categorical x column; time buckets are not supported');
  if (result.truncated) return fail(`query ${agentJson(chart.query)} is truncated; increase maxRows to compare every query row`);
  if (!result.rows.length) return fail(`query ${agentJson(chart.query)} returned no rows; cannot check the maximum`);

  const values = new Map();
  let winner;
  let maximum = -Infinity;
  let tied = false;
  for (const [i, row] of result.rows.entries()) {
    const label = row[x];
    const value = row[y];
    if (typeof label !== 'string') return fail(`row ${i + 1}: ${xName} must be a non-null string category`);
    if (values.has(label)) return fail(`duplicate category ${agentJson(label)} in ${xName}; aggregate to one row per category in SQL`);
    // DuckDB preserves wide integers/decimals as strings. Number(...) could turn distinct values into a tie
    // or a false winner; leave the assertion unevaluated instead of pretending that precision survived.
    if (typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value))) {
      return fail(`row ${i + 1}: ${yName} cannot be compared without risking precision loss; exact numeric strings and unsafe integers are not supported by max assertions`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`row ${i + 1}: ${yName} must be a finite number (null and nonfinite values cannot establish a maximum)`);
    values.set(label, value);
    if (value > maximum) { maximum = value; winner = label; tied = false; }
    else if (value === maximum) tied = true;
  }
  if (!values.has(category)) return fail(`${expected} not found in ${xName}; expected it to have the unique maximum ${yName}`);
  if (tied) return fail(`expected ${expected} to have the unique maximum ${yName}; multiple categories tie at ${maximum}`);
  if (winner !== category) return fail(`expected ${expected} (${values.get(category)}) to have the unique maximum ${yName}; ${agentJson(winner)} has ${maximum}`);
  return [];
}
