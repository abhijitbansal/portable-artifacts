# Generated b-roll

Guidance for a clip a generator made outside make-motion, brought in as a `media` shot. `make.mjs` never calls a generator and never reaches the network: you or the user make the clip with a tool of your own, save it in the project folder, and name it as the shot's `src`.

## Asking for the clip

- No text inside the picture. The film sets its own type, and a generator's letters cannot be corrected.
- One slow motion of the subject and one camera move, or a locked-off frame. Two moves at once smear.
- Keep it short: a clip plays from `in` to `out`, and the shot needs only the seconds the narration covers.

## Using it

- Trim the tail with `out` before the picture smears. The clip stops there and holds its last frame.
- Write `AI-generated` in `credit`, at most 40 characters; a longer `credit` fails validation.
- A generator's own provenance manifest is lost when the film is encoded, so the visible credit is the only label that survives. Do not leave it out.
- The narration names what the clip shows, as it does for any picture.
