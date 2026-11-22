# Motion Steals W4: Shorts, Sound, Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A short reads with the sound off (a subtitle file with one cue per word, a poster checked for how it reads as a thumbnail), a repeated sound cue no longer sounds stamped, one flag gives a second delivery without the music, and a film can carry a logo and a progress bar that stay unbroken across every cut.

**Architecture:** Subtitles and the poster read are pure functions over the timeline and the page's snapshot, added beside the code that exists. Cue variants are a `variant` argument threaded from the cue track down to the synthesisers, with variant 0 byte-equal to today. `--no-music` drops the music track after the plan that moves the cuts has run, so the picture is the same film. Overlays are film-level scene-graph nodes built once, sampled at film time and never handed to a cut: the page draws them over the composed frame (2D) or hands them to the post pass to lay over a shader cut's result, before bloom, halftone and grain. They are left out of `__snapshot`, so no existing rule sees them, and out of the key the stillness rule reads.

**Tech Stack:** Node 20+, `node:test`, Playwright Chromium and ffmpeg where named. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-11-21-motion-steals-design.md` section 6, W4. Evidence: `.scratch/research-2026-11-21/PROPOSAL.md` items 8, 12, 10 (P8, P12, P10).

Abbreviations: `P` = `plugins/portable-artifacts`, `MM` = `P/skills/make-motion`. Paths with no prefix are relative to `MM/`. In commands, `<MM>` and `<P>` stand for the literal absolute paths. Anchors were read on branch `feat/motion-steals` on 2026-11-21, before W0 to W3 landed; nothing was run. Where an earlier wave edits the same file (W1: `scripts/v2/render.mjs`, `SKILL.md`, the doc test; W2: `engine/review/frame.mjs`, `scripts/v2/review.mjs`, `engine/script/timing.mjs`, `engine/graph/film.mjs`, `engine/page/stage.mjs`; W3: `scripts/v2/cli.mjs`, `scripts/v2/run.mjs`, `scripts/v2/report.mjs`), find the anchor by the function named beside it.

## Global Constraints

- `MM/SKILL.md` is 20,898 bytes against a 20,900-byte budget pinned in `plugins/portable-artifacts/bin/test/skill-budget.test.mjs`; slim, never raise the cap. This wave adds 0 bytes to `SKILL.md`.
- No new runtime dependency, no network use, no generative-video call from `make.mjs`.
- No new server route (the preview server is GET and HEAD only). The logo is served through the existing `/asset/<n>` list.
- One headless browser at a time (`pgrep -fl chrome-headless-shell` first; `--test-concurrency=1`). Steps marked **[browser]** are run one at a time.
- Goldens change only for an intended visual change, stated in the commit. Intended here: the cue track of a film that plays one cue more than once (Task 3). A film with no `overlays` field draws the frames it draws today.
- HyperFrames (Apache-2.0) and Rune (MIT) ideas are rewritten in our own code with a credit line in `THIRD_PARTY_NOTICES.md`; no file is ported. No code from beast_explainer.
- Every code fix and guardrail is shown failing first (RED), then passing.
- Commits: conventional, prefixed `feat(w4):` / `fix(w4):` / `test(w4):` / `docs(w4):`, staging named files only, ending with exactly one trailer line `Co-Authored-By: Claude <noreply@anthropic.com>` and no `Claude-Session` line (the `commit-trailers` CI job fails otherwise). Implementers do not commit; the controller runs each Commit step.
- All waves ship on one branch and one PR; one `plugin.json` bump, one `CHANGELOG.md` heading and the cover Revision happen once in the final phase, not per wave.
- A fresh-context review (reviewer tier) runs at the end of each wave before its commits are pushed. Implementers are executor tier (Sonnet, effort high); reviewers Opus at medium.
- Shell: one plain command per call, literal absolute paths, no `cd`, `&&`, pipes, `;`, variables, loops or heredocs; quote globs; never `rm`.
- Everything that differs between looks is look data; no branch on a look's name. A look gives an entry, an object or `null`, for every registered overlay, and `validateLook` refuses a look that does not.
- `bin/test/make-motion-docs.test.mjs` pins the root fields (`:194-197`), the report keys (`:204-213`) and the eight `--list` names (`:99-104`); line numbers are as read before W1. This wave adds one root field (`overlays`), no `--list` name and no reference file (after W1 a new one must be named in `SKILL.md`): its notes go in `references/schema.md` and W3's `references/rules.md`.
- Credits go in W1's section of `THIRD_PARTY_NOTICES.md`, `## Ideas credited, no code ported`, as prose under the project's bullet. Task 8 appends to the HyperFrames bullet (HeyGen, Apache-2.0): film-level overlays drawn apart from the shots, and rotating takes of a repeated sound (W4).

## Review Focus

1. **A progress bar that silences the stillness rule.** The bar moves every frame; if the key `__heldFlags(a, b, false)` compares held it, `still` (`scripts/v2/review.mjs:259-270`) would never fire again. Tested in Task 7.
2. **An overlay inside a cut's inputs.** A logo passed to a slide moves with the shot; one drawn into the cached outgoing picture (`engine/page/cut-pictures.mjs`) is transformed with it. Tested in Tasks 6 and 7.
3. **`loop: true` with a progress bar.** The last frame can never match the first (`scripts/v2/loop.mjs:14-17`). The loop check and the poster seek without overlays; tested in Task 7.
4. **Narration that leads or trails a cut (W2).** Word cues from two shots then interleave; a file written shot by shot would run backwards. Tested in Task 1.
5. **A cue that is all tone.** `pop`, `chime`, `drop` and `ding` use no noise (`scripts/v2/sound/cue-synth.mjs:213-218,234-238,266-277`), so a new noise seed alone leaves them byte-identical. Tested in Task 3 for every cue.
6. **`--no-music` on a film whose cuts were moved onto the beats.** Dropping the music before the snap would give a different film. Tested in Task 4.
7. **A logo the browser cannot decode, or outside the film folder.** It must be a finding at `overlays.logo.src`, as a shot's picture is. Tested in Task 5.

## File Structure

- Create `engine/overlays/index.mjs` (the registry entries `logo` and `progress`, and `overlayNodes`), `engine/review/poster.mjs`, `engine/review/overlay.mjs`.
- Modify `scripts/v2/subtitles.mjs`, `scripts/v2/cli.mjs`, `scripts/v2/run.mjs`, `scripts/v2/poster.mjs`, `scripts/v2/sound/cue-synth.mjs:13,357-361`, `scripts/v2/sound/synth.mjs:184-200,247-271`, `engine/registry.mjs:25-34`, `engine/looks/index.mjs:348-369` and the seven look files, `engine/graph/film.mjs:258-320`, `engine/page/stage.mjs:63-84,150-174,229-251`, `engine/page/post.mjs:166-193,221-229`, `scripts/v2/server.mjs:199-209`, `scripts/v2/spec.mjs:48-76`, `scripts/v2/loop.mjs:14-17`, `scripts/v2/review.mjs`, `engine/review/rules.mjs` and `references/rules.md` (W3), `references/schema.md`.
- Tests: `test/v2/subtitles.test.mjs`, `poster-read.test.mjs`, `sound-variants.test.mjs`, `make-sound.test.mjs`, `overlays.test.mjs`, `overlays-browser.test.mjs`, cases in `looks.test.mjs`, `look-contract.test.mjs`, `spec.test.mjs`, `cli-hints.test.mjs`, `review-rules.test.mjs`.

---

### Task 1: Word-level subtitles

**Files:**
- Modify: `scripts/v2/subtitles.mjs:16-47`, `scripts/v2/cli.mjs:8-41,127-131`, `scripts/v2/run.mjs:522`, `references/schema.md`
- Test: `test/v2/subtitles.test.mjs`, `test/v2/cli-hints.test.mjs`

**Interfaces:**
- Consumes: the timeline's words, each `{ text, soundStart, soundEnd }` in shot seconds (`engine/script/timing.mjs:81,109-112`). The W2 narration lead/trail field (w2 plan, "Names other plans rely on"): a shot's optional `narration: { "lead": seconds, "trail": seconds }`, each from 0 to `NARRATION_SHIFT_MAX` (1.5), default 0. W2's sign convention: `soundStart` and `soundEnd` are seconds from the word's own shot's picture start and may be negative or past the shot's length; the film second a word is heard is always `shot.start + word.soundStart`. Nothing else of W2 is needed.
- Produces:
  - `--subtitle-words` (boolean, needs `--subtitles`): one cue per word.
  - `subtitleCues(timeline, { level = 'sentence' }): { start, end, text }[]`. `level: 'word'`: one cue per word that is heard (`soundEnd > soundStart`), at `shot.start + soundStart` to `shot.start + soundEnd`; all cues sorted by `start` across the film; each held inside 0 to `timeline.duration`; a cue that would run past the next one's start ends there.
  - `subtitleText(timeline, format, { level })` and `writeSubtitles({ timeline, format, videoOut, level })`; the report's `subtitles` gains `level`.
  - An estimated timeline: the VTT carries the existing `NOTE` (`subtitles.mjs:10`), and for words it reads `NOTE the word times are estimated from the word count: the film has no voice to measure them by`. An estimated SRT stays refused (`subtitles.mjs:42`).

- [ ] **Step 1: Write the failing test**

```js
// T: two shots, duration 4. a: start 0, words one [0.0-0.4] two [0.5-0.9] three [1.5-1.9] (soundStart-soundEnd, shot seconds);
// b: start 2.0, words four [-0.3-0.1] (it leads the cut) and five [0.2-0.6]
test('one cue per word, at film time', () => {
  assert.deepEqual(subtitleCues(T, { level: 'word' }).slice(0, 2), [{ start: 0, end: 0.4, text: 'one' }, { start: 0.5, end: 0.9, text: 'two' }]);
});
test('a word that leads its cut sorts where it is heard, and the word before it ends there', () => {
  const cues = subtitleCues(T, { level: 'word' });
  assert.deepEqual(cues.map((c) => c.text), ['one', 'two', 'three', 'four', 'five']);
  assert.deepEqual(cues[2], { start: 1.5, end: 1.7, text: 'three' });
  assert.deepEqual(cues[3], { start: 1.7, end: 2.1, text: 'four' });
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].start >= cues[i - 1].end);
});
test('no cue leaves the film', () => { /* a trailing word past the last shot's end is cut at timeline.duration */ });
test('through buildTimeline: a shot with narration.lead hears its first word before its picture starts', () => {
  const timeline = buildTimeline(filmWith({ b: { narration: { lead: 0.3 } } }), { fps: 30 });
  const first = subtitleCues(timeline, { level: 'word' }).find((c) => c.text === FIRST_WORD_OF_B);
  assert.ok(first.start < timeline.shots[1].start);
});
test('estimated word times say so in the VTT; an estimated SRT is refused', () => {
  assert.match(subtitleText(ESTIMATED, 'vtt', { level: 'word' }), /^WEBVTT\n\nNOTE the word times are estimated/);
  assert.throws(() => subtitleText(ESTIMATED, 'srt', { level: 'word' }), /SRT has no comment line/);
});
test('--subtitle-words needs --subtitles', () => assert.throws(() => parseMakeArgs(['f.json', '--subtitle-words']), /--subtitle-words needs --subtitles/));
test('the sentence form is unchanged', () => { /* the existing tests of this file stay as they are and pass */ });
```

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/subtitles.test.mjs"`; expected FAIL: `subtitleCues` returns sentence cues (`'one two three'`).
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see it pass** — `node --test "<MM>/test/v2/subtitles.test.mjs" "<MM>/test/v2/cli-hints.test.mjs"`, then `node --test "<P>/bin/test/make-motion-docs.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w4): --subtitle-words writes one cue per word`.

### Task 2: The poster read at thumbnail size

**[R2-12]** The new registry row sets `evidence` (`unmeasured` unless a table of ours is named) and, for a creative rule, `ask`; its `rules.md` row fills both cells. Without it W3's evidence test fails on this rule.

**Files:**
- Create: `engine/review/poster.mjs`, `test/v2/poster-read.test.mjs`
- Modify: `scripts/v2/run.mjs:396-406` (`makePoster`), `engine/review/rules.mjs`, `references/rules.md`, `test/v2/review-rules.test.mjs` (39 rules; the scan's file list)

**Interfaces:**
- Consumes: W3's `inspectNodes(sampled, ctx)` (each text's `sizeUnits`), `frameContext` (exported in W3 Task 5), the `suggest` keys `minSize` and `factor`, the registry.
- Produces:
  - `POSTER_THUMB_SHORT_SIDE = 180` (pixels), `POSTER_MIN_TEXT_PX = 14`, so `POSTER_MIN_UNITS = 84` (a unit is the short side over 1080, `engine/units.mjs`).
  - `posterReadFindings(sampled, ctx): finding[]`: of the texts on the poster frame that are neither a spoken caption (`props.caption`) nor frame furniture (`props.furniture`), the largest by `sizeUnits`. Under `POSTER_MIN_UNITS`: one finding `{ kind: 'creative', rule: 'poster-read', node: <its id>, path: 'shots[i]', message, suggest: { minSize: 84, factor } }`. No text on the frame: none (a picture poster). Computed from the layout; no pixel is read.
  - Message: `the largest text on the poster is <n> px tall on a 180 px thumbnail; it needs 14 px (84 units), so pick a frame with a bigger line or enlarge "<id>"`.
  - `--poster` puts these findings in the report; they are creative, so the exit code stays 0.
  - Registry row `poster-read`: `kinds: ['creative']`, `stage: 'poster'`, `capped: false`, `suggest: 'minSize'`.

- [ ] **Step 1: Write the failing test**

```js
test('a poster whose largest text is 40 units is a finding with the size to reach', () => {
  const [f] = posterReadFindings(treeWithTexts([40, 30]), CTX);
  assert.equal(f.rule, 'poster-read'); assert.equal(f.kind, 'creative');
  assert.deepEqual(f.suggest, { minSize: 84, factor: 2.1 });
  assert.match(f.message, /is 6\.7 px tall on a 180 px thumbnail; it needs 14 px \(84 units\)/);
});
test('84 units passes; so does a frame with no text', () => {
  assert.deepEqual(posterReadFindings(treeWithTexts([84]), CTX), []);
  assert.deepEqual(posterReadFindings(treeWithTexts([]), CTX), []);
});
test('a caption and a slug do not count as the poster text', () => { /* a 200-unit caption beside a 40-unit hero: the finding names the hero */ });
```

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/poster-read.test.mjs"`; expected FAIL, module not found.
- [ ] **Step 3: Implement** the signatures above; register the rule and add its row to `references/rules.md`.
- [ ] **Step 4: Run and see it pass** — `node --test "<MM>/test/v2/poster-read.test.mjs" "<MM>/test/v2/review-rules.test.mjs"`, then **[browser]** `node --test --test-concurrency=1 "<MM>/test/v2/poster-browser.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w4): the poster is checked for how it reads as a thumbnail`.

### Task 3: Cue variants

**Files:**
- Modify: `scripts/v2/sound/cue-synth.mjs:13,357-361`, `scripts/v2/sound/synth.mjs:184-200,247-271`
- Test: `test/v2/sound-variants.test.mjs` (new); `test/v2/cue-synth.test.mjs` stays as it is

**Interfaces:**
- Produces:
  - `CUE_VARIANTS = 3`, `VARIANT_CENTS = [0, 30, -30]` (exported from `cue-synth.mjs`).
  - `cueWav({ cue, note, pan, chars, spacing, variant = 0 })`: variant 0 is today's bytes. Variant `k`: the noise seed is `NOISE_SEED + k` and the cue's pitch is raised by `VARIANT_CENTS[k]` cents (`f0 * 2 ** (cents / 1200)`), so a cue with no noise in it changes too.
  - `cueSamples(cue, { seed, variant = 0 })`: the four voices of `synth.mjs` (`sub`, `paper`, `marker`, `erase`) and the riser take the same two changes (seed `cueSeed(seed, cue) + variant`; `sub`'s glide scaled by the cents).
  - `renderCues` (`synth.mjs:247-271`): the n-th time a cue name sounds in the list, in time order, it plays variant `n % CUE_VARIANTS`; its one-voice-per-name cache becomes one per name and variant.

- [ ] **Step 1: Write the failing test**

```js
test('variant 0 is today: the same bytes with and without the argument', () => {
  for (const cue of Object.keys(CUE_LAYERS)) assert.ok(cueWav({ cue }).equals(cueWav({ cue, variant: 0 })), cue);
});
test('every cue the synth knows has three takes that differ and are the same length', () => {
  for (const cue of KNOWN_CUES) {
    const takes = [0, 1, 2].map((variant) => cueSamples(cue, { seed: 1, variant }));
    assert.equal(new Set(takes.map((t) => t.length)).size, 1, cue);
    assert.notDeepEqual(takes[0], takes[1], cue); assert.notDeepEqual(takes[1], takes[2], cue); assert.notDeepEqual(takes[0], takes[2], cue);
  }
});
test('a take is the same bytes twice, and peaks where the cue peaks', () => {
  assert.deepEqual(cueSamples('whoosh', { seed: 7, variant: 2 }), cueSamples('whoosh', { seed: 7, variant: 2 }));
  // peakOf(samples) = the largest absolute sample value (amplitude, not time). A detune moves where the peak falls, so compare within 2% (review fix).
  for (const variant of [1, 2]) { const a = peakOf(cueSamples('pop', { seed: 1, variant })); const b = peakOf(cueSamples('pop', { seed: 1 })); assert.ok(Math.abs(a - b) <= 0.02 * b, `peak ${a} vs ${b}`); }
});
test('three whooshes in one film are three takes; the fourth is the first again', async () => {
  const wav = await renderCues([1, 2, 3, 4].map((t) => ({ t, cue: 'whoosh', gainDb: 0, pan: 0 })), { seconds: 5, seed: 1, out });
  const [a, b, c, d] = [1, 2, 3, 4].map((t) => window(wav.file, t, 0.8)); // the 0.8 s from each cue's start
  assert.notDeepEqual(a, b); assert.notDeepEqual(b, c); assert.notDeepEqual(a, c); assert.deepEqual(a, d);
});
test('a film that plays each cue once keeps its bytes', async () => { /* renderCues of [pop at 1, click at 2] equals the bytes of the same call at this task's base commit, recorded as a sha256 in the test before the change */ });
```

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/sound-variants.test.mjs"`; expected FAIL: the three takes are deepEqual (no `variant`).
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see it pass** — `node --test "<MM>/test/v2/sound-variants.test.mjs" "<MM>/test/v2/cue-synth.test.mjs" "<MM>/test/v2/sound-synth.test.mjs" "<MM>/test/v2/sound-cues.test.mjs" "<MM>/test/v2/sound-mix.test.mjs" "<MM>/test/v2/cue-acoustics.test.mjs"`; expected PASS, `cue-synth.test.mjs` unchanged.
- [ ] **Step 5: Commit** `feat(w4): a repeated cue rotates through three takes`, the body saying: the cue track of a film that plays one cue more than once changes on purpose; a film that plays each cue once keeps its bytes.

### Task 4: `--no-music`

**Files:**
- Modify: `scripts/v2/cli.mjs:8-41`, `scripts/v2/run.mjs:316-334,366-390`, `references/schema.md`
- Test: `test/v2/make-sound.test.mjs`, `test/v2/cli-hints.test.mjs`

**Interfaces:**
- Produces:
  - `--no-music` (boolean), `options.noMusic`. The music is still planned (`musicPlan`, `run.mjs:303-311`), so a `music.snap` moves the cuts as before and the cues are planned on that timeline; only the music track is left out of what `soundFiles` returns.
  - `report.audio.music` keeps its summary and gains `muted: true`. A film whose only sound was the music renders with no audio stream and `report.audio === null` after the render.
  - `MODE_CONFLICTS['no-music'] = ['outline', 'phonemes', 'poster', 'poster-out', 'inspect']`; `no-music` is added to the `preview` row.
  - Log line: `make: --no-music: the film is rendered without its music; its cuts stay where the music put them`.

- [ ] **Step 1: Write the failing test**

```js
test('--no-music keeps the cuts the snap moved and drops the track', async () => {
  const withMusic = await runMake({ specPath: SNAP_FILM, noRender: true, out: null });
  const without = await runMake({ specPath: SNAP_FILM, noRender: true, noMusic: true, out: null });
  assert.deepEqual(without.report.audio.music.moved, withMusic.report.audio.music.moved);
  assert.equal(without.report.audio.music.muted, true);
  assert.equal(withMusic.report.audio.music.muted, undefined);
});
test('--no-music does not go with --outline or --poster', () => { /* two parseMakeArgs throws: /--no-music does not go with/ */ });
// [browser, ffmpeg]
test('a film whose only sound is a bed renders silent with --no-music', async (t) => { /* report.audio === null; ffprobe finds no audio stream */ });
```

`test/v2/make-sound.test.mjs` has no `music.snap` film today: build `SNAP_FILM` the way `test/v2/sound-snap.test.mjs` builds its own (a film with no narration, a music file and a beats file whose beats move at least one cut).

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/make-sound.test.mjs"`; expected FAIL: `muted` is undefined.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see it pass** — `node --test "<MM>/test/v2/cli-hints.test.mjs"`, then **[browser]** `node --test --test-concurrency=1 "<MM>/test/v2/make-sound.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w4): --no-music renders the same film without its music`.

### Task 4b (conditional): The beat audit

**Build this task only if W0's row "audio offset" has a median magnitude above 20 ms** (`.scratch/motion-steals-w0/results/W0-RESULTS.md`, copied into the PR body; the threshold is the one W0 records against). Otherwise skip it and write one line in the wave's PR notes: `beat audit not built: W0 measured <n> ms`.

**Files:** `scripts/beats.mjs`, `scripts/lib/beats.mjs`, `test/beats.test.mjs`, `references/music.md` (W1's page for the beat notes: the command, in two lines).

**Interfaces:**
- Produces: `node scripts/beats.mjs --audit <film.mp4> --beats <beats.json>`: extracts the film's audio with ffmpeg, finds its beats with the existing detector, and prints one row per beat of the grid: `beat`, `expected s`, `heard s`, `off (frames)`, then the median offset. Exit 0 always; it measures and judges nothing.
- `auditBeats(expected: number[], heard: number[], fps: number): { rows: { beat, expected, heard, frames }[], medianFrames: number }` (pure).

- [ ] **Step 1: Failing test:** `auditBeats([1, 2, 3], [1.1, 2.1, 3.1], 30).medianFrames === 3`; a grid shifted by 2 frames moves every row by 2.
- [ ] **Step 2: Run** `node --test "<MM>/test/beats.test.mjs"`; expected FAIL, `auditBeats is not a function`.
- [ ] **Step 3: Implement.** **Step 4: Run; PASS.** **Step 5: Commit** `feat(w4): beats.mjs --audit measures a film's beats against its grid`.

### Task 5: The `overlays` field, the look data and the overlay nodes

**Files:**
- Create: `engine/overlays/index.mjs`, `test/v2/overlays.test.mjs`
- Modify: `engine/registry.mjs:25-34` (add `overlays: createRegistry('overlay')`), `engine/looks/index.mjs:348-369` (`validateLook`) and its typedef, the seven files `engine/looks/{desk,pop,cosmos,ledger,poster,keynote,marker}.mjs`, the test looks (`test/v2/helpers/hand-look.mjs`, `test/v2/helpers/look-contract.mjs`), `scripts/v2/spec.mjs:48-76` (`ROOT_SCHEMA`), `scripts/v2/server.mjs:199-209` (`distinctSrcs`), `scripts/v2/list.mjs` (a look's entry), `references/schema.md` (the root field row and an "Overlays" section)
- Test: `test/v2/overlays.test.mjs`, `test/v2/looks.test.mjs`, `test/v2/look-contract.test.mjs`, `test/v2/spec.test.mjs`

**Interfaces:**
- Produces:
  - Root field `overlays: { logo?: { src: string, corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }, progress?: true }`. An unknown key gets did-you-mean; `logo.src` is held to the film folder by the check a shot's picture gets (`srcProblem`, `spec.mjs:444`), at the path `overlays.logo.src`.
  - `registries.overlays` with `logo` and `progress`, each `{ summary, build({ film, look, canvas, unit, safe, duration, asset }) -> Node[] }`.
  - `look.overlays: { logo: { corner, height, margin, opacity } | null, progress: { edge: 'top' | 'bottom', height, inset, bar, track } | null }` (units; `bar` and `track` palette keys). `validateLook` requires an entry, an object or `null`, for every registered overlay: `look "<name>": overlays.<overlay> must be an object or null`.
  - A film that asks for an overlay its look gives `null` for is invalid at `overlays.<name>`: `look "<look>" does not draw the <name> overlay; the looks that do: <names>`.
  - `overlayNodes({ film, look, canvas, timeline, assets }): Node[]`: ids `overlay.logo`, `overlay.progress.track`, `overlay.progress.bar`, each with `props.overlay` set to the overlay's name. The bar is one path whose `reveal` track runs 0 to 1 over the film's length, linear. Positions sit inside the rectangle the look composes in (`compositionRect`, as `scripts/v2/review.mjs:48-55` reads it), so a short's overlays stay inside the platform safe zone.
  - Starting look data: every look draws both, except `marker`, whose `progress` is `null` (the look draws every stroke by hand). The implementer may change a value after viewing Task 7's strip, and says so.
  - `--list looks --json`: each entry gains `overlays: { logo: boolean, progress: boolean }`.

- [ ] **Step 1: Write the failing test**

```js
test('the two overlays are registered, each with a summary', () => assert.deepEqual(registries.overlays.names(), ['logo', 'progress']));
test('every shipped and experimental look names both overlays, an object or null', () => {
  for (const name of allLookNames()) for (const overlay of registries.overlays.names()) assert.ok(Object.hasOwn(registries.looks.get(name).overlays, overlay), `${name}.${overlay}`);
});
test('a look that leaves an overlay out fails validateLook naming it', () => {
  assert.throws(() => validateLook({ ...registries.looks.get('desk'), overlays: { logo: null } }), /look "desk": overlays\.progress must be an object or null/);
});
test('a film asking for an overlay its look refuses is invalid, naming the looks that draw it', () => {
  const { errors } = validateFilm({ version: 2, look: 'marker', overlays: { progress: true }, shots: [SHOT] }, { specDir });
  assert.equal(errors[0].path, 'overlays.progress');
  assert.match(errors[0].message, /look "marker" does not draw the progress overlay; the looks that do: desk, pop, cosmos, ledger, poster, keynote/);
});
test('a logo outside the film folder, and an unknown overlay, are errors with a path', () => {
  assert.equal(validateFilm({ version: 2, overlays: { logo: { src: '../x.png' } }, shots: [SHOT] }, { specDir }).errors[0].path, 'overlays.logo.src');
  assert.match(validateFilm({ version: 2, overlays: { progres: true }, shots: [SHOT] }, { specDir }).errors[0].message, /did you mean "progress"/);
});
test('the bar reveals in step with the film', () => {
  const bar = sampleGraph(overlayNodes(ARGS), ARGS.timeline.duration / 4).find((n) => n.id === 'overlay.progress.bar');
  assert.equal(bar.reveal, 0.25); assert.equal(bar.props.overlay, 'progress');
});
test('the logo is one of the pictures the server lists', () => { /* the film's asset list holds overlays.logo.src once */ });
```

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/overlays.test.mjs"`; expected FAIL, `registries.overlays` is undefined.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see it pass** — `node --test "<MM>/test/v2/overlays.test.mjs" "<MM>/test/v2/looks.test.mjs" "<MM>/test/v2/look-contract.test.mjs" "<MM>/test/v2/spec.test.mjs" "<MM>/test/v2/purity.test.mjs"`, then `node --test "<P>/bin/test/make-motion-docs.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w4): an overlays field, look data for it and the overlay nodes`.

### Task 6: Overlays in the film and on the page

**Files:**
- Modify: `engine/graph/film.mjs:258-320` (`buildFilm`), `engine/page/stage.mjs:63-84` (the keys), `:150-174` (`installApi`), `:229-251` (`draw`), `engine/page/post.mjs:166-193,221-229` (`render`), `scripts/v2/poster.mjs:27`, `scripts/v2/loop.mjs:14-17`
- Test: `test/v2/overlays.test.mjs` (the film), `test/v2/overlays-browser.test.mjs` (the page)

**Interfaces:**
- Consumes: `overlayNodes` (Task 5).
- Produces:
  - `buildFilm(...)` also returns `overlayAt(t): sampled[]`, the overlay nodes sampled at film second `t`, with no camera applied; `[]` for a film with none. `frameAt(t).sampled`, `from.sampled` and every smear layer never hold a node whose id starts with `overlay.`.
  - Page draw order: the shot or the composed cut, then the overlays, then the post pass. For every frame the 2D path composes (no cut, a node cut, a smear, a layer cut, a shader cut drawn as its stand-in) the stage draws `overlayAt(t)` onto the source after `drawShot`, `drawSmeared` or `cutPictures.compose` (`stage.mjs:235-250`). For a shader cut the post pass runs, the stage draws them on a clear canvas of the frame's size and passes it on: `post.render(source, t, cut, overlay)`; the post pass lays `overlay` over the transition's result with premultiplied alpha, before bloom, halftone and grain (`post.mjs:166-176`).
  - `window.__seek(i, { captions = true, overlays = true, progress })`. The poster (`poster.mjs:27`) and the loop check (`loop.mjs:15`) seek with `overlays: false`.
  - Keys: `captureKey` gains `|overlay:<stateKey of overlayAt>` when the film has overlays; `drawKey` does not, so `__heldFlags(a, b, false)` still says whether the film itself holds still.
  - `window.__snapshot` and `__snapshotShot` are unchanged: no overlay node in them. `window.__snapshotOverlays(i)`: the overlay nodes with their boxes, for Task 7 and for W3's `--inspect`, whose JSON gains `overlays` (the same node shape).
  - A film with no `overlays` field creates no extra canvas and draws the pixels it draws today.

- [ ] **Step 1: Write the failing tests**

```js
// overlays.test.mjs (no browser), a three-shot film with a slide (node cut, smear on), a crossfade and a ripple, logo and progress on
test('no frame state holds an overlay node: not the shot, not the outgoing shot, not a smear layer', () => {
  for (let i = 0; i <= built.frameCount; i++) assert.deepEqual(overlayIdsIn(built.frameAt(i / fps)), [], `frame ${i}`);
});
test('overlayAt gives the logo and the bar at every film second, and nothing for a film without overlays', () => {
  assert.deepEqual(built.overlayAt(1).map((n) => n.id), ['overlay.logo', 'overlay.progress.track', 'overlay.progress.bar']);
  assert.deepEqual(plain.overlayAt(1), []);
});
// overlays-browser.test.mjs [browser], one page, grain 0 through __setPost; flat shots; a 16x16 one-colour logo PNG (test/v2/helpers/png.mjs)
test('the bar is unbroken across a node cut, a layer cut and a shader cut', async (t) => {
  for (const frame of [BEFORE, MID_SLIDE, MID_CROSSFADE, MID_RIPPLE, AFTER]) {
    const edge = await barEdge(page, frame);             // the x where the bar's row stops being the bar colour
    const [x, , w] = (await page.evaluate((i) => window.__snapshotOverlays(i), frame)).find((n) => n.id === 'overlay.progress.track').bbox;
    assert.ok(Math.abs(edge - (x + (frame / fps / duration) * w)) <= 2, `frame ${frame}: ${edge}`); // the bar sits inside the look's composition rect
    assert.deepEqual(await pixel(page, frame, LOGO_CENTRE), LOGO_COLOUR, `logo at frame ${frame}`);
  }
});
test('the stillness key ignores the bar and the capture key does not', async (t) => {
  assert.ok((await page.evaluate(([a, b]) => window.__heldFlags(a, b, false), [STILL_FROM, STILL_TO])).every(Boolean));
  assert.ok((await page.evaluate(([a, b]) => window.__heldFlags(a, b, true), [STILL_FROM, STILL_TO])).every((held) => held === false));
});
test('the snapshot holds no overlay node; __snapshotOverlays holds three', async (t) => { /* ids */ });
test('a poster seek and the loop check draw no overlay', async (t) => { /* __seek(i, { overlays: false }): the bar row is the ground colour; a film with loop: true and a progress bar whose last shot equals its first has no loop finding */ });
test('a film without overlays makes no overlay canvas and keeps its frame hashes', async (t) => { /* window.__overlayCanvases === 0; the hash of frame 10 equals the same film's hash recorded in this test before the change */ });
test('the same frames under --workers 2 are the frames of one page', async (t) => { /* two sessions, same frame, same pixels */ });
```

- [ ] **Step 2: Run and see them fail** — `node --test "<MM>/test/v2/overlays.test.mjs"`; expected FAIL, `built.overlayAt is not a function`.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see them pass** — the Node file, then **[browser]**, one at a time: `node --test --test-concurrency=1 "<MM>/test/v2/overlays-browser.test.mjs"`, `"<MM>/test/v2/post-browser.test.mjs"`, `"<MM>/test/v2/cuts-browser.test.mjs"`, `"<MM>/test/v2/loop-browser.test.mjs"`, `"<MM>/test/v2/poster-browser.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w4): overlays drawn over every cut, before the post pass`.

### Task 7: The review and overlays

**[R2-12]** The new registry row sets `evidence` (`unmeasured` unless a table of ours is named) and, for a creative rule, `ask`; its `rules.md` row fills both cells. Without it W3's evidence test fails on this rule.

**Files:**
- Create: `engine/review/overlay.mjs`
- Modify: `scripts/v2/review.mjs:378-389` (`reviewFilm`), `engine/review/rules.mjs`, `references/rules.md`, `test/v2/review-rules.test.mjs` (40 rules; the scan's file list)
- Test: `test/v2/overlays.test.mjs`, `test/v2/overlays-browser.test.mjs`

**Interfaces:**
- Consumes: `__snapshotOverlays` (Task 6), the frame review's measured texts (export `landedTexts(sampled, ctx): { id, ink, role }[]` from `engine/review/frame.mjs`, over `visibleTexts`, `frame.mjs:231-245`), `OVERLAP_UNITS` (`frame.mjs:62`).
- Produces:
  - Every existing rule skips overlays because no snapshot holds one (Task 6). This task proves it and adds the one thing a viewer would see.
  - `overlayCoverFindings(texts, overlays, ctx): finding[]`: a landed text whose ink meets the logo's box by more than `OVERLAP_UNITS` both ways. `{ kind: 'creative', rule: 'overlay-covers', node: '<text id>|overlay.logo', path: 'overlays.logo', message: 'text "<id>" in shot "<shot>" runs under the logo; move the logo to another corner (overlays.logo.corner) or shorten the text' }`. The progress bar sits on the frame's edge outside the safe area and is not judged.
  - Registry row `overlay-covers`: `kinds: ['creative']`, `stage: 'frame'`, `capped: true`, `suggest: null`. One finding per shot through `dedupeFindings`, then W3's cap: its id is appended to `CAPPED_HERE` (`engine/review/outline.mjs`).

- [ ] **Step 1: Write the failing test**

```js
test('a landed text under the logo is one creative finding at overlays.logo', () => {
  const [f] = overlayCoverFindings([{ id: 'hero', ink: [1600, 40, 300, 120], role: 'hero' }], [{ id: 'overlay.logo', bbox: [1700, 60, 160, 60], props: { overlay: 'logo' } }], CTX);
  assert.equal(f.rule, 'overlay-covers'); assert.equal(f.path, 'overlays.logo'); assert.equal(f.kind, 'creative');
});
test('a text clear of the logo, and a text over the progress bar, are not findings', () => { /* two cases, [] each */ });
// [browser]
test('a film has the same findings with and without its overlays, when no text meets the logo', async (t) => {
  assert.deepEqual(await findingsOf(FILM_WITH_OVERLAYS), await findingsOf(FILM_WITHOUT));
});
test('a still shot under a moving progress bar still raises still', async (t) => { /* an 8 s still shot (FILMS.stillLong of make.test.mjs:36) with progress: true: one finding with rule 'still' */ });
```

- [ ] **Step 2: Run and see it fail** — `node --test "<MM>/test/v2/overlays.test.mjs"`; expected FAIL, `overlayCoverFindings is not a function`.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run and see it pass** — the Node file and `review-rules.test.mjs`, then **[browser]** `node --test --test-concurrency=1 "<MM>/test/v2/overlays-browser.test.mjs"` and `"<MM>/test/v2/review-browser.test.mjs"`; expected PASS.
- [ ] **Step 5: Commit** `feat(w4): the review leaves overlays alone and says when a text runs under the logo`.

### Task 8: Wave gate

- [ ] **Step 1: One strip, viewed [browser].** Write a film in `.scratch/w4-overlays/` (`desk`, three shots, a `slide`, a `crossfade`, a `ripple`, a small logo PNG beside it, `progress: true`) and run `node <MM>/scripts/make.mjs <film> --sheets-only --json --out <scratch>/overlays.mp4`. Open every cut strip at full size and write one sentence per strip on what the logo and the bar do across the window. Then the same film in `pop` at 9:16 for the safe zone. A break, a flicker or a bar that jumps is a finding to fix before the gate.
- [ ] **Step 2: The capture cost, measured.** Render that film with and without `progress: true`, once each, with no other browser live; put `captured`, `frames` and `msPerFrame` of both in the task report with the commands. A progress bar makes every frame a fresh capture; `references/schema.md`'s Overlays section says so in one sentence with the measured ratio.
- [ ] **Step 2b:** The flag pins. `--subtitle-words` and `--no-music` change `FLAGS` and the usage line (`scripts/v2/cli.mjs:8-9`), and `overlays` changes the root fields. Search `test/help.test.mjs`, `test/cli-contract.test.mjs`, `P/eval/test/make-contract.test.mjs` and `P/eval/test/docs-facts.test.mjs` for what pins them and update it in the commit that added each.
- [ ] **Step 3:** Append the wave's credit sentence to `THIRD_PARTY_NOTICES.md` (Global Constraints), then run what CI runs for this area, one command per call: `node <P>/bin/sync-shared.mjs --check`; `node --test "<P>/bin/test/*.test.mjs"`; `python3 -m pytest tests/pytest`; the Node-only files this wave touched and `cuts-notices.test.mjs`; then **[browser]**, one at a time, the browser files named in Tasks 2, 4, 6 and 7, and `make.test.mjs`, `workers-browser.test.mjs`, `captions-browser.test.mjs`.
- [ ] **Step 4:** Fresh-context review (reviewer tier, medium), report only, never writing session logs or project docs, given the wave's diff, this plan's Review Focus and the security lens (a new file path from the film, `overlays.logo.src`, reaches the server's asset list). Its prompt carries this sentence verbatim: "Report every issue you find, including ones you are uncertain about or consider low-severity. Do not filter for importance or confidence at this stage — a separate verification step will do that. Your goal here is coverage: it is better to surface a finding that later gets filtered out than to silently drop a real bug. For each finding, include your confidence level and an estimated severity so a downstream filter can rank them."
- [ ] **Step 5:** The controller fixes every CRITICAL and HIGH with a test that failed first (`fix(w4):`), then pushes the wave's commits.
- [ ] **Step 6:** For the final phase, record: flags `--subtitle-words` and `--no-music`; the `overlays` root field; rules `poster-read` and `overlay-covers`; the audio of films that repeat a cue changes (the gallery rebuild re-renders them); on the manual checklist: listen to one film with three whooshes, and watch one film with a logo and a bar at full speed.

## Self-review notes

- Spec coverage: P8 (Tasks 1, 2; the intake line that recommends captions in `viral` is W1's), P12 (Tasks 3, 4, 4b), P10 (Tasks 5 to 7).
- Decisions the owner should check: word subtitles are a flag beside `--subtitles`, not a third format; the thumbnail is 180 px on its short side with a 14 px floor; variants detune by 30 cents; `marker` refuses the progress bar; the poster and the loop check never draw overlays; overlays have no `from`/`to` (they run the whole film).
