// W5 task 1: --estimated writes the sheets and the board with no voice. This file holds what needs no browser: the flag and its
// refusals, the board's plan, the layout width and the report key. The run itself is board-browser.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { UsageError } from '../../shared/cli.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { parseMakeArgs } from '../../scripts/v2/cli.mjs';
import { BOARD_PER_STRIP, BOARD_COLUMNS, BOARD_JPEG_QUALITY, BOARD_STRIP_WIDTH, planBoard, planSheets } from '../../scripts/v2/plan.mjs';
import { layoutSheet, MAX_SHEET_WIDTH } from '../../scripts/v2/layout.mjs';
import { formatText, reportOf } from '../../scripts/v2/report.mjs';
import { writeBoard } from '../../scripts/v2/sheets.mjs';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FPS = 30;
const SEVEN_SHOT_FILM = { version: 2, mode: 'pro', look: 'desk', fps: FPS, shots: Array.from({ length: 7 }, (_, i) => ({ id: `s${i + 1}`, show: 'free', hold: 2 + (i % 2) })) };
const timeline = buildTimeline(SEVEN_SHOT_FILM, { fps: FPS });

test('--estimated needs --sheets-only', () => {
  assert.throws(() => parseMakeArgs(['f.json', '--estimated']), /--estimated needs --sheets-only/);
  assert.throws(() => parseMakeArgs(['f.json', '--estimated']), (err) => err instanceof UsageError && /with no voice/.test(err.message));
  assert.equal(parseMakeArgs(['f.json', '--sheets-only', '--estimated']).estimated, true);
  assert.equal(parseMakeArgs(['f.json', '--sheets-only']).estimated, false);
});

test('--estimated is refused beside a flag it cannot serve: a slice, an outline, a batch, --no-render alone', () => {
  const base = ['f.json', '--sheets-only', '--estimated'];
  assert.throws(() => parseMakeArgs([...base, '--shot', 'a']), /--estimated does not go with --shot/);
  assert.throws(() => parseMakeArgs([...base, '--range', '1..2']), /--estimated does not go with --range/);
  assert.throws(() => parseMakeArgs([...base, '--outline']), /--estimated does not go with --outline/);
  assert.throws(() => parseMakeArgs([...base, '--batch', 'rows.json', '--out', 'x/{index}.mp4']), /--estimated does not go with --batch/);
  assert.throws(() => parseMakeArgs([...base, '--phonemes']), /does not go with --sheets-only/); // --phonemes refuses --sheets-only first
  assert.throws(() => parseMakeArgs(['f.json', '--no-render', '--estimated']), /--estimated needs --sheets-only/);
  // the modes that already refuse --sheets-only still say so
  assert.throws(() => parseMakeArgs([...base, '--poster', '2']), /does not go with --sheets-only/);
  assert.throws(() => parseMakeArgs([...base, '--inspect', '2']), /does not go with --sheets-only/);
  assert.throws(() => parseMakeArgs([...base, '--preview']), /does not go with --sheets-only/);
});

test('--estimated goes with --sheets-only, --json, --out and --subtitles', () => {
  const options = parseMakeArgs(['f.json', '--sheets-only', '--estimated', '--json', '--out', 'x/y.mp4', '--subtitles', 'srt']);
  assert.equal(options.estimated, true);
  assert.equal(options.noRender, true);
});

test('the board constants', () => {
  assert.deepEqual([BOARD_PER_STRIP, BOARD_COLUMNS, BOARD_JPEG_QUALITY, BOARD_STRIP_WIDTH], [6, 3, 80, 1920]);
});

test('the board is one tile per shot at its late frame, six to a strip', () => {
  const strips = planBoard(SEVEN_SHOT_FILM, timeline);
  assert.deepEqual(strips.map((s) => [s.name, s.tiles.length]), [['board-1.jpg', 6], ['board-2.jpg', 1]]);
  assert.equal(strips[0].tiles[0].frame, planSheets(SEVEN_SHOT_FILM, timeline)[0].tiles.at(-1).frame); // the phone tile's frame
  const phone = (i) => planSheets(SEVEN_SHOT_FILM, timeline)[i].tiles.at(-1);
  strips.flatMap((s) => s.tiles).forEach((tile, i) => assert.deepEqual(tile, { frame: phone(i).frame, t: phone(i).t, label: phone(i).label }));
  assert.match(strips[1].tiles[0].label, /^s7 · /);
});

test('a one-shot film has one strip of one tile; an exact multiple of six has no empty strip', () => {
  const one = { ...SEVEN_SHOT_FILM, shots: SEVEN_SHOT_FILM.shots.slice(0, 1) };
  assert.deepEqual(planBoard(one, buildTimeline(one, { fps: FPS })).map((s) => s.tiles.length), [1]);
  const twelve = { ...SEVEN_SHOT_FILM, shots: Array.from({ length: 12 }, (_, i) => ({ id: `t${i + 1}`, show: 'free', hold: 1 })) };
  assert.deepEqual(planBoard(twelve, buildTimeline(twelve, { fps: FPS })).map((s) => [s.name, s.tiles.length]), [['board-1.jpg', 6], ['board-2.jpg', 6]]);
});

test('layoutSheet takes a narrower width: a board strip is at most 1920 px wide and three tiles across', () => {
  const canvas = { w: 1920, h: 1080 };
  const strip = layoutSheet({ tiles: planBoard(SEVEN_SHOT_FILM, timeline)[0].tiles, canvas, columns: BOARD_COLUMNS, maxWidth: BOARD_STRIP_WIDTH });
  assert.ok(strip.width <= BOARD_STRIP_WIDTH, `${strip.width}`);
  assert.deepEqual([...new Set(strip.placements.map((p) => p.y))].length, 2, 'six tiles, three across: two rows');
  const wide = layoutSheet({ tiles: planBoard(SEVEN_SHOT_FILM, timeline)[0].tiles, canvas, columns: BOARD_COLUMNS });
  assert.ok(wide.width > BOARD_STRIP_WIDTH && wide.width <= MAX_SHEET_WIDTH, 'the default is still the sheet width');
});

test('the report carries board only when the run made one', () => {
  const blank = { validated: true, error: null, stages: [], findings: [], sheets: [], output: null, timed: 'estimated', voice: null, audio: null, post: null, capture: null, frames: 0, captured: 0, seconds: null, msPerFrame: null, bytes: null, mbps: null };
  assert.equal('board' in reportOf(blank), false);
  assert.deepEqual(reportOf({ ...blank, board: ['/x/board-1.jpg'] }).board, ['/x/board-1.jpg']);
});

const TEXT_BLANK = { validated: true, error: null, stages: [{ name: 'validate', ok: true, seconds: 0 }], findings: [], sheets: ['a.png'], output: null, timed: 'estimated', voice: null, audio: null, post: 'webgl2', capture: null, frames: 180, captured: 0, seconds: null, msPerFrame: null, bytes: null, mbps: null };

test('the text form says where the board is and how many strips it has', () => {
  const two = formatText(reportOf({ ...TEXT_BLANK, board: ['/x/out/film.sheets/board/board-1.jpg', '/x/out/film.sheets/board/board-2.jpg'] }), { sheetsDir: '/x/out/film.sheets' });
  assert.match(two, /^board: \/x\/out\/film\.sheets\/board \(2 strips\)$/m);
  const one = formatText(reportOf({ ...TEXT_BLANK, board: ['/x/out/film.sheets/board/board-1.jpg'] }), { sheetsDir: '/x/out/film.sheets' });
  assert.match(one, /^board: \/x\/out\/film\.sheets\/board \(1 strip\)$/m);
  assert.match(formatText(reportOf({ ...TEXT_BLANK, board: [] }), { sheetsDir: '/x/out/film.sheets' }), /^board: none written$/m);
  assert.doesNotMatch(formatText(reportOf(TEXT_BLANK), { sheetsDir: '/x/out/film.sheets' }), /board/);
});

// ---- writeBoard on a stub page: the folder it is given may hold anything ----
const stubSession = () => ({ film: SEVEN_SHOT_FILM, timeline, page: { evaluate: async () => Buffer.from('jpeg').toString('base64') } });
const scratch = () => mkdtempSync(path.join(tmpdir(), 'mm-board-unit-'));
const logTo = (lines) => (line) => lines.push(line);

test('writeBoard writes its strips and removes only its own board-N.jpg files', async () => {
  const dir = scratch();
  try {
    mkdirSync(path.join(dir, 'board'));
    writeFileSync(path.join(dir, 'board', 'board-9.jpg'), 'old');
    writeFileSync(path.join(dir, 'board', 'notes.txt'), 'mine');
    const files = await writeBoard({ session: stubSession(), dir });
    assert.deepEqual(files, [path.join(dir, 'board', 'board-1.jpg'), path.join(dir, 'board', 'board-2.jpg')]);
    assert.deepEqual(readdirSync(path.join(dir, 'board')).sort(), ['board-1.jpg', 'board-2.jpg', 'notes.txt']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a board-1.jpg that is a folder is left alone: that strip is skipped with a message, the others are written', async () => {
  const dir = scratch();
  try {
    mkdirSync(path.join(dir, 'board', 'board-1.jpg'), { recursive: true });
    writeFileSync(path.join(dir, 'board', 'board-1.jpg', 'keep.txt'), 'mine');
    const lines = [];
    const files = await writeBoard({ session: stubSession(), dir, log: logTo(lines) });
    assert.deepEqual(files, [path.join(dir, 'board', 'board-2.jpg')]);
    assert.equal(readFileSync(path.join(dir, 'board', 'board-1.jpg', 'keep.txt'), 'utf8'), 'mine');
    assert.ok(lines.some((l) => /board-1\.jpg is not a file/.test(l)), lines.join('\n'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a board that is a file is left alone: no board is written, with a message', async () => {
  const dir = scratch();
  try {
    writeFileSync(path.join(dir, 'board'), 'mine');
    const lines = [];
    assert.deepEqual(await writeBoard({ session: stubSession(), dir, log: logTo(lines) }), []);
    assert.equal(readFileSync(path.join(dir, 'board'), 'utf8'), 'mine');
    assert.ok(lines.some((l) => /board is not a folder/.test(l)), lines.join('\n'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a board that is a symbolic link is not followed: nothing in its target is deleted or written', async () => {
  const dir = scratch();
  try {
    const target = path.join(dir, 'elsewhere');
    mkdirSync(target);
    writeFileSync(path.join(target, 'board-1.jpg'), 'theirs');
    symlinkSync(target, path.join(dir, 'board'));
    const lines = [];
    assert.deepEqual(await writeBoard({ session: stubSession(), dir, log: logTo(lines) }), []);
    assert.equal(readFileSync(path.join(target, 'board-1.jpg'), 'utf8'), 'theirs');
    assert.deepEqual(readdirSync(target), ['board-1.jpg']);
    assert.ok(lstatSync(path.join(dir, 'board')).isSymbolicLink());
    assert.ok(lines.some((l) => /board is a symbolic link/.test(l)), lines.join('\n'));
    assert.equal(existsSync(path.join(target, 'board-2.jpg')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
