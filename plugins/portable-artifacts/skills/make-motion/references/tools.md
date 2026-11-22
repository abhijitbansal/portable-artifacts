# Tools for looking at one moment

Small commands that draw or measure one part of a film without a whole-film render. This page grows as they arrive: film time first (the one way every command names a moment), then the commands that read it.

## Film time

One grammar names a moment of the film. `--poster` reads it today; the commands that follow on this page read the same text. It is read after the film's timeline exists, so a word anchor means the word as this film is timed.

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

A time exactly at the film's end names its last frame (`end`, `end-0.01`, `<last-shot>@end`); a time strictly past it is refused, and so is a time before the start. Both errors name the film's length. An unreadable reference, or one that names nothing in the film (an unknown shot, `word:99` in a film of 30 words), is exit 2 with `error.hint` listing the forms and the shots, and nothing is drawn. With `--poster` on a voiced film this is judged on the estimated timeline before the voice is made, so a typo costs no voice; a time past the end is judged after, on the measured one.

```
node <skill-dir>/scripts/make.mjs film.json --poster rows@end-0.5 --poster-out out/rows.png
```
