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

A time at the film's end (to 1 µs, the precision anchors are kept to) names its last frame (`end`, `end-0.01`, `<last-shot>@end`); a time further past it is refused, and so is a time before the start. Both errors name the film's length. An unreadable reference, or one that names nothing in the film (an unknown shot, `word:99` in a film of 30 words), is exit 2 with `error.hint` listing the forms and the shots, and nothing is drawn. With `--poster` or `--inspect` on a voiced film this is judged on the estimated timeline before the voice is made, so a typo costs no voice; a time past the end is judged after, on the measured one.

```
node <skill-dir>/scripts/make.mjs film.json --poster rows@end-0.5 --poster-out out/rows.png
```

## One frame

`--inspect <film time>` dumps one moment of the film as a picture and the numbers behind it. It reads film time as above, then draws that frame and writes two files into `<out stem>.inspect/` beside where the MP4 would go (`out/film.inspect/` for `film.json`): `<frame>.png` and `<frame>.json`, both written whole or not at all. There is no review, no sound, no ffmpeg, no MP4 and no sheets, so a silent film needs only a browser.

```
node <skill-dir>/scripts/make.mjs film.json --inspect rows@end --json
```

The PNG is the film's own frame, with the post pass and the captions as the render draws them (`--poster` leaves captions out; here the picture and the node list agree). The report gains `inspect: { png, json, frame, seconds, shot }`, only on this run. `--inspect` does not go with `--out`, `--poster`, `--poster-out`, `--sheets-only`, `--no-render`, `--outline`, `--phonemes`, `--batch`, `--subtitles`, `--workers`, `--exact` or `--preview`. A time past the end or one that names nothing is refused as for `--poster`, with the film's length or the list of shots.

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
- **Review.** The result is the full review's, cut down to the slice. Every audit frame of each shot the slice touches is drawn and judged, as the full run does, so what is read across a shot (where each text comes to rest, the picture a `match` is compared with, whether a text ever settles) and the one report a finding gets per shot and node come from the same frames. A finding is reported only when its time is inside the slice, whatever rule it comes from: a text too small on every frame of `rows` is reported at the first frame the full run reports it on, so a slice that starts after that frame does not repeat it (`cut-window` is at the time the window opens, `hook` at frame 0, a kind's or a hand look's findings at their own times). The shot before a cut whose window opens inside the slice is drawn too, for `match`. The creative cap (`cut-variety` and `sameness`) does nothing in a slice, which runs neither. The composition cap counts the findings of every shot drawn for the slice, the shot before a cut that opens inside it included, so a slice can keep more of them than the full run. Its "N more left out" note is carried by the smallest finding kept: when that finding lies outside the slice, it and the note are dropped with it, and the count includes findings outside the slice. `still` is read over the slice's frames alone, so a picture that held still before the slice began does not count.
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

A PNG the reader takes (8-bit RGB or RGBA) is read directly. Any other format, or a PNG of another kind, is decoded by ffmpeg, one frame; with no ffmpeg that is exit 2 saying so, and a PNG avoids it. A URL, a folder, an `--out` that is the picture, a strip outside 1 to 9 and a cell outside 1 to 36 are each exit 2 naming the accepted values.
