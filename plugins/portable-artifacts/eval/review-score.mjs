// The pass bar for the second reviewer (agents/motion-reviewer.md). Pure: no model, no browser, no file.
// A proof runs the reviewer PROOF_RUNS times on each of five films: one good film and four with one planted defect.
// The reviewer may be named in references/reviewing.md only when every planted defect is found in every run and the
// good film is failed at most MAX_FALSE_FAILS times. Counting false fails is what stops a reviewer that says "fail" to
// everything from passing by finding every defect.
export const PROOF_RUNS = 3;
export const MAX_FALSE_FAILS = 1;
export const GOOD_FIXTURE = 'good';

const FINDING_LEVELS = new Set(['P0', 'P1']);

// One run finds a planted defect when the verdict is "fail" and a P0 or P1 note names the planted shot.
function isFind(result, shot) {
  if (result.verdict !== 'fail') return false;
  return (Array.isArray(result.notes) ? result.notes : []).some((n) => FINDING_LEVELS.has(n?.level) && n?.shot === shot);
}

const isVerdict = (v) => v === 'pass' || v === 'fail';

/**
 * @param {{ fixture: string, run: number, verdict: 'pass' | 'fail', notes: { level: string, shot: string }[] }[]} results
 * @param {Record<string, { shot: string }>} planted  the bad films and the shot each one plants
 * @returns {{ found: Record<string, number>, falseFails: number, pass: boolean, problems: string[] }}
 */
export function scoreProof(results, planted, { runs = PROOF_RUNS } = {}) {
  const list = Array.isArray(results) ? results : [];
  const problems = [];
  const found = {};
  const runNumbers = Array.from({ length: runs }, (_, i) => i + 1);
  const resultFor = (fixture, run) => list.find((r) => r?.fixture === fixture && r?.run === run);

  for (const [fixture, { shot }] of Object.entries(planted)) {
    found[fixture] = 0;
    for (const run of runNumbers) {
      const r = resultFor(fixture, run);
      if (!r) problems.push(`${fixture}: run ${run} is missing`);
      else if (!isVerdict(r.verdict)) problems.push(`${fixture}: run ${run} has no pass or fail verdict`);
      else if (isFind(r, shot)) found[fixture] += 1;
      else problems.push(`${fixture}: run ${run} did not fail the film with a P0 or P1 note on shot ${shot}`);
    }
  }

  let falseFails = 0;
  for (const run of runNumbers) {
    const r = resultFor(GOOD_FIXTURE, run);
    if (!r) problems.push(`${GOOD_FIXTURE}: run ${run} is missing`);
    else if (!isVerdict(r.verdict)) problems.push(`${GOOD_FIXTURE}: run ${run} has no pass or fail verdict`);
    else if (r.verdict === 'fail') falseFails += 1;
  }
  if (falseFails > MAX_FALSE_FAILS) problems.push(`${GOOD_FIXTURE}: ${falseFails} false fails (at most ${MAX_FALSE_FAILS} allowed)`);

  return { found, falseFails, pass: problems.length === 0, problems };
}
