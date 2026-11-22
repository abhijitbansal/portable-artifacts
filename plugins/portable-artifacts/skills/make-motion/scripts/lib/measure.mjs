// The pure half of scripts/measure.mjs: what ffmpeg's scdet printed, the shots those cuts make, and the report that says
// for each value whether it was measured or guessed. No file is read here and nothing is run.

export const SCENE_THRESHOLD = 10; // scdet's own default (its `threshold`, 0 to 100)
export const FAST_SHOT_SECONDS = 2; // a median shot shorter than this reads as a fast cut

const round3 = (n) => Math.round(n * 1000) / 1000;

/** The `lavfi.scd.time` values of ffmpeg's scdet log, in the order printed (seconds). */
export function parseScdet(stderr) {
  return [...stderr.matchAll(/lavfi\.scd\.time:\s*(-?[\d.]+)/g)].map((m) => Number(m[1])).filter(Number.isFinite);
}

const middle = (sorted) => {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * The shots the cuts make over a file `duration` seconds long, each from the last cut (the first from 0) to the next (the
 * last to the end): { count: cuts, median, shortest, longest }. A cut outside 0 to the duration is not a cut. With no cut
 * the whole file is the one shot.
 */
export function shotStats(cuts, duration) {
  const inside = cuts.filter((c) => c > 0 && c < duration);
  const edges = [0, ...inside, duration];
  const lengths = edges.slice(1).map((end, i) => round3(end - edges[i])).sort((a, b) => a - b);
  return { count: inside.length, median: round3(middle(lengths)), shortest: lengths[0], longest: lengths.at(-1) };
}

const measured = (value) => ({ value, basis: 'measured' });
const guessed = (value) => ({ value, basis: 'guessed' });

/**
 * Every number of a reference video as { value, basis }, `basis` one of 'measured' (read from the file) or 'guessed' (a
 * rule of thumb over the measured ones). `probe`: { duration, width, height, fps } (fps may be null); `cuts`: the scdet
 * times; `loudness`: { lufs, truePeak } from ebur128, or null for a file with no sound (both fields then null, still
 * measured).
 */
export function measureReport({ probe, cuts, loudness }) {
  const shots = shotStats(cuts, probe.duration);
  return {
    duration: measured(round3(probe.duration)),
    size: measured([probe.width, probe.height]),
    fps: measured(probe.fps ?? null),
    cuts: measured(shots.count),
    shotMedian: measured(shots.median),
    shotShortest: measured(shots.shortest),
    shotLongest: measured(shots.longest),
    lufs: measured(loudness?.lufs ?? null),
    truePeakDb: measured(loudness?.truePeak ?? null),
    mode: guessed(probe.height > probe.width ? 'viral' : 'pro'),
    pace: guessed(shots.median < FAST_SHOT_SECONDS ? 'fast' : 'calm'),
  };
}
