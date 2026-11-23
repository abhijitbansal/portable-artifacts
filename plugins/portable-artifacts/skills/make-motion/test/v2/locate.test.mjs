// The locate helper (motion-steals W3 task 8): a seen target becomes a `regions` box in three plain calls. Geometry,
// the PNG writer, the digit font, and the command's exit codes. No browser, no model; ffmpeg only where a test says so.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPng } from '../../scripts/v2/png.mjs';
import { MAX_OVERLAY_SIDE, PICTURE_DECODERS, PICTURE_DEMUXERS, STRIPS, GRID, PAD_CELLS, REGION_DECIMALS, stripsBox, cellsBox, toRegion } from '../../scripts/lib/locate.mjs';
import { encodePng } from '../../scripts/lib/png-write.mjs';
import { DIGITS, PLATE_PAD, drawNumber } from '../../scripts/lib/digits.mjs';
import { pngOf } from './helpers/png.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LOCATE = path.join(SKILL, 'scripts/locate.mjs');
const made = [];
const scratch = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'locate-'));
  made.push(dir);
  return dir;
};
after(() => {
  for (const dir of made) {
    for (const name of ['locked', 'noaccess']) { try { chmodSync(path.join(dir, name), 0o700); } catch { /* not made in this folder */ } }
    rmSync(dir, { recursive: true, force: true });
  }
});
const run = (args, env = {}) => spawnSync(process.execPath, [LOCATE, ...args], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, ...env } });

const TARGET = [0.55, 0.2, 0.1, 0.08]; // [x, y, w, h]
const CELL = (2 / 9) / 6; // a cell of the grid over two strips

test('the constants the brief fixes', () => {
  assert.deepEqual([STRIPS, GRID, PAD_CELLS, MAX_OVERLAY_SIDE, REGION_DECIMALS], [9, 6, 0.25, 1600, 3]);
});

test('two strips each way, then cells 15 to 30, give the region', () => {
  assert.deepEqual(toRegion(cellsBox(stripsBox({ cols: [5, 6], rows: [2, 3] }), [15, 30])), [0.509, 0.176, 0.167, 0.13]);
});

test('the region holds the target, each edge within 1.25 cells', () => {
  const [x, y, w, h] = toRegion(cellsBox(stripsBox({ cols: [5, 6], rows: [2, 3] }), [15, 30]));
  assert.ok(x <= 0.55 && y <= 0.2 && x + w >= 0.65 && y + h >= 0.28);
  for (const gap of [0.55 - x, 0.2 - y, x + w - 0.65, y + h - 0.28]) assert.ok(gap <= 1.25 * CELL + 1e-3, String(gap));
});

test('the first pass alone misses that tolerance', () => {
  const [x] = toRegion(stripsBox({ cols: [5, 6], rows: [2, 3] }));
  assert.ok(TARGET[0] - x > 1.25 * CELL);
});

// A picker that names every strip and every cell a target touches (what an agent looking at the PNGs does).
const EPS = 1e-9;
const touched = (lo, hi, n) => [Math.min(n - 1, Math.floor(lo * n + EPS)), Math.min(n - 1, Math.ceil(hi * n - EPS) - 1)];
function pick([x, y, w, h]) {
  const [c0, c1] = touched(x, x + w, STRIPS);
  const [r0, r1] = touched(y, y + h, STRIPS);
  const [bx, by, bw, bh] = [c0 / STRIPS, r0 / STRIPS, (c1 - c0 + 1) / STRIPS, (r1 - r0 + 1) / STRIPS];
  const [k0, k1] = touched((x - bx) / bw, (x + w - bx) / bw, GRID);
  const [l0, l1] = touched((y - by) / bh, (y + h - by) / bh, GRID);
  return { cols: [c0 + 1, c1 + 1], rows: [r0 + 1, r1 + 1], cells: [l0 * GRID + k0 + 1, l1 * GRID + k1 + 1], cell: [bw / GRID, bh / GRID] };
}

test('a picker that names what the target touches meets the tolerance on five targets', () => {
  const targets = {
    'top-left corner': [0, 0, 0.1, 0.08],
    'bottom-right corner': [0.9, 0.92, 0.1, 0.08],
    centre: [0.45, 0.46, 0.1, 0.08],
    'a tiny box': [0.31, 0.52, 0.01, 0.01],
    'a wide box': [0.05, 0.4, 0.9, 0.1],
  };
  for (const [name, [x, y, w, h]] of Object.entries(targets)) {
    const { cols, rows, cells, cell } = pick([x, y, w, h]);
    const [rx, ry, rw, rh] = toRegion(cellsBox(stripsBox({ cols, rows }), cells));
    const gaps = [x - rx, y - ry, rx + rw - (x + w), ry + rh - (y + h)];
    gaps.forEach((gap, i) => {
      assert.ok(gap >= -1e-3, `${name}: edge ${i} holds the target (${gap})`);
      assert.ok(gap <= 1.25 * cell[i % 2] + 1e-3, `${name}: edge ${i} within 1.25 cells (${gap})`);
    });
  }
});

test('the box is held inside the picture, and strips and cells outside their range are refused', () => {
  assert.deepEqual(toRegion(cellsBox(stripsBox({ cols: [1, 1], rows: [1, 1] }), [1, 1])), [0, 0, 0.023, 0.023]);
  assert.throws(() => stripsBox({ cols: [0, 1], rows: [1, 1] }), /1 to 9/);
  assert.throws(() => stripsBox({ cols: [1, 10], rows: [1, 1] }), /1 to 9/);
  assert.throws(() => cellsBox([0, 0, 1, 1], [1, 37]), /1 to 36/);
  assert.throws(() => cellsBox([0, 0, 1, 1], [0, 3]), /1 to 36/);
});

test('encodePng round-trips through the reader', () => {
  const data = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9, 8, 8, 8, 7, 7, 7]);
  assert.deepEqual(readPng(encodePng({ width: 3, height: 2, channels: 3, data })), { width: 3, height: 2, channels: 3, data });
});

test('encodePng round-trips four channels, and a wide picture past one deflate block', () => {
  const rgba = Buffer.from([1, 2, 3, 255, 4, 5, 6, 128]);
  assert.deepEqual(readPng(encodePng({ width: 2, height: 1, channels: 4, data: rgba })), { width: 2, height: 1, channels: 4, data: rgba });
  const wide = Buffer.alloc(700 * 300 * 3).map((_, i) => (i * 7) % 251);
  assert.deepEqual(readPng(encodePng({ width: 700, height: 300, channels: 3, data: wide })).data, wide);
});

test('a digit is seven rows of five, and drawNumber inks its pixels', () => {
  assert.deepEqual(Object.keys(DIGITS), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  for (const rows of Object.values(DIGITS)) {
    assert.equal(rows.length, 7);
    for (const row of rows) assert.match(row, /^[01]{5}$/);
  }
  assert.equal(DIGITS['7'][0], '11111');
  const [W, H, scale, ink, plate] = [40, 30, 2, [255, 0, 0], [0, 0, 255]];
  const pixels = { width: W, height: H, channels: 3, data: Buffer.alloc(W * H * 3, 200) };
  const size = drawNumber(pixels, { x: 3, y: 4, value: 7, scale, ink, plate });
  const at = (px, py) => [...pixels.data.subarray((py * W + px) * 3, (py * W + px) * 3 + 3)];
  assert.deepEqual(at(3, 4), plate, 'the plate corner');
  assert.deepEqual(at(3 + PLATE_PAD * scale, 4 + PLATE_PAD * scale), ink, 'the top-left ink cell of the 7');
  assert.deepEqual(at(3 + PLATE_PAD * scale + 5 * scale, 4 + PLATE_PAD * scale), plate, 'the gap right of the glyph is plate');
  assert.deepEqual(at(2, 4), [200, 200, 200], 'nothing outside the plate');
  assert.deepEqual(size, { width: (5 + 2 * PLATE_PAD) * scale, height: (7 + 2 * PLATE_PAD) * scale });
});

test('drawNumber writes two digits side by side and clips at the picture edge', () => {
  const [W, H, ink, plate] = [20, 12, [1, 2, 3], [9, 9, 9]];
  const pixels = { width: W, height: H, channels: 3, data: Buffer.alloc(W * H * 3, 0) };
  const size = drawNumber(pixels, { x: 14, y: 8, value: 36, scale: 1, ink, plate });
  assert.equal(size.width, (5 + 1 + 5 + 2 * PLATE_PAD) * 1);
  const at = (px, py) => [...pixels.data.subarray((py * W + px) * 3, (py * W + px) * 3 + 3)];
  assert.deepEqual(at(14, 8), plate, 'the plate starts inside the picture');
  assert.deepEqual(at(W - 1, 8), plate, 'the plate runs past the right edge and is cut there');
  assert.deepEqual(at(14 + PLATE_PAD, 8 + PLATE_PAD), ink, 'the first digit (3) starts at its ink cell');
  assert.deepEqual(at(13, 8), [0, 0, 0], 'nothing is drawn left of the plate');
  assert.deepEqual(at(14, 7), [0, 0, 0], 'nothing is drawn above the plate');
  const outside = { width: 4, height: 4, channels: 3, data: Buffer.alloc(48, 5) };
  drawNumber(outside, { x: 10, y: 10, value: 1, scale: 1, ink, plate });
  assert.ok(outside.data.every((b) => b === 5), 'a plate wholly outside changes nothing');
});

test('step 1 writes two PNGs no larger than 1600 px a side; step 3 prints the region', () => {
  const dir = scratch();
  const picture = path.join(dir, 'p.png');
  writeFileSync(picture, pngOf(900, 600, (x, y) => [x % 256, y % 256, (x + y) % 256]));
  const one = run([picture, '--out', path.join(dir, 'o')]);
  assert.equal(one.status, 0, one.stderr);
  for (const name of ['strips-cols.png', 'strips-rows.png']) {
    const file = path.join(dir, 'o', name);
    assert.ok(existsSync(file), name);
    assert.ok(one.stdout.includes(file), `${name} is printed`);
    const png = readPng(readFileSync(file));
    assert.ok(png.width <= 1600 && png.height <= 1600, `${name} ${png.width}x${png.height}`);
  }
  assert.match(one.stdout, /--cols/);
  const three = run([picture, '--cols', '5-6', '--rows', '2-3', '--cells', '15-30']);
  assert.equal(three.status, 0, three.stderr);
  assert.equal(three.stdout, '[0.509, 0.176, 0.167, 0.13]\n');
  assert.deepEqual(JSON.parse(run([picture, '--cols', '5-6', '--rows', '2-3', '--cells', '15-30', '--json']).stdout), { region: [0.509, 0.176, 0.167, 0.13] });
});

test('a picture past 1600 px is scaled down for the overlays', () => {
  const dir = scratch();
  const picture = path.join(dir, 'big.png');
  writeFileSync(picture, pngOf(2000, 200, (x) => [x % 256, 80, 120]));
  assert.equal(run([picture, '--out', path.join(dir, 'o')]).status, 0);
  const png = readPng(readFileSync(path.join(dir, 'o', 'strips-cols.png')));
  assert.equal(png.width, 1600);
  assert.ok(png.height <= 1600);
});

test('step 2 writes the numbered grid of the crop; step 3 with --out also draws the box', () => {
  const dir = scratch();
  const picture = path.join(dir, 'p.png');
  writeFileSync(picture, pngOf(900, 600, (x, y) => [x % 256, y % 256, 90]));
  const two = run([picture, '--cols', '5-6', '--rows', '2-3', '--out', path.join(dir, 'o')]);
  assert.equal(two.status, 0, two.stderr);
  const grid = readPng(readFileSync(path.join(dir, 'o', 'grid.png')));
  assert.ok(grid.width <= 1600 && grid.height <= 1600);
  assert.match(two.stdout, /--cells/);
  const three = run([picture, '--cols', '5-6', '--rows', '2-3', '--cells', '15-30', '--out', path.join(dir, 'o')]);
  assert.equal(three.status, 0, three.stderr);
  assert.ok(existsSync(path.join(dir, 'o', 'box.png')));
});

test('a strip of 0, a cell of 37, a URL and --out equal to the picture each exit 2 naming what is accepted', () => {
  const dir = scratch();
  const picture = path.join(dir, 'p.png');
  writeFileSync(picture, pngOf(90, 60, () => [1, 2, 3]));
  const strip = run([picture, '--cols', '0-1', '--rows', '1-2', '--out', path.join(dir, 'o')]);
  assert.equal(strip.status, 2);
  assert.match(strip.stderr, /1 to 9/);
  const cell = run([picture, '--cols', '1-2', '--rows', '1-2', '--cells', '5-37']);
  assert.equal(cell.status, 2);
  assert.match(cell.stderr, /1 to 36/);
  const url = run(['https://example.com/p.png', '--out', path.join(dir, 'o')]);
  assert.equal(url.status, 2);
  assert.match(url.stderr, /URL/);
  const same = run([picture, '--out', picture]);
  assert.equal(same.status, 2);
  assert.match(same.stderr, /--out/);
  assert.deepEqual(readPng(readFileSync(picture)).width, 90, 'the picture is untouched');
});

test('other bad calls exit 2: a folder, a missing file, a half-named region, step 1 without --out, a backwards range', () => {
  const dir = scratch();
  const picture = path.join(dir, 'p.png');
  writeFileSync(picture, pngOf(90, 60, () => [1, 2, 3]));
  for (const args of [[dir, '--out', path.join(dir, 'o')], [path.join(dir, 'nope.png'), '--out', path.join(dir, 'o')], [picture, '--cols', '1-2'],
    [picture], [picture, '--cols', '3-2', '--rows', '1-1', '--out', path.join(dir, 'o')], [picture, '--cells', '1-2']]) {
    const r = run(args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.equal(r.stdout, '');
  }
});

// Exit 2 with exactly one stderr line and no stack trace.
function assertOneLineExit2(r, label) {
  assert.equal(r.status, 2, `${label}: ${r.stderr}`);
  assert.equal(r.stdout, '', label);
  assert.equal(r.stderr.trimEnd().split('\n').length, 1, `${label}: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /\n\s+at /, label);
}

const isRoot = process.getuid?.() === 0;
test('an unreadable picture exits 2 with one line', { skip: isRoot && 'root reads any file' }, () => {
  const dir = scratch();
  const picture = path.join(dir, 'p.png');
  writeFileSync(picture, pngOf(90, 60, () => [1, 2, 3]));
  chmodSync(picture, 0o000);
  assertOneLineExit2(run([picture, '--out', path.join(dir, 'o')]), 'EACCES picture');
});

test('--out under a file, and an unwritable folder, exit 2 with one line', { skip: isRoot && 'root writes anywhere' }, () => {
  const dir = scratch();
  const picture = path.join(dir, 'p.png');
  writeFileSync(picture, pngOf(90, 60, () => [1, 2, 3]));
  assertOneLineExit2(run([picture, '--out', path.join(picture, 'x')]), 'ENOTDIR --out');
  const locked = path.join(dir, 'locked');
  mkdirSync(locked);
  chmodSync(locked, 0o500);
  assertOneLineExit2(run([picture, '--out', locked]), 'EACCES folder');
  assertOneLineExit2(run([picture, '--out', path.join(locked, 'sub')]), 'EACCES make folder');
  assertOneLineExit2(run([picture, '--cols', '1-2', '--rows', '1-2', '--cells', '1-2', '--out', locked]), 'EACCES box.png');
});

test('a device or a pipe is not a picture: exit 2', () => {
  assertOneLineExit2(run(['/dev/zero', '--out', path.join(scratch(), 'o')]), '/dev/zero');
});

// A sparse file over Node's read limit (2 GiB: readFileSync throws ERR_FS_FILE_TOO_LARGE, a RangeError with no syscall):
// it takes no disk, and the check reads its size, never its bytes.
test('a picture over the read limit exits 2 with one line', () => {
  const dir = scratch();
  const big = path.join(dir, 'big.png');
  const fd = openSync(big, 'w');
  try { ftruncateSync(fd, 2 ** 31); } finally { closeSync(fd); }
  const r = run([big, '--out', path.join(dir, 'o')]);
  assertOneLineExit2(r, 'a 2 GiB picture');
  assert.match(r.stderr, /too large/);
});

test('a JPEG without ffmpeg exits 2 and says what to do', () => {
  const dir = scratch();
  const picture = path.join(dir, 'p.jpg');
  writeFileSync(picture, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  const r = run([picture, '--out', path.join(dir, 'o')], { FFMPEG_PATH: '/nonexistent/ffmpeg', PATH: '' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /locate needs ffmpeg to read a jpg picture; run the doctor, or give a PNG/);
});

// A picture png.mjs cannot read goes to ffmpeg behind all three whitelists, by its real absolute path. The recording stand-in
// logs every call's argv to a file and fails: the argv is what these tests read, so they need no ffmpeg.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
function recordingFfmpeg(dir) {
  const log = path.join(dir, 'ffmpeg-calls.jsonl');
  const tool = path.join(dir, 'ffmpeg-recorder');
  writeFileSync(tool, `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nprocess.exit(1);\n`);
  chmodSync(tool, 0o755);
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { env: { FFMPEG_PATH: tool }, calls };
}
// The one -i of every recorded call, behind the protocol, demuxer and decoder whitelists, naming `file`.
function assertWhitelistedPicture(calls, file) {
  assert.equal(calls.length, 1, 'one ffmpeg call');
  const [argv] = calls;
  const at = argv.indexOf('-i');
  assert.ok(at >= 6, `an input after the whitelists: ${argv.join(' ')}`);
  assert.equal(argv.lastIndexOf('-i'), at, 'one input');
  assert.deepEqual(argv.slice(at - 6, at - 4), ['-protocol_whitelist', 'file'], 'the file protocol only: no pipe, no http');
  assert.equal(argv[at - 4], '-format_whitelist');
  assert.deepEqual(argv[at - 3].split(',').sort(), [...PICTURE_DEMUXERS].sort(), 'the picture demuxers only');
  assert.equal(argv[at - 2], '-codec_whitelist');
  assert.deepEqual(argv[at - 1].split(',').sort(), [...PICTURE_DECODERS].sort(), 'the picture decoders only');
  for (const refused of ['hls', 'concat', 'lavfi', 'mov', 'matroska', 'sdp', 'rtsp']) assert.ok(!argv[at - 3].split(',').includes(refused), `${refused} is no picture demuxer`);
  assert.equal(argv[at + 1], file, 'the file by its real absolute path');
  assert.ok(path.isAbsolute(argv[at + 1]));
}

test('a picture ffmpeg decodes is opened behind the protocol, demuxer and decoder whitelists', () => {
  const dir = scratch();
  const picture = path.join(dir, 'p.jpg');
  writeFileSync(picture, JPEG_BYTES);
  const { env, calls } = recordingFfmpeg(dir);
  run([picture, '--out', path.join(dir, 'o')], env);
  assertWhitelistedPicture(calls(), realpathSync(picture));
});

test('a link to a picture is resolved before ffmpeg sees it', () => {
  const dir = scratch();
  const real = path.join(dir, 'real.jpg');
  const link = path.join(dir, 'link.jpg');
  writeFileSync(real, JPEG_BYTES);
  symlinkSync(real, link);
  const { env, calls } = recordingFfmpeg(dir);
  run([link, '--out', path.join(dir, 'o')], env);
  assertWhitelistedPicture(calls(), realpathSync(real));
});

test('a relative path that looks like a protocol reaches ffmpeg as an absolute path', () => {
  const dir = scratch();
  writeFileSync(path.join(dir, 'pipe:0'), JPEG_BYTES);
  const { env, calls } = recordingFfmpeg(dir);
  spawnSync(process.execPath, [LOCATE, 'pipe:0', '--out', 'o'], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env } });
  assertWhitelistedPicture(calls(), realpathSync(path.join(dir, 'pipe:0')));
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
test('a playlist named .png is not decoded, and a GIF and a BMP still are', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const dir = scratch();
  const playlist = path.join(dir, 'list.png');
  writeFileSync(playlist, '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2,\n/etc/hosts\n#EXT-X-ENDLIST\n');
  const refused = run([playlist, '--out', path.join(dir, 'o1')]);
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /ffmpeg could not read list\.png as a picture/);
  assert.ok(!existsSync(path.join(dir, 'o1', 'strips-cols.png')));
  writeFileSync(path.join(dir, 'p.png'), pngOf(64, 48, (x, y) => [x * 3, y * 4, 90]));
  for (const ext of ['gif', 'bmp']) {
    const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, 'p.png'), path.join(dir, `p.${ext}`)]);
    assert.equal(made.status, 0, String(made.stderr));
    const r = run([path.join(dir, `p.${ext}`), '--out', path.join(dir, `o-${ext}`)]);
    assert.equal(r.status, 0, `${ext}: ${r.stderr}`);
    assert.ok(existsSync(path.join(dir, `o-${ext}`, 'strips-cols.png')), ext);
  }
});

test('a JPEG is decoded by ffmpeg when it is there', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const dir = scratch();
  writeFileSync(path.join(dir, 'p.png'), pngOf(120, 80, (x, y) => [x * 2, y * 3, 100]));
  const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, 'p.png'), path.join(dir, 'p.jpg')]);
  assert.equal(made.status, 0, String(made.stderr));
  const r = run([path.join(dir, 'p.jpg'), '--out', path.join(dir, 'o')]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(path.join(dir, 'o', 'strips-cols.png')));
});
