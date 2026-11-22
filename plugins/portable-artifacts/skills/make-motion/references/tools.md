# Tools for looking at one moment

Small commands that draw or measure one part of a film without a whole-film render. This page grows as they arrive: film time first (the one way every command names a moment), then the commands that read it: `--inspect`, `--shot` and `--range` today.

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
2. `<shot-id>@<anchor>`: the anchor read inside that shot, as a device's `at` is read (`start`, `end`, `word:<n>`, `word:<text>`, `sentence:<n>`, each with an optional `+<s>` or `-<s>`). A word is where the picture shows it (picture time), so in a film whose narration is shifted it can differ from the film-wide form below. `<shot-id>@end` alone is that shot's own last frame; `@end-0.5` is measured from the end itself.
3. A shot id alone: that shot's start. A shot id always wins over an anchor of the same text: a shot called `end`, `start` or `end-1` is the shot, never the film's end or start. To reach the film's end when a shot is called `end`, write a number of seconds.
4. An anchor across the whole film, as a cue's `at` is read. `word:<n>` and `sentence:<n>` count across all shots, and a word is where it is heard (heard time): the shot's start plus the word's sound time. A narration `lead` can put it before its own shot, a `trail` after. `word:<text>` takes the first word that matches.

A time exactly at the film's end names its last frame (`end`, `end-0.01`, `<last-shot>@end`); a time strictly past it is refused, and so is a time before the start. Both errors name the film's length. An unreadable reference, or one that names nothing in the film (an unknown shot, `word:99` in a film of 30 words), is exit 2 with `error.hint` listing the forms and the shots, and nothing is drawn. With `--poster` or `--inspect` on a voiced film this is judged on the estimated timeline before the voice is made, so a typo costs no voice; a time past the end is judged after, on the measured one.

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
| `overlays` | The film's logo and progress bar in the same node shape, `[]` when the film has none; they are never in `nodes` |

Each node is `{ id, type, role?, bbox: [x, y, w, h], opacity, offFrame, text? }`. `bbox` is in canvas pixels. `opacity` is the node's own times those of the groups around it; a node at 0 is left out with everything inside it. `offFrame` is true when the box is not wholly inside the canvas. A text also has `text: { sizeUnits, smallestUnits, ink, landed, outsideSafe }`: `sizeUnits` is the height a viewer reads (in units), `smallestUnits` that of the smallest word on screen, `ink` the box of its glyphs `[x, y, w, h]` in pixels, `landed` whether every word shown is at rest and the text fully opaque, and `outsideSafe` whether its ink leaves the safe rectangle by more than the review allows. These are the numbers the review rules judge (`min-size`, `safe-area`), measured on this one frame; `landed` does not judge whether a camera move has settled, which the review does over the whole shot.

Inside a cut's window the picture and the nodes can disagree, and `cut` says how: `{ name, family, p, from: { shot, seconds, live } }`. `p` is how far the cut has come (0 on its first frame, below 1 inside the window). `from.shot` is the outgoing shot and `from.seconds` the second of that shot the page draws it at: a layer or shader cut (`family` `layer`, `shader`) keeps the outgoing shot moving past its end (`live`: true), and any other cut, or a look drawn by hand, holds it at its last frame. Inside a layer or shader cut's window the PNG is the cut's composition at `p`: each shot is faded, moved or covered as that cut's recipe has it at that `p`, so one of them may be partly or wholly gone. A crossfade, for one, clears the outgoing shot by `p` 0.5 and brings the incoming one in from `p` 0.3, so both show only between 0.3 and 0.5; at 0.5 you see the incoming shot alone, still faint. `nodes` lists the incoming shot alone whatever the picture shows, so a text of the outgoing shot can be in the picture and not in the list; `cut.from` says which shot is going out and where it stands. A cut of family `node` moves the nodes of both shots in one tree, and `nodes` lists them as drawn.

## One shot or a range

`--shot <id>` and `--range <from>..<to>` make the review sheets and the review findings of one slice of the film, so a fix to one shot is checked without a whole-film pass. The slice is a run of frames, both ends inclusive: `--shot rows` is the first to the last frame of `rows`; `--range` takes two film times as above on each side of `..` (`--range rows@1..rows@end`, `--range 2.5..6`, `--range hook..rows@word:3`). A shot id alone as the second time is that shot's start; write `<id>@end` for its last frame. A range is named `range-<from>-<to>` by its frames, a shot by its id.

```
node <skill-dir>/scripts/make.mjs film.json --shot rows --sheets-only --json
node <skill-dir>/scripts/make.mjs film.json --range hook@1..rows@end-0.5 --json
```

The frames are the film's own, asked for by their number in the film, so a tile of a slice is the picture the full run draws at that frame. The report gains `slice: { from, to, frames, shots, silent, skipped }`, only on this run: the frames covered, the shots they touch, whether the film's sound is left out (`silent`: the film has a voice or sound, and a slice never plays it), and `skipped`, the rules a slice does not run.

What is written and what is judged:

- **Sheets.** Only the sheets of the slice are made, into the usual `<out stem>.sheets/` folder, and only the files they rewrite change: the other PNGs there stay as the last run left them. A shot's sheet keeps the tiles whose frame is inside the slice and is left out when none is. A cut's strip is made when the first frame of its window is inside the slice, and then whole, with its side frames, even where they fall outside it.
- **Review.** The audit frames inside the slice are judged. The last frame of every shot the slice touches is drawn as well, but not judged: it tells the review where each text of that shot comes to rest, so a frame in mid-motion is not mistaken for a finished one. So is the last frame of the shot before a cut whose window opens inside the slice: a `match` is compared with it. `still` is read over the slice's frames alone, so a picture that held still before the slice began does not count. `cut-window`, `match`, `hook`, a kind's own findings and a hand look's findings are given only for the shots the slice touches (`match` only where the cut's window opens inside the slice, `hook` only when frame 0 is in it). `unsettled` is judged only for a shot the slice covers from its first frame to its last.
- **Not run.** `loop`, `cut-variety` and `sameness` read the whole film, so a slice leaves them out; the report's `skipped` says so, and so does the text form. Run the film without `--shot` for them.
- **No MP4.** A slice run writes the sheets and the review and no video: `output` is `null`.

`--shot` and `--range` do not go with each other or with `--poster`, `--poster-out`, `--inspect`, `--outline`, `--phonemes`, `--batch`, `--subtitles`, `--workers` or `--preview`; `--sheets-only`, `--out` and `--exact` are accepted. A shot the film lacks is exit 2 with the list of shots in `error.hint`; a `--range` with no `..`, or one that runs backwards (its first frame after its last), is exit 2 naming the form; a time past the end or one that names nothing is refused as above. On a voiced film the shot and the references are checked on the estimated timeline before the voice is made, and the range's order after, on the measured one.
