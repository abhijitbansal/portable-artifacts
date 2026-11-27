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
| `stops` | 0 to 12 of `{ to, at? }` | Camera stops. `to` is `whole` or `step:<id>` |
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
  "stops": [{ "to": "step:tab" }, { "to": "step:add" }, { "to": "whole" }],
  "lift": [{ "step": "hover" }],
  "on": [{ "at": "sentence:3", "do": "circle", "target": "step:search" }]
}
```

## Timing

- Step n plays on sentence n. Give a step `at` to play it on an anchor instead (`references/schema.md`, Anchors). `at` in the
  `end` form is refused: the shot stretches to its steps, so its end is not known. In a shot with a `say`, the steps and the
  sentences must be the same number unless every step has an `at`. Else: `2 steps, 5 sentences: give each step a sentence or an at`.
- A step plays at the take's real speed (30 frames a second). Idle stretches are cut: where more than 15 frames in a row are the
  same file, the first 6 stay. The 10 frames before the step's click stay whatever they are, so the cursor has time to arrive.
- A step's last frame holds until the next step starts, at least 0.5 s.
- If the step before it, with its hold, ends later than its sentence starts, the step starts then. An action longer than its
  words stretches the shot. The shot lasts until the last step's hold ends.
- A shot with no `say` plays its steps one after the other.
- A shot may play fewer steps than the take has, in the take's order. A take step skipped between two played ones is a finding
  (below). A step id the take lacks, or steps out of the take's order, is refused: `step "nope" is not a step of the take (it
  has: open, tab, search, hover, add)`, and `step "tab" comes after "add" in the shot but before "add" in the take: steps follow
  the take's order`.

## Stops

A stop moves the camera over 0.8 s, eased in and out.

- `step:<id>` pushes onto that step's box and lands when that step starts, or at its `at`. The push stops where the take's own
  pixels run out: the camera never shows a frame larger than the take drew it. A step with no box of its own counts as `whole`.
- `whole` goes back to the whole picture. With no `at` it lands 0.5 s after the previous stop's step ends. A first `whole`
  stop with no `at` is the start of the shot and moves nothing.
- A move never starts while a step's last frame holds (the 0.5 s after it ends) or during a `scroll` step. It starts later.
- A stop that cannot land before the next one starts moving is dropped, and is a finding.
- A stop or lift that names a step not in the shot is refused: `no step "serch" in this shot; did you mean "search"? (steps: open, tab, search, hover, add)`.

## Cursor and lift

- The cursor is drawn, an arrow in the look's ink, 5% of the canvas high. It first shows at the first step that has a pointer and
  a box, travels over the 10 frames before each click, and dips as it clicks. A `click` also draws a ring in the look's accent.
  A step with no box leaves it where it was. It never leaves the frame.
- A lift crops the step's settled frame at the step's box. It comes up over 0.4 s from `at` (default 0.5 s after the step
  ends), holds for the look's hold, goes back over 0.4 s, and dims the rest (`keynote` and `desk`: up to 1.12x, held 1.2 s). It never scales past the take's own pixels: at a
  stop that already shows the take's resolution it only dims the rest. The lift's seconds count in the step's hold. A lift on a
  step the take has no box for is refused: `lift on step open: the take has no box for it`.

## Marks

`on` works as on any shot, with the target `step:<id>`: the device aims at that step's whole box. A step with no box of its own is
the whole picture. The default target is `screen` (the frame). Devices: `--list devices`. A mark is on a step's box, not on one
number inside it.

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

16:9 only. Not in a film narrated by one recording. No captured parts: a lift is a crop and no sharper than the frame. Idle
means identical frame files, so a blinking caret or a spinner plays at real speed. A covered value in the take shows as its
grey cover at any zoom. Walk stops make no sound in this phase. The longer list: make-demo's `limits.md`, "The walk shot".
