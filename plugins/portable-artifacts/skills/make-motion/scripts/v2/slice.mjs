// A slice of a film: the frames of one shot (--shot <id>) or of a range of film time (--range <from>..<to>), inclusive. The
// sheets and the review run over the slice alone; its frames are the film's own, named by their absolute index (the page
// seeks by frame, so a frame of a slice is the frame the whole film has at that index). Pure: no clock, no browser.
import { UsageError } from '../../shared/cli.mjs';
import { echoValue } from '../../engine/script/anchors.mjs';
import { FilmTimeError, filmFrame, filmSeconds } from './film-time.mjs';
import { auditMoments } from './plan.mjs';
import { RANGE_FORM, rangeParts } from './range-form.mjs';

/** The review rules that need the whole film and are not run on a slice (the report's slice.skipped). */
export const SLICE_SKIPPED = Object.freeze(['loop', 'cut-variety', 'sameness']);
const RANGE_FLAG = '--range';

/** Does the run ask for a slice (--shot or --range)? */
export const isSlice = (options) => typeof options?.shot === 'string' || typeof options?.range === 'string';

const firstFrameOf = (timeline, shot) => Math.round(shot.start * timeline.fps);
const lastFrameOf = (timeline, shot) => Math.round(shot.end * timeline.fps) - 1;

// The shots whose frames meet [from, to], by id, in film order.
function shotsIn(timeline, from, to) {
  return timeline.shots.filter((shot) => firstFrameOf(timeline, shot) <= to && lastFrameOf(timeline, shot) >= from).map((shot) => shot.id);
}

function shotSlice(id, film, timeline) {
  const shot = timeline.shots.find((s) => s.id === id);
  if (shot === undefined) {
    const ids = (film?.shots ?? timeline.shots).map((s) => s.id);
    throw new FilmTimeError(`no shot ${JSON.stringify(echoValue(id))} in the film; the shots are: ${ids.join(', ')}`, ids);
  }
  return { from: firstFrameOf(timeline, shot), to: lastFrameOf(timeline, shot), label: id, shots: [id] };
}

function rangeSlice(text, film, timeline) {
  const [first, last] = rangeParts(text);
  const from = filmFrame(first, film, timeline, RANGE_FLAG), to = filmFrame(last, film, timeline, RANGE_FLAG);
  if (from > to) throw new UsageError(`${RANGE_FORM}; ${JSON.stringify(echoValue(first))} is frame ${from}, after ${JSON.stringify(echoValue(last))} at frame ${to}`);
  return { from, to, label: `range-${from}-${to}`, shots: shotsIn(timeline, from, to) };
}

/**
 * The slice `--shot` or `--range` names, or null for neither: { from, to, label, shots } with `from` and `to` frame
 * indices (inclusive), `label` the shot id or `range-<from>-<to>`, `shots` the ids of the shots it touches. An id the film
 * lacks, or a reference that names nothing, is a FilmTimeError (its `hint` lists the shots); a range with no "..", or
 * one that runs backwards, is a UsageError naming the form.
 */
export function sliceOf({ shot, range }, film, timeline) {
  if (typeof shot === 'string') return shotSlice(shot, film, timeline);
  if (typeof range === 'string') return rangeSlice(range, film, timeline);
  return null;
}

/**
 * What a slice run refuses before any voice is made, on the timeline loadFilm built (estimated for a voiced film): a shot the
 * film lacks, a --range with no "..", a reference that names nothing. Whether the range runs backwards is judged on the
 * timeline the film is drawn with (sliceOf), as the estimate could differ from it by a frame.
 */
export function checkSlice({ shot, range }, film, timeline) {
  if (typeof shot === 'string') shotSlice(shot, film, timeline);
  if (typeof range === 'string') rangeParts(range).forEach((ref) => filmSeconds(ref, film, timeline));
}

/**
 * The sheets a slice keeps (planSheets' sheets): a shot sheet keeps only the tiles whose frame is inside the slice and
 * goes when none is left; a cut strip stays, whole with its side frames, only when the first frame of its window is inside.
 */
export function sliceSheets(sheets, slice) {
  const inside = (frame) => frame >= slice.from && frame <= slice.to;
  return sheets.flatMap((sheet) => {
    if (sheet.kind === 'cut') return inside(sheet.windowFrom) ? [sheet] : [];
    const tiles = sheet.tiles.filter((tile) => inside(tile.frame));
    return tiles.length === 0 ? [] : [{ ...sheet, tiles }];
  });
}

/**
 * The frames the review snapshots for a slice, in order, each once: the audit frames inside the slice (`judged`), and,
 * when they lie outside it (not judged), the last frame of every shot the slice touches (so the shot's texts have a rest
 * scale, which restingByShot reads from it) and the last frame of the shot before each shot whose cut window opens inside
 * the slice (the picture a `match` cut is compared with).
 * @returns {{ frame: number, judged: boolean }[]}
 */
export function sliceAuditPlan(film, timeline, slice) {
  const inside = (frame) => frame >= slice.from && frame <= slice.to;
  const judged = new Set(auditMoments(film, timeline).filter(inside));
  const opening = new Set(shotsOpeningIn(timeline, slice));
  const rests = timeline.shots.flatMap((shot, index) => {
    const touched = slice.shots.includes(shot.id);
    const beforeAnOpening = index + 1 < timeline.shots.length && opening.has(timeline.shots[index + 1].id);
    return touched || beforeAnOpening ? [lastFrameOf(timeline, shot)] : [];
  });
  return [...new Set([...judged, ...rests])].sort((a, b) => a - b).map((frame) => ({ frame, judged: judged.has(frame) }));
}

/** The ids of the shots a slice covers from their first frame to their last (the review judges "never settles" on those alone). */
export function shotsWhollyIn(timeline, slice) {
  return timeline.shots.filter((shot) => firstFrameOf(timeline, shot) >= slice.from && lastFrameOf(timeline, shot) <= slice.to).map((shot) => shot.id);
}

/** The ids of the shots whose first frame is inside the slice (a cut's window opens there). */
export function shotsOpeningIn(timeline, slice) {
  return timeline.shots.filter((shot) => firstFrameOf(timeline, shot) >= slice.from && firstFrameOf(timeline, shot) <= slice.to).map((shot) => shot.id);
}
