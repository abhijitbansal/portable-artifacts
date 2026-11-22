# Motion steals: Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make-motion's films look and teach better, by taking the planning, checking and encoding ideas the research found in HyperFrames, Rune and other video tools into our own engine, in seven waves on one branch and one pull request.

**Architecture:** This file is the index. Each wave has its own plan file with its own tasks; this file holds what spans them: the order and what each wave depends on, the gate every wave passes, the table that turns W0's measurements into decisions for later waves, the two make-explainer tasks that ride alongside, the deferred list, and the final phase that rebuilds the gallery once and ships the release. The engine does not change shape: a film stays a JSON spec, a frame stays a pure function of its index, the render stays offline. Doctrine and colour land first, then visible composition and cut craft, then the inspection tools, then the rest (the owner's craft-first order).

**Tech Stack:** Node >= 20 ESM, `node:test`, Playwright Chromium 1.64.0, ffmpeg and ffprobe (system), Python 3 with pytest for the site tests. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-21-motion-steals-design.md`. Its evidence base is kept locally under `.scratch/research-2026-11-21/` (gitignored): `PROPOSAL.md` (the ranked list; "P1" to "P20" are its section 2A numbers) and `compose.md` (the composition measurements).

Abbreviations (write each out in full in a command): `R` = `/Users/abhijitbansal/projects/portable-artifacts/.claude/worktrees/new-improvements`, `P` = `R/plugins/portable-artifacts`, `MM` = `P/skills/make-motion`, `ME` = `P/skills/make-explainer`, `BT` = `P/bin/test`, `X` = `MM/references/examples/v2`, `G` = `R/docs/showcase/portable-artifacts/gallery`, `SF` = `R/.scratch/motion-steals-final`.

## Status

A resumed session reads this table first, then `git log --oneline origin/main..HEAD`. The controller updates a row in the commit that closes its wave.

| Wave | State | Commits |
|---|---|---|
| W0 measurements | not started | |
| W1 doctrine and colour | not started | |
| W2 composition and cut craft | not started | |
| W3 inspection tools | not started | |
| W4 shorts, sound, overlays | not started | |
| W5 evidence loop II | not started | |
| W6 type and look | not started | |
| make-explainer (alongside) | not started | |
| Final phase | not started | |

## Global Constraints

- Branch `feat/motion-steals`, one pull request. Each wave is a run of commits prefixed `feat(wN):`, `fix(wN):`, `test(wN):` or `docs(wN):`; the make-explainer tasks use `feat(explainer):` and `docs(explainer):`; the final phase `chore(release):` and `docs(release):`. Every commit stages named files only, leaves the tree green, and ends with exactly one trailer line `Co-Authored-By: Claude <noreply@anthropic.com>` and no `Claude-Session` line (the `commit-trailers` CI job fails otherwise). Implementers do not commit; the controller does.
- One `plugin.json` bump, one `CHANGELOG.md` heading and one cover Revision, once, in the final phase. No wave bumps the version. The `plugin-version-guard` job is red on the pull request until the final phase's bump lands; that is expected, and no commit uses `[skip-plugin-bump]`.
- `MM/SKILL.md` is 20,898 bytes against a 20,900-byte budget pinned in `plugins/portable-artifacts/bin/test/skill-budget.test.mjs`; slim, never raise the cap. W1 brings it to 19,700 bytes or fewer; every later wave states how many bytes it adds, and the sum stays under the cap.
- No new runtime dependency, no network use, no generative-video call from `make.mjs`.
- No new server route (the preview server is GET and HEAD only).
- One headless browser at a time: `pgrep -fl chrome-headless-shell` first, and wait if it lists anything; browser tests run with `--test-concurrency=1`. Every plan marks a step that starts a browser **[BROWSER]**, and one executor runs those one after another.
- Goldens change only for an intended visual change, stated in the commit. The gallery is rebuilt once, in the final phase, after every visual change has landed. The 23 version 1 gallery films are not deleted and not rebuilt.
- HyperFrames (Apache-2.0) and Rune (MIT) ideas are rewritten in our own code with a credit line in `MM/THIRD_PARTY_NOTICES.md`; no file is ported. No code from beast_explainer, in either direction.
- Every code fix and guardrail is shown failing first (RED), then passing.
- A film that passes every finding but still looks generated is a failure: creative findings stay few and capped per film. Doctrine never bans one of our own looks. No wave may slow the time from an edit to a checked frame.
- Shell rules: one plain command per Bash call with literal absolute paths; no `cd`, `&&`, pipes, `;`, shell variables, loops or heredocs; quote globs; scripts and edits through the Write and Edit tools; a subagent never runs `rm`; noisy commands run bare; no `sleep`, no `timeout`.
- Tiers: implementers are the executor tier (Sonnet, effort high); reviewers are Opus at medium (`high` for the final review); plans and the hardest single verification are the planner tier at high. An implementer moves up a tier only after the same diagnostic survives two different fixes with effort raised first, and the cause is written here before the dispatch.

## Review Focus (the whole branch)

1. **Two waves that disagree on a name.** W2 fixes the rule ids `dead-space` and `scale-contrast` and the shot field `narration: { lead, trail }`; W3's registry must list every rule id `auditFrame` and the film review emit, plus its own `cut-variety` and `sameness`; W4's word-level subtitles must place a word at `shot.start + word.soundStart`. The final review greps each name across all seven plans' diffs.
2. **A default that moved.** Every wave promises that a film which asks for none of its features renders as before. The final phase rebuilds eight films from unchanged specs: a frame that changed for a reason no commit names is a bug, found by viewing the sheets against the old ones.
3. **The byte budget, summed.** Each wave adds a little to `SKILL.md`. The cap is checked by a test at every commit; the review also checks that no wave bought room by deleting a rule a test does not pin.
4. **A browser run that overlapped another.** Any report with two **[BROWSER]** steps and one `pgrep` line is sent back.
5. **A measurement used after it went stale.** W0's numbers are taken before W1 changes the encoder arguments. A later wave that quotes a W0 timing says so, or measures again.
6. **A release that ships a changed MP4 nobody looked at.** Every rebuilt film's sheets are opened in the final phase, and what was not viewed is said.
7. **[R2] Round 2.** Every round-2 change carries an `R2-n` tag in the plan it touches; the record is `.scratch/research-2026-11-21/round2/DECISIONS.md`. The final review greps `R2-` in the seven wave plans and checks each accepted tag has its commit.

## Wave index

| Wave | Plan file | Items | Depends on | Gate, beyond the common one |
|---|---|---|---|---|
| W0 | `2026-11-21-motion-steals-w0.md` | Measurements: colour tags, frame time split, capture spike, audio offset, snapshot dump and prototype motion rules, slam strip, held-frame test, two probes, two code reads; **[R2-2]** a pixel pass over finished files | nothing | The results table is in this file and every decision below is filled in |
| W1 | `2026-11-21-motion-steals-w1.md` | `SKILL.md` as a router; story doctrine P1; review protocol P7 (prose); b-roll guidance P18; viral captions intake line P8; BT.709 P2; capture diagnostics step 0 P17; credit lines; **[R2-1]** a check of the finished file | W0 (its fixed-film sizes and tag table) | `SKILL.md` at most 19,700 bytes; both capture modes tagged bt709 |
| W2 | `2026-11-21-motion-steals-w2.md` | `dead-space` and `scale-contrast` findings; cosmos number recentred; short statements; J and L narration P5; live outgoing shot P5; `at` on iris and zoom, colour flood P11 | W0 (the snapshot dump script), W1 (the story doctrine it adds a section to) | Thresholds come from the calibration table; the cut strips were viewed |
| W3 | `2026-11-21-motion-steals-w3.md` | Findings v2 P3 (one rule registry, rules doc with a parity test, the `suggest` payload, `cut-variety` and `sameness`); slices P4; locate helper P6 | W2 (its rule ids) | The registry lists every rule id the code emits |
| W4 | `2026-11-21-motion-steals-w4.md` | Word-level subtitles and small-size poster read P8; cue variants, `--no-music`, the beat audit if W0 says so P12; logo and progress overlays P10 | W2 (the narration field), W0 (audio offset) | Audio items are on the manual list |
| W5 | `2026-11-21-motion-steals-w5.md` | Voice-skipping `--sheets-only` with stills in the plan page P9; the preview keeps its playhead P14; a reviewer agent proven on planted defects P7; the motion gate if W0 says so P13 | W1 (`references/reviewing.md`), W3 (the rule registry), W0 (motion defects) | The reviewer's pass bar is met on the fixtures |
| W6 | `2026-11-21-motion-steals-w6.md` | Per-glyph and per-line entrances, `cubic-bezier()` and `steps()` P15; look comparison sheet and local reference measure P16; bounce and visible duration in `--list moves` P19 | W3 (slices, for the comparison sheet) | The comparison sheet was viewed |
| Alongside | this file, "make-explainer, alongside any wave" | A review step that cites screenshots; a section-sameness lint finding | nothing | make-explainer's own tests green |
| Final | this file, "Final phase" | Rebuild the eight version 2 films, recheck the plates, version, changelog, Revision, README, USAGE, full gate, pull request | every wave | Every rebuilt film's sheets were opened |

W3 to W6 are written by another planner at the file names above.

## The gate every wave passes

In this order, at the end of each wave, before its commits are pushed:

1. **Tests green locally, for the areas the wave touched:** `node P/bin/sync-shared.mjs --check`; `node --test "P/shared/test/*.test.mjs"`; `node --test "BT/*.test.mjs"` (needs `npm --prefix MM ci` once); `python3 -m pytest R/tests/pytest`; the changed skill's suite, serially when it holds browser tests: `node --test --test-concurrency=1 "MM/test/**/*.test.mjs"` **[BROWSER]**, started in the background.
2. **A fresh-context review** by the reviewer tier (Opus at medium), report only, never writing session logs or project docs. Its prompt gives the diff's path and `git diff --stat` (read per file past 1,000 lines), the wave plan's Review Focus, and this sentence verbatim:

   > Report every issue you find, including ones you are uncertain about or consider low-severity. Do not filter for importance or confidence at this stage — a separate verification step will do that. Your goal here is coverage: it is better to surface a finding that later gets filtered out than to silently drop a real bug. For each finding, include your confidence level and an estimated severity so a downstream filter can rank them.

   A wave that touches the file system, user input or an external tool's arguments (W1's ffmpeg filters, W3's locate script, W5's preview) names the security lens in that prompt.
3. **The controller applies the gate:** CRITICAL and HIGH block the push and are fixed first, each code fix with a regression test that failed first; MEDIUM is fixed or deferred as a `fix(wN):` follow-up commit; LOW is optional.
4. **Push** (`git push -u origin feat/motion-steals` the first time). The pull request is opened as a draft after W1's push, so CI runs on every later push.
5. **Update the Status table** above, in the wave's last commit.

## W0 result decisions

Each threshold is written here before W0 runs. W0 Task 9 fills in "Measured" and "Decided", and nothing is judged after the fact.

| Measurement (W0 task) | Threshold | If met | If not | Measured | Decided |
|---|---|---|---|---|---|
| Colour tags (1) | Any gallery film, or either fixed render, not `bt709` on all three fields | W1 Task 6 (P2) is a visible fix today; the final rebuild is recorded as fixing those files | P2 still ships (the spec decided it); its note says "robustness only" | 0 of 33 files tag bt709; the 8 v2 gallery films and the fast render are `bt470bg`/tv, the rest untagged | Met: W1 Task 6 is a visible fix; the final rebuild fixes the 8 v2 films; the 23 v1 gallery films stay untagged, because the plan leaves the v1 films alone |
| Frame time split (2) | The capture stage takes 25% or more of the render's wall time in fast mode | The capture spike's result is acted on | No capture change, whatever the spike says: there is too little to win | fast: capture 55.6% of 74.2 s wall (draw 42.6%, encode 1.4%) | Met: a winning capture arm would be acted on |
| Capture spike (3) | An arm's median is 0.80 or less of today's, and its worst `maxDiff` is no more than today's plus 1 level | The deferred item "a raw capture path" is promoted: see the note under this table | Fast and exact capture stay as they are | interleaved, 3 rounds (s,c,e / c,e,s / e,s,c), each arm in a fresh session: medians screenshot 81.05 s, cdp 75.75 s (0.935), evaluate 65.47 s (0.808 of screenshot; per round 0.776, 0.790, 0.829); worst maxDiff 75 in all arms (the first, sequential run read cdp 1.126, evaluate 0.854: superseded, drift) | Not met: no arm wins (evaluate misses 0.80 by 0.008, a near miss); capture stays as it is; "a raw capture path" stays deferred |
| Audio offset (4) | **[R2-3]** The nine offsets agree within 5 ms, and the median offset, decoded as a player decodes, is above 20 ms in magnitude | W4 builds the beat audit (P12) | W4 ships cue variants and `--no-music` only; the audit is dropped and the number recorded; **[R2-3]** when the onsets disagree, the audit is not built and the result reads 'not measured' | median 0.042 ms as a player decodes (raw 21.375 ms = 1024 samples of AAC priming plus the detector's 2-sample bias); spread 4.4e-13 ms; 9 of 9 onsets | Not met: W4 Task 4b (beat audit) is not built; the number is recorded |
| Motion defects (5) | One viewed defect or more, after the intended cases are set aside | W5 builds the motion gate (P13), reading intent from look data | The gate is dropped; the counts are recorded | pop: 9 pop-in findings in 2 events, both punch-cut arrivals, both viewed (0 defects); desk: 0 findings; marker: 135 jump findings in 9 hand-step events, 5 viewed (0 defects), 4 not viewed; 0 defects in 7 events viewed | Not met: W5 Task 6 (motion gate) is not built |
| **[R2-2]** Pixel pass (5) | One viewed defect or more: a blank or foreign frame the film did not ask for, seen on a file today's code rendered | A render bug: fixed with a failing test before W1 starts, as a held-frame failure would be. It does not switch the motion gate on (P13 reads the scene graph and could not see it) | Recorded. W1's output check (R2-1) keeps `BLANK_STD = 1.5` when every film's `maxStd` is 15 or more; if one is lower, the controller sets the number from this table before W1 Task 7 | 0 defects in 11 viewed events; lowest maxStd 47.21 (showreel-pro), cosmos 51.67 | Not met; R2-1 keeps `BLANK_STD = 1.5` (every maxStd is 15 or more) |
| Slam strip (6) | Separate copies read as a strobe | "In-shot motion blur" (P20) stays deferred with this strip as its trigger met; the owner is told | It stays deferred, trigger not met | punch cut on showreel-viral shot `spec`: largest gap 35 px, smear present; `slam` is used by no kind | Not met: P20 stays deferred, trigger not met |
| Held frames (7) | The test passes, and fails with the grain term removed | Held-frame reuse stays trusted | A failure on today's code is a render bug: fixed, with the test, before W1 starts | 5 of 5 pass; fails at frame 3 with the grain term removed; jump-back fails at frame 0 on a page that cannot seek back | Met: held-frame reuse stays trusted (1914642) |
| Half-size draft (8) | The validator accepts a root `size` | Recorded under Deferred as "half-size draft for slices", with no schema change needed (review fix: W3 plans no draft) | Recorded under Deferred as needing a schema change | rejected: `ROOT_SCHEMA` has no `size`, `additionalProperties: false` (`spec.mjs:48-76`) | Recorded under Deferred as needing a schema change |
| Reading-time scope (8) | none: a read | Recorded under Deferred as the scope of a later reading-time rule (review fix: W3 plans no reading-time rule) | n/a (a read, no threshold) | hold shots, narrated shots whose drawn text exceeds the say, captions | Recorded under Deferred as the scope of a later reading-time rule |
| Text phase sweep (8) | Ink spread above 2% of its mean | Listed under Deferred as "text shimmer under a slow drift", with the number | Nothing | spread 0.229% of the mean | Not met: nothing deferred |
| Gradient banding (8) | Steps visible in either frame | Listed under Deferred as "dither before the encode", with the frame | Nothing | no steps visible in banding-desk.png or banding-keynote.png (by eye; a 10x stretch of keynote shows faint one-level rings) | Not met: nothing deferred |

**If a capture arm wins** (orchestrator's call, design section 6): the change lands before the final phase so the gallery is rebuilt once. It is not pre-planned here because it is conditional. The controller then commissions a short plan, `2026-11-21-motion-steals-capture.md`, scoped to `MM/scripts/v2/render.mjs` (`shootFrame`, added in W1 Task 7, is the one place a frame is grabbed) and its tests, with this acceptance: W1's `color-browser.test.mjs` and W0's `held-frames-browser.test.mjs` pass unchanged, every browser suite passes, the fixed film's size is within 5% of W1's, and the fixed film renders at the measured ratio or better.

### W0 results

Measured 2026-11-22 on this Mac (ffmpeg 8.1.1, Playwright 1.64.0). The full table, with every command, is `R/.scratch/motion-steals-w0/results/W0-RESULTS.md` (gitignored; the pull request body carries it). The Measured and Decided columns above hold the summary; this table repeats it in short.

| Measurement | Result | Decision |
|---|---|---|
| Colour tags | 0 of 33 files tag bt709; the 8 v2 gallery films and the fast render are `bt470bg`/tv, the rest untagged | Met: W1 Task 6 is a visible fix (8 v2 films; the 23 v1 films stay untagged) |
| Frame time split | fast: capture 55.6% of 74.2 s wall (draw 42.6%, encode 1.4%); exact: capture 88.0% of 283.9 s | Met: a winning capture arm would be acted on |
| Capture spike, interleaved | cdp 0.935, evaluate 0.808 of screenshot (per round 0.776, 0.790, 0.829); worst maxDiff 75 in all arms | Not met (0.808 against 0.80); capture stays; raw capture path stays deferred |
| Audio offset | 0.042 ms as a player decodes (raw 21.375 ms); spread 4.4e-13 ms; 9 of 9 onsets | Not met: W4 Task 4b (beat audit) is not built |
| Motion defects | pop 9 pop-in findings in 2 events; desk 0; marker 135 jump findings in 9 events; 0 defects in 7 events viewed | Not met: W5 Task 6 (motion gate) is not built |
| Pixel pass | 0 defects in 11 viewed events; lowest maxStd 47.21 | Not met; `BLANK_STD = 1.5` kept |
| Slam strip | punch cut, largest gap 35 px, smear present; `slam` is used by no kind | Not met: P20 stays deferred, trigger untested for `slam` |
| Held frames | 5 of 5 pass; fails at frame 3 without the grain term; jump-back fails at frame 0 | Met: held-frame reuse stays trusted |
| Half-size draft | validator rejects a root `size` | Deferred: needs a schema change |
| Reading-time scope | a read: hold shots, narrated shots whose text exceeds the say, captions | Recorded under Deferred |
| Text phase sweep | spread 0.229% of the mean (limit 2%) | Not met: nothing deferred |
| Gradient banding | no steps visible in either frame | Not met: nothing deferred |

- The capture spike's first run (arms one after another) read cdp 1.126 and evaluate 0.854; the gate review found drift, so the arms were rerun interleaved and that run replaces it. The evaluate arm was timed as written (a seek and a grab as two `page.evaluate` calls, the picture back as base64), and no encoder ran beside it. A combined seek-and-grab was not timed. The 0.808 is a near miss: a ratio of medians over 3 rounds, with 0.776 to 0.829 between rounds.

- The fixed film was a silent copy of `X/kinds-desk.json` (`S0/film/kinds-desk-silent.json`, same 1027 frames), because the optional voice package is not installed; the copy dropped the `voice`, `music` and `sound` keys. It has no held frames, so its timings say nothing about held-frame savings.
- No kind uses the `slam` move (`moveOf` is called only with 'pop' and 'settle'); the slam strip judged a punch cut, so P20's trigger is untested. Owner: keep or drop `slam`.
- Switched off by these results: W4 Task 4b (beat audit) and W5 Task 6 (motion gate). W1 Task 6 (BT.709) is a visible fix to the 8 v2 gallery films.

## make-explainer, alongside any wave

Two small tasks, independent of every wave. They ship on this branch as their own commits and share the branch's one version bump: a second pull request under `plugins/` would need a second bump and changelog heading, which the one-bump rule forbids (the design calls this "one small PR"; see Self-review notes).

### Task E1: The review cites its screenshots

**Files:**
- Modify: `ME/SKILL.md:54` (step 5, "Look at it"), `:55` (step 6, the report)
- Modify: `BT/skill-budget.test.mjs` (a test after `:109`)
- Read: `ME/scripts/lib/shots.mjs:7-17` (`check.mjs --shots` already runs `shared/shot.mjs` at `390,1280`, light and dark), `BT/skill-budget.test.mjs:24-29` (make-explainer's budget: 22,700 bytes and 150 lines; it measures 22,175 bytes and 142 lines)

**Interfaces:**
- Produces: two sentences in `ME/SKILL.md`, at most 300 bytes together and no new line. In step 5, after "view every PNG before you report, and fix what you see": "For every defect you fix or report, name the PNG it shows in (the path `check.mjs` printed): a defect described from memory, with no screenshot named, is not reported as seen." In step 6, the report also lists "the screenshots viewed".

- [ ] **Step 1: Write the failing test.**

```js
test('make-explainer/SKILL.md: a defect is reported with the screenshot it was seen in, at 390 and 1280', () => {
  const md = read('make-explainer');
  const step = md.split('\n').find((l) => /check\.mjs[^\n]*--shots/.test(l));
  assert.match(step, /390 and 1280/);
  assert.match(step, /name the PNG it shows in/);
  assert.match(md, /the screenshots viewed/);
});
```

- [ ] **Step 2: RED.** `node --test "BT/skill-budget.test.mjs"`. Expected: FAIL on `name the PNG it shows in`.
- [ ] **Step 3: Add the two sentences.**
- [ ] **Step 4: GREEN.** The same command (the byte and line budgets hold: at most 22,700 and 150), then `node --test "BT/*.test.mjs"`.
- [ ] **Step 5: Commit (controller).** `docs(explainer): a page review names the screenshot each defect was seen in`.

### Task E2: A section-sameness lint finding

**Files:**
- Modify: `ME/scripts/lib/lint.mjs` (a new export after `:113`), `ME/scripts/lib/spec.mjs:95-102` (`lintWarnings`, where the page's lint warnings are gathered; `:155` joins them into `validateSpec`'s warnings)
- Modify: `ME/test/lint.test.mjs`
- Read: `ME/scripts/lib/semantic.mjs:82` (`PLAN_ITEM_TYPES`: `decision`, `approval`, `question`, which come in runs by design), `G/explainer-page/explainer.json:315-350` (five `motion` sections in a row: a gallery spec this will warn on)

**Interfaces:**
- Produces: `SAMENESS_RUN = 3` and `sectionSamenessWarnings(sections) -> { path, message }[]` in `lint.mjs`: for each run of `SAMENESS_RUN` or more consecutive sections of one `type` (a run of `decision`, `approval` or `question` sections is left alone), one warning at the run's third section: path `sections[<its index>]`, message `${n} ${type} sections in a row (sections ${first + 1} to ${last + 1}); a page of one repeated block reads as a list: merge some, or put a different kind of section between them`. `lintWarnings(spec)` appends it. It is a warning: it never blocks a build, and `--strict` does not turn it into an error.

- [ ] **Step 1: Write the failing tests.**

```js
const s = (type) => ({ type, title: 'T', text: 'x' });
test('three or more sections of one type in a row warn once, at the third, naming the run', () => {
  assert.deepEqual(sectionSamenessWarnings([s('text'), s('text'), s('text'), s('text'), s('cards')]),
    [{ path: 'sections[2]', message: '4 text sections in a row (sections 1 to 4); a page of one repeated block reads as a list: merge some, or put a different kind of section between them' }]);
  assert.deepEqual(sectionSamenessWarnings([s('text'), s('text'), s('cards'), s('text'), s('text')]), []);
  assert.deepEqual(sectionSamenessWarnings([s('question'), s('question'), s('question')]), []);
  assert.deepEqual(sectionSamenessWarnings([s('text'), s('text'), s('text'), s('table'), s('motion'), s('motion'), s('motion')]).map((w) => w.path), ['sections[2]', 'sections[6]']);
  assert.deepEqual(sectionSamenessWarnings([]), []);
  assert.equal(SAMENESS_RUN, 3);
});
test('validate reports it as a warning only, and no bundled example reads as one repeated block', async () => {
  const r = await validateSpec({ title: 'T', sections: [{ type: 'text', title: 'One claim', text: 'a' }, { type: 'text', title: 'Two claims', text: 'b' }, { type: 'text', title: 'Three claims', text: 'c' }] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.warnings.filter((w) => /sections in a row/.test(w.message)).map((w) => w.path), ['sections[2]']);
  for (const name of fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.explainer.json'))) {
    const spec = JSON.parse(fs.readFileSync(path.join(EXAMPLES, name), 'utf8'));
    assert.deepEqual(sectionSamenessWarnings(spec.sections), [], name);
  }
});
```

(`EXAMPLES` is `ME/references/examples`.)

- [ ] **Step 2: RED.** `node --test "ME/test/lint.test.mjs"`. Expected: FAIL, `sectionSamenessWarnings` is not exported.
- [ ] **Step 3: Implement.** If a bundled example trips the second test, the example is the thing to fix (it is teaching material): reorder it or merge two sections, and say which in the commit.
- [ ] **Step 4: GREEN.** The same command; then the explainer suite, serially: `node --test --test-concurrency=1 "ME/test/**/*.test.mjs"` **[BROWSER]** (expected: PASS; a golden page does not change, since a warning writes nothing into a page). The scaffold's presets (`ME/scripts/lib/presets.mjs`) were searched for their section types, not read in full: the search shows no three of one type in a row, and the per-area titles ("Repository root", "Other areas", `:13-14`) are groups inside one checklist section (`:185-186`), not sections. If `scaffold.test.mjs`, `plan-preset.test.mjs` or a `validate` test still shows the new warning on scaffolded output, reorder the preset; do not exempt it.
- [ ] **Step 5: Record, do not fix:** `node ME/scripts/validate.mjs G/explainer-page/explainer.json` now prints the warning for its five film sections. The page is a showcase of films and is not rebuilt; the line goes in the report.
- [ ] **Step 6: Commit (controller).** `feat(explainer): warn when three or more sections of one type run in a row`.

## Deferred, each with the trigger that reopens it

| Item | Why not now | Trigger |
|---|---|---|
| In-shot motion blur (P20); starting idea: one sample at rest, several when fast (an idea from beast's speed gate, no code) **[R2-19, R2-29]** two more starting ideas, no code: a delayed copy of a node's state as a trail (video-shotcraft); a forward-open shutter averaged in 16-bit inside the encode (motionmaxxing). | A redesign of the accumulator, and nobody has seen the strobing it would fix | W0's slam strip shows a strobe, and the owner asks |
| A raw capture path (P17, second half) | No source gives a measured win | W0's capture spike wins (see the note under the decision table) |
| Layered depth and bleed crops (`compose.md` W7, W8) | Every look's data, the safe-area maths and every sheet change | `dead-space` and `scale-contrast` have run on real films for one release and still fire on more than a third of a look's shots |
| A chart beside its claim on a wide frame (`compose.md` W3, replacement) | High risk to chart tests; the gain is inferred | `dead-space` keeps firing on chart shots after W2 |
| A full-frame impact budget for beat-synced films (P3, later rule) | Thresholds are another project's | W3's `cut-variety` and `sameness` have been tuned on the gallery |
| An in-place preview rebuild and a `--preview --context --json` query (P14, remainder) | They need a channel to the running preview, and the server is GET and HEAD only | The owner accepts a new route after a security review |
| Look re-tuning by bounce (P19, remainder) | Notation only until a look is re-tuned; goldens would move | The owner asks |
| User font files, and a Lottie kind | Both weaken "bundled faces, no new dependency" (owner default: no) | The owner reverses the default |
| CSS spring export for explainer pages | Look motion data lives in make-motion; no field binds a page to a film look | Ownership of look motion data is decided |
| The composition measure as a gallery regression aid (`compose.md` W10) | One rebuild does not need it | A second gallery rebuild |
| Text shimmer under a slow drift; dither before the encode | Measurements, not features | W0 Task 8 finds a spread above 2%, or visible steps |

### Round 2 (R2), deferred

Make-motion rows from `.scratch/research-2026-11-21/round2/DECISIONS.md` section 4. The beast rows (R2-9b, R2-23, R2-34, R2-35) live in the beast addendum and its `docs/decisions-pending.md`.

| Item | Why not now | Trigger |
|---|---|---|
| **[R2-15]** Exact `regions` boxes read from a live local page by CSS selector (sc-dom-boxes) | `shot.mjs` is a review tool (full-page captures, cut at 16,000 px); a `screen` or `clipping` picture needs a viewport or an element crop, and it is the only item that would add a CLI surface to code copied into every skill | After W3's locate helper ships, a film is built from a screenshot of a local page and the helper's stated tolerance (1.25 cells) is too loose for an element. Then design the capture and the boxes together |
| **[R2-16]** A separate, larger floor for spoken captions (sc-text-floor-roles) | No caption has been seen unreadable | W4 Task 2's thumbnail-size read, or the owner on a phone, shows captions that cannot be read |
| **[R2-17]** A recorded "seen, intended" for a creative finding (sc-waiver) | No finding has been fixed against the author's intent yet | W3 has shipped and a capped creative finding is "fixed" twice against the author's intent on one film |
| **[R2-18]** Place a cue by its loudest instant, not its start (sc-cue-peak-lag) | No late cue has been heard | The owner's listen on the W4 manual list hears a whoosh or riser land late against its picture |
| **[R2-19]** Follow-through as a delayed copy of a node's state (sc-lagged-trail) | Recorded as a second starting idea on the P20 row above; no code | Same as P20: W0's slam strip reads as a strobe and the owner asks |
| **[R2-20]** Freeze a clip mid-shot, annotate, resume (sc-clip-freeze) | No brief needs it | A brief needs "stop the recording and circle this" |
| **[R2-21]** Classify onsets by band, keep the strongest low hits (sc-beat-band-hits) | No viral film on recorded music has shown the need | A viral film on recorded music is made and its accents are visibly off the drums |
| **[R2-22]** A big title shrinks and parks as the section label (sc-title-demote) | It belongs with W4's overlays (P10), which are not built; not for beast, whose section card is the scaffold's | W4's overlays (P10) have shipped; revisit as one overlay behaviour |
| **[R2-24]** Hook formulas grouped by what material the brief supplies (R-03) | No repeated hook shape has been seen | Agents are seen repeating one hook shape on vertical briefs; then write a short list of our own, never the vendor's 40 |
| **[R2-25]** A brand file read before every film (R-04) | Its fields are not known until W4's overlays and W6's look intake exist, and it needs the owner's say on where it lives | W4's overlays (P10) and W6's look intake (P16) have shipped, so the fields are known |
| **[R2-26]** A blind two-way look pick over three rounds (R-05) | W6's comparison sheet is not in use yet | W6's comparison sheet (P16) is in use and the owner finds a many-cell sheet hard to answer |
| **[R2-27]** A post caption written with the short (R-06) | No one has asked | A user asks for it; then one prose line in `types/vertical.md` |
| **[R2-28]** Judge cut-on-hit sync against chance (mm-beat-audit-baseline) | W4 Task 4b prints an offset per beat and a median; it claims no share of cuts on hits, so there is no rate to compare with chance | W4 Task 4b is built and is later extended to print a share of cuts that land on hits |
| **[R2-29]** Forward-open shutter and 16-bit averaging for in-shot blur (mm-shutter-notes) | Recorded as notes on the P20 row above; no code | Same as P20 |
| **[R2-30]** Flag a final shot over a quarter of the film (mm-end-cta-share) | No film has shown the need | The final phase's inventory (F2 Step 3) shows an end shot over a quarter of a film's length |
| **[R2-31]** Fewer, hand-picked sound cues (mm-cue-density) | No listen has heard a metronome | The owner's listen on the W4 manual list hears a metronome |
| **[R2-32]** On-screen words land up to two frames before the spoken word (mm-text-lead) | No late highlight has been seen | The owner sees highlights land late on a played film |
| **[R2-33]** A blind A/B page for two versions of a film (mm-blind-ab) | No pending decision needs it | An owner decision that measurement cannot settle is pending (a narration default, a cue default) |

**[R2-9a]** Also deferred, inside an accepted tag: the finding form of the narration-tell bullet (a `copy-tell` rule in `--outline`). It would be a 39th rule id resting on one rater's list, and user narrations will contain a legitimate "not just". It reopens if W5's reviewer proof or the gallery's narrations show the patterns surviving the prose line.

The beast_explainer track (design section 7) is not in this plan set. It ships in beast's own repository as an addendum to its Phase G plan, under that repository's conventions.

## Final phase (after W6)

### Task F1: Inventory, and the date

**Files:**
- Create: `SF/inventory.md`
- Read: `MM/SKILL.md:115` (the finished films under `X`), `R/docs/gallery.html:57-63` (the register's seven films), `P/CHANGELOG.md:7-9` (`## [Unreleased]`, then `## [2.2.0] - 2026-11-21`)

**Interfaces:**
- Produces: the source of each gallery film, confirmed, and one `SOURCE_DATE_EPOCH` value used by every command after it.

The gallery's eight `film.json` files are copies; their pictures resolve only from `X`:

| Gallery folder under `G` | Source under `X` |
|---|---|
| `showreel/pro` | `showreel-pro.json` |
| `showreel/viral` | `showreel-viral.json` |
| `showreel/whats-new` | `whats-new.json` |
| `looks/cosmos` | `look-cosmos.json` |
| `looks/ledger` | `gate-ledger.json` |
| `looks/poster` | `look-poster.json` |
| `looks/keynote` | `gate-keynote.json` |
| `looks/marker` | `gate-marker.json` |

- [ ] **Step 1: Confirm each pair.** `cmp G/<folder>/film.json X/<source>`, eight calls. Expected: no output. A pair that differs is written into `inventory.md` with which file is newer (`git log -1 --format=%cI -- <path>` for each), and that film waits for the controller's word on which is the source.
- [ ] **Step 2: Fix the date.** `SOURCE_DATE_EPOCH` is 00:00 UTC of the date in the release's changelog heading: 1794960000 for 2026-11-18, plus 86,400 for each day after it (2026-11-21 is 1795219200). Write the value in `inventory.md`; it goes in the pull request body.
- [ ] **Step 3: List what else shows these films:** `R/docs/media/hero-loop.mp4` and `hero-poster.jpg` (the pro showreel, `R/docs/index.html:81`), `motion-loop.mp4` and `motion-poster.jpg` (the poster look, `:152`), `R/docs/media/thumbs/` (seven files, `R/docs/gallery.html:57-63`), each film's `poster.jpg`, and the durations printed on both pages. `showreel/whats-new` is on disk and not among the register's seven: it is rebuilt, and whether it gets a register item is the owner's call (noted in the report).

### Task F1b: Refresh the showreels with every feature (owner request, 2026-11-22)

The owner asked that the make-motion showreel show every new feature from W1 to W6 and keep what it shows today. This task rewrites the two showreel sources before F2 rebuilds them, so the gallery is still rebuilt once.

**Files:**
- Modify: `X/showreel-pro.json`, `X/showreel-viral.json`, their `X/showreel-*.review.md` notes, and `X/showreel-assets/` only if a new feature needs a local picture (no network, no generated media)
- Read first: both sources, `MM/references/schema.md`, `--list kinds`, `--list cuts`, `--list moves`, `--list looks`, and the W1 to W6 commit list (`git log --oneline origin/main..HEAD`)

- [ ] **Step 1: The feature inventory.** Write `SF/showreel-features.md`, a table with one row per feature. Columns: feature, wave or "existing", shown today in pro or viral (yes or no), and the shot that will show it.
  - Existing features: every kind, each cut the look allows, word anchors, the voice, the music bed and cues, captions.
  - New features, each only if its wave shipped: composed frames and the cosmos number (W2); a short statement (W2); J and L narration across a cut (W2); a cut whose outgoing shot keeps moving (W2); `at` on iris and zoom, and the colour flood (W2); word-level subtitles in the vertical film (W4); cue variants and the logo and progress overlays (W4); per-glyph and per-line entrances, `cubic-bezier()` and `steps()` easing (W6).
  - Features with no picture (findings, slices, `--estimated`, the locate helper, the reviewer, the comparison sheet, the BT.709 tags, the MP4 check) are listed as "not filmable". They are shown in the release notes, not in a reel.
- [ ] **Step 2: Rewrite the two sources.**
  - `showreel-pro.json` (16:9) carries the widescreen features. `showreel-viral.json` (9:16) carries the vertical features (word subtitles, the hook shape from `references/types/vertical.md`) and repeats a feature only where vertical shows it differently.
  - Keep every existing feature that still has a row with "yes" in Step 1. Add each new filmable feature once.
  - Keep each film within its mode's length guidance: `pro` stays at most 20% longer than today, `viral` at most 60 s. When the list does not fit, merge features into one shot (a J cut into a moving outgoing shot) instead of adding shots.
  - The narration describes what is on screen, per `references/story.md`.
- [ ] **Step 3: Check, no browser.** `node MM/scripts/make.mjs X/showreel-pro.json --outline --json` and the same for viral. Expected: exit 0, no `mechanical` finding, and every Step 1 row named by its shot. Then run the tests that read the example films: `node --test "P/bin/test/make-motion-docs.test.mjs"` and `node --test --test-concurrency=1 "MM/test/v2/cuts-films.test.mjs"` **[BROWSER]** if it renders. Expected: PASS. A test that pins a showreel's shot list is updated in this commit, and the commit body names it.
- [ ] **Step 4: Draft render and look. [BROWSER]** One film at a time, after `pgrep`: `node MM/scripts/make.mjs X/showreel-pro.json --json --out SF/draft/showreel-pro.mp4`, then the same for viral. Open every sheet PNG. Mark each Step 1 row "seen" or "not seen". A feature not seen is fixed in the source, never marked seen. Read each review note's findings and update the `.review.md` notes.
- [ ] **Step 5: Commit (controller).** `docs(release): showreels show every W1 to W6 feature`. The body lists the features added and any feature that does not fit, with the reason. F2 then rebuilds these two films with the others. F3's hero loop and poster come from the new pro reel, and F4 rechecks the home page's showreel plate, its spec excerpt and its detail tags against the new source.

### Task F2: Rebuild the eight films, one at a time

- [ ] **Step 1: The doctor, per film.** `node MM/scripts/doctor.mjs --json --for X/<source>`. A film with a `voice` needs the voice package and its model. If the doctor reports either missing, stop and ask the owner once (it is a download); do not install unasked.
- [ ] **Step 2: Build. [BROWSER]** For each film in turn, after `pgrep -fl chrome-headless-shell` prints nothing: `env SOURCE_DATE_EPOCH=<value> node MM/scripts/make.mjs X/<source> --json --out SF/<name>/video.mp4`. Write the printed report to `SF/<name>/report.json`. Expected: exit 0, `ok: true`, no `mechanical` finding. A `mechanical` finding means a wave changed what a shipped film may say: stop, and fix the wave, not the film. `creative` findings are listed per film in `inventory.md`.
- [ ] **Step 3: Look.** Open every PNG under `SF/<name>/video.sheets/`. For each film write, in `inventory.md`, what changed against the film now on the site and which commit explains it (the colour conversion, the cosmos number, a short statement, a cut window whose outgoing shot now moves, a later wave's change). A change no commit explains is a bug: stop. A sheet not opened is written as "not viewed".
- [ ] **Step 4: Probe.** `ffprobe -v error -select_streams v:0 -show_entries stream=color_space,color_primaries,color_transfer,color_range -of json SF/<name>/video.mp4`. Expected: `bt709`, `bt709`, `bt709`, `tv`.
- [ ] **Step 5: Copy into the gallery,** one `cp` per call: `SF/<name>/video.mp4` to `G/<folder>/video.mp4`, and `X/<source>` to `G/<folder>/film.json` when Step 1 of F1 showed the example had moved on.
- [ ] **Step 6: HTML pages.** No wave in this plan set changes what a built HTML gallery page looks like (E2 adds a warning, not markup). If a later wave did, that page is rebuilt from its own spec with its skill's builder under the same `SOURCE_DATE_EPOCH`, then `node <skill>/scripts/check.mjs <page> --shots SF/shots/<page>` **[BROWSER]**, one page at a time, and every PNG it prints is opened.
- [ ] **Step 7: Commit (controller).** `docs(release): rebuild the eight version 2 gallery films`, with the `SOURCE_DATE_EPOCH` value and the per-film changes in the body.

### Task F3: Posters, loops and thumbnails

- [ ] **Step 1: Posters. [BROWSER]** For each film, open the poster now on the site and find its instant in the new sheets; then `env SOURCE_DATE_EPOCH=<value> node MM/scripts/make.mjs X/<source> --poster <seconds> --poster-out G/<folder>/poster.jpg`, one at a time; open each. Record the seconds per film.
- [ ] **Step 2: The two plate loops.** No command for them is recorded in the repository (searched `docs/superpowers`). Read each existing loop with `ffprobe -v error -show_entries format=duration:stream=width,height,avg_frame_rate -of json R/docs/media/hero-loop.mp4` (and `motion-loop.mp4`), then cut the same span of the new film at the same size and rate with one ffmpeg command each, without sound (`-an`). Each file stays under 2 MB (`ls -l`); if it does not, raise `-crf` by 2 and say so. `hero-poster.jpg` and `motion-poster.jpg` are the loops' first frames (`ffmpeg -y -i <loop> -frames:v 1 <poster>`). Record the four commands for the pull request body.
- [ ] **Step 3: Thumbnails.** For each of the seven register films, `ffmpeg -y -i G/<folder>/poster.jpg -vf scale=640:-2 R/docs/media/thumbs/<name>.jpg` (the vertical short at `scale=360:-2`), keeping each existing file name.
- [ ] **Step 4: Commit (controller).** `docs(release): posters, plate loops and thumbnails from the rebuilt films`.

### Task F4: The home page's plates, and the printed durations

- [ ] **Step 1: The tests first.** `python3 -m pytest R/tests/pytest`. It checks each spec's `x.y KB` label against the file, that spec lines and plate tags pair up, every local link, and the Revision. Fix what it names.
- [ ] **Step 2: What no test checks.** The detail tags' positions, the spec excerpts' wording against the copied `film.json`, and every duration printed on `R/docs/index.html` (`:81`, `:152`) and `R/docs/gallery.html` (`:57-63`) against each report's `frames / fps`.
- [ ] **Step 3: Look at both pages. [BROWSER]** `node P/shared/shot.mjs R/docs/index.html --widths 390,1280 --out SF/site` and the same for `gallery.html`; open every PNG. Each motion plate's tags must point at what they name in the new picture; move a tag's coordinates in `index.html` where the picture moved.
- [ ] **Step 4: Commit (controller).** `docs(release): recheck the home page plates against the rebuilt films`.

### Task F5: Version, notes and the documents

**Files:**
- Modify: `P/.claude-plugin/plugin.json:4` (`"version": "2.2.0"`), `P/CHANGELOG.md` (a new heading under `## [Unreleased]`), `R/docs/index.html:115` (`<dd>2.2.0</dd>`), `P/README.md`, `P/USAGE.md`, `MM/README.md`

- [ ] **Step 1: Bump once,** to 2.3.0 (new features, and three changes a user will see without asking: converted and tagged colour, two new creative findings, layer and shader cuts whose outgoing shot moves).
- [ ] **Step 2: The changelog heading,** `## [2.3.0] - <date>`, as release notes for a user: behaviour changes first (colour; the new findings and that they never fail a run; the moving outgoing shot; **[R2-1]** a render fails, and keeps no file, when the finished file is short of frames or its picture is blank), then what is new by wave, then what was measured in W0 and dropped. One heading for the whole branch.
- [ ] **Step 3: The cover Revision** to 2.3.0.
- [ ] **Step 4: README and USAGE:** every new field, flag, cut, finding and reference file from the seven wave plans, each checked against the code it names (a command or flag is cited only after it is confirmed to exist). `MM/README.md`'s Looks table stays equal to `SKILL.md`'s (`BT/make-motion-docs.test.mjs:158-163`).
- [ ] **Step 5: Validate the manifests.** `claude plugin validate R` and `claude plugin validate P`.
- [ ] **Step 6: Commit (controller).** `chore(release): 2.3.0`.

### Task F6: The full local gate

- [ ] `node P/bin/sync-shared.mjs --check`
- [ ] `node --test "P/shared/test/*.test.mjs"`
- [ ] `node --test "BT/*.test.mjs"`
- [ ] `python3 -m pytest R/tests/pytest`
- [ ] `node --test --test-concurrency=1 "MM/test/**/*.test.mjs"` **[BROWSER]**, in the background
- [ ] `node --test --test-concurrency=1 "ME/test/**/*.test.mjs"` **[BROWSER]**, after the one above has ended
- [ ] `wc -c MM/SKILL.md` (at most 20,900) and `git log --format=%B origin/main..HEAD` read for any `Claude-Session` line or model-named trailer (none)

Expected: all green. Each count in the report names its command.

### Task F7: Final review, the pull request, and the hand-over

- [ ] **Step 1: The final review** (reviewer tier, Opus at `high`, report only), over `git diff origin/main...HEAD` after `git fetch origin`, with this file's Review Focus, the security lens named (ffmpeg arguments, the file system, the preview), and the reviewer sentence from "The gate every wave passes", verbatim. CRITICAL and HIGH are fixed first.
- [ ] **Step 2: The pull request body:** the summary by wave; the W0 results table; the `SOURCE_DATE_EPOCH` value; the poster seconds and the four loop commands; every golden or pinned assertion that changed, with its commit; what was not viewed; ahead and behind `origin/main`; a test plan. It ends with the Claude Code generation trailer.
- [ ] **Step 3: The branch test checklist.** Load the `branch-test-checklist` skill and generate the manual checklist from the items the waves set aside: three storylines read by a person (W1); one render checked on QuickTime, Safari and Chrome against its sheet (W1); a voiced film with a lead and a trail, listened to (W2); and each later wave's manual items. Write it under `R/.scratch/` unless the repository's convention says otherwise.
- [ ] **Step 4: CI and the hand-over.** `gh pr checks <N>` until green, then end the report with the one line the owner pastes: `gh pr merge <N> --squash --admin`. Do not merge. After the owner merges, `gh run list --workflow pages.yml --limit 3` until green, then fetch the live cover and read its Revision before saying it is deployed.
- [ ] **Step 5: Say what stays open:** the worktree, any background task, and the extras offered and not done (an explainer recap of the branch, a docs sweep, a release film).

## Self-review notes

- Spec coverage: section 6's seven waves are the wave index; "alongside any wave" is Tasks E1 and E2; "Deferred" is the deferred table; section 10 is the final phase (F1 to F7); section 3's "gallery rebuilt once, after every visual change" is F2; section 7 (beast) is one line, out of scope here by the design's own ruling.
- Where this file departs from the design's words: the design says the make-explainer work is "one small PR". Under the one-branch, one-bump rule it ships on this branch (see the note above E1). The owner should confirm.
- Decided here and worth the owner's eye: the release number 2.3.0; the 20 ms audio-offset threshold; the 0.80 capture win ratio; rebuilding `showreel/whats-new` though the register does not list it.
- Not verified by the planner: nothing in this file was run. The source map in F1 comes from `MM/SKILL.md:115` and the folder names; F1 Step 1 confirms it with `cmp`.

## Plan review fixes (2026-11-21)

A fresh Opus review (`.scratch/research-2026-11-21/plan-review.md`) found one HIGH and several MEDIUM issues. Fixed in these files before execution:

- HIGH: W1 Task 2 moved words that `MM/test/beats-limits.test.mjs` and `beats-regression.test.mjs` pin. Task 2 now edits both tests in the same commit and runs them.
- MEDIUM: W1's byte target was out of reach (measured about 19,750). The target is now 19,700, with two named fallback moves. W2's bound is 19,900; W3's two lines bring the worst case to about 20,300, under the 20,900 cap.
- MEDIUM: the W0 decision table pointed at a W3 draft and reading-time rule that W3 does not plan. Both rows now record into Deferred; W3 no longer depends on W0.
- MEDIUM: W5 wrote under a `story.md` heading that W1 renames. W5 now writes under "Three storylines" and adds no heading.
- MEDIUM: the W2 Task 6 message clamps `left` at 0, so its regex matches. W4 Task 3's detune test compares peak amplitude within 2%.
- LOW, fixed: W1's stall timer is cleared on settle; parallel `timing` is summed across pages; W3's SKILL.md line count and the list wording; W5's rule-count assertion; two index anchors.
- Credit lines (LOW): every wave's `THIRD_PARTY_NOTICES.md` credit also names the HyperFrames idea behind W5's board of stills (P9) and kept playhead (P14), W6's kinetic-type entrances (P15) and W1's named capture stage (P17).
- Owner rulings (2026-11-22): the showreels are rewritten to show every new feature and keep today's (final Task F1b, before the rebuild); make-explainer ships on this branch (accepted); W5's `--estimated` flag replaces the spec's `--sheets-only` wording (accepted); **[R2-1]** a short or blank finished MP4 fails the render and keeps no file (accepted, not a warning); execution is subagent-driven; no third research round.
- Left open, for the owner: the scope additions the review lists (`overlay-covers`, `hand-covered` rename, `--subtitle-words`, `cut-variety` in the full review, `--list cuts` fields); `cut-variety` reads `cutPalette` where the spec says the look's allowed cuts. Stubbed test steps in W3 to W6 state each assertion in a comment; the implementer writes them in full.
- The beast plan lives in beast's gitignored scratch: `/Users/abhijitbansal/projects/beast_explainer/.scratch/plans/2026-11-21-phase-g-addendum-research-steals.md`.

