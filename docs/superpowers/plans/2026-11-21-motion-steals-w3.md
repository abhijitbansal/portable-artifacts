# Motion Steals W3: Inspection Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A finding names its rule and carries the value that fixes it, two tells of a generated film are findings in `--outline`, one moment, one shot or one range of a film can be drawn and inspected without a whole-film run, and a script turns "the thing I see in this picture" into a `regions` box.

**Architecture:** Three independent units. (1) One frozen rule registry in `engine/review/rules.mjs` is the list every finding's `rule` must come from; a rules page and a source scan are held equal to it by one test, the report keeps `rule` and a new `suggest` object, and two spec-only rules run in `--outline`. (2) One film-time grammar (`scripts/v2/film-time.mjs`) feeds `--poster`, `--inspect`, `--shot` and `--range`; slices reuse the existing sheet plan and capture loop over a frame range, seeking by absolute frame, so a slice's frames are the full render's frames. (3) `scripts/locate.mjs` is a pure-Node two-pass picker with its own PNG writer and digit bitmap; nothing in it touches a browser or `drawtext`.

**Tech Stack:** Node 20+, `node:test`, Playwright Chromium for the two browser tests, ffmpeg only where named. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-11-21-motion-steals-design.md` section 6, W3. Evidence: `.scratch/research-2026-11-21/PROPOSAL.md` items 3, 4, 6 (P3, P4, P6).

Abbreviations: `P` = `plugins/portable-artifacts`, `MM` = `P/skills/make-motion`. Paths with no prefix are relative to `MM/`. In commands, `<MM>` and `<P>` stand for the literal absolute paths (the worktree guard refuses variables: write them out). Anchors were read on branch `feat/motion-steals` on 2026-11-21, before W0 to W2 landed; nothing was run. Where an earlier wave edits the same file (W1: `scripts/v2/render.mjs`, `SKILL.md`, the doc test; W2: `engine/review/frame.mjs`, `scripts/v2/review.mjs`, `engine/script/timing.mjs`, `engine/graph/film.mjs`, `engine/page/stage.mjs`), find the anchor by the function named beside it.

## Global Constraints

- `MM/SKILL.md` is 20,898 bytes against a 20,900-byte budget pinned in `plugins/portable-artifacts/bin/test/skill-budget.test.mjs`; slim, never raise the cap. W1 leaves it at 19,700 bytes or fewer and W2 adds at most 200. This wave adds two lines of at most 200 bytes in total (Task 1 and Task 4), naming the two new reference files (W1's router test fails for a reference file `SKILL.md` does not name); every flag and rule is documented in those files, not in `SKILL.md`.
- No new runtime dependency, no network use, no generative-video call from `make.mjs`.
- No new server route (the preview server is GET and HEAD only).
- One headless browser at a time (`pgrep -fl chrome-headless-shell` first; `--test-concurrency=1`). Steps marked **[browser]** are run one at a time by the executor.
- Goldens change only for an intended visual change, stated in the commit. This wave intends none.
- HyperFrames (Apache-2.0) and Rune (MIT) ideas are rewritten in our own code with a credit line in `THIRD_PARTY_NOTICES.md`; no file is ported. No code from beast_explainer.
- Every code fix and guardrail is shown failing first (RED), then passing.
- Commits: conventional, prefixed `feat(w3):` / `fix(w3):` / `test(w3):` / `docs(w3):`, staging named files only, ending with exactly one trailer line `Co-Authored-By: Claude <noreply@anthropic.com>` and no `Claude-Session` line (the `commit-trailers` CI job fails otherwise). Implementers do not commit (AGENTS.md); the controller runs each Commit step.
- All waves ship on one branch and one PR; one `plugin.json` bump, one `CHANGELOG.md` heading and the cover Revision happen once in the final phase, not per wave.
- A fresh-context review (reviewer tier) runs at the end of each wave before its commits are pushed. Implementers are executor tier (Sonnet, effort high); reviewers Opus at medium.
- Shell: one plain command per call, literal absolute paths, no `cd`, `&&`, pipes, `;`, variables, loops or heredocs; quote globs; never `rm`.
- `bin/test/make-motion-docs.test.mjs` pins the report keys (`:204-213`), the root fields (`:194-197`), the eight `--list` names (`:99-104`) and the files flags are read from (`knownFlags`, `:279-284`). This wave adds no `--list` name and no root field. After W1 that file also walks `references/` (`referenceDocs()`), checks a list of reference files (includes-only) and requires `SKILL.md` to name each (w1 plan, Task 1): a new reference file is added to that list and named in `SKILL.md` in the commit that creates it. Line numbers of that test are as read before W1; find the anchors by name after it.
- Credits go in the section W1 made in `THIRD_PARTY_NOTICES.md`, `## Ideas credited, no code ported` (one bullet per project; each wave appends the ideas it took). No table row whose first cell is a backticked name: `test/v2/cuts-notices.test.mjs:24` reads every such row as a shader.

## Review Focus

1. **A rule emitted in a shape the scan cannot see.** A finding built without one of the three scanned forms would ship unregistered. Task 1 Step 1 asserts every registered id is found by the scan, so the reverse gap shows as "registered, never emitted".
2. **A film too short to judge.** One to four shots have at most three seams: any cut is "more than two thirds". `MIN_SEAMS` guards it; tested in Task 3.
3. **A slice that starts on a held frame, inside a cut window, or mid grain phase.** The first frame of a range must be captured though the page calls it held, and the grain pattern depends on the absolute frame (`engine/page/stage.mjs:82`). Tested in Task 7.
4. **A `--poster` or `--inspect` reference that is both a shot id and a film-wide anchor** (a shot called `end`). The shot wins; tested in Task 4.
5. **`--inspect` inside a layer or shader cut window.** The PNG shows two shots, the snapshot only the incoming one (`engine/page/stage.mjs:167-170`). The JSON says so in `cut`; tested in Task 5.
6. **A picture the PNG reader refuses** (JPEG, WebP, a 16-bit or interlaced PNG; `scripts/v2/png.mjs:44-55`). `locate` converts through ffmpeg and says what to install when there is none; tested in Task 8.

## File Structure

- Create `engine/review/rules.mjs` (registry), `engine/review/outline.mjs` (`cut-variety`, `sameness`), `references/rules.md`.
- Create `scripts/v2/film-time.mjs` (grammar), `scripts/v2/inspect.mjs` (the dump), `scripts/v2/slice.mjs` (frame range of a shot or range, the sheet plan filtered to it).
- Create `scripts/locate.mjs`, `scripts/lib/locate.mjs` (geometry and drawing), `scripts/lib/png-write.mjs`, `scripts/lib/digits.mjs`.
- Create `references/tools.md`: the page for film time, `--inspect`, `--shot`, `--range` and `locate.mjs` (W6 appends `--compare-looks` and `measure.mjs`). Sections, in order: `Film time`, `One frame`, `One shot or a range`, `Locating a region`.
- Modify `engine/review/frame.mjs`, `engine/review/contrast.mjs`, `engine/hand/index.mjs:244`, `scripts/v2/loop.mjs:41-47`, `scripts/v2/review.mjs`, `scripts/v2/report.mjs:59`, `scripts/v2/run.mjs`, `scripts/v2/make-main.mjs:26-34`, `scripts/v2/cli.mjs`, `scripts/v2/poster.mjs`, `scripts/v2/render.mjs:127-147,167-171,208`, `scripts/v2/sheets.mjs:72-95`, `scripts/v2/sound/cues.mjs:76-85`, `references/schema.md`, `references/story.md`, `SKILL.md` (one line), `THIRD_PARTY_NOTICES.md`, `P/bin/test/make-motion-docs.test.mjs` (the pinned list of reference files, the report's `full` object at `:210`, `knownFlags` at `:280`).
- Tests: `test/v2/review-rules.test.mjs`, `review-suggest.test.mjs`, `review-outline.test.mjs`, `film-time.test.mjs`, `inspect.test.mjs`, `inspect-browser.test.mjs`, `slice.test.mjs`, `slice-browser.test.mjs`, `locate.test.mjs`; cases added to `cli-hints.test.mjs`, `outline.test.mjs`, `hand-audit.test.mjs`.

---

### Task 1: The rule registry and the rules page

**Files:**
- Create: `engine/review/rules.mjs`, `references/rules.md`, `test/v2/review-rules.test.mjs`
- Modify: `engine/hand/index.mjs:244` (`'covered'` becomes `'hand-covered'`), `scripts/v2/loop.mjs:41-47` (add `rule: 'loop'`, `node: ''`), `test/v2/hand-audit.test.mjs` (the renamed id), `P/bin/test/make-motion-docs.test.mjs` (add `references/rules.md` to the list of reference files W1's Task 1 checks (includes-only: later waves add files)), `SKILL.md` (at workflow step 7, beside W1's pointer to `references/reviewing.md`: "Every rule and its fix value: `references/rules.md`."), `references/schema.md` (one link in "The report"), `references/story.md` (one link in "What the review tells you")

**Interfaces:**
- Consumes: W2's two rule ids `dead-space` and `scale-contrast`, emitted by `auditFrame` and listed in `frame.mjs`'s export `COMPOSITION_RULES` (w2 plan, "Names other plans rely on"). If the scan's two forms do not see how W2 emits them, add the form W2 uses to `FORMS`; never list a W2 id in `EXPECTED_LATER`.
- Produces:
  - `RULES: readonly { id: string, kinds: ('mechanical' | 'creative')[], stage: 'frame' | 'film' | 'outline' | 'hand' | 'poster', capped: boolean, suggest: 'color' | 'minSize' | 'cuts' | null, summary: string }[]`
  - `RULE_IDS: readonly string[]`, `ruleOf(id: string): rule` (throws `unknown rule "<id>"` with did-you-mean, as `engine/registry.mjs:15-20` does).
  - The 38 ids. Frame (23): `measure`, `empty-first-frame`, `contrast`, `region-off-frame`, `frame-edge`, `overflow`, `min-size`, `safe-area`, `overlap`, `word-overlap`, `sizes`, `hero`, `dropped`, `highlight-lines`, `card-overlap`, `covered`, `line-words`, `hook-words`, `caption-zone`, `caption-hero`, `caption-late`, `caption-clipped`, `caption-covers`. Frame, from W2 (2): `dead-space`, `scale-contrast`. Film (7): `unsettled`, `still`, `kind`, `cut-window`, `match`, `hook`, `loop`. Hand (4): `stroke-edge`, `hand-speed`, `hand-covered`, `hand-edge`. Outline (2): `cut-variety`, `sameness`.
  - `kinds` holds both values for `card-overlap` (`frame.mjs:410-411`), `cut-window` (`review.mjs:327`) and `kind` (`review.mjs:284`). `capped: true` for `dead-space`, `scale-contrast`, `cut-variety`, `sameness` only (who caps which is Task 3's). `suggest`: `contrast` is `'color'`, `min-size` is `'minSize'`, `cut-variety` and `sameness` are `'cuts'`, every other `null`.
  - `references/rules.md`: one table, columns `Rule | Kind | Checked | Meaning | Fix value`, one row per id, the id in backticks in the first cell, `Kind` reading `mechanical`, `creative` or `mechanical, creative`.
- **[R2-12]** `RULES[]` gains `evidence: 'measured' | 'convention' | 'unmeasured'` and `ask: string | null`.
  - `measured`: the threshold comes from a table of ours that the row names. At this task: `dead-space` and
    `scale-contrast` (W2's `calibration.md`). `convention`: a published standard the row names (the contrast ratio).
    `unmeasured`: every other rule, which is most of them today; the number is ours or another project's and nobody
    here has measured it. A rule moves to `measured` only together with its table.
  - `ask`: for every rule whose `kinds` includes `creative`, one question to ask of the frame or the film, ending in a
    question mark ("Is the empty part of this frame doing a job?"). `null` for a rule that is only mechanical: its fix
    value is the answer.
- **[R2-12]** `references/rules.md`: the columns become `Rule | Kind | Checked | Meaning | Ask | Fix value | Evidence`.
  An `Evidence` cell reads `measured: <table>`, `convention: <standard>` or `unmeasured`. One sentence above the table:
  "A rule id is never renamed or reused after 2.3.0; a new rule takes a new id." (This wave's rename of the hand rule
  happens before that line applies.)
- **[R2-12]** No rule id is added: the count stays 38 and no cap list changes. The test helper `docRows()` also returns each
  row's `ask` and `evidence` cells.
- **[R2-12]** Later waves that add a rule carry one line, same wording: "The new registry row sets `evidence`
  (`unmeasured` unless a table of ours is named) and, for a creative rule, `ask`; its `rules.md` row fills both cells."
  It belongs in `docs/superpowers/plans/2026-11-21-motion-steals-w4.md` Task 2 (`poster-read`, the 39th rule) and Task 7
  (`overlay-covers`, the 40th), and in `docs/superpowers/plans/2026-11-21-motion-steals-w5.md` Task 6 Step 3 (the motion
  rules, if built). Without it those tasks fail R2-12's test. (Added to W4 Tasks 2 and 7 and W5 Task 6.)
- **[R2-12]** `SKILL.md` bytes added by R2-12: 0.

- [ ] **Step 1: Write the failing test** (`test/v2/review-rules.test.mjs`)

```js
const SCANNED = ['engine/review/frame.mjs', 'engine/review/contrast.mjs', 'engine/review/regions.mjs', 'engine/review/outline.mjs',
  'engine/hand/index.mjs', 'scripts/v2/review.mjs', 'scripts/v2/loop.mjs'];
const FORMS = [/rule: '([a-z-]+)'/g, /\bfinding\((?:ctx, )?(?:MECHANICAL|CREATIVE|'mechanical'|'creative'), '([a-z-]+)'/g];
// emittedIds(files) -> Set of every capture of FORMS over the files that exist

test('every rule the code emits is registered, and every registered rule is emitted', () => {
  assert.deepEqual([...emittedIds(SCANNED)].filter((id) => !RULE_IDS.includes(id)), []);
  assert.deepEqual(RULE_IDS.filter((id) => !emittedIds(SCANNED).has(id) && !EXPECTED_LATER.includes(id)), []);
});
test('the registry holds 38 rules, each id once, each with a summary', () => {
  assert.equal(RULE_IDS.length, 38);
  assert.equal(new Set(RULE_IDS).size, 38);
  for (const rule of RULES) assert.ok(rule.summary.length > 0, rule.id);
});
test('references/rules.md lists exactly the registered rules, with their kinds', () => {
  assert.deepEqual(docRows().map((r) => r.id).sort(), [...RULE_IDS].sort());
  for (const row of docRows()) assert.equal(row.kind, ruleOf(row.id).kinds.join(', '), row.id);
});
test('guardrail: a rule renamed in the code, in the registry or in the page is caught', () => {
  assert.deepEqual(unregistered(new Set(['min-sise'])), ['min-sise']);
  assert.deepEqual(missingRows(RULE_IDS, [{ id: 'min-sise' }]).includes('min-size'), true);
  assert.throws(() => ruleOf('min-sise'), /unknown rule "min-sise"; did you mean "min-size"\?/);
});
test('the hand rule and the frame rule no longer share an id', () => {
  assert.equal(ruleOf('covered').stage, 'frame');
  assert.equal(ruleOf('hand-covered').stage, 'hand');
});
```

**[R2-12]** Step 1, add one test:

```js
test('[R2-12] every rule states its evidence, and every creative rule asks a question', () => {
  for (const rule of RULES) {
    assert.ok(['measured', 'convention', 'unmeasured'].includes(rule.evidence), rule.id);
    assert.equal(rule.kinds.includes('creative'), typeof rule.ask === 'string' && rule.ask.endsWith('?'), rule.id);
  }
  assert.deepEqual(RULES.filter((r) => r.evidence === 'measured').map((r) => r.id).sort(), ['dead-space', 'scale-contrast']);
  for (const row of docRows()) {
    assert.equal(row.evidence.split(':')[0], ruleOf(row.id).evidence, row.id);
    assert.equal(row.ask, ruleOf(row.id).ask ?? '', row.id);
  }
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test "<MM>/test/v2/review-rules.test.mjs"`
Expected: FAIL, `Cannot find module .../engine/review/rules.mjs`.

- [ ] **Step 3: Implement** `engine/review/rules.mjs` with the exports above (pure, DOM-free: the hand rules run in the page), write `references/rules.md`, rename the hand id, give the loop finding its `rule` and `node`, add the two links and the `SKILL.md` line (then `wc -c` on `SKILL.md`: under the budget). `outline.mjs` does not exist yet: the scan skips a missing file, and `EXPECTED_LATER` is exactly `['cut-variety', 'sameness']` until Task 3 empties it.

- [ ] **Step 4: Run and see it pass**

Run: `node --test "<MM>/test/v2/review-rules.test.mjs" "<MM>/test/v2/hand-audit.test.mjs" "<MM>/test/v2/purity.test.mjs"`
Then: `node --test "<P>/bin/test/make-motion-docs.test.mjs" "<P>/bin/test/skill-budget.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Prove the guard fires on the real files.** As a literal single-match Edit, rename `'min-size'` to `'min-sise'` in `engine/review/frame.mjs:281`; the first test fails naming `min-sise`. Restore; `git diff --stat` on that file is empty. Put the row (mutation, test, outcome) in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugins/portable-artifacts/skills/make-motion/engine/review/rules.mjs plugins/portable-artifacts/skills/make-motion/references/rules.md plugins/portable-artifacts/skills/make-motion/test/v2/review-rules.test.mjs plugins/portable-artifacts/skills/make-motion/engine/hand/index.mjs plugins/portable-artifacts/skills/make-motion/scripts/v2/loop.mjs plugins/portable-artifacts/skills/make-motion/test/v2/hand-audit.test.mjs plugins/portable-artifacts/skills/make-motion/references/schema.md plugins/portable-artifacts/skills/make-motion/references/story.md plugins/portable-artifacts/skills/make-motion/SKILL.md plugins/portable-artifacts/bin/test/make-motion-docs.test.mjs
git commit -m "feat(w3): one rule registry, a rules page and a parity test" -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2: The report keeps `rule`, and a finding carries `suggest`

**Files:**
- Modify: `scripts/v2/report.mjs:59` (`reviewFinding`), `engine/review/contrast.mjs:199-217`, `engine/review/frame.mjs:257,281`, `references/schema.md:139` (the `findings` row), `references/rules.md` (the Fix value column)
- Test: `test/v2/review-suggest.test.mjs`; fix any test that compares a whole report finding with `deepEqual` (search `reviewFinding` and `findings\[0\]` under `test/` and `P/eval/test/`)

**Interfaces:**
- Produces (the W3 interface W4 and W5 use):
  - A review finding in the report: `{ kind, shot, path, message, t, rule, suggest? }`. `suggest` is absent when a rule has none.
  - `suggest: { color?: '#rrggbb', minSize?: number, factor?: number, cuts?: string[] }`. `SUGGEST_KEYS = ['color', 'minSize', 'factor', 'cuts']` exported from `engine/review/rules.mjs`; a finding may hold only those keys.
  - `nearestPassing(fill: string, ground: string, palette: Record<string, string>, min = MIN_CONTRAST): '#rrggbb'` exported from `engine/review/contrast.mjs`: of the palette's `#rrggbb` values whose `contrastRatio` against `ground` is at least `min`, the nearest to `fill` by OKLab distance (the repo's own OKLab maths, `test/v2/oklab.test.mjs`); when none passes, `#000000` or `#ffffff`, whichever has the higher ratio against `ground`.
  - `contrast` finding: `suggest: { color: nearestPassing(worst.fill, worst.ground, ctx.look.palette) }`, and its message ends `; <color> passes`.
  - `min-size` finding: `suggest: { minSize: 28, factor }`, `factor` = `MIN_TEXT_UNITS / smallest` rounded up to 2 decimals.
  - `finding(ctx, kind, rule, node, message, role, suggest?)` in `frame.mjs:257` takes the seventh argument; `contrastFindings`' `finding` callback (`contrast.mjs:197`) likewise.

- [ ] **Step 1: Write the failing test**

```js
test('nearestPassing takes the nearest palette colour that passes', () => {
  assert.equal(nearestPassing('#ff1010', '#ffffff', { a: '#000000', b: '#ff0000' }), '#ff0000'); // red on white is 4.00:1
});
test('nearestPassing falls back to black or white when no palette colour passes', () => {
  assert.equal(nearestPassing('#eeeeee', '#ffffff', { a: '#fefefe' }), '#000000');
  assert.equal(nearestPassing('#222222', '#101010', { a: '#111111' }), '#ffffff');
});
test('a contrast finding carries the colour, and the colour passes', () => {
  const [f] = auditFrame(treeWith({ fill: '#ffe14a', ground: '#ffffff' }), ctxWith({ palette: DESK_PALETTE })).filter((x) => x.rule === 'contrast');
  assert.match(f.suggest.color, /^#[0-9a-f]{6}$/);
  assert.ok(contrastRatio(f.suggest.color, '#ffffff') >= 3);
  assert.ok(f.message.endsWith(`; ${f.suggest.color} passes`));
});
test('a min-size finding carries the floor and the factor that reaches it', () => {
  const [f] = auditFrame(treeWith({ sizeUnits: 20 }), ctxWith({})).filter((x) => x.rule === 'min-size');
  assert.deepEqual(f.suggest, { minSize: 28, factor: 1.4 });
});
test('the report keeps rule and suggest, and drops node and role', () => {
  assert.deepEqual(reviewFinding({ kind: 'mechanical', shot: 'a', path: 'shots[0]', message: 'm', t: 1, rule: 'min-size', node: 'x', role: 'hero', suggest: { minSize: 28, factor: 1.4 } }),
    { kind: 'mechanical', shot: 'a', path: 'shots[0]', message: 'm', t: 1, rule: 'min-size', suggest: { minSize: 28, factor: 1.4 } });
  assert.deepEqual(Object.keys(reviewFinding({ kind: 'creative', shot: 'a', path: 'p', message: 'm', t: 0, rule: 'still', node: '' })), ['kind', 'shot', 'path', 'message', 't', 'rule']);
});
test('a suggest holds only the registered keys', () => { /* every finding of the sweep fixture: Object.keys(f.suggest ?? {}) within SUGGEST_KEYS */ });
```

`DESK_PALETTE` is `engine/looks/desk.mjs:29`. `treeWith` and `ctxWith` build one text node over one filled path, as `test/v2/review-contrast.test.mjs` already does.

- [ ] **Step 2: Run and see it fail**

Run: `node --test "<MM>/test/v2/review-suggest.test.mjs"`
Expected: FAIL, `nearestPassing is not a function`.

- [ ] **Step 3: Implement** the signatures above. `dedupeFindings` (`review.mjs:82-94`) spreads the finding, so `suggest` survives it unchanged.

- [ ] **Step 4: Run and see it pass**

Run: `node --test "<MM>/test/v2/review-suggest.test.mjs" "<MM>/test/v2/review-contrast.test.mjs" "<MM>/test/v2/review.test.mjs"`
Then: `node --test "<P>/bin/test/make-motion-docs.test.mjs"` and `node --test "<P>/eval/test/make-contract.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Commit** `feat(w3): findings name their rule and carry the fix value` (files: the five modified, the new test, any test corrected).

### Task 3: `cut-variety` and `sameness`, in `--outline`, and the cap

**Files:**
- Create: `engine/review/outline.mjs`, `test/v2/review-outline.test.mjs`
- Modify: `scripts/v2/review.mjs:378-389` (`reviewFilm`), `scripts/v2/run.mjs:494-498`, `scripts/v2/make-main.mjs:26-34`, `test/v2/outline.test.mjs`, `test/v2/review-rules.test.mjs` (empty `EXPECTED_LATER` of the two ids), `references/rules.md`

**Interfaces:**
- Consumes: `resolveShotCut(film, index)` (`engine/cuts/resolve.mjs`), `RULES[].capped`, the `suggest.cuts` key, `look.cutPalette` (`engine/looks/index.mjs:70`).
- Produces, all in `engine/review/outline.mjs` (pure; spec and timeline only):
  - `MIN_SEAMS = 4`, `CUT_SHARE_MAX = 2 / 3`, `SAME_RUN = 3`, `CREATIVE_CAP = 2`, `CAPPED_HERE = ['cut-variety', 'sameness']` (the rules `capCreative` caps; a later wave that adds a capped rule appends its id).
  - `cutVarietyFindings(film, timeline): finding[]`: a seam is the arrival at each shot after the first, its cut the resolved cut's `name`. With at least `MIN_SEAMS` seams, one finding when a cut with a window (`dur > 0`) carries more than `CUT_SHARE_MAX` of them. The plain `cut` never counts as the repeated cut: `references/story.md:38` calls it a change of subject. Shape: `{ kind: 'creative', shot: <id of the first shot that uses it>, path: 'cut' | 'shots[i].cut', t: <that shot's start>, rule: 'cut-variety', node: <cut name>, message, suggest: { cuts } }`, `cuts` = the look's `cutPalette` without that cut.
  - `samenessFindings(film, timeline): finding[]`: one finding per run of `SAME_RUN` or more shots in a row with the same kind (`show`), the same windowed cut, or the same move. A shot's move is the sorted list of the devices its `on` events place (`do`), compared only when not empty. Path `shots[i].show`, `shots[i].cut` or `shots[i].on` of the third shot of the run; `node` is `kind:<name>`, `cut:<name>` or `move:<a+b>`; `suggest: { cuts }` on the cut form only.
  - `outlineFindings(film, timeline): finding[]` = both, in time order.
  - `capCreative(findings): finding[]`: for each rule with `capped: true` that is not one of W2's `COMPOSITION_RULES`, keep the first `CREATIVE_CAP` in time order; the last one kept gains ` (and <n> more: <shot ids>)`. Every other finding passes through untouched. W2's `capComposition` (`COMPOSITION_CAP = 3`, the three worst by `measure`; w2 plan, Task 3) stays as it is for `dead-space` and `scale-contrast`. A test holds that every `capped` rule is covered by exactly one of the two functions.
- `reviewFilm` returns `capCreative([...everything it returns today (W2's cap already applied), ...outlineFindings(film, timeline)])`. `--outline` sets `state.findings = capCreative(outlineFindings(film, drawn.timeline)).map(reviewFinding)`; they are creative, so `ok` and the exit code do not change. The text form of `--outline` prints each as `creative: <path>: <message>` after the note.

- [ ] **Step 1: Write the failing test**

```js
const film = (cuts, shows = []) => ({ version: 2, look: 'desk', shots: [undefined, ...cuts].map((cut, i) => ({ id: `s${i}`, show: shows[i] ?? (i % 2 ? 'number' : 'statement'), hold: 2, ...(cut ? { cut } : {}), ...FIELDS[shows[i] ?? (i % 2 ? 'number' : 'statement')] })) });

test('one windowed cut on more than two thirds of the seams is a finding with the cuts to use instead', () => {
  const [f] = cutVarietyFindings(...timed(film(['slide', 'slide', 'slide', 'slide', 'cut', 'slide']))); // 5 of 6
  assert.equal(f.rule, 'cut-variety'); assert.equal(f.node, 'slide'); assert.equal(f.kind, 'creative');
  assert.ok(f.suggest.cuts.length > 0 && !f.suggest.cuts.includes('slide'));
});
test('exactly two thirds is not a finding', () => assert.deepEqual(cutVarietyFindings(...timed(film(['slide', 'slide', 'slide', 'slide', 'cut', 'cut']))), []));
test('fewer than four seams is never judged', () => assert.deepEqual(cutVarietyFindings(...timed(film(['slide', 'slide', 'slide']))), []));
test('a film of plain cuts is not a finding', () => assert.deepEqual(outlineFindings(...timed(film(['cut', 'cut', 'cut', 'cut', 'cut']))).filter((f) => f.rule === 'cut-variety'), []));
test('three shots of one kind running is a finding at the third; two is not', () => {
  const [f] = samenessFindings(...timed(film([null, null, null], ['statement', 'statement', 'statement', 'number'])));
  assert.equal(f.path, 'shots[2].show'); assert.equal(f.node, 'kind:statement');
  assert.deepEqual(samenessFindings(...timed(film([null, null], ['statement', 'statement', 'number']))), []);
});
test('the same windowed cut three seams running, and the same devices three shots running, are findings', () => { /* node 'cut:slide'; node 'move:highlight' */ });
test('capCreative keeps two per capped rule and says how many more', () => {
  const kept = capCreative([1, 2, 3, 4].map((t) => ({ kind: 'creative', rule: 'sameness', shot: `s${t}`, t, message: 'm' })));
  assert.equal(kept.length, 2);
  assert.ok(kept[1].message.endsWith(' (and 2 more: s3, s4)'));
});
test('capCreative leaves an uncapped rule, and the two composition rules, alone', () => {
  for (const rule of ['still', 'dead-space']) assert.equal(capCreative([1, 2, 3].map((t) => ({ kind: 'creative', rule, shot: 'a', t, message: 'm' }))).length, 3, rule);
});
test('every capped rule is capped by exactly one function', () => {
  for (const { id } of RULES.filter((r) => r.capped)) assert.notEqual(COMPOSITION_RULES.includes(id), CAPPED_HERE.includes(id), id); // CAPPED_HERE: exported by outline.mjs
});
test('the two showreels raise neither finding', () => { /* showreel-pro.json and showreel-viral.json through loadFilm: outlineFindings is [] */ });
```

And in `test/v2/outline.test.mjs`: `make.mjs film.json --outline --json` on the five-slide film prints `findings[0].rule === 'cut-variety'` and exit 0; the text form's last line starts `creative: `.

- [ ] **Step 2: Run and see it fail**

Run: `node --test "<MM>/test/v2/review-outline.test.mjs"`
Expected: FAIL, `Cannot find module .../engine/review/outline.mjs`.

- [ ] **Step 3: Implement** the signatures above. If the showreel test fails, stop and report the film, the rule and the count: the repo's own exemplars must not carry a tell, so the threshold is wrong, not the film.

- [ ] **Step 4: Run and see it pass**

Run: `node --test "<MM>/test/v2/review-outline.test.mjs" "<MM>/test/v2/outline.test.mjs" "<MM>/test/v2/review-rules.test.mjs" "<MM>/test/v2/review.test.mjs"`
Expected: PASS.

- [ ] **Step 5: The example suites [browser], one at a time.** The `*-examples-browser` suites and `review-browser.test.mjs` assert the full list of findings of each shipped example (w2 plan, Task 3 Step 5, which gave them their table of known findings). Run each; a `cut-variety` or `sameness` line that appears is accepted into that suite's table only after reading the film's script and agreeing it is a tell, else the rule's threshold is wrong: stop and report.
- [ ] **Step 5b: Calibrate on the examples, no browser.** Run `node <MM>/scripts/make.mjs <MM>/references/examples/v2/<film>.json --outline --json` on each `.json` film in that folder (29 at the time of writing), one call each, and put a table in the task report: film, `cut-variety` (yes or no), `sameness` count. More than a third of the films flagged means the thresholds teach the agent to ignore the rule (spec section 2, anti-goals): stop and report before committing. **[R2-12]** When this table is in the task report, `cut-variety` and `sameness` become `evidence: 'measured'` naming it, and Task 1's test list of measured rules gains the two ids.

- [ ] **Step 6: Commit** `feat(w3): cut-variety and sameness findings in the outline, capped per film`.

### Task 4: Film time, and an anchor on `--poster`

**Files:**
- Create: `scripts/v2/film-time.mjs`, `test/v2/film-time.test.mjs`
- Create also: `references/tools.md` with its first section, `Film time`
- Modify: `scripts/v2/sound/cues.mjs:76-85` (import `wholeFilmShot` in place of the local `filmShot`), `scripts/v2/cli.mjs:101-111` (`posterFlags`), `scripts/v2/poster.mjs:11-16`, `scripts/v2/run.mjs:396-406,502`, `P/bin/test/make-motion-docs.test.mjs` (add `references/tools.md` to W1's reference-file list), `SKILL.md` (where `--poster` is named: "One frame, one shot, a range or a region box: `references/tools.md`."), `test/v2/cli-hints.test.mjs`

**Interfaces:**
- Produces:
  - `wholeFilmShot(timeline): { id: 'film', duration, words, sentences }`, moved from `sound/cues.mjs:76-85` with no change (its words are heard times).
  - `filmSeconds(ref: string | number, film, timeline): number`, film seconds, not clamped. Forms, tried in this order: a plain number (`/^\d+(\.\d+)?$/`); `<shot-id>@<anchor>` (the anchor resolved in that shot by `resolveAnchor`, `engine/script/anchors.mjs:165`, so a word is where the picture shows it); `<shot-id>` alone (that shot's start); else an anchor across the whole film (`anchorSeconds(ref, wholeFilmShot(timeline))`: `word:<n>` and `sentence:<n>` count across the film, as a `cues` entry's `at` does).
  - `filmFrame(ref, film, timeline): number` = `Math.round(seconds * fps)`; past the last frame throws the message `posterFrame` gives today.
  - `class FilmTimeError extends Error` with `hint`: `use a number of seconds, "<shot-id>", "<shot-id>@<anchor>" or a film-wide anchor; the shots are: <ids, comma separated>; an anchor is start, end, word:<n>, word:<text> or sentence:<n>, with an optional +<s> or -<s>`.
- `--poster` takes the string as written (`posterFlags` no longer tests for a number); `runMake` resolves it after the timeline exists. A `FilmTimeError` raised there is machine trouble: exit 2, `report.error = { message, hint }`, before any browser starts.

- [ ] **Step 1: Write the failing test**

```js
// film: shots hook (say 'Numbers need sources.') and rows (hold 2); timeline = buildTimeline(film, { fps: 30 })
test('a number is seconds; a shot id is its start; shot@anchor is inside that shot', () => {
  assert.equal(filmSeconds('1.5', film, timeline), 1.5);
  assert.equal(filmSeconds('rows', film, timeline), timeline.shots[1].start);
  assert.equal(filmSeconds('rows@end-0.5', film, timeline), timeline.shots[1].start + 1.5);
  assert.equal(filmSeconds('hook@word:1', film, timeline), timeline.shots[0].start + timeline.shots[0].words[1].start);
});
test('a film-wide anchor counts words across the film', () => assert.equal(filmSeconds('word:2', film, timeline), timeline.shots[0].words[2].soundStart));
test('a shot called end is the shot, not the film end', () => assert.equal(filmSeconds('end', filmWithShotCalledEnd, itsTimeline), itsTimeline.shots[1].start));
test('an unknown shot lists the shots and the forms', () => {
  assert.throws(() => filmSeconds('nope@start', film, timeline), (err) => err instanceof FilmTimeError && /hook, rows/.test(err.hint) && /word:<n>/.test(err.hint));
});
test('past the end names the film length', () => assert.throws(() => filmFrame('99', film, timeline), /past the end \(the film is \d+\.\d s\)/));
test('make.mjs --poster nope exits 2 with the accepted list and starts no browser', () => {
  // `make` and the two-shot film `gate` (shots hook, rows) as test/v2/make.test.mjs:28-31,56 build them
  const run = make([filmPath('gate'), '--poster', 'nope', '--json'], { PLAYWRIGHT_BROWSERS_PATH: '/nonexistent' });
  assert.equal(run.status, 2);
  assert.match(JSON.parse(run.stdout).error.hint, /the shots are: hook, rows/);
});
```

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/film-time.test.mjs"`; expected FAIL, module not found.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see it pass** — `node --test "<MM>/test/v2/film-time.test.mjs" "<MM>/test/v2/sound-cues.test.mjs" "<MM>/test/v2/cli-hints.test.mjs"` (the cue tests prove the move changed nothing), then `node --test "<P>/bin/test/make-motion-docs.test.mjs" "<P>/bin/test/skill-budget.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w3): film-time anchors, accepted by --poster`.

### Task 5: `--inspect <time>`

**Files:**
- Create: `scripts/v2/inspect.mjs`, `test/v2/inspect.test.mjs`, `test/v2/inspect-browser.test.mjs`
- Modify: `engine/review/frame.mjs` (export `inspectNodes`), `scripts/v2/cli.mjs:8-41` (`FLAGS`, `OPTIONS`, `MODE_CONFLICTS`), `scripts/v2/run.mjs` (beside `makePoster`), `scripts/v2/report.mjs:125`, `references/schema.md:142` (the keys that appear only sometimes), `references/tools.md` (section `One frame`: the command and the JSON's fields), `P/bin/test/make-motion-docs.test.mjs:210` (add `inspect: {}` to `full`)

**Interfaces:**
- Consumes: `filmFrame` (Task 4), `frameContext`'s shape (`review.mjs:209-220`; export it), `window.__snapshot(i)`, `auditPlan`'s window test (`review.mjs:98-109`).
- Produces:
  - `inspectNodes(sampled, ctx): { id, type, role?, bbox: [x, y, w, h], opacity: number, offFrame: boolean, text?: { sizeUnits, smallestUnits, ink: [x, y, w, h], landed, outsideSafe } }[]` in `engine/review/frame.mjs`: every node with an accumulated opacity above 0, parent before child. `offFrame`: its box is not wholly inside the canvas. `sizeUnits` and `smallestUnits` are `measured()`'s `size` and `smallest` (`frame.mjs:214-227`), rounded to 1 decimal: the height a viewer reads.
  - `writeInspect({ session, frame, dir }): Promise<{ png, json, frame, seconds, shot }>`: seeks, screenshots a PNG, writes `<dir>/<frame>.png` and `<dir>/<frame>.json`, both whole or not at all. The JSON: `{ frame, seconds, shot, timed, canvas: { w, h }, unit, safe: { left, top, right, bottom }, cut: { name, p } | null, nodes }`. `cut` is set inside a cut's window, where the PNG shows two shots and `nodes` the incoming one alone.
  - `--inspect <time>`: `dir` is `<out stem>.inspect/` beside the MP4 path; the report gains `inspect` (only then); no review, no sound, no ffmpeg.
  - `MODE_CONFLICTS.inspect = ['out', 'batch', 'no-render', 'sheets-only', 'outline', 'phonemes', 'poster', 'poster-out', 'subtitles', 'workers', 'exact']`; `inspect` is added to the `poster` and `preview` rows.

- [ ] **Step 1: Write the failing tests**

```js
// inspect.test.mjs (no browser): a text 20 units tall at x = -40 on a 1920x1080 canvas, one path inside the frame
test('a text reports its height in units, its ink and whether it left the safe area and the frame', () => {
  const [text, bar] = inspectNodes(TREE, CTX);
  assert.equal(text.text.sizeUnits, 20); assert.equal(text.text.outsideSafe, true); assert.equal(text.offFrame, true);
  assert.equal(bar.offFrame, false); assert.equal(bar.text, undefined);
});
test('a node at opacity 0 is left out', () => assert.equal(inspectNodes(HIDDEN, CTX).length, 0));
test('--inspect does not go with --out, --poster or --sheets-only', () => {
  for (const flag of [['--out', 'a.mp4'], ['--poster', '1'], ['--sheets-only']]) assert.throws(() => parseMakeArgs(['f.json', '--inspect', '1', ...flag]), /--inspect does not go with/);
});
// inspect-browser.test.mjs [browser], one run, FILMS.off of test/v2/make.test.mjs:33-35 plus a second shot on a crossfade
test('make.mjs --inspect writes the PNG and the JSON, and the report names both', async (t) => {
  const { report } = await runMake({ specPath, inspect: 'off@0.5', out: null }, { browser });
  assert.equal(readPng(readFileSync(report.inspect.png)).width, 1920);
  const dump = JSON.parse(readFileSync(report.inspect.json, 'utf8'));
  assert.equal(dump.shot, 'off'); assert.equal(dump.cut, null);
  assert.equal(dump.nodes.find((n) => n.id === 'edge').text.outsideSafe, true);
});
test('inside a crossfade the dump says which cut and how far', async (t) => { /* dump.cut.name === 'crossfade' and 0 < dump.cut.p < 1 */ });
```

- [ ] **Step 2: Run and see them fail** — `node --test "<MM>/test/v2/inspect.test.mjs"`; expected FAIL, `inspectNodes is not a function`.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see them pass** — `node --test "<MM>/test/v2/inspect.test.mjs"`, then **[browser]** `node --test --test-concurrency=1 "<MM>/test/v2/inspect-browser.test.mjs"`, then `node --test "<P>/bin/test/make-motion-docs.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w3): --inspect writes one frame as a PNG and a JSON dump`.

### Task 6: `--shot` and `--range`: the sheets and the review of a slice

**Files:**
- Create: `scripts/v2/slice.mjs`, `test/v2/slice.test.mjs`
- Modify: `scripts/v2/cli.mjs`, `scripts/v2/sheets.mjs:72-95`, `scripts/v2/review.mjs:98-131,378-389`, `scripts/v2/run.mjs:117-140`, `scripts/v2/report.mjs`, `references/schema.md:142`, `references/tools.md` (section `One shot or a range`), `P/bin/test/make-motion-docs.test.mjs:210` (add `slice: {}`)

**Interfaces:**
- Consumes: `filmFrame` (Task 4), `planSheets` and `auditMoments` (`scripts/v2/plan.mjs:140,149`).
- Produces:
  - `sliceOf(options: { shot?: string, range?: string }, film, timeline): { from: number, to: number, label: string, shots: string[] } | null`. `--shot <id>`: that shot's first to last frame, label the id; an id the film lacks throws a `FilmTimeError` with the shot list (exit 2). `--range <a>..<b>`: two film-time references (Task 4), inclusive, label `range-<from>-<to>`; `a` after `b`, or a missing `..`, is a `UsageError` naming the form.
  - `sliceSheets(sheets, slice): sheet[]`: a shot sheet keeps only its tiles whose frame is inside the slice and is dropped when none is left; a cut strip belongs to the slice only when the first frame of its window is inside it, and is then kept whole, side frames included.
  - `writeSheets({ ..., slice })` writes only those sheets and deletes only the files it rewrites (today `clearOwnSheets`, `sheets.mjs:72-75`, empties the folder).
  - `reviewFilm({ session, signal, slice })`: the audit frames inside the slice, plus the last frame of every shot the slice touches, which is snapshotted but not judged: `restingByShot` (`review.mjs:176-183`) reads a text's rest scale from it, and without it every text counts as settled (`engine/review/frame.mjs:211`) and a frame in mid-motion would be judged. `still` is judged over the slice's frames alone; `cut-window`, `match` and `hook` only for shots in it; `loop`, `cut-variety` and `sameness` are not run.
  - `sliceAuditPlan(film, timeline, slice): { frame: number, judged: boolean }[]` in `scripts/v2/slice.mjs`: the frames `reviewFilm` snapshots for a slice, in order.
  - Report key `slice` (only then): `{ from, to, frames, shots, silent: boolean, skipped: ['loop', 'cut-variety', 'sameness'] }`.
  - `MODE_CONFLICTS.shot = ['range', 'batch', 'outline', 'phonemes', 'poster', 'poster-out', 'inspect', 'subtitles', 'workers']`, `MODE_CONFLICTS.range` the same with `shot`; both added to the `preview` row.

- [ ] **Step 1: Write the failing test**

```js
// a three-shot film at 30 fps: a (2 s), b (2 s, slide), c (2 s)
test('--shot is the frames of that shot', () => assert.deepEqual(sliceOf({ shot: 'b' }, film, timeline), { from: 60, to: 119, label: 'b', shots: ['b'] }));
test('--range takes two film times, inclusive', () => assert.deepEqual(sliceOf({ range: 'a@1..b@0.5' }, film, timeline), { from: 30, to: 75, label: 'range-30-75', shots: ['a', 'b'] }));
test('a range that runs backwards, or has no .., is a usage error naming the form', () => {
  assert.throws(() => sliceOf({ range: 'b..a' }, film, timeline), /--range takes <from>\.\.<to>/);
  assert.throws(() => sliceOf({ range: '1.5' }, film, timeline), /--range takes <from>\.\.<to>/);
});
test('an unknown shot lists the shots', () => assert.throws(() => sliceOf({ shot: 'nope' }, film, timeline), /the shots are: a, b, c/));
test('the sheets of --shot b are its own sheet and the strip of the cut into it', () => {
  assert.deepEqual(sliceSheets(planSheets(film, timeline), sliceOf({ shot: 'b' }, film, timeline)).map((s) => s.name), ['b.png', 'cut-a-b.png']);
});
test('a range keeps the shot tiles inside it, and a strip only when its window starts inside it', () => {
  const sheets = sliceSheets(planSheets(film, timeline), sliceOf({ range: 'a@1..b@0.5' }, film, timeline));
  assert.deepEqual(sheets.map((s) => s.name), ['a.png', 'b.png', 'cut-a-b.png']); // the window of b->c starts at 120, outside 30..75
  for (const sheet of sheets.filter((s) => s.kind === 'shot')) for (const tile of sheet.tiles) assert.ok(tile.frame >= 30 && tile.frame <= 75, `${sheet.name} ${tile.frame}`);
});
test('a range that ends mid-shot still snapshots that shot\'s last frame, and judges only the frames inside it', () => {
  const plan = sliceAuditPlan(film, timeline, sliceOf({ range: 'a@1..b@0.5' }, film, timeline)); // [{ frame, judged }]
  assert.ok(plan.some((p) => p.frame === 119 && p.judged === false)); // b's last frame, for its rest scales
  assert.ok(plan.filter((p) => p.judged).every((p) => p.frame >= 30 && p.frame <= 75));
});
test('--shot does not go with --range, --poster or --workers', () => { /* three parseMakeArgs throws */ });
```

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/slice.test.mjs"`; expected FAIL, module not found.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see it pass** — `node --test "<MM>/test/v2/slice.test.mjs" "<MM>/test/v2/cli-hints.test.mjs" "<MM>/test/v2/review.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w3): --shot and --range plan the sheets and the review of a slice`.

### Task 7: A slice's MP4, and its frames against the full render

**Files:**
- Modify: `scripts/v2/render.mjs:127-147` (`encodeFrames`), `:167-171` (`loudnessFor`), `:208` (`renderFilm`), `scripts/v2/run.mjs:127-135`
- Test: `test/v2/slice-browser.test.mjs`

**Interfaces:**
- Consumes: `sliceOf` (Task 6).
- Produces:
  - `renderFilm({ ..., frames?: { from: number, to: number }, onFrame?: (index: number, bytes: Buffer) => void })`. With `frames`: only those frames are captured and encoded, each sought by its absolute index; the first is always captured; no voice or sound is mastered or muxed (`loudnessFor` returns `null`), and the result's `audio` is `null`. `onFrame` is called once per frame written, with the bytes sent to ffmpeg.
  - A slice run writes `<out dir>/<name>.<label>.mp4`, never the film's own MP4 path, logs `make: the slice is silent: the sound is mastered for the whole film`, and sets `report.slice.silent` to `true` when the film has a voice or sound.

- [ ] **Step 1: Write the failing test** **[browser, ffmpeg]** (one session for both renders)

```js
// film: desk look (grain on), a: a still `free` shot of 3 s (the bar of test/v2/make.test.mjs:21,25), b: a number on a 'slide'.
// FROM: the first frame of a for which __heldFlags(i, i, true)[0] is true (the test finds it; a still shot under 12-a-second grain has one);
// TO: a frame of b after its cut window
test('the frames of a slice are the frames of the full render', async (t) => {
  if (!await needs(t, { ffmpeg: true })) return;
  const full = new Map(); const part = new Map();
  await renderFilm({ out: fullOut, exact: true, session, onFrame: (i, bytes) => full.set(i, sha256(bytes)) });
  await renderFilm({ out: partOut, exact: true, session, frames: { from: FROM, to: TO }, onFrame: (i, bytes) => part.set(i, sha256(bytes)) });
  assert.deepEqual([...part.keys()], range(FROM, TO));
  for (const i of part.keys()) assert.equal(part.get(i), full.get(i), `frame ${i}`);
  assert.equal(probeVideo(partOut).frames, TO - FROM + 1);
});
test('the first frame of a slice is captured though the page calls it held', async (t) => {
  /* held = await page.evaluate(([a, b]) => window.__heldFlags(a, b, true), [FROM, FROM]); assert.equal(held[0], true); the render above still wrote frame FROM */
});
test('a slice of a voiced film is silent and says so', async (t) => { /* runMake with a fake synthesise: report.slice.silent === true, probe shows no audio stream */ });
```

- [ ] **Step 2: Run and see it fail** — after `pgrep -fl chrome-headless-shell` prints nothing: `node --test --test-concurrency=1 "<MM>/test/v2/slice-browser.test.mjs"`; expected FAIL: `part` holds every frame of the film (`frames` is ignored).
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see it pass** — the same command, then **[browser]** `node --test --test-concurrency=1 "<MM>/test/v2/make.test.mjs"` (the render it changes); expected PASS.
- [ ] **Step 5: Commit** `feat(w3): a slice renders its own silent MP4, frame-equal to the full render`.

### Task 8: The locate helper

**Files:**
- Create: `scripts/locate.mjs`, `scripts/lib/locate.mjs`, `scripts/lib/png-write.mjs`, `scripts/lib/digits.mjs`, `test/v2/locate.test.mjs`
- Modify: `references/tools.md` (section `Locating a region`: the three commands), `references/schema.md` (one line under Anchors pointing at it), `THIRD_PARTY_NOTICES.md`, `P/bin/test/make-motion-docs.test.mjs:280` (add `scripts/locate.mjs` to `knownFlags`)

**Interfaces:**
- Consumes: `readPng` (`scripts/v2/png.mjs:44`), `findFfmpeg` and `fileInput` (`scripts/lib/ffmpeg.mjs:44`), `parseCli` and `UsageError` (`shared/cli.mjs`).
- Produces:
  - `STRIPS = 9`, `GRID = 6`, `PAD_CELLS = 0.25`, `MAX_OVERLAY_SIDE = 1600`, `REGION_DECIMALS = 3`.
  - `stripsBox({ cols: [first, last], rows: [first, last] }): [x0, y0, x1, y1]` (strips counted from 1; fractions of the picture).
  - `cellsBox(box: [x0, y0, x1, y1], cells: [first, last]): [x0, y0, x1, y1]`: the rectangle from cell `first` to cell `last` of the 6 by 6 grid over `box` (cells counted 1 to 36, row by row), grown by `PAD_CELLS` of a cell on each side, held inside 0..1.
  - `toRegion([x0, y0, x1, y1]): [x, y, w, h]`, each rounded to `REGION_DECIMALS`: the form a `regions` entry takes (`engine/kinds/clipping.mjs:447`).
  - `encodePng({ width, height, channels: 3 | 4, data: Buffer }): Buffer` with its own CRC-32 table (`zlib.crc32` is newer than Node 20.0, which `package.json` `engines` allows) and `zlib.deflateSync`.
  - `DIGITS: Record<'0'..'9', string[]>` (seven rows of five `0`/`1` characters) and `drawNumber(pixels, { x, y, value, scale, ink, plate })`.
  - The command, three steps, each one plain call:
    1. `node scripts/locate.mjs <picture> --out <dir>` writes `<dir>/strips-cols.png` and `<dir>/strips-rows.png` (nine numbered strips each way) and prints both paths and the next command.
    2. `node scripts/locate.mjs <picture> --cols 5-6 --rows 2-3 --out <dir>` writes `<dir>/grid.png` (that crop, 36 numbered cells).
    3. `node scripts/locate.mjs <picture> --cols 5-6 --rows 2-3 --cells 15-30 [--out <dir>] [--json]` prints `[x, y, w, h]` (with `--json`: `{ "region": [...] }`); with `--out` it also writes `<dir>/box.png`, the picture with the box drawn.
  - A PNG `readPng` refuses, and any other picture format, is decoded by ffmpeg to an 8-bit RGB PNG on a pipe (`fileInput`, one frame). No ffmpeg: exit 2, `locate needs ffmpeg to read a <ext> picture; run the doctor, or give a PNG`. A URL, a folder, an `--out` that is the picture, a strip outside 1 to 9 or a cell outside 1 to 36 is exit 2 naming the accepted values. No network, no model: the agent looks at the PNGs and picks the numbers.
  - Stated tolerance: with a picker that names every strip and cell the target touches, the region holds the target and each edge lies within 1.25 cells of it (one cell of the second grid plus the pad).

- [ ] **Step 1: Write the failing test** (no browser)

```js
const TARGET = [0.55, 0.2, 0.1, 0.08]; // [x, y, w, h]
const CELL = (2 / 9) / 6;              // a cell of the grid over two strips
test('two strips each way, then cells 15 to 30, give the region', () => {
  assert.deepEqual(toRegion(cellsBox(stripsBox({ cols: [5, 6], rows: [2, 3] }), [15, 30])), [0.509, 0.176, 0.167, 0.13]);
});
test('the region holds the target, each edge within 1.25 cells', () => {
  const [x, y, w, h] = toRegion(cellsBox(stripsBox({ cols: [5, 6], rows: [2, 3] }), [15, 30]));
  assert.ok(x <= 0.55 && y <= 0.2 && x + w >= 0.65 && y + h >= 0.28);
  for (const gap of [0.55 - x, 0.2 - y, x + w - 0.65, y + h - 0.28]) assert.ok(gap <= 1.25 * CELL + 1e-3, String(gap));
});
test('the first pass alone misses that tolerance', () => {
  const [x] = toRegion(stripsBox({ cols: [5, 6], rows: [2, 3] }));
  assert.ok(0.55 - x > 1.25 * CELL);
});
test('a picker that names what the target touches meets the tolerance on five targets', () => { /* corners, centre, a tiny box, a wide box: pick(target) -> { cols, rows, cells } */ });
test('encodePng round-trips through the reader', () => {
  const data = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9, 8, 8, 8, 7, 7, 7]);
  assert.deepEqual(readPng(encodePng({ width: 3, height: 2, channels: 3, data })), { width: 3, height: 2, channels: 3, data });
});
test('a digit is seven rows of five, and drawNumber inks its pixels', () => { /* DIGITS['7'][0] === '11111'; the pixel at the plate's top-left ink cell is the ink colour */ });
test('step 1 writes two PNGs no larger than 1600 px a side; step 3 prints the region', () => { /* a 900x600 PNG built with test/v2/helpers/png.mjs pngOf; spawnSync node scripts/locate.mjs */ });
test('a strip of 0, a cell of 37, a URL and --out equal to the picture each exit 2 naming what is accepted', () => { /* four spawnSync runs */ });
test('a JPEG without ffmpeg exits 2 and says what to do', () => { /* env FFMPEG_PATH=/nonexistent, PATH '' */ });
```

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/locate.test.mjs"`; expected FAIL, module not found.
- [ ] **Step 3: Implement** the signatures above, from the description in `PROPOSAL.md` item 6 alone: do not open the HyperFrames file.
- [ ] **Step 4: Notices.** In `THIRD_PARTY_NOTICES.md`, under W1's `## Ideas credited, no code ported`, append to the HyperFrames bullet (HeyGen, Apache-2.0): the two-pass numbered-grid picker for a region, and findings that carry their fix value (W3); and to the Rune bullet (MIT): time references by name (W3). Each was written here from a description; no file was copied. **[R2-12]** And to the video-shotcraft bullet (W1's round-2 credit): a rules page that states each threshold's evidence and asks one question per creative rule (W3).
- [ ] **Step 5: Run and see it pass** — `node --test "<MM>/test/v2/locate.test.mjs" "<MM>/test/v2/cuts-notices.test.mjs"`, then `node --test "<P>/bin/test/make-motion-docs.test.mjs"`; expected PASS.
- [ ] **Step 6: One real use, viewed.** Run the three steps on `<MM>/references/examples/v2/clipping.png` into `.scratch/w3-locate/`, open each PNG, and write in the task report what the numbers look like at full size (readable or not) and the region it printed for the region that film already names (`engine/kinds/clipping.mjs:447`, `query`).
- [ ] **Step 7: Commit** `feat(w3): locate.mjs turns a seen target into a regions box`.

### Task 9: Wave gate

- [ ] **Step 0:** The flag pins. Each new flag changes `FLAGS` and the usage line (`scripts/v2/cli.mjs:8-9`). Search `test/help.test.mjs`, `test/cli-contract.test.mjs`, `P/eval/test/make-contract.test.mjs` and `P/eval/test/docs-facts.test.mjs` for `FLAGS`, the usage text and the flag names, and update whatever pins them in the commit that added the flag.
- [ ] **Step 1:** Run what CI runs for this area, one command per call: `node <P>/bin/sync-shared.mjs --check`; `node --test "<P>/bin/test/*.test.mjs"`; `node --test "<P>/eval/test/*.test.mjs"`; `python3 -m pytest tests/pytest`; then the Node-only files this wave touched; then **[browser]**, one at a time, `inspect-browser`, `slice-browser`, `make`, `review-browser`, `outline`.
- [ ] **Step 2:** Edit-loop timing, measured (spec section 2, "a slower edit loop" is an anti-goal). On `references/examples/v2/gate-desk.json`, with no other browser live: time `--sheets-only --json` (today's way to check one shot) against `--shot <id> --sheets-only --json`, three runs each, medians in the task report with the commands. No budget is set; the numbers go in the PR body.
- [ ] **Step 3:** Fresh-context review (reviewer tier, medium), report only, never writing session logs or project docs, given the diff of this wave, this plan's Review Focus and the security lens (Task 8 reads a file a user names and runs ffmpeg on it; Tasks 5 to 7 write beside the output). Its prompt carries this sentence verbatim: "Report every issue you find, including ones you are uncertain about or consider low-severity. Do not filter for importance or confidence at this stage — a separate verification step will do that. Your goal here is coverage: it is better to surface a finding that later gets filtered out than to silently drop a real bug. For each finding, include your confidence level and an estimated severity so a downstream filter can rank them."
- [ ] **Step 4:** The controller fixes every CRITICAL and HIGH with a test that failed first (`fix(w3):`), then pushes the wave's commits.
- [ ] **Step 5:** For the final phase, record in the PR notes: new flags `--inspect`, `--shot`, `--range`, anchors on `--poster`, `scripts/locate.mjs`, report keys `inspect` and `slice`, findings gaining `rule` and `suggest`, the hand rule id `covered` renamed `hand-covered`.

## Self-review notes

- Spec coverage: P3 (Tasks 1 to 3), P4 (Tasks 4 to 7), P6 (Task 8). `--draft` is in `PROPOSAL.md` item 4 but not in the spec's W3 line; it is not planned.
- Decisions the owner should check: the plain `cut` never counts as the repeated cut; a shot's "move" is the set of devices its `on` events place; `cut-variety` and `sameness` are capped at two findings each, beside W2's cap of three composition findings; `MIN_SEAMS` is 4; the hand rule `covered` is renamed `hand-covered`; a slice MP4 is always silent.
- Aligned with the sibling plans as written on 2026-11-21: W1 (the walked reference list, the router test, the credits section), W2 (`COMPOSITION_RULES`, `capComposition`). The master plan file did not exist yet.
