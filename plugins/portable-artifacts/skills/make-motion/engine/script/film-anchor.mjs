// The whole film as one shot, for an anchor that counts across the film (word:<n>, sentence:<n>): read by film time
// (scripts/v2/film-time.mjs) and by the cue plan (scripts/v2/sound/cues.mjs), which both read an anchor against it. Pure:
// no clock, no randomness, no browser.

const FILM_SHOT_ID = 'film';

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
