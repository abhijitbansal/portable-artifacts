# Tools for looking at one moment

Small commands that draw or measure one part of a film without a whole-film render. This page grows as they arrive: film time first (the one way every command names a moment), then the commands that read it.

## Film time

One grammar names a moment of the film. `--poster` reads it today; the commands that follow on this page read the same text. It is read after the film's timeline exists, so a word anchor means the word as this film is timed.

| Write | It means |
|---|---|
| `2.5` | 2.5 seconds from the film's start |
| `rows` | the first moment of the shot `rows` |
| `rows@end-0.5` | half a second before the end of `rows` |
| `rows@word:0` | where the picture shows the first word of `rows` |
| `word:12` | the 13th word of the whole film (counting from 0), where it is heard |
| `sentence:2+0.3` | 0.3 seconds after the third sentence of the film starts |
| `end-1` | one second before the film's end |

The forms are tried in this order, and the first that fits wins:

1. A plain number of seconds.
2. `<shot-id>@<anchor>`: the anchor read inside that shot, as a device's `at` is read (`start`, `end`, `word:<n>`, `word:<text>`, `sentence:<n>`, each with an optional `+<s>` or `-<s>`). A word is where the picture shows it.
3. A shot id alone: that shot's start. A shot called `end` or `start` is the shot, never the film's end or start; to reach the film's end write `end-0` or a number.
4. An anchor across the whole film, as a cue's `at` is read. `word:<n>` and `sentence:<n>` count across all shots, and a word is where it is heard: the shot's start plus the word's sound time. A narration `lead` can put it before its own shot, a `trail` after. `word:<text>` takes the first word that matches.

A time before the film's start, or past its last frame, is refused; the error names the film's length. An unreadable reference, or one that names nothing in the film (an unknown shot, `word:99` in a film of 30 words), is exit 2 with `error.hint` listing the forms and the shots, and nothing is drawn. With `--poster` on a voiced film this is judged on the estimated timeline before the voice is made, so a typo costs no voice; a time past the end is judged after, on the measured one.

```
node <skill-dir>/scripts/make.mjs film.json --poster rows@end-0.5 --poster-out out/rows.png
```
