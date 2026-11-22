import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewerFile } from '../../shared/agents.mjs';

// No SKILL.md pins a model. The session model is the director (intake, spec, viewing, creative calls) and a cheap
// `artifact-builder` agent is the operator (one command, mechanical fixes). Every skill carries the same section that
// says so, and the text may not drift between skills.
// The list of skills is the skills folder itself: a new sibling is held to the same rule without editing this file.
const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');
const read = (skill, root = SKILLS) => fs.readFileSync(path.join(root, skill, 'SKILL.md'), 'utf8');
const HEADING = '## Director and operator';
const OLD_NAME = 'Cheaper model';
const OLD_PHRASE = 'on the model named in the frontmatter';
const REQUIRED_PHRASES = [
  'You are the director', 'artifact-builder', 'make.mjs', '--json', 'skill directory', 'spec path', 'mechanical', 'creative',
  'unless you are already artifact-builder', 'run the same command yourself', 'list of available agents', 'take over',
  'shared/shot.mjs', 'sheets',
];

// Every skill folder under `root`: a folder with a SKILL.md.
const skillNames = (root = SKILLS) => fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'SKILL.md'))).sort();
const DELEGATING = skillNames();

// The text under `## Director and operator`, up to the next `## ` heading.
function section(md) {
  const at = md.indexOf(`\n${HEADING}\n`);
  if (at === -1) return null;
  const rest = md.slice(at + HEADING.length + 2);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

// What is wrong with one skill's section; an empty list means it is right.
function problems(md) {
  const body = section(md);
  if (!body) return [`missing "${HEADING}" heading`];
  const found = REQUIRED_PHRASES.filter((p) => !body.includes(p)).map((p) => `section lacks "${p}"`);
  if (md.split(`\n${HEADING}\n`).length !== 2) found.push('not exactly one section');
  if (md.match(/\n(## [^\n]+)/)?.[1] !== HEADING) found.push('not placed right after the intro');
  return found;
}

// The keys of a SKILL.md frontmatter block.
const frontKeys = (md) => (md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '').split('\n').map((l) => l.match(/^([A-Za-z][\w-]*):/)?.[1]).filter(Boolean);
// The pinned-model keys one frontmatter carries.
const pins = (md) => frontKeys(md).filter((k) => k === 'model' || k === 'effort');
// What is left of the old scheme in one SKILL.md.
const oldScheme = (md) => [OLD_NAME, OLD_PHRASE].filter((s) => md.includes(s));

test('the skills folder is the source of the list: the five known skills are all in it', () => {
  for (const skill of ['make-dashboard', 'make-diagram', 'make-explainer', 'make-motion', 'make-scene']) assert.ok(DELEGATING.includes(skill), skill);
  assert.ok(DELEGATING.length >= 5);
});

for (const skill of DELEGATING) {
  test(`${skill}/SKILL.md has one Director and operator section, first after the intro, with the ladder, the report words and the loop guard`, () => {
    assert.deepEqual(problems(read(skill)), []);
  });
}

test('the Director and operator text is identical in every skill', () => {
  const texts = DELEGATING.map((s) => section(read(s)));
  assert.ok(texts[0], 'section exists');
  for (const t of texts.slice(1)) assert.equal(t, texts[0]);
});

for (const skill of DELEGATING) {
  test(`${skill}/SKILL.md frontmatter has no model or effort key`, () => {
    assert.deepEqual(pins(read(skill)), []);
  });

  test(`${skill}/SKILL.md keeps nothing of the Cheaper model scheme`, () => {
    assert.deepEqual(oldScheme(read(skill)), []);
  });

  test(`${skill}/SKILL.md names its own scripts/make.mjs, and the file exists`, () => {
    assert.ok(read(skill).includes('scripts/make.mjs'), 'SKILL.md names scripts/make.mjs');
    assert.ok(fs.existsSync(path.join(SKILLS, skill, 'scripts', 'make.mjs')), `${skill}/scripts/make.mjs exists`);
  });
}

test('the plugin ships the reviewer file, equal to what shared/agents.mjs builds', () => {
  assert.equal(fs.readFileSync(path.join(SKILLS, '../agents/motion-reviewer.md'), 'utf8'), reviewerFile('claude').content);
});

test('no SKILL.md names the reviewer in its Director and operator section', () => {
  for (const skill of DELEGATING) assert.ok(!section(read(skill)).includes('motion-reviewer'), skill);
});

// The second reviewer is named in reviewing.md only because a proof passed (eval/results/summary-motion-reviewer-2026-11-22.md,
// 12 of 12 planted defects, no false fail), and only as an option: a skills-CLI install has no agent file and the director
// reviews with the same checklist. SKILL.md stays unchanged (its Director and operator section is the same text everywhere).
const REVIEWING = path.join(SKILLS, 'make-motion/references/reviewing.md');
const REVIEWING_HEADINGS = ['## Notes', '## Never score', '## Pictures alone', '## Delivery'];
const SECOND_REVIEWER_PHRASES = ['motion-reviewer', 'optional', 'list of available agents', 'review it yourself with the same checklist', 'sheets', '2026-11-22'];

// The text of the `## Second reviewer` section, or null.
const secondReviewer = (md) => {
  const at = md.indexOf('\n## Second reviewer\n');
  if (at < 0) return null;
  const rest = md.slice(at + 1);
  const next = rest.indexOf('\n## ', 3);
  return next < 0 ? rest : rest.slice(0, next);
};

test('reviewing.md has a Second reviewer section after its four headings, with the pinned phrases and the proof date', () => {
  const md = fs.readFileSync(REVIEWING, 'utf8');
  const heads = md.split('\n').filter((l) => l.startsWith('## '));
  assert.deepEqual(heads, [...REVIEWING_HEADINGS, '## Second reviewer'], 'the four headings keep their order and the section comes last');
  const body = secondReviewer(md);
  assert.ok(body, 'the section exists');
  for (const phrase of SECOND_REVIEWER_PHRASES) assert.ok(body.includes(phrase), phrase);
  assert.match(body, /if `motion-reviewer` is in your list of available agents/i);
  assert.match(body, /otherwise review it yourself with the same checklist/i);
  assert.match(body, /review\.md/);
});

// The brief names "the path of the report saved as a JSON file", and make.mjs --json only prints the report: nothing else
// saves it, so the section says to (the proof's harness pre-saved the file, so only this sentence covers the hand-off).
test('the Second reviewer section tells the director to save the --json report beside the film and pass that path', () => {
  const body = secondReviewer(fs.readFileSync(REVIEWING, 'utf8'));
  assert.ok(body, 'the section exists');
  assert.match(body, /save the `make\.mjs --json` report beside the film as `<film>\.report\.json` with Write, and pass that path/i);
  assert.match(body, /It only reads; it changes nothing/);
  assert.doesNotMatch(body, /It reads and changes nothing/);
});

// The summary the section cites, read from the section itself, so a later proof cannot update the text and leave the file (or the other way).
const PLUGIN_ROOT = path.join(SKILLS, '..');
const CITED_SUMMARY = /`(eval\/results\/summary-motion-reviewer-[0-9-]+\.md)`/;

test('the recorded proof the section cites exists, passed, and names the agent it proved', () => {
  const cited = CITED_SUMMARY.exec(secondReviewer(fs.readFileSync(REVIEWING, 'utf8')) ?? '');
  assert.ok(cited, 'the section cites a summary file by its eval/results path');
  const summary = fs.readFileSync(path.join(PLUGIN_ROOT, cited[1]), 'utf8');
  assert.match(summary, /\*\*PASSED\*\*/);
  assert.match(summary, /Agent that ran, read from the stream: motion-reviewer/);
  assert.match(summary, /model: opus/, 'the summary says the agent file pins opus');
  assert.doesNotMatch(summary, /account default/, 'the summary names no "account default" model (the director ran on one model too, so the proof cannot tell the pin from the default)');
  assert.match(summary, /6173284/, 'the summary names the commit of the agent file it proved');
  const index = fs.readFileSync(path.join(PLUGIN_ROOT, 'eval/results/INDEX.md'), 'utf8');
  assert.ok(index.split('\n').some((l) => l.includes(path.basename(cited[1])) && l.includes('6173284')), 'the INDEX row names the same commit');
});

// M3: every planted defect was also readable from film.json (value 24 against "forty two percent", highlight "May" against
// "March was the peak", region blue against "the red button", a shot id aside), and the scorer never checks `looked`. So the
// proof shows the agent finds defects stated in the spec and its narration and replies in the agent format; it does not show
// that it reads pictures. The docs say exactly that, and no more.
test('the docs claim only what the proof measured: defects found in the spec and its narration, not that it reads pictures', () => {
  const section = secondReviewer(fs.readFileSync(REVIEWING, 'utf8'));
  assert.match(section, /defects that the film's spec and its narration state/);
  assert.match(section, /does not show that it reads pictures/);
  assert.doesNotMatch(section, /evidence it can read a `say` line against its sheets/);
  const summary = fs.readFileSync(path.join(PLUGIN_ROOT, 'eval/results/summary-motion-reviewer-2026-11-22.md'), 'utf8');
  assert.match(summary, /[Ee]very planted defect could also be read from `film\.json` alone/);
  assert.match(summary, /does not show that the agent reads pictures/);
  assert.match(summary, /`looked`/, 'the summary says the scorer never checks looked');
  assert.match(summary, /portable-artifacts:motion-reviewer/, 'the summary says the proof ran a workdir file, not the plugin-prefixed agent');
  const index = fs.readFileSync(path.join(PLUGIN_ROOT, 'eval/results/INDEX.md'), 'utf8');
  const row = index.split('\n').find((l) => l.includes('summary-motion-reviewer-2026-11-22.md'));
  assert.ok(row, 'the INDEX row exists');
  assert.doesNotMatch(row, /Evidence that it reads a `say` line against its sheets/);
  assert.match(row, /does not show that it reads pictures/);
});

// L14: the reviewer file pins model: opus whatever the director runs on, so the section says what that costs.
test('the Second reviewer section says it is optional, pinned to Opus and once per finished film', () => {
  const section = secondReviewer(fs.readFileSync(REVIEWING, 'utf8'));
  assert.match(section, /pinned to Opus/);
  assert.match(section, /once per finished film/);
});

test('guardrail proof: the cited-summary pattern reads a path from a section and finds none in prose without one', () => {
  assert.equal(CITED_SUMMARY.exec('see (`eval/results/summary-motion-reviewer-2026-11-22.md`).')[1], 'eval/results/summary-motion-reviewer-2026-11-22.md');
  assert.equal(CITED_SUMMARY.exec('see the proof'), null);
});

test('guardrail proof: the section finder reads a section and returns null for a file without one', () => {
  assert.equal(secondReviewer('# x\n\n## Delivery\ny\n'), null);
  assert.match(secondReviewer('## Delivery\ny\n\n## Second reviewer\nbody text\n\n## Later\nz\n'), /body text/);
  assert.doesNotMatch(secondReviewer('## Delivery\ny\n\n## Second reviewer\nbody text\n\n## Later\nz\n'), /Later/);
});

// Guardrail proofs: each rule above fires on a document that breaks it.
test('guardrail proof: a frontmatter with model: haiku or effort: low is caught, one without is not', () => {
  assert.deepEqual(pins('---\nname: make-x\nmodel: haiku\n---\nBody\n'), ['model']);
  assert.deepEqual(pins('---\nname: make-x\neffort: low\n---\nBody\n'), ['effort']);
  assert.deepEqual(pins('---\nname: make-x\ndescription: a model of effort: low\n---\nBody\n'), []);
});

test('guardrail proof: the old heading, a reference to it and the old sentence are caught', () => {
  assert.deepEqual(oldScheme('x\n## Cheaper model\ny\n'), [OLD_NAME]);
  assert.deepEqual(oldScheme('hand off as the Cheaper model section says'), [OLD_NAME]);
  assert.deepEqual(oldScheme('it runs this skill on the model named in the frontmatter'), [OLD_PHRASE]);
  assert.deepEqual(oldScheme(read('make-dashboard')), []);
});

test('guardrail proof: a sibling dropped into the folder is picked up, and the check fails when its section or a phrase is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-delegation-'));
  const copy = (name, body) => {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'SKILL.md'), body);
  };
  copy('make-dashboard', read('make-dashboard'));
  copy('make-new', '---\nname: make-new\n---\n\nIntro.\n\n## Steps\n\nDo it.\n');
  copy('make-late', read('make-dashboard').replace(`\n${HEADING}\n`, '\n## Other\n\nx\n\n## Director and operator\n'));
  copy('make-dup', `${read('make-dashboard')}\n${HEADING}\n\nAgain.\n`);
  copy('make-thin', read('make-dashboard').replace('take over', 'give up'));
  fs.mkdirSync(path.join(root, 'not-a-skill'));
  assert.deepEqual(skillNames(root), ['make-dashboard', 'make-dup', 'make-late', 'make-new', 'make-thin']);
  assert.deepEqual(problems(read('make-dashboard', root)), []);
  assert.deepEqual(problems(read('make-new', root)), [`missing "${HEADING}" heading`]);
  assert.ok(problems(read('make-late', root)).includes('not placed right after the intro'));
  assert.ok(problems(read('make-dup', root)).includes('not exactly one section'));
  assert.deepEqual(problems(read('make-thin', root)), ['section lacks "take over"']);
});
