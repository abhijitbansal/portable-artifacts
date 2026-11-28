# The walk shot

`walk` plays a take from make-demo as a shot: the real frames of a scripted walk through a product, in a browser frame, with the
steps timed to your words. It is for showing a real product, not a drawing of one. Every picture of the product is a frame of the
take, drawn as stored. It is never redrawn and never enlarged past the take's own pixels.

**Parked.** `walk` is parked in `keynote` and `desk` until its look gate passes. A film that names it renders, with a note, and
the report's `kinds` lists it. `--list kinds` does not show it; `--list kinds --all` does. Every other look refuses it. While it
is parked the refusal ends "the looks that support it: none".

## The take folder

make-demo writes a take as `take-<n>/` with `take.json` and `frames/` (make-demo's `take.md` says what is in them). Put a copy
of that folder inside the film's folder, and name it in `src`. A signed-out fixture take sits beside the examples:
`references/examples/v2/walk-take` (five steps: `open`, `tab`, `search`, `hover`, `add`; 960 x 540 at 3x).

The take is untrusted input. make-motion reads it in Node before the page opens and refuses anything that breaks a rule. Nothing
is clamped or repaired. The error is at `shots[<i>].src` and names the take field that broke:

- `src` is a relative path to a folder inside the film's folder, after links are followed. Else: `src "../x" is not a folder inside the film's folder`.
- `take.json` is a regular file of at most 8 MiB, with `version` 1, `fps` 30, `mode` "stepped", a whole `scale` from 1 to 3, a
  `viewport` (320 to 1920 wide, 320 to 1200 tall) and `signedIn` true or false.
- `frames` lists 1 to 6,000 names of the form `<16 hex digits>.jpg` or `.png`. `steps` lists 1 to 200 steps with unique ids.
  Each step's `startFrame`, `actFrame` and `settleFrame` are in order and in range, and a step does not start before the one
  before it settles.
- Each frame is a regular file inside `frames/` (a link that leaves the folder is refused), at most 16 MiB, 3 GiB for the
  distinct frames together. Its first bytes and its header say the type its name says, and its header size is the viewport times
  the scale. The reader does not decode the picture.
- A film uses at most 4 different takes.

## Fields

| Field | Type | Meaning |
|---|---|---|
| `show` | `"walk"` | Required |
| `src` | string | Required. The take folder, relative to the film's folder |
| `steps` | 1 to 40 of `{ id, at? }` | Required. The take steps this shot plays, in the take's order. `id` is a take step id; `at` an anchor |
| `frame` | `browser` (default), `window`, `none` | The frame the picture is drawn in |
| `stops` | 0 to 12 of `{ to, at? }` | Camera stops. `to` is `whole`; `step:<id>` is refused for now (Stops) |
| `lift` | 0 to 4 of `{ step, at? }` | Lift the step's box out of the picture |
| `title` | string, 1 to 40 characters | The browser frame's title |
| `on` | as every shot | Marks. Targets are `screen` and `step:<id>`; the default is `screen` |

The shot has no `url` field. Other fields as every shot (`say`, `cut`, and the rest: `references/schema.md`).

Example, on the fixture take:

```json
{
  "id": "tour",
  "show": "walk",
  "src": "walk-take",
  "title": "Harbor",
  "say": "Open the page. Open the activity tab. Type a number. Point at a card. Add a project.",
  "steps": [{ "id": "open" }, { "id": "tab" }, { "id": "search" }, { "id": "hover" }, { "id": "add" }],
  "stops": [{ "to": "whole" }],
  "lift": [{ "step": "hover" }, { "step": "add" }],
  "on": [{ "at": "sentence:2", "do": "circle", "target": "step:search" }]
}
```

The example circles the search field on its sentence: `sentence:<n>` counts from 0, so the third sentence is `sentence:2`.

## Timing

- Step n plays on sentence n. Give a step `at` to play it on an anchor instead (`references/schema.md`, Anchors). `at` in the
  `end` form is refused: the shot stretches to its steps, so its end is not known. In a shot with a `say`, the steps and the
  sentences must be the same number unless every step has an `at`. Else: `2 steps, 5 sentences: give each step a sentence or an at`.
- A step plays at the take's real speed (30 frames a second). Idle stretches are cut: where more than 15 frames in a row are the
  same file, the first 6 stay. The 10 frames before the step's click stay whatever they are (the cursor's travel starts earlier than that: Cursor and lift).
- A step's last frame holds until the next step starts, at least 0.5 s.
- If the step before it, with its hold, ends later than its sentence starts, the step starts then. An action longer than its
  words stretches the shot. The shot lasts until the last step's hold ends.
- A shot with no `say` plays its steps one after the other.
- A shot whose last stop is `whole` lasts until that stop has landed and the whole picture has held 1.5 s (see Stops). The shot stretches to fit.
- The last step's settled frame holds at least 2.0 s before the shot ends (the result is the walk's payoff), whatever the stops and
  lifts ask. The shot stretches to fit; no other kind's timing changes.
- A shot may play fewer steps than the take has, in the take's order. A take step skipped between two played ones is a finding
  (below). A step id the take lacks, or steps out of the take's order, is refused: `step "nope" is not a step of the take (it
  has: open, tab, search, hover, add)`, and `step "tab" comes after "add" in the shot but before "add" in the take: steps follow
  the take's order`.

## Stops

A stop moves the camera over 0.8 s, eased in and out.

**A stop onto a step is refused for now.** `{ "to": "step:tab" }` gives, at `stops[<n>].to`: `a stop onto a step is parked: a push
can cut the page's rows. Use "whole" and a lift`. A push crops the picture, and the crop can cut through a row of the page. Keep
the whole picture, which is `{ "to": "whole" }` or no stop at all, and lift the step you want read: a lift crops the step's own
box and shows it whole. A look turns pushes back on with `kinds.walk.pushes: true`; no look sets it yet. The rest of this
section says how a push behaves once one does.

- **The whole picture comes first.** No stop's move starts until the shot has shown the whole picture for 2.0 s after its incoming cut
  ends (the shot's own `cut`; with none, from the shot's start). The steps still play on their sentences; only the camera waits.
- `step:<id>` frames a *context region*, not the bare box: the step's box grown to at least 45% of the picture's width and height
  (the looks use 70% wide and 45% high; the shot's last step 99% by 80% with no pad, since the result of the last click can appear
  anywhere: the page's width fills the frame, as large as the page's own margins allow, so the card the click adds is in frame whole and
  its text still reads),
  centred on the box and kept inside the picture. The camera zooms to fit that region inside the look's title-safe pad (`pushPad`),
  never past the take's own pixels. It lands when the step starts, or at its `at`. A step with no box of its own counts as `whole`.
- Once the zoom fills the frame the pan is clamped so no ground shows beside the picture. A frame edge that would fall within 10%
  of the picture's own edge (the `snap` of the look) goes onto that edge: a page keeps its margin there, so no word is sliced. The
  fixture's gate films slice no word at any film frame of any stop hold or lift hold (`test/v2/walk-frames.test.mjs`; a mid-move frame
  may slice for a moment); another take's layout may still put an edge through text, so look at the sheets.
- `whole` goes back to the whole picture. With no `at`, the camera stays on the previous stop's step until its result has held
  1.0 s, then the move takes 0.8 s. A first `whole` stop with no `at` is the start of the shot and moves nothing. When the last stop
  is a `whole`, the shot holds the whole picture at least 1.5 s before it ends.
- A move never starts while a step's last frame holds (the 0.5 s after it ends), during a `scroll` step, or while a lift is up (until
  its card starts back). It starts later.
- A stop that cannot land before the next one starts moving is dropped, and is a finding.
- A stop or lift that names a step not in the shot is refused: `no step "serch" in this shot; did you mean "search"? (steps: open, tab, search, hover, add)`.

## Cursor and lift

- The cursor is drawn, an arrow in the look's ink with a paper keyline and a soft shadow so it reads on white, 5% of the canvas high
  (measured on the arrow's own path). It is on from the shot's first frame, at rest 62% across and 70% down the page until it travels to
  the first step that has a pointer and a box (a take with no pointer at all has no cursor); a rest point that lands inside a step's
  box goes just under that box. Each travel to a click takes at least
  0.6 s, ending on the step's act: it starts early, borrowing from the previous step's hold, but never before that step's act and never
  while a lift holds its card up (it waits until the card starts back down). A step that acts within 0.6 s of the previous one's act
  travels for as long as that gap allows. The cursor dips as it clicks (never under 4% of the canvas height, also in the whole-picture
  pull-back). A `click` also draws a ripple: an outline ring (the look's `ripple`, ink on a wider paper keyline; 0.08 of the cursor's
  size thick, about 4 px at 1080p) that starts 1.6 times the cursor's size and grows outward to 2.6 times over 0.45 s, fully opaque
  for its first 0.15 s and then fading, so it is seen, and the clicked label stays readable inside it. After a click the cursor
  stays exactly on the clicked spot until the step's result is on screen (the step's last kept frame) and 0.3 s more, so the click
  reads as a click, then eases over 0.3 s to a point one cursor size down and right of it (kept inside the picture), so the label it
  clicked reads during the hold; when the next travel must set off before that ease can finish, the cursor goes straight from the
  click into that travel, with no ease. After a hover it stays on the card (a lift needs it there). A step with no box leaves the cursor
  where it was. It never leaves the frame.
- A lift crops the step's settled frame at the step's box grown by 3 page px on each side (clamped to the frame, so the card's own
  border comes along), drawn through a rounded rectangle of the look's `lift.radius` plus 3 (page px; the page's own card corner, kept
  concentric), so no square corner shows; the crop never shows a pixel outside that box. It comes up over 0.4 s from `at`
  (default 0.5 s after the step ends), scales to 1.08x (1.04x at the whole view, with the camera at zoom 1: the look's `wholeScale`, so
  the raised card keeps 10 px off its neighbours), rises (the look's `rise`, `wholeRise` at the whole view, held to 60% of the card's
  own growth so the raised card still covers its slot), holds for the look's hold (1.2 s), and goes back over 0.4 s. It carries a clear
  shadow of the look's own. The whole framed window, title bar included (not the ground round it), dims under a scrim of 0.3 with no
  hole, rising with the card and leaving as it returns: the card's own slot is dimmed too and the raised card covers it, so no
  outline of the slot shows (`keynote` and `desk`: `kinds.walk.lift`).
- The camera eases its zoom down with the card so the card can scale within the take's own pixels (camera zoom at most the native zoom
  over the card's scale), and keeps the whole card inside the title-safe pad. At every frame the card's scale is held to the native
  zoom over the camera's, so a lift never draws past the take's own pixels; a take with no room to zoom keeps the camera and the card
  at 1x. The lift's seconds count in the step's hold. A lift on a step the take has no box for is refused:
  `lift on step open: the take has no box for it`.

## Marks

`on` works as on any shot, with the target `step:<id>`: the device aims at that step's whole box. A step with no box of its own is
the whole picture. The default target is `screen` (the frame). Devices: `--list devices`. A mark is on a step's box, not on one
number inside it.

A mark aimed at a step is cleared: it fades out when the next played step starts, or 2.0 s after it is drawn if that is sooner, and it
is never left up over a lift (it clears as the lift starts). A mark never starts to draw before its step acts: its landing moves
later, so its first stroke is on the step's act. The look styles it as an overlay (`kinds.walk.mark`): a `circle` on a step is an ink
ellipse drawn on by the circle device (in `keynote` a clean ellipse; in `desk` the hand circle), centred on the step box with radii of
1.25 times half the box, and at least 8 units past each side. On a wide, short box (a search field) the ellipse crosses the box
near its two ends: mark a small control, or lift the field instead. Both keep out of the title-safe pad of the frame while the
camera rests (on the old step stops, parked, a wide ellipse can reach past the frame's edge). A mark aimed at `screen` is the device as built. The draw-on lands on `at`, so aim the mark at the sentence of its step
(`sentence:<n>` counts from 0).

## Findings

The review reports these. They are advice, never errors. Each says what to change.

| Finding | What to do |
|---|---|
| `step "<id>": page text of <n> px shows at <m> px at its stop; push closer or lift it` | The page's text shows under 26 px (on a 1080 px tall canvas) at that stop. Push onto a smaller box, or add a `lift` |
| `step "<id>": page text of <n> px shows at <m> px at its stop; the take's own resolution stops the push at <z>x; lift it instead` | The push cannot go further. Add a `lift` of that step |
| `step "<id>"'s action leaves the frame` | The step's box, or the pointer at its click, is outside the camera's view while it runs. Move or drop the stop before it |
| `take step "<id>" is not in this shot's steps: the film jumps across it` | Add that step, or accept the jump |
| `stop <n> has no room to move` | The stop leaves the camera where it was. Remove it, or aim it at another step |
| `stop <n> cannot land before stop <n+1> starts moving, so it is dropped: give the stops more time apart, or remove one` | Give the stops an `at` further apart, or remove one |

The text finding needs the step's `textPx` from the take (make-demo records it). A step with no `textPx` gets none. On a 3x take
the push is capped where the text already shows at three times its page size, so the finding fires only for text under about
9 px; for small text on such a take use a `lift`.

## Refusals

- A canvas that is not wide: `walk needs a wide frame (16:9) for now` (at `show`). A tall film (`9:16`) is refused.
- A film narrated by one recording: `walk cannot play in a film narrated by one recording: its shots cannot stretch to their steps; use a made voice, or no voice`.
- A look that has no `walk` data: `kind "walk" is not supported by look "pop"; the looks that support it: none`.

## Signed-in takes

A take recorded signed in (`signedIn` true in `take.json`) holds the user's own pages. The report says so for every walk shot that
plays one: `shot "<id>" plays a signed-in take: its frames, sheets and film are the user's to look at; do not open them.` It is
a line in the text report (`notice: ...`) and in `notices` with `--json`. Then:

- Do not open the take's frames, any sheet or still made from the film, or the film.
- Do not send any of them to a reviewer agent.
- Work from the report and the findings. Hand the user the path to the MP4.

## Limits

16:9 only. Not in a film narrated by one recording. A stop onto a step is refused (Stops): the whole picture and lifts only.
No captured parts: a lift is a crop and no sharper than the frame. Idle
means identical frame files, so a blinking caret or a spinner plays at real speed. A covered value in the take shows as its
grey cover at any zoom. Walk stops make no sound in this phase. The longer list: make-demo's `limits.md`, "The walk shot".

The window is as large as fits the room at the look's `wideShare` (0.88 of the room's width): for a 16:9 take on the gate films the room's
height (the look's grid margin) is what limits it, at 63% of the frame's width in `keynote` and 67% in `desk`, so a wider `wideShare`
changes nothing until the take is wider than 16:9.

Known limits the engine cannot fix (the take or the product decides them):

- The take's viewport can crop the page's last row at the bottom edge of the window: record at a height that holds the list's end.
- A tab that changes only a subtitle (the fixture's Activity tab) shows little change at the whole view: name the change in the words, or pick a step that changes the page.
- Small product text (card sublines, list times, about 10 to 12 px at 1080p) stays small at the whole view, and is unreadable at phone size: lift the step you want read.
