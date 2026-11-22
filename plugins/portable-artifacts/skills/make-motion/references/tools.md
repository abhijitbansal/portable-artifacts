# Tools for looking at one moment

Small commands that draw or measure one part of a film without a whole-film render. This page grows as they arrive: film time first (the one way every command names a moment), then the commands that read it: `--inspect`, `--shot` and `--range` today, and the locate helper for a box on a picture.

## Film time

One grammar names a moment of the film. `--poster`, `--inspect`, `--shot` and `--range` read it today; the commands that follow on this page read the same text. It is read after the film's timeline exists, so a word anchor means the word as this film is timed.

| Write | It means |
|---|---|
| `2.5` | 2.5 seconds from the film's start |
| `rows` | the first moment of the shot `rows` |
| `rows@end-0.5` | half a second before the end of `rows` |
| `rows@end` | the last frame of `rows` (one frame before the next shot begins) |
| `rows@word:0` | where the picture shows the first word of `rows` |
| `word:12` | the 13th word of the whole film (counting from 0), where it is heard |
| `sentence:2+0.3` | 0.3 seconds after the third sentence of the film starts |
| `end-1` | one second before the film's end |
| `end` | the film's last frame |

The forms are tried in this order, and the first that fits wins:

1. A plain number of seconds.
2. `<shot-id>@<anchor>`: the anchor read inside that shot, as a device's `at` is read (`start`, `end`, `word:<n>`, `word:<text>`, `sentence:<n>`, each with an optional `+<s>` or `-<s>`). A word is where the picture shows it (picture time), so in a film whose narration is shifted it can differ from the film-wide form below. `<shot-id>@end` (and `@end-0` or `@end+0`, a zero offset being no offset) is that shot's own last frame; `@end-0.5` is measured from the end itself.
3. A shot id alone: that shot's start. A shot id always wins over an anchor of the same text: a shot called `end`, `start` or `end-1` is the shot, never the film's end or start. To reach the film's end when a shot is called `end`, write a number of seconds.
4. An anchor across the whole film, as a cue's `at` is read. `word:<n>` and `sentence:<n>` count across all shots, and a word is where it is heard (heard time): the shot's start plus the word's sound time. A narration `lead` can put it before its own shot, a `trail` after. `word:<text>` takes the first word that matches.

A time at the film's end (to 1 µs, the precision anchors are kept to) names its last frame (`end`, `end-0.01`, `<last-shot>@end`); a time further past it is refused, and so is a time before the start. Both errors name the film's length. An unreadable reference, or one that names nothing in the film (an unknown shot, `word:99` in a film of 30 words), is exit 2 with `error.hint` listing the forms and the shots, and nothing is drawn. With `--poster` or `--inspect` on a voiced film this is judged on the estimated timeline before the voice is made, so a typo costs no voice; a time past the end is judged after, on the measured one. A film with no voice and no `music.snap` is timed exactly before anything runs, so a time past its end is refused at once, before a clip is decoded. On a film with `music.snap`, `--poster`, `--inspect`, `--shot` and `--range` read film time on the timeline the render draws, with the cuts moved onto the beats.

```
node <skill-dir>/scripts/make.mjs film.json --poster rows@end-0.5 --poster-out out/rows.png
```

## One frame

`--inspect <film time>` dumps one moment of the film as a picture and the numbers behind it. It reads film time as above, then draws that frame and writes two files into `<out stem>.inspect/` beside where the MP4 would go (`out/film.inspect/` for `film.json`): `<frame>.png` and `<frame>.json`, both written whole or not at all. There is no review, no sound, no MP4 and no sheets, so a film with no video clips needs only a browser. A film with clips decodes them first, which needs ffmpeg; so does a `music.snap` film with no `music.beats` file, as its beats are read from the music.

```
node <skill-dir>/scripts/make.mjs film.json --inspect rows@end --json
```

The PNG is the film's own frame, with the post pass and the captions as the render draws them (`--poster` leaves captions out; here the picture and the node list agree). The report gains `inspect: { png, json, frame, seconds, shot }`, only on this run. `--inspect` does not go with `--out`, `--poster`, `--poster-out`, `--sheets-only`, `--no-render`, `--outline`, `--phonemes`, `--batch`, `--subtitles`, `--workers`, `--exact`, `--no-music` or `--preview`. A time past the end or one that names nothing is refused as for `--poster`, with the film's length or the list of shots.

The JSON:

| Field | Meaning |
|---|---|
| `frame`, `seconds` | The frame and its time in the film |
| `shot` | The shot the frame belongs to (the incoming shot inside a cut's window) |
| `timed` | `"measured"` or `"estimated"`: the timeline the frame was placed on |
| `canvas`, `unit` | `{ w, h }` in pixels, and the size of one unit in pixels (the short side over 1080) |
| `safe` | `{ left, top, right, bottom }`: the rectangle text must stay inside, in pixels |
| `cut` | `null`, or the cut whose window the frame is in (below) |
| `nodes` | Every node that shows, parent before child, as below |
| `overlays` | The film's logo and progress bar in the same node shape, `[]` when the film has none; they are never in `nodes`. The bar's box is the part drawn so far (its width grows over the film), the track's is the whole width |

Each node is `{ id, type, role?, bbox: [x, y, w, h], opacity, offFrame, text? }`. `bbox` is in canvas pixels. `opacity` is the node's own times those of the groups around it; a node at 0 is left out with everything inside it. `offFrame` is true when the box is not wholly inside the canvas. A text also has `text: { sizeUnits, smallestUnits, ink, landed, outsideSafe }`: `sizeUnits` is the height a viewer reads (in units), `smallestUnits` that of the smallest word on screen, `ink` the box of its glyphs `[x, y, w, h]` in pixels, `landed` whether every word shown is at rest and the text fully opaque, and `outsideSafe` whether its ink leaves the safe rectangle by more than the review allows. These are the numbers the review rules judge (`min-size`, `safe-area`), measured on this one frame; `landed` does not judge whether a camera move has settled, which the review does over the whole shot.

Inside a cut's window the picture and the nodes can disagree, and `cut` says how: `{ name, family, p, from: { shot, seconds, live } }`. `p` is how far the cut has come (0 on its first frame, below 1 inside the window). `from.shot` is the outgoing shot and `from.seconds` the second of that shot the page draws it at: a layer or shader cut (`family` `layer`, `shader`) keeps the outgoing shot moving past its end (`live`: true), and any other cut, or a look drawn by hand, holds it at its last frame. Inside a layer or shader cut's window the PNG is the cut's composition at `p`: each shot is faded, moved or covered as that cut's recipe has it at that `p`, so one of them may be partly or wholly gone. A crossfade, for one, clears the outgoing shot by `p` 0.5 and brings the incoming one in from `p` 0.3, so both show only between 0.3 and 0.5; at 0.5 you see the incoming shot alone, still faint. `nodes` lists the incoming shot alone whatever the picture shows, so a text of the outgoing shot can be in the picture and not in the list; `cut.from` says which shot is going out and where it stands. A cut of family `node` moves the nodes of both shots in one tree, and `nodes` lists them as drawn.

## One shot or a range

`--shot <id>` and `--range <from>..<to>` make the review sheets and the review findings of one slice of the film, so a fix to one shot is checked without a whole-film pass. The slice is a run of frames, both ends inclusive: `--shot rows` is the first to the last frame of `rows`; `--range` takes two film times as above on each side of `..` (`--range rows@1..rows@end`, `--range 2.5..6`, `--range hook..rows@word:3`). A shot id alone as the second time is that shot's start; write `<id>@end` for its last frame. A slice is named by its frames, `range-<from>-<to>`, or by its shot, `shot-<id>`; the two forms never give the same name, even for a shot called `range-30-75`.

```
node <skill-dir>/scripts/make.mjs film.json --shot rows --sheets-only --json
node <skill-dir>/scripts/make.mjs film.json --range hook@1..rows@end-0.5 --json
```

The frames are the film's own, asked for by their number in the film, so a tile of a slice is the picture the full run draws at that frame. The report gains `slice: { from, to, frames, shots, silent, skipped }`, only on this run: the frames covered, the shots they touch, whether the film's sound is left out (`silent`: the film has a voice or sound, and a slice never plays it), and `skipped`, the rules a slice does not run.

What is written and what is judged:

- **Sheets.** Only the sheets of the slice are made, into the usual `<out stem>.sheets/` folder, and only the files they rewrite change: the other PNGs there stay as the last run left them. A shot's sheet keeps the tiles whose frame is inside the slice and is left out when none is. A sheet that keeps only some of its shot's tiles is written as `<shot>.partial-<label>.png` (`rows.partial-range-30-75.png`), never as `<shot>.png`, so a partial sheet cannot be taken for, or overwrite, the whole sheet of a full run; `--shot rows` keeps every tile of `rows` and so writes `rows.png`. A full run (without `--shot` or `--range`) empties the folder of its PNGs first, the partial sheets of older slices with them. A cut's strip is made when the first frame of its window is inside the slice, and then whole, with its side frames, even where they fall outside it.
- **Review.** The result is the full review's, cut down to the slice. Every audit frame of each shot the slice touches is drawn and judged, as the full run does, so what is read across a shot (where each text comes to rest, the picture a `match` is compared with, whether a text ever settles) and the one report a finding gets per shot and node come from the same frames. What a slice reports is what is about the slice. A finding about a frame (a text too small, outside the safe area, a dead space) is reported once per shot and node, at the first frame of the slice it shows on: a text too small on every frame of `rows` is reported by `--range rows@1..rows@end` at the first frame of that range, where the full run reports it at the first frame of `rows`, so a fix is judged by a slice that starts anywhere in the shot. A finding about the whole shot (a kind's own, `cut-window`, `unsettled`) is reported when the slice touches that shot, whichever of its frames the slice holds. The rest are reported when their time is inside the slice (`match` and a hand look's findings at their own times, `hook` at frame 0). The shot before a cut whose window opens inside the slice is drawn too, for `match`. The creative cap (`cut-variety`, `sameness` and `overlay-covers`) counts only what the slice reports: a slice runs neither `cut-variety` nor `sameness`, and its `overlay-covers` findings are capped among themselves. The composition cap counts only the findings reported for the slice, and its "N more left out" note counts them alone. `still` is read over the slice's frames alone, so a picture that held still before the slice began does not count.
- **Not run.** `loop`, `cut-variety` and `sameness` read the whole film, so a slice leaves them out; the report's `skipped` says so, and so does the text form. Run the film without `--shot` for them.
- **A silent MP4.** Unless `--sheets-only` or `--no-render`, a slice run also writes its frames as a video, `<out stem>.shot-<id>.mp4` or `<out stem>.range-<from>-<to>.mp4` beside where the film's own MP4 would go (`out/film.shot-rows.mp4`, `out/film.range-30-75.mp4`; the name always ends in `.mp4`, whatever `--out` ends in), and `output` names it; the film's own `<out stem>.mp4` is never written or replaced, and neither is the video of a film file that happens to be called `film.rows.json`. The frames sent to ffmpeg are the full render's frames: a test compares them frame by frame at `--exact` (the page seeks each by its number in the film, and the first frame of the slice is always captured, though the page would call it a repeat of the one before). The encoded file is not byte for byte the film's, as the encoder starts at another frame. The slice has no sound: the voice and the sound are mastered for the whole film, so `audio` is `null`, and when the film has a voice or sound the run says `make: the slice is silent: the sound is mastered for the whole film`, `slice.silent` is `true`, and the text form ends its `slice:` line with `silent`. It needs ffmpeg, as a film does, and is checked and tagged like one: without ffmpeg an MP4 slice is exit 2 before a browser starts, while `--sheets-only` or `--no-render` needs none. `--workers` does not go with it. With `--sheets-only` or `--no-render` there is no video and `output` is `null`.

`--shot` and `--range` do not go with each other or with `--poster`, `--poster-out`, `--inspect`, `--outline`, `--phonemes`, `--batch`, `--subtitles`, `--workers` or `--preview`; `--sheets-only`, `--no-render`, `--out` and `--exact` are accepted. A shot the film lacks is exit 2 with the list of shots in `error.hint`; a `--range` with no `..`, or one that runs backwards (its first frame after its last), is exit 2 naming the form; a time past the end or one that names nothing is refused as above. A film with no voice (and no `music.snap`) is timed exactly before anything runs, so the whole slice is checked at once. A voiced film is timed only once the voice is made, so before it the shot and the references are checked, and a range is refused when it runs backwards however the film is timed (two plain times, or two shots named outright, such as `rows..hook`); a range inside one shot, a film-wide word or sentence anchor (`word:12`), an anchor with an offset (`rows@word:0+0.3`, `hook@end-1`), a number of seconds after a shot (`hook@3`, `hook@3.`, `hook@.5`: not clamped to the shot) and a time past the end are judged after the voice, on the measured timeline. A word or sentence anchor with no offset inside a shot (`rows..hook@word:0`) counts as in that shot and is refused early when it runs backwards.

## Locating a region

`scripts/locate.mjs` turns a target you can see in a picture into the `[x, y, w, h]` box a clipping shot's `regions` entry takes (fractions of the picture). You look at PNGs it draws and name numbers; it uses no network and no model. Three plain calls:

```
node <skill-dir>/scripts/locate.mjs shot.png --out locate
node <skill-dir>/scripts/locate.mjs shot.png --cols 5-6 --rows 2-3 --out locate
node <skill-dir>/scripts/locate.mjs shot.png --cols 5-6 --rows 2-3 --cells 15-30 --json
```

1. **Strips.** The first call writes `locate/strips-cols.png` and `locate/strips-rows.png`: the picture in nine numbered strips each way. Open both and name the strips the target touches, as `--cols` and `--rows` (`5-6`, or `5` for one).
2. **Cells.** The second call writes `locate/grid.png`: that block of strips, enlarged if it is small, in 36 numbered cells (1 to 36, row by row). Name the first and the last cell the target touches as `--cells`: the cells between them form a rectangle.
3. **The box.** The third call prints `[x, y, w, h]` (with `--json`: `{ "region": [...] }`), each to three decimals, ready to paste into `regions`. With `--out` it also writes `locate/box.png`, the picture with the box drawn and the rest dimmed: open it to check.

Name every strip and cell the target touches. The box is that rectangle grown by a quarter cell, so it holds the target and each edge lies within 1.25 cells of it (a cell of the second grid, plus the pad). A cell label is the first thing in its cell, at the top left. The pictures are at most 1600 px a side.

A PNG the reader takes (8-bit RGB or RGBA) is read directly. Any other format, or a PNG of another kind, is decoded by ffmpeg, one frame; with no ffmpeg that is exit 2 saying so, and a PNG avoids it. A URL, a folder, an `--out` that is the picture, a picture over 2 GiB (more than the reader takes), a strip outside 1 to 9 and a cell outside 1 to 36 are each exit 2 naming the accepted values or the limit.

## A board before any voice

`--estimated` goes with `--sheets-only` and shows the film's shots drawn, with no voice made:

```
node <skill-dir>/scripts/make.mjs film.json --sheets-only --estimated --out <name>.mp4
```

- **What it does.** A voiced film keeps its voice unmade: the times are the word-count estimate, as `--outline` has them, so the report says `timed: "estimated"` and `voice: null`, and a recording of your own is neither read nor probed. The run writes the usual sheets, then the board: one tile per shot at its late frame, each stamped as a sheet tile is, six shots to a strip and three tiles across, as JPEG strips at most 1920 px wide, in `<name>.sheets/board/board-1.jpg` on. The report's `board` lists the strips in order. Nothing is rendered.
- **What it needs.** A browser, as any sheet does, and no voice package or model. A silent film works as it does without the flag.
- **What it refuses.** `--estimated` without `--sheets-only` is exit 2 (`--estimated needs --sheets-only`), and so is the flag beside `--shot`, `--range`, `--outline`, `--batch` or `--subtitles`: captions timed from an estimate would sit where a real render's captions go. `--poster`, `--inspect`, `--phonemes` and `--preview` refuse `--sheets-only` themselves.
- **Strips of the last run.** A run without `--estimated` removes the old `board-<n>.jpg` strips (regular files of that name in that `board/` folder only; a slice run leaves them, as it leaves the other sheets), so a storyboard built after a full run of the same film, written to the same `<name>.sheets`, does not carry old pictures. The strips carry no film identity, so some cases leave stale ones: editing the film and running `storyboard.mjs --stills` before any new make run, a `--preview` or `--outline` run, and a run with a different `--out` (it clears the strips of that other folder). Run `--sheets-only --estimated` again after every edit, before `--stills`. A `board` that is a file or a link, or a `board-<n>.jpg` that is not a plain file, is left alone and the run's log says so.
- **The page.** `storyboard.mjs film.json --out plan.json --stills <name>.sheets/board` copies the strips beside the plan; see `story.md`.

## Comparing looks

`--compare-looks <shot-id>` draws one shot of the film in every look that can draw it, on one PNG, so a look can be picked from the picture:

```
node <skill-dir>/scripts/make.mjs film.json --compare-looks rows
```

- **What it writes.** `<name>.looks.png` beside the MP4 path (`out/<name>.looks.png`): one cell per look, four across, each the anchor shot's late frame (85% of the shot, the frame the board uses) stamped with the look's name. The looks are the listed ones whose modes hold the film's mode (`--list looks`), at most 16, in listed order. The report gains `compare: { file, shot, frame, frameLook, looks }` (`references/schema.md`); `output` is `null` and no sheets are written. No review runs, no sound is made and ffmpeg is not needed for a film without clips or `music.snap`.
- **Timing.** No voice is made: the film is timed as `--outline` times it, and the report says `timed: "estimated"`. A look can lengthen a shot (a tail, a hand that waits for its cut), so each look is timed as that look's own film, and `frame` is the anchor's frame in the film's own look, `frameLook` names that look. A `music.snap` film is drawn with its cuts moved onto the beats, as `--poster` draws it; its music is analysed once for all the looks that give the film the same length (the silence check is made against that length).
- **A cell that is not a picture.** A look is refused only by the anchor shot or a film-wide field (`overlays`, `music`, `voice`): its cell is flat, with the look's name and that first error, such as a kind the look excludes (`kind "screen" is not supported by look "marker"`), an overlay it does not draw, a cut or device it lacks. A fault on another shot does not refuse the look: the anchor is drawn from the film-wide fields and the anchor shot alone, stamped `<look> · other shots refused`, and the note counts the problems (the film as a whole would not render in that look until they are fixed). A look that parks the anchor's kind is drawn and stamped `<look> · experimental kind`; `status` in the report says `parked`. A look whose page raises an error about the shot, or reports a fault that no other look reports, is a flat cell too (`page: ...`), and never a finding of the run; a finding every look shares (no WebGL, say; this needs two or more looks drawn) is one creative note. When no look can draw the shot the run is exit 1 with one finding at `shots[i]`, and no file is written.
- **What it refuses.** An id the film lacks is exit 2 with the shots in `error.hint`. `--compare-looks` does not go with `--out`, `--batch`, `--no-render`, `--sheets-only`, `--outline`, `--phonemes`, `--poster`, `--poster-out`, `--inspect`, `--shot`, `--range`, `--subtitles`, `--subtitle-words`, `--workers`, `--exact`, `--no-music`, `--estimated`, `--list` or `--preview`.
- **The browser.** One browser, with one session per look opened and closed one after another, so no two pages are ever open together.

## Measuring a reference video

`scripts/measure.mjs` turns one video file on this machine into numbers, so a film can be paced and mixed like a reference without guessing what the reference does:

```
node <skill-dir>/scripts/measure.mjs reference.mp4
node <skill-dir>/scripts/measure.mjs reference.mp4 --json
```

- **What it prints.** Two groups under the headings `measured` and `guessed`; `--json` is one object of `{ value, basis }` per field, `basis` being `measured` or `guessed`. Nothing is written to disk and nothing is fetched.
- **Measured.** `duration` (s), `size` (`[w, h]`), `fps`, `cuts` (how many), `shotMedian`, `shotShortest`, `shotLongest` (s), `lufs` and `truePeakDb` (the integrated loudness and the true peak, from ffmpeg's `ebur128`). The cuts are ffmpeg's `scdet` at its own default threshold of 10, one pass over the picture, so a fade or a whip pan can count as a cut or be missed, and the shot lengths are only as good as the cuts. A file with no sound has `lufs` and `truePeakDb` of `null`, still measured (the text form says `none (no sound)`). A track of digital silence is not that: its `-inf` is the string `"-inf"` in `--json` (JSON has no infinity) and `-inf` in the text form, so `null` always means no sound. A frame rate the file does not give is `null` for `fps`, and the text form says `unknown`.
- **Guessed.** `mode` is `viral` when the picture is taller than wide, else `pro`; `pace` is `fast` when `shotMedian` is under 2 s, else `calm`. They are rules of thumb over the measured numbers, not readings: take them as a starting point for `mode` and for how long the shots of the film run.
- **What it refuses.** Exit 2 with `local files only: give the path of a video file on this machine (mp4, mov, m4v, webm or mkv)` for a URL, a folder, a symbolic link, a named pipe, a file that is not there and any file the clip demuxers will not open (a playlist, a concat script, a container off the list); a second line says why. A real video that opens but is not a clip the tool takes (a side over 4096 px, a codec off the list, more than one audio track, a subtitle or data stream) is also exit 2, with its own first line, `<file> cannot be measured: <reason>`. The file is opened as a clip is: the file protocol only, the clip demuxers and decoders only, so a playlist on disk that names a URL is refused by what ffmpeg opens, not just by the argument.
- **Limits and failures.** The scan stops after 300 s and the ffprobe checks after 10 s: a file that needs longer is exit 1 with `did not finish within <n> s`. Exit 1 is also no ffmpeg or ffprobe, or a tool that fails or answers with something that is not JSON, each as one line on stderr.
- **What the numbers are for.** Pacing and loudness only: how often it cuts, how long a shot runs, how loud it is. A creator's footage, music, name or wording is never copied into a film; take the rhythm and write your own film.
