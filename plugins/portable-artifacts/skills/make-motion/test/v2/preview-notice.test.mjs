// --preview and the signed-in rule: a film that plays a signed-in take says so before the preview URL, in the same words as a
// render's report (report.mjs signedInNotices). In process, no browser: the preview server runs on loopback and is stopped
// through its signal.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import '../../scripts/v2/list.mjs';
import { parseMakeArgs } from '../../scripts/v2/cli.mjs';
import { previewStages } from '../../scripts/v2/run.mjs';
import { runPreview } from '../../scripts/v2/viewer-run.mjs';
import { makeFilmDir, writeSyntheticTake } from './helpers/synthetic-take.mjs';

const NOTICE = 'shot "w" plays a signed-in take: its frames, sheets and film are the user\'s to look at; do not open them.';
const dirs = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

// A film folder holding the synthetic take (signed in or not) and a film of one walk shot on it; its options for --preview.
function previewOf(signedIn, extra = []) {
  const dir = makeFilmDir('preview-notice-');
  dirs.push(dir);
  writeSyntheticTake(dir, { edit: (take) => { take.signedIn = signedIn; } });
  const film = { version: 2, mode: 'pro', look: 'keynote', format: '16:9', fps: 30, seed: 1, shots: [
    { id: 'w', show: 'walk', src: 'take', say: 'Open it. Pick the tab. Type a word.', steps: [{ id: 'open' }, { id: 'tab' }, { id: 'search' }] },
  ] };
  const file = path.join(dir, 'film.json');
  writeFileSync(file, JSON.stringify(film));
  return parseMakeArgs([file, '--preview', ...extra]);
}

// runPreview with `options`, stopped as soon as the URL is printed: every line it said, in order.
async function sayOf(options) {
  const controller = new AbortController();
  const said = [];
  const result = await runPreview(options, { signal: controller.signal, log: () => {}, say: (line) => { said.push(line); if (/preview\b/.test(line) && /http:\/\/127/.test(line)) controller.abort(); } });
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  return said;
}

test('previewStages carries the signed-in notice of a film that plays a signed-in take, and none for a signed-out one', async () => {
  const signed = await previewStages(previewOf(true), { work: makeFilmDir('preview-work-') });
  assert.deepEqual(signed.notices, [NOTICE]);
  const open = await previewStages(previewOf(false), { work: makeFilmDir('preview-work-') });
  assert.deepEqual(open.notices, []);
});

test('--preview prints the notice line before the URL line; a signed-out take prints only the URL', async () => {
  const said = await sayOf(previewOf(true));
  assert.equal(said.length, 2, said.join(' | '));
  assert.equal(said[0], `notice: ${NOTICE}`);
  assert.match(said[1], /^preview: http:\/\/127\.0\.0\.1:\d+\/preview$/);
  const plain = await sayOf(previewOf(false));
  assert.equal(plain.length, 1, plain.join(' | '));
});

test('--preview --json carries the notices in the one object it prints', async () => {
  const said = await sayOf(previewOf(true, ['--json']));
  assert.equal(said.length, 1, said.join(' | '));
  const printed = JSON.parse(said[0]);
  assert.deepEqual(printed.notices, [NOTICE]);
  assert.match(printed.preview.url, /^http:\/\/127\.0\.0\.1:\d+\/preview$/);
  const plain = JSON.parse((await sayOf(previewOf(false, ['--json'])))[0]);
  assert.equal('notices' in plain, false);
});
