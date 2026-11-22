// The two spec-only rules, `cut-variety` and `sameness`: they read the film and its timeline and nothing that is drawn, so
// `--outline` runs them and the full review runs them again (scripts/v2/review.mjs). Pure. Both are creative: a film made
// of one cut, or of three shots alike, can be intended, so a finding asks and never fails the run. `capCreative` keeps the
// first few of each a film, so a film built of one pattern is told once and not thirty times.
import { resolveShotCut, filmLook } from '../cuts/resolve.mjs';

/** A film with fewer seams (the arrival at each shot after the first) is never judged: with three, any cut is "more than two thirds". */
export const MIN_SEAMS = 4;
/** `cut-variety` fires when one windowed cut takes more than this share of the seams. Not the cut-window rule's share of a shot. */
export const REPEATED_CUT_SHARE = 2 / 3;
/** `sameness` fires on this many shots in a row, or more, that share a kind, a windowed cut or a move. */
export const SAME_RUN = 3;
/** Findings of one capped rule a film keeps; the rest are counted in the last one kept. */
export const CREATIVE_CAP = 2;
/** The rules `capCreative` caps. W2's composition rules (`COMPOSITION_RULES`, frame.mjs) are capped by `capComposition`, by measure. A later rule that is capped by time appends its id. */
export const CAPPED_HERE = Object.freeze(['cut-variety', 'sameness']);

const SHARE_EPSILON = 1e-9;

/** `cut` on the film, or on the shot that names it: where the author changes a cut (a shot with no cut of its own takes the film's, or the look's pick). */
const cutPath = (film, index) => (film.shots[index].cut === undefined ? 'cut' : `shots[${index}].cut`);

/** The cuts the look allows but `name`: what a finding suggests in its place. */
const cutsInstead = (film, name) => (filmLook(film)?.cuts ?? []).filter((cut) => cut !== name);

/** { index, name } of every seam whose cut has a window (a duration above 0): the plain cut changes the subject and is never counted as a repeat. */
function windowedSeams(film) {
  return film.shots.flatMap((_, index) => {
    const cut = resolveShotCut(film, index);
    return cut !== null && cut.dur > 0 ? [{ index, name: cut.name }] : [];
  });
}

/**
 * One finding when a windowed cut opens more than two thirds of a film's shots after the first. At the first shot that uses it.
 * @returns {{ kind: 'creative', shot: string, path: string, t: number, rule: 'cut-variety', node: string, message: string, suggest: { cuts: string[] } }[]}
 */
export function cutVarietyFindings(film, timeline) {
  const seams = film.shots.length - 1;
  if (seams < MIN_SEAMS) return [];
  const counts = new Map();
  const first = new Map();
  for (const { index, name } of windowedSeams(film)) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (!first.has(name)) first.set(name, index);
  }
  return [...counts].filter(([, count]) => count / seams > REPEATED_CUT_SHARE + SHARE_EPSILON).map(([name, count]) => {
    const index = first.get(name);
    return {
      kind: 'creative', shot: timeline.shots[index].id, path: cutPath(film, index), t: timeline.shots[index].start, rule: 'cut-variety', node: name,
      message: `${count} of the ${seams} cuts are the ${name}, more than two thirds of them; give some shots another cut, so the film says how each pair of shots relates`,
      suggest: { cuts: cutsInstead(film, name) },
    };
  });
}

// The devices a shot's `on` events place, each once, in name order: its move. '' for a shot that places none.
const moveOf = (shot) => [...new Set((shot.on ?? []).map((event) => event.do))].sort().join('+');

/** The runs of `SAME_RUN` or more equal keys in `keys`, as [first, last] indexes; a falsy key ends a run and never starts one. */
function runsOf(keys) {
  const runs = [];
  let start = 0;
  for (let i = 1; i <= keys.length; i += 1) {
    if (i < keys.length && keys[i] && keys[i] === keys[start]) continue;
    if (keys[start] && i - start >= SAME_RUN) runs.push([start, i - 1]);
    start = i;
  }
  return runs;
}

/**
 * One finding per run of `SAME_RUN` or more shots in a row with the same kind, the same windowed cut or the same move,
 * at the third shot of the run. A shot that places no device has no move to share.
 * @returns {{ kind: 'creative', shot: string, path: string, t: number, rule: 'sameness', node: string, message: string, suggest?: { cuts: string[] } }[]}
 */
export function samenessFindings(film, timeline) {
  const windowed = new Map(windowedSeams(film).map(({ index, name }) => [index, name]));
  const forms = [
    { keys: film.shots.map((shot) => shot.show), field: 'show', node: (key) => `kind:${key}`, say: (key) => `the ${key} kind`, fix: 'another kind' },
    { keys: film.shots.map((_, i) => windowed.get(i) ?? ''), field: 'cut', node: (key) => `cut:${key}`, say: (key) => `the ${key} cut`, fix: 'another cut' },
    { keys: film.shots.map(moveOf), field: 'on', node: (key) => `move:${key}`, say: (key) => `the same move (${key.replaceAll('+', ' and ')})`, fix: 'another move' },
  ];
  return forms.flatMap(({ keys, field, node, say, fix }) => runsOf(keys).map(([first, last]) => {
    const third = first + SAME_RUN - 1, key = keys[first];
    const ids = `"${timeline.shots[first].id}" to "${timeline.shots[last].id}"`;
    return {
      kind: 'creative', shot: timeline.shots[third].id, path: field === 'cut' ? cutPath(film, third) : `shots[${third}].${field}`, t: timeline.shots[third].start,
      rule: 'sameness', node: node(key),
      message: `${last - first + 1} shots in a row (${ids}) have ${say(key)}; give one of them ${fix}`,
      ...(field === 'cut' ? { suggest: { cuts: cutsInstead(film, key) } } : {}),
    };
  }));
}

/** Both rules' findings, in time order. */
export const outlineFindings = (film, timeline) => [...cutVarietyFindings(film, timeline), ...samenessFindings(film, timeline)].sort((a, b) => a.t - b.t);

/**
 * At most `CREATIVE_CAP` findings of each rule in `CAPPED_HERE`: the earliest stay, in their place in the list, and the
 * last of them says how many were left out and in which shots. Every other finding passes through untouched; the input
 * is not changed.
 */
export function capCreative(findings) {
  const dropped = new Set();
  const lastKept = new Map(); // rule -> the finding that carries the count
  const leftOut = new Map(); // rule -> findings past the cap, in time order
  for (const rule of CAPPED_HERE) {
    const ofRule = findings.filter((f) => f.rule === rule).sort((a, b) => a.t - b.t);
    if (ofRule.length <= CREATIVE_CAP) continue;
    ofRule.slice(CREATIVE_CAP).forEach((f) => dropped.add(f));
    lastKept.set(ofRule[CREATIVE_CAP - 1], rule);
    leftOut.set(rule, ofRule.slice(CREATIVE_CAP));
  }
  return findings.filter((f) => !dropped.has(f)).map((f) => {
    const rule = lastKept.get(f);
    if (rule === undefined) return f;
    const more = leftOut.get(rule);
    return { ...f, message: `${f.message} (and ${more.length} more: ${[...new Set(more.map((m) => m.shot))].join(', ')})` };
  });
}
