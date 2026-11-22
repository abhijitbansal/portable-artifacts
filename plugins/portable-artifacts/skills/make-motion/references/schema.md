# The film file, version 2

A film is one JSON object: the root fields below and a list of shots. `node scripts/make.mjs film.json --outline` checks a film with no browser. Every error is `<path>: <message>`, where the path names the field (`shots[2].say`) and the message says what to write instead.

This page lists the root fields, the fields every shot takes, the markup in `say`, anchors, sound, cuts, the `--list` names, the report and the exit codes. It does not copy the fields of each kind. For those, run `node scripts/make.mjs --list kinds`: it prints each kind's fields (`*` marks a required one) and one example shot to copy.

```json
{
  "version": 2,
  "mode": "pro",
  "look": "desk",
  "shots": [
    { "id": "hook", "show": "statement", "say": "Numbers need *sources*.", "kicker": "The problem" },
    { "id": "rows", "show": "number", "say": "Four hundred fifty nine rows. One file.", "value": 459, "suffix": "rows", "label": "in one file" }
  ]
}
```

## Root fields

An unknown root field is an error. Only `shots` and `version` are required.

| Field | Type | Meaning |
|---|---|---|
| `version` | `2` | Required. Any other value is an error; a version 1 spec gets the message in `references/migrating.md` |
| `shots` | array of 1 to 60 shots | Required. The script of the film |
| `mode` | `"pro"` or `"viral"` | Default `pro`: 16:9, 150 words a minute. `viral`: 9:16, 175 words a minute (`--list modes`) |
| `look` | a look name | Default: the mode's own look (`desk` for `pro`, `pop` for `viral`). A look serves the modes it names (`--list looks`) |
| `format` | `"16:9"`, `"9:16"`, `"1:1"` or `"4:5"` | Default: the mode's own format |
| `fps` | 24, 25, 30 or 60 | Default 30 |
| `seed` | integer, 0 to 7918 | Default 1. Looks draw their random marks from it, so one seed gives the same frames |
| `accent` | `"#rrggbb"` | Replaces the look's accent colour |
| `cut` | a cut | The default cut of every shot after the first (see Cuts) |
| `voice` | `{ "name": "af_heart" }` or `{ "src": "vo.wav", "words": "vo.json" }` | Narration. The first shape is made on this machine. The second is a recording of your own with its word times. See Sound |
| `music` | `{ "bed": "pulse", "bpm": 92 }` or `{ "src": "track.mp3", "beats": "track.beats.json", "snap": true }` | A music bed or a file. See Sound |
| `sound` | `"on"` or `"off"` | `on` plays the designed sound cues. In `viral` they play unless the film says `off` |
| `cues` | array of up to 64 `{ "at", "cue" }` | Your own sound cues. See Sound |
| `audio` | array of up to 20 `{ "src", "at" }` | Extra sound files. See Sound |
| `overlays` | `{ "logo": { "src", "corner" }, "progress": true }` | A logo and a progress bar that stay unbroken over every cut. See Overlays |
| `captions` | boolean | Draws the narration as captions, on shots whose kind does not show its own words. Off by default |
| `loop` | boolean | `true`: the review checks that the last frame matches the first |
| `vars` | object | Typed names for `{{name}}` in the film (see Variables) |
| `generatedBy` | `{ "model", "effort", "agent" }` | Which model wrote the film. Each value is 1 to 60 letters, digits, spaces and `. _ : / ( ) + [ ] -`. Written into the MP4's metadata. `--model`, `--effort` and `--agent` on `make.mjs` override the three keys |
| `provenance` | boolean | `false` leaves the authoring tags out of the MP4, as `--no-provenance` does |

## Fields every shot takes

A kind adds its own fields on top (`--list kinds`). A shot with a field its kind does not have is an error.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Required. A lowercase letter, then lowercase letters, digits and hyphens. Unique in the film |
| `show` | string | Required. The kind: one of the sixteen in `--list kinds` |
| `say` | string, 1 to 400 characters | The narration of the shot. It sets how long the shot lasts |
| `hold` | number, 1 to 30 | Seconds a shot with no `say` lasts. A shot takes `say` or `hold`, never both |
| `cut` | a cut | How the film arrives at this shot (see Cuts). The first shot takes only `"cut"` |
| `narration` | `{ "lead", "trail" }`, seconds from 0 to 1.5 | Sound across a cut: `lead` starts this shot's narration before its picture, `trail` lets it run into the next shot's picture. Needs `say` |
| `on` | array of up to 8 events | Devices placed on words of the narration (see Anchors) |

## Narration markup

Marks inside `say`. On-screen text never shows them.

| Mark | Meaning |
|---|---|
| `*word*` | Emphasis: stress, a short slow-down, and the look's emphasis mark on the matching words on screen |
| `_word_` | An aside: quicker |
| `...` or `…` | A pause of 0.35 seconds |
| `(0.4)` | A pause of that many seconds, 0.05 to 3. Only a number with a decimal point is a pause, so `(2024)` is text |
| `[word](/ipa/)` | A pronunciation hint, in the phoneme characters of the voice |
| `\*`, `\_`, `\\` | A literal star, underscore or backslash |

Marks inside a word (`snake_case`, `a*b`) are text. Two of the same mark in a row (`**x**`) are text. Nested marks of one kind are an error.

## Anchors

An anchor says when in a shot something happens. It is a number of seconds from the start of the shot, or one of these, each optionally followed by `+<seconds>` or `-<seconds>`:

| Form | Where |
|---|---|
| `start` | The first moment of the shot |
| `end` | The last moment of the shot |
| `word:<n>` | The start of word `n`, counting from 0 |
| `word:<text>` | The start of the first word that matches the text, ignoring case and punctuation |
| `sentence:<n>` | The start of sentence `n`, counting from 0 |

`beat:<n>` is refused. Cut to music with `music.beats` and `music.snap`. An anchor that lands more than one frame outside its shot is an error.

An event in `on` is `{ "at": <anchor>, "do": <device>, "target": <target> }`. `at` and `do` are required. `do` is one of `--list devices`. `target` is a region of the shot (`region:query`) or one of the parts the kind names. A device the look does not draw is an error that lists the devices it does. To find the box of a region on a picture, see Locating a region in `references/tools.md`.

## Sound

Sound is opt-in. A film with none of `voice`, `music`, `sound`, `cues` or `audio` has no sound track.

- **`voice`**: `{ "name": "af_heart" }` makes the narration on this machine (`--list voices`). `{ "src": "vo.wav", "words": "vo.json" }` uses a recording of your own, with the word times as a Whisper JSON file; it takes both, and a name and a recording together is an error.
- **`music`**: `{ "bed": "pulse" | "drift" | "tape", "bpm": 60 to 180 }` is a bed made on this machine, and it follows the cuts. `{ "src": "track.mp3" }` is a file of your own. A file may add `beats` (the grid file `scripts/beats.mjs` wrote for it) and `snap: true`, which moves the cuts onto the beats. `snap` needs a film with no narration. A bed and a `src` together is an error.
- **`cues`**: `[{ "at": 2.5, "cue": "pop" }]`. `at` is seconds from the start of the film, or an anchor. The cue is one of `pop`, `click`, `whoosh`, `chime`, `impact`, `riser`, `swoosh`, `drop`, `ding`, `sub`, `paper`, `marker`, `erase`.
- **`audio`**: `[{ "src": "sounds/ding.wav", "at": 3 }]`. `at` is seconds from the start, 0 or more.

`--no-music` renders the film without its music, for a second delivery with no bed or track. The music is still planned, so `music.snap` moves the cuts as before and the cues sit on that timeline: the picture is the same film. When the render holds any other sound (a voice, cues, extra audio), `report.audio.music` keeps its summary and gains `muted: true`, and the text report's sound line ends `(muted)`; a film whose only sound was the music renders with no audio stream and `report.audio` is `null`. On a film with no music the flag does nothing and says so on the log. It does not go with `--outline`, `--phonemes`, `--poster`, `--poster-out`, `--inspect` or `--preview`.

Every `src` is a file inside the film's folder. A URL, an absolute path or a path that leaves the folder is an error.

## Overlays

`overlays` puts two marks over the film itself, not over a shot, so a cut never moves, fades or breaks them: `{ "logo": { "src": "assets/logo.png", "corner": "top-right" }, "progress": true }`. Each key is optional. An unknown key gets a did-you-mean.

- **`logo`**: a png, jpg, webp or gif inside the film's folder, held to the same rules as a shot's picture; a problem is reported at `overlays.logo.src`. `corner` is `top-left`, `top-right`, `bottom-left` or `bottom-right`; left out, it takes the look's own corner. The logo keeps its proportions and sits in its corner, inset by the look's margin; a very wide one is scaled down to fit the width it has.
- **`progress`**: `true` draws a thin bar along one edge of the frame that fills from left to right over the film's length. The look sets the edge, thickness and colours. The bar sits on the frame's own edge, never moved in to the band a banded look composes in (`pop`, `cosmos`, `poster` on 9:16). In `viral` mode on a 9:16 frame the frame's edge is the edge of the platform's safe zone, so the bar starts at the top (or ends at the foot) of the safe zone. A banded look's band begins at that same line, so there the bar cannot be kept off the band: it lies in the band's first pixels, and no rule judges a text that reaches it.

The logo stands inside the rectangle the look composes in and, in `viral` mode on a 9:16 frame, inside the platform's safe zone too, so it keeps clear of the platform's caption and buttons. Both are drawn over the composed frame, after the cut; for a shader cut they are laid over the transition's result before the post pass (grain, bloom, halftone). The review's composition rules do not see them, and a moving bar does not stop the `still` finding from firing. The poster and the `loop` check are taken without them; `--inspect` lists them in `overlays`, beside `nodes`. The look decides how each is drawn (`--list looks --json` says which overlays each look draws); asking for an overlay a look does not draw, such as `progress` in `marker`, is an error that names the looks that do.

A progress bar makes every frame a fresh capture, so a film of held shots renders slower with it. Measured, one render each with `make.mjs --json`, fast capture, 30 fps, `desk`, on one machine (2026-11-22): three held shots of 4 s (360 frames) captured 144 frames at 22.2 ms per frame without the bar and 360 frames at 51.9 ms per frame with it, 2.3 times the time. A film that moves on every frame has nothing to lose: four moving statements joined by a slide, a crossfade and a ripple (179 frames) captured all 179 with the bar and with a logo alone, at 63.0 and 63.1 ms per frame.

## Variables

`vars` declares up to 30 typed names: `{ "name": { "type": "string", "default": "Ada" } }`. A type is `string` or `number`, and every var has a default. `{{name}}` in any string of the film becomes the value; `{{{{` is a literal `{{`. A file path (`src`, `words`, `beats`) takes no var. A value placed in a `say` has its marks escaped. `make.mjs film.json --batch rows.json --out "renders/{name}.mp4"` renders one film per row of values; the `--out` needs `{index}` or a `{var}`.

## Cuts

A cut is a name (`"slide"`) or an object `{ "type": "slide", "direction": "up", "duration": 0.5, "smear": true, "at": "mark" }`. Only `type` is required. `direction`, `duration`, `smear` and `at` apply to the cuts that take them. `at` is a target of the shot the cut leaves (the names an `on` event's `target` takes there) and only `iris`, `zoom` and `flood` take it: the cut opens from that thing on screen, such as the button just clicked, instead of from the centre (or the point the look keeps clear). A name the shot before lacks is an error that lists the names it has; the cut never opens from the centre in silence. `flood` paints a colour over the outgoing shot as a growing circle, then opens the next shot from the same point; its colour is the first of the look's `cutFlood.colors` (default: the accent) that differs from both shots' grounds. `--list cuts` prints each cut with its family, directions, default length, whether the outgoing shot stays live, and an example. A layer or shader cut shows the outgoing shot still moving (its camera and its animated fields carry on; a video clip in it holds its last frame); a node cut (and a smear) holds its last frame, and so does every cut in a look drawn by hand. A cut must be one the look lists: the error names the cuts it has. `"cut": "match"` carries the node two shots share across the cut, so both shots need a node with the same id (see `hero` in `--list kinds`).

## Composition findings

Two `creative` findings judge how a shot fills its frame. Each is judged once per shot, on its resting frame: a shot mid-entrance, a frame inside a cut, and a frame that is all picture (a ground or a full-bleed image) give none. The caption zone, when captions are on, is taken out of the safe area first. At most 3 a film reach the report, the largest overshoots; the last kept finding says how many were left out.

- `dead-space`: the longest empty band of the safe area reaches `band` of its width or height. Fix: let the hero take more of the frame, add a second element, or use a look that fills with type.
- `scale-contrast`: the hero is the largest element and leads the next by at least 1.5 times in area, but its extent (the larger of its width and its height, each as a share of the safe area) is under `hero`. Fix: set it larger, crop in on it, or give it a second mass. A kind that lays out equals (the engine marks it `peers`: `list`, `compare`, `timeline`, `feed`) is not judged, since a slug or a divider is its "second" element.

| Look data | Meaning |
|---|---|
| `fill` | `{ "band", "hero" }`, each a number above 0 and at most 1. Defaults 0.35 and 0.50. Set only where a look's layouts are measured and viewed to fill well under them |
| `kinds.statement.fillShort` | `{ "words", "height", "toWide", "linesWide", "max" }`. A statement of at most `words` words may set its text block up to `height` of the composition band's height, up to column `toWide` and `linesWide` lines on a wide frame, and take a size cap of `max` units in place of 300. `words` and `height` are required. `desk`, `cosmos` and `keynote` set `fillShort`; the other looks keep their usual share |

`desk` and `ledger` set `fill.band` to 0.40 (`ledger` also `hero` to 0.45): their flush-left statements and lists leave 35 to 39% of the width bare beside the slug and read filled, so the default would flag them. That is a ruled trade, and it has a cost: the 0.40 band also lets through two `desk` shapes that were viewed as sparse, the 16:9 statement and the 16:9 timeline. Look at those two on the sheets even when no finding is printed.

## The `--list` names

`node scripts/make.mjs --list <name>` prints one of these. Add `--json` for JSON. `--all` adds the parked kinds (and any experimental look; there is none today).

| Name | Prints |
|---|---|
| `kinds` | Every kind of shot: its fields and one example |
| `looks` | The looks |
| `modes` | The modes, with their pace |
| `devices` | The devices an `on` event can place |
| `moves` | The motion values each look gives each move |
| `cuts` | The cuts, their directions and lengths |
| `fields` | The backgrounds a look can draw |
| `voices` | The voices `voice.name` accepts |

## The report

`make.mjs --json` prints one object on stdout. Every path gives the same keys. In the report of a single-film run, every file path (`output`, `sheets`, `board`, `poster.file`, `inspect.png` and `.json`, `subtitles.file`, `compare.file`) is absolute, resolved against the folder `make.mjs` ran in, so a reviewer that can only Read opens a sheet from any folder; the text form prints the paths as you gave them, and the rows of a `--batch --json` report keep the paths as given.

| Key | Meaning |
|---|---|
| `ok` | `true` when the film validated, no finding is `mechanical`, and nothing stopped the run |
| `output` | The MP4 path, or `null` when none was written |
| `sheets` | The review PNGs, one per shot and one strip per cut |
| `timed` | `"measured"` or `"estimated"`: whether shot lengths come from a made voice or from word counts. `null` before a timeline exists |
| `voice` | `{ cached, seconds, model }` for a film whose voice was made, else `null` |
| `audio` | `{ lufs, truePeakDb, note, cues, music }` of the sound, else `null` |
| `post`, `capture` | How the frames were drawn and captured |
| `stages` | `[{ name, ok, seconds }]` for each stage that ran |
| `frames`, `captured` | Frames in the film, and frames actually captured |
| `seconds`, `msPerFrame`, `bytes`, `mbps` | Render time, time per frame, file size and bit rate |
| `timing` | `{ drawMs, captureMs, encodeMs, checkMs }`: where the render's time went, summed across pages with `--workers`, or `null` when nothing was rendered |
| `findings` | `[{ kind, shot, path, message, t?, rule?, suggest? }]` (see below): `t` and `rule` are on a review finding, `suggest` only where the rule has a fix value |
| `provenance` | `{ comment, artist }` as stamped into the MP4, or `null` |

These keys appear only when they apply: `poster`, `inspect`, `slice`, `board`, `compare`, `workers`, `subtitles`, `cuts`, `look` (an experimental look), `kinds` (the parked kinds the film uses), `error`.

`subtitles` is `{ file, format, timed, level }`, on a `--subtitles` run only. `level` is `sentence`, or `word` with `--subtitle-words` (needs `--subtitles`): one cue per word, at the film second it is heard (a word that leads or trails its cut keeps its heard time), sorted across the film, each cue held inside the film; words heard at the same moment, within a millisecond of each other (a merged run such as "$5 million"), are one cue, and each cue ends where the next starts, so no two cues overlap. An estimated VTT says so in a `NOTE`; an estimated SRT is refused.

`slice` is `{ from, to, frames, shots, silent, skipped }`, on a `--shot` or `--range` run only: the frames it covers, the shots it touches, whether the film's sound is left out, and the review rules it does not run (`references/tools.md`, "One shot or a range").

`board` is the paths of the board strips, in order (`<name>.sheets/board/board-1.jpg` on): six shots to a strip, one tile per shot, on a `--sheets-only --estimated` run only. That run makes no voice, so `timed` is `"estimated"` and `voice` is `null`.

`compare` is `{ file, shot, frame, frameLook, looks }`, on a `--compare-looks` run only: the sheet, the anchor shot, its late frame and the look that frame is in (the film's own look when it is on the sheet, else the first look drawn whole; both `null` when every look drew the anchor alone), and one `{ look, status, note, frame }` per look on the sheet in listed order (`status` is `drawn`, `parked` or `refused`; `note` says why for a parked look, a refused one, or a look that drew the anchor alone; `frame` is `null` for a refused look and for one that drew the anchor alone). The run writes no sheets and no video, so `output` is `null` and `sheets` is `[]` (`references/tools.md`, "Comparing looks").

A finding is `mechanical` or `creative`. A `mechanical` finding names a JSON `path` and says what to change; it makes `ok` false. A `creative` finding is a call for the author and never fails the run. A parked kind is not a finding: it renders, and the report's `kinds` lists it. Every rule a finding can name, with what it asks and the value that fixes it, is in `references/rules.md`.

`error` is `{ message, hint }`. It is set when something about the machine stopped the run (a missing film file, no browser, no ffmpeg, a crashed page, an interrupt). A fault in the film is a finding, not an error.

Three render errors come from the checks the render makes on itself, and each leaves no MP4:

- `render stalled in the <stage> stage at frame N of M: ...; last page messages: ...`: a stage (draw, capture, encode or check) gave no answer for 120 s, or the browser timed out. With `--workers` the messages come from every page, as `page N: message`, a few lines from each (at least one, and the error keeps at least one per worker), because the render does not know which page stalled. Run again, and with `--workers 1` if it keeps happening.
- `render check: the finished file holds N frames, the timeline has M`: the finished file does not hold the frames the timeline has. The encode lost or added frames. Run again with `--workers 1`, then with `--exact`.
- `render check: the finished file's picture is blank: none of its N frames has any detail`: the finished film is blank. Check that the shots draw something: a film of one `free` shot with only a `background` validates and draws nothing. It is an error and not a finding, because the film is valid and the file is useless.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | The film is valid and has no mechanical finding |
| 1 | The film is invalid, or a mechanical finding exists (the MP4 is still written when the film validated) |
| 2 | A usage error, or trouble with the machine. `error` says which and how to fix it |
| 130 | Stopped by SIGINT or SIGTERM. The report keeps what was done |

## Reproducibility

Two renders of one film give the same frames on the same machine, browser build and fonts. The browser draws the text, so how it draws some words (kerning, ligatures, right-to-left scripts) and which of them are drawn letter by letter can differ between systems.

## Limits

| What | Limit |
|---|---|
| Shots in a film | 60 |
| Characters in a `say` | 400 |
| `hold` | 1 to 30 seconds |
| Events in `on` | 8 per shot |
| Variables | 30 |
| Sound cues | 64 |
| Extra audio files | 20 |
| `--workers` | 1 to 8, or `auto` |
| A render stage with no answer | 120 s, then the render stops with `render stalled` (the check restarts it on every frame it decodes) |
