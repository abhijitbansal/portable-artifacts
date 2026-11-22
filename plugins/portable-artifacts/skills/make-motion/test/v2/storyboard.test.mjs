// The storyboard step for a version 2 film: scripts/storyboard.mjs reads a draft film and, for one longer than 20 s,
// writes a make-explainer `plan` page (one timeline event per shot, a look decision, an approval, an open question).
// Skipped, with one stdout line, exit 0 and no file, when the film is short, make-explainer is not beside this skill, or
// the run cannot pause for an answer. No browser, no ffmpeg.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE } from './helpers/session.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { STORYBOARD_MIN_SECONDS, storyboardPlan } from '../../scripts/v2/storyboard.mjs';
import { main } from '../../scripts/storyboard.mjs';

const SKILL = path.resolve(HERE, '../../..'); // HERE is test/v2/helpers
const CLI = path.join(SKILL, 'scripts/storyboard.mjs');
const EXPLAINER = path.resolve(SKILL, '..', 'make-explainer');
const VALIDATE = path.join(EXPLAINER, 'scripts/validate.mjs');
const EXPLAINER_SKIP = !existsSync(VALIDATE) ? `make-explainer is not beside this skill (looked for ${VALIDATE})`
  : !existsSync(path.join(EXPLAINER, 'node_modules/ajv')) && 'make-explainer has no node_modules (run npm ci there)';

const BAR = { type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } };
const free = (id, hold) => ({ id, show: 'free', hold, background: '#f3eee3', nodes: [BAR] });
const LONG = { version: 2, look: 'desk', shots: [
  { id: 'hook', show: 'statement', say: 'Most dashboards cannot tell you *where a number came from*.' },
  free('proof', 12),
  { id: 'markup', show: 'statement', say: 'Type <b>bold</b> and _mean_ it.' },
  free('close', 12),
] };
const SHORT = { version: 2, shots: [free('a', 5), free('b', 5)] };
const INVALID = { version: 2, shots: [{ id: 'a', show: 'nope', hold: 1 }] };

let dir;
before(() => { dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'mm-storyboard-'))); });
after(() => rmSync(dir, { recursive: true, force: true }));
const writeFilm = (name, film) => {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(film));
  return file;
};
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60_000 });

// ---- storyboardPlan, pure ----

test('one timeline event per shot, in order, with its id, kind, seconds and plain narration', () => {
  const { film, timeline } = loadFilm(writeFilm('long-pure', LONG));
  const plan = storyboardPlan(film, timeline, { name: 'long-pure' });
  const events = plan.sections.find((s) => s.type === 'timeline').items;
  assert.deepEqual(events.map((e) => e.title), ['hook', 'proof', 'markup', 'close']);
  timeline.shots.forEach((shot, i) => {
    assert.ok(events[i].date.includes(film.shots[i].show), events[i].date);
    assert.ok(events[i].date.includes(`${shot.start.toFixed(1)}`), events[i].date);
  });
  assert.equal(events[0].text, 'Most dashboards cannot tell you where a number came from.');
  assert.equal(events[2].text, 'Type <b>bold</b> and mean it.', 'markup characters stay text; emphasis marks are dropped');
});

test('a look decision offers the listed looks with their feel, recommends the film\'s own, an approval and one question', () => {
  const { film, timeline } = loadFilm(writeFilm('long-look', LONG));
  const plan = storyboardPlan(film, timeline, { name: 'long-look' });
  const decision = plan.sections.find((s) => s.type === 'decision');
  // a decision holds at most 5 options (make-explainer's schema) and six looks are listed since keynote: the first five
  // here, the film's own look among them
  const looks = listEntries('looks').slice(0, 5);
  assert.deepEqual(decision.options.map((o) => o.label), looks.map((l) => l.name));
  assert.deepEqual(decision.options.map((o) => o.pros), looks.map((l) => [l.summary]));
  assert.equal(decision.recommended, 'desk');
  assert.equal(decision.default, 'desk');
  assert.equal(plan.sections.filter((s) => s.type === 'approval').length, 1);
  assert.equal(plan.sections.filter((s) => s.type === 'question').length, 1);
  assert.equal(plan.sections.at(-1).type, 'verdict');
  assert.equal(plan.preset, 'plan');
  assert.match(plan.key, /^[a-z0-9][a-z0-9._-]*$/);
});

test('a film in a look past the fifth listed one still has it among the five options, and recommended', () => {
  const { film, timeline } = loadFilm(writeFilm('long-keynote', { ...LONG, mode: 'pro', look: 'keynote' }));
  const decision = storyboardPlan(film, timeline, { name: 'long-keynote' }).sections.find((s) => s.type === 'decision');
  const labels = decision.options.map((o) => o.label);
  assert.equal(labels.length, 5);
  assert.ok(labels.includes('keynote'), `the film's own look is offered: ${labels}`);
  assert.equal(decision.recommended, 'keynote');
  assert.equal(new Set(labels).size, 5, 'no look twice');
});

test('the film and timeline passed in are not changed', () => {
  const { film, timeline } = loadFilm(writeFilm('long-frozen', LONG));
  const before = JSON.stringify({ film, timeline });
  storyboardPlan(film, timeline, { name: 'x' });
  assert.equal(JSON.stringify({ film, timeline }), before);
});

// ---- the board's pictures ----

const PLAIN_LOOKS = [{ name: 'desk', summary: 'warm paper' }, { name: 'ink', summary: 'black and white' }];
// The sha256 of JSON.stringify of the LONG film's plan with PLAIN_LOOKS and no stills, taken before the board's pictures existed.
const PLAN_BEFORE_STILLS = '49fd8406fa6b19087174ad340558a81a45c4485c32cce1f91033150535ccdf7b';
const MAX_SECTIONS = 40; // make-explainer's limit per page
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024; // make-explainer's limit per image
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

// A film of `count` shots, each 5 s on its (estimated) timeline, as storyboardPlan takes them.
function synthetic(count) {
  const shots = Array.from({ length: count }, (_, i) => ({ id: `s${i + 1}`, show: 'statement', say: 'x y z' }));
  return { film: { look: 'desk', shots }, timeline: { duration: count * 5, shots: shots.map((_, i) => ({ start: i * 5, end: (i + 1) * 5 })) } };
}

test('with stills the plan gains one image section per strip, after the shots, each saying the timing is estimated', () => {
  const { film, timeline } = synthetic(8); // six shots to a strip: two strips
  const plan = storyboardPlan(film, timeline, { name: 'demo', looks: PLAIN_LOOKS, stills: ['demo.stills/board-1.jpg', 'demo.stills/board-2.jpg'] });
  const images = plan.sections.filter((s) => s.type === 'image');
  assert.equal(images.length, 2);
  assert.equal(plan.sections.indexOf(images[0]), plan.sections.findIndex((s) => s.type === 'timeline') + 1);
  assert.equal(plan.sections.indexOf(images[1]), plan.sections.indexOf(images[0]) + 1);
  assert.deepEqual(images.map((i) => i.src), ['demo.stills/board-1.jpg', 'demo.stills/board-2.jpg']);
  assert.deepEqual(images.map((i) => i.title), ['Shots s1 to s6 as drawn', 'Shots s7 to s8 as drawn']);
  assert.deepEqual(images.map((i) => i.alt), ['Shots s1, s2, s3, s4, s5, s6 of the draft film', 'Shots s7, s8 of the draft film']);
  for (const image of images) {
    assert.equal(image.label, 'Pictures');
    assert.equal(image.caption, 'Estimated timing: no voice was made yet, so each shot is as long as its word count says.');
  }
  assert.equal(plan.sections.at(-1).type, 'verdict');
});

test('a strip with no shot behind it (a board left from a longer film) is not put on the page', () => {
  const { film, timeline } = synthetic(4);
  const plan = storyboardPlan(film, timeline, { name: 'stale', looks: PLAIN_LOOKS, stills: ['x.stills/board-1.jpg', 'x.stills/board-2.jpg'] });
  assert.deepEqual(plan.sections.filter((s) => s.type === 'image').map((i) => i.src), ['x.stills/board-1.jpg']);
});

test('without stills the plan is unchanged', () => {
  const { film, timeline } = loadFilm(writeFilm('long-nostills', LONG));
  const plan = storyboardPlan(film, timeline, { name: 'demo', looks: PLAIN_LOOKS });
  assert.equal(createHash('sha256').update(JSON.stringify(plan)).digest('hex'), PLAN_BEFORE_STILLS);
  assert.deepEqual(storyboardPlan(film, timeline, { name: 'demo', looks: PLAIN_LOOKS, stills: [] }), plan);
});

test('a 60-shot film stays within the page\'s 40 sections', () => {
  const { film, timeline } = synthetic(60);
  const stills = Array.from({ length: 10 }, (_, i) => `big.stills/board-${i + 1}.jpg`);
  const { sections } = storyboardPlan(film, timeline, { name: 'big', looks: PLAIN_LOOKS, stills });
  assert.ok(sections.length <= MAX_SECTIONS, `${sections.length} sections`);
  assert.equal(sections.filter((s) => s.type === 'image').length, 10);
});

// ---- the command ----

test('a 30 s film writes a plan make-explainer\'s own validator accepts, and prints the build line', (t) => {
  const film = writeFilm('long', LONG);
  const { timeline } = loadFilm(film);
  assert.ok(timeline.duration > STORYBOARD_MIN_SECONDS, `the film is ${timeline.duration} s`);
  const out = path.join(dir, 'plan.json');
  const r = run(film, '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const [printed, build] = r.stdout.trim().split('\n');
  assert.equal(printed, out);
  assert.equal(build, `build: node ${path.join(EXPLAINER, 'scripts/build.mjs')} ${out}`);
  if (EXPLAINER_SKIP) return t.skip(EXPLAINER_SKIP);
  const check = spawnSync(process.execPath, [VALIDATE, out, '--json'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  // The generatedBy provenance warning (make-explainer 1.3.0) is the agent's to answer (build --model/--effort/--agent);
  // the storyboard's own content must raise no other warning (as main's version 1 storyboard test does).
  assert.deepEqual((JSON.parse(check.stdout).warnings ?? []).filter((w) => w.path !== 'generatedBy'), [], 'no warning either');
  return undefined;
});

test('a film of 20 s or less is skipped: one line, exit 0, no file', () => {
  const out = path.join(dir, 'short-plan.json');
  const r = run(writeFilm('short', SHORT), '--out', out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^storyboard: skipped \(not needed \(10 s is 20 s or less\)\)\n$/);
  assert.equal(existsSync(out), false);
});

test('--non-interactive is skipped: one line, exit 0, no file', () => {
  const out = path.join(dir, 'ni-plan.json');
  const r = run(writeFilm('long-ni', LONG), '--out', out, '--non-interactive');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'storyboard: skipped (no one to ask (non-interactive run))\n');
  assert.equal(existsSync(out), false);
});

test('make-explainer not beside this skill is skipped, naming where it looked: exit 0, no file', () => {
  const out = path.join(dir, 'absent-plan.json');
  const lines = [];
  const missing = path.join(dir, 'no-explainer');
  const code = main([writeFilm('long-absent', LONG), '--out', out], { explainerDir: missing, out: (s) => lines.push(s), err: (s) => lines.push(s) });
  assert.equal(code, 0);
  assert.deepEqual(lines, [`storyboard: skipped (make-explainer is not installed beside make-motion (looked in ${path.join(missing, 'SKILL.md')}))\n`]);
  assert.equal(existsSync(out), false);
});

test('an invalid film exits 1 with the validator\'s line', () => {
  const r = run(writeFilm('invalid', INVALID), '--out', path.join(dir, 'invalid-plan.json'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^shots\[0\]\.show: /m);
  assert.equal(r.stdout, '');
});

test('--out missing, an unknown flag, or --out naming the film itself is exit 2', () => {
  const film = writeFilm('long-usage', LONG);
  assert.equal(run(film).status, 2);
  assert.match(run(film).stderr, /--out <file> is required/);
  const unknown = run(film, '--out', path.join(dir, 'p.json'), '--fast');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /--out <file>, --non-interactive/);
  const self = run(film, '--out', film);
  assert.equal(self.status, 2);
  assert.deepEqual(JSON.parse(readFileSync(film, 'utf8')), LONG, 'the film is untouched');
});

// ---- --stills ----

const boardFolder = (name, files = { 'board-1.jpg': JPEG }) => {
  const folder = path.join(dir, name);
  mkdirSync(folder, { recursive: true });
  for (const [file, bytes] of Object.entries(files)) writeFileSync(path.join(folder, file), bytes);
  return folder;
};
const capture = () => {
  const lines = [];
  return { lines, io: { out: (s) => lines.push(s), err: (s) => lines.push(s) } };
};

test('--stills copies the strips beside the plan, and make-explainer\'s validator accepts the page', (t) => {
  if (EXPLAINER_SKIP) return t.skip(EXPLAINER_SKIP);
  const board = boardFolder('board-ok');
  const planFile = path.join(dir, 'with-stills', 'plan.json');
  const { lines, io } = capture();
  const code = main([writeFilm('long-stills-cmd', LONG), '--out', planFile, '--stills', board], io);
  assert.equal(code, 0, lines.join(''));
  const copy = path.join(path.dirname(planFile), 'plan.stills', 'board-1.jpg');
  assert.ok(existsSync(copy), 'the strip is beside the plan');
  assert.deepEqual(readFileSync(copy), JPEG);
  assert.equal(JSON.parse(readFileSync(planFile, 'utf8')).sections.find((s) => s.type === 'image').src, 'plan.stills/board-1.jpg');
  assert.equal(lines.join('').split('\n')[0], planFile);
  assert.ok(lines.includes('storyboard: the pictures and the times are on estimated timing (no voice was made)\n'), lines.join(''));
  const check = spawnSync(process.execPath, [VALIDATE, planFile, '--json'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.deepEqual((JSON.parse(check.stdout).warnings ?? []).filter((w) => w.path !== 'generatedBy'), [], 'no warning either');
  return undefined;
});

test('without --stills nothing is copied and the estimated line is not printed', () => {
  const planFile = path.join(dir, 'no-stills-cmd', 'plan.json');
  const { lines, io } = capture();
  assert.equal(main([writeFilm('long-nostills-cmd', LONG), '--out', planFile], io), 0);
  assert.equal(existsSync(path.join(dir, 'no-stills-cmd', 'plan.stills')), false);
  assert.equal(lines.some((l) => l.includes('estimated timing')), false);
});

test('a folder with no strips, a strip that is a link and a strip over 1.5 MB each exit 2 naming the file', () => {
  const film = writeFilm('long-stills-bad', LONG);
  const planFile = path.join(dir, 'bad-stills', 'plan.json');
  const run2 = (board) => {
    const { lines, io } = capture();
    const code = main([film, '--out', planFile, '--stills', board], io);
    return { code, text: lines.join('') };
  };

  const none = run2(boardFolder('board-none', { 'notes.txt': Buffer.from('x') }));
  assert.equal(none.code, 2);
  assert.match(none.text, /board-none/);
  assert.match(none.text, /board-<n>\.jpg/);

  const missing = run2(path.join(dir, 'no-such-board'));
  assert.equal(missing.code, 2);
  assert.match(missing.text, /no-such-board/);

  const linkFolder = boardFolder('board-link', {});
  writeFileSync(path.join(dir, 'real.jpg'), JPEG);
  symlinkSync(path.join(dir, 'real.jpg'), path.join(linkFolder, 'board-1.jpg'));
  const link = run2(linkFolder);
  assert.equal(link.code, 2);
  assert.match(link.text, /board-1\.jpg is a symbolic link/);

  const big = run2(boardFolder('board-big', { 'board-1.jpg': Buffer.alloc(MAX_IMAGE_BYTES + 1, 0xff) }));
  assert.equal(big.code, 2);
  assert.match(big.text, /board-1\.jpg is \d\.\d\d MB; make-explainer takes at most 1\.5 MB/);
  assert.equal(existsSync(planFile), false, 'no plan is written when a strip is refused');
});
