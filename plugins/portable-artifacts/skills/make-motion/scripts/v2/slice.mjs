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
const PNG = '.png';
const FRAME_EPSILON = 1e-6; // a time a microsecond short of a frame is that frame

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

// A range whose first time comes after its second: the form, then which one is after which.
const backwardsError = (first, last, verb) => new UsageError(`${RANGE_FORM}; ${JSON.stringify(echoValue(first))} ${verb} ${JSON.stringify(echoValue(last))}`);

function rangeSlice(text, film, timeline) {
  const [first, last] = rangeParts(text);
  const from = filmFrame(first, film, timeline, RANGE_FLAG), to = filmFrame(last, film, timeline, RANGE_FLAG);
  if (from > to) throw backwardsError(first, last, `is frame ${from}, after`);
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

const PLAIN_SECONDS_RE = /^\d+(\.\d+)?$/;
const SHOT_SEPARATOR = '@';
const ANCHOR_OFFSET_RE = /[+-]/;

// The index of the shot a reference names outright (`<id>`, or `<id>@<anchor>` where the anchor cannot leave the shot), or
// -1: such a reference is in that shot whatever the timeline's times turn out to be. An anchor with a +/- offset can leave
// it, and so can a plain number of seconds, which is not clamped to the shot (`hook@3` may be in a later shot).
function shotIndexOf(ref, timeline) {
  if (PLAIN_SECONDS_RE.test(ref)) return -1;
  const at = ref.indexOf(SHOT_SEPARATOR);
  const anchor = at < 0 ? '' : ref.slice(at + 1);
  const index = timeline.shots.findIndex((s) => s.id === (at < 0 ? ref : ref.slice(0, at)));
  const staysInShot = at < 0 || !(ANCHOR_OFFSET_RE.test(anchor) || PLAIN_SECONDS_RE.test(anchor));
  return index >= 0 && staysInShot ? index : -1;
}

// Does the range run backwards however the film comes to be timed? Two plain seconds, or two references in different shots
// (shot order never changes between the estimated and the measured timeline). Anything else waits for the measured one.
function surelyBackwards(first, last, film, timeline) {
  if (PLAIN_SECONDS_RE.test(first) && PLAIN_SECONDS_RE.test(last)) return Math.round(Number(first) * timeline.fps) > Math.round(Number(last) * timeline.fps);
  const [a, b] = [shotIndexOf(first, timeline), shotIndexOf(last, timeline)];
  return a >= 0 && b >= 0 && a > b;
}

/**
 * What a slice run refuses before any voice is made, on the timeline loadFilm built: a shot the film lacks, a --range with
 * no "..", a reference that names nothing. A film with no voice and no music.snap is drawn on exactly that timeline, so the
 * whole slice is judged now (a backwards range, a time past the end). A voiced or snapped film is timed only later: now
 * it is refused when the range runs backwards however it is timed (surelyBackwards); a range inside one shot, one that
 * uses a word or an offset, and the film's length are judged on the measured timeline, after the voice.
 */
export function checkSlice({ shot, range }, film, timeline) {
  if (typeof shot === 'string') shotSlice(shot, film, timeline);
  if (typeof range !== 'string') return;
  if (film.voice === undefined && film.music?.snap !== true) {
    rangeSlice(range, film, timeline);
    return;
  }
  const [first, last] = rangeParts(range);
  [first, last].forEach((ref) => filmSeconds(ref, film, timeline));
  if (surelyBackwards(first, last, film, timeline)) throw backwardsError(first, last, 'comes after');
}

/**
 * The sheets a slice keeps (planSheets' sheets): a shot sheet keeps only the tiles whose frame is inside the slice and
 * goes when none is left; a cut strip stays, whole with its side frames, only when the first frame of its window is inside.
 * A shot sheet that keeps only some of its tiles is named `<name>.partial-<slice label>.png`, so it never overwrites the
 * whole sheet a full run made (a sheet that keeps every tile keeps its name).
 */
export function sliceSheets(sheets, slice) {
  const inside = (frame) => frame >= slice.from && frame <= slice.to;
  return sheets.flatMap((sheet) => {
    if (sheet.kind === 'cut') return inside(sheet.windowFrom) ? [sheet] : [];
    const tiles = sheet.tiles.filter((tile) => inside(tile.frame));
    if (tiles.length === 0) return [];
    if (tiles.length === sheet.tiles.length) return [sheet];
    return [{ ...sheet, name: `${sheet.name.slice(0, -PNG.length)}.partial-${slice.label}${PNG}`, tiles }];
  });
}

/**
 * The frames the review snapshots for a slice, in order, each once: every audit frame of each shot the slice touches, and of
 * the shot before each shot whose cut window opens inside it (a `match` is compared with that shot's last picture). `judged`
 * marks the audit frames inside the slice; the others are snapshotted so that what is read across a shot (the rest scales,
 * the first picture of a matched shot drawn alone, whether a text ever settles, the first frame a finding shows on) is read
 * from the frames the full run reads. reviewFilm audits them all and reports a finding only for a time inside the slice.
 * @returns {{ frame: number, judged: boolean }[]}
 */
export function sliceAuditPlan(film, timeline, slice) {
  const opening = new Set(shotsOpeningIn(timeline, slice));
  const relevant = timeline.shots.filter((shot, index) => slice.shots.includes(shot.id) || opening.has(timeline.shots[index + 1]?.id));
  const inRelevant = (frame) => relevant.some((shot) => frame >= firstFrameOf(timeline, shot) && frame <= lastFrameOf(timeline, shot));
  return auditMoments(film, timeline).filter(inRelevant).map((frame) => ({ frame, judged: frame >= slice.from && frame <= slice.to }));
}

/** Is `t` (seconds) inside the slice? A time belongs to the frame it falls in. */
export function inSlice(slice, fps, t) {
  const frame = t * fps;
  return frame >= slice.from - FRAME_EPSILON && frame < slice.to + 1 - FRAME_EPSILON;
}

/** The ids of the shots whose first frame is inside the slice (a cut's window opens there). */
export function shotsOpeningIn(timeline, slice) {
  return timeline.shots.filter((shot) => firstFrameOf(timeline, shot) >= slice.from && firstFrameOf(timeline, shot) <= slice.to).map((shot) => shot.id);
}
