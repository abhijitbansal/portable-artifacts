# showreel-viral: director's notes (F1b, the showreel shows what is new in the vertical film)

Film: `showreel-viral.json` (viral, `pop`, 9:16, voiced `af_heart`, `pulse` bed at 124, seven own `cues` (one `whoosh` per cut, on `sentence:<n>`; 2.3.1: the designed cues played 14, nine of them a whoosh), `"captions": true`, overlay: progress bar). Rewritten on 2026-11-22 from the 2026-11-18 film (revision round 3). Draft build (no `SOURCE_DATE_EPOCH`) with `make.mjs --json --subtitles vtt --subtitle-words`; all 8 shot sheets and 7 cut strips of the final build were opened. Nobody has listened to this film.

## Each shot, as a stranger sees it

1. `hook` (0 to about 4.3 s): the lime tag "PORTABLE-ARTIFACTS" over five heavy lines "ONE JSON / FILE. / FIVE / KINDS OF / ARTIFACT."; the tag and "ONE JSON FILE." are fully drawn on frame 0, the rest lights as it is said, FIVE in acid green. Unchanged.
2. `spec` (about 4.3 to 7.2 s): a dark code panel "SALES.JSON" with five lines typed on, the `query` line lime; the words "YOU WRITE" arrive under it as a caption (captions are on). Arrives by a punch.
3. `dashboard` (about 7.2 to 9.2 s): the "East earns the most revenue" chart with its Query open, a card cut out on the dark field, caption "DASHBOARD", a glint across the card on "query". Slide.
4. `diagram` (about 9.2 to 11.1 s): the same device: the Web app, the AWS region and VPC holding Checkout API and Orders DB, caption "DIAGRAM". Cover up.
5. `explainer` (about 11.1 to 13.6 s): a `screen` shot in a phone frame holding the explainer page's own header and verdict, captions "EXPLAINERS, WITH DIAGRAMS INSIDE." arriving word by word under it; at the end the camera goes to the verdict, the rest dimmed. It replaces the old cut-out card (a plain cut arrives at it) so the five pictures are not one run of `media`.
6. `scene` (about 13.6 to 16.7 s): the 3D block city card with its tooltip, caption "SCENE", a glint on "explore". It opens by a zoom from the verdict of the phone shot (`zoom` with `at` `region:verdict`). The narration now asks and answers: "Want 3D? A scene you can explore."
7. `video` (about 16.7 to 19.4 s): the same device around a real make-motion frame, letterboxed, caption "VIDEO". Wipe left.
8. `close` (about 19.4 to 23.8 s): "OPEN SOURCE. / INSTALL / IT IN / CLAUDE CODE." then the lime plate "PORTABLE-ARTIFACTS". It opens by a lime flood from the video card (`flood` at `picture`).

A lime progress line runs along the top of the platform safe zone from the first frame to the last, unbroken across every cut.

## What the film says

Same claims as the 2026-11-18 film, no new ones. The one new line is the question in `scene` ("Want 3D?"), which gives the short its mid-film question and answer (`references/types/vertical.md`). "And video. This one is one file." is true by construction.

## What changed, and why

| Change | Reason |
|---|---|
| `explainer`: a phone-framed `screen` shot instead of a `media` card | breaks the run of five `media` shots (the outline rule `sameness` fired on it) and shows the `screen` kind in pop; the picture is the same capture, its region `verdict` set by hand |
| Cuts: zoom at the verdict (into `scene`), flood at the picture (into `close`) | `at` on zoom and the colour flood, as pop draws them. punch (into `spec`), slide, cover up, plain cut and wipe left stay, each at least once |
| `"captions": true` | a short is watched with the sound off (`vertical.md`); the captions sit on the shots that do not show their own words (`spec`, `explainer`) |
| `overlays.progress` | W4 progress bar inside the safe zone. No logo here: a logo met text in every corner tried in the pop band (top-right over the hook tag; bottom-left and bottom-right over the hook's third line and the `scene` and `video` captions: each one an `overlay-covers` finding), so the logo is shown in the pro reel only |
| `--subtitles vtt --subtitle-words` on the draft run | word-level subtitles: one cue per word in `draft/showreel-viral.vtt`. A file beside the MP4, not part of the picture. The gallery build must pass the same two flags and ship the VTT |

## Ranked notes

1. `explainer` to `scene`: the zoom opens about the verdict of the phone shot; the strip shows the phone dimmed and the next card growing in, so the cut reads as a zoom through the screen and not as a hard swap.
2. 16.7 to 19.4 s, `video`: the real frame is letterboxed in a near-square card and carries its own "04 IN NUMBERS" tape (unchanged from the last round); the frame is shown as made.
3. 7.2 to 16.7 s: the pictures are about 70 percent of the frame width (the platform's safe band); the diagram and explainer labels are small at phone size. What stays.
4. `close`: the install command is not on screen (the page carries the copyable command); the reveal is the hook's.
5. The progress line sits in the first pixels of the pop band on 9:16 (the schema says it cannot be kept off a banded look's band); no text reaches it in this film.

## Creative findings left in the report, and the decision

None: the final draft report has 0 findings. Two earlier drafts carried `overlay-covers` findings for the logo (see the table above) and one `kind` finding (a phone frame has no title row, so the `title` on `explainer` was not drawn); the logo was dropped from this film and the title removed.

## Measurements (copied from the final draft's `make.mjs --json`; nothing else)

- `ok`: true; findings: 0.
- `frames`: 713 (23.77 s at 30 fps; the 2026-11-18 film was 22.73 s, +4.6 percent; the mode's own limit is 60 s); `captured`: 713 (the progress bar makes every frame a fresh capture); render `seconds`: 44.8; `msPerFrame`: 62.8; `bytes`: 10,697,805; `mbps`: 3.60. `timed`: measured, voice `af_heart` (model commit `dd4401a9`).
- `audio.lufs`: -14.1; `audio.truePeakDb`: -3.5; cues: 7 (2.3.1 rebuild, one whoosh per cut; the 2.3.0 build planned 14). Bed `pulse`, fitted 122.95 bpm (asked 124), 5 of 7 cuts landed on a beat.
- `subtitles`: `{ format: "vtt", level: "word", timed: "measured" }`.

## Sync

There is no per-film sync check other than `timed: "measured"` and the figures above. Nobody has listened to this audio: voice level against the bed, the cue takes and the respelled word "query" (`[query](/kwˈɪɹi/)`) are for the owner's listening pass.
