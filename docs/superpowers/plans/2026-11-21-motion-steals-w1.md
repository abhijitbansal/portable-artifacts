# Motion steals W1: Doctrine and Colour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The agent plans a better film (one thing, three storylines that are three films, per-look tells, a review that ranks notes and never scores) from a shorter `SKILL.md`, every MP4 is converted to BT.709 and tagged, and a render that stalls names the stage it stalled in.

**Architecture:** `SKILL.md` becomes a router: it keeps the intake, the command rules and the lookup tables that tests pin, and sends everything else to files under `references/`. The doctrine is prose in those files, guarded by the three doc tests, which are extended first so the new files cannot drift. Colour is one change in `encoderArgs`: one `scale` filter converts matrix and range, and a final `setparams` filter writes the tags, on both capture paths. Capture diagnostics are a small clock that times the three stages of a frame on both the serial and the parallel path and turns a stall into an error that names the stage.

**Tech Stack:** Node >= 20 ESM, `node:test`, Playwright Chromium, ffmpeg and ffprobe (system). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-21-motion-steals-design.md` section 6, "W1, doctrine and colour". Item detail (P1, P2, P7, P8, P17, P18): `.scratch/research-2026-11-21/PROPOSAL.md` section 2A. Master plan: `docs/superpowers/plans/2026-11-21-motion-steals.md`.

Abbreviations (write each out in full in a command): `R` = `/Users/abhijitbansal/projects/portable-artifacts/.claude/worktrees/new-improvements`, `P` = `R/plugins/portable-artifacts`, `MM` = `P/skills/make-motion`, `BT` = `P/bin/test`.

## Global Constraints

- `MM/SKILL.md` is 20,898 bytes against a 20,900-byte budget pinned in `plugins/portable-artifacts/bin/test/skill-budget.test.mjs`; slim, never raise the cap. W1 ends with `SKILL.md` at 19,700 bytes or fewer (`wc -c`), so W3 to W6 have at least 1,200 bytes of room. The line budget is 129; today it has 123.
- No new runtime dependency, no network use, no generative-video call from `make.mjs`. `references/broll.md` is guidance only.
- No new server route (the preview server is GET and HEAD only).
- One headless browser at a time: `pgrep -fl chrome-headless-shell` before every step marked **[BROWSER]**; browser tests run with `--test-concurrency=1`, one file at a time.
- Goldens change only for an intended visual change, stated in the commit. W1 changes no picture; Task 6 changes every MP4's colour data and tags, on purpose, and its commit says so. No gallery file is rebuilt in W1 (the one rebuild is the final phase).
- HyperFrames (Apache-2.0) and Rune (MIT) ideas are rewritten in our own code and words with a credit line in `THIRD_PARTY_NOTICES.md`; no file is ported, no table or paragraph is copied. No code from beast_explainer.
- Every code fix and guardrail is shown failing first (RED), then passing.
- Doctrine never bans one of our own looks. Tells are written per look. Only devices our 16 kinds and our cuts can draw are offered. The pace stays 150 words a minute in `pro` and 175 in `viral`.
- `SKILL.md` must not contain any of `references/storyboard.md`, `references/voiceover.md`, `references/block-tables.md`, `blocks.mjs`, `render.mjs`, `validate.mjs`, `check.mjs`, `preview.mjs`, `voice.mjs` (`BT/skill-budget.test.mjs:69`). No new reference file takes one of those names, and the review file is `references/reviewing.md`, never `references/review.md` (that name is the director's output beside the film).
- The intake keeps its nine options and these literal strings, which `BT/intake.test.mjs:157-169` replaces one at a time: `**voice**`, `(about 227 MB installed)`, `reports their size`, `Captions are a separate switch`, `erase)`, `any run that cannot pause for an answer`, `` `codex exec` ``.
- Commits: conventional, prefixed `feat(w1):`, `fix(w1):`, `test(w1):` or `docs(w1):`, staging named files only, ending with exactly one trailer line `Co-Authored-By: Claude <noreply@anthropic.com>` and no `Claude-Session` line. Implementers do not commit; the controller commits one task per commit. No `plugin.json` bump, `CHANGELOG.md` heading or cover Revision here: they happen once, in the final phase.
- Shell rules: one plain command per Bash call with literal absolute paths; no `cd`, `&&`, pipes, `;`, shell variables, loops or heredocs; quote globs; edits with the Edit tool; noisy commands run bare.
- Implementers are executor tier (Sonnet, effort high); the reviewer is Opus at medium. A fresh-context review runs at the end of the wave before its commits are pushed.

Test commands used below:
- A doc test: `node --test "BT/make-motion-docs.test.mjs"` (also `intake.test.mjs`, `skill-budget.test.mjs`). They import make-motion's code, so `MM/node_modules` must exist (`npm --prefix MM ci` once).
- A make-motion test with no browser: `node --test "MM/test/v2/<file>.test.mjs"`.
- A make-motion browser test: `node --test --test-concurrency=1 "MM/test/v2/<file>.test.mjs"` **[BROWSER]**.

## Review Focus

1. **A reference file nothing reads.** A router that links a file the agent never opens has moved the rule out of the film. Each new file is named in `SKILL.md` at the workflow step that needs it, and Task 1's test fails for a reference file `SKILL.md` does not name.
2. **A film with sound.** The mux is the last step that writes the output (`MM/scripts/v2/render.mjs:242`), so the tags must survive a stream copy. Task 6 probes a muxed film, not only a silent one.
3. **A colour that is right in ffmpeg and wrong in a player.** swscale reads an untagged file as BT.601, so a round trip through ffmpeg's defaults passes on today's untagged BT.601 output. Task 6's round trip decodes as BT.709 by explicit option, which is what a player assumes for HD.
4. **A stall on the parallel path.** `--workers` seeks and captures in `MM/scripts/v2/workers.mjs:42-60`, not in `render.mjs`. Task 7 times and guards both paths through one function.
5. **A film error reported as a stall.** An error the page raised about the film is a finding (`MM/scripts/v2/session.mjs:28-31`). Task 7's stall error wraps only a stage that did not answer in time (its own timer, or the browser's `TimeoutError`), never any other error a stage threw.
6. **An agent that cannot pause.** The storyline step must still say what to do in `claude -p`, `codex exec` and the eval: pick the first and say so. Task 3's test pins that sentence.
7. **[R2-1] A check that fails a legal film.** One held still, a film on a flat ground, a one-frame film: each must pass. Task 7's still-picture test pins the first.

## File Structure

- `MM/SKILL.md`: shorter; the router.
- `MM/references/story.md`: rewritten around the one thing, claim discipline, three storylines and the teaching check.
- `MM/references/types/explainer.md`, `types/data.md`, `types/vertical.md`: one page per type of film.
- `MM/references/tells.md`: per-look tells.
- `MM/references/reviewing.md`: the review protocol.
- `MM/references/broll.md`: guidance for generated b-roll.
- `MM/references/music.md`: the beat-grid notes moved out of `SKILL.md` step 10.
- `MM/scripts/v2/render.mjs`: the colour filters; the capture loop goes through the clock.
- `MM/scripts/v2/capture-clock.mjs` (new): the stage clock and the stall error.
- **[R2-1]** `MM/scripts/v2/output-check.mjs` (new) and `MM/test/v2/output-check.test.mjs` (new): the check of the finished file.
- `MM/scripts/v2/workers.mjs`, `report.mjs`, `run.mjs`: the clock on the parallel path, the report's `timing`.
- `MM/THIRD_PARTY_NOTICES.md`: a credits section.
- Tests: `BT/make-motion-docs.test.mjs`, `BT/intake.test.mjs`, `MM/test/v2/make.test.mjs`, `MM/test/v2/helpers/session.mjs`, `MM/test/v2/color-browser.test.mjs` (new), `MM/test/v2/capture-clock.test.mjs` (new), `MM/test/v2/workers-browser.test.mjs`, `MM/test/v2/review.test.mjs`.

---

### Task 1: The doc tests learn the new files, and what a router is

**Files:**
- Modify: `BT/make-motion-docs.test.mjs:24` (`DOCS`, a fixed list of five), and new tests after `:85`
- Read: `BT/make-motion-docs.test.mjs:43-54` (`brokenLinks` checks every `references/…` path a document names)

**Interfaces:**
- Produces: `referenceDocs() -> string[]`, every `.md` file under `MM/references/` (walked, `examples/` left out), as paths relative to `MM`, sorted; `DOCS = ['SKILL.md', 'README.md', ...referenceDocs()]`. Tasks 2 to 5 rely on every link, flag and `--list` rule covering their new files through `DOCS`.

- [ ] **Step 1: Write the failing tests.**

```js
const WAVE_1_DOCS = ['references/broll.md', 'references/music.md', 'references/reviewing.md', 'references/tells.md',
  'references/types/data.md', 'references/types/explainer.md', 'references/types/vertical.md'];

test('the doctrine files exist, and the review protocol is not called review.md', () => {
  for (const rel of WAVE_1_DOCS) assert.ok(fs.existsSync(path.join(MOTION, rel)), rel);
  assert.ok(!fs.existsSync(path.join(MOTION, 'references/review.md')), 'review.md is the director\'s output beside the film');
  for (const rel of ['references/migrating.md', 'references/schema.md', 'references/story.md', ...WAVE_1_DOCS]) assert.ok(referenceDocs().includes(rel), rel); // later waves add files
  assert.ok(referenceDocs().every((rel) => !rel.startsWith('references/examples/')));
});

test('SKILL.md is a router: it names every reference file, and the beat notes live in references/music.md', () => {
  const md = read('SKILL.md');
  for (const rel of referenceDocs()) assert.ok(md.includes(rel), `SKILL.md names ${rel}`);
  assert.ok(!md.includes('reggae one-drop'), 'the misread list moved out');
  assert.ok(read('references/music.md').includes('reggae one-drop'));
});

test('guardrail: a reference file SKILL.md does not name is caught', () => {
  const md = read('SKILL.md').replaceAll('references/tells.md', 'x');
  assert.deepEqual(referenceDocs().filter((rel) => !md.includes(rel)), ['references/tells.md']);
});
```

- [ ] **Step 2: Run to see RED.** `node --test "BT/make-motion-docs.test.mjs"`. Expected: FAIL, "the doctrine files exist…" on `references/broll.md`; the router and guardrail tests fail too. Every other test in the file passes (the walker finds the three files that exist).
- [ ] **Step 3: No commit yet.** These tests and Task 2 land as one commit, so the tree is green at every commit.

### Task 2: Slim `SKILL.md` to a router

**Files:**
- Modify: `MM/SKILL.md:74` (step 1), `:80` (step 7), `:82` (step 9), `:83` (step 10), `:91-97` (Narration and anchors), `:87` (the final report line)
- Create: `MM/references/music.md`, and stubs for the six other Wave 1 files (each a title and one sentence; Tasks 3 to 5 fill them)
- Read: `MM/references/schema.md:100-106` (Variables and Cuts already hold what step 9 and the `cut` bullet say)
- Modify (review fix, HIGH): `MM/test/beats-limits.test.mjs:117-125` and `MM/test/beats-regression.test.mjs:290-293`. Both pin words that this task moves out of `SKILL.md` (the misread list and the tempo flags). In the same commit:
  - `beats-limits.test.mjs` "names every known limit": read `references/music.md` instead of `SKILL.md` for the word list, and keep the `!includes('from about 140')` check on both files. Rename the test to "references/music.md names every known limit with the flag that fixes it".
  - `beats-regression.test.mjs` "names the tempo flags": read `SKILL.md` and `references/music.md` joined, so a flag may live in either file.
  - Run both files (`node --test "MM/test/beats-limits.test.mjs"`, `node --test "MM/test/beats-regression.test.mjs"`) before the edit: they pass. After the `SKILL.md` edit but before the test edit: `beats-limits` fails (RED, proves the pin). After the test edit: both pass.

**Interfaces:**
- Consumes: Task 1's tests.
- Produces: a `SKILL.md` of at most 19,700 bytes whose sections and pinned sentences are unchanged where a test reads them: the opening paragraph, `**Audio is opt-in.**`, `## Director and operator`, `## Before the first build`, `## Intake (one round)`, `## Running the commands`, `## Workflow` (ten numbered steps), `## Looking things up` (the looks table, the sixteen kinds, the eight `--list` names, the example films), `## Rules`, the one `Sharing:` line.

What moves, and nothing else:

| From | To | What stays in `SKILL.md` |
|---|---|---|
| Step 10, from "Exit 1 with `no steady beat found`" to its end (the misread list) | `references/music.md` | The two commands, the `music` object with `snap`, and "Read `<skill-dir>/references/music.md` when the tempo it prints is not the one you hear." |
| Step 9, from "For one film per row" to its end | already in `references/schema.md`, Variables | "For one film per row, declare `vars` (see Variables in `references/schema.md`) and run with `--batch rows.json`." |
| `## Narration and anchors`, the `cut` and `music` bullets | already in `references/schema.md` (Cuts, Sound) | The `say` and `hold` bullet, the write-for-the-ear bullet and the anchor bullet, with one line pointing at Cuts and Sound in `references/schema.md`; "In `viral` a picture may sit still for 3 s, in `pro` for 6 s (`--list modes`)" stays |

What is added, one line each: at step 1, "Pick the film's type first: `references/types/explainer.md`, `references/types/data.md` or `references/types/vertical.md`; `references/tells.md` lists what gives each look away; `references/broll.md` covers generated clips."; at step 7, "The protocol is in `references/reviewing.md`."; in the final report line, "the weakest shot, and what nobody checked".

- [ ] **Step 1: Make the edits** with the Edit tool. Do not reword a sentence that is not in the table.
- [ ] **Step 2: Measure.** `wc -c -l MM/SKILL.md`. Expected: at most 19,700 bytes and at most 129 lines (the review measured the three moves above at about 19,750, so the target is 19,700, not the first draft's 19,300). If it is over, move these next, in this order, and stop when under: (a) step 8's override sentence, to `references/reviewing.md`; (b) the Voice paragraph's install detail, to `references/schema.md` Sound (keep the one-line pointer). These two passages are named moves, so moving them does not break "do not reword a sentence that is not in the table". Never touch the intake or the lookup tables.
- [ ] **Step 3: Run the doc tests and the two beats tests.** `node --test "BT/make-motion-docs.test.mjs"`, `node --test "BT/intake.test.mjs"`, `node --test "BT/skill-budget.test.mjs"`, `node --test "MM/test/beats-limits.test.mjs"`, `node --test "MM/test/beats-regression.test.mjs"`. Expected: PASS, all five, Task 1's tests included.
- [ ] **Step 4: Commit (controller).** One commit for Tasks 1 and 2: `docs(w1): SKILL.md is a router; the beat notes move to references/music.md`, files `MM/SKILL.md`, the seven new reference files, `BT/make-motion-docs.test.mjs`, `MM/test/beats-limits.test.mjs`, `MM/test/beats-regression.test.mjs`. The body states the byte count before (20,898) and after, with the command.

### Task 3: Story doctrine (P1)

**Files:**
- Modify: `MM/references/story.md` (all of it; `:19-21` is today's storyline rule, `:31-41` today's tells), `BT/make-motion-docs.test.mjs`
- Modify (fill the stubs): `MM/references/types/explainer.md`, `types/data.md`, `types/vertical.md`, `MM/references/tells.md`
- Read: `registries.modes` (the pace: `wpm`), `MM/SKILL.md:101` (the sixteen kinds)

**Interfaces:**
- Consumes: `DOCS` (Task 1), so every link and flag in these files is checked.
- Produces: `story.md` with exactly these `##` sections in this order: `The one thing`, `Claims`, `Three storylines`, `Write for the picture`, `Narration`, `The teaching check`, `Tells every look shares`, `What the review tells you`. W2 Task 11 adds `## Sound across a cut` after `Narration` and updates this test's list.

The decisions the implementer cannot make alone (the wording is theirs, in our own words; nothing is copied from another project):
- **The one thing.** Before any shot: one sentence a viewer could repeat after the film. Every shot serves it or is cut.
- **Claims.** Every number and every claim in a `say` comes from the brief or the user's material. Anything else is marked as an assumption in the storyline and asked about, or cut.
- **Three storylines.** For a film over 15 s with a person there to answer: three storylines that are three different films. Each gives the first two seconds written out (the opening shot's kind and its exact `say`), the worked example, the arc in one line per shot, and the closing ask. Two storylines that share both their opening kind and their worked example are one storyline; replace one. Write the three to `storylines.md` beside the film. When nobody can answer (`claude -p`, `codex exec`, an eval), pick the first and say so in the report.
- **The teaching check**, five numbered lines, filled in before the shots are written: the one thing; the worked example the whole film follows; the shot where the picture shows the idea, and the kind that draws it; what the film leaves out; a question the viewer can answer after the film and could not before.
- **Devices**, in the type files: only what our kinds and cuts draw. A worked example, a `diagram` that grows, before and after (`compare`), a `number` that lands, a `match` chain, cuts on the beat (`music.snap`). Not a continuous take and not an endless zoom: say so in one line, outside the Devices section.
- **Type files**, each with `## When`, `## Shape`, `## Devices`, `## Check`: `explainer` (one idea through one worked example), `data` (one claim per chart, the highlighted mark says what to see), `vertical` (the hook reads from frame 0, captions recommended, a picture still for at most 3 s).
- **Tells**, in `tells.md`: one `## <look>` section per registered look (seven), each with at least two tells that give that look away when it is used badly, and one line on the content it suits (moved from `story.md:41`). No section bans a look, and there is no list of banned looks or fields.
- **[R2-5] The shape of a short**, in `types/vertical.md` under `## Shape`: the first line says who the short is for;
  the next one or two say what they want or what hurts; the first useful point lands inside the first 10 s; where the
  content has steps, promise a counted result early; once, about midway, one line opens a second question and the next
  line answers it; end on one ask and stop. It is craft, not proof: no view count or retention figure is quoted. The
  source's beat-by-beat sequence and its formula list are not reproduced. (Wording stays the implementer's, in our own
  words; no heading is added to any file, so the pinned heading lists hold.)
- **[R2-6] Honest hooks**, in `types/vertical.md` under `## Check` and one sentence in `story.md` under `Claims`: what
  the hook names is on screen in the first shot; a promise the film does not pay off is cut from the hook; no number,
  result or deadline that the brief did not give; a "wrong way, then right way" film shows the right way; at most two
  hook devices in one opening.
- **[R2-7] A tell states when it is right.** In `tells.md`, each tell bullet ends with a `works when` clause naming the
  case where the same choice is right. A tell with no such case says `never` and why; expect few. Before the tells are
  committed, search `MM/SKILL.md` and `MM/references/*.md` for a sentence that tells the agent to do the thing each
  tell names; fix the sentence or drop the tell, and list what was found in the task report. One sentence in `story.md`
  under `Three storylines`: "The example films show the shape of the fields; they are not a pace, a look or a shot
  order to copy." (`SKILL.md:74` sends the agent to those films; it is not reworded, so this adds 0 bytes there.)
- **[R2-8a] The cue pass**, in `story.md` under `Write for the picture`, two lines at most: before the shots are
  written, mark each line's cue. A number is drawn as a quantity (a `number`, a `chart` mark, a count of things), not
  printed as a caption. An abstract noun gets one concrete thing from the subject's own world, not the stock picture
  of its category. A turn word (but, instead, until) is where a cut or a `compare` goes. Not every word goes on screen.
- **[R2-9a] Lines that read as machine-written**, one bullet in `story.md` under `Narration`: a "not just this, but
  that" turn; three one-word sentences in a row; a product told to "unlock" or "meet" something; a figure the brief did
  not give. Each is right when the picture shows the real contrast it claims. Prose only; no finding.
- **[R2-11] Demo data**, one sentence in `story.md` under `Write for the picture`: "A page you screenshot for a
  `screen` or `clipping` shot holds made-up, realistic data before the capture: never a real customer's, never filler
  text, never an empty state."
- **[R2] `SKILL.md` bytes added by these six rows: 0.**

- [ ] **Step 1: Write the failing tests** in `BT/make-motion-docs.test.mjs`.

```js
const headings = (md) => [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

test('story.md is built around the one thing, three storylines as three films and the five-line teaching check', () => {
  const md = read('references/story.md');
  assert.deepEqual(headings(md), ['The one thing', 'Claims', 'Three storylines', 'Write for the picture', 'Narration', 'The teaching check', 'Tells every look shares', 'What the review tells you']);
  const three = section(md, 'Three storylines');
  for (const phrase of ['three different films', 'first two seconds', 'storylines.md', '`claude -p`', 'pick the first']) assert.ok(three.includes(phrase), phrase);
  assert.equal(section(md, 'The teaching check').split('\n').filter((l) => /^\d\. /.test(l)).length, 5);
  for (const mode of ['pro', 'viral']) assert.ok(md.includes(`${registries.modes.get(mode).wpm} words a minute`), `${mode} pace`);
  assert.deepEqual([registries.modes.get('pro').wpm, registries.modes.get('viral').wpm], [150, 175]);
});

test('each type file has its four sections, and offers only devices the kinds, cuts and devices can draw', () => {
  const drawable = new Set([...listedKinds(), ...registries.cuts.names(), ...registries.devices.names(), 'music.snap', 'captions', 'say', 'hold', 'on']);
  for (const type of ['explainer', 'data', 'vertical']) {
    const md = read(`references/types/${type}.md`);
    assert.deepEqual(headings(md), ['When', 'Shape', 'Devices', 'Check'], type);
    for (const word of ticks(section(md, 'Devices'))) assert.ok(drawable.has(word), `${type}: \`${word}\` is not something the engine draws`);
  }
});

test('tells.md has one section per look, never a banned list', () => {
  const md = read('references/tells.md');
  assert.deepEqual(sorted(headings(md)), sorted(registries.looks.names()));
  for (const look of registries.looks.names()) assert.ok(section(md, look).split('\n').filter((l) => l.startsWith('- ')).length >= 2, look);
  assert.ok(!/\bbanned\b/i.test(md));
});

test('guardrail: a device no kind draws, and a look with no section, are caught', () => {
  assert.ok(!new Set([...listedKinds(), ...registries.cuts.names()]).has('endless-zoom'));
  const md = read('references/tells.md').replace('## ledger', '## lodger');
  assert.notDeepEqual(sorted(headings(md)), sorted(registries.looks.names()));
});
```

**[R2] Step 1, one more test** in `BT/make-motion-docs.test.mjs`:

```js
test('[R2] the shape of a short, honest hooks, tells with their condition, the cue pass, machine-written lines, demo data', () => {
  const story = read('references/story.md'); const vertical = read('references/types/vertical.md'); const tells = read('references/tells.md');
  for (const phrase of ['who the short is for', 'one ask']) assert.ok(section(vertical, 'Shape').includes(phrase), phrase);
  assert.ok(section(vertical, 'Check').includes('on screen in the first shot'));
  assert.ok(section(story, 'Claims').includes('the brief did not give'));
  for (const look of registries.looks.names()) assert.ok(section(tells, look).split('\n').filter((l) => l.startsWith('- ') && /works when|never/.test(l)).length >= 2, look);
  assert.ok(section(story, 'Three storylines').includes('not a pace, a look or a shot order to copy'));
  for (const phrase of ['not printed as a caption', 'made-up, realistic data']) assert.ok(section(story, 'Write for the picture').includes(phrase), phrase);
  assert.ok(section(story, 'Narration').includes('not just'));
});
```

- [ ] **Step 2: Run to see RED.** `node --test "BT/make-motion-docs.test.mjs"`. Expected: FAIL in the first three (the stubs have no sections; `story.md` has today's six headings) **[R2]** and in the round-2 test.
- [ ] **Step 3: Write the four files and rewrite `story.md`.** Keep every sentence of today's `story.md` that still holds (Write for the picture, Narration, What the review tells you); today's `## Two arcs` text goes into the type files, with each mode's pace sentence kept in `story.md`. Length: `story.md` at most 66 lines (**[R2]** was 60), `types/vertical.md` at most 34 (**[R2]** was 30), the other two type files at most 30, `tells.md` at most 45.
- [ ] **Step 4: Run to see GREEN.** The same command, then `node --test "BT/intake.test.mjs"` and `node --test "BT/skill-budget.test.mjs"`. Expected: PASS.
- [ ] **Step 5: Commit (controller).** `docs(w1): story doctrine: the one thing, three storylines as three films, type files, per-look tells`.

### Task 4: The review protocol (P7, prose only)

**Files:**
- Modify (fill the stub): `MM/references/reviewing.md`; `BT/make-motion-docs.test.mjs`
- Read: `MM/SKILL.md:80` and `MM/references/story.md` "What the review tells you" (the stranger sentence, the note format and "measurements outrank the eye" already exist; only the delta is written)

**Interfaces:**
- Produces: `reviewing.md` whose first four `##` sections are `Notes`, `Never score`, `Pictures alone`, `Delivery`, in that order. W5's reviewer agent reads this file as its checklist; the four section names and the four delivery labels are its contract, and W5 may append a fifth section after them.

The decisions:
- **Notes** are ranked P0 (the film says something false, or a shot cannot be read), P1 (a shot is weaker than it could be), P2 (polish), in the existing form with the rank first: `P1 · time · where · problem → change · what stays`. A P0 is fixed before delivery.
- **Never score.** No mark out of ten, no percentage, no "looks great". A review is its notes.
- **Pictures alone.** One question per shot: with the narration hidden, does the picture still make the shot's point?
- **Delivery**, four labelled lines in the final report: `weakest shot:` (the shot id and why), `measured:` (what the report printed), `looked at:` (the sheets opened), `not checked:` (what nobody could check; the audio always, since no agent can listen).
- **[R2-10]** `not checked:` always carries the standing list, quoted and not improvised: the sound (no agent can
  listen); text inside a picture or a clip (the size and contrast rules measure the film's own type, not pixels inside
  an image); motion between the frames the sheets sample; taste. A line leaves the list only when something the report
  printed measured it, and the note names what.
- **[R2-10]** When something needed to judge is missing, write `cannot verify` and what is missing, never a guessed
  baseline. When the brief and the film disagree, report the disagreement and do not pick one. (From video-shotcraft's
  reviewer brief, restated.)
- **[R2-10]** No W5 edit is needed: W5 Task 4's reviewer reads `reviewing.md` first and does not restate it, so its `unchecked` array starts from this list.

- [ ] **Step 1: Write the failing test.**

```js
test('reviewing.md ranks notes P0 to P2, never scores, asks the pictures-alone question and names the four delivery lines', () => {
  const md = read('references/reviewing.md');
  assert.deepEqual(headings(md).slice(0, 4), ['Notes', 'Never score', 'Pictures alone', 'Delivery']); // W5 may append a fifth
  for (const rank of ['P0', 'P1', 'P2']) assert.ok(section(md, 'Notes').includes(rank), rank);
  assert.ok(section(md, 'Notes').includes('· time · where · problem → change · what stays'));
  for (const label of ['weakest shot:', 'measured:', 'looked at:', 'not checked:']) assert.ok(section(md, 'Delivery').includes(label), label);
  for (const phrase of ['text inside a picture', 'between the frames the sheets sample', 'cannot verify']) assert.ok(section(md, 'Delivery').includes(phrase), phrase); // [R2-10]
  const skill = read('SKILL.md');
  assert.match(skill, /references\/reviewing\.md/);
  assert.match(skill, /write `review\.md` next to the film/);
});
```

- [ ] **Step 2: RED.** `node --test "BT/make-motion-docs.test.mjs"`. Expected: FAIL, the headings are missing.
- [ ] **Step 3: Write `reviewing.md`** (at most 46 lines; **[R2-10]** was 40).
- [ ] **Step 4: GREEN**, the three doc tests. `wc -c MM/SKILL.md` still at most 19,700.
- [ ] **Step 5: Commit (controller).** `docs(w1): review protocol: P0 to P2 notes, no score, the pictures-alone question, delivery lines`.

### Task 5: B-roll guidance (P18) and the viral captions line (P8)

**Files:**
- Modify (fill the stub): `MM/references/broll.md`; `MM/SKILL.md:40` (the **mode** option), `:52` (the **voice** option); `BT/make-motion-docs.test.mjs`, `BT/intake.test.mjs`
- Read: `MM/engine/kinds/media.mjs:18` (`CREDIT_MAX = 40`), `:74-90` (a clip plays from `in` to `out`, with a `credit`), `MM/engine/modes/viral.mjs:17` (captions are off in `viral`: the default does not change)

**Interfaces:**
- Produces: `broll.md` (guidance for a clip a generator made, used through the `media` kind) and two intake sentences. W4's word-level subtitles task builds on the **voice** line; it must keep `Captions are a separate switch`.

The decisions:
- `broll.md` says: no text inside a generated picture (the film sets its own type); one slow motion of the subject and one camera move, or a locked-off frame; trim the tail with `out` before the picture smears; write `AI-generated` in `credit` (at most 40 characters); a generator's own provenance manifest is lost when the film is encoded, so the visible credit is the only label that survives; `make.mjs` never calls a generator and never reaches the network.
- The **mode** option gains one clause that folds the type of film into it: "the film's type (an explainer, a data film or a vertical short) follows from the content: `references/types/`". The nine options and their names do not change.
- The **voice** option, right after `Captions are a separate switch, "captions": true, off by default.`, gains: "In `viral`, recommend them: many shorts are watched with the sound off." The default stays off.

- [ ] **Step 1: Write the failing tests.** In `BT/make-motion-docs.test.mjs`:

```js
test('broll.md: no text in the picture, one slow motion, trim with out, an honest credit within the cap, and no generator call', () => {
  const md = read('references/broll.md');
  for (const phrase of ['`out`', '`credit`', 'AI-generated', '40 characters', 'never calls a generator']) assert.ok(md.includes(phrase), phrase);
  assert.match(read('engine/kinds/media.mjs'), /const CREDIT_MAX = 40;/);
});
```

In `BT/intake.test.mjs`:

```js
test('the voice option recommends captions in viral and does not flip the default; the mode option folds in the film type', () => {
  const section = intakeSection(read('SKILL.md'));
  assert.match(optionLine(section, 'voice'), /Captions are a separate switch, `"captions": true`, off by default\. In `viral`, recommend them/);
  assert.equal(registries.modes.get('viral').captions, false);
  assert.match(optionLine(section, 'mode'), /references\/types\//);
  assert.deepEqual(OPTIONS, ['mode', 'look', 'format', 'length', 'assets', 'voice', 'music', 'sound', 'ask']);
});
```

- [ ] **Step 2: RED.** `node --test "BT/make-motion-docs.test.mjs"` and `node --test "BT/intake.test.mjs"`. Expected: FAIL in the two new tests.
- [ ] **Step 3: Write `broll.md`** (at most 25 lines) **and make the two intake edits.**
- [ ] **Step 4: GREEN**, the three doc tests; `wc -c MM/SKILL.md` at most 19,700.
- [ ] **Step 5: Commit (controller).** `docs(w1): b-roll guidance; the intake recommends captions in viral and folds in the film type`.

### Task 6: Convert to BT.709 and tag the stream (P2)

**Files:**
- Modify: `MM/scripts/v2/render.mjs:41-58` (`JPEG_RANGE_FILTER`, `encoderArgs`), `MM/test/v2/make.test.mjs:375-390` (the test that pins today's arguments), `MM/test/v2/helpers/session.mjs:56-62` (`probeVideo`)
- Create: `MM/test/v2/color-browser.test.mjs`
- Read: `MM/scripts/v2/render.mjs:238-243` (the encode, then the mux of a film with sound), `MM/engine/looks/ledger.mjs:122` (`post: { grain: 0, … }`: the one look whose frame is exactly its fills)

**Interfaces:**
- Produces, exported from `render.mjs`:
  - `BT709_TAGS = 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv'`
  - `encoderArgs({ fps, out, exact, stamp })` as today, with exactly one `-vf` on both paths. Fast: `scale=in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv,format=yuv420p,<BT709_TAGS>`. Exact: `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,<BT709_TAGS>`. The one `scale` converts matrix and range together; `setparams` is the last filter. `ENCODER` (`medium`, crf 23, `film`) does not change, and `-bf` is not added.
- `probeVideo(file)` also returns `colour: { space, primaries, transfer, range }` (ffprobe's `color_space`, `color_primaries`, `color_transfer`, `color_range`; a field ffprobe leaves out is `'unknown'`).
- These filter strings were written from ffmpeg's documentation and were not run by the planner. The acceptance is the round trip and the ffprobe tags below, on this machine's ffmpeg. If ffmpeg refuses an option, report its stderr line; change the string and the unit assertion together, never the tolerance.

- [ ] **Step 1: Rewrite the unit test at `make.test.mjs:375` (RED).** Keep its loop over crf, tune, `-pix_fmt`, output and `libx264`; import `BT709_TAGS`; replace its last two lines with:

```js
  const vf = (args) => args[args.indexOf('-vf') + 1];
  assert.equal(BT709_TAGS, 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv');
  assert.equal(vf(fast), `scale=in_color_matrix=bt601:in_range=pc:out_color_matrix=bt709:out_range=tv,format=yuv420p,${BT709_TAGS}`);
  assert.equal(vf(exact), `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,${BT709_TAGS}`);
  for (const args of [exact, fast]) assert.equal(args.filter((a) => a === '-vf').length, 1);
  assert.deepEqual(ENCODER, { preset: 'medium', crf: 23, tune: 'film' });
```

and retitle it "…converted to BT.709 limited range by one scale filter and tagged by a final setparams".

- [ ] **Step 2: Write `color-browser.test.mjs` (RED).** One film, written to a temp folder: version 2, `"fps": 30`, `"look": "ledger"`, one `free` shot `patches` with `"hold": 1`, `"background": "#808080"` and four `path` rectangles of 400 by 400 px at x 160, 600, 1040 and 1480, y 340, filled `#d63a2f`, `#2f8f4e`, `#2a4bd7` and `#f3eee3`. A second copy adds `"music": { "bed": "pulse", "bpm": 92 }`, for the mux.

```js
// decodeAs709(file, frame) -> Buffer of rgb24, from:
//   ffmpeg -v error -i <file> -vf "select=eq(n\,<frame>),scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24" -frames:v 1 -f rawvideo -
// patchMean(rgb, cx, cy) -> [r, g, b]: the mean over the 64 by 64 px square centred on (cx, cy)
for (const [flags, capture] of [[[], 'fast'], [['--exact'], 'exact']]) {
  test(`${capture}: the film is tagged bt709 on all three fields and limited range`, …);
  //   assert.deepEqual(probeVideo(out).colour, { space: 'bt709', primaries: 'bt709', transfer: 'bt709', range: 'tv' });
  test(`${capture}: four flat patches and the ground decode, read as BT.709, within 2 levels of their fills`, …);
  //   for each [hex, cx, cy] (the four patches at their centres, and '#808080' at (80, 80)), on frame 15:
  //     patchMean(rgb, cx, cy).forEach((v, k) => assert.ok(Math.abs(v - fill[k]) <= 2, `${capture} ${hex} channel ${k}: ${v}`));
}
test('a film with sound keeps the tags through the mux', …);
//   assert.notEqual(report.audio, null);
//   assert.deepEqual(probeVideo(report.output).colour, { space: 'bt709', primaries: 'bt709', transfer: 'bt709', range: 'tv' });
```

Each test skips without a browser, ffmpeg or ffprobe, as `make.test.mjs:62-67` does.

- [ ] **Step 3: Run to see RED. [BROWSER]** `node --test --test-concurrency=1 "MM/test/v2/color-browser.test.mjs"`. Expected: FAIL: the colour fields are `unknown` (or `bt470bg`), and the red and blue patches are more than 2 levels off when read as BT.709. Record the measured values of the red patch in the report: they are the size of the fix. Then `node --test --test-concurrency=1 --test-name-pattern="the encoder arguments" "MM/test/v2/make.test.mjs"`: FAIL, `BT709_TAGS` is not exported.
- [ ] **Step 4: Implement** `BT709_TAGS` and the two filter chains in `render.mjs`, and `colour` in `probeVideo`. Update the comment at `render.mjs:41` and the header's sentence about scaling from full to limited range to say what the filter now does.
- [ ] **Step 5: Run to see GREEN. [BROWSER]** Step 3's two commands, then the whole of `node --test --test-concurrency=1 "MM/test/v2/make.test.mjs"`. Expected: PASS ("fast and exact renders…" still reads `yuv420p`).
- [ ] **Step 6: Size check. [BROWSER]** W0's `R/.scratch/motion-steals-w0/results/fixed-fast.report.json` holds `bytes` for `kinds-desk.json` on the old arguments. Render it again (`node MM/scripts/make.mjs MM/references/examples/v2/kinds-desk.json --json --out R/.scratch/motion-steals-w1/fixed-fast-709.mp4`) and record both sizes. A file more than 5% larger is reported to the controller before the commit; it is not a failure.
- [ ] **Step 7: Commit (controller).** `feat(w1): convert to BT.709 and tag the stream on both capture paths`. The body: "Every MP4 changes colour data and gains bt709 tags, on purpose. No gallery file is rebuilt here; the one rebuild is the final phase." and the red patch's values before and after.

### Task 7: Capture diagnostics, step 0 (P17), and a check of the finished file (R2-1)

**Files:**
- Create: `MM/scripts/v2/capture-clock.mjs`, `MM/test/v2/capture-clock.test.mjs`
- **[R2-1]** Create: `MM/scripts/v2/output-check.mjs`, `MM/test/v2/output-check.test.mjs`
- Modify: `MM/scripts/v2/render.mjs:120-160` (`capture`, `encodeFrames`, `encodeWithWorkers`), `:208-248` (`renderFilm`'s result), `MM/scripts/v2/workers.mjs:42-60,89` (`produce`, `captureParallel`), `MM/scripts/v2/report.mjs:33-42,105-124,195` (`HINTS`, `reportOf`, the frames line), `MM/scripts/v2/run.mjs:63-66,134` (`newState`, the fields copied from the render), `MM/references/schema.md:127-140` (the report table), `MM/test/v2/review.test.mjs:513-516`, `MM/test/v2/workers-browser.test.mjs:84-98`

**Interfaces:**
- Produces, in `capture-clock.mjs`:
  - `STAGES = ['draw', 'capture', 'encode']`, `STAGE_STALL_MS = 120_000`, `TAIL_LINES = 5`
  - `createStageClock({ frames, stallMs = STAGE_STALL_MS, tail = () => [], now = () => performance.now() }) -> { time(stage, frame, fn): Promise<T>, totals(): { drawMs, captureMs, encodeMs } }`. `time` awaits `fn()`, adds its milliseconds to the stage's total and returns its value. A stall is either of two things, and both reject with `stallError`: `fn` has not settled after `stallMs` (cause `no answer in ${stallMs / 1000} s`), or `fn` throws an error whose `name` is `TimeoutError` (Playwright's own 30 s timeout on a screenshot fires long before `stallMs`; cause: the error's first line). Any other error `fn` throws passes through unchanged. A stage outside `STAGES` is refused. The stall timer is cleared when `fn` settles (and `unref`'d), so no 120 s timer outlives a frame (review fix). On the parallel path `totals()` sums the stage times of every page, so it can exceed wall time; `schema.md` says "summed across pages".
  - `stallError({ stage, frame, frames, cause, tail }) -> Error` whose message is `render stalled in the ${stage} stage at frame ${frame + 1} of ${frames}: ${cause}; last page messages: ${tail.slice(-TAIL_LINES).join(' | ') || 'none'}`.
- In `render.mjs`: `shootFrame(page, i, { exact, clock }) -> Promise<Buffer>` (exported): `__seek(i)` timed as `draw`, the screenshot timed as `capture`. The serial loop and the parallel path both call it; each write to ffmpeg, and the final `finish`, is timed as `encode`. `renderFilm` returns `timing: { drawMs, captureMs, encodeMs }` (whole milliseconds). The clock's `tail` is `() => session.errors`, the page and console errors the session already collects (`MM/scripts/v2/session.mjs:71-72`).
- In `workers.mjs`: `captureParallel({ pages, frames, shoot, write, onProgress, signal })`, where `shoot(page, i) -> Promise<Buffer>` replaces both `capture(page)` and the `__seek` call in `produce` (`:51-52`).
- In `report.mjs`: the report always carries `timing` (`null` until a render ran); the text form's frames line gains `, draw ${d} capture ${c} encode ${e} ms` after `ms per frame` when `timing` is not null; `HINTS` gains `[/^render stalled in the /, 'the browser or ffmpeg stopped answering at that stage; run again, and with --workers 1 if it keeps happening']`.
- **[R2-1]** In `capture-clock.mjs`: `STAGES = ['draw', 'capture', 'encode', 'check']`, and `totals()` returns
  `{ drawMs, captureMs, encodeMs, checkMs }`. In Step 1's tests, the first `deepEqual` expects
  `{ drawMs: 10, captureMs: 30, encodeMs: 0, checkMs: 0 }` and the unknown-stage message becomes
  `/stage must be one of draw, capture, encode, check/`.
- **[R2-1]** Produces, in `output-check.mjs`:
  - `CHECK_WIDTH = 96`, `CHECK_HEIGHT = 54`, `BLANK_STD = 1.5` (the standard deviation of a frame's luma, in levels of
    255; the value is motionmaxxing's and W0's pixel pass, R2-2, confirms it on our films before this ships).
  - `checkArgs(file) -> string[]`: the ffmpeg arguments that decode the file's first video stream to
    `CHECK_WIDTH` by `CHECK_HEIGHT` 8-bit gray frames on stdout (`-map 0:v:0 -vf scale=96:54:flags=area,format=gray
    -f rawvideo -`; not run by the planner).
  - `outputProblem({ decoded, stds, frames }) -> string | null`: `the finished file holds ${decoded} frames, the
    timeline has ${frames}` when the counts differ; `the finished file's picture is blank: none of its ${decoded}
    frames has any detail` when every value of `stds` is under `BLANK_STD`; else `null`.
  - `checkOutput({ ffmpeg, file, frames, signal }) -> Promise<{ decoded: number }>`: reads the frames as a stream
    (never the whole film in memory), and throws `render check: ${problem}; nothing was written` when there is a
    problem. It takes the ffmpeg path and the abort signal, not the voice steps' runner: a film with no sound has no
    runner (`render.mjs:220-221`).
- **[R2-1]** In `render.mjs` `renderFilm`: after the encode, and the mux when the film has sound, and before the
  `renameSync` that makes the output, `await clock.time('check', frames - 1, () => checkOutput({ … file: the file about
  to become the output, frames }))`. A failed check leaves no output file (the `finally` already removes both partial
  files). It is a render error, not a finding: the film is not at fault.
- **[R2-1]** Not checked, on purpose: a picture that does not move (a film of one held still is legal) and a flat
  stretch inside a film (a flood, a field, the `poster` look's grounds). Only a wrong frame count, or a film with no
  detail in any frame, fails.
- **[R2-1]** In `report.mjs`: the text form's frames line reads `, draw ${d} capture ${c} encode ${e} check ${k} ms`;
  `HINTS` gains `[/^render check: /, 'the browser drew or captured nothing, or the encode lost frames; run again with
  --workers 1, then with --exact, and report it if it stays']`. In `schema.md`, the `timing` row reads
  `{ drawMs, captureMs, encodeMs, checkMs }`. No new top-level report key, so the pinned key list changes only by
  `timing`, which this task already adds.
- **[R2-1] Cross-wave note** (for the master plan's Review Focus item 1, "Two waves that disagree on a name"): W3
  Task 7's slice render gives the check the slice's own frame count, not the film's; a slice that fails `render check`
  with the film's count is this bug.

- [ ] **Step 1: Write the failing tests.** `capture-clock.test.mjs` (no browser):

```js
test('the clock sums each stage and returns what the stage returned', async () => {
  let t = 0;
  const clock = createStageClock({ frames: 10, now: () => t });
  assert.equal(await clock.time('draw', 0, async () => { t += 4; return 'x'; }), 'x');
  await clock.time('draw', 1, async () => { t += 6; });
  await clock.time('capture', 1, async () => { t += 30; });
  assert.deepEqual(clock.totals(), { drawMs: 10, captureMs: 30, encodeMs: 0 });
});
test('a stage that does not answer in time is a stall naming the stage, the frame and the last page messages', async () => {
  const clock = createStageClock({ frames: 900, stallMs: 20, tail: () => ['a', 'b', 'c', 'd', 'e', 'f'] });
  await assert.rejects(clock.time('capture', 41, () => new Promise(() => {})),
    { message: 'render stalled in the capture stage at frame 42 of 900: no answer in 0.02 s; last page messages: b | c | d | e | f' });
});
test('an error a stage throws is not a stall: it passes through unchanged', async () => {
  const boom = new Error('page.evaluate: Error: unknown font "X"');
  await assert.rejects(createStageClock({ frames: 1 }).time('draw', 0, async () => { throw boom; }), (err) => err === boom);
});
test('the browser\'s own timeout is a stall too, with its first line as the cause', async () => {
  const timeout = Object.assign(new Error('page.screenshot: Timeout 30000ms exceeded.\nCall log:\n  - taking page screenshot'), { name: 'TimeoutError' });
  await assert.rejects(createStageClock({ frames: 900 }).time('capture', 41, async () => { throw timeout; }),
    { message: 'render stalled in the capture stage at frame 42 of 900: page.screenshot: Timeout 30000ms exceeded.; last page messages: none' });
});
test('a stall with no page message says none, and an unknown stage is refused', async () => {
  assert.match(stallError({ stage: 'encode', frame: 0, frames: 1, cause: 'no answer in 1 s', tail: [] }).message, /last page messages: none$/);
  await assert.rejects(createStageClock({ frames: 1 }).time('paint', 0, async () => {}), /stage must be one of draw, capture, encode/);
});
```

In `review.test.mjs:516`, add `'timing'` to the expected keys. In `workers-browser.test.mjs:95`, replace `capture: async (page) => Buffer.from(String(page.state.frame))` with `shoot: async (page, i) => { await page.evaluate((k) => window.__seek(k), i); return Buffer.from(String(page.state.frame)); }`; the expected `written` list and the count of 4 do not change.

- [ ] **Step 2: RED.** `node --test "MM/test/v2/capture-clock.test.mjs"` (FAIL: no module); `node --test "MM/test/v2/review.test.mjs"` (FAIL: `timing` missing); `node --test --test-concurrency=1 "MM/test/v2/workers-browser.test.mjs"` **[BROWSER]** (FAIL: `captureParallel` calls `capture`, which is not given).
- [ ] **Step 3: Implement.** In `schema.md`, add one table row after the `seconds` row and leave that row's text as it is (`BT/make-motion-docs.test.mjs:242` replaces it literally): `` | `timing` | `{ drawMs, captureMs, encodeMs }`: where the render's time went, or `null` when nothing was rendered | ``.
- [ ] **Step 4: GREEN.** Step 2's three commands, then `node --test "BT/make-motion-docs.test.mjs"` (the report keys agree with `schema.md`), then `node --test --test-concurrency=1 "MM/test/v2/make.test.mjs"` **[BROWSER]** (its text-mode test at `:243` expects `frames: 30` for a film that was not rendered: `timing` is null there, so the line does not change). Expected: PASS.
- [ ] **Step 5: One real number.** In `make.test.mjs`, "a full run renders…" (`:330`) gains: `assert.ok(report.timing.drawMs > 0 && report.timing.captureMs > 0 && report.timing.encodeMs >= 0)` and `assert.ok(report.timing.drawMs + report.timing.captureMs <= report.seconds * 1000)`. Run the file again **[BROWSER]**: PASS.
- [ ] **Step 5a [R2-1]: Write the failing tests** (`output-check.test.mjs`; ffmpeg, no browser).

```js
test('a film whose every frame is flat is blank; one frame with detail is enough', () => {
  assert.match(outputProblem({ decoded: 3, stds: [0, 0.4, 1.4], frames: 3 }), /picture is blank: none of its 3 frames/);
  assert.equal(outputProblem({ decoded: 3, stds: [0, 0, 9], frames: 3 }), null);
});
test('a frame count that differs from the timeline names both numbers', () => {
  assert.equal(outputProblem({ decoded: 29, stds: [9], frames: 30 }), 'the finished file holds 29 frames, the timeline has 30');
});
test('a black clip fails; a test pattern passes; one still picture held for the whole clip passes too', async () => {
  /* three 1 s clips, 320x180 at 30 fps, made with ffmpeg lavfi: color=black, testsrc, and one testsrc frame looped;
     checkOutput rejects the first with /render check: .*blank/ and resolves { decoded: 30 } for the other two */
});
test('a clip one frame short of the timeline fails, naming 30 and 31', async () => { /* the testsrc clip against frames: 31 */ });
```

- [ ] **Step 5b [R2-1]: RED.** `node --test "MM/test/v2/output-check.test.mjs"`. Expected: FAIL, module not found.
- [ ] **Step 5c [R2-1]: Implement, then GREEN.** The same command; then `node --test "MM/test/v2/capture-clock.test.mjs"`
  and `node --test "BT/make-motion-docs.test.mjs"`. In `make.test.mjs`, "a full run renders…" also asserts
  `report.timing.checkMs > 0`; run that file **[BROWSER]**: PASS.
- [ ] **Step 5d [R2-1]: The cost, measured. [BROWSER]** One `--json` render of `X/kinds-desk.json`; write
  `timing.checkMs` and `seconds * 1000` in the task report with the command. Bar: the check takes at most 5% of the
  render's wall time. Over it: sample two frames a second for the blank test (`fps=2` before the scale), count frames by
  a stream copy (`-c copy -f framecrc`), and measure again. The bar exists because no wave may slow the edit loop.
- [ ] **Step 6: Commit (controller).** `feat(w1): the report says where a render's time went, and a stalled stage is named`.
- [ ] **Commit [R2-1] (controller), its own commit after Step 6's:** `feat(w1): the finished file is decoded and checked before it is kept`. Files: `MM/scripts/v2/output-check.mjs`, `MM/test/v2/output-check.test.mjs`, and the R2-1 changes to `MM/scripts/v2/capture-clock.mjs`, `MM/scripts/v2/render.mjs`, `MM/scripts/v2/report.mjs`, `MM/references/schema.md`, `MM/test/v2/capture-clock.test.mjs`, `MM/test/v2/make.test.mjs`.

### Task 8: Credit lines in `THIRD_PARTY_NOTICES.md`

**Files:**
- Modify: `MM/THIRD_PARTY_NOTICES.md` (append after `:96`)
- Read: `MM/test/v2/cuts-notices.test.mjs:24` (it reads only table rows that start with a backticked cut name; a prose section does not disturb it)

**Interfaces:**
- Produces: a section `## Ideas credited, no code ported`, to which W2 to W6 each append. Its form: one bullet per project, the project's name, owner and licence, then the ideas taken, each with the wave that took it. W1's HyperFrames bullet includes naming the capture stage and its console tail on a hang (P17, review fix).

- [ ] **Step 1: Append the section.** Its first paragraph: "The following are ideas, rewritten here in our own words and code. No file, table or paragraph from these projects is in this repository." Then two bullets. **HyperFrames** (HeyGen, Apache-2.0): planning a film around one thing and three storylines, review notes ranked P0 to P2 with no score, the pictures-alone question (W1). **Rune** (MIT): converting to BT.709 and tagging the stream in the encode (W1). **[R2]** "Then two bullets" becomes "Then five bullets", adding:
  - **[R2]** **motionmaxxing** (github.com/Tejashmakwana/motionmaxxing, Apache-2.0): a tell stated with the case where
    it is right; a cue pass over the script; a standing list of what a review cannot see; decoding the finished file to
    check its picture (W1).
  - **[R2]** **video-shotcraft** (github.com/Vincentwei1021/video-shotcraft, Apache-2.0): "cannot verify" in place of a
    guessed baseline; made-up data before a page is captured (W1).
  - **[R2]** **Reelfactory** (reelfactory.dev; a closed product, public guides only): the shape of a short's opening and
    the honest-hook checks (W1).
  - **[R2]** W0's three round-2 rows are scratch measurements and a test; they port nothing and need no credit beyond these bullets.
- [ ] **Step 2: Run** `node --test "MM/test/v2/cuts-notices.test.mjs"`. Expected: PASS, unchanged.
- [ ] **Step 3: Commit (controller).** `docs(w1): credit HyperFrames and Rune for the ideas this wave takes`.

### Task 9: The wave gate

- [ ] **Step 1: The local gate for the areas touched.** `node P/bin/sync-shared.mjs --check`; `node --test "P/shared/test/*.test.mjs"`; `node --test "BT/*.test.mjs"`; `python3 -m pytest R/tests/pytest`; then make-motion's suite serially **[BROWSER]**: `node --test --test-concurrency=1 "MM/test/**/*.test.mjs"`, started in the background (CI's comment puts the suite at about 2,300 s of tests). Expected: all green. `wc -c MM/SKILL.md`: at most 19,700.
- [ ] **Step 2: Fresh-context review (reviewer tier, Opus at medium, report only).** The prompt gives `git diff --stat origin/main...HEAD`, the diff path (read per file when it is over 1,000 lines), this plan's Review Focus, and this sentence verbatim: "Report every issue you find, including ones you are uncertain about or consider low-severity. Do not filter for importance or confidence at this stage — a separate verification step will do that. Your goal here is coverage: it is better to surface a finding that later gets filtered out than to silently drop a real bug. For each finding, include your confidence level and an estimated severity so a downstream filter can rank them."
- [ ] **Step 3: Gate.** No CRITICAL or HIGH open; each code fix ships with a test that failed first (prose fixes are exempt). The controller pushes.
- [ ] **Step 4: For the branch test checklist (manual, the owner's).** One agent run on two sample briefs, whose three storylines a person reads and judges as three films or one; one check of a W1 render on QuickTime, Safari and Chrome against the sheet PNG (does the accent match). Both go on the list the final phase turns into the checklist; neither blocks the wave. **[R2-5, R2-6]** One of the two sample briefs is a vertical short; a person reads its first three lines against `types/vertical.md`.

## Self-review notes

- Spec coverage, section 6 "W1": slim to a router (Tasks 1 and 2); story doctrine with type files, tells and the teaching check, devices our kinds draw, 150 and 175 kept, intake axes folded into the nine (Tasks 3 and 5); review protocol in `reviewing.md` (Task 4); `broll.md` and the viral captions line (Task 5); BT.709 by a final `setparams`, RED first on `make.test.mjs`, the flat-patch round trip within 2 levels in both capture modes (Task 6); capture diagnostics step 0 (Task 7); credit lines (Task 8).
- Review Focus to tests: 1 is Task 1's router test; 2 is Task 6's mux test; 3 is Task 6's `decodeAs709`; 4 is Task 7's `workers-browser` edit; 5 is Task 7's pass-through test; 6 is Task 3's `claude -p` and "pick the first" assertions.
- Not verified by the planner: the ffmpeg filter strings (Task 6 says so and names the acceptance), and that `SKILL.md` reaches 19,700 bytes with only the three moves in Task 2's table (the size of each moved passage was estimated from the file, not measured; Task 2 Step 2 measures and says what to move next).
