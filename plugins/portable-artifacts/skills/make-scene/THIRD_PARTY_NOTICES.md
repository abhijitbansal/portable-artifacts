# Third-party notices

`template/vendor/scene-runtime.min.js` bundles **three.js 0.186.1** (including `examples/jsm/controls/OrbitControls.js`), https://threejs.org, under the MIT licence below. The bundle header names the exact version.

## Provenance of the bundle

`template/vendor/scene-runtime.min.js` is built from this repository's own `template/runtime/` sources plus three.js, with `npm run bundle` (`scripts/dev/bundle.mjs`): esbuild 0.28.2 bundles `template/runtime/index.js` as one minified classic script (target es2020), and three.js is the exact version pinned in `package.json` (`devDependencies`, 0.186.1; the bundle header repeats it). Nothing else is downloaded or hand-edited. `test/bundle-bytes.test.mjs` rebuilds the bundle in memory and fails unless it equals the committed file byte for byte, so a bundle that does not come from these sources and pins cannot ship unnoticed (CI runs it in the make-scene job). The bundle contains no network API: it has no `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `sendBeacon` (checked with a text search of the committed file on 2026-11-23); the only URLs in it are the XHTML namespace string and a reference link in a comment.

```
The MIT License

Copyright © 2010-2026 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
