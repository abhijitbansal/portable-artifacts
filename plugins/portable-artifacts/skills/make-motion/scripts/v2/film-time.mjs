// Film time: one grammar that names a moment of the film, read by --poster (and by --inspect, --shot and --range as they
// arrive). The forms, tried in this order:
//   <number>            seconds from the film's start ("1.5")
//   <shot-id>@<anchor>  a place inside that shot, as a device's `at` reads it: a word is where the picture shows it, and
//                       "@end" is the shot's own last frame (one frame before the next shot begins)
//   <shot-id>           that shot's start (a shot called "end" or "end-1" is the shot, never the film's end)
//   <anchor>            an anchor across the whole film, as a cue's `at` reads it: word:<n> and sentence:<n> count across
//                       the film, and a word is where it is heard (shot.start + soundStart; a narration lead or trail can
//                       put it outside its own shot)
// An anchor is start, end, word:<n>, word:<text> or sentence:<n>, with an optional +<s> or -<s> (engine/script/anchors.mjs).
// Pure: no clock, no randomness, no browser.
import { AnchorError, anchorSeconds, echoValue } from '../../engine/script/anchors.mjs';
import { posterFrame } from './poster.mjs';

const FILM_SHOT_ID = 'film';
const NUMBER_RE = /^\d+(\.\d+)?$/;
const SHOT_SEPARATOR = '@';
const END_ZERO_RE = /^end(?:[+-](?:0+(?:\.0+)?|\.0+))?$/; // "end", or "end" with an offset of zero
const LENGTH_DECIMALS = 1;
const END_EPSILON = 1e-6; // anchors are rounded to a microsecond, so a time at the end may sit that far past it

/** A reference that names no moment of the film. `hint` lists the forms and the film's shot ids (the report's error.hint). */
export class FilmTimeError extends Error {
  constructor(message, shotIds) {
    super(message);
    this.name = 'FilmTimeError';
    this.hint = `use a number of seconds, "<shot-id>", "<shot-id>@<anchor>" or a film-wide anchor; the shots are: ${shotIds.join(', ')}; `
      + 'an anchor is start, end, word:<n>, word:<text> or sentence:<n>, with an optional +<s> or -<s>';
  }
}

/**
 * The whole film as one shot, for a film-level anchor: word and sentence indexes count across the film, in film seconds.
 * Each word as it is heard (soundStart, soundEnd), in film seconds; a sentence from its first word's heard start to its
 * last word's heard end. A cue is a sound, so it follows the voice, not the picture's start for a shot's first word.
 */
export function wholeFilmShot(timeline) {
  const heard = (s) => s.words.map((w) => ({ ...w, start: s.start + (w.soundStart ?? w.start), end: s.start + (w.soundEnd ?? w.end) }));
  const sentences = (s, words) => s.sentences.map((x) => ({ ...x, start: words[x.first]?.start ?? s.start + x.start, end: words[x.last]?.end ?? s.start + x.end }));
  return {
    id: FILM_SHOT_ID,
    duration: timeline.duration,
    words: timeline.shots.flatMap(heard),
    sentences: timeline.shots.flatMap((s) => sentences(s, heard(s))),
  };
}

const shotIdsOf = (film, timeline) => (film?.shots ?? timeline.shots).map((s) => s.id);

// An anchor read in `shot` (a timeline shot, or the whole film), its failure said as a film-time error.
function anchorIn(anchor, shot, ref, ids) {
  try {
    return anchorSeconds(anchor, shot);
  } catch (err) {
    if (!(err instanceof AnchorError)) throw err;
    throw new FilmTimeError(`cannot read film time ${JSON.stringify(echoValue(ref))}: ${err.message}`, ids);
  }
}

// `<shot-id>@<anchor>`: the shot named before the first "@" and the anchor after it, or null when the text before it is
// not a shot (the whole text is then tried as a film-wide anchor, which may itself hold an "@" in a word).
function inShot(ref, timeline) {
  const at = ref.indexOf(SHOT_SEPARATOR);
  if (at <= 0) return null;
  const shot = timeline.shots.find((s) => s.id === ref.slice(0, at));
  return shot === undefined ? null : { shot, anchor: ref.slice(at + SHOT_SEPARATOR.length) };
}

// The shot-local second of `<shot-id>@<anchor>`. "@end" is the shot's own last frame (one frame before its end, which is
// the next shot's first frame), and so are "@end-0" and "@end+0": a zero offset is no offset. "@end-0.5" and the like are
// measured from the end itself.
function inShotSeconds({ shot, anchor }, timeline, ref, ids) {
  const seconds = anchorIn(anchor, shot, ref, ids);
  return END_ZERO_RE.test(anchor) ? seconds - 1 / timeline.fps : seconds;
}

/**
 * The film second `ref` names (a string, or a number of seconds), not clamped: a number, `<shot-id>@<anchor>`, a shot id,
 * or an anchor across the whole film, in that order. An unreadable reference or one that names nothing in the film is a
 * FilmTimeError whose `hint` lists the forms and the shots.
 */
export function filmSeconds(ref, film, timeline) {
  if (typeof ref === 'number') return ref;
  const ids = shotIdsOf(film, timeline);
  if (typeof ref !== 'string' || ref === '') throw new FilmTimeError(`cannot read film time ${JSON.stringify(echoValue(ref))}: it is empty`, ids);
  if (NUMBER_RE.test(ref)) return Number(ref);
  const named = inShot(ref, timeline);
  if (named !== null) return named.shot.start + inShotSeconds(named, timeline, ref, ids);
  const alone = timeline.shots.find((s) => s.id === ref);
  if (alone !== undefined) return alone.start;
  try {
    return anchorIn(ref, wholeFilmShot(timeline), ref, ids);
  } catch (err) {
    const at = ref.indexOf(SHOT_SEPARATOR);
    if (!(err instanceof FilmTimeError) || at <= 0) throw err;
    throw new FilmTimeError(`no shot ${JSON.stringify(echoValue(ref.slice(0, at)))} in the film, for film time ${JSON.stringify(echoValue(ref))}`, ids);
  }
}

/**
 * The frame `ref` names: round(seconds * fps), at most the last frame. The film's end (duration is frameCount / fps) is
 * the last frame, so `end` and `end-0.01` name it; only a time strictly past the end is refused, with an error naming the
 * film's length (as poster.mjs words it, under `flag`: the flag the reference came from, --poster by default). A time
 * before the start is refused with the same length.
 */
export function filmFrame(ref, film, timeline, flag = '--poster') {
  const seconds = filmSeconds(ref, film, timeline);
  const length = timeline.duration.toFixed(LENGTH_DECIMALS);
  // a tiny negative rounds to "-0.0": print it as 0.0, never minus zero
  const before = seconds.toFixed(LENGTH_DECIMALS).replace(/^-(0\.0+)$/, '$1');
  if (seconds < 0) throw new FilmTimeError(`film time ${JSON.stringify(echoValue(ref))} is before the start of the film (${before} s; the film is ${length} s)`, shotIdsOf(film, timeline));
  if (seconds > timeline.duration + END_EPSILON) return posterFrame(seconds, timeline, ref, flag); // past the last frame: it throws, naming the length
  return Math.min(Math.round(seconds * timeline.fps), timeline.frameCount - 1) + 0; // + 0: a frame that rounds to -0 is frame 0
}
