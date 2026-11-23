// The committed minified bundle is checked byte for byte against a fresh build of template/runtime/ (the header hash in
// bundle.test.mjs covers the sources, not the bundle). A hand-edited or tampered bundle, or one built with other
// versions of esbuild or three than package.json pins, fails here. Nothing is written: the build runs in memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBundle } from '../scripts/lib/bundle.mjs';
import { buildBundleText } from '../scripts/dev/bundle.mjs';

test('committed bundle equals a fresh build of template/runtime byte for byte', async () => {
  const fresh = await buildBundleText();
  const committed = readBundle();
  assert.equal(
    fresh === committed,
    true,
    `template/vendor/scene-runtime.min.js differs from a fresh build (${Buffer.byteLength(committed)} vs ${Buffer.byteLength(fresh)} bytes): run \`npm run bundle\` and commit it, or restore the committed file`,
  );
});
