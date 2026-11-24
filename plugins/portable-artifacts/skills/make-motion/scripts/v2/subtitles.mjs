// --subtitles srt|vtt: a caption file beside the MP4, from the film's own word times. One cue per sentence (split past
// MAX_CUE_WORDS words), from the first word heard to the last, at film time; with --subtitle-words one cue per word, at
// the film second it is heard. With a voice the times are measured (the
// sidecar, or an author's recording); without one they are the word-count estimate, and the file says so: a VTT in a
// NOTE line. SRT has no comment line, so an estimated SRT is refused rather than written without the warning. Word
// text is the narration as plain text (marks gone); < and & are written as entities so a player shows them as text.
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ensureOutputFolder } from '../../shared/write-file.mjs';

export const MAX_CUE_WORDS = 8;
export const ESTIMATE_NOTE = 'the times are estimated from the word count: the film has no voice to measure them by';
export const WORD_ESTIMATE_NOTE = 'the word times are estimated from the word count: the film has no voice to measure them by';
const MS = 1000;
const ENTITIES = Object.freeze({ '&': '&amp;', '<': '&lt;', '>': '&gt;' });

const escapeText = (text) => text.replace(/[&<>]/g, (c) => ENTITIES[c]);

// The cues of one sentence of `shot`: chunks of at most MAX_CUE_WORDS words.
function sentenceCues(shot, { first, last }) {
  const words = shot.words.slice(first, last + 1);
  const cues = [];
  for (let k = 0; k < words.length; k += MAX_CUE_WORDS) {
    const chunk = words.slice(k, k + MAX_CUE_WORDS);
    cues.push({ start: shot.start + chunk[0].soundStart, end: shot.start + chunk.at(-1).soundEnd, text: chunk.map((w) => w.text).join(' ') });
  }
  return cues;
}

// One cue per word that is heard (soundEnd > soundStart), at the film second it is heard (shot.start + soundStart: a word
// that leads or trails its cut keeps its heard time). Sorted by start across the film (stable: words heard together keep
// their shot order), held inside 0 to the film's duration (a cue wholly outside goes). Words heard at the same second, or
// within a millisecond of it (a file cannot tell them apart; a merged run such as "$5 million") are one cue, their words
// joined; each cue then ends where the next one, which starts
// later, starts: no two cues overlap.
function wordCues(timeline) {
  const heard = timeline.shots.flatMap((shot) => (shot.words ?? [])
    .filter((w) => w.soundEnd > w.soundStart)
    .map((w) => ({ start: Math.max(0, shot.start + w.soundStart), end: Math.min(timeline.duration, shot.start + w.soundEnd), text: w.text })))
    .filter((c) => c.end > c.start)
    .sort((p, q) => p.start - q.start);
  const merged = [];
  for (const c of heard) {
    const last = merged.at(-1);
    if (last && c.start - last.start < 1 / MS) merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, c.end), text: `${last.text} ${c.text}` };
    else merged.push(c);
  }
  return merged.map((c, i) => (i + 1 < merged.length && merged[i + 1].start < c.end ? { ...c, end: merged[i + 1].start } : c));
}

/**
 * The cues of `timeline` (buildTimeline's): [{ start, end, text }] in film seconds, in order. `level` 'sentence' (default):
 * one cue per sentence; 'word': one cue per word heard.
 */
export function subtitleCues(timeline, { level = 'sentence' } = {}) {
  if (level === 'word') return wordCues(timeline);
  return timeline.shots.flatMap((shot) => (shot.sentences ?? []).flatMap((s) => sentenceCues(shot, s)));
}

// h:mm:ss with milliseconds after `sep` (SRT a comma, VTT a dot), two-digit hours.
function stamp(seconds, sep) {
  const ms = Math.round(seconds * MS);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / MS) % 60)}${sep}${pad(ms % MS, 3)}`;
}

/** The file's text for `format` ('srt' | 'vtt') at `level`. Throws for an estimated timeline in SRT (it cannot carry the note). */
export function subtitleText(timeline, format, { level = 'sentence' } = {}) {
  const estimated = timeline.timed !== 'measured';
  const cues = subtitleCues(timeline, { level });
  if (format === 'srt') {
    if (estimated) throw new Error('SRT has no comment line to say the times are estimated (the film has no voice); use --subtitles vtt, whose file carries that note');
    return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${escapeText(c.text)}\n`).join('\n');
  }
  const note = level === 'word' ? WORD_ESTIMATE_NOTE : ESTIMATE_NOTE;
  const head = `WEBVTT\n\n${estimated ? `NOTE ${note}\n\n` : ''}`;
  return head + cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${escapeText(c.text)}\n`).join('\n');
}

/** Where the file goes: beside the MP4, its name with the format's extension. */
export const subtitlePath = (videoOut, format) => path.join(path.dirname(videoOut), `${path.basename(videoOut, path.extname(videoOut))}.${format}`);

/** Writes the file (whole or not at all). -> { file, format, timed, level }. */
export function writeSubtitles({ timeline, format, videoOut, level = 'sentence' }) {
  const file = subtitlePath(videoOut, format);
  const text = subtitleText(timeline, format, { level });
  ensureOutputFolder(path.dirname(file));
  const partial = `${file}.partial-${process.pid}`;
  try {
    writeFileSync(partial, text, { flag: 'wx' });
    renameSync(partial, file);
  } finally {
    rmSync(partial, { force: true });
  }
  return { file, format, timed: timeline.timed === 'measured' ? 'measured' : 'estimated', level };
}
