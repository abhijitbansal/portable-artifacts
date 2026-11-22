// W5 task 1: --sheets-only --estimated makes no voice and writes the board strips. [browser] One at a time: run with
// --test-concurrency=1; skips without a browser (PA_REQUIRE_BROWSER=1 makes that a failure).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserAvailable } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { parseSay } from '../../engine/script/say.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { sentencesOf } from '../../scripts/v2/voice/sidecar.mjs';

const SHOTS = [
  { id: 'hook', show: 'statement', say: 'Every row has a source.' },
  { id: 'rows', show: 'number', say: 'Four hundred rows.', value: 400, label: 'rows' },
];
const FILM = { version: 2, mode: 'pro', voice: { name: 'af_heart' }, shots: SHOTS };
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);
const MAX_STRIP_BYTES = 1.5e6;

// The sidecar a synthesiser would return: word k at k * 0.12 s.
function fakeSidecar(film) {
  const shots = film.shots.map((shot, index) => {
    const { tokens } = parseSay(shot.say);
    const words = tokens.map((token, k) => ({ text: token.text, start: k * 0.12, end: k * 0.12 + 0.1, emphasis: token.emphasis, aside: token.aside }));
    return { id: shot.id, wav: `shot-${index}.wav`, seconds: words.at(-1).end + 0.025, sentences: sentencesOf(tokens, words) };
  });
  return { version: 1, model: { id: 'fake-model', commit: 'c0ffee', file: 'model.onnx', sha256: 'abc' }, voice: 'af_heart', sampleRate: 24000, shots };
}

let dir, specPath, out;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-board-'));
  specPath = path.join(dir, 'film.json');
  out = path.join(dir, 'out', 'film.mp4');
  writeFileSync(specPath, JSON.stringify(FILM));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const boardDir = () => path.join(dir, 'out', 'film.sheets', 'board');

test('--sheets-only --estimated makes no voice, says estimated, and writes the strips', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const lines = [];
  const { report, exitCode } = await runMake({ specPath, noRender: true, estimated: true, out },
    { log: (line) => lines.push(line), synthesise: () => { throw new Error('the voice was made'); } });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.equal(report.timed, 'estimated');
  assert.equal(report.voice, null);
  assert.equal(report.board.length, 1);
  assert.equal(report.board[0], path.join(boardDir(), 'board-1.jpg'));
  assert.ok(statSync(report.board[0]).size < MAX_STRIP_BYTES);
  assert.deepEqual(readFileSync(report.board[0]).subarray(0, 3), JPEG_MAGIC);
  assert.ok(lines.includes('make: --estimated: no voice was made; the sheets and the board use estimated timing'), lines.join('\n'));
  assert.deepEqual(report.sheets.map((f) => path.basename(f)).sort(), ['cut-hook-rows.png', 'hook.png', 'rows.png']);
  assert.equal(existsSync(path.join(dir, 'out', '.voice')), false, 'no voice cache');
  assert.deepEqual(report.stages.map((s) => s.name), ['validate', 'timeline', 'review', 'board']);
  return undefined;
});

test('a second run replaces the strips it made, drops a strip the film no longer needs, and leaves other files alone', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  writeFileSync(path.join(boardDir(), 'board-2.jpg'), 'stale');
  writeFileSync(path.join(boardDir(), 'notes.txt'), 'mine');
  const { report, exitCode } = await runMake({ specPath, noRender: true, estimated: true, out }, { synthesise: () => { throw new Error('the voice was made'); } });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.deepEqual(readdirSync(boardDir()).sort(), ['board-1.jpg', 'notes.txt']);
  return undefined;
});

test('--sheets-only alone still makes the voice, and writes no board', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const calls = [];
  const synthesise = async (film, options) => {
    calls.push(options);
    return { dir: path.join(options.outDir, '.voice', 'fake'), sidecar: fakeSidecar(film), cached: false };
  };
  const { report, exitCode } = await runMake({ specPath, noRender: true, out: path.join(dir, 'voiced', 'film.mp4') }, { synthesise });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.equal(calls.length, 1);
  assert.equal(report.timed, 'measured');
  assert.equal('board' in report, false);
  return undefined;
});
