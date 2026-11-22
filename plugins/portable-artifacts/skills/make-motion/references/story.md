# Writing a film

How to write the script before you write the JSON. The craft here is advice. The numbers it quotes (pace, the longest a picture may sit still) come from `node scripts/make.mjs --list modes`. A `pro` film runs at 150 words a minute, so a shot of 3 to 6 seconds holds about 8 to 15 words, and a picture may sit still for 6 seconds. A `viral` short runs at 175 words a minute, and a picture may sit still for 3 seconds. How each type of film is shaped is on its own page (the first step of the workflow names them).

## The one thing

Before any shot, write one sentence a viewer could repeat after the film. Put it at the top of the storyline. Every shot serves it or is cut. A film with two things to say is two films.

## Claims

Every number and every claim in a `say` comes from the brief or from the user's material. Anything else is marked as an assumption in the storyline and asked about, or cut. A hook is a claim too: a number, a result or a deadline the brief did not give stays out of it, however well it would land.

## Three storylines

For a film over 15 seconds, when a person is there to answer, offer three storylines before you write shots, and make them three different films, not three phrasings of one. Each gives four things: the first two seconds written out (the opening shot's kind and its exact `say`), the worked example, the arc in one line per shot, and the closing ask. Two storylines that share both their opening kind and their worked example are one storyline: replace one. Write the three to `storylines.md` beside the film, and the user picks one.

When nobody can answer (`claude -p`, `codex exec`, an eval), pick the first and say so in the report. The example films show the shape of the fields; they are not a pace, a look or a shot order to copy.

## Write for the picture

Every line of narration names what is on screen while it is said. If a line has nothing to show, cut it or rewrite it until it does.

- A `number` shot says the number and what it counts. A `chart` shot says the claim the highlighted mark proves. A `clipping` shot says what to look at in the picture, and an `on` event circles it on the word that names it.
- One idea per shot. If a shot needs "and also", it is two shots.
- Cue pass, before the shots are written: mark each line's cue. A number is drawn as a quantity (a `number`, a `chart` mark, a count of things), not printed as a caption. An abstract noun gets one concrete thing from the subject's own world, not the stock picture of its category.
- A turn word (but, instead, until) is where a cut or a `compare` goes. Not every word goes on screen.
- A page you screenshot for a `screen` or `clipping` shot holds made-up, realistic data before the capture: never a real customer's, never filler text, never an empty state.
- Settle the script before the design. Write every shot with only `id`, `show` and `say`, then run `node scripts/make.mjs film.json --outline`. It prints each shot with its start, end and narration, timed from the word count, with no voice and no browser. Read it aloud. Fix the script, then add the other fields.

## Narration

- Write for the ear. Short sentences, one idea each. Write a number as it is spoken in `say` ("four hundred fifty nine"), as digits in `value`. The examples in `--list kinds` do this.
- A list, a timeline or a feed shows one item per sentence, in order. Give the shot one sentence for each item.
- Star the words that carry the point (`*sources*`), a few per film. A film where every line is starred has no emphasis left.
- Mark a pause with `(0.4)` where the picture needs a beat, such as before a number lands.
- Use `--phonemes` on a word with more than one reading (resume, lead, read, live, record) and respell it in `say` until the reading is the one you want.
- Lines that read as machine-written: a "not just this, but that" turn; three one-word sentences in a row; a product told to "unlock" or "meet" something; a figure the brief did not give. Each is right when the picture shows the real contrast it claims.

## The teaching check

Fill these five lines in before you write the shots. If one will not fill, the film is not ready.

1. The one thing: the sentence a viewer could repeat.
2. The worked example the whole film follows.
3. The shot where the picture shows the idea, and the kind that draws it.
4. What the film leaves out.
5. A question the viewer can answer after the film and could not before.

## Tells every look shares

These make a film look generated. Each look also has tells of its own, and the content it suits, in `references/tells.md`.

- A bullet list read aloud word for word. Use `list` with one sentence for each item, or cut to the point; it is right when the list is the thing being read, such as a checklist the viewer follows.
- A chart with no highlighted mark, so nothing says what to see. A highlight is the default; leave it out only when the claim is the pattern as a whole.
- Every shot a `statement`. Mix the kinds: a figure, a picture, a comparison; it is right for a spoken manifesto of short lines.
- The same cut on every shot. Let a cut mean something: `match` carries a shared node across, `slide` moves on, a plain `cut` is a change of subject; one cut throughout is right for a quick run of like items.
- A closing shot that repeats the opening. End on the ask; a repeat is right when it is the ask itself.
- Starred words in every line; it is right only in a film of two or three lines with one star each.

## What the review tells you

`make.mjs` reads every shot back after it draws it. A `mechanical` finding is a fault with a path: change that field and run again. A `creative` finding is a call for you. Open the sheets, look at every one, and write what a stranger would see. Measurements outrank the eye. You cannot listen to the audio, so write only what the report printed about it. The protocol is in `references/reviewing.md`.
