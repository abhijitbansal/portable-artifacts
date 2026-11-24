// A repository the user did not write can ship a symlink where a build writes its page. Real builds, no browser.
// The dashboard's implicit output is <spec folder>/dist/index.html (there is no .scratch default here).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkTests } from '../../../shared/test/helpers/link-plants.mjs';

linkTests({
  skill: 'make-dashboard',
  examples: fileURLToPath(new URL('../references/examples', import.meta.url)),
  spec: 'minimal.json',
  build: fileURLToPath(new URL('../scripts/build.mjs', import.meta.url)),
  folder: (repo, spec) => path.join(path.dirname(spec), 'dist'),
  paOutputDir: false,
});
