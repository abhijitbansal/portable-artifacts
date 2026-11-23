// The MP4 of a slice (--shot, --range): renderFilm's `frames` renders only that range, each frame sought by its absolute
// index, so a frame of the slice is byte-for-byte the frame the full render sends to ffmpeg; no voice or sound is mastered
// or muxed. A slice's own file is <out stem>.shot-<id>.mp4 or <out stem>.range-<from>-<to>.mp4. [browser, ffmpeg] One at a time: run with --test-concurrency=1; skips without a browser or ffmpeg.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserAvailable, ffmpegOrNull, probeVideo, sessionOrNull } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs';
import { renderFilm } from '../../scripts/v2/render.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { parseSay } from '../../engine/script/say.mjs';
import { sentencesOf } from '../../scripts/v2/voice/sidecar.mjs';

const FPS = 30;
const STILL_BAR = { type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } };
// the desk look (paper grain on, 12 a second): a still shot of 3 s, then a number that comes in on a 0.4 s slide
const FILM = { version: 2, mode: 'pro', look: 'desk', fps: FPS, shots: [
  { id: 'a', show: 'free', hold: 3, nodes: [STILL_BAR] },
  { id: 'b', show: 'number', hold: 2, value: 459, label: 'rows', cut: { type: 'slide', duration: 0.4 } },
] };
const A_FRAMES = 3 * FPS;
const AFTER_WINDOW = 20; // frames into b: the slide's window (0.4 s, 12 frames) is over
const TO = A_FRAMES + AFTER_WINDOW;

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-slice-mp4-'));
  writeFileSync(path.join(dir, 'film.json'), JSON.stringify(FILM));
});
after(() => rmSync(dir, { recursive: true, force: true }));

async function needs(t, { ffmpeg = false } = {}) {
  if (!await browserAvailable()) { t.skip('no browser'); return false; }
  if (ffmpeg && !await ffmpegOrNull()) { t.skip('no ffmpeg'); return false; }
  if (ffmpeg && spawnSync('ffprobe', ['-version']).status !== 0) { t.skip('no ffprobe'); return false; }
  return true;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k);
const audioStreams = (file) => spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { encoding: 'utf8' }).stdout.trim();

// The first frame of shot a that the page calls held (its picture is its predecessor's), or null.
const heldFrame = (page) => page.evaluate(([n]) => {
  for (let i = 1; i < n; i++) if (window.__heldFlags(i, i, true)[0]) return i;
  return null;
}, [A_FRAMES]);

// One session serves both renders; the first two tests read what it made.
let made = null;
async function renderBoth() {
  const session = await sessionOrNull(FILM);
  try {
    const from = await heldFrame(session.page);
    const held = from === null ? null : (await session.page.evaluate(([a]) => window.__heldFlags(a, a, true), [from]))[0];
    const full = new Map();
    const part = new Map();
    const partOut = path.join(dir, 'out', 'part.mp4');
    await renderFilm({ out: path.join(dir, 'out', 'full.mp4'), exact: true, session, onFrame: (i, bytes) => full.set(i, sha256(bytes)) });
    const result = await renderFilm({ out: partOut, exact: true, session, frames: { from, to: TO }, onFrame: (i, bytes) => part.set(i, sha256(bytes)) });
    return { from, held, full, part, partOut, result };
  } finally {
    await session?.close();
  }
}

test('the frames of a slice are the frames of the full render', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  made = await renderBoth();
  const { from, full, part, partOut, result } = made;
  assert.notEqual(from, null, 'the fixture: a still shot under 12-a-second grain has a held frame');
  assert.deepEqual([...part.keys()], range(from, TO), 'only the slice\'s frames, in order');
  for (const i of part.keys()) assert.equal(part.get(i), full.get(i), `frame ${i}`);
  assert.equal(probeVideo(partOut).frames, TO - from + 1);
  assert.equal(result.frames, TO - from + 1);
  assert.equal(result.audio, null);
  assert.ok(result.captured >= 1 && result.captured <= TO - from + 1);
});

test('the first frame of a slice is captured though the page calls it held', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  made ??= await renderBoth();
  const { from, held, full, part } = made;
  assert.equal(held, true, 'the page calls the first frame of the slice held (a repeat of the frame before it)');
  assert.equal(part.has(from), true, 'the render still wrote that frame');
  assert.equal(part.get(from), full.get(from), 'and it is the full render\'s frame');
});

// The ends the first test does not reach: a slice from frame 0 (no frame before it to compare), one that starts inside a
// cut's window (frame 95 is the slide's sixth frame; its chunk edges differ from the full render's) and one that ends on
// the film's last frame.
test('a slice from frame 0, one from mid-cut and one to the last frame send ffmpeg the full render\'s frames', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  const session = await sessionOrNull(FILM);
  try {
    const total = session.timeline.frameCount;
    const full = new Map();
    await renderFilm({ out: path.join(dir, 'out', 'edges-full.mp4'), exact: true, session, onFrame: (i, bytes) => full.set(i, sha256(bytes)) });
    assert.equal(full.size, total, 'the full render wrote every frame');
    const spans = { 'from frame 0': [0, 20], 'from mid-cut': [A_FRAMES + 5, A_FRAMES + 30], 'to the last frame': [total - 15, total - 1] };
    for (const [name, [from, to]] of Object.entries(spans)) {
      const part = new Map();
      const result = await renderFilm({ out: path.join(dir, 'out', `edges-${from}.mp4`), exact: true, session, frames: { from, to }, onFrame: (i, bytes) => part.set(i, sha256(bytes)) });
      assert.deepEqual([...part.keys()], range(from, to), `${name}: only the slice's frames, in order`);
      for (const i of part.keys()) assert.equal(part.get(i), full.get(i), `${name}: frame ${i}`);
      assert.equal(result.frames, to - from + 1, name);
    }
  } finally {
    await session?.close();
  }
});

const SIDECAR_MODEL ={ id: 'fake-model', commit: 'c0ffee', file: 'model.onnx', sha256: 'abc' };
function fakeSidecar(film) {
  const shots = film.shots.map((shot, index) => {
    if (shot.say === undefined) return { id: shot.id, wav: null, seconds: 0, sentences: [] };
    const { tokens } = parseSay(shot.say);
    const words = tokens.map((token, k) => ({ text: token.text, start: k * 0.12, end: k * 0.12 + 0.1, emphasis: token.emphasis, aside: token.aside }));
    return { id: shot.id, wav: `shot-${index}.wav`, seconds: words.at(-1).end + 0.025, sentences: sentencesOf(tokens, words) };
  });
  return { version: 1, model: SIDECAR_MODEL, voice: 'af_heart', sampleRate: 24000, shots };
}

test('a slice of a voiced film is silent and says so, and writes <name>.shot-<id>.mp4, never the film\'s own path', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  writeFileSync(path.join(dir, 'voiced.json'), JSON.stringify({ version: 2, mode: 'pro', fps: FPS, voice: { name: 'af_heart' }, shots: [
    { id: 'hook', show: 'statement', say: 'Every row has a source.' },
    { id: 'rows', show: 'number', say: 'Four hundred rows.', value: 400, label: 'rows' },
  ] }));
  const lines = [];
  const synthesise = async (film, options) => ({ dir: path.join(options.outDir, '.voice', 'fake'), sidecar: fakeSidecar(film), cached: false });
  const { report, exitCode } = await runMake({ specPath: path.join(dir, 'voiced.json'), out: path.join(dir, 'out-voiced', 'voiced.mp4'), exact: false, noRender: false, outline: false, shot: 'rows' }, { synthesise, log: (line) => lines.push(line) });
  assert.equal(exitCode, 0, JSON.stringify(report));
  const slice = path.join(dir, 'out-voiced', 'voiced.shot-rows.mp4');
  assert.equal(report.output, slice);
  assert.ok(existsSync(slice));
  assert.equal(existsSync(path.join(dir, 'out-voiced', 'voiced.mp4')), false, 'the film\'s own MP4 is not written');
  assert.equal(report.slice.silent, true);
  assert.ok(lines.includes('make: the slice is silent: the sound is mastered for the whole film'), lines.join('\n'));
  assert.equal(audioStreams(slice), '', 'no audio stream');
  assert.equal(probeVideo(slice).frames, report.slice.frames);
  assert.equal(report.audio, null);
});
