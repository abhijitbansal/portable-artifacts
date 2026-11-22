// The stage clock: the time each stage of a frame takes (draw: the page seeks and paints it; capture: the screenshot;
// encode: the write to ffmpeg and its finish), and a stalled stage turned into an error that names it. render.mjs
// shootFrame and renderFilm put every stage of both capture paths (one page, --workers) through `time`, so a render that
// stops answering says where, and the report says where the time went.
//
// A stall is a stage that has not answered in `stallMs`, or the browser's own TimeoutError (Playwright's 30 s timeout on
// a screenshot fires long before ours). Any other error a stage throws, such as one the page raised about the film,
// passes through unchanged: it is a finding or a machine error of its own, never a stall.
import { performance } from 'node:perf_hooks';

export const STAGES = Object.freeze(['draw', 'capture', 'encode']);
export const STAGE_STALL_MS = 120_000;
export const TAIL_LINES = 5;
const MS_PER_SECOND = 1000;

/** The error of a stalled stage: names the stage, the frame (1-based in the text), the cause and the page's last messages. */
export function stallError({ stage, frame, frames, cause, tail }) {
  const said = tail.slice(-TAIL_LINES).join(' | ') || 'none';
  return new Error(`render stalled in the ${stage} stage at frame ${frame + 1} of ${frames}: ${cause}; last page messages: ${said}`);
}

/**
 * @param {{ frames: number, stallMs?: number, tail?: () => string[], now?: () => number }} opts `tail` gives the page and
 *   console errors so far (session.errors); `now` is the clock in milliseconds.
 * @returns {{ time<T>(stage: string, frame: number, fn: () => Promise<T>): Promise<T>, totals(): Record<string, number> }}
 *   On the parallel path `totals()` sums the stage times of every page, so it can exceed the wall time.
 */
export function createStageClock({ frames, stallMs = STAGE_STALL_MS, tail = () => [], now = () => performance.now() }) {
  const spent = Object.fromEntries(STAGES.map((stage) => [stage, 0]));
  const stall = (stage, frame, cause) => stallError({ stage, frame, frames, cause, tail: tail() });
  return {
    async time(stage, frame, fn) {
      if (!STAGES.includes(stage)) throw new Error(`stage must be one of ${STAGES.join(', ')}`);
      const started = now();
      let timer;
      const silent = new Promise((_, reject) => {
        timer = setTimeout(() => reject(stall(stage, frame, `no answer in ${stallMs / MS_PER_SECOND} s`)), stallMs);
        timer.unref();
      });
      try {
        return await Promise.race([fn(), silent]);
      } catch (err) {
        if (err?.name === 'TimeoutError') throw stall(stage, frame, String(err.message).split('\n')[0]);
        throw err;
      } finally {
        clearTimeout(timer);
        spent[stage] += now() - started;
      }
    },
    totals: () => ({ drawMs: Math.round(spent.draw), captureMs: Math.round(spent.capture), encodeMs: Math.round(spent.encode) }),
  };
}
