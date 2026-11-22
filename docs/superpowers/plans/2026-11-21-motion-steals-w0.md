# Motion steals W0: Measurements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace seven inferred claims about make-motion (colour tags, where a frame's time goes, audio offset, two faster capture paths, motion defects, strobing, held-frame reuse) with measured results, so the later waves build only what a measurement supports.

**Architecture:** Everything but one test is a scratch script under `.scratch/motion-steals-w0/` that writes one result file under `results/`. The scripts import make-motion's own modules by absolute path (the session, the film loader, the encoder arguments), so they measure the shipped code and change none of it. The one committed file is a browser test that pins held-frame reuse. The results table goes into the master plan's W0 table and the pull request body, and each row switches a later item on or off (master plan, "W0 result decisions").

**Tech Stack:** Node >= 20 ESM, `node:test`, Playwright Chromium (make-motion's pinned 1.64.0), ffmpeg and ffprobe (system). No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-21-motion-steals-design.md` section 6, "W0, measurements". Measurement list and what each decides: `.scratch/research-2026-11-21/PROPOSAL.md` section 4, "Wave 0". Master plan: `docs/superpowers/plans/2026-11-21-motion-steals.md`.

Abbreviations (write each out in full in a command): `R` = `/Users/abhijitbansal/projects/portable-artifacts/.claude/worktrees/new-improvements`, `P` = `R/plugins/portable-artifacts`, `MM` = `P/skills/make-motion`, `X` = `MM/references/examples/v2`, `G` = `R/docs/showcase/portable-artifacts/gallery`, `S0` = `R/.scratch/motion-steals-w0`.

## Global Constraints

- `MM/SKILL.md` is 20,898 bytes against a 20,900-byte budget pinned in `plugins/portable-artifacts/bin/test/skill-budget.test.mjs`; slim, never raise the cap. W0 does not touch it.
- No new runtime dependency, no network use, no generative-video call from `make.mjs`.
- No new server route (the preview server is GET and HEAD only). The `evaluate` capture arm returns bytes through `page.evaluate`, never through a route.
- One headless browser at a time: `pgrep -fl chrome-headless-shell` before every step marked **[BROWSER]**, and wait if it lists anything. Browser tests run with `--test-concurrency=1`. Steps marked **[BROWSER]** are run one after another by one executor, never in parallel.
- W0 changes no file under `plugins/` except the one new test in Task 7. Scratch stays under `S0` (gitignored). A subagent never runs `rm`; it leaves scratch in place and lists it in its report.
- Goldens change only for an intended visual change, stated in the commit. W0 changes none.
- No code from beast_explainer. HyperFrames (Apache-2.0) and Rune (MIT) ideas are rewritten in our own code; no file is ported.
- Every guardrail is shown failing first (RED), then passing. Task 7's test passes on today's code by design; Task 7 says how it is proven to bite.
- Commits: conventional, prefixed `test(w0):` or `docs(w0):`, staging named files only, ending with exactly one trailer line `Co-Authored-By: Claude <noreply@anthropic.com>` and no `Claude-Session` line (the `commit-trailers` CI job fails otherwise). Implementers do not commit; the controller commits.
- Shell rules: one plain command per Bash call with literal absolute paths; no `cd`, `&&`, pipes, `;`, shell variables, loops or heredocs; quote globs; scripts are written with the Write tool; noisy commands run bare; no `sleep`, no `timeout`. A command that may run longer than 10 minutes is started in the background.
- Every number in a result file names the command that produced it. A result nobody viewed (a strip, a poster) is recorded as "not viewed", never as passed.
- Implementers are executor tier (Sonnet, effort high); the reviewer is Opus at medium.

## Review Focus

1. **A measurement that measures the script, not the product.** A scratch script that re-implements the capture loop can time something the render never does. Each timing script calls `encoderArgs`, `openSession` and `loadFilm` from `MM/scripts/v2/` and the page's own `__seek` and `__heldFlags`; the review checks the imports.
2. **A second browser.** Two **[BROWSER]** steps overlapping wedged this Mac once. Every such step starts with the `pgrep` check and its result line is in the report.
3. **A fixed film that is not fixed.** Timings compare only on the same film, frame count and capture count. Every result row carries `frames` and `captured`; a run whose counts differ from the first is discarded and rerun.
4. **A held-frame test that cannot fail.** A film with no held frame, or a comparison of a frame with itself, passes vacuously. Task 7 asserts that held frames exist and proves the comparison detects a weak key.
5. **A decision with no threshold.** Each result is compared with the number in the master plan's decision table, written before the run. A result is never judged "good enough" after the fact.

## File Structure

- `S0/probe-tags.mjs`, `S0/time-split.mjs`, `S0/capture-spike.mjs`, `S0/make-click.mjs`, `S0/audio-offset.mjs`, `S0/dump-snapshots.mjs`, `S0/motion-rules.mjs`, `S0/slam-strip.mjs`, `S0/phase-sweep.mjs`: one job each, each prints the path of the file it wrote.
- `S0/out/`: rendered MP4s. `S0/audio/`: the click track and its film. `S0/results/`: one result file per measurement, plus `results/W0-RESULTS.md`, the table the pull request body carries.
- `MM/test/v2/held-frames-browser.test.mjs`: the one committed file.

---

### Task 1: The fixed film, twice, and the colour tag table

**Files:**
- Create: `S0/probe-tags.mjs`
- Read: `MM/scripts/v2/render.mjs:41-58` (today's encoder arguments), `X/kinds-desk.json` (the fixed film: `MM/scripts/v2/workers.mjs:3-4` records 1027 frames and 59.72 s of capture for it)

**Interfaces:**
- Produces: `S0/out/fixed-fast.mp4`, `S0/out/fixed-exact.mp4` and their reports `S0/results/fixed-fast.report.json`, `S0/results/fixed-exact.report.json` (Tasks 2 and 3 compare their counts with these); `S0/results/tags.json` as `[{ file, spec: 'v1' | 'v2' | 'w0', pix_fmt, color_space, color_primaries, color_transfer, color_range }]` and `S0/results/tags.md`, the same as a table.
- `node S0/probe-tags.mjs` takes no argument. It lists every `video.mp4` under `G` (31 expected) and the two files in `S0/out/`, and runs `ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt,color_space,color_primaries,color_transfer,color_range -of json <file>` for each. A field ffprobe leaves out is written as `unknown`. `spec` is `v2` when a `film.json` sits beside the file, `v1` when a `motion.json` does, `w0` for the two renders.

- [ ] **Step 1: Check the machine.** Run `node MM/scripts/doctor.mjs --json`. Expected: nothing missing for a silent render (Node packages, Chromium, ffmpeg with ffprobe). If something is missing, stop and report it; do not install.
- [ ] **Step 2: Render fast. [BROWSER]** Run `node MM/scripts/make.mjs X/kinds-desk.json --json --out S0/out/fixed-fast.mp4`. Expected: exit 0, `capture: "fast"`, `frames: 1027`. Write the JSON it printed to `S0/results/fixed-fast.report.json` with the Write tool. If `frames` is not 1027, record the number and use it as the fixed count from here on.
- [ ] **Step 3: Render exact. [BROWSER]** The same command with `--exact` and `--out S0/out/fixed-exact.mp4`. Expected: exit 0, `capture: "exact"`, the same `frames` and `captured` as Step 2.
- [ ] **Step 4: Write `probe-tags.mjs` and run it.** Expected: 33 rows. Known from the research and to be confirmed: `sql-guard-explainer/video.mp4` reports every colour field as `unknown`; `looks/keynote/video.mp4` reports `bt470bg`. A row that disagrees is recorded as measured, with no correction.
- [ ] **Step 5: Record.** In `S0/results/W0-RESULTS.md`, row "colour tags": how many of the 33 files carry `bt709` in all of `color_space`, `color_primaries` and `color_transfer`, how many are fully `unknown`, and the two `w0` rows in full.

### Task 2: Draw, capture and encode time per frame

**Files:**
- Create: `S0/time-split.mjs`
- Read: `MM/scripts/v2/render.mjs:120-147` (the capture loop it mirrors), `MM/scripts/v2/session.mjs:44-81`, `MM/scripts/v2/pipeline.mjs` (`loadFilm`)

**Interfaces:**
- Consumes: the frame and capture counts of Task 1.
- `node S0/time-split.mjs <film.json> --mode fast|exact --out <result.json>` loads the film with `loadFilm`, opens one session with `openSession`, starts ffmpeg with `encoderArgs({ fps, out: S0/out/split-<mode>.mp4, exact })` and walks the frames as `encodeFrames` does: `__heldFlags(from, to, true)` in chunks of 150, then for each fresh frame `__seek(i)` (timed as `draw`), `page.screenshot` with the mode's options (timed as `capture`), and each write to ffmpeg's stdin awaited to its drain (timed as `encode`). Closing stdin and waiting for ffmpeg's exit is timed as `finish`.
- Produces: `{ film, mode, frames, captured, wallSeconds, held: { ms }, draw: { totalMs, medianMs, p95Ms }, capture: { … }, encode: { … }, finishMs }`, medians and p95 over captured frames (draw, capture) and over written frames (encode).

- [ ] **Step 1: Write the script.** It must fail loudly: any page error, a non-zero ffmpeg exit, or `frames` differing from Task 1's count ends with exit 1 and no result file.
- [ ] **Step 2: Run fast. [BROWSER]** `node S0/time-split.mjs X/kinds-desk.json --mode fast --out S0/results/split-fast.json`. Expected: `frames` and `captured` equal Task 1 Step 2's.
- [ ] **Step 3: Run exact. [BROWSER]** The same with `--mode exact` and `split-exact.json`.
- [ ] **Step 4: Sanity check and record.** `draw.totalMs + capture.totalMs` in fast mode should be within 25% of 59,720 ms (the repo's own capture-only figure for this film); if it is not, say so in the result and name the machine. Row "frame time split" in `W0-RESULTS.md`: the three medians per mode, and each stage's share of `wallSeconds`.

### Task 3: The capture spike, two arms against today's path

**Files:**
- Create: `S0/capture-spike.mjs`
- Read: `MM/scripts/v2/render.mjs:29,123-125` (today's screenshot call and `JPEG_QUALITY = 98`), `MM/engine/page/stage.mjs:182-189` (the visible canvas is the element with id `stage`)

**Interfaces:**
- `node S0/capture-spike.mjs <film.json> --arm screenshot|cdp|evaluate --runs 3 --out <result.json>`. One call per arm, so no call runs past 10 minutes. Each run opens a fresh session, walks the frames with `__heldFlags(…, true)` and, for each fresh frame, `__seek(i)` then the arm's grab; nothing is encoded.
  - `screenshot`: `page.screenshot({ type: 'jpeg', quality: 98 })`, today's path.
  - `cdp`: a CDP session from `page.context().newCDPSession(page)` and `Page.captureScreenshot` with `{ format: 'jpeg', quality: 98, optimizeForSpeed: true }`; the base64 answer decoded to a Buffer.
  - `evaluate`: `page.evaluate` runs, in the page, `document.getElementById('stage').toBlob` with `'image/jpeg'` and `0.98`, and returns the bytes as a base64 string; decoded to a Buffer in Node.
- Produces: `{ arm, frames, captured, runs: [seconds, …], medianSeconds, msPerCaptured, bytesPerFrame, fidelity: [{ frame, maxDiff, meanDiff }] }`. `fidelity` compares, for the first, middle and last captured frame, the arm's picture with a PNG `page.screenshot` of the same frame: both decoded to RGB by ffmpeg, `maxDiff` and `meanDiff` in 8-bit levels per channel.

- [ ] **Step 1: Write the script.** A blank or all-black picture from an arm (mean level under 2 on every sampled frame of a film that is not black) is a failure of that arm, recorded as "arm does not capture the post pass", not a win.
- [ ] **Step 2: Run the three arms, one call each. [BROWSER]** On `X/kinds-desk.json`, to `S0/results/capture-screenshot.json`, `capture-cdp.json`, `capture-evaluate.json`. Expected: the same `captured` in all three.
- [ ] **Step 3: Record.** Row "capture spike" in `W0-RESULTS.md`: each arm's `medianSeconds`, its ratio to `screenshot`, and its worst `maxDiff`. Apply the master plan's win rule (an arm wins when its ratio is 0.80 or less and its worst `maxDiff` is no higher than the `screenshot` arm's worst `maxDiff` plus 1) and write "wins" or "does not win" per arm.

### Task 4: Audio offset of one muxed film with a recorded music file

**Files:**
- Create: `S0/make-click.mjs`, `S0/audio-offset.mjs`
- Read: `MM/references/schema.md:94` (`"music": { "src": "track.mp3" }` is a file of the author's own), `MM/scripts/v2/voice/master.mjs:42,647` (AAC is encoded first, then stream-copied in the mux)

**Interfaces:**
- `node S0/make-click.mjs` writes `S0/audio/click.wav` (48 kHz, mono, 16-bit PCM, 10 s of silence with a 5 ms 1 kHz burst at half scale starting at each whole second 1 to 9) and `S0/audio/offset-film.json`: version 2, one `free` shot `{ "id": "a", "show": "free", "hold": 10, "background": "#101820", "nodes": [<the still bar of MM/test/v2/make.test.mjs:21>] }`, `"music": { "src": "click.wav" }`. No fixture of recorded music exists in the repo (searched `MM/test` and `MM/references` for wav, mp3, m4a), so the track is synthesised with known onsets.
- `node S0/audio-offset.mjs <film.mp4> --out <result.json>` decodes the MP4's audio with ffmpeg to 48 kHz mono 32-bit float on stdout, finds each burst's onset (the first sample above 25% of the track's peak after at least 0.2 s below 5% of it) and writes `{ onsets: [{ expected, found, offsetMs }], medianOffsetMs, medianOffsetFrames30 }`.

- [ ] **Step 1: Write both scripts; run `make-click.mjs`.**
- [ ] **Step 2: Validate the film.** `node MM/scripts/make.mjs S0/audio/offset-film.json --outline`. Expected: exit 0, one line. A validation line means the film is wrong: fix the film, not the validator.
- [ ] **Step 3: Render. [BROWSER]** `node MM/scripts/make.mjs S0/audio/offset-film.json --json --out S0/out/offset.mp4`. Expected: exit 0 and `audio.music.kind` `"file"`. If the render refuses the level (a click track is far from the loudness target), record the refusal message as the result and stop this task: the measurement then needs a denser track, which is reported, not improvised.
- [ ] **Step 4: Measure.** `node S0/audio-offset.mjs S0/out/offset.mp4 --out S0/results/audio-offset.json`. Expected: nine onsets found. Fewer than nine is recorded with the count.
- [ ] **Step 5: Record.** Row "audio offset": the median in ms and in frames at 30 fps, and whether its magnitude is above 20 ms (the master plan's threshold for building the beat audit).

### Task 5: Per-frame snapshot dump on three films, and prototype motion rules

**Files:**
- Create: `S0/dump-snapshots.mjs`, `S0/motion-rules.mjs`
- Read: `MM/engine/page/stage.mjs:150-174` (`__snapshot`, `__heldFlags`), `MM/scripts/v2/review.mjs:96-109` (which frames are inside a cut window), `MM/engine/looks/desk.mjs:9,45-84` (`HAND_STEP`: stepped motion is the default pro look's intent)

**Interfaces:**
- `node S0/dump-snapshots.mjs <film.json> --frames all|last --out <file.ndjson>` opens one session on the film with its estimated timeline (no voice is made) and writes one JSON line per frame. With `--frames all`: `{ frame, shot, t, held, inCut, nodes: [{ id, parent, type, depth, bbox, opacity, scale, fixed, text }] }`, the tree flattened, `opacity` and `scale` accumulated down the tree, `text` the node's words joined (text nodes only), `inCut` true inside a cut window or on a shot's first frame. With `--frames last`: only the last frame of each shot, and each line carries `tree`, the whole `__snapshot` result. **W2 Task 4 reads the `--frames last` form; do not change its shape.**
- `node S0/motion-rules.mjs <file.ndjson> --out <result.md>` applies three prototype rules to consecutive frames with `inCut` false, per node id: `pop-in` (first seen at accumulated opacity 0.9 or more, box area above 0.5% of the canvas, with no frame at a lower opacity before it), `jump` (box centre moves more than 40 units in one frame and under 4 units in the next), `flash` (on screen for 1 or 2 frames only). It writes the count per rule and, per finding, the frame, the film second, the node id and the node's `text`.
- The films, read from `X` because the gallery `film.json` files are copies whose pictures resolve only there: `showreel-pro.json` (desk), `showreel-viral.json` (pop), `gate-marker.json` (marker).

- [ ] **Step 1: Write both scripts.**
- [ ] **Step 2: Dump the three films, one call each. [BROWSER]** To `S0/results/snap-desk.ndjson`, `snap-pop.ndjson`, `snap-marker.ndjson` with `--frames all`. Expected: one line per film frame.
- [ ] **Step 3: Run the rules on each dump** (no browser) to `S0/results/motion-desk.md`, `motion-pop.md`, `motion-marker.md`.
- [ ] **Step 4: View up to five findings per film. [BROWSER]** For each, `node MM/scripts/make.mjs <film> --poster <the finding's second> --poster-out S0/results/poster-<film>-<n>.png`, and the frame before it; open both PNGs. Classify each as intended (a `slam` that appears at once, a `count` that swaps its text, a stepped mark, the marker hand) or a defect (something a viewer would read as a glitch). A finding not viewed is "not viewed".
- [ ] **Step 5: Record.** Row "motion defects": per film, findings per rule, how many were viewed, how many are defects. One viewed defect is enough to switch the motion gate on.

### Task 6: The five-frame slam strip

**Files:**
- Create: `S0/slam-strip.mjs`
- Read: `MM/engine/moves/index.mjs:7-15` (`slam` is one of the seven named moves); run `node MM/scripts/make.mjs --list moves` to see which looks give `slam` a duration

**Interfaces:**
- `node S0/slam-strip.mjs <film.json> --shot <id> --out <strip.png>` opens one session, finds the first frame of the shot on which a top-level node's scale or position differs from the frame before it, screenshots that frame and the next four as PNG at full size, and joins them left to right into one PNG with one ffmpeg `hstack=inputs=5` call. It prints the five frame numbers.

- [ ] **Step 1: Pick the shot.** From `--list moves`, take a look whose `slam` has a duration above 0 (expected: `pop`), and in `X/showreel-viral.json` the first shot whose hero lands with it. Record the film, the shot id and why.
- [ ] **Step 2: Write the script and run it. [BROWSER]** To `S0/results/slam-strip.png`.
- [ ] **Step 3: View the strip** with the Read tool. Record in row "slam strip": the largest gap in pixels between the moving element's positions on two neighbouring frames (measured on the PNG) and whether separate copies read as a strobe (a gap wider than the element's own stroke with no smear between). This row never schedules work by itself; it sets the trigger of the deferred item "in-shot motion blur".

### Task 7: Held frames are pixel-equal to their predecessor (the one committed test)

**Files:**
- Create: `MM/test/v2/held-frames-browser.test.mjs`
- Read: `MM/engine/page/stage.mjs:74-95` (`frameKeys`, `heldFlags`), `MM/test/v2/helpers/stage.mjs:29-67` (`openStage`, `hashFrame`: a PNG screenshot hashed, which is what `--exact` captures), `MM/test/v2/make.test.mjs:21-25,348-358` (the still bar, the mesh shot, and the existing count-only held test)

**Interfaces:**
- Consumes: `openStage(film) -> { page, hashFrame(i), close() } | null` and the page's `__heldFlags(from, to, withGrain)`.
- Produces: three tests and one proof, each skipping when `openStage` returns null (no browser; `PA_REQUIRE_BROWSER=1` makes that a failure, as in every browser test).

- [ ] **Step 1: Write the test.** Three films at 30 fps: `still` (one `free` shot, `hold: 2`, the still bar on `#f3eee3`, no look named, so the default look's grain runs at 12 patterns a second), `mesh` (one `free` shot, `hold: 2`, the mesh field node: a field painted from the time), `fade` (two `free` still shots of `hold: 1` on different backgrounds, the second with `"cut": "crossfade"`).

```js
// for each film: flags = await page.evaluate(([a, b]) => window.__heldFlags(a, b, true), [0, frames - 1]); hashes[i] = await stage.hashFrame(i)
test('still: every frame the capture key calls held is pixel-equal to the frame before it, and some are held', …);
//   assert.ok(flags.some(Boolean));  for (i with flags[i]) assert.equal(hashes[i], hashes[i - 1], `frame ${i}`);
test('mesh: a field painted from the time is never held', …);
//   assert.deepEqual(flags.slice(1), Array(frames - 1).fill(false));
test('fade: inside the crossfade window nothing is held; the stills either side are, and each held frame is pixel-equal', …);
//   const window = frames 30..41 (0.4 s at 30 fps);  assert.ok(window.every((i) => !flags[i]));
//   for (i with flags[i]) assert.equal(hashes[i], hashes[i - 1], `frame ${i}`);
test('guardrail proof: the 2D key alone calls frames held whose pixels differ, so this comparison can fail', …);
//   on `still`: weak = __heldFlags(0, frames - 1, false);  const i = weak.findIndex((w, k) => w && !flags[k]);
//   assert.ok(i > 0);  assert.notEqual(hashes[i], hashes[i - 1]);
```

- [ ] **Step 2: Run it. [BROWSER]** `node --test --test-concurrency=1 "MM/test/v2/held-frames-browser.test.mjs"`. Expected: PASS, 4 tests (this is a passing invariant, so there is no RED on today's code).
- [ ] **Step 3: Prove it bites with a broken key.** With the Edit tool, in `MM/engine/page/stage.mjs:82`, replace `` `${drawKey(i)}|grain${grainPhase(i / fps)}` `` with `drawKey(i)` (one match). Run Step 2's command. Expected: FAIL in "still: every frame the capture key calls held…" naming a frame number. Restore the line with the Edit tool, run `git diff --stat R/plugins/portable-artifacts/skills/make-motion/engine/page/stage.mjs` (expected: no output), and run Step 2's command again (expected: PASS). Put the failing output's first line in the report.
- [ ] **Step 4: Commit (controller).**

```bash
git add plugins/portable-artifacts/skills/make-motion/test/v2/held-frames-browser.test.mjs
git commit -m "test(w0): held frames are pixel-equal to the frame before them" -m "A browser test over a still, a time-painted field and a crossfade; proven to bite by dropping the grain term from the capture key (the test failed, the line was restored)." -m "Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 8: The two probes and the two code reads

**Files:**
- Create: `S0/phase-sweep.mjs`
- Read: `MM/engine/formats.mjs:18` (`canvasSize` reads `spec.size`), `MM/scripts/v2/spec.mjs:50-70` (the root schema: is `size` a root field?), `MM/engine/script/timing.mjs:71-87` (a narrated shot's length), `MM/engine/modes/` (each mode's `wpm` and `tail`)

**Interfaces:**
- `node S0/phase-sweep.mjs --out <result.json>` opens `openStage` on a one-shot `free` film at 30 fps (the validator takes 24, 25, 30 and 60) whose one text node (Geist 600 at 96 px, "Phase sweep", white on `#101820`) carries a linear `x` track from 0 to 2 px over 64 frames, so frame `k` stands `2k / 63` px to the right. It seeks frames 0 to 63 in one session and reads each screenshot's summed luma over the text's box. It writes `{ offsets: [{ dx, ink }], spreadPercent }`, the spread of `ink` as a percent of its mean.
- Produces: `S0/results/reads.md` with two answers, each with the lines read: (a) does the validator accept a root `size`, so a half-size draft is possible without a schema change; (b) which shots can show text for less time than a reader needs (a `hold` shot, text longer than its narration, a caption), given that a narrated shot gets `60 / wpm` seconds a word plus the mode's tail.

- [ ] **Step 1: Write `reads.md`** from the files above. No browser.
- [ ] **Step 2: Phase sweep. [BROWSER]** `node S0/phase-sweep.mjs --out S0/results/phase-sweep.json`.
- [ ] **Step 3: Banding, viewed.** No new render: extract one frame of a smooth field from Task 1's fast render with `ffmpeg -y -ss 2 -i S0/out/fixed-fast.mp4 -frames:v 1 S0/results/banding-desk.png` and one from `G/looks/keynote/video.mp4` (the mesh field) to `banding-keynote.png`; open both and look at the largest smooth gradient for steps. Record "steps visible" or "no steps visible", with the frame's file name.
- [ ] **Step 4: Record.** Rows "half-size draft", "reading-time scope", "text phase sweep" and "gradient banding" in `W0-RESULTS.md`. The two probes are measurements, not features: neither schedules work in this plan set, and a spread above 2% or visible steps is listed in the master plan's deferred list with its number.

### Task 9: The results table and the wave gate

- [ ] **Step 1: Finish `S0/results/W0-RESULTS.md`:** one row per measurement with columns `measurement | command | result | threshold | decision`. Copy the table into the master plan's "W0 results" section and fill the "decided" column of its decision table (`docs(w0):` commit, controller).
- [ ] **Step 2: Fresh-context review (reviewer tier, Opus at medium, report only).** The prompt gives the diff path (`git diff origin/main...HEAD -- plugins/portable-artifacts/skills/make-motion/test/v2/held-frames-browser.test.mjs`), the paths of `S0/*.mjs` and `S0/results/`, this plan's Review Focus, and this sentence verbatim: "Report every issue you find, including ones you are uncertain about or consider low-severity. Do not filter for importance or confidence at this stage — a separate verification step will do that. Your goal here is coverage: it is better to surface a finding that later gets filtered out than to silently drop a real bug. For each finding, include your confidence level and an estimated severity so a downstream filter can rank them."
- [ ] **Step 3: Gate.** No CRITICAL or HIGH open; `node --test --test-concurrency=1 "MM/test/v2/held-frames-browser.test.mjs"` green **[BROWSER]**; then the controller pushes the wave's commits. List in the report: every file under `S0`, every **[BROWSER]** step run with its `pgrep` line, and what was not viewed.

## Self-review notes

- Spec coverage: section 6 "W0" names the ffprobe table (Task 1), the draw/capture/encode split (Task 2), the audio offset (Task 4), both spike arms (Task 3), the `__snapshot` dump on three films (Task 5), and the held-frame test (Task 7). The slam strip (Task 6) and the probes and reads (Task 8) come from `PROPOSAL.md` section 4, which the spec points at.
- Not run by the planner: no script here was executed. Counts quoted (31 gallery films, 1027 frames, 59.72 s) are the repo's or the research's, each cited.
