// The colour of a finished film: every MP4 is converted to BT.709 limited range and tagged (scripts/v2/render.mjs
// encoderArgs), on both capture paths, and the tags survive the mux of a film with sound. The round trip decodes the
// file as BT.709 by explicit option, which is what a player assumes for HD: ffmpeg's own default for an untagged file is
// BT.601, so a decode with defaults would pass on the old untagged output. Tests that need a browser, ffmpeg or ffprobe
// skip without them (PA_REQUIRE_BROWSER=1 makes that a failure). Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE, browserAvailable, ffmpegOrNull, probeVideo } from './helpers/session.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const WIDTH = 1920;
const HEIGHT = 1080;
const FRAME = 15;
const PATCH = 64; // the side of the square read at the centre of each rectangle
const TOLERANCE = 2; // levels
const BT709 = { space: 'bt709', primaries: 'bt709', transfer: 'bt709', range: 'tv' };
const GROUND = '#808080';

// Four 400 by 400 rectangles on a flat ground, on the one look whose frame is exactly its fills (post.grain 0).
const PATCHES = [['#d63a2f', 160], ['#2f8f4e', 600], ['#2a4bd7', 1040], ['#f3eee3', 1480]];
const SIZE = 400;
const TOP = 340;
const film = (extra = {}) => ({
  version: 2, fps: 30, look: 'ledger', ...extra,
  shots: [{ id: 'patches', show: 'free', hold: 1, background: GROUND, nodes: PATCHES.map(([fill, x], i) => (
    { type: 'path', id: `p${i}`, props: { d: `M${x} ${TOP}h${SIZE}v${SIZE}h-${SIZE}Z`, fill } })) }],
});
const probes = [...PATCHES.map(([hex, x]) => [hex, x + SIZE / 2, TOP + SIZE / 2]), [GROUND, 80, 80]];

let dir;
let ffmpeg = null;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-colour-'));
  ffmpeg = await ffmpegOrNull();
  writeFileSync(path.join(dir, 'silent.json'), JSON.stringify(film()));
  writeFileSync(path.join(dir, 'sound.json'), JSON.stringify(film({ music: { bed: 'pulse', bpm: 92 } })));
});
after(() => rmSync(dir, { recursive: true, force: true }));

async function needs(t) {
  if (!await browserAvailable()) { t.skip('no browser'); return false; }
  if (!ffmpeg) { t.skip('no ffmpeg'); return false; }
  if (spawnSync('ffprobe', ['-version']).status !== 0) { t.skip('no ffprobe'); return false; }
  return true;
}

// The report of `make` on the film `name` in the folder `out`.
function render(name, flags, out) {
  const run = spawnSync(process.execPath, [MAKE, path.join(dir, `${name}.json`), '--json', ...flags, '--out', path.join(dir, out, 'film.mp4')], { encoding: 'utf8', timeout: 240_000 });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

// The rgb24 bytes of frame `frame` of `file`, read as BT.709 limited range by explicit option. The flags make this decode
// round to the nearest level on every CPU: swscale's default YUV to RGB path rounds differently from one build and CPU
// to the next (measured on arm64 with the SIMD paths off, -cpuflags 0: the same film reads up to 4 levels low; with the
// flags the SIMD and the C paths agree to the byte). The cause of the first Linux CI failure (#f3eee3 read 240, not 243,
// on amd64 with ffmpeg 8.0.1) is inferred from that, not reproduced on Linux.
function decodeAs709(file, frame) {
  const vf = `select=eq(n\\,${frame}),scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int,format=rgb24`;
  const run = spawnSync(ffmpeg, ['-v', 'error', '-i', file, '-vf', vf, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 64 * 1024 * 1024 });
  assert.equal(run.status, 0, String(run.stderr));
  assert.equal(run.stdout.length, WIDTH * HEIGHT * 3, 'one 1920 by 1080 rgb24 frame');
  return run.stdout;
}

// The mean [r, g, b] over the PATCH by PATCH square centred on (cx, cy).
function patchMean(rgb, cx, cy) {
  const sum = [0, 0, 0];
  const x0 = cx - PATCH / 2;
  const y0 = cy - PATCH / 2;
  for (let y = y0; y < y0 + PATCH; y += 1) {
    for (let x = x0; x < x0 + PATCH; x += 1) for (let k = 0; k < 3; k += 1) sum[k] += rgb[(y * WIDTH + x) * 3 + k];
  }
  return sum.map((v) => v / (PATCH * PATCH));
}

const fillOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

for (const [flags, capture] of [[[], 'fast'], [['--exact'], 'exact']]) {
  test(`${capture}: the film is tagged bt709 on all three fields and limited range`, async (t) => {
    if (!await needs(t)) return;
    const report = render('silent', flags, `silent-${capture}`);
    assert.equal(report.capture, capture);
    assert.deepEqual(probeVideo(report.output).colour, BT709);
  });

  test(`${capture}: four flat patches and the ground decode, read as BT.709, within ${TOLERANCE} levels of their fills`, async (t) => {
    if (!await needs(t)) return;
    const report = render('silent', flags, `patches-${capture}`);
    const rgb = decodeAs709(report.output, FRAME);
    for (const [hex, cx, cy] of probes) {
      const fill = fillOf(hex);
      patchMean(rgb, cx, cy).forEach((v, k) => assert.ok(Math.abs(v - fill[k]) <= TOLERANCE, `${capture} ${hex} channel ${k}: ${v}`));
    }
  });
}

for (const [flags, capture] of [[[], 'fast'], [['--exact'], 'exact']]) {
  test(`${capture}: a film with sound keeps the tags through the mux`, async (t) => {
    if (!await needs(t)) return;
    const report = render('sound', flags, `sound-${capture}`);
    assert.notEqual(report.audio, null);
    assert.deepEqual(probeVideo(report.output).colour, BT709);
  });
}
