// A repository the user did not write can ship a symlink where a build writes its page. Real builds, no browser.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkTests } from '../../../shared/test/helpers/link-plants.mjs';

linkTests({
  skill: 'make-diagram',
  examples: fileURLToPath(new URL('../references/examples', import.meta.url)),
  spec: 'flow.diagram.json',
  build: fileURLToPath(new URL('../scripts/build.mjs', import.meta.url)),
  folder: (repo) => path.join(repo, '.scratch'),
});
