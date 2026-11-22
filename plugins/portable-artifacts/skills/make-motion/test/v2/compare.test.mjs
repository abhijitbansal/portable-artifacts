// W6 task 5: --compare-looks <shot-id> draws one shot in every look that can draw it, on one sheet. This file holds what needs
// no browser: which looks are compared and how a refusal or a parked kind reads, the flag and its conflicts, the sheet's layout,
// the report key and the refusals that come before a browser. The sheet itself is compare-browser.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { UsageError } from '../../shared/cli.mjs';
import { registries } from '../../engine/registry.mjs';
import { encodePng } from '../../scripts/lib/png-write.mjs';
import { readPng } from '../../scripts/v2/png.mjs';
import { SpecError, validateFilm } from '../../scripts/v2/spec.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { composeInPage } from '../../scripts/v2/sheets.mjs';
import { FilmTimeError } from '../../scripts/v2/film-time.mjs';
import { parseMakeArgs } from '../../scripts/v2/cli.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { absolutePaths, formatText, reportOf } from '../../scripts/v2/report.mjs';
import { COMPARE_COLUMNS, COMPARE_MAX, COMPARE_TILE_WIDTH, assembleSheet, comparableLooks, comparePath, memoiseMusicInput, settleFindings, writeComparison } from '../../scripts/v2/compare.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const FILM_PATH = 'film.json';
const scratch = () => mkdtempSync(path.join(tmpdir(), 'mm-compare-'));

const VIRAL_FILM = { version: 2, mode: 'viral', shots: [{ id: 'hook', show: 'statement', say: 'Stop scrolling.' }] };
const PRO_FILM_WITH_NUMBER = { version: 2, mode: 'pro', look: 'desk', shots: [{ id: 'proof', show: 'number', value: 10, label: 'films built valid' }] };
const PRO_FILM_WITH_SCREEN = { version: 2, mode: 'pro', look: 'desk', shots: [{ id: 'problem', show: 'screen', frame: 'window', src: 'dash.png', title: 'Where did this number come from?' }] };
const FREE_FILM = { version: 2, mode: 'pro', look: 'desk', fps: 30, shots: [{ id: 'a', show: 'free', hold: 2 }, { id: 'b', show: 'free', hold: 2 }] };

function withPicture(dir) {
  writeFileSync(path.join(dir, 'dash.png'), encodePng({ width: 2, height: 2, channels: 3, data: Buffer.alloc(12, 200) }));
  return dir;
}

// F-12: the page function is sent to the browser as source, so its helpers live inside it; it still stays within the 50-line limit.
test('composeInPage is under 50 lines, and carries its own note wrapping to the page', () => {
  const source = composeInPage.toString();
  assert.ok(source.split('\n').length < 50, `composeInPage is ${source.split('\n').length} lines`);
  assert.match(source, /wrapNote/, 'the wrapping is an inner function, so it travels with the source');
});

test('the constants of the sheet', () => assert.deepEqual([COMPARE_MAX, COMPARE_COLUMNS, COMPARE_TILE_WIDTH], [16, 4, 480]));

test('a viral film is compared only in the looks that serve viral', () => {
  assert.deepEqual(comparableLooks(VIRAL_FILM).map((c) => c.look), ['pop', 'cosmos', 'poster']);
});

test('a pro film is compared in the pro looks, in the listed order', () => {
  assert.deepEqual(comparableLooks(PRO_FILM_WITH_NUMBER).map((c) => c.look), ['desk', 'cosmos', 'ledger', 'poster', 'keynote', 'marker']);
});

test('a look that excludes the anchor kind is refused with the validator\'s words', () => {
  const dir = withPicture(scratch());
  try {
    const marker = comparableLooks(PRO_FILM_WITH_SCREEN, { specDir: dir }).find((c) => c.look === 'marker');
    assert.equal(marker.status, 'refused');
    assert.match(marker.note, /kind "screen" is not supported by look "marker"/);
    assert.match(marker.note, /^shots\[0\]\.show: /, 'the first error as path: message');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a look that parks the anchor kind is drawn and marked', () => {
  assert.deepEqual(comparableLooks(PRO_FILM_WITH_NUMBER).find((c) => c.look === 'ledger'), { look: 'ledger', status: 'parked', note: 'experimental kind' });
  assert.deepEqual(comparableLooks(PRO_FILM_WITH_NUMBER).find((c) => c.look === 'desk'), { look: 'desk', status: 'drawn', note: null });
});

test('only the anchor shot\'s kind is judged for parking: the same film is parked in ledger for number and drawn for another shot', () => {
  const film = { version: 2, mode: 'pro', look: 'desk', shots: [{ id: 'hook', show: 'statement', say: 'Hello there.' }, ...PRO_FILM_WITH_NUMBER.shots] };
  assert.equal(comparableLooks(film, { shot: 'proof' }).find((c) => c.look === 'ledger').status, 'parked');
  assert.equal(comparableLooks(film, { shot: 'hook' }).find((c) => c.look === 'ledger').status, 'drawn');
  assert.equal(comparableLooks(film).find((c) => c.look === 'ledger').status, 'drawn', 'the first shot is the anchor by default');
});

test('an overlay a look does not draw refuses that look, with the validator\'s words, and the other looks stay', () => {
  const film = { ...PRO_FILM_WITH_NUMBER, overlays: { progress: true } };
  const byLook = Object.fromEntries(comparableLooks(film).map((c) => [c.look, c]));
  assert.equal(byLook.marker.status, 'refused');
  assert.match(byLook.marker.note, /^overlays\.progress: look "marker" does not draw the progress overlay/);
  assert.deepEqual(['desk', 'cosmos', 'poster'].map((look) => byLook[look].status).filter((s) => s === 'refused'), []);
});

// A look is refused only by the anchor shot or a film-wide field. A fault on another shot leaves the anchor drawn, from the film's
// film-wide fields and the anchor shot alone.
const TWO_SHOTS = (anchorExtra = {}) => ({ version: 2, mode: 'pro', look: 'desk', shots: [
  { id: 'hook', show: 'statement', say: 'Every row has a source.' },
  { id: 'rows', show: 'number', say: 'Four hundred rows.', value: 400, label: 'rows', ...anchorExtra },
] });
const UNDERLINE = { on: [{ at: 'start', do: 'underline', target: 'value' }] }; // keynote does not draw the underline device

test('a fault on another shot does not refuse a look: the anchor is drawn alone, and the entry says so', () => {
  const film = TWO_SHOTS(UNDERLINE);
  assert.equal(validateFilm(film, { specDir: process.cwd() }).ok, true, 'the premise: the film is valid in desk');
  const keynote = comparableLooks(film, { shot: 'hook' }).find((c) => c.look === 'keynote');
  assert.equal(keynote.status, 'drawn');
  assert.equal(keynote.otherFaults, 1);
  assert.match(keynote.note, /other shots do not validate in this look \(1 problem\); the anchor is drawn alone/);
  assert.equal('otherFaults' in comparableLooks(film, { shot: 'hook' }).find((c) => c.look === 'desk'), false, 'a look with no fault has no count');
});

test('a fault on the anchor refuses the look and the note cites it', () => {
  const keynote = comparableLooks(TWO_SHOTS(UNDERLINE), { shot: 'rows' }).find((c) => c.look === 'keynote');
  assert.equal(keynote.status, 'refused');
  assert.match(keynote.note, /^shots\[1\]\.on\[0\]\.do: device "underline" is not supported by look "keynote"/);
});

test('a film-wide fault refuses every look that has it, whichever shot is the anchor', () => {
  const film = { ...TWO_SHOTS(), overlays: { progress: true } };
  for (const shot of ['hook', 'rows']) assert.match(comparableLooks(film, { shot }).find((c) => c.look === 'marker').note, /^overlays\.progress: /, shot);
});

test('a parked anchor kind and a fault on another shot are both on the entry', () => {
  const [rows] = TWO_SHOTS().shots.slice(1);
  const film = { ...TWO_SHOTS(), shots: [rows, { ...rows, id: 'r2', ...UNDERLINE }] };
  const keynote = comparableLooks(film, { shot: 'rows' }).find((c) => c.look === 'keynote');
  assert.deepEqual([keynote.status, keynote.otherFaults], ['parked', 1]);
  assert.match(keynote.note, /^experimental kind; other shots do not validate/);
});

// F-6: a film of the anchor alone has the anchor at shots[0], so its error paths must be mapped back to the anchor's own index.
test('when the anchor alone does not validate, the note names the anchor\'s own index, not shots[0]', () => {
  const underline = { on: [{ at: 'start', do: 'underline', target: 'value' }] };
  const number = (id, extra) => ({ id, show: 'number', say: 'One.', value: 1, label: 'x', hero: 'h', ...extra });
  const film = { version: 2, mode: 'pro', look: 'desk', shots: [number('a', underline), number('b', { cut: 'match' })] };
  assert.equal(validateFilm(film, { specDir: process.cwd() }).ok, true, 'the premise: the film is valid in desk');
  const keynote = comparableLooks(film, { shot: 'b' }).find((c) => c.look === 'keynote');
  assert.equal(keynote.status, 'refused');
  assert.match(keynote.note, /fault in another shot \(1 error\); the anchor alone does not validate: shots\[1\]\.cut: /);
  assert.doesNotMatch(keynote.note, /shots\[0\]/);
});

test('memoiseMusicInput asks for a music file once, however many looks ask', async () => {
  let calls = 0;
  const steps = { other: 1, musicInput: async (film) => { calls += 1; return { file: film.music.src }; } };
  const memo = memoiseMusicInput(steps);
  const film = { music: { src: 'm.wav', beats: 'm.beats.json' } };
  const all = await Promise.all(Array.from({ length: 6 }, () => memo.musicInput(film, '/d', { seconds: 9 })));
  assert.equal(calls, 1);
  assert.deepEqual(all.map((a) => a.file), Array(6).fill('m.wav'));
  assert.equal(memo.other, 1, 'the other steps are untouched');
  await memo.musicInput({ music: { src: 'n.wav' } }, '/d', {});
  assert.equal(calls, 2, 'another file is another call');
});

// F-8: a look that lengthens the film asks with its own length, so the silence check is not run on the first look's.
test('memoiseMusicInput keys on the film\'s length too: another length is another ask', async () => {
  const lengths = [];
  const memo = memoiseMusicInput({ musicInput: async (film, specDir, { seconds }) => { lengths.push(seconds); return { seconds }; } });
  const film = { music: { src: 'm.wav' } };
  assert.deepEqual(await Promise.all([9, 9, 12].map((seconds) => memo.musicInput(film, '/d', { seconds }))), [{ seconds: 9 }, { seconds: 9 }, { seconds: 12 }]);
  assert.deepEqual(lengths, [9, 12]);
});

// F-5: a finding is "shared" only when two or more looks drew and each reported it. With one look drawn, every finding of that
// look would trivially be shared, and a mechanical page fault (a console error) would become a creative note and refuse nobody.
const cellOf = (look, findings) => ({ look, status: 'drawn', note: null, frame: 3, at: 3, loaded: {}, png: 'x', pageFindings: findings });
const FAULT = { kind: 'mechanical', message: 'a console error' };
const NOTE = { kind: 'creative', message: 'no WebGL' };

test('with one look drawn, its mechanical page fault refuses it and is not a shared note', () => {
  const cell = cellOf('desk', [FAULT]);
  const { notes, refused } = settleFindings([cell, { look: 'pop', status: 'refused', note: 'x', pageFindings: null }]);
  assert.deepEqual(refused.map((c) => c.look), ['desk']);
  assert.equal(cell.status, 'refused');
  assert.deepEqual(notes, []);
});

test('with one look drawn, a creative page finding is a note naming the look', () => {
  const { notes, refused } = settleFindings([cellOf('desk', [NOTE])]);
  assert.deepEqual(refused, []);
  assert.deepEqual(notes.map((f) => f.message), [`look "desk": ${NOTE.message}`]);
});

test('two looks that both report a finding share it: one plain note, nobody refused', () => {
  const { notes, refused } = settleFindings([cellOf('desk', [FAULT]), cellOf('pop', [FAULT])]);
  assert.deepEqual(refused, []);
  assert.deepEqual(notes.map((f) => f.message), [FAULT.message]);
});

test('a fault one of two looks alone reports refuses that look only', () => {
  const [desk, pop] = [cellOf('desk', [FAULT, NOTE]), cellOf('pop', [NOTE])];
  const { notes, refused } = settleFindings([desk, pop]);
  assert.deepEqual(refused.map((c) => c.look), ['desk']);
  assert.deepEqual(notes.map((f) => f.message), [NOTE.message]);
});

test('a film that does not validate in a look for any other reason (here a cut) is a refused entry too, never a throw', () => {
  const film = { version: 2, mode: 'pro', look: 'desk', shots: [{ id: 'hook', show: 'statement', say: 'Hello there.', cut: 'no-such-cut' }, { id: 'b', show: 'statement', say: 'Again.' }] };
  const entries = comparableLooks(film);
  assert.equal(entries.length, 6);
  for (const entry of entries) assert.deepEqual([entry.status, typeof entry.note], ['refused', 'string'], entry.look);
});

test('at most COMPARE_MAX looks are compared', () => {
  const many = { ...registries, looks: { ...registries.looks, names: () => Array.from({ length: 20 }, () => 'desk') } };
  assert.equal(comparableLooks(PRO_FILM_WITH_NUMBER, { registries: many }).length, COMPARE_MAX);
});

test('loadFilm takes a look that replaces the film\'s own before validation, and a look that cannot draw the film is a SpecError', () => {
  const dir = withPicture(scratch());
  try {
    const specPath = path.join(dir, 'film.json');
    writeFileSync(specPath, JSON.stringify(PRO_FILM_WITH_SCREEN));
    assert.equal(loadFilm(specPath).film.look, 'desk');
    assert.equal(loadFilm(specPath, { look: 'cosmos' }).film.look, 'cosmos');
    assert.throws(() => loadFilm(specPath, { look: 'marker' }), (err) => err instanceof SpecError && /kind "screen" is not supported by look "marker"/.test(err.errors[0].message));
    assert.throws(() => loadFilm(specPath, { look: 'pop' }), (err) => err instanceof SpecError && /look "pop" does not serve mode "pro"/.test(err.errors[0].message));
    assert.equal(JSON.parse(readFileSync(specPath, 'utf8')).look, 'desk', 'the file is not changed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the flag ----

test('--compare-looks takes a shot id, and the film path', () => {
  assert.equal(parseMakeArgs([FILM_PATH, '--compare-looks', 'hook']).compareLooks, 'hook');
  assert.equal(parseMakeArgs([FILM_PATH]).compareLooks, null);
  assert.throws(() => parseMakeArgs([FILM_PATH, '--compare-looks', '']), (err) => err instanceof UsageError && /--compare-looks takes a shot id/.test(err.message));
  assert.throws(() => parseMakeArgs(['--compare-looks', 'hook']), UsageError);
});

// Every flag the mode refuses is a usage error in the one form, whichever side names it; a flag that is not refused is accepted.
test('--compare-looks refuses every flag that makes it do two things, and --estimated says so rather than asking for --sheets-only', () => {
  const beside = {
    '--out': ['--out', 'x.mp4'], '--batch': ['--batch', 'rows.json', '--out', 'x/{index}.mp4'], '--no-render': ['--no-render'], '--sheets-only': ['--sheets-only'],
    '--outline': ['--outline'], '--phonemes': ['--phonemes'], '--poster': ['--poster', '2'], '--poster-out': ['--poster', '2', '--poster-out', 'p.png'],
    '--inspect': ['--inspect', '2'], '--shot': ['--shot', 'a'], '--range': ['--range', '0..1'], '--subtitles': ['--subtitles', 'srt'],
    '--subtitle-words': ['--subtitles', 'srt', '--subtitle-words'], '--workers': ['--workers', '2'], '--exact': ['--exact'], '--no-music': ['--no-music'],
    '--estimated': ['--estimated'], '--preview': ['--preview'], '--list': ['--list', 'kinds'],
  };
  for (const [flag, argv] of Object.entries(beside)) {
    for (const order of [[FILM_PATH, '--compare-looks', 'a', ...argv], [FILM_PATH, ...argv, '--compare-looks', 'a']]) {
      assert.throws(() => parseMakeArgs(order), (err) => err instanceof UsageError && new RegExp(`--compare-looks does not go with --[a-z-]+|--[a-z-]+ does not go with --compare-looks`).test(err.message), `${flag}: ${order.join(' ')}`);
    }
  }
  assert.throws(() => parseMakeArgs([FILM_PATH, '--compare-looks', 'a', '--estimated']), /--compare-looks does not go with --estimated/);
  assert.throws(() => parseMakeArgs([FILM_PATH, '--compare-looks', 'a', '--shot', 'a']), /--compare-looks does not go with --shot/);
});

test('--compare-looks goes with --json and the stamp flags', () => {
  const options = parseMakeArgs([FILM_PATH, '--compare-looks', 'a', '--json']);
  assert.equal(options.json, true);
  assert.equal(options.noRender, false, 'it renders nothing of its own accord: the run never reaches the render');
});

test('the sheet is <out stem>.looks.png beside the MP4 path', () => {
  assert.equal(comparePath(path.join('out', 'film.mp4')), path.join('out', 'film.looks.png'));
  assert.equal(comparePath('film.MP4'), 'film.looks.png');
});

// ---- the sheet's layout ----

const flat = (width, height, [r, g, b]) => ({ width, height, channels: 4, data: Buffer.from(Array.from({ length: width * height }, () => [r, g, b, 255]).flat()) });
const pixelAt = (png, x, y) => [...png.data.subarray((y * png.width + x) * png.channels, (y * png.width + x) * png.channels + 3)];

test('assembleSheet places the tiles row by row, four across, and fills the unused cells', () => {
  const colours = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255]];
  const tiles = colours.map((c) => flat(4, 2, c));
  const sheet = readPng(assembleSheet(tiles, { columns: COMPARE_COLUMNS, tileWidth: 4, tileHeight: 2 }));
  assert.deepEqual([sheet.width, sheet.height], [16, 4]);
  assert.deepEqual(pixelAt(sheet, 0, 0), [255, 0, 0]);
  assert.deepEqual(pixelAt(sheet, 4, 0), [0, 255, 0]);
  assert.deepEqual(pixelAt(sheet, 11, 1), [0, 0, 255], 'the third tile ends at x = 11');
  assert.deepEqual(pixelAt(sheet, 12, 1), [255, 255, 0], 'the fourth starts at x = 12');
  assert.deepEqual(pixelAt(sheet, 0, 2), [0, 255, 255]);
  assert.deepEqual(pixelAt(sheet, 5, 2), [0x16, 0x14, 0x0f], 'an unused cell is the sheet colour');
});

test('assembleSheet is narrower for fewer looks than columns: three looks are three tiles wide', () => {
  const sheet = readPng(assembleSheet([flat(4, 2, [1, 2, 3]), flat(4, 2, [1, 2, 3]), flat(4, 2, [1, 2, 3])], { columns: COMPARE_COLUMNS, tileWidth: 4, tileHeight: 2 }));
  assert.deepEqual([sheet.width, sheet.height], [12, 2]);
});

test('assembleSheet reads an RGB tile too', () => {
  const rgb = { width: 2, height: 1, channels: 3, data: Buffer.from([9, 8, 7, 9, 8, 7]) };
  assert.deepEqual(pixelAt(readPng(assembleSheet([rgb], { columns: 4, tileWidth: 2, tileHeight: 1 })), 1, 0), [9, 8, 7]);
});

// ---- refusals that come before a browser ----

test('an unknown anchor shot is exit 2 with the shots in the hint, and no browser is started', async () => {
  const dir = scratch();
  try {
    const specPath = path.join(dir, 'film.json');
    writeFileSync(specPath, JSON.stringify(FREE_FILM));
    const { report, exitCode } = await runMake({ specPath, compareLooks: 'nope', out: null });
    assert.equal(exitCode, 2);
    assert.match(report.error.message, /no shot "nope"/);
    assert.match(report.error.hint, /the shots are: a, b/);
    assert.equal('compare' in report, false);
    const spawned = spawnSync(process.execPath, [MAKE, specPath, '--compare-looks', 'nope', '--json'], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '/nonexistent' } });
    assert.equal(spawned.status, 2, spawned.stdout + spawned.stderr);
    assert.match(JSON.parse(spawned.stdout).error.hint, /the shots are: a, b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--compare-looks does not go with --out or --poster, as the command line says', () => {
  assert.throws(() => parseMakeArgs([FILM_PATH, '--compare-looks', 'a', '--out', 'x.mp4']), /--compare-looks does not go with --out/);
  assert.throws(() => parseMakeArgs([FILM_PATH, '--compare-looks', 'a', '--poster', '2']), /--compare-looks does not go with --poster/);
});

test('when no look can draw the shot there is one finding at the shot and no file', async () => {
  const dir = withPicture(scratch());
  try {
    const specPath = path.join(dir, 'film.json');
    writeFileSync(specPath, JSON.stringify(PRO_FILM_WITH_SCREEN));
    const file = path.join(dir, 'out', 'film.looks.png');
    const onlyMarker = { ...registries, looks: { ...registries.looks, names: () => ['marker'] } };
    await assert.rejects(writeComparison({ specPath, shot: 'problem', file, registries: onlyMarker }), (err) => {
      assert.ok(err instanceof SpecError);
      assert.equal(err.errors.length, 1);
      assert.equal(err.errors[0].path, 'shots[0]');
      assert.match(err.errors[0].message, /no look of mode "pro" can draw shot "problem"/);
      assert.match(err.errors[0].message, /kind "screen" is not supported by look "marker"/);
      return true;
    });
    assert.equal(existsSync(file), false);
    await assert.rejects(writeComparison({ specPath, shot: 'nope', file }), (err) => err instanceof FilmTimeError && /the shots are: problem/.test(err.hint));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- the report ----

const BLANK = { validated: true, error: null, stages: [{ name: 'validate', ok: true, seconds: 0 }], findings: [], sheets: [], output: null, timed: 'estimated', voice: null, audio: null, post: 'webgl2', capture: null, frames: 120, captured: 0, seconds: null, msPerFrame: null, bytes: null, mbps: null };
const COMPARE = { file: 'out/film.looks.png', shot: 'hook', frame: 51, looks: [{ look: 'desk', status: 'drawn', note: null, frame: 51 }, { look: 'ledger', status: 'parked', note: 'experimental kind', frame: 52 }, { look: 'marker', status: 'refused', note: 'shots[0].show: kind "screen" is not supported by look "marker"', frame: null }] };

test('the report carries compare only for a compare run, with its path absolute under --json', () => {
  assert.equal('compare' in reportOf(BLANK), false);
  const report = reportOf({ ...BLANK, compare: COMPARE });
  assert.deepEqual(report.compare, COMPARE);
  const cwd = path.resolve('/run/here');
  assert.equal(absolutePaths(report, cwd).compare.file, path.join(cwd, 'out/film.looks.png'));
  assert.equal(absolutePaths(report, cwd).compare.shot, 'hook');
  assert.equal('compare' in absolutePaths(reportOf(BLANK), cwd), false);
});

test('the text form says where the sheet is and which looks were drawn, parked or refused', () => {
  const text = formatText(reportOf({ ...BLANK, stages: [...BLANK.stages, { name: 'compare', ok: true, seconds: 1 }], compare: COMPARE }), { sheetsDir: null });
  assert.match(text, /^compare: out\/film\.looks\.png \(shot hook; desk, ledger \(parked\), marker \(refused\)\)$/m);
  assert.doesNotMatch(text, /^sheets:|^output:/m, 'no sheets and no video were written');
});

test('a comparison that failed prints its verdict and findings only: no sheets, output or frame lines', () => {
  const failed = reportOf({ ...BLANK, validated: true, stages: [{ name: 'validate', ok: true, seconds: 0 }, { name: 'compare', ok: false, seconds: 0 }],
    findings: [{ kind: 'mechanical', shot: null, path: 'shots[0]', message: 'no look of mode "pro" can draw shot "hook"' }] });
  assert.equal('compare' in failed, false);
  assert.equal(formatText(failed, { sheetsDir: null }), 'invalid\nmechanical: shots[0]: no look of mode "pro" can draw shot "hook"');
});