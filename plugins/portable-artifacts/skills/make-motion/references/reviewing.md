# Reviewing the film

The protocol for the look step. You open every sheet PNG, describe each shot in one sentence as a stranger would see it, and write the notes into `review.md` next to the film. A reviewer agent reads this file as its checklist.

## Notes

Rank every note, rank first, in this form:

`P1 · time · where · problem → change · what stays`

- **P0**: the film says something false, or a shot cannot be read (clipped or overlapping text, an empty frame, a picture that hides its words). Fix every P0 before you deliver.
- **P1**: a shot is weaker than it could be (a chart with no highlighted mark, unless the claim is the pattern as a whole; a cut that means nothing, a picture the narration does not name).
- **P2**: polish (spacing, a starred word too many, a hold a beat long).

Always say what stays. A note that only attacks a shot invites a rewrite of the shots that work. Edit only the shots the notes name, then build again.

Measurements outrank the eye. When the report printed a number for a thing, quote the number; do not write a judgment over it.

## Never score

No mark out of ten, no percentage, no "looks great". A review is its notes, and a film with nothing to fix writes `no P0 or P1 notes`.

## Pictures alone

Ask one question of each shot: with the narration hidden, does the picture still make the shot's point? If not, the shot leans on the words. Change the picture (a different kind, a highlighted mark, a closer crop) or cut the shot. Write the answer in the shot's one sentence.

## Delivery

Put four labelled lines in the final report. They are its review lines:

- `weakest shot:` the shot id, and why it is the weakest.
- `measured:` what the report printed (findings, durations, sizes), copied and not paraphrased.
- `looked at:` the sheets you opened, by file name.
- `not checked:` what nobody could check. Always carry these four, quoted, not reworded: the sound (no agent can listen); text inside a picture or a clip (the size and contrast rules measure the film's own type, not pixels inside an image); motion between the frames the sheets sample; taste. A line leaves the list only when something the report printed measured it, and the note says what.

When something needed to judge is missing, write `cannot verify` and name what is missing; never guess a baseline. When the brief and the film disagree, report the disagreement and do not pick one.

## Second reviewer

An optional second look, on Claude Code only. If `motion-reviewer` is in your list of available agents (the plugin ships it, possibly listed with the plugin's name before it; `install.mjs claude` writes it, and the doctor offers the command), start it once per finished film, once the sheets exist, with a brief naming the skill directory, the film path (the film's JSON spec, which holds the `say` lines) and the path of the report saved as a JSON file (its `sheets` array names every sheet PNG, each by an absolute path). `make.mjs --json` only prints the report, so save the `make.mjs --json` report beside the film as `<film>.report.json` with Write, and pass that path. The agent file is pinned to Opus whatever model you run on, so each review costs Opus tokens (about 0.30 USD a session in the proof, director included): skip it for a draft. It only reads; it changes nothing, and replies with one JSON object: `verdict`, `notes` (each with `level`, `shot`, `time`, `where`, `problem`, `change`, `stays`), `weakest`, `why`, `measured`, `looked` and `unchecked`. You write `review.md` from that reply, in the note form above, and keep its `unchecked` lines; the agent never writes the file. Otherwise review it yourself with the same checklist: a skills-CLI install and every other host have no such agent, and the review is no worse for that.

Its notes are a second pair of eyes, not a verdict: you still open the sheets, you fix every P0, and you decide what to change. On 2026-11-22 it found all 12 planted defects across three runs of four bad films and failed none of three runs of a clean one (`eval/results/summary-motion-reviewer-2026-11-22.md`); the films were silent with one defect each, and every planted defect could also be read from the film's JSON spec alone. So the proof shows it finds defects that the film's spec and its narration state, and replies in the format above. It does not show that it reads pictures, and it does not show that it finds every defect.
