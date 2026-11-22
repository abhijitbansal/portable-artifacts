// W3 task 6: --shot <id> and --range <a>..<b> name a slice of the film (frames, inclusive); the sheets and the review of the film
// are cut down to it. This file holds what needs no browser: the slice, the sheets it keeps, the frames the review snapshots
// and judges, the flags and their refusals, and the review run on a stub page. The page run is slice-sheets-browser.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE } from './helpers/session.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { UsageError } from '../../shared/cli.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { planSheets, auditMoments } from '../../scripts/v2/plan.mjs';
import { FilmTimeError } from '../../scripts/v2/film-time.mjs';
import { auditPlan, reviewFilm } from '../../scripts/v2/review.mjs';
import { runMake } from '../../scripts/v2/run.mjs';
import { rangeParts } from '../../scripts/v2/range-form.mjs';
import { parseMakeArgs } from '../../scripts/v2/cli.mjs';
import { formatText, reportOf } from '../../scripts/v2/report.mjs';
import { SLICE_SKIPPED, sliceAuditPlan, sliceOf, sliceSheets } from '../../scripts/v2/slice.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const FPS = 30;
const FILM_PATH = 'film.json';
// a three-shot film at 30 fps: a (2 s), b (2 s, slide), c (2 s)
const film = { version: 2, mode: 'pro', look: 'desk', fps: FPS, shots: [
  { id: 'a', show: 'free', hold: 2 },
  { id: 'b', show: 'free', hold: 2, cut: 'slide' },
  { id: 'c', show: 'free', hold: 2 },
] };
const timeline = buildTimeline(film, { fps: FPS });

test('--shot is the frames of that shot', () => assert.deepEqual(sliceOf({ shot: 'b' }, film, timeline), { from: 60, to: 119, label: 'b', shots: ['b'] }));

test('--range takes two film times, inclusive', () => assert.deepEqual(sliceOf({ range: 'a@1..b@0.5' }, film, timeline), { from: 30, to: 75, label: 'range-30-75', shots: ['a', 'b'] }));

test('--range reads decimals, shot ids and anchors on both sides, and a single frame is a slice', () => {
  assert.deepEqual(sliceOf({ range: '1.5..2.5' }, film, timeline), { from: 45, to: 75, label: 'range-45-75', shots: ['a', 'b'] });
  assert.deepEqual(sliceOf({ range: 'b..b@end' }, film, timeline), { from: 60, to: 119, label: 'range-60-119', shots: ['b'] });
  assert.deepEqual(sliceOf({ range: 'start..end' }, film, timeline), { from: 0, to: 179, label: 'range-0-179', shots: ['a', 'b', 'c'] });
  assert.deepEqual(sliceOf({ range: '1..1' }, film, timeline), { from: 30, to: 30, label: 'range-30-30', shots: ['a'] });
});

test('a range that runs backwards, or has no .., is a usage error naming the form', () => {
  assert.throws(() => sliceOf({ range: 'b..a' }, film, timeline), /--range takes <from>\.\.<to>/);
  assert.throws(() => sliceOf({ range: '1.5' }, film, timeline), /--range takes <from>\.\.<to>/);
  for (const bad of ['b..a', '1.5', '..2', '2..', '']) {
    assert.throws(() => sliceOf({ range: bad }, film, timeline), (err) => err instanceof UsageError, JSON.stringify(bad));
  }
});

test('an unknown shot lists the shots, as a film-time error (exit 2 with a hint)', () => {
  assert.throws(() => sliceOf({ shot: 'nope' }, film, timeline), /the shots are: a, b, c/);
  assert.throws(() => sliceOf({ shot: 'nope' }, film, timeline), (err) => err instanceof FilmTimeError && /a, b, c/.test(err.hint));
});

test('a range reference that names nothing is a film-time error naming the flag', () => {
  assert.throws(() => sliceOf({ range: 'a..nope@1' }, film, timeline), (err) => err instanceof FilmTimeError);
  assert.throws(() => sliceOf({ range: '0..40' }, film, timeline), /--range 40: past the end \(the film is 6\.0 s\)/);
});

test('no --shot and no --range is no slice', () => assert.equal(sliceOf({}, film, timeline), null));

test('the sheets of --shot b are its own sheet and the strip of the cut into it', () => {
  assert.deepEqual(sliceSheets(planSheets(film, timeline), sliceOf({ shot: 'b' }, film, timeline)).map((s) => s.name), ['b.png', 'cut-a-b.png']);
});

test('a range keeps the shot tiles inside it, and a strip only when its window starts inside it', () => {
  const sheets = sliceSheets(planSheets(film, timeline), sliceOf({ range: 'a@1..b@0.5' }, film, timeline));
  assert.deepEqual(sheets.map((s) => s.kind), ['shot', 'shot', 'cut']); // the window of b->c starts at 120, outside 30..75
  assert.equal(sheets[2].name, 'cut-a-b.png');
  for (const sheet of sheets.filter((s) => s.kind === 'shot')) for (const tile of sheet.tiles) assert.ok(tile.frame >= 30 && tile.frame <= 75, `${sheet.name} ${tile.frame}`);
});

test('a sheet that keeps only some of its shot\'s tiles is named for the slice, so it cannot overwrite the full run\'s sheet', () => {
  const all = planSheets(film, timeline);
  const names = (spec) => sliceSheets(all, sliceOf(spec, film, timeline)).map((s) => s.name);
  assert.deepEqual(names({ range: 'a@1..b@0.5' }), ['a.partial-range-30-75.png', 'b.partial-range-30-75.png', 'cut-a-b.png']);
  assert.deepEqual(names({ range: 'b..b@end' }), ['b.png', 'cut-a-b.png'], 'every tile of b is inside: the sheet is whole and keeps its name');
  assert.deepEqual(names({ shot: 'b' }), ['b.png', 'cut-a-b.png']);
  const [partial] = sliceSheets(all, sliceOf({ range: 'a@1..b@0.5' }, film, timeline));
  assert.equal(partial.shot, 'a');
  assert.ok(partial.tiles.length < all[0].tiles.length);
});

test('a strip is kept whole, its side frames included, though some lie outside the range', () => {
  const all = planSheets(film, timeline);
  const strip = sliceSheets(all, sliceOf({ range: 'b@0..b@0.5' }, film, timeline)).find((s) => s.name === 'cut-a-b.png');
  assert.deepEqual(strip.tiles, all.find((s) => s.name === 'cut-a-b.png').tiles);
  assert.ok(strip.tiles.some((t) => t.frame < 60), 'a side frame before the window');
});

test('a range that starts after a strip\'s window and a shot with no tile left drop their sheets', () => {
  const names = sliceSheets(planSheets(film, timeline), sliceOf({ range: 'b@1..b@1.5' }, film, timeline)).map((s) => s.name);
  assert.deepEqual(names, ['b.partial-range-90-105.png'], 'cut-a-b.png starts at frame 60, before the range');
});

test('a range that starts inside a cut window drops the strip, but the window frames inside it are audited as the page draws them', () => {
  const slice = sliceOf({ range: 'b@0.2..b@1' }, film, timeline); // frames 66 to 90
  assert.deepEqual(sliceSheets(planSheets(film, timeline), slice).map((s) => s.name), ['b.partial-range-66-90.png']);
  const full = new Map(auditPlan(film, timeline).map(([shot, frame]) => [frame, shot]));
  const part = auditPlan(film, timeline, sliceAuditPlan(film, timeline, slice).map((p) => p.frame));
  assert.ok(part.some(([shot]) => shot === 1), 'a frame inside the slide window is audited as the incoming shot alone');
  for (const [shot, frame] of part) assert.equal(shot, full.get(frame), `frame ${frame} is audited as in the full run`);
});

test('a slice does not change the sheets the film plans (the unsliced plan is untouched)', () => {
  const before = JSON.stringify(planSheets(film, timeline));
  sliceSheets(planSheets(film, timeline), sliceOf({ shot: 'b' }, film, timeline));
  assert.equal(JSON.stringify(planSheets(film, timeline)), before);
});

test('a range that ends mid-shot still snapshots that shot\'s last frame, and judges only the frames inside it', () => {
  const plan = sliceAuditPlan(film, timeline, sliceOf({ range: 'a@1..b@0.5' }, film, timeline)); // [{ frame, judged }]
  assert.ok(plan.some((p) => p.frame === 119 && p.judged === false)); // b's last frame, for its rest scales
  assert.ok(plan.filter((p) => p.judged).every((p) => p.frame >= 30 && p.frame <= 75));
});

test('the slice plan is every audit frame of each shot the slice touches, judged only inside the slice, in order', () => {
  const slice = sliceOf({ range: 'a@1..b@0.5' }, film, timeline);
  const plan = sliceAuditPlan(film, timeline, slice);
  const shotsAB = auditMoments(film, timeline).filter((f) => f <= 119); // the frames of a and b
  assert.deepEqual(plan.map((p) => p.frame), shotsAB, 'the same frames the full run snapshots in those shots, none of c');
  assert.deepEqual(plan.filter((p) => p.judged).map((p) => p.frame), shotsAB.filter((f) => f >= 30 && f <= 75));
  assert.ok(plan.some((p) => p.frame === 119 && !p.judged) && plan.some((p) => p.frame < 30 && !p.judged), 'the ends of both shots outside the range are drawn, not judged');
});

test('a slice reads a shot\'s rest scales from the same frames the full run does: all of its audit frames, drawn even outside the slice', () => {
  const plan = sliceAuditPlan(film, timeline, sliceOf({ range: 'b@0..b@0.5' }, film, timeline)); // frames 60 to 75, a part of b
  const inB = auditMoments(film, timeline).filter((f) => f >= 60 && f <= 119);
  for (const frame of inB) assert.ok(plan.some((p) => p.frame === frame), `frame ${frame} of b is snapshotted`);
  assert.ok(plan.filter((p) => !p.judged && p.frame >= 60).length > 0);
});

test('a last frame that is inside the slice is judged, not a second entry', () => {
  const plan = sliceAuditPlan(film, timeline, sliceOf({ shot: 'b' }, film, timeline));
  assert.equal(plan.filter((p) => p.frame === 119).length, 1);
  assert.equal(plan.find((p) => p.frame === 119).judged, true);
  const unjudged = plan.filter((p) => !p.judged).map((p) => p.frame);
  assert.deepEqual(unjudged, auditMoments(film, timeline).filter((f) => f < 60), 'only the shot before it (for a match cut) is drawn outside the slice');
});

// ---- the flags ----

test('--shot and --range keep their text as written', () => {
  assert.equal(parseMakeArgs([FILM_PATH, '--shot', 'b']).shot, 'b');
  assert.equal(parseMakeArgs([FILM_PATH, '--range', 'a@1..b@0.5']).range, 'a@1..b@0.5');
  assert.deepEqual([parseMakeArgs([FILM_PATH]).shot, parseMakeArgs([FILM_PATH]).range], [null, null]);
});

test('--shot does not go with --range, --poster or --workers', () => {
  assert.throws(() => parseMakeArgs([FILM_PATH, '--shot', 'b', '--range', '1..2']), /--shot does not go with --range/);
  assert.throws(() => parseMakeArgs([FILM_PATH, '--shot', 'b', '--poster', '1']), /--shot does not go with --poster/);
  assert.throws(() => parseMakeArgs([FILM_PATH, '--shot', 'b', '--workers', '2']), /--shot does not go with --workers/);
});

test('--shot and --range refuse the other modes, and --preview refuses both', () => {
  for (const mode of ['shot', 'range']) {
    const value = mode === 'shot' ? 'b' : '1..2';
    for (const flag of [['--batch', 'x'], ['--outline'], ['--phonemes'], ['--poster-out', 'p.png'], ['--inspect', '1'], ['--subtitles', 'srt']]) {
      assert.throws(() => parseMakeArgs([FILM_PATH, `--${mode}`, value, ...flag]), (err) => err instanceof UsageError && /does not go with/.test(err.message), `${mode} ${flag.join(' ')}`);
    }
    assert.throws(() => parseMakeArgs([FILM_PATH, `--${mode}`, value, '--preview']), /does not go with --/);
  }
  assert.throws(() => parseMakeArgs([FILM_PATH, '--range', '1..2', '--shot', 'b']), /--shot does not go with --range/, 'the first mode that clashes names itself, whatever the order given');
});

test('--sheets-only, --out and --exact go with a slice', () => {
  assert.equal(parseMakeArgs([FILM_PATH, '--shot', 'b', '--sheets-only']).noRender, true);
  assert.equal(parseMakeArgs([FILM_PATH, '--range', '1..2', '--out', 'x.mp4']).out, 'x.mp4');
  assert.equal(parseMakeArgs([FILM_PATH, '--shot', 'b', '--exact']).exact, true);
});

test('--shot with no id and --range with no .. are usage errors at the command line', () => {
  assert.throws(() => parseMakeArgs([FILM_PATH, '--shot', '']), /--shot takes a shot id/);
  assert.throws(() => parseMakeArgs([FILM_PATH, '--range', '1.5']), /--range takes <from>\.\.<to>/);
  assert.throws(() => parseMakeArgs([FILM_PATH, '--range', '']), /--range takes <from>\.\.<to>/);
});

// ---- the run refuses a bad slice before it opens a browser (exit 2) ----

test('runMake refuses an unknown shot and a backwards range as machine trouble, with the shots or the form in the report', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'mm-slice-'));
  try {
    const specPath = path.join(dir, 'film.json');
    writeFileSync(specPath, JSON.stringify(film));
    const unknown = await runMake({ specPath, shot: 'nope', out: null });
    assert.equal(unknown.exitCode, 2);
    assert.match(unknown.report.error.hint, /the shots are: a, b, c/);
    const backwards = await runMake({ specPath, range: 'c..a', out: null });
    assert.equal(backwards.exitCode, 2);
    assert.match(backwards.report.error.message, /--range takes <from>\.\.<to>/);
    const nowhere = await runMake({ specPath, range: 'a..zzz@1', out: null });
    assert.equal(nowhere.exitCode, 2);
    assert.match(nowhere.report.error.hint, /the shots are: a, b, c/);
    assert.equal(existsSync(path.join(dir, 'out')), false, 'nothing was written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A voiced film: its timeline is estimated until the voice is made. What the estimate cannot change is refused before the
// voice: the order of two references in different shots, or two plain seconds. The rest waits for the measured timeline.
const VOICED = { version: 2, mode: 'pro', fps: FPS, voice: { name: 'af_heart' }, shots: [{ id: 'hook', show: 'statement', say: 'Numbers need sources.' }, { id: 'rows', show: 'statement', text: 'Four rows.', hold: 2 }] };
const voiceSpy = (calls) => async () => {
  calls.push('voice');
  throw Object.assign(new Error('the voice package is not installed'), { hint: 'install it' });
};

test('a backwards range is refused before the voice when its references are in different shots or are plain seconds', async () => {
  const dirFor = mkdtempSync(path.join(tmpdir(), 'mm-slice-voice-'));
  try {
    const specPath = path.join(dirFor, 'film.json');
    writeFileSync(specPath, JSON.stringify(VOICED));
    const run = async (range) => {
      const calls = [];
      const { exitCode, report } = await runMake({ specPath, range, out: null }, { synthesise: voiceSpy(calls) });
      return { calls, exitCode, report };
    };
    for (const backwards of ['rows..hook', 'rows@end..hook@start', '5..1']) {
      const { calls, exitCode, report } = await run(backwards);
      assert.deepEqual([calls, exitCode], [[], 2], backwards);
      assert.match(report.error.message, /--range takes <from>\.\.<to>/, backwards);
    }
    for (const waits of ['hook@1..hook@0.5', 'rows@end+3..hook', 'rows..rows@0.5', '0..99']) {
      assert.deepEqual((await run(waits)).calls, ['voice'], `${waits}: the order or the length needs the measured timeline`);
    }
  } finally {
    rmSync(dirFor, { recursive: true, force: true });
  }
});

test('on a silent film the estimate is the timeline drawn, so a backwards or past-the-end range is refused whole before anything runs', async () => {
  const dirFor = mkdtempSync(path.join(tmpdir(), 'mm-slice-silent-'));
  try {
    const specPath = path.join(dirFor, 'film.json');
    writeFileSync(specPath, JSON.stringify(film));
    const same = await runMake({ specPath, range: 'a@1.5..a@0.5', out: null });
    assert.equal(same.exitCode, 2);
    assert.match(same.report.error.message, /--range takes <from>\.\.<to>/);
    assert.equal(same.report.stages.some((s) => s.name === 'review'), false);
    const late = await runMake({ specPath, range: '0..99', out: null });
    assert.equal(late.exitCode, 2);
    assert.match(late.report.error.message, /--range 99: past the end \(the film is 6\.0 s\)/);
  } finally {
    rmSync(dirFor, { recursive: true, force: true });
  }
});

test('a range with more than one .. is a usage error naming the form, not a reference that names nothing', () => {
  assert.throws(() => rangeParts('a..b..c'), (err) => err instanceof UsageError && /--range takes <from>\.\.<to>/.test(err.message));
  assert.throws(() => parseMakeArgs([FILM_PATH, '--range', 'a..b..c']), /--range takes <from>\.\.<to>/);
});

test('make.mjs --shot nope exits 2 with the shots and starts no browser; --range 1.5 is refused as a usage error', () => {
  const dirFor = mkdtempSync(path.join(tmpdir(), 'mm-slice-cli-'));
  try {
    const specPath = path.join(dirFor, 'film.json');
    writeFileSync(specPath, JSON.stringify(film));
    const make = (...flags) => spawnSync(process.execPath, [MAKE, specPath, ...flags, '--json'], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '/nonexistent' } });
    const unknown = make('--shot', 'nope');
    assert.equal(unknown.status, 2, unknown.stdout + unknown.stderr);
    assert.match(JSON.parse(unknown.stdout).error.hint, /the shots are: a, b, c/);
    const form = make('--range', '1.5');
    assert.equal(form.status, 2, form.stdout + form.stderr);
    assert.match(JSON.parse(form.stdout).error.message, /--range takes <from>\.\.<to>/);
  } finally {
    rmSync(dirFor, { recursive: true, force: true });
  }
});

// ---- the report ----

const BLANK = { validated: true, error: null, stages: [{ name: 'validate', ok: true, seconds: 0 }], findings: [], sheets: ['b.png'], output: null, timed: 'estimated', voice: null, audio: null, post: 'webgl2', capture: null, frames: 180, captured: 0, seconds: null, msPerFrame: null, bytes: null, mbps: null };
const SLICE_REPORT = { from: 60, to: 119, frames: 60, shots: ['b'], silent: false, skipped: ['loop', 'cut-variety', 'sameness'] };

test('the report has a slice key only for a slice run, and its text form says which frames were reviewed', () => {
  assert.equal('slice' in reportOf(BLANK), false);
  const report = reportOf({ ...BLANK, slice: SLICE_REPORT });
  assert.deepEqual(report.slice, SLICE_REPORT);
  const text = formatText(report, { sheetsDir: 'out/film.sheets' });
  assert.match(text, /^slice: frames 60 to 119 \(60 frames; shot b\); loop, cut-variety and sameness are not run$/m);
  assert.match(text, /^frames: 180 in the film, 60 in the slice$/m, 'the film\'s frame count is not mistaken for the slice\'s');
});

// ---- the review of a slice, on a stub page (no browser) ----

const bar = (id, box) => ({ type: 'path', id, depth: 1, visible: true, opacity: 1, bbox: box, props: { fill: '#111111', d: 'M0 0H1V1H0Z' } });

// A page that answers the two evaluate calls reviewFilm makes and records them: the snapshot requests ([shot, frame] pairs)
// and the held-frame ranges ([from, to]); every frame is `held` or not as given.
function recordingSession(f, tree, held = false) {
  const tl = buildTimeline(f, { fps: FPS });
  const calls = { snapshots: [], held: [] };
  const page = {
    evaluate: async (_fn, arg) => {
      if (Array.isArray(arg[0])) {
        calls.snapshots.push(...arg.map(([, frame]) => frame));
        return arg.map(([, frame]) => (typeof tree === 'function' ? tree(frame) : tree));
      }
      if (typeof arg[0] === 'number') {
        calls.held.push(arg);
        return Array.from({ length: arg[1] - arg[0] + 1 }, (_, k) => held && arg[0] + k > 0); // frame 0 is never held: nothing comes before it
      }
      return [];
    },
  };
  return { session: { film: f, timeline: tl, page, info: {}, errors: [] }, calls };
}

const longFilm = { version: 2, mode: 'pro', look: 'desk', fps: FPS, shots: [{ id: 'a', show: 'free', hold: 8 }, { id: 'b', show: 'free', hold: 2 }, { id: 'c', show: 'free', hold: 2 }] };

test('reviewFilm with a slice snapshots the slice plan and asks the held flags of the slice alone', async () => {
  const { session, calls } = recordingSession(film, [bar('block', [96, 96, 1728, 800])]);
  const slice = sliceOf({ range: 'a@1..b@0.5' }, film, timeline);
  await reviewFilm({ session, slice });
  assert.deepEqual(calls.snapshots, sliceAuditPlan(film, timeline, slice).map((p) => p.frame));
  assert.deepEqual(calls.held, [[30, 75]]);
});

test('without a slice reviewFilm still snapshots every audit moment and asks the whole film\'s held flags', async () => {
  const { session, calls } = recordingSession(film, [bar('block', [96, 96, 1728, 800])]);
  await reviewFilm({ session });
  assert.deepEqual(calls.snapshots, auditMoments(film, timeline));
  assert.deepEqual(calls.held, [[0, 149], [150, 179]], 'in chunks of 150 frames');
});

test('a frame that is only snapshotted for its shot\'s rest is not judged: a small card judged at b\'s last frame says nothing when the slice ends before it', async () => {
  const small = [bar('card', [864, 486, 192, 108])]; // dead-space and scale-contrast at a shot's resting frame
  const full = await reviewFilm({ session: recordingSession(film, small).session });
  assert.ok(full.some((f) => f.shot === 'b' && (f.rule === 'dead-space' || f.rule === 'scale-contrast')), 'control: the full review judges b');
  const part = await reviewFilm({ session: recordingSession(film, small).session, slice: sliceOf({ range: 'a@1..b@0.5' }, film, timeline) });
  assert.deepEqual(part.filter((f) => f.shot === 'b' && (f.rule === 'dead-space' || f.rule === 'scale-contrast')), [], 'b\'s last frame is outside the slice');
  assert.equal(part.filter((f) => f.shot === 'c').length, 0, 'nothing about c, which the slice does not touch');
});

test('a slice runs no loop, cut-variety or sameness rule, though the full review does', async () => {
  const circle = [{ at: 0.5, do: 'circle' }];
  const many = { version: 2, mode: 'pro', look: 'desk', fps: FPS, shots: Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, show: 'free', hold: 2, ...(i > 0 ? { cut: 'slide' } : {}), ...(i % 4 !== 3 ? { on: circle } : {}) })) };
  const tree = [bar('block', [96, 96, 1728, 800])];
  const full = await reviewFilm({ session: recordingSession(many, tree).session });
  assert.ok(full.some((f) => f.rule === 'cut-variety') && full.some((f) => f.rule === 'sameness'), 'control: the full review runs both');
  const tl = buildTimeline(many, { fps: FPS });
  const part = await reviewFilm({ session: recordingSession(many, tree).session, slice: sliceOf({ range: 's0..s10@end' }, many, tl) });
  assert.deepEqual(part.filter((f) => ['cut-variety', 'sameness', 'loop'].includes(f.rule)), []);
  assert.deepEqual(SLICE_SKIPPED, ['loop', 'cut-variety', 'sameness']);
});

test('a slice of a looping film does not compare its last frame with its first (the loop check needs the whole film)', async () => {
  const looping = { ...film, loop: true };
  const { session } = recordingSession(looping, [bar('block', [96, 96, 1728, 800])]); // a page with no screenshot: the loop check would throw
  const found = await reviewFilm({ session, slice: sliceOf({ shot: 'b' }, looping, timeline) });
  assert.deepEqual(found.filter((f) => f.rule === 'loop'), []);
  await assert.rejects(() => reviewFilm({ session }), /screenshot/, 'control: the full review runs it');
});

test('still is judged over the slice\'s frames alone', async () => {
  const tl = buildTimeline(longFilm, { fps: FPS });
  const tree = [bar('block', [96, 96, 1728, 800])];
  const stillOf = async (range) => (await reviewFilm({ session: recordingSession(longFilm, tree, true).session, slice: sliceOf({ range }, longFilm, tl) })).filter((f) => f.rule === 'still');
  assert.deepEqual(await stillOf('a@2..a@7'), [], 'frames 60 to 210 are 5.1 s held, under the 6 s the mode allows');
  const long = await stillOf('a@1..a@7.5');
  assert.equal(long.length, 1);
  assert.equal(long[0].shot, 'a');
  assert.equal(long[0].t, 1, 'the stretch starts at the slice\'s first frame, not before it');
  const whole = (await reviewFilm({ session: recordingSession(longFilm, tree, true).session })).filter((f) => f.rule === 'still');
  assert.equal(whole.length, 1, 'control: the full review finds the held film');
  assert.equal(whole[0].t, 0);
});

test('a match into the slice\'s first shot is judged (the shot before it is drawn at its last frame, not judged); a slice that starts after the window does not judge it', async () => {
  const matched = { version: 2, mode: 'pro', look: 'desk', fps: FPS, shots: [
    { id: 'a', show: 'free', hold: 2 },
    { id: 'b', show: 'free', hold: 2, cut: 'match' },
    { id: 'c', show: 'free', hold: 2 },
  ] };
  const tl = buildTimeline(matched, { fps: FPS });
  const front = (id) => ({ ...bar(id, [96, 96, 1728, 800]), depth: 0 });
  const treeOf = (frame) => [front(frame < 60 ? 'x' : 'y')]; // a and b share no node: the match carries nothing
  const matchOf = async (slice) => (await reviewFilm({ session: recordingSession(matched, treeOf).session, slice })).filter((f) => f.rule === 'match').map((f) => f.shot);
  assert.deepEqual(await matchOf(null), ['b'], 'control: the full review finds it');
  assert.deepEqual(await matchOf(sliceOf({ shot: 'b' }, matched, tl)), ['b']);
  assert.deepEqual(await matchOf(sliceOf({ range: 'a@1..b@0.5' }, matched, tl)), ['b']);
  assert.deepEqual(await matchOf(sliceOf({ shot: 'c' }, matched, tl)), [], 'the cut into b is not in a slice of c');
  assert.deepEqual(await matchOf(sliceOf({ range: 'b@1..b@1.5' }, matched, tl)), [], 'the window of the match opened before this range');
  const plan = sliceAuditPlan(matched, tl, sliceOf({ shot: 'b' }, matched, tl));
  assert.deepEqual(plan.filter((p) => !p.judged).map((p) => p.frame), auditMoments(matched, tl).filter((f) => f < 60), 'a, the shot before the match, is drawn, not judged');
});

test('a match compares the incoming shot\'s first frame drawn alone, even when the range ends inside the window', async () => {
  const matched = { version: 2, mode: 'pro', look: 'desk', fps: FPS, shots: [
    { id: 'a', show: 'free', hold: 2 },
    { id: 'b', show: 'free', hold: 2, cut: 'match' },
    { id: 'c', show: 'free', hold: 2 },
  ] };
  const tl = buildTimeline(matched, { fps: FPS });
  const front = (id) => ({ ...bar(id, [96, 96, 1728, 800]), depth: 0 });
  const ALONE = 75; // the match window is frames 60 to 74: b's first frame drawn alone is 75
  assert.ok(auditMoments(matched, tl).includes(ALONE), 'the fixture: frame 75 is an audit frame');
  const found = async (treeOf, slice) => (await reviewFilm({ session: recordingSession(matched, treeOf).session, slice })).filter((f) => f.rule === 'match').map((f) => f.shot);
  const ends = sliceOf({ range: 'a@1..b@0.4' }, matched, tl); // frames 30 to 72: ends inside the window
  const sharesAtFirstDiffersAtEnd = (frame) => [front(frame === 119 ? 'y' : 'x')];
  assert.deepEqual(await found(sharesAtFirstDiffersAtEnd, null), [], 'control: the full run compares frame 75, which shares a node with a');
  assert.deepEqual(await found(sharesAtFirstDiffersAtEnd, ends), [], 'the slice does not compare b\'s last frame instead');
  const differsAtFirstSharesAtEnd = (frame) => [front(frame === ALONE ? 'y' : 'x')];
  assert.deepEqual(await found(differsAtFirstSharesAtEnd, null), ['b'], 'control: frame 75 shares nothing with a');
  assert.deepEqual(await found(differsAtFirstSharesAtEnd, ends), ['b'], 'the slice finds it too');
});

test('a finding about a frame outside the slice is not reported: cut-window, kind and hook are kept by their time', async () => {
  const wide = { version: 2, mode: 'pro', look: 'desk', fps: FPS, shots: [
    { id: 'a', show: 'free', hold: 2 },
    { id: 'b', show: 'free', hold: 2, cut: { type: 'slide', duration: 1.5 } },
    { id: 'c', show: 'free', hold: 2 },
  ] };
  const tl = buildTimeline(wide, { fps: FPS });
  const tree = [bar('block', [96, 96, 1728, 800])];
  const rules = async (spec) => (await reviewFilm({ session: recordingSession(wide, tree).session, slice: sliceOf(spec, wide, tl) })).map((f) => `${f.rule}@${f.t}`);
  assert.ok((await rules({ shot: 'b' })).includes('cut-window@2'), 'control: the window opens at 2.0 s, inside the shot');
  assert.deepEqual((await rules({ range: 'b@1..b@1.5' })).filter((r) => r.startsWith('cut-window')), [], 'b\'s window opened at 2.0 s, before frame 90');
  assert.deepEqual((await rules({ range: 'b@1..b@1.5' })).filter((r) => r.startsWith('hook')), []);
});

test('cut-window and match findings are judged only for the shots in the slice', async () => {
  const wide = { version: 2, mode: 'pro', look: 'desk', fps: FPS, shots: [
    { id: 'a', show: 'free', hold: 2 },
    { id: 'b', show: 'free', hold: 1, cut: { type: 'slide', duration: 0.8 } },
    { id: 'c', show: 'free', hold: 2, cut: { type: 'slide', duration: 1.5 } },
  ] };
  const tl = buildTimeline(wide, { fps: FPS });
  const tree = [bar('block', [96, 96, 1728, 800])];
  const full = (await reviewFilm({ session: recordingSession(wide, tree).session })).filter((f) => f.rule === 'cut-window');
  assert.deepEqual(full.map((f) => f.shot).sort(), ['b', 'c'], 'control: both windows are long for their shot');
  const first = await reviewFilm({ session: recordingSession(wide, tree).session, slice: sliceOf({ shot: 'b' }, wide, tl) });
  assert.deepEqual(first.filter((f) => f.rule === 'cut-window').map((f) => f.shot), ['b']);
  const second = await reviewFilm({ session: recordingSession(wide, tree).session, slice: sliceOf({ shot: 'c' }, wide, tl) });
  assert.deepEqual(second.filter((f) => f.rule === 'cut-window').map((f) => f.shot), ['c']);
});
