// The storyboard step for a version 2 film: scripts/storyboard.mjs reads a draft film and, for one longer than 20 s,
// writes a make-explainer `plan` page (one timeline event per shot, a look decision, an approval, an open question).
// Skipped, with one stdout line, exit 0 and no file, when the film is short, make-explainer is not beside this skill, or
// the run cannot pause for an answer. No browser, no ffmpeg.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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
// `voice` adds a voice to the film: only then is the timeline an estimate (a silent film's times are its holds).
function synthetic(count, { voice = false } = {}) {
  const shots = Array.from({ length: count }, (_, i) => ({ id: `s${i + 1}`, show: 'statement', say: 'x y z' }));
  return { film: { look: 'desk', ...(voice ? { voice: { name: 'af_heart' } } : {}), shots }, timeline: { duration: count * 5, shots: shots.map((_, i) => ({ start: i * 5, end: (i + 1) * 5 })) } };
}

test('with stills the plan gains one image section per strip, after the shots, each saying the timing is estimated', () => {
  const { film, timeline } = synthetic(8, { voice: true }); // six shots to a strip: two strips
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

// L5: a silent film has no voice to wait for, so its times are its holds, not an estimate.
test('on a silent film the image caption says the times are the holds, and never "estimated"', () => {
  const { film, timeline } = synthetic(4);
  const plan = storyboardPlan(film, timeline, { name: 'demo', looks: PLAIN_LOOKS, stills: ['demo.stills/board-1.jpg'] });
  const [image] = plan.sections.filter((s) => s.type === 'image');
  assert.equal(image.caption, 'Timing: this film has no voice, so each shot lasts as long as its hold says.');
  assert.doesNotMatch(image.caption, /estimated|no voice was made/i);
});

test('a strip with no shot behind it (a board left from a longer film) is not put on the page', () => {
  const { film, timeline } = synthetic(4);
  const plan = storyboardPlan(film, timeline, { name: 'stale', looks: PLAIN_LOOKS, stills: ['x.stills/board-1.jpg', 'x.stills/board-2.jpg'] });
  assert.deepEqual(plan.sections.filter((s) => s.type === 'image').map((i) => i.src), ['x.stills/board-1.jpg']);
});

test('a strip is tied to its shots by the number in its name: board-1 and board-3 with board-2 missing', () => {
  const { film, timeline } = synthetic(18);
  const plan = storyboardPlan(film, timeline, { name: 'gap', looks: PLAIN_LOOKS, stills: ['g.stills/board-1.jpg', 'g.stills/board-3.jpg'] });
  const images = plan.sections.filter((s) => s.type === 'image');
  assert.deepEqual(images.map((i) => i.src), ['g.stills/board-1.jpg', 'g.stills/board-3.jpg']);
  assert.deepEqual(images.map((i) => i.title), ['Shots s1 to s6 as drawn', 'Shots s13 to s18 as drawn']);
  assert.equal(images[1].alt, 'Shots s13, s14, s15, s16, s17, s18 of the draft film');
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
  const printed = lines.join('').split('\n');
  assert.equal(printed[1], 'storyboard: the pictures use the shots\' holds as their times (the film has no voice)', 'the second line: LONG is silent, so nothing is estimated');
  assert.match(printed[2], /^build: node /);
  const check = spawnSync(process.execPath, [VALIDATE, planFile, '--json'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.deepEqual((JSON.parse(check.stdout).warnings ?? []).filter((w) => w.path !== 'generatedBy'), [], 'no warning either');
  return undefined;
});

test('--stills on a voiced film says the pictures and the times are on estimated timing (no voice was made)', (t) => {
  if (EXPLAINER_SKIP) return t.skip(EXPLAINER_SKIP);
  const board = boardFolder('board-voiced');
  const planFile = path.join(dir, 'voiced-stills', 'plan.json');
  const { lines, io } = capture();
  const voiced = { ...LONG, voice: { name: 'af_heart' } };
  assert.equal(main([writeFilm('long-voiced-stills', voiced), '--out', planFile, '--stills', board], io), 0, lines.join(''));
  assert.equal(lines.join('').split('\n')[1], 'storyboard: the pictures and the times are on estimated timing (no voice was made)');
  assert.equal(JSON.parse(readFileSync(planFile, 'utf8')).sections.find((s) => s.type === 'image').caption, 'Estimated timing: no voice was made yet, so each shot is as long as its word count says.');
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

  mkdirSync(path.join(dir, 'board-dir', 'board-1.jpg'), { recursive: true }); // a folder where a strip should be
  const dirStrip = run2(path.join(dir, 'board-dir'));
  assert.equal(dirStrip.code, 2);
  assert.match(dirStrip.text, /board-1\.jpg is not a regular file/);
});

// ---- --stills: the copy never harms a source strip, and a strip is tied to its shots by its number ----

test('--stills naming the folder the strips are copied into (a rerun) is exit 2 and every strip is still there', () => {
  const folder = boardFolder('rerun/plan.stills', { 'board-1.jpg': JPEG });
  const planFile = path.join(dir, 'rerun', 'plan.json');
  const { lines, io } = capture();
  assert.equal(main([writeFilm('long-rerun', LONG), '--out', planFile, '--stills', folder], io), 2);
  assert.match(lines.join(''), /is the folder the pictures are copied into/);
  assert.ok(lines.join('').includes(folder), 'names the folder');
  assert.deepEqual(readFileSync(path.join(folder, 'board-1.jpg')), JPEG, 'the source strip is not deleted');
  assert.equal(existsSync(planFile), false, 'no plan is written');
});

test('--stills naming the destination through a link is refused too, and the strip stays', () => {
  const real = boardFolder('via-link/plan.stills', { 'board-1.jpg': JPEG });
  symlinkSync(real, path.join(dir, 'via-link', 'alias'));
  const { lines, io } = capture();
  assert.equal(main([writeFilm('long-via-link', LONG), '--out', path.join(dir, 'via-link', 'plan.json'), '--stills', path.join(dir, 'via-link', 'alias')], io), 2);
  assert.match(lines.join(''), /is the folder the pictures are copied into/);
  assert.ok(existsSync(path.join(real, 'board-1.jpg')));
});

test('--stills naming the copy folder with different letter case (a case-insensitive filesystem) is exit 2 and the strip stays', (t) => {
  const real = boardFolder('case-alias/plan.stills', { 'board-1.jpg': JPEG });
  const alias = path.join(dir, 'case-alias', 'PLAN.STILLS');
  const sameFolder = (() => {
    try {
      return statSync(alias).ino === statSync(real).ino;
    } catch {
      return false;
    }
  })();
  if (!sameFolder) return t.skip('this filesystem is case-sensitive: PLAN.STILLS is not plan.stills');
  const { lines, io } = capture();
  assert.equal(main([writeFilm('long-case-alias', LONG), '--out', path.join(dir, 'case-alias', 'plan.json'), '--stills', alias], io), 2, lines.join(''));
  assert.match(lines.join(''), /is the folder the pictures are copied into/);
  assert.deepEqual(readFileSync(path.join(real, 'board-1.jpg')), JPEG, 'the source strip is not deleted');
  return undefined;
});

test('a regular file named <stem>.stills beside the plan is exit 2 naming it, not a stack trace', () => {
  const board = boardFolder('board-file-in-way');
  mkdirSync(path.join(dir, 'in-the-way'), { recursive: true });
  const inTheWay = path.join(dir, 'in-the-way', 'plan.stills');
  writeFileSync(inTheWay, 'a file');
  const { lines, io } = capture();
  assert.equal(main([writeFilm('long-in-the-way', LONG), '--out', path.join(dir, 'in-the-way', 'plan.json'), '--stills', board], io), 2);
  assert.ok(lines.join('').includes(inTheWay), lines.join(''));
  assert.equal(readFileSync(inTheWay, 'utf8'), 'a file', 'the file is untouched');
});

test('a symbolic link named <stem>.stills beside the plan is exit 2', () => {
  const board = boardFolder('board-link-dest');
  mkdirSync(path.join(dir, 'link-dest', 'elsewhere'), { recursive: true });
  symlinkSync(path.join(dir, 'link-dest', 'elsewhere'), path.join(dir, 'link-dest', 'plan.stills'));
  const { lines, io } = capture();
  assert.equal(main([writeFilm('long-link-dest', LONG), '--out', path.join(dir, 'link-dest', 'plan.json'), '--stills', board], io), 2);
  assert.match(lines.join(''), /is a symbolic link/);
  assert.equal(existsSync(path.join(dir, 'link-dest', 'elsewhere', 'board-1.jpg')), false, 'nothing was copied through the link');
});

test('only strips with shots behind them are copied, and old board copies beside the plan are cleared (other files stay)', () => {
  const board = boardFolder('board-longer', { 'board-1.jpg': JPEG, 'board-3.jpg': JPEG }); // LONG has 4 shots: one strip
  const stills = path.join(dir, 'tidy', 'plan.stills');
  mkdirSync(stills, { recursive: true });
  writeFileSync(path.join(stills, 'board-9.jpg'), 'old copy');
  writeFileSync(path.join(stills, 'notes.txt'), 'mine');
  const { lines, io } = capture();
  assert.equal(main([writeFilm('long-tidy', LONG), '--out', path.join(dir, 'tidy', 'plan.json'), '--stills', board], io), 0, lines.join(''));
  assert.ok(existsSync(path.join(stills, 'board-1.jpg')));
  assert.equal(existsSync(path.join(stills, 'board-3.jpg')), false, 'a strip with no shot behind it is not copied');
  assert.equal(existsSync(path.join(stills, 'board-9.jpg')), false, 'an old copy is cleared');
  assert.equal(readFileSync(path.join(stills, 'notes.txt'), 'utf8'), 'mine');
  assert.ok(existsSync(path.join(board, 'board-3.jpg')), 'the source folder is never touched');
});

test('a folder whose strips are all past the film\'s shots is exit 2', () => {
  const board = boardFolder('board-all-past', { 'board-5.jpg': JPEG });
  const { lines, io } = capture();
  assert.equal(main([writeFilm('long-all-past', LONG), '--out', path.join(dir, 'all-past', 'plan.json'), '--stills', board], io), 2);
  assert.match(lines.join(''), /no strip in .* has a shot of this 4-shot film behind it/);
});

test('with board-1 and board-3 the page puts board-3 on its own shots, found by number', () => {
  const sixteen = { version: 2, look: 'desk', shots: Array.from({ length: 13 }, (_, i) => ({ id: `n${i + 1}`, show: 'free', hold: 3, background: '#f3eee3', nodes: [BAR] })) };
  const board = boardFolder('board-gap', { 'board-1.jpg': JPEG, 'board-3.jpg': JPEG });
  const planFile = path.join(dir, 'gap', 'plan.json');
  const { lines, io } = capture();
  assert.equal(main([writeFilm('thirteen', sixteen), '--out', planFile, '--stills', board], io), 0, lines.join(''));
  const images = JSON.parse(readFileSync(planFile, 'utf8')).sections.filter((s) => s.type === 'image');
  assert.deepEqual(images.map((i) => i.src), ['plan.stills/board-1.jpg', 'plan.stills/board-3.jpg']);
  assert.deepEqual(images.map((i) => i.title), ['Shots n1 to n6 as drawn', 'Shots n13 as drawn']);
});
