# how-it-works: director's notes (draft 5)

Film: `how-it-works.json` (pro, `desk`, 16:9, voiced `af_heart`, `drift` bed at 90, `"sound": "on"`, `"captions": true`, seed 7). It shows how make-motion works: a cheap model makes a film from a spec, the review reads it back, everything runs on your machine. Nobody has listened to this film.

Measured (draft 5, `make.mjs --json`, no `SOURCE_DATE_EPOCH`): `ok` true; 2641 frames at 30 fps = 88.03 s (band 60 to 90 s); `captured` 2641; `msPerFrame` 94.80; `bytes` 53,574,082; `timed` measured; `voice.seconds` 85.414 (voice `af_heart`, model commit `dd4401a9`, cached from draft 4: same text); `audio.lufs` -16, `audio.truePeakDb` -4.4; 25 cues; bed `drift`, fitted 90.6 bpm, 6 cuts landed on a beat of 14. Findings: 0 mechanical, 2 creative (both answered below). The final render (`SOURCE_DATE_EPOCH=1795305600`) matched draft 5: 2641 frames, 0 mechanical, the same 2 creative findings; the gallery copy is re-encoded at CRF 28 (17.9 MB) to stay under the repo's 30 MiB film limit. Draft 4 (a four-node `cycle` diagram for the `director` shot) drew its nodes on top of each other and was dropped; its numbers are not the film's.

Sheets looked at: draft 1 (all 30 PNGs: 15 shot sheets and 15 cut strips); draft 2 (`sheet.png`, `vertical.png`, `cut-looks-vertical.png`, `cut-vertical-private.png`); draft 3 (the edited shots `private.png` and `engines.png`, and the strips `cut-vertical-private`, `cut-private-engines`, `cut-engines-licence`, `cut-frame-sheet` and `cut-sheet-finding`, plus an `--shot engines` slice sheet before the render); draft 4 (`director.png`, `finding.png`, `private.png`); draft 5 (`director.png`; `finding.png` and `private.png` are the draft 4 sheets, which hold for draft 5: the two films differ only in the `director` shot and both run 2641 frames). The other sheets were not reopened (their pictures did not change since draft 1 or 2). The shot times in the list below are draft 3's: from `spec` on, every shot starts about 2.7 s later in draft 5 because the `director` line grew from 5.2 s to 7.9 s.

`--phonemes` was run on the draft 3 text: no word needed a respelling (`ffmpeg` is read eff-eff-em-peg, `MIT` em-eye-tee, `JSON` jay-son).

## Each shot, as a stranger sees it

1. `hook` (0 to 2.9 s): "A cheap model makes a film from a spec." in large serif on paper, "cheap" highlighted yellow. Picture alone: states the premise.
2. `director` (2.9 to 10.8 s in draft 5): a taped slug "02 A handoff, and back" at the top right and a numbered list of three steps building one at a time, earlier steps dimmed: "1 The director writes a small spec", "2 A cheaper operator, Haiku, runs one command", "3 The report goes back to the director". No "vs" and no pair of boxes: the two agents are one handoff (the director writes the spec, the operator runs the command, the report returns to the director, who decides every creative finding). Until draft 3 the shot was a `compare` of two cards joined by a hand-drawn "vs".
3. `spec` (8.1 to 12.9 s): a printout "look-cosmos.json, an excerpt", nine lines of JSON typed on, the `value` line highlighted yellow; caption "A figure, and its label."
4. `frame` (12.9 to 15.3 s): a pinned print of the real frame that spec draws: a large "149.6 million" on a navy sky with a sun; caption "And this is the frame it draws."
5. `sheet` (15.3 to 21.3 s): a print of a real review sheet (six tiles of that same shot), then a push in on one tile inside a yellow box; two notes at the bottom ("That shot's review sheet" and the narration).
6. `finding` (21.3 to 28.6 s): a printout, a typed command `node make.mjs film.json --outline`, then the real output: "invalid", "mechanical: shots[0].colour: unknown property; allowed: id, show, say, hold, cut, narration, on, text, kicker, hero".
7. `speed` (28.6 to 36.5 s): four lines of large type building one at a time, earlier lines dimmed: "One command", "Held frames are reused", "--shot or --range: a part alone", "--inspect: one frame".
8. `pipeline` (36.5 to 45.1 s): a large title "What the command does" and a row of five taped notes joined by arrows: Spec, Validate, Browser, Sheets, ffmpeg.
9. `features` (45.1 to 50.1 s): a printout "how-it-works.json, its first lines": the `voice`, `music`, `sound` and `captions` lines, the `voice` line highlighted.
10. `looks` (50.1 to 52.5 s): a print of one real `--compare-looks` run, the same closing shot in six looks (desk, cosmos, ledger, poster, keynote, marker), two black cells empty; caption "One shot, six looks".
11. `vertical` (52.5 to 56.3 s): a phone frame holding a real vertical poster frame, "Write the script. Get the film."
12. `private` (56.3 to 65.3 s): four lines of type, "your machine" highlighted: "It runs on your machine. At render time, only the voice model is downloaded, once. It is MIT, so what it makes is yours."
13. `engines` (65.3 to 74.7 s): two cards, "Open code" (HyperFrames: HTML files, Remotion: React code) against "make-motion" (A closed JSON spec, A fixed schema).
14. `licence` (74.7 to 80.4 s): four lines of type, "MIT, with no seat or revenue limit, unlike Remotion's company licence."
15. `close` (80.4 to 85.3 s): "A cheap model. Your machine." in large serif, "INSTALL IT IN CLAUDE CODE" under it, a taped tag "PORTABLE-ARTIFACTS".

## What the film says, and the fact-sheet row behind each line

Rows are those of `.scratch/motion-steals-final/how-it-works-facts.md` (make-motion table, rows 1 to 20; the comparison lines 1 and 2 are the two sourced lines above that table).

| Shot | Spoken | Row |
|---|---|---|
| hook | "A cheap model makes a film from a spec." | 3 (qualitative only), 2 |
| director | "The director writes a small spec. A cheaper operator, Haiku, runs one command. The report goes back to the director." | 1, 2, 3, 9 |
| spec | "One shot is a few lines of JSON. A figure, and its label." | 5 |
| frame | "And this is the frame it draws." | 5 (a real `--poster` of that shot) |
| sheet | "The review then measures size, safe area and contrast, a frame every quarter second." | 7, 8 |
| finding | "A mechanical finding names its path. The cheap model fixes only that. The director opens every sheet." | 9, 1, 10, 4 |
| speed | "One command. Held frames are captured once. Redraw one shot, or a range. Or inspect one frame." | 6, 11, 12 |
| pipeline | "The spec is validated. A local browser draws and reviews it, and writes the sheets. Then ffmpeg encodes the video." | 13, 14 |
| features | "The voice is made here, with Kokoro. Add a bed, cues and captions." | 15, 16 |
| looks | "The same shot, in six looks." | 17 |
| vertical | "And vertical shorts, for Reels, TikTok and Shorts." | 18 |
| private | "It runs on your machine. At render time, only the voice model is downloaded, once. It is MIT, so what it makes is yours." | 14, 15, 19, 20 |
| engines | "HyperFrames takes HTML, Remotion takes React: open code an agent can break. make-motion takes a closed JSON spec." | comparison lines 1; row 4 |
| licence | "MIT, with no seat or revenue limit, unlike Remotion's company licence." | comparison line 2; row 20 |
| close | "A cheap model, a small spec, your machine. Install it in Claude Code." | 3, 14, 20 |

The sentence in the sourced comparison line, "with a fixed schema", is on screen as the card point "A fixed schema" rather than spoken, to keep the shot under 10 s.

## Real captures in the film (never mock-ups)

All in `how-it-works-assets/`, each made with the repo's own tools on 2026-11-22 from a copy of a shipped example film kept in the run's scratch folder (the shots used, `distance` and `close` of `look-cosmos.json` and `hook` of `gate-poster-tall.json`, are unchanged; another lane added a shot `vast` to `look-cosmos.json` after the captures):

- `cosmos-distance.png`: `make.mjs look-cosmos.json --poster distance@end --poster-out ...` (1920 x 1080).
- `cosmos-distance-sheet.png`: the `distance.png` sheet of `make.mjs look-cosmos.json --sheets-only --out <scratch>/cosmos/look-cosmos.mp4`, copied (2398 x 1143).
- `looks-six.png`: `make.mjs look-cosmos.json --compare-looks close`, copied from `out/look-cosmos.looks.png` (1920 x 540).
- `poster-tall-hook.png`: `make.mjs gate-poster-tall.json --poster hook@end --poster-out ...` (1080 x 1920).
- The `finding` output is the printed text of `make.mjs bad2.json --outline`, a one-shot desk film with an added `"colour"` field (see `.scratch/motion-steals-final/how-it-works/real-outputs.md`). Its second line is wrapped at 50 characters by hand, because the `desk` look holds 50 characters a line; the words and their order are the printed ones.

The `spec` excerpt is `look-cosmos.json` lines 17 to 23, with the `say` cut short and marked "…". The `features` excerpt is `how-it-works.json` lines 7 to 10.

## Ranked notes

1. P1 · 52.5 to 56.3 s · `vertical` · the creative finding "a screen that only sits there is a still" (rule `kind`, path `shots[10].zoom`) · answered, not changed: the shot's point is the whole phone with a vertical picture in it. A first build zoomed to the poster's headline; it filled the frame with a blue rectangle and lost the phone, so the zoom was removed in draft 2 · what stays: the whole phone, 3.8 s.
2. P2 · 50.1 to 52.5 s · `looks` · the capture has two black cells (the tool lays six looks in a 4 x 2 grid) and its card is small on the desk; the review raised no dead-space or scale finding · not changed: cropping would alter a real capture · what stays.
3. P2 · 36.5 to 45.1 s · `pipeline` · the five notes sit in a thin row under a title about three times their height · not changed: the `diagram` kind fixes the row layout; the picture still reads in the 36.57 to 45.1 s sheet tiles · what stays.
4. P2 · 15.3 to 21.3 s · `sheet` · two notes (the card caption and the narration caption) sit side by side over the lower part of the enlarged sheet; neither covers the boxed tile, and the report printed no caption finding · what stays.
5. P2 · all shots · captions are on, and the `desk` look draws each narration as a taped note on shots whose kind shows no words of its own (`code`, `clipping`, `screen`, `diagram`); on the `spec` and `finding` shots the note repeats words the narrator says, as designed · what stays.
6. P2 · 28.6 to 36.5 s · `speed` · the line "Held frames are reused" shows a mechanism, but this film's own render captured every frame (2525 of 2525, the `desk` look moves on every frame), so nothing on screen proves it; the claim stays in words, with no count, and rests on `render.mjs:160-181` and the measurement in `schema.md:113` · what stays.

7. P2 · the `director` shot (draft 3 times: 2.9 to 8.1 s) · the `dead-space` finding, top 41% empty at its last moment · answered, not changed: see the next section · what stays: three steps, 7.9 s.

## Creative findings left in the report, and the decision

Two. `vertical` `shots[10].zoom` (note 1 above), and `director` `shots[1]` rule `dead-space` ("the frame leaves 41% of its height empty (the top)", at 10.80 s, after the third step has arrived): answered, not changed. The `list` kind sets its steps low on the desk page with the slug card in the top corner, and the three steps hold the lower half; the picture reads at every tile of the sheet. A fourth step or a larger title would pad the handoff, which has three parts. The first build of the `director` shot (a four-node `cycle` diagram) was dropped for a worse fault, nodes drawn on top of each other. Also from the first build of the film: the `vertical` finding, and `sheet` `on[0]` and `vertical` `zoom`. The first build also had `sheet` `on[0]` ("word:contrast" 0.06 s too early for the whole picture to show first) and `vertical` `zoom` ("the picture is 1080 px wide, so the zoom stops at its own resolution"). The first was fixed by moving "contrast" later in the sentence; the second went away with the zoom.

## Corrections made while checking the facts (fact sheet rows 8, 13 and 19)

- The brief said the review "reads every frame". The code audits the sheet frames, each `on` landing, each shot's first and last frame and one frame every 0.25 s (`scripts/v2/plan.mjs:194-208`), so the narration says "a frame every quarter second".
- The brief's pipeline chain was "validate, render, ffmpeg, review, sheets". The code runs validate, voice, timeline, sound, review (sheets and audit), render (`scripts/v2/run.mjs:1-3`, `:146`, `:155`), so the diagram draws Spec, Validate, Browser, Sheets, ffmpeg.
- "Offline" is worded as `README.md:130` words it ("nothing downloads at render time except the voice model, once"; the film says "At render time, only the voice model is downloaded, once"); the cutout model (MODNet, `SKILL.md:122`) is a second download only when a film asks for a cutout.
- The `engines` left card now names the engine on each point ("HyperFrames: HTML files", "Remotion: React code") under the title "Open code", so with the sound off the card does not blur which engine takes which.

## Not checked

The sound (no agent can listen: voice level against the bed, the cue level, how Kokoro reads "ffmpeg", "Kokoro", "MIT", "TikTok" and "Haiku" are for a listening pass; `--phonemes` printed the readings above, which is the text the voice is given, not what it sounds like; it was run on the draft 3 text, not on the new `director` line, which adds only "operator" and "report"); text inside a picture or a clip (the size and contrast rules measure the film's own type, not pixels inside the four captured images); motion between the frames the sheets sample; taste. Not reopened after draft 1 or 2: the sheets named at the top as not reopened.
