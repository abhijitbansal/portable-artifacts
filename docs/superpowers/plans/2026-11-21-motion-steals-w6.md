# Motion Steals W6: Type and Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A title can arrive letter by letter or line by line without the word's spacing changing, an ease can be a `cubic-bezier()` or a `steps()`, the look of a film can be picked from one sheet that shows its anchor shot in every look that can draw it, a reference video the user supplies can be turned into numbers, and `--list moves` says how much each move bounces and how long it is visibly moving.

**Architecture:** Five units. (1) Two parsers join `spring()` in `engine/time/ease.mjs`. (2) A text node gains optional per-glyph and per-line tracks beside its per-word ones. A word's own sampled values stay what they are, so the draw layer and every other reader of `words` see no change; sampling adds a per-word roll-up, `seen`, that says how far the word has arrived with its letters and its line counted, and the review reads the word through it. The draw layer places each glyph at the advance of the word's prefix, so kerning is the whole word's, and draws the word whole when every glyph is at rest. One browser test, written first, holds the two paths pixel-equal. Two registered moves, `letters` and `lines`, carry the look data; a look opts its statement in. (3) `--compare-looks` opens one session per look, serially, and tiles the frames in Node with W3's PNG writer. (4) `scripts/measure.mjs` reads one local file through ffmpeg's `scdet` and `ebur128` behind the clip probe's whitelists and labels every value measured or guessed. (5) `motionFacts` samples a move's curve.

**Tech Stack:** Node 20+, `node:test`, Playwright Chromium and ffmpeg where named. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-11-21-motion-steals-design.md` section 6, W6. Evidence: `.scratch/research-2026-11-21/PROPOSAL.md` items 15, 16, 19 (P15, P16, P19).

Abbreviations: `P` = `plugins/portable-artifacts`, `MM` = `P/skills/make-motion`. Paths with no prefix are relative to `MM/`. In commands, `<MM>` and `<P>` stand for the literal absolute paths. Anchors were read on branch `feat/motion-steals` on 2026-11-21, before W0 to W5 landed; nothing was run. Where an earlier wave edits the same file (`scripts/v2/cli.mjs`, `scripts/v2/run.mjs`, `scripts/v2/report.mjs`, `engine/page/stage.mjs`, `engine/kinds/statement.mjs` (W2 Task 5), the look files, the doc test), find the anchor by the function named beside it.

## Global Constraints

- `MM/SKILL.md` is 20,898 bytes against a 20,900-byte budget pinned in `plugins/portable-artifacts/bin/test/skill-budget.test.mjs`; slim, never raise the cap. This wave adds 0 bytes to `SKILL.md` and creates no reference file (after W1 the doc test requires `SKILL.md` to name each one): its notes go in W3's `references/tools.md` and in `references/schema.md`.
- No new runtime dependency, no network use, no generative-video call from `make.mjs`. `scripts/measure.mjs` reads only a file the user names on this machine, never a URL, and prints numbers only.
- No new server route (the preview server is GET and HEAD only).
- One headless browser at a time (`pgrep -fl chrome-headless-shell` first; `--test-concurrency=1`). Steps marked **[browser]** are run one at a time. `--compare-looks` opens its sessions one after another in the run's one browser.
- Goldens change only for an intended visual change, stated in the commit. Intended here: the statement entrance of the looks that adopt `letters` or `lines` (Task 4). A look whose entry is `null` draws the frames it draws today.
- HyperFrames (Apache-2.0) and Rune (MIT) ideas are rewritten in our own code with a credit line in `THIRD_PARTY_NOTICES.md`; no file is ported. No code from beast_explainer.
- Every code fix and guardrail is shown failing first (RED), then passing.
- Commits: conventional, prefixed `feat(w6):` / `fix(w6):` / `test(w6):` / `docs(w6):`, staging named files only, ending with exactly one trailer line `Co-Authored-By: Claude <noreply@anthropic.com>` and no `Claude-Session` line (the `commit-trailers` CI job fails otherwise). Implementers do not commit; the controller runs each Commit step.
- All waves ship on one branch and one PR; one `plugin.json` bump, one `CHANGELOG.md` heading and the cover Revision happen once in the final phase, not per wave.
- A fresh-context review (reviewer tier) runs at the end of each wave before its commits are pushed. Implementers are executor tier (Sonnet, effort high); reviewers Opus at medium.
- Shell: one plain command per call, literal absolute paths, no `cd`, `&&`, pipes, `;`, variables, loops or heredocs; quote globs; never `rm`.
- `engine/**` stays pure and DOM-free outside `engine/page/` (`test/v2/purity.test.mjs`). Everything that differs between looks is look data; a look gives a value or `null` for every registered move (`engine/looks/index.mjs:192-200`).
- Every ease starts at 0 and ends at 1 (`test/v2/time.test.mjs:32`); the two new forms keep that.

## Review Focus

1. **A ligature or a contextual form.** Drawn glyph by glyph, "fi" or "fl" loses its ligature and the word changes width on the frame the entrance ends. The pixel test's words hold `fi`, `fl`, `ff`, a kerned pair and an accent, in each adopting look's face; a look whose face fails keeps `null`. Tested in Task 2.
2. **A word the review reads as landed while its letters are still arriving, or a word that will not draw until its last letter starts.** `engine/review/frame.mjs:207,217` reads each word's `opacity` and `scale`, and `drawWord` skips a word whose opacity is 0 and multiplies every glyph by it (`engine/page/draw.mjs:74-79`). So the roll-up is a separate value the review reads, never the word's own values. Tested in Task 3 (the review) and Task 4 (the pixels mid-entrance).
3. **The first shot of a short.** A `viral` film must show all its text on frame 0 (`scripts/v2/review.mjs:358-372`). A letter or line entrance never applies on the hook path, a matched hero or a look that opens composed (`engine/kinds/statement.mjs:265-272`). Tested in Task 4.
4. **A local file that is a playlist.** An `.m3u8` or a concat script on disk can name a URL; "never a URL" must hold for what ffmpeg opens, not only for the argument. The clip probe's protocol, demuxer and decoder whitelists refuse it (`scripts/v2/clips.mjs:45`). Tested in Task 6.
5. **A film that is valid in one look and not in another.** A device a look does not draw, a kind it excludes or parks. Each is a labelled cell, never a blank one or a crash. Tested in Task 5.
6. **A `cubic-bezier` whose curve leaves 0 to 1, and a move of length 0.** Overshoot is allowed in y and counted as bounce; x outside 0 to 1 is refused; a `dur` of 0 has no visible length and no bounce. Tested in Tasks 1 and 7.

## File Structure

- Create `scripts/v2/compare.mjs`, `scripts/measure.mjs`, `scripts/lib/measure.mjs`. (`motionFacts` goes in the existing `engine/moves/index.mjs`; the two tools' notes go in W3's `references/tools.md` as the sections `Comparing looks` and `Measuring a reference video`, so no new reference file needs a line in `SKILL.md`.)
- Modify `engine/time/ease.mjs`, `engine/looks/index.mjs:266`, `engine/graph/node.mjs:8-14,55-94`, `engine/graph/sample.mjs:37-58`, `engine/page/draw.mjs:73-99`, `engine/page/stage.mjs:150-174`, `engine/moves/index.mjs:7-15`, the seven look files and the test looks, `engine/kinds/statement.mjs:252-277`, `engine/kinds/shared.mjs:269-278`, `scripts/v2/list.mjs:46-47,87-95`, `scripts/v2/cli.mjs`, `scripts/v2/run.mjs`, `scripts/v2/pipeline.mjs:53-65`, `scripts/v2/report.mjs`, `references/schema.md`, `references/tools.md`, `THIRD_PARTY_NOTICES.md`, `P/bin/test/make-motion-docs.test.mjs` (the report's `full` object at `:210`, `knownFlags` at `:280`; line numbers as read before W1).
- Tests: `test/v2/time.test.mjs`, `glyphs-browser.test.mjs`, `graph.test.mjs`, `text-glyphs.test.mjs`, `moves.test.mjs`, `kinds-statement.test.mjs`, `compare.test.mjs`, `compare-browser.test.mjs`, `measure.test.mjs`.

---

### Task 1: `cubic-bezier()` and `steps()`

**Files:**
- Modify: `engine/time/ease.mjs:1-2,87-90`, `engine/looks/index.mjs:266` (the message that lists the ease names), `references/schema.md` (where eases are named)
- Test: `test/v2/time.test.mjs`

**Interfaces:**
- Produces, through the one entry `ease(name): (p) => number`:
  - `cubic-bezier(<x1>,<y1>,<x2>,<y2>)`: the CSS curve through (0,0), (x1,y1), (x2,y2), (1,1). `x1` and `x2` must be from 0 to 1; `y1` and `y2` any finite number (an overshoot is allowed). Solved for x to within 1e-7 (Newton steps, bisection when the slope is flat). `p <= 0` is 0 and `p >= 1` is 1.
  - `steps(<n>)` and `steps(<n>,end)`: `floor(p * n) / n`; `steps(<n>,start)`: `ceil(p * n) / n`; `n` a whole number from 1 to 120. Both give 0 at `p <= 0` and 1 at `p >= 1`.
  - Errors, in the form `spring` uses (`ease.mjs:83`): `bad ease "<name>"; expected cubic-bezier(<x1>,<y1>,<x2>,<y2>) with x1 and x2 from 0 to 1`, `bad ease "<name>"; expected steps(<n>) or steps(<n>,start|end) with n from 1 to 120`.
  - The header comment of `ease.mjs:2` and the `punchEase` message at `looks/index.mjs:266` name the two new forms.

- [ ] **Step 1: Write the failing test**

```js
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
test('cubic-bezier(0,0,1,1) is linear', () => { for (const p of [0.1, 0.3, 0.77]) near(ease('cubic-bezier(0,0,1,1)')(p), p); });
test('cubic-bezier matches the CSS ease and ease-in-out at the midpoint', () => {
  near(ease('cubic-bezier(0.25,0.1,0.25,1)')(0.5), 0.8024, 1e-3);
  near(ease('cubic-bezier(0.42,0,0.58,1)')(0.5), 0.5);
});
test('a cubic-bezier may overshoot and still ends on 1', () => {
  const f = ease('cubic-bezier(0.34, 1.56, 0.64, 1)');
  assert.ok(Math.max(...Array.from({ length: 101 }, (_, i) => f(i / 100))) > 1);
  assert.equal(f(0), 0); assert.equal(f(1), 1);
});
test('steps(4) holds each quarter and lands on 1', () => {
  const f = ease('steps(4)');
  assert.deepEqual([0, 0.24, 0.25, 0.5, 0.99, 1].map(f), [0, 0, 0.25, 0.5, 0.75, 1]);
});
test('steps(4,start) jumps at the start of each quarter and still starts at 0', () => {
  const f = ease('steps(4, start)');
  assert.deepEqual([0, 0.01, 0.25, 0.26, 1].map(f), [0, 0.25, 0.25, 0.5, 1]);
});
test('a bad cubic-bezier or steps says the form', () => {
  assert.throws(() => ease('cubic-bezier(1.2,0,0,1)'), /expected cubic-bezier\(<x1>,<y1>,<x2>,<y2>\) with x1 and x2 from 0 to 1/);
  assert.throws(() => ease('cubic-bezier(0,0,1)'), /expected cubic-bezier/);
  assert.throws(() => ease('steps(0)'), /expected steps\(<n>\) or steps\(<n>,start\|end\) with n from 1 to 120/);
  assert.throws(() => ease('steps(4,middle)'), /expected steps/);
});
test('a look may name either as its punch ease', () => { /* validateLook with cutMotion.punchEase 'cubic-bezier(0.2,0,0,1)' passes; 'cubic-bezier(2,0,0,1)' fails naming cutMotion.punchEase */ });
```

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/time.test.mjs"`; expected FAIL: `unknown ease "cubic-bezier(0,0,1,1)"`.
- [ ] **Step 3: Implement** the forms above.
- [ ] **Step 4: Run and see it pass** — `node --test "<MM>/test/v2/time.test.mjs" "<MM>/test/v2/looks.test.mjs" "<MM>/test/v2/purity.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w6): cubic-bezier() and steps() eases`.

### Task 2: Glyph by glyph on the page, pixel-equal to the word drawn whole

This task comes before the data model on purpose: if a word drawn per glyph at rest is not the word drawn whole, the rest of the design does not stand.

**Files:**
- Modify: `engine/page/draw.mjs:73-99` (`drawWord`, `drawText`), `engine/page/stage.mjs:150-174` (`installApi`: a test seam)
- Test: `test/v2/glyphs-browser.test.mjs`

**Interfaces:**
- Produces:
  - `drawGlyphs(ctx, word, glyphs, left)` in `draw.mjs`: for glyph `k` of `Array.from(word.text)`, its origin is `left` plus the measured advance of the `k` glyphs before it, taken with the font and letter spacing already on the context (`engine/page/text-style.mjs:22-25`), so the gap between two letters is the gap the whole word has. Each glyph takes its own `{ opacity, x, y, scale }` (scaled about its own centre on the baseline).
  - `drawWord` draws the word whole (`ctx.fillText(word.text, left, 0)`, `draw.mjs:84`) when the word has no glyph values or every one is the identity; otherwise through `drawGlyphs`.
  - `window.__setGlyphPath(force: boolean)`: tests only. With `true`, every word of every text is drawn through `drawGlyphs` with identity values.
  - `LETTER_LOOKS` in the test: the looks whose statement will take `letters` in Task 4. Starting value `['poster']`.

- [ ] **Step 1: Write the failing test** **[browser]**

```js
const WORDS = "Typography office AVATAR fjord waffle L'été 10,000"; // fi, ff, fl, kerned pairs, an accent, figures
// one statement film per listed look (registries.looks.names()), text WORDS, held long enough to settle; a page draws one look,
// so each look gets its own session, opened and closed one after another (never two at once)
for (const look of registries.looks.names()) {
  test(`${look}: a settled statement drawn glyph by glyph is pixel-equal to it drawn whole`, async (t) => {
    const whole = await sourceHash(page, LAST_FRAME);
    await page.evaluate(() => window.__setGlyphPath(true));
    const perGlyph = await sourceHash(page, LAST_FRAME);
    await page.evaluate(() => window.__setGlyphPath(false));
    results.set(look, whole === perGlyph);
    if (LETTER_LOOKS.includes(look)) assert.equal(perGlyph, whole);
  });
}
test('the table of every look is printed, and a look outside LETTER_LOOKS is only reported', () => { /* t.diagnostic one line per look: equal or not */ });
test('with the seam off nothing changes: the frame equals the frame recorded before this task', async (t) => { /* a sha256 taken at the base commit, in the test */ });
```

`sourceHash` is the helper of `test/v2/viewer-browser.test.mjs:44-48` (the picture before the post pass).

- [ ] **Step 2: Run and see it fail** — after `pgrep -fl chrome-headless-shell` prints nothing: `node --test --test-concurrency=1 "<MM>/test/v2/glyphs-browser.test.mjs"`; expected FAIL: `window.__setGlyphPath is not a function`.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and read the table.** The same command. If `poster` is not equal: pick another look that is, put it in `LETTER_LOOKS`, and say so in the task report with the table. If no look is equal, stop and report the table: the prefix-advance approach is wrong for these faces and the wave's type work does not proceed.
- [ ] **Step 5: Commit** `feat(w6): a word can be drawn glyph by glyph with the whole word's spacing`.

### Task 3: Glyph and line tracks in the scene graph

**Files:**
- Modify: `engine/graph/node.mjs:8-14,55-94`, `engine/graph/sample.mjs:37-58`, `engine/page/draw.mjs:88-99` (`drawText`: the line transform), and the review's readers of a word's state: `engine/review/frame.mjs:183,187,207,217,222,306-309,377`, `engine/review/contrast.mjs:182`, `scripts/v2/review.mjs:163,366`
- Test: `test/v2/graph.test.mjs`, `test/v2/text-glyphs.test.mjs`

**Interfaces:**
- Consumes: `drawGlyphs` (Task 2).
- Produces:
  - `GLYPH_TRACK_NAMES = LINE_TRACK_NAMES = ['opacity', 'x', 'y', 'scale']`, exported from `node.mjs`.
  - `node('text', id, props, { ..., glyphTracks?, lineTracks? })`. `glyphTracks[wordIndex]` is an array, one track map per glyph of that word (a hole for a word with none); `lineTracks[lineIndex]` one track map per line. Both only on a text node; an unknown track name is the error `wordTracks` gives (`node.mjs:38-46`).
  - Sampling: `sampled.glyphs` (per word index, an array of `{ opacity, x, y, scale }`, or `undefined`) and `sampled.lines` (per line index). `sampled.words` is unchanged: each entry is the word's own values, which is what `drawWord` multiplies by. All three new fields are absent on a node that has no glyph or line track, so its state key is the one it has today.
  - The roll-up, `sampled.seen` (per word index, `{ opacity, scale }`; only on a node with glyph or line tracks; a layout's line of each word comes from `props.layout`): `opacity` is the word's own times the smallest opacity among its glyphs times its line's; `scale` is the word's own times its line's times the glyph scale furthest from 1. A word is at rest only when its letters and its line are.
  - `wordSeen(n, index): { opacity, scale, ...the word's other values }` exported from `engine/review/frame.mjs`: `n.seen[index]` laid over `n.words[index]` when the node has a roll-up, else the word as it is. Every review reader listed under Files reads a word through it; nothing outside the review does.
  - `drawText` applies a line's `{ opacity, x, y, scale }` around the drawing of that line's words (scaled about the line's centre on its baseline).

- [ ] **Step 1: Write the failing test**

```js
test('glyph tracks sample per glyph; the word keeps its own values and the roll-up carries the least-arrived letter', () => {
  const n = node('text', 't', TEXT_PROPS, { wordTracks: [{}], glyphTracks: [[{ opacity: track([{ t: 0, v: 0 }, { t: 1, v: 1 }]) }, { opacity: track([{ t: 1, v: 0 }, { t: 2, v: 1 }]) }]] });
  const [s] = sampleGraph([n], 1);
  assert.deepEqual(s.glyphs[0].map((g) => g.opacity), [1, 0]);
  assert.equal(s.words[0].opacity, 1);   // the word's own: the first letter must draw at full strength
  assert.equal(s.seen[0].opacity, 0);    // as the review sees it: not all here yet
  assert.equal(sampleGraph([n], 2)[0].seen[0].opacity, 1);
});
test('a line track multiplies into the roll-up of every word of that line, not into the words', () => { /* lineTracks[0].opacity 0.5 and scale 0.8: seen is { opacity: 0.5, scale: 0.8 }, words[0] is { opacity: 1, scale: 1 } */ });
test('wordSeen is the roll-up where there is one and the word where there is none', () => { /* two nodes */ });
test('a text with neither keeps the state key it has today', () => assert.equal(stateKey(sampleGraph([PLAIN], 0)), KEY_BEFORE)); // KEY_BEFORE recorded in the test before the change
test('glyph tracks on a path, or an unknown glyph track, are errors naming what is accepted', () => {
  assert.throws(() => node('path', 'p', { d: 'M0 0' }, { glyphTracks: [[{}]] }), /glyphTracks only apply to a text node/);
  assert.throws(() => node('text', 't', TEXT_PROPS, { glyphTracks: [[{ fill: track([{ t: 0, v: 1 }]) }]] }), /unknown track 'fill'; accepted: opacity, x, y, scale/);
});
// text-glyphs.test.mjs: the review reads the roll-up
test('a text whose letters are still arriving has not landed; once they are in it has', () => {
  assert.equal(textLandings(annotated(sampleGraph([n], 1)), CTX)[0].landed, false);
  assert.equal(textLandings(annotated(sampleGraph([n], 2)), CTX)[0].landed, true);
});
```

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/graph.test.mjs" "<MM>/test/v2/text-glyphs.test.mjs"`; expected FAIL: `node()` ignores `glyphTracks`, `s.glyphs` and `s.seen` are undefined.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see it pass** — the same command, plus `"<MM>/test/v2/purity.test.mjs" "<MM>/test/v2/review.test.mjs" "<MM>/test/v2/cuts-resolve.test.mjs"` (the cut baseline keys must not move); then **[browser]** `node --test --test-concurrency=1 "<MM>/test/v2/glyphs-browser.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w6): glyph and line tracks on text nodes, rolled up into each word`.

### Task 4: The moves `letters` and `lines`, and the looks that use them

**Files:**
- Modify: `engine/moves/index.mjs:7-15`, the seven files `engine/looks/{desk,pop,cosmos,ledger,poster,keynote,marker}.mjs`, the test looks (`test/v2/helpers/hand-look.mjs`, `test/v2/helpers/look-contract.mjs`), `engine/kinds/shared.mjs:269-278`, `engine/kinds/statement.mjs:252-277`, `references/schema.md`
- Test: `test/v2/moves.test.mjs:17,61` (seven becomes nine), `test/v2/kinds-statement.test.mjs`, `test/v2/look-contract.test.mjs`

**Interfaces:**
- Consumes: glyph and line tracks (Task 3); `LETTER_LOOKS` as Task 2 left it.
- Produces:
  - Two registered moves: `letters` ("An entrance that brings a word in one letter after another, the word's spacing kept.") and `lines` ("An entrance that brings each line in as one block."). Look data: `letters: { ease, dur, dist?, stagger }` (`stagger`: seconds between letters), `lines: { ease, dur, dist? }`, or `null`.
  - `letterTracks(look, unit, at, count): trackMap[]` and `lineEntrance(look, unit, at): trackMap` in `kinds/shared.mjs`, beside `enterTracks` (`shared.mjs:272-278`): letter `k` lands at `at + k * stagger`.
  - `look.kinds.statement.entrance: 'letters' | 'lines'` (absent: the per-word entrance of today). `validateLook` refuses an `entrance` whose move the look gives `null` for.
  - In `wordTracksFor` (`statement.mjs:252-277`), only on the plain path (`statement.mjs:272`, not the hook, not a matched hero, not a look that opens composed): with `letters`, a word's own entrance tracks are left out and its glyphs take `letterTracks` from the word's time `at`; with `lines`, each line takes `lineEntrance` at the time of its first word, and its words' own entrance tracks are left out. Emphasis tracks are untouched.
  - Starting look data: `poster` (or the look Task 2 chose) takes `letters` with a `steps()` ease; `keynote` takes `lines` with a `cubic-bezier()` ease; every other look gives `null` for both. The implementer may change a value after viewing Step 5's sheets, and says so.

- [ ] **Step 1: Write the failing test**

```js
test('the nine moves are registered, each with a summary', () => assert.deepEqual(MOVE_NAMES, ['rise', 'wipe', 'slam', 'pop', 'draw', 'count', 'settle', 'letters', 'lines']));
test('every look, shipped, experimental and test, gives letters and lines a value or null', () => { /* Object.hasOwn(look.moves, 'letters') and 'lines' for each */ });
test('an entrance the look gives null for is refused', () => {
  assert.throws(() => validateLook({ ...registries.looks.get('desk'), kinds: { ...registries.looks.get('desk').kinds, statement: { entrance: 'letters' } } }), /look "desk": kinds\.statement\.entrance "letters" needs moves\.letters/);
});
test('letters: each glyph lands one stagger after the one before, and the word has no entrance of its own', () => {
  const hero = heroOf(expandStatement({ look: LETTER_LOOK, text: 'Ship it' }));
  const [g0, g1] = hero.glyphTracks[0];
  assert.equal(landsAt(g1.opacity) - landsAt(g0.opacity), registries.looks.get(LETTER_LOOK).moves.letters.stagger);
  assert.equal(hero.wordTracks[0].opacity, undefined);
});
test('lines: both words of a line share one entrance, at the first word\'s time', () => { /* keynote: hero.lineTracks.length === layout.lines.length; no word opacity track */ });
test('the first shot of a viral film in a letters look keeps every word on frame 0', () => {
  const hero = heroOf(expandStatement({ look: LETTER_LOOK, mode: 'viral', first: true, text: 'Ship it' }));
  assert.equal(hero.glyphTracks.length, 0);
});
test('a look with neither builds the statement it builds today', () => { /* desk: the hero node deepEquals the node recorded before the change */ });
```

`LETTER_LOOK` is the first name in Task 2's `LETTER_LOOKS`. `expandStatement`, `heroOf` and `landsAt` (the time of a track's last key) are small helpers over the way `test/v2/kinds-statement.test.mjs` already expands a statement with a fake measure.

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/moves.test.mjs" "<MM>/test/v2/kinds-statement.test.mjs"`; expected FAIL: `MOVE_NAMES` has seven names.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see it pass** — `node --test "<MM>/test/v2/moves.test.mjs" "<MM>/test/v2/kinds-statement.test.mjs" "<MM>/test/v2/look-contract.test.mjs" "<MM>/test/v2/looks.test.mjs" "<MM>/test/v2/poster-look.test.mjs" "<MM>/test/v2/keynote-look.test.mjs"`, then `node --test "<P>/bin/test/make-motion-docs.test.mjs"`; expected PASS. A test of the two adopting looks that pins the old word entrance is updated in this commit, and the commit says the picture changed on purpose.
- [ ] **Step 4b: The pixels mid-entrance [browser].** Add to `test/v2/glyphs-browser.test.mjs`, on a one-word statement in `LETTER_LOOK` at the frame halfway through the word's letters: the box of the first letter (from `__snapshot`'s layout and the prefix advance) holds ink of the text's fill, the box of the last letter holds only the ground, and on the frame after the last letter lands the picture equals the settled frame. RED first: with the first letter's own track removed from the fixture the first assertion fails. This is the test the identity-forced one cannot be: it proves a word draws while its roll-up says it has not arrived. Run: `node --test --test-concurrency=1 "<MM>/test/v2/glyphs-browser.test.mjs"`; expected PASS.
- [ ] **Step 5: Sheets, viewed [browser], one film at a time.** `node <MM>/scripts/make.mjs <MM>/references/examples/v2/look-poster.json --sheets-only --json --out <scratch>/w6/poster.mp4`, then the same for `gate-keynote.json`. Open each statement shot's sheet and write one sentence on how the title arrives and whether any letter shifts on the frame it lands. No mechanical finding may be new against the same command at the wave's base commit.
- [ ] **Step 6: Commit** `feat(w6): letters and lines entrances, used by poster and keynote`, the body naming the two looks whose statement entrance changes.

### Task 5: `--compare-looks`

**Files:**
- Create: `scripts/v2/compare.mjs`, `test/v2/compare.test.mjs`, `test/v2/compare-browser.test.mjs`
- Modify: `scripts/v2/cli.mjs:8-41`, `scripts/v2/run.mjs` (beside `makePoster`), `scripts/v2/pipeline.mjs:53-65` (`loadFilm` takes `look`), `scripts/v2/report.mjs:125-131`, `references/schema.md:142`, `references/tools.md` (section `Comparing looks`), `P/bin/test/make-motion-docs.test.mjs:210` (add `compare: {}`), `THIRD_PARTY_NOTICES.md`

**Interfaces:**
- Consumes: W3's `encodePng` (`scripts/lib/png-write.mjs`) and `readPng`; `sliceOf`'s shot lookup and `FilmTimeError` (W3) for an unknown shot; the sheet stamp (`scripts/v2/sheets.mjs:22-46`); `supportsKind`, `isParkedKind` (`engine/looks/index.mjs:293-296`).
- Produces:
  - `--compare-looks <shot-id>`: the anchor shot. One PNG, `<out stem>.looks.png` beside the MP4 path, four columns, one cell per look, each the anchor shot's late frame (85% of the shot, the frame `plan.mjs:63` uses) on estimated timing with no voice made, stamped with the look's name. No review, no sound, no ffmpeg.
  - `loadFilm(specPath, { ..., look })`: `look` replaces the film's own before validation.
  - `comparableLooks(film): { look: string, status: 'drawn' | 'parked' | 'refused', note: string | null }[]` (pure): the listed looks (`registries.looks.names()`) whose `modes` hold the film's mode, in listed order, at most `COMPARE_MAX = 16`. `refused` when the film does not validate in that look (the note is the first error's `path: message`); `parked` when the anchor shot's kind is parked there (drawn, the note `experimental kind`); else `drawn`.
  - `writeComparison({ specPath, shot, file, browser, signal }): Promise<{ file, shot, frame, looks }>`: one session per look that is not refused, opened and closed one after another; each returns its stamped tile as PNG bytes; a refused look's cell is a flat tile carrying the look's name and the note, drawn by the first session that opens. The tiles are placed in Node (`readPng`, `encodePng`); `COMPARE_COLUMNS = 4`, `COMPARE_TILE_WIDTH = 480`.
  - Every look refused: exit 1, one finding at `shots[i]` saying no look of this mode can draw the shot, and no file.
  - Report key `compare` (only then): `{ file, shot, frame, looks }`. `MODE_CONFLICTS['compare-looks'] = ['out', 'batch', 'no-render', 'sheets-only', 'outline', 'phonemes', 'poster', 'poster-out', 'inspect', 'shot', 'range', 'subtitles', 'workers', 'exact']`; added to the `preview` row.
  - `THIRD_PARTY_NOTICES.md`, under W1's `## Ideas credited, no code ported`, appended to the HyperFrames bullet (HeyGen, Apache-2.0): a comparison sheet of one frame across looks, marking what was measured apart from what was guessed, and per-glyph and per-line text entrances (P15) (W6; the P15 credit added by review fix). Prose only, no table row (`test/v2/cuts-notices.test.mjs:24`).

- [ ] **Step 1: Write the failing tests**

```js
// compare.test.mjs (no browser)
test('a viral film is compared only in the looks that serve viral', () => {
  assert.deepEqual(comparableLooks(VIRAL_FILM).map((c) => c.look), ['pop', 'cosmos', 'poster']);
});
test('a look that excludes the anchor kind is refused with the validator\'s words', () => {
  const marker = comparableLooks(PRO_FILM_WITH_SCREEN).find((c) => c.look === 'marker');
  assert.equal(marker.status, 'refused');
  assert.match(marker.note, /kind "screen" is not supported by look "marker"/);
});
test('a look that parks the anchor kind is drawn and marked', () => {
  assert.deepEqual(comparableLooks(PRO_FILM_WITH_NUMBER).find((c) => c.look === 'ledger'), { look: 'ledger', status: 'parked', note: 'experimental kind' });
});
test('--compare-looks does not go with --out or --poster, and an unknown shot exits 2 with the shot list', () => { /* two parseMakeArgs throws; one spawn: status 2, hint holds the ids */ });
// compare-browser.test.mjs [browser], one run: a two-shot pro film, anchor 'hook'
test('one sheet, a cell per look that serves the mode, four across', async (t) => {
  const { report, exitCode } = await runMake({ specPath, compareLooks: 'hook', out: null }, { browser });
  assert.equal(exitCode, 0);
  assert.deepEqual(report.compare.looks.map((c) => c.look), ['desk', 'cosmos', 'ledger', 'poster', 'keynote', 'marker']);
  const png = readPng(readFileSync(report.compare.file));
  assert.equal(png.width, 4 * 480);
  assert.equal(headlessPidsUnder(process.pid).size <= 1, true); // never two browsers
});
test('two cells of different looks differ; the same look twice would not', async (t) => { /* the pixel blocks of cell 0 and cell 1 are not equal */ });
```

- [ ] **Step 2: Run and see them fail** — `node --test "<MM>/test/v2/compare.test.mjs"`; expected FAIL, module not found.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see them pass** — the Node file and `cli-hints.test.mjs`, then **[browser]** `node --test --test-concurrency=1 "<MM>/test/v2/compare-browser.test.mjs"`, then `node --test "<P>/bin/test/make-motion-docs.test.mjs" "<MM>/test/v2/cuts-notices.test.mjs"`; expected PASS.
- [ ] **Step 5: One sheet, viewed [browser].** `node <MM>/scripts/make.mjs <MM>/references/examples/v2/showreel-pro.json --compare-looks <its first statement shot's id> --json`; open the PNG and say in the task report which looks are on it, how each cell is labelled and how a refused or parked cell reads.
- [ ] **Step 6: Commit** `feat(w6): --compare-looks draws one shot in every look that can draw it`.

### Task 6: The reference measure

**Files:**
- Create: `scripts/measure.mjs`, `scripts/lib/measure.mjs`, `test/v2/measure.test.mjs`
- Modify: `references/tools.md` (section `Measuring a reference video`), `P/bin/test/make-motion-docs.test.mjs:280` (add `scripts/measure.mjs` to `knownFlags`)

**Interfaces:**
- Consumes: `findFfmpeg`, `findFfprobe`, `parseLoudness` (`scripts/lib/ffmpeg.mjs:29,49`), `clipInput` and `probeClip` (`scripts/v2/clips.mjs:45,82`: protocol `file` only, the clip demuxers and decoders only).
- Produces:
  - `node scripts/measure.mjs <video file> [--json]`. Exit 0 with the table (or one JSON object); exit 2 for anything that is not a regular local file the clip probe accepts, with `local files only: give the path of a video file on this machine (mp4, mov, m4v, webm or mkv)`. An argument with a URL scheme (`/^[a-z][a-z0-9+.-]*:\/\//i`), a symbolic link, a folder, or a file whose format the whitelist refuses (a playlist, a concat script) is that error. Nothing is written; nothing is fetched.
  - `SCENE_THRESHOLD = 10` (ffmpeg `scdet`'s own default), `FAST_SHOT_SECONDS = 2`.
  - Pure, in `scripts/lib/measure.mjs`: `parseScdet(stderr: string): number[]` (the `lavfi.scd.time` values, in order); `shotStats(cuts: number[], duration: number): { count, median, shortest, longest }` (shot lengths from 0, the cuts and the duration); `measureReport({ probe, cuts, loudness }): Record<string, { value, basis: 'measured' | 'guessed' }>`.
  - Fields. Measured: `duration`, `size` (`[w, h]`), `fps`, `cuts` (count), `shotMedian`, `shotShortest`, `shotLongest`, `lufs`, `truePeakDb` (both `null`, still `measured`, for a file with no audio). Guessed: `mode` (`viral` when taller than wide, else `pro`), `pace` (`fast` when `shotMedian` is under `FAST_SHOT_SECONDS`, else `calm`). The text form prints the two groups under the headings `measured` and `guessed`.
  - The `Measuring a reference video` section of `references/tools.md`: the command, what each field means, that the numbers describe pacing and loudness only, and that a creator's footage, music, name or wording is never copied into a film.

- [ ] **Step 1: Write the failing test**

```js
const SCDET = '[scdet @ 0x1] lavfi.scd.score: 21.6, lavfi.scd.time: 1\n[scdet @ 0x1] lavfi.scd.score: 34.9, lavfi.scd.time: 2.033333\n';
test('parseScdet reads the cut times in order', () => assert.deepEqual(parseScdet(SCDET), [1, 2.033333]));
test('shot lengths come from the cuts and the duration', () => {
  assert.deepEqual(shotStats([1, 2], 3.5), { count: 2, median: 1, shortest: 1, longest: 1.5 });
  assert.deepEqual(shotStats([], 4), { count: 0, median: 4, shortest: 4, longest: 4 });
});
test('every field says whether it was measured or guessed', () => {
  const r = measureReport({ probe: { duration: 3, width: 1080, height: 1920, fps: 30 }, cuts: [1, 2], loudness: { lufs: -14.2, truePeak: -1.1 } });
  assert.deepEqual(r.cuts, { value: 2, basis: 'measured' });
  assert.deepEqual(r.mode, { value: 'viral', basis: 'guessed' });
  assert.deepEqual(r.pace, { value: 'fast', basis: 'guessed' });
  for (const field of Object.values(r)) assert.ok(['measured', 'guessed'].includes(field.basis));
});
test('a URL, a folder, a link and a playlist file each exit 2 with the local-files message, and ffmpeg is never started for a URL', () => {
  for (const arg of ['https://example.com/a.mp4', dir, linkToVideo, playlistFile]) {
    const run = spawnSync(process.execPath, [MEASURE, arg], { encoding: 'utf8' });
    assert.equal(run.status, 2, arg); assert.match(run.stderr, /local files only/);
  }
});
// needs ffmpeg (skips without, unless PA_REQUIRE_BROWSER=1): a 3 s fixture made in the test with lavfi, red 1 s, blue 1 s, green 1 s, 320x180 at 30 fps, a 440 Hz tone
test('a fixture with two known cuts measures two cuts within a frame of 1 s and 2 s', (t) => {
  const r = JSON.parse(spawnSync(process.execPath, [MEASURE, fixture, '--json'], { encoding: 'utf8' }).stdout);
  assert.equal(r.cuts.value, 2); assert.equal(r.cuts.basis, 'measured');
  assert.ok(Math.abs(r.shotMedian.value - 1) <= 1 / 30);
  assert.equal(r.lufs.basis, 'measured'); assert.equal(typeof r.lufs.value, 'number');
  assert.deepEqual(r.mode, { value: 'pro', basis: 'guessed' });
});
```

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/measure.test.mjs"`; expected FAIL, module not found.
- [ ] **Step 3: Implement** the signatures above. Before pinning `SCDET`, run this machine's ffmpeg once on the fixture (`-vf scdet=threshold=10 -f null -`) and copy two of its real lines into the test: the sample above is the form the filter is documented to print, not a line that was captured.
- [ ] **Step 4: Run and see it pass** — the same command, then `node --test "<P>/bin/test/make-motion-docs.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w6): measure.mjs turns a local reference video into measured and guessed numbers`.

### Task 7: Bounce and visible length in `--list moves`

**Files:**
- Modify: `engine/moves/index.mjs`, `scripts/v2/list.mjs:46-47,87-95`, `references/schema.md` (the `moves` row of "The `--list` names"), `THIRD_PARTY_NOTICES.md` (appended to the Rune bullet, MIT, of W1's credits section: reading a move as bounce and length (W6); the definition of visible length is ours)
- Test: `test/v2/moves.test.mjs`

**Interfaces:**
- Produces:
  - `VISIBLE_EPSILON = 0.01`, `FACT_SAMPLES = 1000`.
  - `motionFacts(move: { ease: string, dur: number }): { bounce: number, visible: number }` in `engine/moves/index.mjs` (pure). The curve `f = ease(move.ease)` is sampled at `i / FACT_SAMPLES`. `bounce`: how far it passes its end, `max(0, max f - 1)`, to 2 decimals (0.1 is ten percent past). `visible`: `dur` times the first sampled `p` from which every later sample stays within `VISIBLE_EPSILON` of 1, to 2 decimals: the seconds a viewer sees it move, which for a spring is shorter than its `dur` (`engine/time/ease.mjs:67-79` stretches a spring so its tail ends at `dur`). A `dur` of 0 gives `{ bounce: 0, visible: 0 }`. A dip below 0 on the way in (`inBack`) is not bounce.
  - `--list moves`: each look's line gains `, bounce <n>%` when the bounce is above 0, and `, visible <s> s` (`list.mjs:88-95`); `--json` entries gain `facts: Record<look, { bounce, visible } | null>` beside `looks` (`list.mjs:47`).

- [ ] **Step 1: Write the failing test**

```js
test('a linear move is visible for 99% of its length and does not bounce', () => assert.deepEqual(motionFacts({ ease: 'linear', dur: 1 }), { bounce: 0, visible: 0.99 }));
test('outQuad settles at 90% of its length, outCubic at 78.5%', () => {
  assert.equal(motionFacts({ ease: 'outQuad', dur: 1 }).visible, 0.9);
  assert.equal(motionFacts({ ease: 'outCubic', dur: 0.5 }).visible, 0.39);
});
test('outBack passes its end by ten percent; inBack does not bounce', () => {
  assert.equal(motionFacts({ ease: 'outBack', dur: 1 }).bounce, 0.1);
  assert.equal(motionFacts({ ease: 'inBack', dur: 1 }).bounce, 0);
});
test('a spring at half damping bounces 16%; a critically damped one does not', () => {
  assert.equal(motionFacts({ ease: 'spring(100,10)', dur: 1 }).bounce, 0.16);
  assert.equal(motionFacts({ ease: 'spring(100,20)', dur: 1 }).bounce, 0);
});
test('a spring is visible for less than its length', () => assert.ok(motionFacts({ ease: 'spring(100,10)', dur: 1 }).visible < 1));
test('the two new forms have facts', () => {
  assert.equal(motionFacts({ ease: 'steps(4)', dur: 1 }).visible, 1);
  assert.equal(motionFacts({ ease: 'steps(4,start)', dur: 1 }).visible, 0.75);
  assert.ok(motionFacts({ ease: 'cubic-bezier(0.34,1.56,0.64,1)', dur: 1 }).bounce > 0);
});
test('a move of no length has no facts to show', () => assert.deepEqual(motionFacts({ ease: 'linear', dur: 0 }), { bounce: 0, visible: 0 }));
test('--list moves prints them, and --json carries them', () => {
  assert.match(formatList('moves', listEntries('moves')), /desk: outCubic 0\.5 s, 24 units, visible 0\.39 s/);
  assert.deepEqual(listEntries('moves').find((m) => m.name === 'rise').facts.desk, { bounce: 0, visible: 0.39 });
});
```

`spring(100,10)` has a damping ratio of 0.5, whose first overshoot is `exp(-pi * 0.5 / sqrt(0.75))`, 0.163. `desk`'s `rise` is `{ ease: 'outCubic', dur: 0.5, dist: 24 }` (`engine/looks/desk.mjs:50`).

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/moves.test.mjs"`; expected FAIL, `motionFacts is not a function`.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see it pass** — `node --test "<MM>/test/v2/moves.test.mjs" "<MM>/test/v2/purity.test.mjs"`, then `node --test "<P>/bin/test/make-motion-docs.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w6): --list moves prints each move's bounce and visible length`.

### Task 8: Wave gate

- [ ] **Step 1: The cost of glyph state, measured.** With no other browser live, render `references/examples/v2/gate-desk.json` (no glyph text) three times at the wave's base commit and three times at its head with `--json --out <scratch>/w6/gate-desk.mp4`; the head's median `msPerFrame` is at most 1.05 times the base's, or the cause is found and removed. Then `look-poster.json` once at each commit: its `captured` and `msPerFrame` go in the task report with the commands, as measured, with no budget.
- [ ] **Step 1b:** The flag pins. `--compare-looks` changes `FLAGS` and the usage line (`scripts/v2/cli.mjs:8-9`), and the move count goes from seven to nine. Search `test/help.test.mjs`, `test/cli-contract.test.mjs`, `P/eval/test/make-contract.test.mjs`, `P/eval/test/docs-facts.test.mjs` and the docs (`README.md`, `references/schema.md`) for what pins either and update it in the commit that made the change.
- [ ] **Step 2:** Run what CI runs for this area, one command per call: `node <P>/bin/sync-shared.mjs --check`; `node --test "<P>/bin/test/*.test.mjs"`; `python3 -m pytest tests/pytest`; the Node-only files this wave touched; then **[browser]**, one at a time, `glyphs-browser`, `compare-browser`, `make`, `review-browser`, `poster-examples-browser`, `keynote-examples-browser`.
- [ ] **Step 3:** Fresh-context review (reviewer tier, medium), report only, never writing session logs or project docs, given the wave's diff, this plan's Review Focus and the security lens (`scripts/measure.mjs` hands a path a user names to ffmpeg and ffprobe; `--compare-looks` writes beside the output). Its prompt carries this sentence verbatim: "Report every issue you find, including ones you are uncertain about or consider low-severity. Do not filter for importance or confidence at this stage — a separate verification step will do that. Your goal here is coverage: it is better to surface a finding that later gets filtered out than to silently drop a real bug. For each finding, include your confidence level and an estimated severity so a downstream filter can rank them."
- [ ] **Step 4:** The controller fixes every CRITICAL and HIGH with a test that failed first (`fix(w6):`), then pushes the wave's commits.
- [ ] **Step 5:** For the final phase, record: the eases `cubic-bezier()` and `steps()`; the moves `letters` and `lines` and the two looks whose statement entrance changed (their gallery films are rebuilt and their plates rechecked); the flag `--compare-looks`; `scripts/measure.mjs`; the new columns of `--list moves`; on the manual checklist: watch one `poster` and one `keynote` film at full speed for a letter that shifts as it lands.

## Self-review notes

- Spec coverage: P15 (Tasks 1 to 4), P16 (Tasks 5, 6), P19 (Task 7).
- Decisions the owner should check: the two adopting looks (`poster` for letters, `keynote` for lines; Task 2's table can change the first); a look opts in through `kinds.statement.entrance`, and only the statement kind reads it; `--compare-looks` takes a shot id and shows its late frame on estimated timing; the reference measure's guessed fields are `mode` and `pace` only; "visible" means within 1% of the end.
