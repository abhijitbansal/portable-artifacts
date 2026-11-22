# Tools for looking at one moment

Small commands that draw or measure one part of a film without a whole-film render. This page grows as they arrive: film time first (the one way every command names a moment), then the commands that read it: `--inspect` today.

## Film time

One grammar names a moment of the film. `--poster` and `--inspect` read it today; the commands that follow on this page read the same text. It is read after the film's timeline exists, so a word anchor means the word as this film is timed.

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

Each node is `{ id, type, role?, bbox: [x, y, w, h], opacity, offFrame, text? }`. `bbox` is in canvas pixels. `opacity` is the node's own times those of the groups around it; a node at 0 is left out with everything inside it. `offFrame` is true when the box is not wholly inside the canvas. A text also has `text: { sizeUnits, smallestUnits, ink, landed, outsideSafe }`: `sizeUnits` is the height a viewer reads (in units), `smallestUnits` that of the smallest word on screen, `ink` the box of its glyphs `[x, y, w, h]` in pixels, `landed` whether every word shown is at rest and the text fully opaque, and `outsideSafe` whether its ink leaves the safe rectangle by more than the review allows. These are the numbers the review rules judge (`min-size`, `safe-area`), measured on this one frame; `landed` does not judge whether a camera move has settled, which the review does over the whole shot.

Inside a cut's window the picture and the nodes can disagree, and `cut` says how: `{ name, family, p, from: { shot, seconds, live } }`. `p` is how far the cut has come (0 on its first frame, below 1 inside the window). `from.shot` is the outgoing shot and `from.seconds` the second of that shot the page draws it at: a layer or shader cut (`family` `layer`, `shader`) keeps the outgoing shot moving past its end (`live`: true), and any other cut, or a look drawn by hand, holds it at its last frame. Inside a layer or shader cut's window the PNG is the cut's composition at `p`: each shot is faded, moved or covered as that cut's recipe has it at that `p`, so one of them may be partly or wholly gone. A crossfade, for one, clears the outgoing shot by `p` 0.5 and brings the incoming one in from `p` 0.3, so both show only between 0.3 and 0.5; at 0.5 you see the incoming shot alone, still faint. `nodes` lists the incoming shot alone whatever the picture shows, so a text of the outgoing shot can be in the picture and not in the list; `cut.from` says which shot is going out and where it stands. A cut of family `node` moves the nodes of both shots in one tree, and `nodes` lists them as drawn.
