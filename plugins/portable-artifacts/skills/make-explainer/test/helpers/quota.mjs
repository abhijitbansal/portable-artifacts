// Real localStorage quota for the browser tests: fill the origin's store until a write grows past it, then free it again.
// After the fill an equal or shorter replacement still succeeds and a longer one fails, so a test that wants a failed
// write must make the stored string grow.
import assert from 'node:assert/strict';

export const QUOTA_FILLER = 'pa-test-quota';

/** Fill localStorage until even the page's 1-character startup probe cannot be written. */
export async function exhaustQuota(page) {
  const result = await page.evaluate((key) => {
    let filler = '';
    for (let size = 1024 * 1024; size >= 1; size = Math.floor(size / 2)) {
      for (;;) {
        const next = filler + 'x'.repeat(size);
        try { localStorage.setItem(key, next); filler = next; }
        catch (error) {
          if (error.name !== 'QuotaExceededError') throw error;
          break;
        }
      }
    }
    try { localStorage.setItem('pa-probe', '1'); return 'probe succeeded'; }
    catch (error) { return error.name; }
  }, QUOTA_FILLER);
  assert.equal(result, 'QuotaExceededError', 'the page startup probe really cannot write');
}

/**
 * An init script (for openPage's `init`) that stops the page script from ever getting a storage listener, like a tab
 * that was asleep and missed another tab's save.
 */
export const deafToStorage = () => {
  const add = window.addEventListener.bind(window);
  window.addEventListener = (type, ...rest) => (type === 'storage' ? undefined : add(type, ...rest));
};

/** Give the space back: the next write that fits succeeds. */
export function freeQuota(page) {
  return page.evaluate((key) => localStorage.removeItem(key), QUOTA_FILLER);
}
