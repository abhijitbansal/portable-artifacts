// Rebuilds template/vendor/scene-runtime.min.js from template/runtime/index.js.
// Dev-only (esbuild is a devDependency): run `npm run bundle` after any runtime edit and commit the result.
// test/bundle-bytes.test.mjs calls buildBundleText() and compares it with the committed file byte for byte.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { BUNDLE_FILE, SKILL_DIR, bundleHeader } from '../lib/bundle.mjs';

// MIT asks for the copyright AND the permission notice in all copies; esbuild's @license comment holds only the
// first, so three's whole LICENSE file goes in a preserved /*! */ comment at the end of the bundle.
function threeNotice() {
  const text = fs.readFileSync(path.join(SKILL_DIR, 'node_modules', 'three', 'LICENSE'), 'utf8').trim();
  if (text.includes('*/')) throw new Error('three/LICENSE contains "*/": it cannot go in a block comment');
  return `/*! three.js licence (MIT), from three/LICENSE\n\n${text}\n*/`;
}

/** The whole bundle file as text (header, minified body, three's licence), built in memory; nothing is written. */
export async function buildBundleText() {
  const header = bundleHeader();
  const result = await build({
    absWorkingDir: SKILL_DIR,
    entryPoints: ['template/runtime/index.js'],
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2020',
    legalComments: 'eof', // three is MIT: its @license / SPDX notice must travel with every inlined copy
    write: false,
  });
  return `${header}\n${result.outputFiles[0].text}${threeNotice()}\n`;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const text = await buildBundleText();
    fs.writeFileSync(BUNDLE_FILE, text);
    console.log(`wrote ${BUNDLE_FILE} (${Buffer.byteLength(text)} bytes including header and licence)`);
  } catch (err) {
    console.error(`bundle failed: ${err.message}`);
    process.exitCode = 1;
  }
}
