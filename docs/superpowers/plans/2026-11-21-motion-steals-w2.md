# Motion steals W2: Composition and Cut Craft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Films stop reading as a row of slides: the review says when a frame is left empty or has nothing large in it, two layouts that leave frames empty are fixed, narration may start before or run past a cut, a transition shows the outgoing shot still moving, and an iris, a zoom or a colour flood can start from the thing on screen that caused it.

**Architecture:** Composition is measured, not guessed: one pure function reads a shot's resting snapshot (the boxes the page already reports) and returns the largest empty band and the largest element; two creative findings are thresholds over that measure, set from one calibration run on the gallery before they are wired into the review, then capped per film. J and L cuts move the picture's cut point against an unmoved sound track: an opt-in per-shot field shifts a seam by whole frames, the timeline records where each shot's narration starts relative to its picture, and every reader of sound times already adds a signed shot-local offset to the shot's start. A live outgoing shot is the same sample function called past the shot's end, for the cut families that compose two pictures. A cut's origin is a target name of the outgoing shot, resolved to a canvas point once per shot.

**Tech Stack:** Node >= 20 ESM, `node:test`, Playwright Chromium, ffmpeg. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-21-motion-steals-design.md` section 6, "W2, composition and cut craft". Item detail: `.scratch/research-2026-11-21/compose.md` section 4 (W2, W4, W5, W6) and `.scratch/research-2026-11-21/PROPOSAL.md` section 2A items 5 and 11. Master plan: `docs/superpowers/plans/2026-11-21-motion-steals.md`.

Abbreviations (write each out in full in a command): `R` = `/Users/abhijitbansal/projects/portable-artifacts/.claude/worktrees/new-improvements`, `P` = `R/plugins/portable-artifacts`, `MM` = `P/skills/make-motion`, `T` = `MM/test/v2`, `X` = `MM/references/examples/v2`, `BT` = `P/bin/test`, `S0` = `R/.scratch/motion-steals-w0`, `S2` = `R/.scratch/motion-steals-w2`.

## Names other plans rely on

These are fixed here; W3 and W4 read them from this section.

- **Rule ids:** `dead-space` and `scale-contrast`, both `creative`, emitted by `auditFrame` in `MM/engine/review/frame.mjs` and listed in its export `COMPOSITION_RULES`. W3's rule registry lists both.
- **The W2 narration lead/trail field:** a shot's optional `narration: { "lead": seconds, "trail": seconds }`, each from 0 to `NARRATION_SHIFT_MAX` (1.5), each defaulting to 0. `lead` on a shot starts its narration that long before its picture (a J cut); `trail` lets its narration run that long into the next shot's picture (an L cut).
- **Sign convention for sound times:** a timeline word's `soundStart` and `soundEnd` are seconds from its own shot's picture start and may be negative (heard before the picture) or past the shot's duration (heard after it). The film second a word is heard is always `shot.start + word.soundStart`. A timeline shot carries `narrationAt` (seconds from its picture start to its narration's start) only when it is not 0.
- **Captions:** `captionWordsOf(timeline, index)` in `MM/engine/captions/groups.mjs` returns the words heard while shot `index` is on screen, whichever shot speaks them. W4's word-level subtitles need nothing more than the sign convention.

## Global Constraints

- `MM/SKILL.md` is 20,898 bytes against a 20,900-byte budget pinned in `plugins/portable-artifacts/bin/test/skill-budget.test.mjs`; slim, never raise the cap. After W1 it is at most 19,700 bytes; W2 adds at most 200 bytes to it (one sentence at the `cut` line), and the field and cut details go to `references/schema.md` and `references/story.md`.
- No new runtime dependency, no network use, no generative-video call from `make.mjs`. No new server route (the preview server is GET and HEAD only).
- One headless browser at a time: `pgrep -fl chrome-headless-shell` before every step marked **[BROWSER]**; browser tests run with `--test-concurrency=1`, one file at a time.
- Goldens change only for an intended visual change, stated in the commit. The intended ones in W2: cosmos number shots (Task 4), short statements in `desk`, `cosmos` and `keynote` (Task 5), frames inside a layer or shader cut's window whose outgoing shot moves (Task 8). Nothing else changes a frame: a film that names no `narration`, no `at` and no `flood` has the timeline and the state keys it has today.
- Every default reproduces today's film. `narration` absent or `{ lead: 0, trail: 0 }` gives a timeline deep-equal to today's, with no new key on any entry.
- Creative findings stay few: the two composition findings are judged once per shot, on its resting frame, and at most 3 reach the report per film.
- Everything that differs between looks is look data. No branch on a look's name.
- HyperFrames (Apache-2.0) ideas (a live outgoing shot, sound placed apart from picture, an iris from the thing clicked, a colour flood, a hero that fills the frame) are rewritten in our own code with a credit line in `THIRD_PARTY_NOTICES.md`; no file is ported. No code from beast_explainer.
- Every code fix and guardrail is shown failing first (RED), then passing.
- `engine/**` stays pure and DOM-free (`T/purity.test.mjs`). Files under 800 lines, functions under 50, named constants.
- Validator errors keep the `<json.path>: <message>` form.
- Commits: conventional, prefixed `feat(w2):`, `fix(w2):`, `test(w2):` or `docs(w2):`, staging named files only, ending with exactly one trailer line `Co-Authored-By: Claude <noreply@anthropic.com>` and no `Claude-Session` line. Implementers do not commit; the controller commits one task per commit. No `plugin.json` bump, `CHANGELOG.md` heading or cover Revision here.
- Shell rules: one plain command per Bash call with literal absolute paths; no `cd`, `&&`, pipes, `;`, shell variables, loops or heredocs; quote globs; edits with the Edit tool; a subagent never runs `rm`.
- Implementers are executor tier (Sonnet, effort high); the reviewer is Opus at medium. A fresh-context review runs at the end of the wave before its commits are pushed.

Test commands: no browser, `node --test "T/<file>.test.mjs"`; with a browser, `node --test --test-concurrency=1 "T/<file>.test.mjs"` **[BROWSER]**; a doc test, `node --test "BT/<file>.test.mjs"`.

## Review Focus

1. **A shifted shot that is too short.** A `lead` or `trail` that leaves a shot under 1 s, or shorter than the cut that opens it, must be an error naming the field, on the estimated timeline (the validator) and again on the measured one (after the voice). `loadFilm` builds a timeline right after validation (`MM/scripts/v2/pipeline.mjs:63`), so an error the validator misses is an uncaught throw. Task 6.
2. **A film that asks for none of this.** The timeline, the frames and the state keys of a film with no `narration`, no `at` and no `flood` must not change. Tasks 6, 8 and 9 each pin it.
3. **Seek order with a live outgoing shot.** The outgoing picture is cached per shot index today (`MM/engine/page/cut-pictures.mjs:22-28`). Read a window's frames backwards and in a fresh page: the hashes must equal a forward pass. Task 8.
4. **A composition finding on a frame that is not at rest, or is all picture.** A shot mid-entrance, a frame inside a cut window, and a full-bleed picture must give no composition finding. Task 1.
5. **A cut origin that cannot be found.** `at` names a target of the shot before. A name that shot does not have is an error that lists the names it has; it never opens from the centre in silence. Task 9.
6. **A caption for a word heard over another shot.** With `lead` or `trail`, a word is heard while its own shot is off screen. The shot on screen draws its caption. Task 7.
7. **A shot shorter than its cut, and the first shot.** The first shot takes no `lead`, the last no `trail`, and a cut longer than the shifted shot is refused, not clamped.

## Decisions for the controller

Each has a default this plan is written to. Change it before dispatching the task named.

| # | Question | What was found | Default | Alternative | Task |
|---|---|---|---|---|---|
| 1 | Where the composition code lives | The shared contract says the rule ids are in `engine/review/frame.mjs`, which is 626 lines | The measure, the two rules and their constants go in `frame.mjs` (about 110 lines more, under the 800 limit) | A new `engine/review/composition.mjs` called from `auditFrame`, as `contrast.mjs` is; the ids would still surface through `auditFrame` | 1 |
| 2 | How the cosmos number is recentred | The figure sits over a line at the sun's height (`number-sky.mjs:67-80`), the sun anchored at half height (`cosmos.mjs:85`), so the block's ink centre is above the middle and the lower 40% is bare | The whole sky block (sun, line, Earth, figure, label) moves down by one shift so its ink is centred on the band. The sun then stands lower on a number shot than on a statement shot | Keep the sun; set the label one scale step larger and add the delta's room, so the block grows downward. Take this if the cut strip in Task 12 shows the sun jumping | 4 |
| 3 | Which looks take short-statement fill | `desk` has no statement data (width to column 9, height 0.64); `cosmos`, `keynote`, `marker` and `ledger` already reach column 11 or 12; `ledger` hangs under its tag; `poster` and `pop` stack | `desk`, `cosmos` and `keynote` | Add `marker` | 5 |
| 4 | Who draws a caption for a word heard over another shot | Caption nodes belong to a shot and leave with it (`MM/engine/graph/film.mjs:177-181`) | The shot on screen draws it, also when that shot's kind shows its own words | Refuse `narration` in a captioned film | 7 |
| 5 | Which shot a cut's `at` names | An iris opens on the next shot, but the thing that causes the cut is on the shot being left | A target of the outgoing shot (the shot before), in the `on[].target` vocabulary | A target of the incoming shot for `zoom` only | 9 |
| 6 | The flood's colour | Looks are built on one accent | `look.palette.accent`, no film option | A `color` key on the cut | 10 |

## File Structure

- `MM/engine/review/frame.mjs`: `compositionOf`, `compositionFindings`, `DEFAULT_FILL`, `COMPOSITION_RULES`.
- `MM/scripts/v2/review.mjs`: `restsShot` in the frame context; `capComposition`.
- `MM/engine/looks/index.mjs`: `fill`, `cutMotion` unchanged, validation of `fill`; `desk.mjs`, `cosmos.mjs`, `keynote.mjs`: `kinds.statement.fillShort`, and any `fill` the calibration gives.
- `MM/engine/kinds/number-sky.mjs`, `statement.mjs`: the two layout fixes.
- `MM/engine/script/timing.mjs`: `NARRATION_SHIFT_MAX`, the seam shifts, `narrationAt`.
- `MM/scripts/v2/spec.mjs`, `list.mjs`: the `narration` field and its refusals.
- `MM/engine/captions/groups.mjs`, `index.mjs`, `MM/engine/graph/film.mjs`: caption words by what is heard; the live outgoing sample; a cut's origin point.
- `MM/engine/graph/camera.mjs`: `pointThroughCamera`.
- `MM/engine/cuts/resolve.mjs`, `layers.mjs`, `index.mjs`; `MM/scripts/v2/spec-cuts.mjs`; `MM/engine/page/cut-pictures.mjs`, `stage.mjs`: `at`, `flood`, the uncached outgoing picture.
- Every look file: a `sounds.cut.flood` entry and `flood` in `cuts`.
- `MM/references/schema.md`, `story.md`, `tells.md`, `MM/THIRD_PARTY_NOTICES.md`, `MM/SKILL.md` (one sentence).
- Tests: new `T/review-composition.test.mjs`, `T/narration-shift.test.mjs`, `T/captions-heard-shift.test.mjs`, `T/cuts-origin.test.mjs`, `T/cuts-live-browser.test.mjs`; edits to `T/cuts-layers.test.mjs`, `T/review.test.mjs`, `T/looks.test.mjs`, `T/kinds-statement.test.mjs`, `T/kinds-number.test.mjs`, the `*-examples-browser` tests and `T/review-browser.test.mjs`.

---

### Task 1: The composition measure and its two rules (pure, not yet wired)

**Files:**
- Modify: `MM/engine/review/frame.mjs:59-62` (constants beside the hero rule's), `:356-374` (beside `hierarchyRules`), `:615-625` (`auditFrame`)
- Create: `T/review-composition.test.mjs`
- Read: `MM/engine/review/frame.mjs:158-168` (`inkBox`: a text's ink in canvas pixels), `:480-495` (`GROUND_SHARE = 0.8`, `canvasShare`), `MM/engine/review/marks.mjs:24-29` (`showsItself`), `MM/engine/page/bounds.mjs:1-3` (every snapshot node carries a canvas-pixel `bbox`)

**Interfaces:**
- Produces, exported from `frame.mjs`:
  - `COMPOSITION_RULES = Object.freeze(['dead-space', 'scale-contrast'])`
  - `DEFAULT_FILL = Object.freeze({ band: 0.4, hero: 0.4 })`: starting values; Task 2 sets the shipped ones. `HERO_LEAD = 1.5` (not look data).
  - `fillOf(look) -> { band, hero }`: `DEFAULT_FILL` with the look's optional `fill` laid over it.
  - `compositionOf(sampled, ctx) -> { ground: boolean, elements: [{ id, box, area }], band: { share, axis: 'x' | 'y', where: 'left' | 'right' | 'top' | 'bottom' | 'middle' }, hero: { id, extent } | null, next: { id, area } | null }`, with `ctx` as `auditFrame` takes it (`canvas`, `safe`, `shotId`).
  - `compositionFindings(sampled, ctx, fill = fillOf(ctx.look)) -> finding[]`, each `{ kind: 'creative', path, message, rule, node: '', measure }`.
  - `auditFrame` appends `compositionFindings` only when `ctx.restsShot === true`.
- The definitions, which the signature and the tests do not fix:
  - An **element** is a top-level node of `sampled` that is not behind the picture plane (`depth > 0` is the field), is not a caption (its id is, or starts with, `<ctx.shotId>.captions`), and has at least one node in its subtree that shows itself at an accumulated opacity above 0. Its `box` is the union of those nodes' boxes (a text by `inkBox`, any other by `bbox`), clipped to the canvas; `area` is that box's area in square pixels.
  - `ground` is true when an element's box covers `GROUND_SHARE` of the canvas or more (a full-bleed picture, a full-frame card). A ground frame has no composition finding.
  - `band` is the longest stretch of the safe rectangle, across (`axis: 'x'`) or down (`axis: 'y'`), that no element's box enters, as a share of the safe rectangle's width or height; the larger of the two axes, `x` on a tie. `where` names the edge it touches, or `middle`.
  - `next` is the second largest element by area, or null. `hero` is the largest element when it leads: it stands alone, or its area is at least `HERO_LEAD` times `next`'s. A frame of peers (a list, a grid of cards) has no hero: `hero` is null, and only `dead-space` judges it. The hero's `extent` is the larger of its width over the safe width and its height over the safe height.
  - `dead-space` fires when `band.share >= fill.band`; its `measure` is `band.share - fill.band`. Message: `the frame leaves ${percent}% of its ${height or width} empty (${the bottom | the top | the left | the right | a band through the middle}); let the hero take more of the frame, add a second element, or use a look that fills with type`.
  - `scale-contrast` fires when there is a hero and `hero.extent < fill.hero`: the frame has one thing that leads the next, and it is small in the frame. Its `measure` is `fill.hero - hero.extent`. Message: `the hero, "${hero.id}", reaches ${percent}% of the frame${next ? `, and the next largest thing, "${next.id}", is smaller still` : ' and stands alone'}; set it larger, crop in on it, or give it a second mass (a picture, a chart, a card)`.

- [ ] **Step 1: Write the failing tests.**

```js
const CANVAS = { w: 1920, h: 1080 };
const SAFE = { left: 96, top: 96, right: 1824, bottom: 984 }; // 1728 by 888
const box = (id, bbox, extra = {}) => ({ type: 'path', id, depth: 0, props: { fill: '#111111', d: 'M0 0H1V1H0Z' }, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, visible: true, children: [], bbox, ...extra });
const ctx = (extra = {}) => ({ look: registries.looks.get('desk'), canvas: CANVAS, mode: 'pro', shotId: 'hero', shotIndex: 0, t: 1.2, safe: SAFE, restsShot: true, ...extra });
const rules = (findings) => findings.map((f) => f.rule).sort();

test('a small card alone in the frame: the empty band is 768 of 1728 across, the hero reaches 12% of the frame, and both rules fire', () => {
  const tree = [box('card', [864, 486, 192, 108])];
  const c = compositionOf(tree, ctx());
  assert.equal(c.band.axis, 'x');
  assert.ok(Math.abs(c.band.share - 768 / 1728) < 1e-9);
  assert.deepEqual([c.hero.id, c.next, c.ground], ['card', null, false]);
  assert.ok(Math.abs(c.hero.extent - 108 / 888) < 1e-9);
  assert.deepEqual(rules(compositionFindings(tree, ctx(), DEFAULT_FILL)), ['dead-space', 'scale-contrast']);
});
test('a block across the safe width and most of its height fires neither', () => {
  assert.deepEqual(compositionFindings([box('block', [96, 96, 1728, 700])], ctx(), DEFAULT_FILL), []);
});
test('a figure over its label with the lower 43% bare: dead-space names the bottom, and a hero at 40.5% of the width is large enough', () => {
  const found = compositionFindings([box('figure', [600, 220, 700, 240]), box('label', [600, 520, 700, 80])], ctx(), DEFAULT_FILL);
  assert.deepEqual(rules(found), ['dead-space']);
  assert.match(found[0].message, /43% of its height empty \(the bottom\)/);
  assert.ok(Math.abs(found[0].measure - (384 / 888 - 0.4)) < 1e-9);
  assert.deepEqual([found[0].kind, found[0].path, found[0].node], ['creative', 'shots[0]', '']);
});
test('two peers of one size have no hero: scale-contrast is silent, and the bare lower 43% is still dead space', () => {
  const tree = [box('left', [200, 300, 600, 300]), box('right', [1000, 300, 600, 300])];
  assert.equal(compositionOf(tree, ctx()).hero, null);
  assert.deepEqual(rules(compositionFindings(tree, ctx(), DEFAULT_FILL)), ['dead-space']);
});
test('a small title five times its label is a hero, and at 23% of the frame it is a scale-contrast finding', () => {
  const tree = [box('title', [700, 400, 400, 150]), box('label', [700, 570, 300, 40])];
  const c = compositionOf(tree, ctx());
  assert.deepEqual([c.hero.id, c.next.id], ['title', 'label']);
  assert.ok(Math.abs(c.hero.extent - 400 / 1728) < 1e-9);
  const found = compositionFindings(tree, ctx(), DEFAULT_FILL).find((f) => f.rule === 'scale-contrast');
  assert.match(found.message, /^the hero, "title", reaches 23% of the frame, and the next largest thing, "label", is smaller still/);
  assert.ok(Math.abs(found.measure - (0.4 - 400 / 1728)) < 1e-9);
});
test('what is not judged: a full-bleed picture, the field, a caption, a node at opacity 0, a path not yet drawn', () => {
  const picture = { ...box('photo', [0, 0, 1920, 1080]), type: 'image', props: {} };
  assert.equal(compositionOf([picture], ctx()).ground, true);
  assert.deepEqual(compositionFindings([picture, box('card', [864, 486, 192, 108])], ctx(), DEFAULT_FILL), []);
  const ignored = [box('field', [0, 0, 1920, 1080], { depth: 1 }), box('hero.captions', [200, 800, 1500, 120]), box('gone', [96, 96, 1728, 800], { opacity: 0 }), box('undrawn', [96, 96, 1728, 800], { draw: 0 })];
  assert.deepEqual(compositionOf([...ignored, box('card', [864, 486, 192, 108])], ctx()).elements.map((e) => e.id), ['card']);
});
test('the rules run only on a shot\'s resting frame, and a look\'s fill overrides the defaults', () => {
  const tree = [box('card', [864, 486, 192, 108])];
  assert.deepEqual(rules(auditFrame(tree, ctx({ restsShot: false }))), []);
  assert.deepEqual(rules(auditFrame(tree, ctx())), ['dead-space', 'scale-contrast']);
  assert.deepEqual(compositionFindings(tree, ctx(), { band: 0.5, hero: 0.1 }), []);
  assert.deepEqual(fillOf({ fill: { band: 0.55 } }), { band: 0.55, hero: DEFAULT_FILL.hero });
});
test('an empty frame, and a frame with one element, never throw', () => {
  assert.deepEqual(compositionOf([], ctx()).hero, null);
  assert.equal(compositionOf([], ctx()).band.share, 1);
});
```

An empty frame has `band.share` 1 and no hero: `dead-space` fires and `scale-contrast` does not (there is nothing to name). The opening rule already covers an empty first frame.

- [ ] **Step 2: Run to see RED.** `node --test "T/review-composition.test.mjs"`. Expected: FAIL, `compositionOf` is not exported.
- [ ] **Step 3: Implement** in `frame.mjs`, per decision 1. Reuse `inkBox`, `canvasShare`, `showsItself`, `GROUND_SHARE` and `finding`.
- [ ] **Step 4: Run to see GREEN.** The same command, then `node --test "T/review.test.mjs"` and `node --test "T/purity.test.mjs"`. Expected: PASS; no existing test sets `restsShot`, so none changes.
- [ ] **Step 5: Commit (controller).** `feat(w2): measure a resting frame's empty band and largest element; two creative rules over it, not yet wired`.

### Task 2: Calibrate the thresholds on the gallery, in one browser batch

**Files:**
- Create: `S2/calibrate.mjs`, `S2/results/calibration.md`
- Modify: `S0/dump-snapshots.mjs` (one option: `--png <dir>` also writes `<shot>.png`, a PNG screenshot of each dumped frame)
- Read: `.scratch/research-2026-11-21/compose.md` section 1 (which films fill well and which do not, as viewed there)

**Interfaces:**
- Consumes: W0 Task 5's `node S0/dump-snapshots.mjs <film.json> --frames last --out <file.ndjson>` (one line per shot: `{ frame, shot, t, tree }`), and `compositionOf` (Task 1).
- `node S2/calibrate.mjs <film.json> <file.ndjson> --out <rows.json>` builds each shot's `ctx` as the review does (`lookOfShot`, `canvasSize`, `safeRectFor` from `MM/scripts/v2/review.mjs:48-55`) and writes one row per shot: `{ film, shot, kind, look, band, axis, where, hero, extent, next, ground }` (`hero` and `extent` null for a frame of peers).
- Produces: the shipped `DEFAULT_FILL` values and any per-look `fill`, with the table that justifies them.

The films, read from `X`: `showreel-pro.json`, `showreel-viral.json`, `look-cosmos.json`, `gate-ledger.json`, `look-poster.json`, `gate-keynote.json`, `gate-marker.json`, `whats-new.json`, `kinds-desk.json`, `kinds-pop.json`.

The two reference sets, each confirmed by viewing the PNG (a shot that does not look as its set says is taken out, with the reason written down):
- **Fills well:** every shot of `look-poster.json` and of `gate-ledger.json`.
- **Reads empty:** the `number` and `chart` shots of `look-cosmos.json`, and the shots of `whats-new.json` that show one line of type or one card alone in the frame.

The rule that turns the table into numbers, applied to `band` with the sets' `band` values, then to `hero` with their `extent` values:
1. Take the largest value among "fills well" and the smallest among "reads empty" (for `hero`: the smallest `extent` among "fills well" and the largest among "reads empty").
2. If they do not cross, the threshold is their midpoint, rounded to the nearest 0.05.
3. If they cross, the look whose "fills well" shots cause the crossing gets its own `fill` value (its own extreme, rounded away from firing by 0.05), and the default is the midpoint over the remaining shots.
4. `HERO_LEAD` stays 1.5 unless a list, feed, compare or timeline shot (a frame of peers by design) is given a hero by it; then it is raised by 0.5 until none is, and the value is recorded.
5. With the thresholds chosen, count the shots that fire in each film. A film with more than a third of its shots firing either rule is listed for the controller: its look gets a `fill` or its shots are the next layout work.

- [ ] **Step 1: Add `--png` to the dump script; write `calibrate.mjs`.**
- [ ] **Step 2: Dump the ten films, one call each. [BROWSER]** `node S0/dump-snapshots.mjs X/<film>.json --frames last --png S2/png/<film> --out S2/dumps/<film>.ndjson`. This is the one browser batch of the calibration: ten sessions, one after another.
- [ ] **Step 3: Measure** (no browser): `node S2/calibrate.mjs X/<film>.json S2/dumps/<film>.ndjson --out S2/results/<film>.json`, ten calls.
- [ ] **Step 4: View the reference shots' PNGs** and write `calibration.md`: the table, each reference shot marked viewed and kept or removed, the rule's arithmetic, the chosen `band` and `hero`, `HERO_LEAD`, any per-look `fill`, and the count of firing shots per film.
- [ ] **Step 5: No commit.** The numbers land with Task 3.

### Task 3: Wire the rules into the review, cap them, and let a look declare its fill

**Files:**
- Modify: `MM/engine/review/frame.mjs` (`DEFAULT_FILL`, to Task 2's values), `MM/scripts/v2/review.mjs:209-220` (`frameContext`), `:378-389` (`reviewFilm`), `MM/engine/looks/index.mjs:25-95` (the typedef), `:348-369` (`validateLook`), the look files Task 2 names
- Modify: `T/review-composition.test.mjs`, `T/review.test.mjs`, `T/looks.test.mjs`
- Modify (tables of known findings): `T/cosmos-examples-browser.test.mjs:16-25` (`KNOWN`), and the same table or empty list in `T/keynote-examples-browser.test.mjs:60`, `T/ledger-examples-browser.test.mjs`, `T/marker-examples-browser.test.mjs`, `T/poster-examples-browser.test.mjs`, `T/review-browser.test.mjs:64-65`

**Interfaces:**
- Consumes: Task 1's exports; Task 2's numbers.
- Produces, exported from `review.mjs`:
  - `restsShotAt(timeline, frame, whole) -> boolean`: true when `frame` is the last frame of its shot (`Math.round(shot.end * fps) - 1`) and it is audited whole (not inside a cut window).
  - `COMPOSITION_CAP = 3` and `capComposition(findings, cap = COMPOSITION_CAP) -> findings`: findings of other rules pass through; of those in `COMPOSITION_RULES`, the `cap` with the largest `measure` are kept, and the kept one with the smallest `measure` gains ` (${n} more ${n === 1 ? 'shot has' : 'shots have'} a composition finding; fix the worst first)` when `n > 0` were dropped. Order is unchanged.
  - `frameContext` sets `restsShot`; `reviewFilm` applies `capComposition` to the deduplicated findings.
- A look's optional `fill: { band?, hero? }`, each a number above 0 and at most 1, checked by `validateLook`: `look "<name>": fill.<key> must be a number above 0 and at most 1, got <value>`, and `look "<name>": fill.<key> is not a field; it takes band, hero`.

- [ ] **Step 1: Write the failing tests.** In `T/review-composition.test.mjs`:

```js
test('the cap keeps the three worst composition findings, says how many it dropped, and leaves other rules alone', () => {
  const f = (rule, measure, t) => ({ kind: 'creative', shot: `s${t}`, path: `shots[${t}]`, message: 'm', t, rule, node: '', ...(measure === undefined ? {} : { measure }) });
  const kept = capComposition([f('dead-space', 0.05, 0), f('still', undefined, 1), f('scale-contrast', 0.3, 2), f('dead-space', 0.1, 3), f('dead-space', 0.2, 4), f('scale-contrast', 0.01, 5)]);
  assert.deepEqual(kept.map((x) => x.t), [1, 2, 3, 4]);
  assert.equal(kept.find((x) => x.t === 3).message, 'm (2 more shots have a composition finding; fix the worst first)');
  assert.equal(kept.find((x) => x.t === 2).message, 'm');
  assert.deepEqual(capComposition([f('dead-space', 0.05, 0)]).map((x) => x.message), ['m']);
});
test('a shot rests on its last frame, audited whole', () => {
  const timeline = { fps: 30, shots: [{ id: 'a', index: 0, start: 0, end: 2, duration: 2 }, { id: 'b', index: 1, start: 2, end: 3, duration: 1 }] };
  assert.equal(restsShotAt(timeline, 59, true), true);
  assert.equal(restsShotAt(timeline, 58, true), false);
  assert.equal(restsShotAt(timeline, 89, false), false);
  assert.equal(restsShotAt(timeline, 89, true), true);
});
```

In `T/looks.test.mjs`: a look with `fill: { band: 1.2 }` is refused with `fill.band must be a number above 0 and at most 1, got 1.2`; `fill: { gap: 0.3 }` with `fill.gap is not a field; it takes band, hero`; every shipped look passes.

- [ ] **Step 2: RED.** `node --test "T/review-composition.test.mjs"` and `node --test "T/looks.test.mjs"`. Expected: FAIL, `capComposition` and `restsShotAt` are not exported; the bad `fill` is accepted.
- [ ] **Step 3: Implement,** and set `DEFAULT_FILL` and the looks' `fill` to Task 2's values. Update Task 1's assertions that used the starting values only where Task 2 changed them (they pass `DEFAULT_FILL` by name; the three hand-built frames are far from any plausible threshold, so they should hold; if one does not, change the frame's box, not the rule).
- [ ] **Step 4: GREEN, no browser.** The two commands of Step 2, `node --test "T/review.test.mjs"`.
- [ ] **Step 5: The examples, one suite at a time. [BROWSER]** Run each of the six browser suites listed under Files. Each asserts the full list of findings of a shipped example, so each will name the composition findings the examples now get. For each one: open the shot's sheet or its PNG from Task 2, and either accept it (the finding is right: add its `creative dead-space shots[i]` or `creative scale-contrast shots[i]` line to that suite's table of known findings) or reject it (the frame is well filled: give the look a `fill`, with the shot named in a comment). Tasks 4 and 5 then remove the lines their layouts fix.
- [ ] **Step 6: Commit (controller).** `feat(w2): dead-space and scale-contrast findings, calibrated on the gallery, capped at three a film`. The body carries the thresholds, the per-look `fill` values, the firing count per film from `calibration.md`, and the list of example findings accepted.

### Task 4: The cosmos number, recentred

**Files:**
- Modify: `MM/engine/kinds/number-sky.mjs:65-81` (`wideSky`)
- Modify: `T/kinds-number.test.mjs` or `T/cosmos-kinds.test.mjs` (whichever holds the sky's wide-frame assertions: find the test that reads `sunAnchor` for a number shot), `T/cosmos-examples-browser.test.mjs` (`KNOWN`)
- Read: `MM/engine/looks/cosmos.mjs:85` (the sun's anchor: `wide: { x: 0.125, y: 0.5, r: 240 }`), `:161` (`sky: { … above: 56 … fit: 0.86 … }`), `MM/engine/kinds/number-sky.mjs:83-105` (`tallSky` already centres its block: it does not change)

**Interfaces:**
- `wideSky(shot, ctx, fit)` returns the shape it returns today (`fig, earth, sun, align, figLeft, baseline, labelTop, labelLeft, labelWidth, segments, light`), with every y moved by one `shift`: the difference between the editorial band's vertical centre (`editorialBounds(ctx)`) and the centre of the block's ink, which runs from the figure's cap line (`baseline - CAP_HEIGHT * fig.size`) to the label's bottom (the figure's baseline when the shot has no label), plus the delta's height when the shot has one. `skyParts` passes the delta's height to `wideSky` as it does to `tallSky`.

- [ ] **Step 1: Write the failing test** (no browser; `expandShot` and the fake `measure` of `T/helpers/kinds.mjs`):

```js
test('cosmos, 16:9: the figure and its label are centred down the frame, the sun and its line with them', () => {
  const shot = { id: 'n', show: 'number', value: 778, label: 'million kilometres from the Sun', say: 'Seven hundred seventy eight million kilometres.' };
  const { boxes, nodes } = expandShot(shot, 'cosmos', '16:9');
  const top = boxes.value[1], bottom = boxes.label[1] + boxes.label[3];
  assert.ok(Math.abs((top + bottom) / 2 - 540) <= 0.03 * 1080, `block centre ${(top + bottom) / 2}`);
  const line = all(nodes).find((n) => n.id === 'n.line0');
  const y = Number(/M[\d.]+ ([\d.]+)L/.exec(line.props.d)[1]);
  assert.ok(y > boxes.value[1] + boxes.value[3] && y < boxes.label[1], 'the line still runs between the figure and its label');
});
test('cosmos, 9:16: the tall sky is as it was', …); // the same shot's boxes at 9:16 deep-equal a fixture recorded before the change
```

- [ ] **Step 2: RED.** `node --test "T/kinds-number.test.mjs"` (or the cosmos file). Expected: FAIL, the block's centre is about 0.4 of the height (the report measured its content between 0.2 and 0.6).
- [ ] **Step 3: Implement the shift.** Update the assertions that pinned the wide sky's old y values in the same commit; each is an intended change and is listed in the commit body.
- [ ] **Step 4: GREEN, no browser:** the file of Step 2, `node --test "T/cosmos-look.test.mjs"`, `node --test "T/cosmos-sun.test.mjs"`, `node --test "T/cosmos-kinds.test.mjs"`.
- [ ] **Step 5: The picture. [BROWSER]** `node --test --test-concurrency=1 "T/cosmos-examples-browser.test.mjs"`: the number example's `dead-space` line, if Task 3 added one, is now gone; remove it from `KNOWN`. Then one sheet: `node MM/scripts/make.mjs X/look-cosmos.json --sheets-only --out S2/sheets/look-cosmos.mp4` and open the number shot's PNG and the two cut strips beside it. If the sun reads as jumping across a cut, stop and report: decision 2's alternative applies.
- [ ] **Step 6: Commit (controller).** `feat(w2): cosmos centres a number and its label down the frame`, with "changes every cosmos number frame at 16:9, on purpose".

### Task 5: Short statements take more of the frame

**Files:**
- Modify: `MM/engine/kinds/statement.mjs:37` (`DESK`), `:77-123` (`fitEditorial`), `:158-183` (`composeEditorial`); `MM/engine/looks/desk.mjs` (a new `kinds.statement`), `cosmos.mjs:148`, `keynote.mjs:133`
- Modify: `T/kinds-statement.test.mjs`, and the example tables Task 3 touched
- Read: `MM/engine/kinds/statement.mjs:113-116` (`maxLines`, `maxHeight`), `:160` (the last column a wide frame's statement may reach)

**Interfaces:**
- Look data `kinds.statement.fillShort: { words: number, height: number, toWide?: number }`: a statement of at most `words` words on screen may take `height` of the band's height (in place of 0.64) and, on a wide frame, columns up to `toWide` (in place of the look's `toWide`, or 9). Shipped: `desk` `{ words: 6, height: 0.8, toWide: 11 }`, `cosmos` and `keynote` `{ words: 6, height: 0.8 }`. A look without it, a longer statement, a tall frame's own `tallHeight` and a hanging claim (`hang`) are as today.

- [ ] **Step 1: Write the failing tests** (no browser):

```js
const heroSize = (shot, look, format = '16:9') => textNode(expandShot(shot, look, format).nodes, `${shot.id}.text`).props.font.size;
const short = { id: 's', show: 'statement', hold: 2, text: 'Ship it today.' };
const long = { id: 's', show: 'statement', hold: 2, text: 'Most dashboards cannot tell you where a number came from.' };
const without = (name) => ({ ...registries.looks.get(name), kinds: { ...registries.looks.get(name).kinds, statement: { ...registries.looks.get(name).kinds?.statement, fillShort: undefined } } });

for (const look of ['desk', 'cosmos', 'keynote']) {
  test(`${look}: a statement of six words or fewer is set larger than the same look without fillShort`, …);
  //   compare expand through shotContext({ …, look: registries.looks.get(look) }) with shotContext({ …, look: without(look) }): the first size is larger
  test(`${look}: a ten-word statement is set exactly as it was`, …);
  //   the two sizes, the two layouts' line breaks and the text's x and y are equal
}
test('desk: a short statement may reach column 11, and its ink still sits inside the safe area', …);
//   the text's right ink edge is beyond gridX(desk, canvas, 10) and inside the right margin
test('ledger hangs its claim under the tag as before, and pop still stacks', …);
//   heroSize(short, 'ledger') and heroSize(short, 'pop') equal fixtures recorded before the change
```

The first test's node id is whatever the statement kind names its text (`T/kinds-statement.test.mjs` already reads it: use the same accessor).

- [ ] **Step 2: RED.** `node --test "T/kinds-statement.test.mjs"`. Expected: FAIL in the three "set larger" tests (no look carries `fillShort`).
- [ ] **Step 3: Implement.** One reader of `fillShort` in `fitEditorial` (the height share) and one in `composeEditorial` (the last column). The slug clearance, the hero-ratio floor and the highlight rules are untouched.
- [ ] **Step 4: GREEN, no browser:** the file of Step 2, then `node --test "T/cosmos-look.test.mjs"`, `node --test "T/keynote-look.test.mjs"`, `node --test "T/looks.test.mjs"`, `node --test "T/kinds-look1.test.mjs"`. A test that pinned a short statement's old size is updated in this commit and listed in its body.
- [ ] **Step 5: The picture. [BROWSER]** The desk, cosmos and keynote example suites of Task 3, one at a time: remove the `dead-space` and `scale-contrast` lines this fixed; a `safe-area`, `overlap` or `hero` finding that appears is a bug in this task, not a line to add.
- [ ] **Step 6: Commit (controller).** `feat(w2): a statement of six words or fewer takes more of the frame in desk, cosmos and keynote`, with "changes those frames, on purpose".

### Task 6: J and L cuts: the `narration` field and the shifted timeline

**Files:**
- Modify: `MM/engine/script/timing.mjs:94-97` (`NARRATION_LEAD`, `narrationStart`), `:328-357` (`buildTimeline`, the branch that is not a recording); `MM/scripts/v2/spec.mjs:92-99` (`SHOT_PROPERTIES`), beside `:486-492` (`checkShots`: a film-level check), `MM/scripts/v2/list.mjs:18-25` (`COMMON_SHOT_FIELDS`), `MM/references/schema.md:49-56` (the table `BT/make-motion-docs.test.mjs:199-202` compares with `COMMON_SHOT_FIELDS`, in order)
- Create: `T/narration-shift.test.mjs`
- Read: `MM/engine/script/timing.mjs:123` (`shownFromShotStart`: a shot's first word is shown from its first frame), `:181` (`toFrames`, `MIN_SHOT_SECONDS = 1`), `:197-203` (`PlacementError`), `MM/scripts/v2/run.mjs:215-229` (a `PlacementError` from the measured timeline becomes findings), `MM/scripts/v2/pipeline.mjs:58-63` (the validator runs, then a timeline is built with no catch)

**Interfaces:**
- The film: a shot's optional `narration: { lead?: number, trail?: number }`, each 0 to 1.5, no other key.
- Produces, in `timing.mjs`:
  - `NARRATION_SHIFT_MAX = 1.5`
  - `narrationStart(shot) = shot.start + (shot.narrationAt ?? NARRATION_LEAD)`
  - `buildTimeline` as today, then for a film with any non-zero `narration`: each seam between shot `k` and `k + 1` moves by `round(lead(k + 1) * fps) - round(trail(k) * fps)` frames (later for a lead, earlier for a trail). The shot before the seam gains those frames and the shot after loses them, so the film's length and every word's film second do not change. A shot whose opening seam moved by `s` frames carries `narrationAt: -s / fps`; every word's `soundStart` and `soundEnd` gain `narrationAt`; a word's shown `start` and `end` are clamped into `[0, duration]`, the first word still shown from 0. An entry whose seam did not move has no `narrationAt` key. A shot ends its mode's tail after its last word (0.6 s in `pro`, 0.3 s in `viral`: `MM/engine/modes/pro.mjs:12`, `viral.mjs:12`), so a `trail` no longer than the tail moves the cut into that silence and no word crosses it; that is allowed, and `story.md` says so (Task 11).
  - It throws `PlacementError` with `{ path: 'shots[i].narration.lead' | 'shots[i].narration.trail', message }` when the shortened shot would last under `MIN_SHOT_SECONDS` or under the cut that opens it (`left` is clamped at 0 and printed with one decimal, so a shift longer than the whole shot reads `0 s`; review fix): `a ${field} of ${seconds} s leaves shot "${id}" ${left} s; a shot lasts at least 1 s${cut ? ` and at least its cut (${cut} s)` : ''}`.
- Produces, in `spec.mjs`: `narrationErrors(spec, ctx) -> { path, message }[]`, called by `validateFilm` after the shot checks:
  - `shots[0].narration.lead`: `the first shot has nothing before it for its narration to start over; remove "lead"` (when above 0)
  - the last shot's `narration.trail`: `the last shot has nothing after it for its narration to run over; remove "trail"` (when above 0)
  - `shots[i].narration`, a shot with no `say`: `a shot with no "say" has no narration to move; remove "narration"`
  - `shots[i].narration`, a film whose `voice` has a `src`: `a recording sets where its own words fall; "narration" works with a made voice or with no voice`
  - `shots[i + 1].narration.lead`, when shot `i` has a `trail` above 0: `shot "${id of i}" already trails over this cut (its narration.trail); keep one of the two`
  - and, when none of those fired, the errors of a `PlacementError` from `buildTimeline` on the estimated timeline.
- `COMMON_SHOT_FIELDS` gains `{ name: 'narration', type: 'object', required: false }` after `cut`; `schema.md` gains the row `` | `narration` | `{ "lead", "trail" }`, seconds from 0 to 1.5 | Sound across a cut: `lead` starts this shot's narration before its picture, `trail` lets it run into the next shot's picture. Needs `say` | `` in the same place.

- [ ] **Step 1: Write the failing tests.**

```js
const FPS = 30;
const FILM = { version: 2, mode: 'pro', shots: [
  { id: 'a', show: 'statement', say: 'One two three four five six.' },
  { id: 'b', show: 'statement', say: 'Seven eight nine ten eleven twelve.' },
  { id: 'c', show: 'statement', say: 'Thirteen fourteen fifteen sixteen.' },
] };
const withOn = (id, extra) => ({ ...FILM, shots: FILM.shots.map((s) => (s.id === id ? { ...s, ...extra } : s)) });
const build = (film, options = {}) => buildTimeline(film, { fps: FPS, ...options });
const frames = (seconds) => Math.round(seconds * FPS);
const heardAt = (timeline) => timeline.shots.flatMap((s) => s.words.map((w) => Math.round((s.start + w.soundStart) * 1e6)));
const base = build(FILM);

test('a lead of 0.5 s on b moves its cut 15 frames later: a is longer, b shorter, the film as long, every word heard when it was', () => {
  const led = build(withOn('b', { narration: { lead: 0.5 } }));
  assert.equal(frames(led.shots[1].start), frames(base.shots[1].start) + 15);
  assert.equal(frames(led.shots[0].duration), frames(base.shots[0].duration) + 15);
  assert.equal(frames(led.shots[1].duration), frames(base.shots[1].duration) - 15);
  assert.equal(led.frameCount, base.frameCount);
  assert.equal(frames(led.shots[2].start), frames(base.shots[2].start));
  assert.deepEqual(heardAt(led), heardAt(base));
  assert.equal(frames(led.shots[1].narrationAt), -15);
  assert.equal(frames(narrationStart(led.shots[1])), frames(narrationStart(base.shots[1])));
  assert.ok(!('narrationAt' in led.shots[0]) && !('narrationAt' in led.shots[2]));
});
test('a trail of 1 s on a moves the same cut 30 frames earlier, b narrates from 1 s into its picture, and a\'s last word is heard over b', () => {
  // the pro mode keeps 0.6 s after a shot's last word (MM/engine/modes/pro.mjs:12), so a trail must be longer than that for a word to cross the cut
  const trailed = build(withOn('a', { narration: { trail: 1 } }));
  assert.equal(frames(trailed.shots[1].start), frames(base.shots[1].start) - 30);
  assert.equal(frames(trailed.shots[1].narrationAt), 30);
  assert.deepEqual(heardAt(trailed), heardAt(base));
  const last = trailed.shots[0].words.at(-1);
  assert.ok(last.soundStart >= trailed.shots[0].duration - 1e-9, 'the fixture: the last word starts after its own picture has gone');
  assert.ok(last.end <= trailed.shots[0].duration + 1e-9, 'its shown time is clamped into the shot');
  const inTail = build(withOn('a', { narration: { trail: 0.4 } }));
  assert.ok(inTail.shots[0].words.at(-1).soundEnd <= inTail.shots[0].duration + 1e-9, 'a trail inside the tail moves the cut into silence: no word crosses');
});
test('the picture never shows a word outside its shot: shown times are clamped, heard times are not', () => {
  const led = build(withOn('b', { narration: { lead: 0.5 } }));
  const [first] = led.shots[1].words;
  assert.equal(first.start, 0);
  assert.ok(first.soundStart < 0);
  for (const shot of led.shots) for (const w of shot.words) assert.ok(w.start >= 0 && w.end <= shot.duration + 1e-9 && w.start <= w.end, `${shot.id} ${w.text}`);
});
test('no narration, and zeros, are today\'s timeline exactly, with no new key', () => {
  assert.deepEqual(build(withOn('b', { narration: { lead: 0, trail: 0 } })), base);
  assert.deepEqual(build(withOn('b', { narration: {} })), base);
  assert.ok(base.shots.every((s) => !('narrationAt' in s)));
});
test('a measured timeline shifts the same way', () => {
  const words = base.shots.map((s) => ({ id: s.id, seconds: s.words.at(-1).end, sentences: [{ words: s.words.map(({ text, start, end }) => ({ text, start, end })) }] }));
  const plain = build(FILM, { words }), led = build(withOn('b', { narration: { lead: 0.5 } }), { words });
  assert.equal(led.timed, 'measured');
  assert.equal(frames(led.shots[1].start), frames(plain.shots[1].start) + 15);
  assert.deepEqual(heardAt(led), heardAt(plain));
});
test('a shift that leaves a shot under 1 s, or under the cut that opens it, is a PlacementError at the field', () => {
  const short = { ...FILM, shots: FILM.shots.map((s) => (s.id === 'b' ? { ...s, say: 'Go.', narration: { lead: 1.5 } } : s)) };
  assert.throws(() => build(short), (err) => err instanceof PlacementError && err.errors[0].path === 'shots[1].narration.lead'
    && /^a lead of 1\.5 s leaves shot "b" [\d.]+ s; a shot lasts at least 1 s$/.test(err.errors[0].message));
  const cut = withOn('b', { cut: { type: 'crossfade', duration: 2 }, narration: { lead: 1.5 } });
  assert.ok(build(withOn('b', { cut: { type: 'crossfade', duration: 2 } })).shots[1].duration - 1.5 < 2, 'the fixture leaves b shorter than its 2 s cut');
  assert.throws(() => build(cut), (err) => /and at least its cut \(2 s\)$/.test(err.errors[0].message));
});
```

And, through `validateFilm` (import it; `specDir` a temp folder):

```js
const errorsOf = (film) => validateFilm(film, { specDir }).errors.map((e) => `${e.path}: ${e.message}`);
test('the field is refused where it cannot work, each with its path', () => {
  assert.deepEqual(errorsOf(withOn('a', { narration: { lead: 0.3 } })), ['shots[0].narration.lead: the first shot has nothing before it for its narration to start over; remove "lead"']);
  assert.deepEqual(errorsOf(withOn('c', { narration: { trail: 0.3 } })), ['shots[2].narration.trail: the last shot has nothing after it for its narration to run over; remove "trail"']);
  const held = { ...FILM, shots: [FILM.shots[0], { id: 'b', show: 'statement', text: 'Hold', hold: 2, narration: { lead: 0.3 } }, FILM.shots[2]] };
  assert.deepEqual(errorsOf(held), ['shots[1].narration: a shot with no "say" has no narration to move; remove "narration"']);
  const both = { ...FILM, shots: [{ ...FILM.shots[0], narration: { trail: 0.3 } }, { ...FILM.shots[1], narration: { lead: 0.3 } }, FILM.shots[2]] };
  assert.deepEqual(errorsOf(both), ['shots[1].narration.lead: shot "a" already trails over this cut (its narration.trail); keep one of the two']);
  assert.match(errorsOf(withOn('b', { narration: { lead: 1.6 } })).join('\n'), /^shots\[1\]\.narration\.lead: /);
  assert.match(errorsOf(withOn('b', { narration: { lean: 0.2 } })).join('\n'), /^shots\[1\]\.narration/);
  assert.deepEqual(errorsOf(withOn('b', { narration: { lead: 0.5 } })), []);
});
test('a shift too long for its shot is a validation error, so loadFilm never throws on it', () => {
  const short = { ...FILM, shots: FILM.shots.map((s) => (s.id === 'b' ? { ...s, say: 'Go.', narration: { lead: 1.5 } } : s)) };
  assert.match(errorsOf(short).join('\n'), /^shots\[1\]\.narration\.lead: a lead of 1\.5 s leaves shot "b"/);
});
test('a recorded voice refuses the field', …);
//   a film with voice: { src, words } (the fixture pair T/voice-external.test.mjs uses) and narration on its second shot:
//   errorsOf includes 'shots[1].narration: a recording sets where its own words fall; "narration" works with a made voice or with no voice'
```

- [ ] **Step 2: Run to see RED.** `node --test "T/narration-shift.test.mjs"`. Expected: FAIL: the validator refuses `narration` as an unknown field, and the timeline does not move.
- [ ] **Step 3: Implement** the schema, `narrationErrors`, the seam shifts in `buildTimeline` (one helper under 50 lines; the recording branch is untouched), the list field and the `schema.md` row.
- [ ] **Step 4: Run to see GREEN.** The same command, then `node --test "T/timing.test.mjs"` (its tests at `:109` and `:123` hold: a shot with no shift is never shorter than its WAV, and `narrationStart` is the shot start), `node --test "T/spec.test.mjs"`, `node --test "T/script.test.mjs"`, `node --test "BT/make-motion-docs.test.mjs"`. Expected: PASS.
- [ ] **Step 5: Commit (controller).** `feat(w2): a shot's narration may lead or trail its cut; the cut moves, the sound does not`.

### Task 7: Sound, captions and the cut-window rule follow the shift

**Files:**
- Modify: `MM/engine/captions/groups.mjs` (new export), `MM/engine/captions/index.mjs:89,113-119` (`captioned`, `shotCaptions`), `MM/engine/graph/film.mjs:177-181` (`withCaptions`), `:194-214` (`expandOne` passes the timeline and the index)
- Create: `T/captions-heard-shift.test.mjs`
- Read: `MM/scripts/v2/sound/duck.mjs:64-66` (`heardWordSpans`), `MM/scripts/v2/sound/events.mjs:49-54` (emphasis events), `MM/scripts/v2/subtitles.mjs:17-28`, `MM/scripts/v2/voice/master.mjs:147-150,271-279` (`gainStages`, `voiceTrackArgs`): each already computes `shot.start + soundStart` or calls `narrationStart`, so none of them changes; `MM/scripts/v2/review.mjs:316-329` (`cutWindowFindings` reads the timeline's durations)

**Interfaces:**
- Consumes: Task 6's timeline (`narrationAt`, signed `soundStart`).
- Produces: `captionWordsOf(timeline, index) -> word[]`: the words heard while shot `index` is on screen (`shot.start <= heard < shot.end`, the last shot also owning its end), from shot `index` and its two neighbours, in the order heard, each in shot `index`'s own seconds. A word of the shot itself keeps its shown `start` and `end`; a word of a neighbour has `start` and `end` equal to its heard times and carries `from: <its shot's index>`. For a timeline with no shift it returns `timeline.shots[index].words` unchanged.
- `shotCaptions(shot, ctx, { kind, hero, filmStart, nodes, camera, words })`: `words` is `captionWordsOf(timeline, index)`. A kind that shows its own words (`showsWordsOf`) captions only the words with a `from`; any other kind captions all of them.

- [ ] **Step 1: Write the failing tests.**

```js
// FILM, withOn, build, frames, base as in narration-shift.test.mjs; `star` gives b an emphasised word
const star = (film) => ({ ...film, shots: film.shots.map((s) => (s.id === 'b' ? { ...s, say: 'Seven *eight* nine ten eleven twelve.' } : s)) });
const led = build(star(withOn('b', { narration: { lead: 0.5 } }))), plain = build(star(FILM));
const round = (list) => JSON.parse(JSON.stringify(list, (k, v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v)));

test('what is heard does not move: the duck spans, the subtitle cues, the emphasis events and the voice track are the unshifted film\'s', () => {
  assert.deepEqual(round(heardWordSpans(led)), round(heardWordSpans(plain)));
  assert.deepEqual(round(subtitleCues(led)), round(subtitleCues(plain)));
  const emphasis = (timeline) => soundEvents(star(FILM), timeline).filter((e) => e.kind === 'emphasis').map((e) => Math.round(e.t * 1e6));
  assert.deepEqual(emphasis(led), emphasis(plain));
  const shots = [{ wav: '/v/a.wav' }, { wav: '/v/b.wav' }, { wav: '/v/c.wav' }];
  assert.deepEqual(voiceTrackArgs({ shots, timeline: led, out: '/v/x.wav' }), voiceTrackArgs({ shots, timeline: plain, out: '/v/x.wav' }));
});
test('the cut\'s own cue follows the picture: it is 0.5 s later', () => {
  const cutAt = (timeline) => soundEvents(star(FILM), timeline).find((e) => e.kind === 'cut' && e.shot === 'b')?.t;
  // FILM names no cut, so give b one: use withOn('b', { cut: 'slide' }) on both films before building
  …  assert.equal(frames(cutAt(ledWithSlide)), frames(cutAt(plainWithSlide)) + 15);
});
test('captionWordsOf: with no shift it is the shot\'s own words; with a lead, b\'s early words belong to a', () => {
  plain.shots.forEach((s, i) => assert.deepEqual(captionWordsOf(plain, i), s.words));
  const onA = captionWordsOf(led, 0), onB = captionWordsOf(led, 1);
  const early = onA.filter((w) => w.from === 1);
  assert.ok(early.length >= 1 && early[0].text === 'Seven');
  assert.ok(early.every((w) => w.start >= 0 && w.start < led.shots[0].duration));
  assert.ok(onB.every((w) => w.from === undefined) && !onB.some((w) => w.text === 'Seven'));
  const total = [0, 1, 2].reduce((n, i) => n + captionWordsOf(led, i).length, 0);
  assert.equal(total, led.shots.reduce((n, s) => n + s.words.length, 0), 'every word is captioned by exactly one shot');
});
test('with a trail longer than the mode\'s tail, a\'s last word belongs to b', () => {
  const trailed = build(withOn('a', { narration: { trail: 1 } })); // pro keeps 0.6 s after the last word
  assert.ok(trailed.shots[0].words.at(-1).soundStart >= trailed.shots[0].duration - 1e-9, 'the fixture: "six." is heard after a\'s picture');
  assert.ok(captionWordsOf(trailed, 1).some((w) => w.from === 0 && w.text === 'six.'));
  assert.ok(!captionWordsOf(trailed, 0).some((w) => w.text === 'six.'));
});
test('a captioned film draws b\'s early words on a, also when a shows its own words (decision 4)', () => {
  const film = { ...star(withOn('b', { narration: { lead: 0.5 } })), captions: true, look: 'desk', format: '16:9', fps: FPS, seed: 1 };
  const timeline = build(film);
  const built = buildFilm({ film, timeline, measure, canvas: canvasOf('16:9') });
  const late = JSON.stringify(built.sampleShot(0, timeline.shots[0].duration - 0.1));
  assert.ok(late.includes('a.captions') && late.includes('"Seven"'), 'a statement shot captions the neighbour\'s words');
  assert.ok(!JSON.stringify(built.sampleShot(1, 0.2)).includes('"Seven"') || !JSON.stringify(built.sampleShot(1, 0.2)).includes('b.captions'));
  const before = buildFilm({ film: { ...star(FILM), captions: true, look: 'desk', format: '16:9', fps: FPS, seed: 1 }, timeline: plain, measure, canvas: canvasOf('16:9') });
  assert.ok(!JSON.stringify(before.sampleShot(0, 0.5)).includes('a.captions'), 'a statement with no shift has no captions, as today');
});
test('the cut-window rule reads the shifted shot', () => {
  const cut = { type: 'crossfade', duration: 1 };
  const filmA = withOn('b', { cut }), filmB = withOn('b', { cut, narration: { lead: 1.5 } });
  const tA = build(filmA), tB = build(filmB);
  assert.ok(tA.shots[1].duration >= 2 && tB.shots[1].duration < 2, 'the fixture: b is at least twice its cut before the lead, under twice after');
  assert.deepEqual(cutWindowFindings(filmA, tA), []);
  assert.deepEqual(cutWindowFindings(filmB, tB).map((f) => [f.kind, f.rule, f.path]), [['creative', 'cut-window', 'shots[1].cut']]);
});
```

- [ ] **Step 2: Run to see RED.** `node --test "T/captions-heard-shift.test.mjs"`. Expected: the first, second and last tests PASS already (they pin that Task 6's sign convention is enough); the three `captionWordsOf` tests and the captioned-film test FAIL, `captionWordsOf` is not exported.
- [ ] **Step 3: Implement** `captionWordsOf` and thread `words` to `shotCaptions`. The caption styles' `compose(words, ctx)` is unchanged.
- [ ] **Step 4: Run to see GREEN.** The same command, then `node --test "T/captions.test.mjs"`, `node --test "T/captions-heard.test.mjs"`, `node --test "T/captions-place.test.mjs"`, `node --test "T/kinds-film.test.mjs"`. Expected: PASS, unchanged (no shift, same words).
- [ ] **Step 5: Commit (controller).** `feat(w2): captions follow what is heard across a cut; sound and the cut-window rule pinned to the shifted timeline`.

### Task 8: A live outgoing shot

**Files:**
- Modify: `MM/engine/graph/film.mjs:268-274` (`sampleShot`), `:282-306` (`frameAt`), `MM/engine/page/cut-pictures.mjs:1-5,22-28` (the header and `outgoingOf`), `MM/engine/cuts/layers.mjs:1-3` (the header), `MM/scripts/v2/list.mjs:52-54,99-106` (`cutEntry`, `cutText`), `MM/references/schema.md:104-106`
- Modify: `T/cuts-layers.test.mjs:122-130` (it pins the frozen sample: an intended edit)
- Create: `T/cuts-live-browser.test.mjs`
- Read: `MM/engine/time/track.mjs:118` (a track holds its last key past its end), `MM/engine/kinds/media-clip.mjs:18` (`frameIndexOf` clamps to the clip's last frame), `MM/engine/kinds/camera.mjs:18-23` (the resting drift's keys stop at the shot's duration), `MM/engine/page/stage.mjs:63-72` (a window's state key carries the cut's progress, so no window frame is held), `MM/engine/page/clip-frames.mjs:24` (the outgoing tree's clip frames are already loaded)

**Interfaces:**
- `sampleShot(index, t)`: for `t` past the shot's duration `D`, the nodes are sampled at `t` (every track holds its last key) and the camera is the shot's camera at `D` with its pan carried on at its end velocity: `x(t) = x(D) + (x(D) - x(D - 1 / fps)) * fps * (t - D)`, the same for `y`; zoom and rotate hold. For `t <= D` it is unchanged.
- `outgoingTime(cut, look, D, local) -> number` (exported from `film.mjs`): `D + local` for a layer or shader cut in a look with no `hand`, else `D`. `frameAt` samples the outgoing shot at it for every family.
- `frameAt`, inside the window of a layer or shader cut in a look with no `hand`: `from: { shot, background, sampled: sampleShot(index - 1, D + local), t: prev.start + D + local, live: true }`. A node-family cut (and so every smeared cut) and any cut in a hand look keep today's outgoing sample, frozen at `D`, with no `live` key.
- `cut-pictures.mjs` `outgoingOf(state)` redraws when the shot or `state.from.t` differs from the picture it holds.
- `--list cuts`: each entry gains `outgoing: 'live' | 'frozen'` (`frozen` for the node family), and the text line ends `; outgoing live` or `; outgoing frozen`. `schema.md`'s Cuts section gains: "A layer or shader cut shows the outgoing shot still moving; a node cut (and a smear) holds its last frame, and so does every cut in a look drawn by hand."

- [ ] **Step 1: Write the failing tests.** In `T/cuts-layers.test.mjs`, replace the test at `:122` with:

```js
test('frameAt inside a wipe\'s window: the incoming shot live, the cut and its progress, the outgoing shot sampled past its end', () => {
  const { timeline, built } = wipeFilm();
  const start = timeline.shots[1].start, D = timeline.shots[0].duration;
  const frame = built.frameAt(start + 0.2);
  assert.deepEqual(frame.cut, { name: 'wipe', family: 'layer', p: 0.5, direction: 'left' });
  assert.deepEqual(frame.sampled, built.sampleShot(1, 0.2));
  assert.deepEqual(frame.from, { shot: 0, background: '#ff0000', sampled: built.sampleShot(0, D + 0.2), t: timeline.shots[0].end + 0.2, live: true });
});
test('a drifting shot keeps drifting past its end at the speed it ended with', () => {
  // two desk statements with a hold of 2, the second with "cut": "crossfade": desk drifts (MM/engine/looks/desk.mjs camera.drift)
  const hero = (t) => built.sampleShot(0, t).find((n) => n.type === 'text' || n.children?.some((c) => c.type === 'text'));
  near(hero(D + 0.2).x - hero(D).x, hero(D).x - hero(D - 0.2).x, 'the same travel in the same time');
  assert.notEqual(hero(D + 0.2).x, hero(D).x);
  assert.deepEqual(built.sampleShot(0, D - 0.5), builtBefore.sampleShot(0, D - 0.5)); // inside the shot nothing changes: builtBefore is the same film with "cut": "cut"
});
test('which cuts take the outgoing shot live: a layer or shader cut in a look without a hand; a node cut and a hand look hold the end', () => {
  const desk = registries.looks.get('desk'), marker = registries.looks.get('marker');
  assert.equal(outgoingTime({ family: 'layer' }, desk, 3, 0.2), 3.2);
  assert.equal(outgoingTime({ family: 'shader' }, desk, 3, 0.2), 3.2);
  assert.equal(outgoingTime({ family: 'node' }, desk, 3, 0.2), 3);
  assert.equal(outgoingTime({ family: 'layer' }, marker, 3, 0.2), 3);
});
test('--list cuts says which cuts keep the outgoing shot moving', () => {
  const byName = Object.fromEntries(listEntries('cuts').map((e) => [e.name, e.outgoing]));
  assert.deepEqual([byName.cut, byName.slide, byName.punch, byName.crossfade, byName.iris, byName.ripple], ['frozen', 'frozen', 'frozen', 'live', 'live', 'live']);
});
```

`T/cuts-live-browser.test.mjs` **[BROWSER]** (with `openStage`): a film in look `ledger` (its post pass has no grain, so two frames differ only where the picture does) of two `free` shots, the first on the `mesh` field (painted from the time), the second a flat colour arriving by `{ "type": "wipe", "direction": "right" }` (a wipe leaves the outgoing picture untouched where its edge has not reached; a crossfade would change its opacity and prove nothing):

```js
test('the outgoing picture moves inside the window: the right 30% of the frame, which a wipe from the left has not reached, differs between p 0.1 and p 0.4', …);
//   read window.__source (the frame before the post pass) at the two frames; compare the pixels with x >= 0.7 * width.
//   Today the outgoing picture is drawn once and kept, so the two crops are equal: this assertion is the RED.
test('the same crop at one frame, read twice, is equal', …);  // the comparison is not noise
test('seek order: the window\'s frames read forwards, then backwards, then backwards in a fresh page, hash the same', …);
test('a film with no layer or shader cut still makes no second picture', …);  // window.__cutCanvases() === 0, as cuts-browser.test.mjs:110
```

- [ ] **Step 2: Run to see RED.** `node --test "T/cuts-layers.test.mjs"`. Expected: FAIL: `from.sampled` is the frozen sample, there is no `live`, `outgoingTime` is not exported and `outgoing` is undefined. Then `node --test --test-concurrency=1 "T/cuts-live-browser.test.mjs"` **[BROWSER]**: FAIL in "the outgoing picture moves inside the window" (the two crops are equal).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to see GREEN, no browser:** the same command, `node --test "T/cuts-resolve.test.mjs"`, `node --test "T/kinds-film.test.mjs"`, `node --test "T/kinds-frozen.test.mjs"`, `node --test "T/cuts-match.test.mjs"`. The fixture `T/fixtures/cuts/baseline-keys.json` (node cuts only) must pass unchanged.
- [ ] **Step 5: Run the browser tests, one file at a time. [BROWSER]** `T/cuts-live-browser.test.mjs`, then `T/cuts-browser.test.mjs` (its tests at `:76`, `:84`, `:92` and `:110` use still shots: a window's first frame is still the outgoing picture exactly, since `sampleShot(i, D + 0)` is the frozen sample), `T/cuts-determinism-browser.test.mjs`, `T/cuts-look-browser.test.mjs`, `T/cuts-legible-browser.test.mjs`, `T/cuts-round2-browser.test.mjs`, `T/cuts-direction-browser.test.mjs`, `T/clips-browser.test.mjs`. A test that pinned pixels of a window between drifting shots or over a time-painted field changes on purpose: update it and list it in the commit body. Any other failure is a bug in this task.
- [ ] **Step 6: Commit (controller).** `feat(w2): a layer or shader cut shows the outgoing shot still moving`, with "changes frames inside those windows where the outgoing shot drifts or its field moves, on purpose; node cuts, smears and hand looks hold the last frame".

### Task 9: `at` on iris and zoom: a cut that opens from the thing on screen

**Files:**
- Modify: `MM/engine/cuts/resolve.mjs:16` (`CUT_KEYS`), `:34-51` (`resolveCut`), `:102-120` (`cutOptionProblems`), `:193-196` (`explicitCut`, which rebuilds the cut a kind sees and would drop a new key); `MM/scripts/v2/spec-cuts.mjs:9` (`SHAPE`), `:46-56` (`cutErrors`); `MM/scripts/v2/spec.mjs:278-287` (`checkCut`, `checkRootCut`); `MM/engine/cuts/layers.mjs:23,59-96` (`pose`, the `iris` and `zoom` recipes, their entries); `MM/engine/graph/camera.mjs` (new export); `MM/engine/graph/film.mjs:194-221` (`expandOne` keeps the kind's boxes), `:282-298` (`frameAt`); `MM/engine/page/stage.mjs:118-126` (`cutRecipe`); `MM/engine/page/cut-pictures.mjs:38-56` (`place` scales about the canvas centre today); `MM/scripts/v2/list.mjs:52-54`
- Create: `T/cuts-origin.test.mjs`
- Read: `MM/scripts/v2/spec.mjs:356-372` (`kindTargets`: a shot's target names at validation), `MM/engine/kinds/shared.mjs:386-391` (an `on` event's target is a key of the kind's `boxes`; a missing one throws naming the keys there are), `MM/engine/looks/index.mjs:202` (`CUT_STYLE_KEYS` does not gain `at`: a look cannot default it), `MM/engine/cuts/layers.mjs:93` (the iris summary says it opens about a point the look keeps clear of words; an origin on words reverses that, so Task 12 views the edge)

**Interfaces:**
- The film: a shot's own cut object may carry `at`, a target name of the shot before it (the same names `on[].target` takes on that shot). Only a cut whose registry entry has `origin: true` takes it: `iris`, `zoom`, and Task 10's `flood`. The film's root `cut` does not take it.
- `resolveCut(value, options)` also returns `at: string | null`, read from the shot's own value only. `explicitCut(cut)` writes `at` when it is not null.
- `cutOptionProblems`: `at` must be a non-empty string, on a cut with `origin: true`; else `{ key: 'at', message: 'the "${name}" cut takes no "at"; the cuts that open from a point: ${names}' }`.
- `cutErrors(cut, at, { look, first, regs, outgoing })`, `outgoing: { id, kind, targets: string[] | null } | null` (the shot before; `targets` null when they cannot be known). Errors at `<path>.at`: `unknown target "${t}"; ${hint}the targets of shot "${id}" (${kind}) are: ${list}`, or, for a shot with none, `shot "${id}" (${kind}) has no targets for a cut to open from; remove "at"`. `checkRootCut` reports `cut.at: "at" names a target of the shot before, so it goes on a shot's own cut, not the film's`.
- `pointThroughCamera([x, y], cam, canvas, depth = 0) -> [x, y]` in `camera.mjs`: where a point of a node at `depth` stands under `cam`, by the same arithmetic as `moveNode`.
- `buildFilm`: a shot whose cut has `at` gets `origin`, the centre of `boxes[at]` of the shot before, through that shot's camera at its end. A name the boxes lack throws `shot "${id}": cut at "${at}" has no box in shot "${prev id}" (have: ${keys})`. `frameAt`'s `cut` carries `at: [x, y]` only for such a shot (so a cut without one is the object it is today).
- `layers({ p, direction, canvas, look, at = null })`: the iris opens or closes about `at` when given, else the look's `irisAt`, else the centre. A pose gains `origin: [x, y] | null` (null: the canvas centre); the zoom's incoming pose carries `at` as its origin. `cut-pictures.mjs` `place` scales about `pose.origin ?? [w / 2, h / 2]`. `cutRecipe` passes `cut.at`, to a shader cut's stand-in too.
- `--list cuts`: an entry gains `at: true | false`, and the text line `; opens from a point (at)` when true.

- [ ] **Step 1: Write the failing tests.**

```js
const CANVAS = { w: 1920, h: 1080 };
const recipe = (name, extra) => registries.cuts.get(name).layers({ p: 0.5, direction: 'in', canvas: CANVAS, ...extra });
const origins = () => registries.cuts.names().filter((n) => registries.cuts.get(n).origin === true);

test('iris and zoom open from the point they are given, and from where they did without one', () => {
  assert.deepEqual(recipe('iris', { at: [300, 200] }).to.clip.circle.slice(0, 2), [300, 200]);
  assert.ok(registries.cuts.get('iris').layers({ p: 1, direction: 'in', canvas: CANVAS, at: [300, 200] }).to.clip.circle[2] >= Math.hypot(1920 - 300, 1080 - 200));
  assert.deepEqual(recipe('iris').to.clip.circle.slice(0, 2), [960, 540]);
  assert.deepEqual(recipe('zoom', { at: [300, 200] }).to.origin, [300, 200]);
  assert.equal(recipe('zoom').to.origin, null);
  assert.ok(origins().includes('iris') && origins().includes('zoom') && !origins().includes('wipe'));
});
test('resolveCut reads at from the shot\'s own cut only, and explicitCut keeps it', () => {
  assert.equal(resolveCut({ type: 'iris', at: 'region:r' }).at, 'region:r');
  assert.equal(resolveCut('iris').at, null);
  assert.equal(resolveCut(undefined, { rootCut: { type: 'iris', at: 'region:r' } }).at, null);
  assert.deepEqual(explicitCut(resolveCut({ type: 'iris', at: 'region:r' })), { type: 'iris', direction: 'in', duration: 0.4, smear: false, at: 'region:r' });
  assert.deepEqual(explicitCut(resolveCut('iris')), { type: 'iris', direction: 'in', duration: 0.4, smear: false });
});
test('a cut that opens from no point refuses at, naming the cuts that do', () => {
  assert.deepEqual(cutOptionProblems({ type: 'wipe', at: 'x' }, 'wipe'), [{ key: 'at', message: `the "wipe" cut takes no "at"; the cuts that open from a point: ${origins().join(', ')}` }]);
});
test('pointThroughCamera: the identity leaves a point; a pan of 100 and a zoom of 2 move it as they move a node', () => {
  const still = { x: 0, y: 0, zoom: 1, rotate: 0 };
  assert.deepEqual(pointThroughCamera([300, 200], still, CANVAS), [300, 200]);
  assert.deepEqual(pointThroughCamera([960, 540], { ...still, x: 100, zoom: 2 }, CANVAS), [860, 540]);
  assert.deepEqual(pointThroughCamera([1060, 540], { ...still, x: 100, zoom: 2 }, CANVAS), [1060, 540]);
});
```

Validation, with the examples folder as `specDir` (it holds `clipping.png`) and the clipping of `T/helpers/kinds.mjs:168` with `src: 'clipping.png'`:

```js
const A = { ...CLIP({ id: 'a' }), src: 'clipping.png' };
const film = (cut, extra = {}) => ({ version: 2, mode: 'pro', shots: [A, { id: 'b', show: 'statement', say: 'Next.', ...(cut === undefined ? {} : { cut }) }], ...extra });
const errorsOf = (f) => validateFilm(f, { specDir: X }).errors.map((e) => `${e.path}: ${e.message}`);

test('at names a target of the shot before: a known one passes, an unknown one lists the targets there are', () => {
  assert.deepEqual(errorsOf(film({ type: 'iris', at: 'region:r' })), []);
  const [unknown] = errorsOf(film({ type: 'iris', at: 'region:q' }));
  assert.match(unknown, /^shots\[1\]\.cut\.at: unknown target "region:q"; .*the targets of shot "a" \(clipping\) are: .*region:r/);
  assert.deepEqual(errorsOf(film({ type: 'wipe', at: 'region:r' })), [`shots[1].cut.at: the "wipe" cut takes no "at"; the cuts that open from a point: ${origins().join(', ')}`]);
  assert.deepEqual(errorsOf(film(undefined, { cut: { type: 'iris', at: 'region:r' } })), ['cut.at: "at" names a target of the shot before, so it goes on a shot\'s own cut, not the film\'s']);
});
test('a shot with no targets cannot be opened from', () => {
  const f = { version: 2, mode: 'pro', shots: [{ id: 'a', show: 'free', hold: 1, background: '#101820', nodes: [] }, { id: 'b', show: 'statement', say: 'Next.', cut: { type: 'iris', at: 'x' } }] };
  assert.deepEqual(errorsOf(f), ['shots[1].cut.at: shot "a" (free) has no targets for a cut to open from; remove "at"']);
});
test('the built film gives the window one fixed point inside the frame, and a name the boxes lack is an error by name', () => {
  const b = { id: 'b', show: 'statement', say: 'Next.', cut: { type: 'iris', at: 'region:r' } };
  const f = { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: 30, seed: 1, shots: [CLIP({ id: 'a' }), b] }; // CLIP's src is shot.png, which IMAGES holds
  const timeline = buildTimeline(f, { fps: 30 });
  const built = buildFilm({ film: f, timeline, measure, assets: IMAGES, canvas: canvasOf('16:9') });
  const start = timeline.shots[1].start;
  const [x, y] = built.frameAt(start + 0.1).cut.at;
  assert.ok(x > 0 && x < 1920 && y > 0 && y < 1080);
  assert.deepEqual(built.frameAt(start + 0.3).cut.at, [x, y]);
  const bad = { ...f, shots: [f.shots[0], { ...f.shots[1], cut: { type: 'iris', at: 'region:zzz' } }] };
  assert.throws(() => buildFilm({ film: bad, timeline, measure, assets: IMAGES, canvas: canvasOf('16:9') }), /^Error: shot "b": cut at "region:zzz" has no box in shot "a" \(have: /);
  const plain = buildFilm({ film: { ...f, shots: [f.shots[0], { ...f.shots[1], cut: 'iris' }] }, timeline, measure, assets: IMAGES, canvas: canvasOf('16:9') });
  assert.deepEqual(Object.keys(plain.frameAt(start + 0.1).cut), ['name', 'family', 'p', 'direction']);
});
```

- [ ] **Step 2: Run to see RED.** `node --test "T/cuts-origin.test.mjs"`. Expected: FAIL: `at` is an unknown option, `pointThroughCamera` is not exported.
- [ ] **Step 3: Implement.** If the free kind does have targets, or the clipping's region target is spelt otherwise, change the fixture, not the rule; say which in the report.
- [ ] **Step 4: Run to see GREEN, no browser:** the same command, `node --test "T/cuts-layers.test.mjs"`, `node --test "T/cuts-resolve.test.mjs"`, `node --test "T/cuts-looks.test.mjs"`, `node --test "T/looks.test.mjs"`, `node --test "T/spec.test.mjs"`, `node --test "T/kinds-cut-landing.test.mjs"`. A test that compared a whole pose object gains `origin: null`; list each in the commit.
- [ ] **Step 5: Commit (controller).** `feat(w2): an iris or a zoom can open from a named part of the shot it leaves`.

### Task 10: The colour flood

**Files:**
- Modify: `MM/engine/cuts/layers.mjs:59-96` (a seventh recipe and entry), `MM/engine/page/cut-pictures.mjs:71-79` (`compose`), every look file's `sounds.cut` and `cuts` (`MM/engine/looks/desk.mjs:60`, `pop.mjs:68`, `poster.mjs:114`, `marker.mjs:75`, `cosmos.mjs:105`, and the same lines of `keynote.mjs` and `ledger.mjs`), `pop.mjs:70` and `poster.mjs:116` (`cutPalette`)
- Modify: `T/cuts-origin.test.mjs`, `T/cuts-live-browser.test.mjs`; `MM/references/examples/v2/cuts-desk.json` and `cuts-pop.json` if a test requires every registered cut in them
- Read: `MM/engine/looks/index.mjs:361-366` (`validateLook` refuses a look with no `sounds.cut` entry for a registered cut, so the registration and the seven look edits are one commit)

**Interfaces:**
- A layer cut `flood`: `{ family: 'layer', dur: 0.5, directions: null, origin: true, smearable: false, incomingOnly: false, example: 'flood' }`. Its recipe has one more field, `flood: { color, circle: [cx, cy, r] } | null` (null in every other recipe): the look's `palette.accent` grows as a circle from `at` (else the centre) to cover the frame over the first half of the window, the outgoing picture under it; over the second half the incoming picture opens as a circle from the same point over the colour. At p 0 the frame is the outgoing picture exactly, at p 0.5 the flat colour, at p 1 the incoming picture exactly.
- `compose` paints `recipe.flood` between the picture under and the picture over.
- Each look: `sounds.cut.flood` is the cue it gives `iris` (or null where that is null); `cuts` gains `flood` in every look that lists `iris`; `cutPalette` gains it in `pop` and `poster` only.

- [ ] **Step 1: Write the failing tests.** In `T/cuts-origin.test.mjs`:

```js
const flood = (p, extra = {}) => registries.cuts.get('flood').layers({ p, direction: null, canvas: CANVAS, look: registries.looks.get('desk'), ...extra });
const CORNER = Math.hypot(960, 540);

test('flood: the outgoing picture at p 0, the flat accent at p 0.5, the incoming picture at p 1', () => {
  assert.equal(flood(0).flood.circle[2], 0);
  assert.equal(flood(0).to.opacity === 0 || flood(0).to.clip.circle[2] === 0, true);
  const mid = flood(0.5);
  assert.equal(mid.flood.color, registries.looks.get('desk').palette.accent);
  assert.ok(mid.flood.circle[2] >= CORNER && mid.to.clip.circle[2] === 0);
  assert.ok(flood(1).to.clip.circle[2] >= CORNER && flood(1).to.opacity === 1);
});
test('flood opens from at, takes no direction, lasts 0.5 s, and every other layer recipe has no flood', () => {
  assert.deepEqual(flood(0.25, { at: [300, 200] }).flood.circle.slice(0, 2), [300, 200]);
  const entry = registries.cuts.get('flood');
  assert.deepEqual([entry.family, entry.dur, entry.directions, entry.origin, entry.smearable], ['layer', 0.5, null, true, false]);
  for (const name of ['crossfade', 'fade', 'wipe', 'iris', 'zoom', 'blur']) assert.equal(registries.cuts.get(name).layers({ p: 0.5, direction: registries.cuts.get(name).directions?.[0] ?? null, canvas: CANVAS }).flood, null, name);
});
test('every look names a cue for the flood, lists it where it lists the iris, and pop and poster reach for it', () => {
  for (const name of allLookNames()) {
    const look = registries.looks.get(name);
    assert.ok(look.sounds.cut.flood === null || typeof look.sounds.cut.flood === 'string', name);
    assert.equal(look.cuts.includes('flood'), look.cuts.includes('iris'), name);
  }
  assert.deepEqual(allLookNames().filter((n) => registries.looks.get(n).cutPalette.includes('flood')).sort(), ['pop', 'poster']);
});
```

In `T/cuts-live-browser.test.mjs` **[BROWSER]**: two `free` still shots (red, then blue), the second with `"cut": "flood"`, in `desk`: at the window's middle frame, five sampled pixels (the centre and four near the corners) are the look's accent within 2 levels; the window's first frame hashes as the outgoing still and the frame after the window as the incoming one.

- [ ] **Step 2: Run to see RED.** `node --test "T/cuts-origin.test.mjs"`. Expected: FAIL, no cut named `flood`.
- [ ] **Step 3: Implement,** the registration and the seven looks together.
- [ ] **Step 4: Run to see GREEN, no browser:** the same command, `node --test "T/cuts-layers.test.mjs"`, `node --test "T/looks.test.mjs"`, `node --test "T/cuts-looks.test.mjs"`, `node --test "T/cuts-films.test.mjs"`, `node --test "T/sound-cues.test.mjs"`, `node --test --test-name-pattern="every registered look, mode, device, cut and field has a summary" "T/make.test.mjs"`, `node --test "BT/make-motion-docs.test.mjs"`. If `cuts-films` or `cuts-looks` asserts that the two cut films use every registered cut, add one flood shot to `cuts-desk.json` and `cuts-pop.json` and say so.
- [ ] **Step 5: Browser. [BROWSER]** `node --test --test-concurrency=1 "T/cuts-live-browser.test.mjs"`, then `"T/cuts-browser.test.mjs"`.
- [ ] **Step 6: Commit (controller).** `feat(w2): a colour flood cut, from the centre or from a named part of the shot it leaves`.

### Task 11: The words for it: story, schema, tells, notices

**Files:**
- Modify: `MM/references/story.md` (a new section after `Narration`, one tell), `MM/references/schema.md:104-106` (Cuts), `MM/SKILL.md:96` (the `cut` bullet, one sentence), `MM/THIRD_PARTY_NOTICES.md` (the credits section W1 added), `BT/make-motion-docs.test.mjs` (W1's list of `story.md` headings)

**Interfaces:**
- `story.md` gains `## Sound across a cut`: use `lead` when the next picture answers what the narration has begun to ask; use `trail` when the picture has made its point before the sentence ends; a lead or a trail on every cut is a tell; none across a change of subject; the bounds (0 to 1.5 s); that a `trail` must be longer than the mode's tail (0.6 s in `pro`, 0.3 s in `viral`) for a word to cross the cut; and that `word:` anchors on words heard before the picture fire at the shot's start. `Tells every look shares` gains "every cut the same length of overlap".
- `schema.md` Cuts: the cut object's `at`, the `flood` cut, and which cuts show the outgoing shot moving (Task 8's sentence).
- `SKILL.md`, at most 200 bytes more: "A shot's `narration` can start before its cut or run past it; a cut's `at` opens it from a part of the shot it leaves (`references/story.md`, `references/schema.md`)."
- Notices, appended to the HyperFrames bullet: a transition between two shots that both move, sound placed apart from the picture, an iris from the thing clicked, a colour flood, a hero that fills the frame (W2).

- [ ] **Step 1: Write the failing test** in `BT/make-motion-docs.test.mjs`: the `story.md` headings list gains `'Sound across a cut'` after `'Narration'`; and

```js
test('the docs say how sound crosses a cut, where a cut opens from, and which cuts keep the outgoing shot moving', () => {
  const across = section(read('references/story.md'), 'Sound across a cut');
  for (const word of ['`lead`', '`trail`', `${NARRATION_SHIFT_MAX} s`]) assert.ok(across.includes(word), word);
  const cuts = section(read('references/schema.md'), 'Cuts');
  for (const word of ['`at`', '`flood`', 'still moving']) assert.ok(cuts.includes(word), word);
  assert.ok(read('SKILL.md').includes('`narration`'));
  assert.ok(registries.cuts.has('flood'));
});
```

(`NARRATION_SHIFT_MAX` imported from `MM/engine/script/timing.mjs`.)

- [ ] **Step 2: RED.** `node --test "BT/make-motion-docs.test.mjs"`.
- [ ] **Step 3: Write the prose.** `wc -c MM/SKILL.md`: at most 19,900.
- [ ] **Step 4: GREEN:** the three doc tests, `node --test "T/cuts-notices.test.mjs"`.
- [ ] **Step 5: Commit (controller).** `docs(w2): sound across a cut, a cut's origin, the flood, and who is credited`.

### Task 12: Look at it, in one serial browser run

**Files:**
- Create: `S2/films/overlap-desk.json`, `S2/films/overlap-captions.json` (scratch films; not shipped)

`overlap-desk.json`, look `desk`, six shots: a statement; a `number` arriving by `crossfade` with `narration.lead` 0.4; a `clipping` (copy `X/clipping.png` beside the film) arriving by `ripple`; a statement arriving by `{ "type": "iris", "at": "<a region of the clipping>" }`; a short statement ("Ship it today.") arriving by `flood` with `narration.trail` 1 on the shot before it (longer than the 0.6 s tail, so its last word crosses the cut); an `end`. `overlap-captions.json` is the same film with `"captions": true`.

- [ ] **Step 1: Build the sheets. [BROWSER]** `node MM/scripts/make.mjs S2/films/overlap-desk.json --sheets-only --out S2/out/overlap-desk.mp4`, then the captioned film. Expected: exit 0; findings are read, not asserted.
- [ ] **Step 2: Open every cut strip and the short statement's sheet.** Write `S2/results/viewed.md`, one line per item, each "seen" with what was seen, or "not seen": the outgoing shot moves through the crossfade and the ripple (compare the first and last tiles of the strip where only the outgoing shot shows); the iris opens from the region named, and the words at its edge stay readable; the flood covers the frame in the accent at its middle tile; the short statement is larger than a ten-word one in the same film; in the captioned film, the caption over the first statement's last frames carries the number shot's first words.
- [ ] **Step 3: The word-onset gate.** `node --test "T/voice-accuracy.test.mjs"`. Expected: PASS or skipped for a missing voice package, as before the wave; a failure is a bug in Task 6.
- [ ] **Step 4: For the branch test checklist (manual, the owner's):** listen to one voiced film with a lead and a trail: does the voice run across the cut without a click or an overlap. Nobody in this plan can listen.

### Task 13: The wave gate

- [ ] **Step 1: The local gate.** `node P/bin/sync-shared.mjs --check`; `node --test "P/shared/test/*.test.mjs"`; `node --test "BT/*.test.mjs"`; `python3 -m pytest R/tests/pytest`; make-motion's suite serially **[BROWSER]**, in the background: `node --test --test-concurrency=1 "MM/test/**/*.test.mjs"`. Expected: all green.
- [ ] **Step 2: Fresh-context review (reviewer tier, Opus at medium, report only; `high` if the diff is over 1,500 lines).** The prompt gives `git diff --stat` for the wave's commits, the diff path, this plan's Review Focus and Decisions table, and this sentence verbatim: "Report every issue you find, including ones you are uncertain about or consider low-severity. Do not filter for importance or confidence at this stage — a separate verification step will do that. Your goal here is coverage: it is better to surface a finding that later gets filtered out than to silently drop a real bug. For each finding, include your confidence level and an estimated severity so a downstream filter can rank them."
- [ ] **Step 3: Gate.** No CRITICAL or HIGH open; each code fix ships with a test that failed first. The controller pushes. The report lists every golden or pinned assertion that changed, with the task that changed it, and every item of `viewed.md` marked "not seen".

## Self-review notes

- Spec coverage, section 6 "W2": the two findings from snapshot boxes beside the hero rule, with per-look `fill`, calibrated in one browser batch before they are wired, capped per film (Tasks 1 to 3); the cosmos number recentred (Task 4); short statements given more width and height (Task 5); J and L narration as an opt-in per-shot field in seconds, bounded, default 0, on `NARRATION_LEAD` and `soundStart`/`soundEnd`, with caption timing and the cut-window rule following (Tasks 6 and 7); a live outgoing shot for the families that can carry it, node cuts and the smear frozen and said so (Task 8); `at` on iris and zoom with a missing origin an error by name (Task 9); a colour flood (Task 10). "No look or mode sets it automatically" holds: `narration` is read from the shot only.
- Review Focus to tests: 1 is Task 6's `PlacementError` and "loadFilm never throws" tests; 2 is Task 6's deep-equal test, Task 8's `sampleShot(0, D - 0.5)` equality and Task 9's key-list assertion; 3 is Task 8's seek-order browser test; 4 is Task 1's "what is not judged" and `restsShot` tests; 5 is Task 9's unknown-target and missing-box tests; 6 is Task 7's captioned-film test; 7 is Task 6's refusal tests.
- Not verified by the planner: that the `free` kind has no targets and that the clipping's region target is spelt `region:<name>` in `kind.targets` (Task 9 Step 3 says what to do if not); the estimated durations the fixtures rely on (each fixture asserts its own precondition); whether `cuts-films` requires every cut in the two cut films (Task 10 Step 4).
