// Timers that record what the stage clock does with them (capture-clock.mjs `timers`), so a test never waits on the wall
// clock: each handle says whether it was cleared and whether it was unref'd, and `handle.fn()` fires it by hand.
export function fakeTimers() {
  const handles = [];
  return {
    handles,
    setTimeout: (fn, ms) => {
      const handle = { fn, ms, cleared: false, unrefd: false, unref() { this.unrefd = true; return this; } };
      handles.push(handle);
      return handle;
    },
    clearTimeout: (handle) => { handle.cleared = true; },
  };
}
