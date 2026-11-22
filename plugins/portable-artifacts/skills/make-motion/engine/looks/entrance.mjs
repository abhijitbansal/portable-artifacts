// What validateLook checks of the two entrance moves, `letters` and `lines` (engine/moves), and of the statement entrance
// a look picks (look.kinds.statement.entrance). An entrance is only ever an entrance: its data has no end value (the
// engine's builders end every track at the identity, opacity 1 and offsets 0, which is what the review's "has landed"
// reads), so a field that would hold the part somewhere else is refused. A look drawn by hand writes its text and never
// fades it in, so it takes neither move. Pure and DOM-free.

export const ENTRANCES = Object.freeze(['letters', 'lines']);
// the fields each entrance move takes: an ease and a duration, an optional travel in units, and for letters the seconds
// between one letter and the next
const FIELDS = Object.freeze({ letters: ['ease', 'dur', 'dist', 'stagger'], lines: ['ease', 'dur', 'dist'] });

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const shown = (v) => JSON.stringify(v) ?? 'undefined';

// The errors of one entrance move that the look gives a value (an object).
function moveErrors(name, key, move) {
  const at = `look "${name}": moves.${key}`;
  const extra = Object.keys(move).filter((field) => !FIELDS[key].includes(field));
  if (extra.length > 0) return [`${at} is an entrance and ends at rest: it takes ${FIELDS[key].join(', ')}, not ${extra.map((f) => `"${f}"`).join(', ')}`];
  const errors = [];
  if (key === 'letters' && !(Number.isFinite(move.stagger) && move.stagger >= 0)) errors.push(`${at}.stagger must be a number of seconds, 0 or more, got ${shown(move.stagger)}`);
  if (move.dist !== undefined && !Number.isFinite(move.dist)) errors.push(`${at}.dist must be a finite number of units, got ${shown(move.dist)}`);
  return errors;
}

/**
 * The errors of a look's entrances: each of `letters` and `lines` that has a value takes only its own fields, and none
 * at all in a look drawn by hand (look.hand); a statement entrance (look.kinds.statement.entrance, absent or undefined for
 * the per-word entrance of today) names `letters` or `lines`, a move the look gives a value for, in a look that plays it (not
 * one that opens composed, not a stack, which sets its own words).
 * @returns {string[]}
 */
export function entranceErrors(name, look) {
  const errors = [];
  for (const key of ENTRANCES) {
    const move = look.moves?.[key];
    if (!isPlainObject(move)) continue; // null: unused; a malformed one is the moves check's
    if (look.hand) errors.push(`look "${name}": a look drawn by hand cannot use moves.${key}: what it writes is never faded in`);
    else errors.push(...moveErrors(name, key, move));
  }
  const statement = look.kinds?.statement;
  const entrance = isPlainObject(statement) ? statement.entrance : undefined;
  if (entrance === undefined) return errors;
  const at = `look "${name}": kinds.statement.entrance`;
  if (!ENTRANCES.includes(entrance)) return [...errors, `${at} must be "letters" or "lines", got ${shown(entrance)}`];
  if (!isPlainObject(look.moves?.[entrance])) return [...errors, `${at} "${entrance}" needs moves.${entrance}`];
  // a look that opens composed (look.opens 'set', kinds/shared.mjs opensSet) sets every word from frame 0: nothing to play
  if (look.opens === 'set') return [...errors, `${at} "${entrance}" is not read by a look that opens composed, which sets its words from frame 0`];
  if (look.composition === 'stack') return [...errors, `${at} "${entrance}" is not read by a stack composition, which sets its own words`];
  return errors;
}
