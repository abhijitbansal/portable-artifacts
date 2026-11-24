// A finished experiment for the pass rule's tests: ten prompts, arms A D C, every case ok.
import { verdict } from '../../arms-lib.mjs';

// Five new briefs (`film-*`) and five older prompts.
export const IDS = ['film-1', 'film-2', 'film-3', 'film-4', 'film-5', 'old-1', 'old-2', 'old-3', 'old-4', 'old-5'];
export const COST = { A: 1, D: 0.7, C: 0.6 };
export const FILM = { designedCuts: 3, devices: 4 };

/** `tweak(prompt, arm)` edits a case; `worse(prompt, arm)` puts that arm below A for every one of three readers. */
export function world({ ids = IDS, tweak = () => ({}), worse = () => false } = {}) {
  // the ratio reads usage.costUsd, which follows chargeUsd unless a tweak sets `usage` itself
  const cases = ids.flatMap((prompt) => ['A', 'D', 'C'].map((arm) => {
    const c = { prompt, arm, timedOut: false, capped: false, specExists: true, mp4: true, checkOk: true, chargeUsd: COST[arm], film: { ...FILM }, ...tweak(prompt, arm) };
    return { usage: { costUsd: c.chargeUsd }, ...c };
  }));
  const key = Object.fromEntries(ids.map((p) => [p, { na: 'A', nd: 'D', nc: 'C' }]));
  const reading = (p) => ({ ranks: { na: 1, nd: worse(p, 'D') ? 2 : 1, nc: worse(p, 'C') ? 2 : 1 } });
  const ratings = Object.fromEntries(ids.map((p) => [p, [reading(p), reading(p), reading(p)]]));
  return { cases, ratings, key };
}

export const decide = (w) => verdict(w.cases, w.ratings, w.key);
