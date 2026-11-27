// The `walk` kind's preparer: reads the shot's take folder (scripts/v2/take.mjs, which refuses a take that breaks a rule)
// and hands the page the take as plain JSON: the frame names, the steps with their 0-based indexes, the size and
// signedIn, plus `distinct`, the count of distinct names. No path leaves Node: the take's folders are dropped here.
// A refused take is a problem at the shot's `src`, with no data. Deterministic; never touches the network. Node only.
import { SpecError } from '../spec-common.mjs';
import { readTake } from '../take.mjs';

/** @returns {{ data: object | null, problems: { path: string, message: string }[] }} problem paths are relative to the shot */
export function prepareWalk(shot, { filmDir, index = 0 } = {}) {
  const owner = `shots[${index}]`;
  try {
    const { dir, framesDir, ...take } = readTake(filmDir, shot.src, { owner });
    return { data: { ...take, distinct: new Set(take.names).size }, problems: [] };
  } catch (err) {
    if (!(err instanceof SpecError)) throw err;
    return { data: null, problems: err.errors.map(({ path: at, message }) => ({ path: at.slice(owner.length + 1), message })) };
  }
}
