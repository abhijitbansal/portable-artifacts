# Writing a film

How to write the script before you write the JSON. The craft here is advice. The numbers it quotes (pace, the longest a picture may sit still) come from `node scripts/make.mjs --list modes`. A `pro` film runs at 150 words a minute, so a shot of 3 to 6 seconds holds about 8 to 15 words, and a picture may sit still for 6 seconds. A `viral` short runs at 175 words a minute, and a picture may sit still for 3 seconds. How each type of film is shaped is on its own page (the first step of the workflow names them).

## The one thing

Before any shot, write one sentence a viewer could repeat after the film. Put it at the top of the storyline. Every shot serves it or is cut. A film with two things to say is two films.

## Claims

Every number and every claim in a `say` comes from the brief or from the user's material. Anything else is marked as an assumption in the storyline and asked about, or cut. A hook is a claim too: a number, a result or a deadline the brief did not give stays out of it, however well it would land.

## Three storylines

For a film over 20 seconds, draft three storylines before you write shots, and make them three different films, not three phrasings of one. Each gives four things: the first two seconds written out (the opening shot's kind and its exact `say`), the worked example, the arc in one line per shot, and the closing ask. Two storylines that share both their opening kind and their worked example are one storyline: replace one. Fill the teaching check (below) first, then write the three to `storylines.md` beside the film.

Do not ask the user to pick: the intake round in `SKILL.md` is the only question round, and the storyboard step is where a person answers a plan. Take the storyline that best fits the ask and say which one in the report. The example films show the shape of the fields; they are not a pace, a look or a shot order to copy.

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

## Sound across a cut

A cut does not have to land where the sentence ends. A shot's `narration` moves the cut's picture against its sound, in whole frames, by `lead` and `trail`, each from 0 to 1.5 s (default 0). The film is as long as before, and no word is heard at another second.

- `lead`: this shot's narration starts that long before its picture, over the end of the shot before. Use it when the next picture answers what the narration has begun to ask: the line says "and what did they find?" while the old picture is still up, and the finding cuts in as the answer begins.
- `trail`: this shot's narration runs that long into the next shot's picture. Use it when the picture has made its point before the sentence ends, so the viewer reads the next picture while the last words land.
- A `lead` or a `trail` on every cut is a tell, the same as one cut throughout: it stops being a choice. Use none across a change of subject, where the picture and the sentence should turn together. One cut takes a `lead` or a `trail`, not both.
- A `trail` must be longer than the mode's tail (0.6 s in `pro`, 0.3 s in `viral`) for a word to cross the cut; a shorter one only moves silence. A `trail` also ends the picture sooner than the sentence, so a look that holds a shot after its last word (ledger statements, a cosmos end card) loses that hold: keep the trail short there, or leave it out.
- A `trail` shows the incoming shot's first word from frame 0, up to 1.5 s before it is heard. Keep that word one the picture can carry alone, or a starred word the eye need not wait for.
- An `on` event anchored on a word that a `lead` or a `trail` moves outside the shot is an error: it names a word heard before the picture begins, or after it has ended. Anchor a word the shot's own picture covers.
- The first shot takes no `lead` and the last no `trail`; a shot needs `say`; a recorded voice (your own file) sets where its words fall, so it takes none. A shift that leaves a shot under 1 s, or shorter than the cut that opens it, is an error naming the field.

## The teaching check

Fill these five lines in before you write the storylines or the shots. If one will not fill, the film is not ready.

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
- The same cut on every shot. Let a cut mean something, using the cuts the look lists (`--list cuts`): `match` carries a shared node across and `slide` moves on, where the look has them; a plain `cut` is a change of subject; one cut throughout is right for a quick run of like items.
- Every cut the same length of overlap: a `lead` or a `trail` of one length on cut after cut (see Sound across a cut). Let the overlap follow the sentence; it is right when the film is one long argument and each picture answers the line before.
- A closing shot that repeats the opening. End on the ask; a repeat is right when it is the ask itself.
- Starred words in every line; it is right only in a film of two or three lines with one star each.

## What the review tells you

`make.mjs` reads every shot back after it draws it. A `mechanical` finding is a fault with a path: change that field and run again. A `creative` finding is a call for you. Open the sheets, look at every one, and write what a stranger would see. Measurements outrank the eye. Two creative findings judge how a shot fills its frame, once per shot, on its resting frame: `dead-space` (an empty band takes 35% or more of the safe area's width or height; `desk` and `ledger` use 40%) and `scale-contrast` (the hero leads its neighbours but covers little of the frame). Fix the layout, not the number: let the hero take more of the frame, add a second element, or choose another look or kind. The thresholds, the 3 a film cap and the kinds that skip scale-contrast are under Composition findings in `references/schema.md`. You cannot listen to the audio, so write only what the report printed about it. The protocol is in `references/reviewing.md`.
