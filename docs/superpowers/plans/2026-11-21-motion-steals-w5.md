# Motion Steals W5: Evidence Loop II Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Direction is settled on pictures before any voice is made, the preview shows the same frame again after an edit, and a second reviewer exists that has been shown to find planted defects before anyone is told to trust it.

**Architecture:** Four units, the last conditional. (1) `--estimated` beside `--sheets-only` skips the voice and writes board strips; `storyboard.mjs`, still browserless, copies those strips into the plan page it already writes. (2) The preview writes its frame and play state into `location.hash` before the reload it already does, and reads them on start; the encoding is a pure module. (3) A read-only reviewer agent file ships from `shared/agents.mjs` like the operator's; committed films with one planted defect each and a pure scorer decide whether `references/reviewing.md` may name it. (4) The motion gate is built only if W0 found defects.

**Tech Stack:** Node 20+, `node:test`, Playwright Chromium where named. No new npm dependency. Task 5's proof runs call a billed host and are owner-gated.

**Spec:** `docs/superpowers/specs/2026-11-21-motion-steals-design.md` section 6, W5. Evidence: `.scratch/research-2026-11-21/PROPOSAL.md` items 9, 14, 7, 13 (P9, P14, P7, P13).

Abbreviations: `P` = `plugins/portable-artifacts`, `MM` = `P/skills/make-motion`, `EX` = `P/skills/make-explainer`. Paths with no prefix are relative to `MM/`. In commands, `<MM>` and `<P>` stand for the literal absolute paths. Anchors were read on branch `feat/motion-steals` on 2026-11-21, before W0 to W4 landed; nothing was run. Where an earlier wave edits the same file (`SKILL.md`, the doc test, `scripts/v2/cli.mjs`, `scripts/v2/run.mjs`, `scripts/v2/report.mjs`, `scripts/v2/sheets.mjs`, `engine/page/stage.mjs`), find the anchor by the function named beside it.

## Global Constraints

- `MM/SKILL.md` is 20,898 bytes against a 20,900-byte budget pinned in `plugins/portable-artifacts/bin/test/skill-budget.test.mjs`; slim, never raise the cap. This wave adds 0 bytes to `SKILL.md` and creates no reference file (after W1 the doc test requires `SKILL.md` to name each one). The Director and operator section is the same text in every skill (`bin/test/delegation.test.mjs:64-68`), so nothing about the reviewer goes there.
- No new runtime dependency, no network use, no generative-video call from `make.mjs`.
- No new server route (the preview server is GET and HEAD only). The playhead lives in the page's own URL fragment.
- One headless browser at a time (`pgrep -fl chrome-headless-shell` first; `--test-concurrency=1`). Steps marked **[browser]** are run one at a time.
- Goldens change only for an intended visual change, stated in the commit. This wave intends none.
- HyperFrames (Apache-2.0) and Rune (MIT) ideas are rewritten in our own code with a credit line in `THIRD_PARTY_NOTICES.md`; no file is ported. This wave appends to the HyperFrames bullet, in the commits of Tasks 2 and 3: a board of stills before any voice (P9) and a preview that keeps its playhead through a reload (P14) (review fix). No code from beast_explainer (its proof-before-trust practice is an idea; the fixtures and the scorer are written here).
- Every code fix and guardrail is shown failing first (RED), then passing.
- Commits: conventional, prefixed `feat(w5):` / `fix(w5):` / `test(w5):` / `docs(w5):`, staging named files only, ending with exactly one trailer line `Co-Authored-By: Claude <noreply@anthropic.com>` and no `Claude-Session` line (the `commit-trailers` CI job fails otherwise). Implementers do not commit; the controller runs each Commit step.
- All waves ship on one branch and one PR; one `plugin.json` bump, one `CHANGELOG.md` heading and the cover Revision happen once in the final phase, not per wave.
- A fresh-context review (reviewer tier) runs at the end of each wave before its commits are pushed. Implementers are executor tier (Sonnet, effort high); reviewers Opus at medium.
- Shell: one plain command per call, literal absolute paths, no `cd`, `&&`, pipes, `;`, variables, loops or heredocs; quote globs; never `rm`. Never drive the Mac with synthetic input; a Playwright page's own DOM events inside a headless browser are how the existing viewer tests work (`test/v2/viewer-browser.test.mjs:78`).
- Spending money needs the owner's yes in that turn. Task 5 Step 6 is the only billed step: 15 sessions.
- `--sheets-only` keeps making the voice of a voiced film (`scripts/v2/run.mjs:487`): the eval harness scores with it (`P/eval/README.md`, "Motion sets"). Skipping the voice is a new flag.

## Review Focus

1. **A film that got shorter while the preview was open.** The saved frame is past the new end; it must clamp, not throw (`engine/page/stage.mjs:206`). Tested in Task 3.
2. **Play that cannot resume.** After a reload with no gesture `audio.play()` can be refused while the tick reads `audio.currentTime` (`engine/page/viewer.mjs:81,88-91`): the page would say Pause and stand still. Headless Chromium does not refuse, so the test makes `play` reject. Tested in Task 3.
3. **An edit that does not validate, then one that does.** The error page has no player; it must not wipe the saved frame. Tested in Task 3.
4. **A board strip the plan page refuses.** make-explainer takes `image.src` only as a relative path inside the plan's folder, at most 1.5 MB, in a file of at most 40 sections (`EX/references/schema.md:17,42,64`). Tested in Task 2 against make-explainer's own validator.
5. **A planted defect the mechanical review already catches.** Then the proof proves nothing about the reviewer. Each bad fixture must run with `ok: true` and no finding on its planted shot. Tested in Task 5.
6. **A reviewer that says "fail" about everything.** It would find every planted defect. The pass bar counts false fails on the good film; the scorer's own tests include that case. Tested in Task 5.

## File Structure

- Create `engine/page/playhead.mjs`; `P/agents/motion-reviewer.md`; `P/eval/fixtures/review/` (five films, one picture, `planted.json`), `P/eval/review-score.mjs`, `P/eval/review-proof.mjs`, `P/eval/test/review-score.test.mjs`, `P/eval/test/review-fixtures.test.mjs`.
- Modify `scripts/v2/cli.mjs`, `scripts/v2/run.mjs:117-140,487`, `scripts/v2/plan.mjs`, `scripts/v2/sheets.mjs:22-56,82-95`, `scripts/v2/report.mjs`, `scripts/storyboard.mjs:19-37,116-131`, `scripts/v2/storyboard.mjs:75-107`, `engine/page/viewer.mjs:26-35,60-103,138-154`, `P/shared/agents.mjs`, `P/bin/install.mjs:260-270`, `references/story.md`, `references/reviewing.md` (made by W1), `references/schema.md`, `P/eval/README.md`, `P/bin/test/make-motion-docs.test.mjs:210`.
- Tests: `test/v2/board.test.mjs`, `board-browser.test.mjs`, `storyboard.test.mjs`, `playhead.test.mjs`, `viewer-browser.test.mjs`; `P/shared/test/agents.test.mjs`, `P/bin/test/install.test.mjs`, `P/bin/test/delegation.test.mjs`.

---

### Task 1: `--estimated`: sheets and board strips with no voice

**Files:**
- Modify: `scripts/v2/cli.mjs:8-41,158-170`, `scripts/v2/run.mjs:117-140,487`, `scripts/v2/plan.mjs`, `scripts/v2/sheets.mjs:22-56,82-95`, `scripts/v2/report.mjs:125-131`, `references/schema.md:142`, `P/bin/test/make-motion-docs.test.mjs:210` (add `board: []` to `full`)
- Test: `test/v2/board.test.mjs`, `test/v2/board-browser.test.mjs`, `test/v2/cli-hints.test.mjs`

**Interfaces:**
- Produces:
  - `--estimated` (boolean), allowed only beside `--sheets-only`; alone it is the usage error `--estimated needs --sheets-only: it writes the sheets on estimated timing, with no voice`. `options.estimated`.
  - With it, a voiced film makes no voice (`run.mjs:487` also tests `options.estimated`), the timeline is the word-count estimate, `report.timed` is `'estimated'`, `report.voice` is `null`, and the run logs `make: --estimated: no voice was made; the sheets and the board use estimated timing`.
  - `BOARD_PER_STRIP = 6`, `BOARD_COLUMNS = 3`, `BOARD_JPEG_QUALITY = 80`, `BOARD_STRIP_WIDTH = 1920`.
  - `planBoard(film, timeline): { name: string, tiles: { frame, t, label }[] }[]` in `plan.mjs`: one tile per shot at the frame its phone tile uses (`plan.mjs:63`, 85% of the shot), six to a strip, named `board-1.jpg`, `board-2.jpg` and on.
  - `writeBoard({ session, dir }): Promise<string[]>` in `sheets.mjs`: the strips, each tile stamped as a sheet tile is, as JPEGs in `<sheets dir>/board/`. It removes only `board-*.jpg` files it is about to replace.
  - Report key `board` (only with `--estimated`): the strip paths, in order.

- [ ] **Step 1: Write the failing tests**

```js
// board.test.mjs (no browser)
test('--estimated needs --sheets-only', () => {
  assert.throws(() => parseMakeArgs(['f.json', '--estimated']), /--estimated needs --sheets-only/);
  assert.equal(parseMakeArgs(['f.json', '--sheets-only', '--estimated']).estimated, true);
});
test('the board is one tile per shot at its late frame, six to a strip', () => {
  const strips = planBoard(SEVEN_SHOT_FILM, timeline);
  assert.deepEqual(strips.map((s) => [s.name, s.tiles.length]), [['board-1.jpg', 6], ['board-2.jpg', 1]]);
  assert.equal(strips[0].tiles[0].frame, planSheets(SEVEN_SHOT_FILM, timeline)[0].tiles.at(-1).frame); // the phone tile's frame
});
// board-browser.test.mjs [browser], a two-shot film with "voice": { "name": "af_heart" }
test('--sheets-only --estimated makes no voice, says estimated, and writes the strips', async (t) => {
  const { report, exitCode } = await runMake({ specPath, noRender: true, estimated: true, out },
    { browser, synthesise: () => { throw new Error('the voice was made'); } });
  assert.equal(exitCode, 0); assert.equal(report.timed, 'estimated'); assert.equal(report.voice, null);
  assert.equal(report.board.length, 1);
  assert.ok(statSync(report.board[0]).size < 1.5e6);
  assert.deepEqual(readFileSync(report.board[0]).subarray(0, 3), Buffer.from([0xff, 0xd8, 0xff])); // a JPEG
});
test('--sheets-only alone still makes the voice', async (t) => { /* the same film without estimated: the injected synthesise is called once */ });
```

- [ ] **Step 2: Run and see them fail** — `node --test "<MM>/test/v2/board.test.mjs"`; expected FAIL: `planBoard is not a function`.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see them pass** — `node --test "<MM>/test/v2/board.test.mjs" "<MM>/test/v2/cli-hints.test.mjs"`, then **[browser]** `node --test --test-concurrency=1 "<MM>/test/v2/board-browser.test.mjs"`, then `node --test "<P>/bin/test/make-motion-docs.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w5): --sheets-only --estimated writes the sheets and a board with no voice`.

### Task 2: The board's pictures in the storyboard page

**Files:**
- Modify: `scripts/storyboard.mjs:19-37,116-131`, `scripts/v2/storyboard.mjs:75-107`, `references/story.md` (a short "A board with pictures" paragraph under W1's "Three storylines" heading, with no new `##` heading because W1's test pins the exact heading list: the two commands)
- Test: `test/v2/storyboard.test.mjs`

**Interfaces:**
- Consumes: the strips of Task 1; make-explainer's `image` section, `{ type: 'image', src, alt, caption? }` with `src` and `alt` required (`EX/scripts/lib/schema.mjs:172`).
- Produces:
  - `node scripts/storyboard.mjs <film.json> --out <plan.json> --stills <dir>`: `<dir>` holds `board-<n>.jpg` files (Task 1's `board/` folder). Each is copied to `<plan folder>/<plan stem>.stills/board-<n>.jpg`. A folder with no `board-*.jpg`, a symbolic link, or a strip over 1.5 MB is exit 2 naming the file and what is accepted. The script still starts no browser and makes no voice.
  - `storyboardPlan(film, timeline, { name, looks, stills = [] })`: `stills` are paths relative to the plan's folder. After the `timeline` section, one `image` section per strip: `title: 'Shots <first id> to <last id> as drawn'`, `label: 'Pictures'`, `src`, `alt: 'Shots <ids> of the draft film'`, `caption: 'Estimated timing: no voice was made yet, so each shot is as long as its word count says.'`. With no stills the plan is what it is today.
  - With stills, a second stdout line after the path: `storyboard: the pictures and the times are on estimated timing (no voice was made)`.

- [ ] **Step 1: Write the failing test**

```js
test('with stills the plan gains one image section per strip, after the shots, each saying the timing is estimated', () => {
  const plan = storyboardPlan(film, timeline, { name: 'demo', looks, stills: ['demo.stills/board-1.jpg', 'demo.stills/board-2.jpg'] });
  const images = plan.sections.filter((s) => s.type === 'image');
  assert.equal(images.length, 2);
  assert.equal(plan.sections.indexOf(images[0]), plan.sections.findIndex((s) => s.type === 'timeline') + 1);
  for (const image of images) assert.match(image.caption, /^Estimated timing: no voice was made yet/);
  assert.equal(plan.sections.at(-1).type, 'verdict');
});
test('without stills the plan is unchanged', () => assert.deepEqual(storyboardPlan(film, timeline, { name: 'demo', looks }), BEFORE)); // BEFORE: this call's result recorded before the change
test('--stills copies the strips beside the plan, and make-explainer\'s validator accepts the page', (t) => {
  if (EXPLAINER_SKIP) return t.skip(EXPLAINER_SKIP);
  const code = main([filmFile, '--out', planFile, '--stills', boardDir], { out, err });
  assert.equal(code, 0);
  assert.ok(existsSync(path.join(path.dirname(planFile), 'plan.stills', 'board-1.jpg')));
  assert.equal(spawnSync(process.execPath, [VALIDATE, planFile]).status, 0);
  assert.ok(lines.includes('storyboard: the pictures and the times are on estimated timing (no voice was made)\n'));
});
test('a 60-shot film stays within the page\'s 40 sections', () => assert.ok(storyboardPlan(SIXTY, t60, { name: 'big', looks, stills: TEN }).sections.length <= 40));
test('a folder with no strips, a link, and a strip over 1.5 MB each exit 2 naming the file', () => { /* three main() calls */ });
```

`EXPLAINER_SKIP` and `VALIDATE` are the ones this test file already has (`test/v2/storyboard.test.mjs:19-22`). The board JPEGs for this test are small files written by the test, not rendered.

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/storyboard.test.mjs"`; expected FAIL: no `image` section.
- [ ] **Step 3: Implement** the signatures above. If make-explainer's validator refuses an `image` section on a `plan` page, stop and report its message: this wave does not change make-explainer.
- [ ] **Step 4: Run and see it pass** — the same command, `node --test "<MM>/test/storyboard.test.mjs"`, and `node --test "<P>/bin/test/make-motion-docs.test.mjs"`; expected PASS.
- [ ] **Step 5: One real board, viewed [browser].** With no other browser live: `node <MM>/scripts/make.mjs <MM>/references/examples/v2/voiced-desk.json --sheets-only --estimated --json --out <scratch>/board/voiced-desk.mp4`, then `node <MM>/scripts/storyboard.mjs <that film> --out <scratch>/board/plan.json --stills <the board folder>`, then make-explainer's build line as printed. Open the page and say in the task report what the pictures show and where the page says the timing is estimated. (That film is under 20 s only if the storyboard prints `skipped`; use `showreel-pro.json` then.)
- [ ] **Step 6: Commit** `feat(w5): the storyboard page shows the board's pictures and says they are estimated`.

### Task 3: The preview keeps its frame and play state through a reload

**Files:**
- Create: `engine/page/playhead.mjs`, `test/v2/playhead.test.mjs`
- Modify: `engine/page/viewer.mjs:26-35` (`poll`), `:85-94` (`play`), `:138-154` (`main`)
- Test: `test/v2/viewer-browser.test.mjs`

**Interfaces:**
- Produces:
  - `encodePlayhead({ frame: number, playing: boolean }): string`, `'#f=<frame>&p=<0|1>'`.
  - `decodePlayhead(hash: string, frameCount: number): { frame: number, playing: boolean } | null`: `null` for an empty or unreadable fragment; `frame` held inside 0 to `frameCount - 1`.
  - `poll`: when a new version is up and the page has a player (`window.__viewer`), it calls `history.replaceState(null, '', encodePlayhead({ frame: p.frame, playing: p.playing }))`, then the `location.reload()` it calls today (`viewer.mjs:30`). With no player (the error page) the fragment is left as it is.
  - `main`: after the controls exist, it draws `decodePlayhead(location.hash, info.frameCount)?.frame ?? 0` in place of frame 0, and starts playing when `playing` was true.
  - `play`: a refused `audio.play()` pauses the player (today the rejection is swallowed, `viewer.mjs:90`).

- [ ] **Step 1: Write the failing tests**

```js
// playhead.test.mjs (no browser)
test('a playhead round-trips', () => assert.deepEqual(decodePlayhead(encodePlayhead({ frame: 40, playing: true }), 60), { frame: 40, playing: true }));
test('the written form is #f=<frame>&p=<0|1>', () => assert.equal(encodePlayhead({ frame: 7, playing: false }), '#f=7&p=0'));
test('a frame past the end is the last frame; a negative one is 0', () => {
  assert.equal(decodePlayhead('#f=99&p=0', 30).frame, 29);
  assert.equal(decodePlayhead('#f=-4&p=0', 30).frame, 0);
});
test('no fragment, or one that is not a playhead, is null', () => {
  for (const hash of ['', '#', '#top', '#f=abc&p=1', '#f=1.5&p=0']) assert.equal(decodePlayhead(hash, 30), null, hash);
});
// viewer-browser.test.mjs [browser], added after the existing tests, on the page the file already opens
test('an edit reloads the page on the frame it was showing', async (t) => {
  await page.$eval('#scrub', (el) => { el.value = '40'; el.dispatchEvent(new Event('input')); });
  await frameShown(40);
  writeFilm(filmOf('#dfe6ee'));                       // the same length, a new ground
  await page.waitForFunction(() => window.__viewer?.p.frame === 40 && document.body.dataset.ready === 'true' && location.hash === '#f=40&p=0');
  assert.equal(await sourceHash(page), await hashOnRenderPage(40)); // the new film's frame 40
});
test('a film that got shorter clamps to its last frame', async (t) => { /* writeFilm with each hold 0.5 (30 frames): window.__viewer.p.frame === 29 */ });
test('an edit that does not validate keeps the frame for the edit that fixes it', async (t) => { /* seek 20; write an invalid film; wait for body.invalid; write the valid film; frame === 20 */ });
test('a playing silent film is playing again after the reload', async (t) => { /* page.click('#play'); rewrite; after ready: window.__viewer.p.playing === true */ });
test('when the browser refuses to play the sound, the player is paused, not stuck', async (t) => {
  /* a film with "sound": "on"; context.addInitScript sets HTMLMediaElement.prototype.play = () => Promise.reject(new Error('NotAllowedError'));
     load with #f=10&p=1: window.__viewer.p.playing === false, the button reads Play, the frame is 10 */
});
```

- [ ] **Step 2: Run and see them fail** — `node --test "<MM>/test/v2/playhead.test.mjs"`; expected FAIL, module not found.
- [ ] **Step 3: Implement** the signatures above. `playhead.mjs` is pure (no `document`, no `location`): `viewer.mjs` passes the strings in.
- [ ] **Step 4: Run and see them pass** — `node --test "<MM>/test/v2/playhead.test.mjs" "<MM>/test/v2/purity.test.mjs"`, then **[browser]** `node --test --test-concurrency=1 "<MM>/test/v2/viewer-browser.test.mjs"` and `"<MM>/test/v2/viewer-server.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w5): the preview keeps its frame and play state through a reload`.

### Task 4: The reviewer agent file

**Files:**
- Modify: `P/shared/agents.mjs`, `P/bin/install.mjs:260-270` (`installAgents`), then `node <P>/bin/sync-shared.mjs`
- Create: `P/agents/motion-reviewer.md`
- Test: `P/shared/test/agents.test.mjs`, `P/bin/test/install.test.mjs`, `P/bin/test/delegation.test.mjs`

**Interfaces:**
- Produces (in `P/shared/agents.mjs`, beside the operator's; the operator's exports and its CLI do not change):
  - `REVIEWER_NAME = 'motion-reviewer'`, `REVIEWER_HOSTS = ['claude']`, `REVIEWER_INSTRUCTIONS: string`, `reviewerFile(host): { fileName, content }` (throws for a host not in `REVIEWER_HOSTS`).
  - Claude Code file `motion-reviewer.md`, frontmatter `name: motion-reviewer`, a one-line `description`, `model: opus` (the reviewer tier; an agent file pins its model, AGENTS.md), `tools: Read`. It can read the film, the report and the sheet PNGs, and change nothing. `Read` opens a file and cannot list a folder, so the brief never names one.
  - The brief it is given: the skill directory, the film path and the path of the report saved as a JSON file, whose `sheets` array names every PNG to open. Nothing else. Its checklist is `<skill-dir>/references/reviewing.md`, W1's protocol, whose four sections (`Notes`, `Never score`, `Pictures alone`, `Delivery`) are the contract (w1 plan, Task 4): the instructions tell it to read that file first and do not restate it.
  - What it returns, and only this, as JSON: `{ "verdict": "pass" | "fail", "notes": [{ "level": "P0" | "P1" | "P2", "shot": "<shot id>", "time": <film seconds>, "problem": "<what a stranger sees>", "change": "<the field to change>" }], "weakest": "<shot id>", "unchecked": ["<what it could not judge>"] }`. `verdict` is `fail` when any note is P0 or P1. `weakest` and `unchecked` are two of W1's delivery lines.
  - `REVIEWER_INSTRUCTIONS` must hold these phrases, which the tests pin: `You are already motion-reviewer`, `Never delegate`, `references/reviewing.md`, `Never score`, `P0`, `P1`, `P2`, `pictures alone`, `You cannot listen`, `"verdict"`, `"weakest"`, `"unchecked"`, `Reply with only`. The wording is the implementer's, in plain sentences, with no three single quotes in a row.
  - `P/agents/motion-reviewer.md` equals `reviewerFile('claude').content`, as the operator's file equals `agentFile('claude').content`.
  - `install.mjs`: a `claude` install (and `--agents-only`) also writes `motion-reviewer.md` into the same agents folder, kept if present unless `--force`. Copilot, Codex and Gemini installs write no reviewer file: on those hosts the director reviews with the same checklist.

- [ ] **Step 1: Write the failing tests**

```js
// P/shared/test/agents.test.mjs
test('the reviewer is motion-reviewer, for Claude Code only', () => {
  assert.equal(REVIEWER_NAME, 'motion-reviewer'); assert.deepEqual([...REVIEWER_HOSTS], ['claude']);
  assert.throws(() => reviewerFile('codex'), /unknown reviewer host: codex/);
});
test('the reviewer file pins its model and can only read', () => {
  const { fileName, content } = reviewerFile('claude');
  assert.equal(fileName, 'motion-reviewer.md');
  assert.match(content, /^---\nname: motion-reviewer\ndescription: [^\n]+\nmodel: opus\ntools: Read\n---\n/);
});
test('the reviewer instructions hold the protocol', () => {
  for (const phrase of ['You are already motion-reviewer', 'Never delegate', 'references/reviewing.md', 'Never score', 'P0', 'P1', 'P2', 'pictures alone', 'You cannot listen', '"verdict"', '"weakest"', '"unchecked"', 'Reply with only']) assert.ok(REVIEWER_INSTRUCTIONS.includes(phrase), phrase);
  assert.ok(!REVIEWER_INSTRUCTIONS.includes("'''"));
});
// P/bin/test/delegation.test.mjs
test('the plugin ships the reviewer file, equal to what shared/agents.mjs builds', () => {
  assert.equal(fs.readFileSync(path.join(SKILLS, '../agents/motion-reviewer.md'), 'utf8'), reviewerFile('claude').content);
});
test('no SKILL.md names the reviewer in its Director and operator section', () => {
  for (const skill of DELEGATING) assert.ok(!section(read(skill)).includes('motion-reviewer'), skill);
});
// P/bin/test/install.test.mjs
test('a claude install writes motion-reviewer.md beside artifact-builder.md; copilot and codex installs write none', () => { /* three installs into temp HOMEs */ });
test('an existing motion-reviewer.md is kept unless --force', () => { /* as the operator's kept test, install.test.mjs:778-800 */ });
```

- [ ] **Step 2: Run and see them fail** — `node --test "<P>/shared/test/agents.test.mjs"`; expected FAIL, `REVIEWER_NAME` is undefined.
- [ ] **Step 3: Implement** the signatures above; run `node <P>/bin/sync-shared.mjs`.
- [ ] **Step 4: Run and see them pass** — `node <P>/bin/sync-shared.mjs --check`; `node --test "<P>/shared/test/*.test.mjs"`; `node --test "<P>/bin/test/*.test.mjs"`; `claude plugin validate <P>`; expected PASS.
- [ ] **Step 5: Commit** `feat(w5): a read-only motion-reviewer agent file, installed for Claude Code`.

### Task 5: Planted-defect fixtures, the scorer and the proof

**Files:**
- Create: `P/eval/fixtures/review/good.json`, `number-mismatch.json`, `chart-wrong-mark.json`, `picture-contradicts.json`, `orphan-shot.json`, `two-squares.png`, `planted.json`; `P/eval/review-score.mjs`, `P/eval/review-proof.mjs`, `P/eval/test/review-score.test.mjs`, `P/eval/test/review-fixtures.test.mjs`
- Modify: `P/eval/README.md` (a "Reviewer proof" section), `references/reviewing.md`, `P/bin/test/delegation.test.mjs`; after a run, `P/eval/results/summary-motion-reviewer-<date>.md` and a row in `P/eval/results/INDEX.md`

**Interfaces:**
- Consumes: `reviewerFile` (Task 4); the eval harness's `claude-director` host, which writes agent files into `<work>/.claude/agents/` and whose session stream says which agent ran (`P/eval/README.md`, "The `claude-director` host"; `P/eval/session.mjs`).
- Produces:
  - The fixtures. `good.json`: `desk`, four shots with ids `claim` (statement), `figure` (number), `chart` (chart, one highlighted mark), `ask` (end), each line naming what is on screen. Each bad film is `good.json` with one change:
    - `number-mismatch.json`: `figure` says "forty two percent" and shows `value: 24`.
    - `chart-wrong-mark.json`: `chart` says March was the peak; the highlighted mark is May.
    - `picture-contradicts.json`: a fifth shot `look` (a `clipping` of `two-squares.png`, a red square top left, a blue one bottom right) says "the red button" while its highlight marks the blue square's region.
    - `orphan-shot.json`: a fifth shot `aside` between `chart` and `ask` about an unrelated subject.
  - `planted.json`: `{ "number-mismatch": { "shot": "figure" }, "chart-wrong-mark": { "shot": "chart" }, "picture-contradicts": { "shot": "look" }, "orphan-shot": { "shot": "aside" } }`.
  - `PROOF_RUNS = 3`, `MAX_FALSE_FAILS = 1`.
  - `scoreProof(results: { fixture: string, run: number, verdict: 'pass' | 'fail', notes: { level: string, shot: string }[] }[], planted, { runs = PROOF_RUNS }): { found: Record<string, number>, falseFails: number, pass: boolean, problems: string[] }`. A planted defect is found in a run when the verdict is `fail` and a P0 or P1 note names the planted shot. `pass` when every planted defect is found in all `runs` runs and the good film has at most `MAX_FALSE_FAILS` `fail` verdicts across its runs. A missing run is a problem, never a pass.
  - `node <P>/eval/review-proof.mjs --runs 3 --budget <usd> [--sheets <dir>]`: for each fixture, the reviewer is run `runs` times on the film, its report and its sheets through the `claude-director` mechanism, each reply parsed as the JSON of Task 4, the results written to `P/eval/results/<timestamp>/motion-reviewer/results.json` with the `scoreProof` verdict and, from the session stream, the agent name and model that ran. Without `--budget` it refuses to start. It renders nothing: the sheets are made beforehand (Step 4).
  - Only when a proof has passed: `references/reviewing.md` gains a `## Second reviewer` section after W1's four (its order test reads those four) (pinned phrases: `motion-reviewer`, `optional`, `list of available agents`, `review it yourself with the same checklist`, `sheets`, and the date of the passing proof), and `delegation.test.mjs` requires that section. Until then `reviewing.md` does not name the agent, and a test holds that.

- [ ] **Step 1: Write the failing tests**

```js
// review-score.test.mjs
const ALL_FOUND = [...bad.flatMap((f) => [1, 2, 3].map((run) => ({ fixture: f, run, verdict: 'fail', notes: [{ level: 'P0', shot: PLANTED[f].shot }] }))),
  ...[1, 2, 3].map((run) => ({ fixture: 'good', run, verdict: 'pass', notes: [] }))];
test('every defect found in every run and a clean good film passes', () => assert.equal(scoreProof(ALL_FOUND, PLANTED).pass, true));
test('one false fail on the good film still passes; two do not', () => {
  assert.equal(scoreProof(withGoodFails(ALL_FOUND, 1), PLANTED).pass, true);
  assert.equal(scoreProof(withGoodFails(ALL_FOUND, 2), PLANTED).pass, false);
});
test('a defect missed in one run fails, naming the fixture and the run', () => {
  const out = scoreProof(missing(ALL_FOUND, 'chart-wrong-mark', 2), PLANTED);
  assert.equal(out.pass, false); assert.equal(out.found['chart-wrong-mark'], 2);
  assert.match(out.problems[0], /chart-wrong-mark: run 2/);
});
test('a fail verdict that names another shot, or only at P2, is not a find', () => { /* two cases: found is 2 of 3 */ });
test('a reviewer that fails everything does not pass', () => { /* every fixture, good included, verdict fail: falseFails 3, pass false */ });
test('a run that is absent is a problem, not a pass', () => { /* drop one result: pass false, problems names it */ });
// review-fixtures.test.mjs (no browser)
test('the five films validate, and each bad film differs from the good one only at its planted shot', () => {
  for (const name of FIXTURES) assert.deepEqual(validateFilm(read(name), { specDir }).errors, [], name);
  for (const [name, { shot }] of Object.entries(PLANTED)) assert.deepEqual(changedShots(read('good'), read(name)), [shot], name);
});
test('references/reviewing.md names the reviewer only once a passing proof is recorded', () => {
  assert.equal(read('references/reviewing.md').includes('motion-reviewer'), fs.existsSync(PASSING_SUMMARY));
});
```

- [ ] **Step 2: Run and see them fail** — `node --test "<P>/eval/test/review-score.test.mjs"`; expected FAIL, module not found.
- [ ] **Step 3: Implement** the films, the scorer and the harness. Read `P/eval/run-eval.mjs`, `hosts.json` and `session.mjs` first and reuse their workdir, budget and stream-reading code; add no second way to start a host.
- [ ] **Step 4: Render the sheets [browser], one film at a time.** `node <MM>/scripts/make.mjs <P>/eval/fixtures/review/<name>.json --sheets-only --json --out <scratch>/review-proof/<name>.mp4`, five calls; save each printed report beside its sheets as `<name>.report.json` with the Write tool (the reviewer's brief names that file). Each report must read `ok: true` with no finding whose `shot` is the planted one; a bad film the mechanical review already catches is replaced with one it does not, and the task report says which.
- [ ] **Step 5: Run and see the tests pass** — `node --test "<P>/eval/test/*.test.mjs"`; expected PASS.
- [ ] **Step 6: The proof. STOP: billed, owner-gated.** State to the owner: 15 sessions on host `claude` (five films, three runs each, the reviewer on the reviewer tier), the `--budget` cap per session, and the pass bar: every planted defect found, at most one false fail on the good film across the proof runs. Run `node <P>/eval/review-proof.mjs --runs 3 --budget <usd> --sheets <scratch>/review-proof` only on a yes given in that turn. Copy the summary to `P/eval/results/summary-motion-reviewer-<date>.md` and add the `INDEX.md` row (plugin version, host CLI version, command line).
- [ ] **Step 7: Act on the result.** Passed: add the `## Second reviewer` section and its delegation test. Failed: at most two rounds of rewording `REVIEWER_INSTRUCTIONS`, each a new 15-session proof with its own yes; after that, or with no yes at all, the agent file ships unnamed in `reviewing.md`, the director reviews alone, and `docs/decisions-pending.md` records the numbers.
- [ ] **Step 8: Commit** `test(w5): planted-defect films and a pass-bar scorer for the reviewer`, then, after Step 7, `docs(w5): reviewing.md names the second reviewer` or `docs(w5): the reviewer stays unlisted`.

### Task 6 (conditional): The motion gate

**Build this task only if W0's row "motion defects" records at least one viewed defect** (`.scratch/motion-steals-w0/results/W0-RESULTS.md`, copied into the PR body; w0 plan, Task 5: one viewed defect switches the gate on). Otherwise skip it and write one line in the wave's PR notes: `motion gate not built: W0 viewed <n> findings on three films, 0 defects`. Build only the rules whose prototype found a viewed defect.

**Files:**
- Create: `engine/review/motion.mjs`, `test/v2/review-motion.test.mjs`
- Modify: `engine/page/stage.mjs:150-174` (`window.__motionTrace`), `scripts/v2/review.mjs:378-389`, `scripts/v2/plan.mjs` and `scripts/v2/sheets.mjs` (one strip per finding), `engine/review/rules.mjs`, `references/rules.md`

**Interfaces:**
- Consumes: `__heldFlags(a, b, false)` (the frames where something moves), `resolveShotCut`, the registry and `CAPPED_HERE` (W3), and W0's three prototype rules with their thresholds (`.scratch/motion-steals-w0/motion-rules.mjs`; w0 plan, Task 5), rewritten here as engine code with the path in the constants' comment.
- Produces:
  - `window.__motionTrace(from, to): { frame, nodes: { id, bbox, opacity, step?: number, steps?: true }[] }[]`: for each frame that is not held, every node's box, accumulated opacity, its `step` rate when it has one (`engine/graph/node.mjs:68-71`) and whether it is a count (`props.steps`, `engine/review/frame.mjs:318`).
  - `POP_OPACITY = 0.9`, `POP_MIN_AREA = 0.005` (of the canvas), `JUMP_UNITS = 40`, `JUMP_REST_UNITS = 4`, `FLASH_FRAMES = 2`: W0's values.
  - `motionFindings(trace, { timeline, film, look, fps }): finding[]`, up to three rules, all creative and capped:
    - `pop-in`: a node is first seen at `POP_OPACITY` or more of full opacity, its box over `POP_MIN_AREA`, with no frame at a lower opacity before it.
    - `jump`: a box centre moves more than `JUMP_UNITS` in one frame and under `JUMP_REST_UNITS` in the next.
    - `flash`: a node is on screen for `FLASH_FRAMES` frames or fewer.
  - Exemptions, each read from data, never from a look's name: a pair of frames that straddles a shot's first frame, or lies inside a cut's window, is not compared (a hard cut has no window); a node with `step` is compared at its own rate (`desk`'s marks step at `HAND_STEP`, `engine/looks/desk.mjs:9,45-46`); a count (`steps`) is never a `pop-in` or a `flash`; a look whose `moves.slam.dur` is 0 allows a part to appear at once (`engine/moves/index.mjs:10`); a look with `hand` data draws without fades, so `pop-in` is off for it.
  - Each finding gets one strip of five frames around it (`motion-<shot>-<frame>.png`).

- [ ] **Step 1: Failing test**, one synthetic trace per rule and per exemption: a node at opacity 0 then 1 on a locked look is `pop-in`; the same pair across a shot's first frame is not; the same node with `steps` is not; on a look whose `slam.dur` is 0 it is not; a box that moves 60 units in one frame and 0 in the next is `jump`, and with `step: 12` it is not; a node on screen for two frames mid-shot is `flash`.
- [ ] **Step 2: Run** `node --test "<MM>/test/v2/review-motion.test.mjs"`; expected FAIL, module not found.
- [ ] **Step 3: Implement.** **Step 4: Run; PASS**, with `review-rules.test.mjs` (one registry row, one `references/rules.md` row and one `CAPPED_HERE` entry per rule built; raise that test's rule-count assertion by the number of rules built, review fix).
- [ ] **Step 5: Calibrate [browser], one film at a time,** on `gate-desk.json`, `gate-pop.json` and `gate-marker.json` with `--sheets-only --json`: every finding's strip is opened; a finding on intended motion is a false positive to fix in the exemptions, not in the film. Put the counts and the review's added seconds per film in the task report (the trace is up to 7.5 times more snapshots, `PROPOSAL.md` item 13; that figure is an estimate).
- [ ] **Step 6: Commit** `feat(w5): a motion gate for pops, jumps and flashes`, and append to the Rune bullet of `THIRD_PARTY_NOTICES.md` (MIT): a motion gate over per-frame boxes (W5).

### Task 7: Wave gate

- [ ] **Step 0:** The flag pins. `--estimated` changes `FLAGS` and the usage line (`scripts/v2/cli.mjs:8-9`); `--stills` changes `storyboard.mjs`'s usage (`scripts/storyboard.mjs:19-21`). Search `test/help.test.mjs`, `test/cli-contract.test.mjs`, `test/storyboard.test.mjs`, `P/eval/test/make-contract.test.mjs` and `P/eval/test/docs-facts.test.mjs` for what pins them and update it in the commit that added each.
- [ ] **Step 1:** Run what CI runs for this area, one command per call: `node <P>/bin/sync-shared.mjs --check`; `node --test "<P>/shared/test/*.test.mjs"`; `node --test "<P>/bin/test/*.test.mjs"`; `node --test "<P>/eval/test/*.test.mjs"`; `python3 -m pytest tests/pytest`; `claude plugin validate .` and `claude plugin validate <P>`; the Node-only files this wave touched; then **[browser]**, one at a time, `board-browser`, `viewer-browser`, `viewer-server`, `make`.
- [ ] **Step 2:** Fresh-context review (reviewer tier, medium), report only, never writing session logs or project docs, given the wave's diff, this plan's Review Focus and the security lens (`storyboard.mjs --stills` copies files a user names; the installer writes a second agent file; the preview reads a URL fragment). Its prompt carries this sentence verbatim: "Report every issue you find, including ones you are uncertain about or consider low-severity. Do not filter for importance or confidence at this stage — a separate verification step will do that. Your goal here is coverage: it is better to surface a finding that later gets filtered out than to silently drop a real bug. For each finding, include your confidence level and an estimated severity so a downstream filter can rank them."
- [ ] **Step 3:** The controller fixes every CRITICAL and HIGH with a test that failed first (`fix(w5):`), then pushes the wave's commits.
- [ ] **Step 4:** For the final phase, record: flags `--estimated` and `storyboard.mjs --stills`; report key `board`; the preview's playhead; the `motion-reviewer` agent and whether its proof passed; on the manual checklist: edit a film while its preview plays with sound and confirm it resumes or shows Play.

## Self-review notes

- Spec coverage: P9 (Tasks 1, 2), P14 (Task 3), P7's reviewer (Tasks 4, 5; the protocol prose is W1's), P13 (Task 6, conditional).
- Decisions the owner should check: voice-skipping is `--estimated` beside `--sheets-only`, not a change to `--sheets-only`; the board is strips of six shots, not one still per shot (the plan page holds 40 sections); the reviewer is a Claude Code agent only, on the reviewer tier, read-only; four planted defects and three runs make 15 billed sessions; `reviewing.md` names the reviewer only after a passing proof.
