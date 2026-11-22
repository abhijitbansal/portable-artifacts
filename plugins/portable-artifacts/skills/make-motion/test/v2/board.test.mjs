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
import { reportOf } from '../../scripts/v2/report.mjs';

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
