// W6 task 5: --compare-looks <shot-id> draws the anchor shot in every look that can draw it, one session after another in one
// browser, and tiles the frames on one PNG. [browser] One at a time: run with --test-concurrency=1; skips without a browser
// (PA_REQUIRE_BROWSER=1 makes that a failure). The pure parts are compare.test.mjs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { browserAvailable, ffmpegOrNull, headlessPidsUnder } from './helpers/session.mjs';
import { writeNoise } from './helpers/clicks.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { findFfprobe } from '../../scripts/lib/ffmpeg.mjs';
import { readPng } from '../../scripts/v2/png.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { launchRunBrowser } from '../../scripts/v2/session.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { lateFrameOf } from '../../scripts/v2/plan.mjs';
import { readBeatsFile, writeBeatsFile } from '../../scripts/v2/sound/beats-file.mjs';
import { snapFilm } from '../../scripts/v2/sound/snap.mjs';
import { COMPARE_COLUMNS, COMPARE_TILE_WIDTH } from '../../scripts/v2/compare.mjs';

const TILE_HEIGHT = 270; // 480 px of a 16:9 film
const PRO_LOOKS = ['desk', 'cosmos', 'ledger', 'poster', 'keynote', 'marker'];
const REFUSED_BACKGROUND = [0x2b, 0x27, 0x22];
const FILM = { version: 2, mode: 'pro', shots: [
  { id: 'hook', show: 'statement', say: 'Every row has a source.' },
  { id: 'rows', show: 'number', say: 'Four hundred rows.', value: 400, label: 'rows' },
] };

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-compare-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

function writeFilm(name, film) {
  const at = path.join(dir, name);
  mkdirSync(at, { recursive: true });
  const specPath = path.join(at, 'film.json');
  writeFileSync(specPath, JSON.stringify(film));
  return specPath;
}

// The pixels of cell `index` of the sheet, as one buffer (rows joined) from row `fromRow` of the cell down: STAMP_BAND skips the
// name each cell is stamped with, so two cells are compared by what was drawn in them and not by their labels.
const STAMP_BAND = 30;
function cellOf(png, index, fromRow = 0) {
  const [col, row] = [index % COMPARE_COLUMNS, Math.floor(index / COMPARE_COLUMNS)];
  const rows = [];
  for (let y = fromRow; y < TILE_HEIGHT; y++) {
    const from = ((row * TILE_HEIGHT + y) * png.width + col * COMPARE_TILE_WIDTH) * png.channels;
    rows.push(png.data.subarray(from, from + COMPARE_TILE_WIDTH * png.channels));
  }
  return { bytes: Buffer.concat(rows), channels: png.channels };
}

function share(cell, [r, g, b]) {
  let same = 0;
  for (let at = 0; at < cell.bytes.length; at += cell.channels) if (cell.bytes[at] === r && cell.bytes[at + 1] === g && cell.bytes[at + 2] === b) same += 1;
  return same / (cell.bytes.length / cell.channels);
}

// A browser whose contexts are counted: the most that were open at once is the proof that the sessions run one after another.
async function countedBrowser() {
  const browser = await launchRunBrowser();
  const counts = { open: 0, peak: 0, opened: 0 };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await newContext(...args);
    counts.open += 1;
    counts.opened += 1;
    counts.peak = Math.max(counts.peak, counts.open);
    const close = context.close.bind(context);
    context.close = async () => { counts.open -= 1; return close(); };
    return context;
  };
  return { browser, counts };
}

const noVoice = () => { throw new Error('the voice was made'); };

test('one sheet, a cell per look that serves the mode, four across, drawn one session after another in one browser', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const specPath = writeFilm('sheet', FILM);
  const { browser, counts } = await countedBrowser();
  try {
    const lines = [];
    const { report, exitCode } = await runMake({ specPath, compareLooks: 'hook', out: null }, { browser, log: (l) => lines.push(l), synthesise: noVoice });
    assert.equal(exitCode, 0, JSON.stringify(report.findings));
    assert.deepEqual(report.compare.looks.map((c) => c.look), PRO_LOOKS);
    assert.deepEqual(report.compare.looks.map((c) => c.status), ['drawn', 'drawn', 'drawn', 'drawn', 'drawn', 'drawn']);
    assert.equal(report.compare.shot, 'hook');
    assert.equal(report.compare.file, path.join(dir, 'sheet', 'out', 'film.looks.png'));
    const png = readPng(readFileSync(report.compare.file));
    assert.equal(png.width, COMPARE_COLUMNS * COMPARE_TILE_WIDTH);
    assert.equal(png.height, 2 * TILE_HEIGHT, 'six looks, four across: two rows');
    assert.equal(counts.peak, 1, 'never two sessions open at once');
    assert.equal(counts.opened, 6, 'one session per look');
    assert.deepEqual(report.stages.map((s) => s.name), ['validate', 'timeline', 'compare']);
    assert.equal(report.timed, 'estimated');
    assert.equal(report.output, null);
    assert.deepEqual(report.sheets, []);
    assert.ok(lines.includes('make: --compare-looks: no voice was made; every cell uses estimated timing'), lines.join('\n'));
    assert.equal(existsSync(path.join(dir, 'sheet', 'out', 'film.sheets')), false, 'no review sheets');
    assert.deepEqual(readdirSync(path.join(dir, 'sheet', 'out')), ['film.looks.png'], 'nothing else was written');
  } finally {
    await browser.close();
  }
  assert.equal(headlessPidsUnder(process.pid).size, 0, 'the browser was closed');
  return undefined;
});

test('two cells of different looks differ; the same look twice would not', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const { report, exitCode } = await runMake({ specPath: writeFilm('sheet-differ', FILM), compareLooks: 'hook', out: null });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  const png = readPng(readFileSync(report.compare.file));
  const cells = PRO_LOOKS.map((_, i) => cellOf(png, i, STAMP_BAND).bytes);
  assert.equal(cells[0].equals(cells[0]), true, 'the premise: the same cell is equal to itself');
  // below the stamp, every pair of cells differs: each cell was drawn in its own look (a film drawn in desk six times would not)
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) assert.equal(cells[i].equals(cells[j]), false, `${PRO_LOOKS[i]} and ${PRO_LOOKS[j]} are drawn differently`);
  // and by look: desk is paper, cosmos is a dark sky
  const brightness = (cell) => cell.bytes.reduce((sum, byte, at) => (at % cell.channels === 1 ? sum + byte : sum), 0) / (cell.bytes.length / cell.channels);
  assert.ok(brightness(cellOf(png, 0, STAMP_BAND)) > 150, 'desk is a light page');
  assert.ok(brightness(cellOf(png, 1, STAMP_BAND)) < 90, 'cosmos is a dark sky');
  return undefined;
});

test('a parked kind is drawn and marked, and a second run replaces the sheet', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const specPath = writeFilm('sheet-parked', FILM);
  const { report, exitCode } = await runMake({ specPath, compareLooks: 'rows', out: null });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  const status = Object.fromEntries(report.compare.looks.map((c) => [c.look, c.status]));
  assert.deepEqual([status.desk, status.ledger, status.poster, status.keynote], ['drawn', 'parked', 'parked', 'parked']);
  assert.equal(report.compare.looks.find((c) => c.look === 'ledger').note, 'experimental kind');
  const first = readFileSync(report.compare.file);
  const again = await runMake({ specPath, compareLooks: 'rows', out: null });
  assert.equal(again.exitCode, 0, JSON.stringify(again.report.findings));
  assert.equal(readFileSync(again.report.compare.file).equals(first), true, 'the same film and shot draw the same sheet');
  return undefined;
});

test('an overlay a look does not draw is a labelled flat cell, never a blank one or a crash', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const { report, exitCode } = await runMake({ specPath: writeFilm('sheet-overlay', { ...FILM, overlays: { progress: true } }), compareLooks: 'hook', out: null });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  const marker = report.compare.looks.find((c) => c.look === 'marker');
  assert.deepEqual([marker.status, marker.frame], ['refused', null]);
  assert.match(marker.note, /^overlays\.progress: look "marker" does not draw the progress overlay/);
  const png = readPng(readFileSync(report.compare.file));
  const refused = cellOf(png, PRO_LOOKS.indexOf('marker'));
  assert.ok(share(refused, REFUSED_BACKGROUND) > 0.5, 'a flat cell');
  assert.ok(share(refused, REFUSED_BACKGROUND) < 0.995, 'carrying its name and the reason in ink');
  const drawn = cellOf(png, 0);
  assert.equal(share(drawn, REFUSED_BACKGROUND) < 0.05, true, 'the drawn cells are pictures');
  return undefined;
});

test('the report\'s frame is the anchor\'s late frame in the film\'s own look, and the other looks still get their cell', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const film = { ...FILM, look: 'cosmos', overlays: { progress: true } };
  const { report, exitCode } = await runMake({ specPath: writeFilm('sheet-first-refused', film), compareLooks: 'hook', out: null });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.deepEqual(report.compare.looks.map((c) => c.look), PRO_LOOKS);
  assert.equal(report.compare.frame, report.compare.looks.find((c) => c.look === 'cosmos').frame, 'frame is the one of the film\'s own look');
  return undefined;
});

// ---- the timeline the render draws ----

const SNAP_FREE = (id, hold, cut) => ({ id, show: 'free', hold, background: '#f3eee3', ...(cut ? { cut } : {}), nodes: [{ type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } }] });
const SNAP_BEATS = Array.from({ length: 21 }, (_, k) => k * 0.5); // 120 BPM over 10 s

// A film with no narration, a music file and a beats file whose beats move three cuts (as make-sound.test.mjs builds its own).
function writeSnapFilm() {
  const at = path.join(dir, 'snap');
  mkdirSync(at, { recursive: true });
  writeNoise(path.join(at, 'm.wav'), { seconds: 10 });
  writeBeatsFile(path.join(at, 'm.beats.json'), { source: 'm.wav', bpm: 120, confidence: 1, beats: SNAP_BEATS });
  const film = { version: 2, fps: 30, mode: 'pro', shots: [SNAP_FREE('a', 1.9), SNAP_FREE('b', 2.3, 'cut'), SNAP_FREE('c', 2.1, 'cut'), SNAP_FREE('d', 1.7, 'cut')], music: { src: 'm.wav', beats: 'm.beats.json', snap: true } };
  const specPath = path.join(at, 'film.json');
  writeFileSync(specPath, JSON.stringify(film));
  return { at, specPath };
}

async function mediaTools(t) {
  const ffmpeg = await ffmpegOrNull();
  if (!ffmpeg || !findFfprobe({ ffmpeg })) { t.skip('no ffmpeg or ffprobe'); return false; }
  if (!await browserAvailable()) { t.skip('no browser'); return false; }
  return true;
}

// The refactor behind --compare-looks moved the snap out of drawnTimeline: --poster still reads film time on the snapped timeline.
test('--poster on a film with music.snap still draws the frame of the snapped timeline', async (t) => {
  if (!await mediaTools(t)) return undefined;
  const { at, specPath } = writeSnapFilm();
  const { report, exitCode } = await runMake({ specPath, poster: 'b', out: path.join(at, 'out', 'film.mp4') });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  const loaded = loadFilm(specPath);
  const drawn = snapFilm(loaded.film, loaded.timeline, readBeatsFile('m.beats.json', at).beats).timeline;
  assert.equal(report.poster.frame, Math.round(drawn.shots[1].start * 30));
  assert.notEqual(report.poster.frame, Math.round(loaded.timeline.shots[1].start * 30), 'the premise: the snap moved the cut into b');
  return undefined;
});

test('on a film with music.snap the anchor frame is read on the timeline the render draws, the cuts moved onto the beats', async (t) => {
  if (!await mediaTools(t)) return undefined;
  const { at, specPath } = writeSnapFilm();
  const { report, exitCode } = await runMake({ specPath, compareLooks: 'b', out: null });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  const beats = readBeatsFile('m.beats.json', at).beats;
  let moved = 0;
  for (const entry of report.compare.looks.filter((c) => c.frame !== null)) {
    const loaded = loadFilm(specPath, { look: entry.look });
    const drawn = snapFilm(loaded.film, loaded.timeline, beats).timeline;
    assert.equal(entry.frame, lateFrameOf(drawn, 1), `${entry.look}: the late frame of shot b on the snapped timeline`);
    if (entry.frame !== lateFrameOf(loaded.timeline, 1)) moved += 1;
  }
  assert.ok(moved > 0, 'the premise: the snap changed the anchor frame in at least one look, so reading the unsnapped timeline would be wrong');
  return undefined;
});

test('a voiced film is compared with no voice made, on estimated timing', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const specPath = writeFilm('voiced', { ...FILM, voice: { name: 'af_heart' } });
  const { report, exitCode } = await runMake({ specPath, compareLooks: 'hook', out: null }, { synthesise: noVoice });
  assert.equal(exitCode, 0, JSON.stringify(report.findings));
  assert.equal(report.timed, 'estimated');
  assert.equal(report.voice, null);
  assert.equal(report.compare.looks.length, 6);
  return undefined;
});
