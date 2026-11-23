// The film's cuts, validated: a shot's `cut` and the root `cut` (the default of every shot after the first) are a cut
// name or { type, direction?, duration?, smear?, at? } (engine/cuts/resolve.mjs). Every error is { path, message } with a
// did-you-mean where a near name exists. Split out of spec.mjs.
import { registries as defaultRegistries } from '../../engine/registry.mjs';
import { CUT_KEYS, DEFAULT_CUT, cutOptionProblems } from '../../engine/cuts/resolve.mjs';
import { didYouMean, pathJoin } from '../../shared/errors.mjs';
import { isPlainObject, quote } from './spec-common.mjs';

const SHAPE = '{ "type": name, "direction"?, "duration"?, "smear"?, "at"? }';

// The names of the other looks whose cuts hold `name` (a cut parked in one look is still shipped by the rest).
function lookNamesWithCut(name, look, looks) {
  if (!looks) return [];
  return looks.names().filter((other) => other !== look.name && looks.get(other).cuts?.includes(name));
}

// The cut name `name` at `at`, against the look's cuts (look.cuts): the look and its cuts on a miss, and the looks that
// do have the cut when there are any.
function nameErrors(name, at, look, looks) {
  if (typeof name !== 'string' || name === '') return [{ path: at, message: `must be a cut name such as "slide", got ${quote(name)}` }];
  if (!look) return [];
  const cuts = look.cuts ?? [];
  if (cuts.includes(name)) return [];
  const hint = didYouMean(name, cuts);
  const elsewhere = lookNamesWithCut(name, look, looks);
  const support = elsewhere.length > 0 ? `; the looks that support it: ${elsewhere.join(', ')}` : '';
  return [{ path: at, message: `look "${look.name}" has no cut ${quote(name)}; ${hint ? `did you mean "${hint}"? Its` : 'its'} cuts are: ${cuts.join(', ')}${support}` }];
}

// A cut object: a type the look lists, then its options (engine/cuts/resolve.mjs cutOptionProblems, unknown keys included).
function objectErrors(cut, at, look, cuts, looks) {
  if (cut.type === undefined) {
    // only the keys no cut takes: the others cannot be judged without a type
    const unknown = cutOptionProblems(Object.fromEntries(Object.entries(cut).filter(([key]) => !CUT_KEYS.includes(key))), DEFAULT_CUT, { cuts });
    return [...unknown.map((p) => ({ path: pathJoin(at, p.key), message: p.message })), { path: at, message: `a cut object needs "type", the cut's name, for example { "type": "slide", "direction": "left" }` }];
  }
  const named = nameErrors(cut.type, pathJoin(at, 'type'), look, looks);
  if (named.length > 0 || !cuts.has(cut.type)) return named;
  return cutOptionProblems(cut, cut.type, { cuts }).map((p) => ({ path: pathJoin(at, p.key), message: p.message }));
}

// A cut's `at` names a target of the shot before (`outgoing`: { id, kind, targets }, targets null when they cannot be
// known): a name that shot lacks is an error listing the names it has, never an opening from the middle in silence. Judged
// only when the option itself is sound (the cut opens from a point, `at` is a name), which cutOptionProblems reports.
function originErrors(cut, at, cuts, outgoing) {
  const where = pathJoin(at, 'at');
  if (outgoing === null || outgoing.targets === null || typeof cut.at !== 'string' || cut.at === '') return [];
  if (!cuts.has(cut.type) || cuts.get(cut.type).origin !== true) return [];
  const { id, kind, targets } = outgoing;
  if (targets.length === 0) return [{ path: where, message: `shot ${quote(id)} (${kind}) has no targets for a cut to open from; remove "at"` }];
  if (targets.includes(cut.at)) return [];
  const near = didYouMean(cut.at, targets);
  const hint = near ? `did you mean "${near}"? All ` : '';
  return [{ path: where, message: `unknown target ${quote(cut.at)}; ${hint}the targets of shot ${quote(id)} (${kind}) are: ${targets.join(', ')}` }];
}

/**
 * The errors of the cut value `cut` at path `at`: a name or an object, in `look` (its `cuts`; null skips the name check
 * when the look is unknown, which has its own error). `first`: the film's first shot, which accepts only the hard cut.
 * `outgoing`: the shot before, { id, kind, targets: string[] | null }, for the cut's `at`; null when there is none.
 */
export function cutErrors(cut, at, { look, first = false, regs = defaultRegistries, outgoing = null }) {
  const cuts = regs.cuts ?? defaultRegistries.cuts;
  const looks = regs.looks ?? null;
  const name = typeof cut === 'string' ? cut : cut?.type;
  if (first && name !== DEFAULT_CUT && (typeof cut === 'string' || isPlainObject(cut))) {
    return [{ path: at, message: `the first shot has nothing before it to cut from; remove "cut", or write "cut": "cut" (got ${quote(name ?? cut)})` }];
  }
  if (typeof cut === 'string') return nameErrors(cut, at, look, looks);
  if (isPlainObject(cut)) return [...objectErrors(cut, at, look, cuts, looks), ...originErrors(cut, at, cuts, outgoing)];
  return [{ path: at, message: `must be a cut name such as "slide", or ${SHAPE}; got ${quote(cut)}` }];
}
