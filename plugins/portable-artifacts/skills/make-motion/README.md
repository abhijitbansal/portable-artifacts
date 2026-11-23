# make-motion

**A script of shots, checked, previewed and rendered to an MP4.** Short animated explainers, drawn by one engine from a JSON film file, on your machine. Renders are offline, with one exception: the first voiced render fetches the pinned voice model once (93 MB, each file checked against a SHA-256). Any agent that can run shell commands can drive it.

- **One file, `film.json`.** A list of shots. Each shot shows one thing (a statement, a number, a chart, a map, code, a screenshot) over the sentences that narrate it. Nobody writes a position, a size or a keyframe.
- **One command.** `node scripts/make.mjs film.json` validates the film, builds its timeline, reviews every shot in a browser, writes review sheets and renders the MP4.
- **Seven looks, sixteen kinds.** A look is the whole style of the film. A kind is one idea on screen. `--list looks` and `--list kinds` print them.
- **Two modes.** `pro` is a calm 16:9 explainer. `viral` is a fast 9:16 short for Reels, TikTok and Shorts.
- **Audio is opt-in.** Narration, a music bed and sound cues are each off unless the film asks for them.
- **Targeted edits.** "Slow shot 2" or "change the number to 25" edits one field of `film.json` and the rest renders the same.

> Agents: the instructions you follow are in [`SKILL.md`](SKILL.md). This README is for people.

## Quick start

```bash
cd make-motion
npm ci --ignore-scripts
npx playwright install chromium
cd -
```

You also need ffmpeg on the `PATH` (`brew install ffmpeg` on macOS, `winget install Gyan.FFmpeg` on Windows, `sudo apt-get install ffmpeg` on Linux). `node make-motion/scripts/doctor.mjs` reports anything missing, with the fix for your system.

`<skill-dir>` is the real path of the make-motion folder. Write it out in each command: an agent's shell refuses variables, `&&`, `;` and pipes, so run one plain command per call.

```bash
node <skill-dir>/scripts/make.mjs <skill-dir>/references/examples/v2/gate-desk.json --outline
node <skill-dir>/scripts/make.mjs <skill-dir>/references/examples/v2/gate-desk.json --out out/gate-desk.mp4
```

The first command prints each shot with its start, end and narration, with no browser. The second writes `out/gate-desk.mp4` and the review sheets in `out/gate-desk.sheets/`, one PNG per shot and one strip per cut. A film of your own goes in your project folder as `film.json`, and `make.mjs film.json` writes `out/film.mp4` beside it. To see a film in a page with a scrubber, run `make.mjs film.json --preview --open`. It serves on `127.0.0.1` until you stop it, and when you edit the film it reloads and comes back to the same frame and the same play or pause state.

From an agent, ask: *"Make an 8-second film: Q3 revenue up 18%, then a bar chart of Q1 to Q3."* In Claude Code or Copilot you can call `/make-motion ...`, and in Codex `$make-motion ...`.

Before it writes the film, the agent runs one intake round: one message that lists the options with their defaults: mode, look, format, length, your pictures, a voiceover, a music bed, sound cues and a closing line. Answer once, or say "defaults". Run non-interactively (`claude -p`, `codex exec`, `copilot -p`), it skips the round, builds with the defaults and says so in its report.

To run this skill's tests one browser at a time, use `npm run test:serial`.

## The film

```json
{
  "version": 2,
  "mode": "pro",
  "look": "desk",
  "shots": [
    { "id": "hook", "show": "statement", "say": "Numbers need *sources*.", "kicker": "The problem" },
    { "id": "rows", "show": "number", "say": "Four hundred fifty nine rows. One file.", "value": 459, "suffix": "rows", "label": "in one file" },
    { "id": "query", "show": "clipping", "src": "dashboard.png", "say": "Every chart on this page shows its query.",
      "regions": { "query": [0.55, 0.2, 0.35, 0.2] },
      "on": [{ "at": "word:query", "do": "circle", "target": "region:query" }] }
  ]
}
```

`say` is the narration. A shot lasts as long as its narration takes at the mode's pace, plus a short tail. `*word*` marks emphasis. `on` places a device (a circle, a highlight, an arrow) on a word. `node scripts/make.mjs --list kinds` prints every kind with its fields and one example to copy. The root fields, the fields every shot takes, the report and the exit codes are in [`references/schema.md`](references/schema.md). How to write for the picture is in [`references/story.md`](references/story.md). Finished films to start from are in [`references/examples/v2/`](references/examples/v2/): `showreel-pro.json` (pro, `desk`, voiced, with a logo and a progress bar; it opens on a problem shot, then the dashboard), `showreel-viral.json` (viral, `pop`), `whats-new.json` (pro, `desk`, voiced, 113 s: every change in 2.0, with its `whats-new.review.md` and `whats-new-assets/`), `how-it-works.json` (pro, `desk`, voiced, 88 s: how a film is made, with its `how-it-works.review.md` and `how-it-works-assets/`), `look-cosmos.json` (`cosmos`), `gate-ledger.json` (`ledger`), `look-poster.json` (`poster`), `gate-keynote.json` (`keynote`), `gate-marker.json` (`marker`, the whiteboard look), `voiced-desk.json` (a voice), `sound-desk.json` (a music bed and cues), `kinds-b-desk.json` (a map and code) and `batch-welcome.json` (`vars`).

`overlays` puts a logo (`{ "logo": { "src": "assets/logo.png", "corner": "top-right" } }`) and a progress bar (`"progress": true`) over the film itself, so no cut moves or breaks them; see Overlays in [`references/schema.md`](references/schema.md). A designed cue that sounds more than once rotates through three takes (the first as it was, then a little higher and a little lower, each with its own noise), so a repeated whoosh is not stamped. `--no-music` renders a second delivery without the music track; the cuts stay where the music put them.

A shot's `narration` (`{ "lead", "trail" }`, 0 to 1.5 s) starts its voice before its picture or lets it run into the next shot, so a cut can land mid-sentence: the cut moves and the sound does not, and captions follow what is heard. A cut's `at` names a part of the shot it leaves (the names an `on` event's `target` takes) for `iris`, `zoom` and `flood` to open from, such as the button just clicked; `flood` paints a colour as a growing circle over the outgoing shot, then opens the next shot from the same point (`pop` and `poster`). A layer or shader cut keeps the outgoing shot moving, and a node cut holds its last frame; `--list cuts` says which each cut is. Every MP4 is converted to BT.709 and tagged `bt709`, limited range, on both capture paths. The render checks its own file before it keeps it: a file short of the timeline's frames or with a blank picture is an error and leaves no MP4, and a stage that gives no answer for 120 s stops the render and names the stage.

The review's findings each name the `rule` that raised them and, where a fix value can be computed, carry it as `suggest`. `dead-space`, `scale-contrast`, `cut-variety`, `sameness`, `overlay-covers` and `poster-read` are `creative`: they are calls for the director, they never fail a run, and a film keeps only the first few of each. [`references/rules.md`](references/rules.md) lists every rule and where its number comes from; [`references/calibration.md`](references/calibration.md) says how the four composition and outline thresholds were chosen.

## References

`SKILL.md` is a router; the detail is in `references/`:

| File | What it holds |
|---|---|
| [`schema.md`](references/schema.md) | Root fields, shot fields, cuts, sound, overlays, the report, exit codes, limits |
| [`story.md`](references/story.md) | One thing, claims, three storylines as three films, writing for the picture, narration, the teaching check |
| [`tells.md`](references/tells.md) | What gives each look away, and the case where each tell is right |
| [`types/`](references/types/) | `explainer.md`, `data.md` and `vertical.md`: how each kind of film is built |
| [`reviewing.md`](references/reviewing.md) | The review protocol: ranked P0 to P2 notes, never a score, the pictures-alone question, four delivery lines, and the optional second reviewer |
| [`rules.md`](references/rules.md), [`calibration.md`](references/calibration.md) | Every review rule with its fix value and evidence, and how the thresholds were calibrated |
| [`tools.md`](references/tools.md) | Film time, `--inspect`, `--shot` and `--range`, `locate.mjs`, `--sheets-only --estimated`, `--compare-looks`, `measure.mjs` |
| [`broll.md`](references/broll.md), [`music.md`](references/music.md) | Clips a generator made, and cutting to your music |
| [`migrating.md`](references/migrating.md) | Version 1 features and what replaced each |

## Looks

Each look serves the modes it names, and some kinds are not drawn in some looks. A parked kind renders with a note, and the report's `kinds` lists it. An excluded kind is refused with the looks that have it.

| Look | Modes | Parked kinds | Excluded kinds |
|---|---|---|---|
| `desk` | pro | none | none |
| `pop` | viral | none | none |
| `cosmos` | pro, viral | none | none |
| `ledger` | pro | `number` | none |
| `poster` | pro, viral | `number`, `feed` | none |
| `keynote` | pro | `number`, `clipping` | none |
| `marker` | pro | `number`, `feed`, `chart`, `timeline`, `free` | `screen`, `code` |

- `desk`: editorial paper collage, warm paper, a display serif and a highlighter. The default of `pro`.
- `pop`: short-form caption collage, a near-black field, one heavy condensed face and an acid accent. The default of `viral`.
- `cosmos`: a flat vector science explainer, deep navy to violet, one glowing accent.
- `ledger`: a newsroom data film, off-white paper on a hairline grid, one signal red.
- `poster`: kinetic type and cut paper, heavy condensed capitals on one flat ground a shot.
- `keynote`: a product launch film, a near-white ground with a soft mesh and product screens on cards.
- `marker`: a whiteboard time-lapse. A hand draws every stroke in one black marker and one accent colour, and erases between boards.

A look's motion is its own data, printed by `--list moves` with each move's `bounce` and `visible` length. An ease is a name (`outCubic`), `spring(<stiffness>,<damping>)`, `cubic-bezier(<x1>,<y1>,<x2>,<y2>)` or `steps(<n>)`. Two entrance moves, `letters` (a word arrives letter by letter, `cosmos`) and `lines` (each line arrives as one block, `desk`), play on a statement outside `viral`. `make.mjs film.json --compare-looks <shot-id>` draws one shot in every look that can draw it on one PNG, so a look can be chosen from the picture.

## Scripts

| Command | Does | Flags |
|---|---|---|
| `make.mjs <film.json>` | Validates, builds the timeline, reviews every shot in a browser, writes the sheets and renders the MP4. Exit 0 ok, 1 findings or an invalid film, 2 usage or machine trouble, 130 interrupted | `--out <file>.mp4`, `--json`, `--outline`, `--sheets-only`, `--estimated` (with `--sheets-only`: no voice, and the board strips), `--no-render`, `--exact`, `--preview`, `--open`, `--poster <film time>`, `--poster-out <file>`, `--inspect <film time>`, `--shot <id>`, `--range <from>..<to>`, `--compare-looks <shot-id>`, `--subtitles srt\|vtt`, `--subtitle-words` (one cue per word, with `--subtitles`), `--no-music`, `--workers <1-8 or auto>`, `--batch <rows.json>`, `--phonemes`, `--list <name>`, `--all`, `--model`, `--effort`, `--agent`, `--no-provenance` |
| `doctor.mjs` | What the skill needs and is missing (ffmpeg, a browser, `node_modules`, the voice package), with the fix for your system. `--fix <id>` installs what needs no `sudo`. Runs before the first install | `--json`, `--for <film.json\|voiceover\|cutout>`, `--fix <id[,id]>` |
| `cutout.mjs <photo.png\|clip.mp4>` | Cuts the person out of a photo (an RGBA PNG) or a clip (a VP9 alpha WebM) with MODNet, on this machine. A `cutout` device takes the picture. It needs `doctor --for cutout --fix cutout` | `--out <dir>`, `--fps <n>` |
| `beats.mjs <audio>` | Finds the beat grid of a music file and writes `<stem>.beats.json`, for `music.beats`. Exit 1 with `no steady beat found` when the track has none | `--out <file>.json`, `--min-confidence <0-1>`, `--bpm <n>`, `--min-bpm <n>`, `--max-bpm <n>` |
| `locate.mjs <picture.png>` | Turns a target you can see in a picture into the `[x, y, w, h]` box a `clipping` shot's `regions` entry takes: it draws numbered strips and cells, you name the numbers, it prints the box. No network, no model | `--cols <a-b>`, `--rows <a-b>`, `--cells <a-b>`, `--out <dir>`, `--json` |
| `measure.mjs <video file>` | Turns one video on this machine into numbers for pacing and mixing a film like it: measured (duration, size, frame rate, cut count, shot lengths, loudness and true peak) and guessed (`mode`, `pace`). Local files only, nothing written, nothing fetched; it copies nothing from the video | `--json` |
| `storyboard.mjs <film.json>` | For a film over 20 s: writes a make-explainer `plan` page the user answers before the film is built. Prints `storyboard: skipped (<reason>)` and writes nothing when it is not needed | `--out <plan.json>`, `--non-interactive`, `--stills <board dir>` (the strips of `--sheets-only --estimated`, shown under the shots) |

`--list` takes `kinds`, `looks`, `modes`, `devices`, `moves`, `cuts`, `fields` or `voices`.

`--inspect`, `--shot` and `--range` check one part of a film without a whole-film pass. They read film time, the one way a moment is named (a number of seconds, `rows@end`, `rows@word:3`; [`references/tools.md`](references/tools.md)). `--inspect <film time>` writes one frame as a PNG and a JSON dump of its nodes. `--shot <id>` and `--range <from>..<to>` review and write the sheets of that slice, and a silent MP4 of it beside the film's own. A film with `music.snap` is read on the timeline its render draws.

`make.mjs film.json --sheets-only --estimated` draws every shot with no voice made and writes a board of stills (`<name>.sheets/board/`) that `storyboard.mjs --stills` shows on the plan page. On Claude Code, `references/reviewing.md` lets the director start the optional read-only `motion-reviewer` agent once per finished film; its file pins `model: opus`, and it was proven on planted defects that are also readable from the spec, so it shows it finds what the spec and narration state, not that it reads pictures.

Two renders of the same film and media give the same frames on the same machine, browser build and fonts (the browser draws the text, so another system can set some words differently). The MP4's `comment` tag carries the build date, so the files differ by day unless `SOURCE_DATE_EPOCH` is set. A version 1 spec is refused with a pointer to [`references/migrating.md`](references/migrating.md), which maps each version 1 feature to version 2 or says it is not in 2.0.

## Security

- **The page runs under a CSP.** It stops an inline script. Test: `test/v2/stage-browser.test.mjs`, "the CSP stops an inline script from running".
- **The renderer aborts any request off its own origin.** Test: `test/v2/security-guards.test.mjs`, "guardNetwork aborts a request to another origin".
- **The servers bind `127.0.0.1` and answer only their own `Host`.** The render server and the preview page both. Tests: `security-guards.test.mjs`, `stage-browser.test.mjs`, `viewer-server.test.mjs`.
- **The server serves only files on its allow-list.** A path outside it, a link out of the folder and a picture swapped for a link after start are refused. Tests: `stage-browser.test.mjs`, "refuses everything outside its allow-list" and "an asset swapped for a link out".
- **No field of a film names a remote URL or a file outside the film's folder.** Tests: `spec.test.mjs` and the table in `security-guards.test.mjs` over `music.src`, `audio[0].src`, `voice.src`, `voice.words` and the `src` of `media` and `screen`, for five URL schemes.
- **ffmpeg opens files only.** Every input carries a protocol whitelist of `file` and `pipe`, so no URLs, and a source scan fails on a new `-i` that was not reviewed. Tests: `security-guards.test.mjs` and `ffmpeg.test.mjs`.
- **A download is pinned.** The voice model comes from one commit, with the size and SHA-256 of each file, and a file that does not match is kept nowhere. Tests: `voice-model.test.mjs` and `pinned-file.test.mjs`.
- **A video is written to a partial file** beside the output and renamed when ffmpeg finishes. A partial file left by a killed run is deleted on a later run once it is an hour old. A stop (SIGINT or SIGTERM) ends the run with exit 130 and a report of what was done.

## Requirements and licences

Node.js 20 or later, ffmpeg, and Chromium (a one-time download by Playwright) or Google Chrome. ffmpeg is found through `$FFMPEG_PATH`, then `PATH`; it is never bundled. The limiter stage of the mastering needs ffmpeg 5.1 or later, and the doctor says so when yours is older.

Installed size, measured with `du -sk node_modules` after `npm ci --ignore-scripts` in a clean copy of this folder: 55304 KiB (about 57 MB). The voice package in `optional/voice` is about 227 MB installed, measured with `du -sk` over the 23 packages of its lockfile in an existing install (221676 KiB), plus a model of about 93 MB (the five pinned files total 92,886,949 bytes) on first use. Both are installed by `doctor.mjs --fix` after it tells you the size and you say yes. The doctor reports the size of the browser and of the cut-out package before it installs them.

The dependencies are pinned by the lockfile:

| Package | Licence | Used for |
|---|---|---|
| Playwright 1.64.0 | Apache-2.0 | The browser that draws the frames |
| Ajv 8.20.0 | MIT | Checking the film |
| shiki 4.5.0 | MIT | Colouring code |
| d3-geo 3.1.1 | ISC | Projecting the map |
| topojson-client 3.1.0 | ISC | Reading the map files |
| world-atlas 2.0.2, us-atlas 3.0.1 | ISC | The map data (Natural Earth and US Census TopoJSON) |
| onnxruntime-node 1.21.0 (`optional/voice`), 1.31.1 (`optional/cutout`) | MIT | Running the voice and the cut-out model |
| phonemizer 1.2.1 (`optional/voice`) | Apache-2.0 | Turning text into phonemes |

The models: the Kokoro voice model (Apache-2.0, pinned to one commit of `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped`) and, for the cut-out tool, MODNet (Apache-2.0). Nothing downloads at render time except the voice model, once, on the first voiced render.

Fonts are bundled as files, all under the SIL Open Font License 1.1: Fraunces, Archivo, Nunito, Geist and Caveat in `engine/fonts` (their sources and SHA-256 are in `engine/fonts/SOURCES.md`), and the shared set in `shared/fonts` (`shared/fonts/SOURCES.md`). Ten of the shader cuts are ported from [gl-transitions](https://github.com/gl-transitions/gl-transitions); the licences and file hashes are in `THIRD_PARTY_NOTICES.md`.
