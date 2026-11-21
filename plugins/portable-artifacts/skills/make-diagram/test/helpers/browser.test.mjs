// haveBrowser() lets a test skip when no browser starts, except under PA_REQUIRE_BROWSER=1 (CI), where it fails the
// suite. It launches nothing here: the failing launch is injected.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haveBrowser } from './browser.mjs';

const broken = async () => { throw new Error("Executable doesn't exist at /x\nsecond line"); };

test('a browser that does not start gives false, and throws instead under PA_REQUIRE_BROWSER=1', async () => {
  const saved = process.env.PA_REQUIRE_BROWSER;
  try {
    delete process.env.PA_REQUIRE_BROWSER;
    assert.equal(await haveBrowser(broken), false);
    process.env.PA_REQUIRE_BROWSER = '1';
    await assert.rejects(() => haveBrowser(broken), { message: "PA_REQUIRE_BROWSER=1 but no browser starts: Executable doesn't exist at /x" });
    process.env.PA_REQUIRE_BROWSER = '0';
    assert.equal(await haveBrowser(broken), false, 'only 1 turns the skip into a failure');
  } finally {
    if (saved === undefined) delete process.env.PA_REQUIRE_BROWSER; else process.env.PA_REQUIRE_BROWSER = saved;
  }
});
