// The `walk` kind's preparer: reads the shot's take folder (scripts/v2/take.mjs, which refuses a take that breaks a rule)
// and hands the page the take as plain JSON: the frame names, the steps with their 0-based indexes, the size and
// signedIn, plus `distinct`, the count of distinct names. No path leaves Node: the take's folders are dropped here.
// A refused take is a problem at the shot's `src`, with no data. The shot's steps are then held to the take (walk-time.mjs
// walkProblems): a step the take lacks, steps out of its order, and some steps with neither an `at` nor a sentence of
// their own. The sentences are counted from the say, which does not depend on the voice. Deterministic; never touches the
// network. Node only.
import { SpecError } from '../spec-common.mjs';
import { readTake } from '../take.mjs';
import { parseSay, SayError } from '../../../engine/script/say.mjs';
import { walkProblems } from '../../../engine/kinds/walk-time.mjs';

// The shot's timing as far as walkProblems reads it: as many sentences as its say has (a say that does not parse has its
// own validation error, and no sentences here).
function sayTiming(say) {
  if (typeof say !== 'string') return { sentences: [] };
  try {
    const { tokens } = parseSay(say);
    const count = tokens.filter((t, i) => t.sentenceEnd || i === tokens.length - 1).length;
    return { sentences: Array.from({ length: count }, () => ({})) };
  } catch (err) {
    if (err instanceof SayError) return { sentences: [] };
    throw err;
  }
}

/** @returns {{ data: object | null, problems: { path: string, message: string }[] }} problem paths are relative to the shot */
export function prepareWalk(shot, { filmDir, index = 0 } = {}) {
  const owner = `shots[${index}]`;
  try {
    const { dir, framesDir, ...take } = readTake(filmDir, shot.src, { owner });
    const data = { ...take, distinct: new Set(take.names).size };
    // prepareFilm runs on a validated film, whose walk shot has its steps (a bare shot, as a reader test makes, has none to hold)
    return { data, problems: Array.isArray(shot.steps) ? walkProblems(shot, sayTiming(shot.say), data) : [] };
  } catch (err) {
    if (!(err instanceof SpecError)) throw err;
    return { data: null, problems: err.errors.map(({ path: at, message }) => ({ path: at.slice(owner.length + 1), message })) };
  }
}
