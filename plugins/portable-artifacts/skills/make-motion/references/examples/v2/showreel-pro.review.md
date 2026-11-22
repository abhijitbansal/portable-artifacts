# showreel-pro: director's notes (F1b, the showreel shows every W1 to W6 feature)

Film: `showreel-pro.json` (pro, `desk`, 16:9, voiced `af_heart`, `drift` bed at 92, `"sound": "on"`, overlays: logo and progress bar). Rewritten on 2026-11-22 from the 2026-11-18 film (revision round 2) so the reel shows what make-motion gained in 2.3.0 and keeps what it showed. Draft build (not the gallery build: no `SOURCE_DATE_EPOCH`) with `make.mjs --json`; every sheet and strip was opened, as listed under "What was opened". Nobody has listened to this film.

## Each shot, as a stranger sees it

1. `problem` (0 to about 3.5 s): the dashboard in a window on the desk titled "Where did this number come from?", then a close-up of the "Total revenue $18,393" tile and a red hand-drawn line under the figure. The shot ends 1.0 s early on purpose (`narration.trail`, an L cut): the last words, "come from?", are heard over the dashboard that answers them.
2. `dashboard` (about 3.5 to 10.8 s): a print of the "East earns the most revenue" chart with its Query disclosure open, a push in to the SELECT text inside a yellow box, caption "Every chart shows its query", slug "01 DASHBOARD". It arrives by a slide up.
3. `idea` (about 10.8 to 15.9 s): a pinned printout "sales.json" typed on, the `query` line highlighted. Its narration starts 0.5 s before its picture (`narration.lead`, a J cut) over the end of the dashboard, so "That page is..." is said while the page is still up; the crossfade strip shows the typed file arriving.
4. `diagram` (about 15.9 to 20 s): the whole diagram on a card, then a push to Checkout API and Orders DB; slug "02 DIAGRAM". Arrives by a wipe right.
5. `explainer` (about 20 to 25.2 s): a print of the "Build path" section with a push to the figure; slug "03 EXPLAINER". Slide left.
6. `path` (about 25.2 to 28.5 s): a short row of three paper notes, "A spec", "One command", "A finished file". It is a `diagram` shot, added so the five pictures are not one run of `clipping`. It opens by an iris from the highlighted figure of the explainer (`cut` `iris` with `at` `region:figure`), and its narration trails 0.9 s into the next picture.
7. `scene` (about 28.5 to 33.3 s): the 3D block city print with its hover tooltip, a push to the tallest tower; slug "04 3D SCENE". Wipe up.
8. `video` (about 33.3 to 36.2 s): a real make-motion frame ("5 skills, one JSON file each", with its own "04 IN NUMBERS" tape), a yellow box on the frame; slug "05 VIDEO". It opens by a zoom from the tower (`at` `region:tower`) and ends by a flood.
9. `five` (about 36.2 to 38.3 s): "Five skills. One file each." in large serif on two lines, the line `lines` entrance (each line arrives as one block on its first word), "file" highlighted. It opens by the yellow flood from the video frame (`flood` at `region:five`); its narration trails 1.0 s. Six words or fewer, so the desk look sets it on two lines at about a quarter of the frame height each.
10. `proof` (about 38.3 to 44 s): "10 of 10" counting up, "films built valid", "CLAUDE CODE, 18 NOV 2026", a red line under the figure. It arrives by a page curl (a shader cut).
11. `close` (about 44 to 49.1 s): "Open source. On your machine." in large serif, "INSTALL IT IN CLAUDE CODE", a taped tag "PORTABLE-ARTIFACTS". It arrives by a fade.

Over every shot and every cut: a small brown tile top-right (the logo, `showreel-assets/logo.png`, a copy of `docs/apple-touch-icon.png`) and a red progress line on the bottom edge, unbroken across the slide, wipe, iris, zoom, flood, page curl and fade.

## What the film says

Same claims as the 2026-11-18 film; nothing new is claimed. New lines: "Every one starts as a spec, and one command builds the file." (the `path` shot; the `desk` pictures of the five skills are specs, true by construction of this repository) and "Five skills. One file each." (moved from the `video` shot to its own shot). "A dashboard. Every chart shows its query, and when it refreshed." now follows the question it answers ("Where did it come from?") instead of the JSON file. `video` says "And video, like this film." The "10 of 10" figure and its wording are unchanged: Claude Code, 18 Nov 2026, no rate and no cost.

## What changed, and why

| Change | Reason |
|---|---|
| Order: problem, dashboard, idea, diagram, explainer, path, scene, video, five, proof, close (was problem, idea, dashboard, ...) | breaks the run of five `clipping` shots (the outline rule `sameness` fired on it); the dashboard now answers the opening question and "That page" refers to it |
| New `path` diagram shot and new `five` statement | the first separates the five pictures; the second shows a short statement and the `lines` entrance. The slugs still number only the five skills (01 to 05): the statement is last among them |
| `narration` lead on `idea`, trails on `problem`, `path`, `five` | J and L cuts. A lead and a trail on one cut are refused, so no two share a cut |
| Cuts: iris at the figure, zoom at the tower, flood at the video frame | `at` on iris and zoom and the colour flood. wipe up, wipe right, slide up, slide left, crossfade, page-curl and fade stay, each at least once |
| `overlays`: logo and progress | W4 overlays, drawn over every cut |
| `proof`: pause removed, underline at `end-0.15` | the underline lands with the shot (the kind moves it earlier if it would not finish) |
| `video`: highlight at `end-0.2`, not at the word "film" | the review moved the mark itself: the cut into `video` leaves 0.6 s of picture before a push may begin |

## Ranked notes

1. Cuts `path`, `video`, `five`, `proof` and `close` (iris, zoom, flood, page-curl, fade): a layer or shader cut draws the outgoing shot under the cut, but the outgoing shots here are at rest when the cut begins (a kind finishes its marks inside the shot), so the strips show the old shot dimmed or covered and not a new movement. What moves under a cut is the desk camera's drift. The feature is in the engine (`cuts-live-pin.test.mjs`) and not clearly visible in this reel. Left as it is.
2. `five`: the second line is still arriving (grey, one block) at 37.27 s, and both lines are at rest from 37.47 s; the sheet frames land between the two, so the arrival is one frame of the sheet.
3. `video`: the real frame shows its own "04 IN NUMBERS" tape under the film's "05 VIDEO" slug (unchanged from the last round); cropping it would change a real capture. What stays.
4. `close`: the install command is not on screen; the page carries the copyable command. What stays.
5. The logo is the site's own icon (brown tile, 56 units high): small, top-right, over the slug column only at the very top. It never meets a text (no `overlay-covers` finding).

## Creative findings left in the report, and the decision

None: the final draft report has 0 findings (0 mechanical, 0 creative). The first draft had one creative `kind` finding (the `video` push began too soon after the zoom cut), fixed by anchoring the mark at the end of the shot.

## Measurements (copied from the final draft's `make.mjs --json`; nothing else)

- `ok`: true; findings: 0.
- `frames`: 1473 (49.10 s at 30 fps; the 2026-11-18 film was 46.77 s, +5.0 percent); `captured`: 1473 (the progress bar makes every frame a fresh capture); render `seconds`: 154.2; `msPerFrame`: 104.7; `bytes`: 28,041,972; `mbps`: 4.57. `timed`: measured, voice `af_heart` (model commit `dd4401a9`).
- `audio.lufs`: -16.1; `audio.truePeakDb`: -4.4; cues: 16. Bed `drift`, fitted 91.46 bpm (asked 92), 6 of 10 cuts landed on a beat.

## What was opened

All 11 shot sheets and 10 cut strips of the draft build made before the last four edits; after them `dashboard`, `idea`, `cut-dashboard-idea`, `path`, `cut-path-scene`, `proof`, `cut-proof-close` from the final build and `five`, `cut-five-proof` from a sheets-only run of the same film file. The sheets of the other shots of the final build were not re-opened (the edits moved times by up to 0.9 s and changed no picture). Nobody has listened to this audio: voice level against the bed, the cue takes (three takes of a repeated cue are in the engine, not heard here) and the respelled words "query" and "of" are for the owner's listening pass.
