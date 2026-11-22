# Design: make-motion and beast_explainer, what we take from HyperFrames, Rune and the other video tools

Date 2026-11-21. Status: draft for the owner's approval.

Evidence base (gitignored, kept locally): `.scratch/research-2026-11-21/` holds seven research reports, a brainstorm
of 25 ideas, five adversarial verifier notes, `PROPOSAL.md` (the ranked steal-list this design is built from),
`beast-src.md` (a code read of beast_explainer) and `compose.md` (a composition and scale measurement of every gallery
film). Item numbers below ("P2", "P5") point to `PROPOSAL.md` section 2A.

## 1. Intent

The owner wants make-motion's films and the beast_explainer YouTube episodes to look and teach as well as possible.
The research looked at HyperFrames (HeyGen, Apache-2.0), the `ai-video-generation` skill, Rune (MIT) and other
programmatic video engines and agent video skills, to find ideas worth taking.

The research's verdict: keep our engine. HyperFrames is better than us at how it tells an agent to plan, check and
review a film, and Rune at motion QA and encode hygiene. Neither engine is worth adopting. We are already ahead on the
closed JSON spec (a frame is a pure function of its index), measured text review, held-frame reuse, local voice with
word times, and a fully offline render.

## 2. Goals, non-goals, anti-goals

Goals

- Films stop reading as a row of slides: content fills and composes the frame, narration flows across cuts, and
  transitions join two shots that are both still moving.
- The agent plans better films: three storylines that are three different films, one idea taught through one worked
  example, per-look tells to avoid.
- The agent checks films faster and more precisely: findings carry the fix value, one shot or one moment can be
  rendered and inspected without a whole-film run.
- Colour is right on every player: BT.709 converted and tagged.
- beast_explainer gets the few changes its own code shows are worth making.

Non-goals

- No new render engine, no HTML-composition core, no GSAP, no shared render core between make-motion and beast.
- No generative video inside make-motion. Generated b-roll is guidance only (`references/broll.md`); `make.mjs` never
  calls a generator.
- No new network use, no new runtime dependency in make-motion.
- No code copied between beast_explainer (no licence) and the MIT plugin, in either direction. Ideas only.

Anti-goals (a failure even if it technically works)

- A film that passes every finding but still looks generated: findings that teach the agent to satisfy a number
  instead of composing a frame. Creative findings stay few and capped per film.
- Doctrine that bans our own looks (HyperFrames' global BANNED list bans `desk`, `cosmos` and `keynote` by
  description). Tells are written per look.
- A slower edit loop. Every wave keeps or improves the time from edit to a checked frame.

## 3. Constraints

- `MM/SKILL.md` is 20,898 bytes against a pinned 20,900-byte budget (measured with `wc -c`;
  `bin/test/skill-budget.test.mjs`). Any new rule moves text out to `references/` first. Owner default: slim, do not
  raise the cap.
- One headless browser at a time on this Mac. No new server route (the preview server is GET and HEAD only by design).
- Every PR under `plugins/` carries one `plugin.json` bump, one `CHANGELOG.md` heading and the cover Revision.
- Goldens change only for an intended visual change, stated in the commit. Owner decision: accepted for every wave
  below; the whole v2 gallery is rebuilt once, in the colour wave (W1), with `SOURCE_DATE_EPOCH` recorded in the PR
  body. Orchestrator's call, to satisfy AGENTS.md as well: each later visual wave (W2, W4, W6) rebuilds only the
  gallery pages its change affects, rechecks any affected home-page plate (spec excerpt, size label, tag positions),
  and records the `SOURCE_DATE_EPOCH` in its PR body. No later wave re-encodes the whole gallery.
- Every code fix and guardrail is shown failing first (RED), then passing.
- HyperFrames and Rune mechanisms are rewritten in our own words and code, with a credit line in
  `THIRD_PARTY_NOTICES.md`. No file is ported (default; `locate.mjs` is rewritten, not copied).

## 4. Approaches considered

| Approach | What it is | Trade-off | Outcome |
|---|---|---|---|
| A. Steal into our engine | Take doctrine, QA tooling and a few engine capabilities, one wave per PR | Keeps spec, looks, goldens, offline render; transitions and overlays stay our own work | **Picked** |
| B. Adopt an HTML-composition core | Compile `film.json` to a HyperFrames-shaped page or run on its engine | Live transitions and their tooling for free, but GSAP is not open source, and it discards spec validation, looks, measured typography and every golden; its fast capture paths do not fit macOS or the one-browser rule | Rejected |
| C. Unify the make-motion and beast render core | One engine and QA layer for both | Remotion cannot ship in an MIT plugin; beast forbids scene templates; beast grants no licence | Rejected |

Within A, three orders were offered: tools first (the proposal's), produced layer first, and a craft-first hybrid.
**The owner picked the craft-first hybrid:** doctrine and colour first, then visible composition and cut craft, then
the inspection tools, then the rest.

## 5. What the research corrected

- The frames that first suggested "small content in an empty frame" came from v1 films. 23 of the 31 gallery MP4s are
  v1 specs that v2 refuses (`MM/SKILL.md:74`) and that neither site page links (measured by grep, `compose.md`).
  v2 films fill more (median ink 18% against 11% for v1, threshold metric, ranking only), but still lay out one hero
  block per shot. Examples: `cosmos` leaves the lower 40% of a number shot bare (`number-sky.mjs:77`), the statement
  box is capped at 0.64 of height (`statement.mjs:37`), `depth` is set only on the field (`kinds/shared.mjs:257`), and
  the review has no spatial rule (`engine/review/frame.mjs:59-62`). Viewed by the orchestrator: the `looks/keynote`
  and `looks/cosmos` frame grids.
- BT.709: ffmpeg 8.1's `-color_primaries`/`-color_trc` output flags can write the matrix without a `colr` box on a
  partly tagged source. beast tags with a final `setparams` filter and measures bt709 on all three fields
  (`beast-src.md`, `beast_explainer/src/post/postpass.ts:63-69`). make-motion uses the same approach. Our gallery film
  `sql-guard-explainer` probes as fully untagged (measured with `ffprobe`).
- beast's biggest gap is not in the original steal-list: its QA findings carry prose only (`Finding.detail`, a
  string, `beast_explainer/src/qa/motion.ts:69`), while three rules' fix values are computable from its closed palette, its 28 px floor and its reading time.

## 6. The decided design: make-motion waves

Each wave is one branch (`feat/motion-steals-wN`) and one PR, merged before the next starts. Items name their
`PROPOSAL.md` number; surfaces, risks and file anchors are in that file and are not repeated here.

**W0, measurements (scratch only, no plugin change).** ffprobe tag table for the gallery and for one fast and one
`--exact` render; draw/capture/encode split per frame on one fixed film; audio offset of one muxed film with a
recorded music file; both capture spike arms (CDP `optimizeForSpeed` in JPEG mode, and bytes returned through
`page.evaluate`) against today's path on that same film, so any capture change that wins lands in W1 and rides the
single gallery rebuild (orchestrator's call); a per-frame `__snapshot` dump on three films for the motion-gate decision; a test that every frame
the capture key calls held is pixel-equal to its predecessor. Each result decides a later item, as listed in
`PROPOSAL.md` section 4. W0 runs at the start of W1 and its results go in the W1 PR body.

**W1, doctrine and colour.**
- Slim `SKILL.md` to a router; moved text goes to `references/`.
- Story doctrine (P1): one thing, claim discipline, three storylines as three films with the first two seconds
  written, type files (`references/types/{explainer,data,vertical}.md`), a per-look tells file, the five-line teaching
  check; only devices our 16 kinds and cuts can draw; 150/175 wpm kept; intake axes folded into the existing nine
  values.
- Review protocol delta (P7, prose only): P0/P1/P2 notes, never score, the pictures-alone question, delivery fields
  naming the weakest shot and what nobody checked. File: `references/reviewing.md`.
- `references/broll.md` (P18) and the viral captions intake line (P8, recommend, do not flip the default).
- BT.709 convert and tag (P2) in `MM/scripts/v2/render.mjs`, using a final `setparams` filter; matrix and range
  converted in one filter on the JPEG path. RED first on `MM/test/v2/make.test.mjs`, plus a flat-patch round trip
  within 2 levels in both capture modes.
- Step 0 of capture diagnostics (P17): draw, capture and encode split plus the stage name and console tail on a hang.
- Gallery rebuild, once, from source specs. v2 films only; the 23 orphaned v1 films are not touched (see section 9).

**W2, composition and cut craft.**
- Composition and scale (new, from `compose.md`): two creative findings computed from `__snapshot` boxes,
  `dead-space` (largest empty region against the safe area) and `scale-contrast` (hero against the next element), in
  `engine/review/frame.mjs` beside the hero rule, with optional per-look `fill` data; `cosmos` number recentred; short
  statements allowed more width and height. Thresholds are calibrated on the gallery in one browser run before they
  ship. Creative findings are capped per film.
- J and L cuts for narration (P5, first half): narration may lead or trail a cut, using `NARRATION_LEAD` and the
  separate `soundStart`/`soundEnd` hooks; caption timing and the cut-window rule follow. Orchestrator's call: it is an
  author choice, an optional per-shot field (lead and trail in seconds, bounded, default 0), so existing films and
  their goldens do not change and `word:` anchors stay put unless a spec asks for overlap. The story doctrine tells
  the agent when to use it. No look or mode sets it automatically in this wave.
- Live outgoing shot (P5, second half): a transition samples the outgoing shot moving, not frozen, for the cut
  families that can carry it; node-family cuts and the smear keep the frozen frame and say so.
- Cuts with a cause (P11): `at:` on iris and zoom (the origin node must exist or the cut errors by name), and a colour
  flood.

**W3, inspection tools.**
- Findings v2 (P3): one rule registry, a rules doc with a docs/code parity test, a `suggest` payload (nearest passing
  colour, minimum size, the cuts this look allows), and the `cut-variety` and `sameness` findings in `--outline`.
- Slices (P4): an anchor on `--poster`, `--inspect <time>` (PNG plus a JSON dump of boxes, effective text heights and
  off-frame flags), then `--shot` and `--range`. An unknown anchor exits 2 with the accepted list.
- Locate helper (P6): a pure-Node rewrite with its own digit bitmap (the doctor's ffmpeg has no `drawtext`), output
  converted to our `[x, y, w, h]` regions.

**W4, shorts, sound, overlays.** Word-level subtitles and a small-size poster read (P8); cue variants and `--no-music`,
with the beat audit only if W0 found an offset (P12); a logo and a progress overlay (P10).

**W5, evidence loop II.** A voice-skipping `--sheets-only` with stills in the existing plan page (P9); the preview keeps
its playhead through a reload (P14); a reviewer agent proven on planted-defect fixtures before it is trusted, optional
per film, with self-review as the fallback on hosts without sub-agents (P7); the motion gate only if W0 found defects
(P13).

**W6, type and look.** Per-glyph and per-line entrances, `cubic-bezier()` and `steps()` (P15); a look comparison sheet
and a local reference measure that reads only files the user supplies (P16); bounce and visible duration printed in
`--list moves` (P19).

**Alongside any wave, one small PR for make-explainer:** a review step that cites `shared/shot.mjs` screenshots at 390
and 1280 wide, and a section-sameness lint finding (`PROPOSAL.md` 2C items 1 and 3).

**Deferred, each with the trigger that reopens it:** in-shot motion blur, using beast's speed gate (one sample at rest,
N when fast) as the starting idea (a viewed strip shows strobing); a raw capture path (the W0 spike wins); layered
depth and bleed crops (`compose.md` W7 and W8, after W2's findings have been tuned); user fonts and a Lottie kind
(owner decisions, default no); CSS spring export for explainers.

## 7. The decided design: beast_explainer track

beast is its own repo with its own Phase G plan, and these items are additions to that plan. They ship as PRs in
beast's repo, not in the plugin waves. Orchestrator's call on scope: the plugin implementation plan does not contain
them. A separate addendum to beast's Phase G plan, written in beast's repo under its own conventions, carries items
1, 2, 4 and 7 now; items 5 and 6 wait on their gates (G4's scope proof, rule Q14) and item 3 is already in beast's
plan. Ranked from `beast-src.md`:

1. Fix values on QA findings: Q05 (nearest passing colour in the closed palette), Q07 (the 28 px floor), Q09 (reading
   time), as a structured field beside `Finding.detail`.
2. An optional `motion` field on generated-clip shots ("one slow subject motion, one named camera move or locked-off"),
   with the duration floor per model, in the storyboard schema, `storyboard.md`, `b2-assets.md` and clip-look C04.
3. The owed Sonnet chapter A/B, with cache reads priced per arm.
4. Carve the music bed above 150 Hz under narration with a static EQ (there is none today), not only a warning.
5. Q05 colour from the G4 DOM probe, after G4's scope proof.
6. J and L narration across cuts, only if the owner reverses rule Q14 (see section 9).
7. A locate step for match-cut anchors; one "ground it first" line in the script-writer prompt.

## 8. Left to the builder

File layout inside `references/`, the exact wording of doctrine and tells, finding names beyond those given, test
fixture design, threshold values (calibrated as stated), the order of items inside a wave, and how each wave's
measurements are scripted under `.scratch/`.

## 9. Open with the owner

- The 23 orphaned v1 gallery films: archive (delete) them, or leave them. Default: leave them; nothing links them.
- beast rule Q14 forbids narration across a cut. Reverse it for item 7.6? Default: keep Q14, item 6 parked.
- Kept defaults from the research: a pro film may open on its field (no opening rule); viral captions recommended, not
  defaulted on; no user fonts or Lottie; no paid beast trial without a quote and the owner's yes.
