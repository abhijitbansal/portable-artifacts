# make-demo phase 4: walk look gate record (whole view and lifts)

Plan: `docs/superpowers/plans/2026-11-27-make-demo-p4.md`, Task 4. Films:
`plugins/portable-artifacts/skills/make-motion/references/examples/v2/gate-walk-keynote.json` and `gate-walk-desk.json`, both on
the committed signed-out fixture take `walk-take/` (960 × 540 at scale 3). Since Task 3 a `step:` stop is refused, so both films
use the whole view and one lift (on `hover`).

The bar (from `2026-11-15-pa2-gate-report.md`): zero mechanical and creative findings, and an independent reviewer who has not
seen the design passes every frame. At most two revision rounds; a look that still fails keeps the kind parked and goes to the
owner.

**Result: walk does not ship in either look. It stays parked (`experimental: true`) in keynote and desk.** It renders when a
film names it, with the report's experimental note. The owner decides what happens next.

## Renders

Every render: `node <repo>/plugins/portable-artifacts/skills/make-motion/scripts/make.mjs <film> --out <repo>/.scratch/make-demo-p4/gate/<look>-r<n>.mp4 --json`,
one at a time. Figures are from each run's `--json` report.

| Round | Engine at | keynote | desk |
|---|---|---|---|
| 1 (pre-gate fixes in) | `ff30528` | 654 frames, 0 findings | 624 frames, 0 findings |
| 2 | `eeaabc5` (revision 1) | 600 frames, 0 findings | 570 frames, 0 findings |
| 3 | `4f7ba3e` (revision 2, then two fixes seen on the render before review) | 612 frames, 0 findings | 582 frames, 0 findings |

## Reviews (one fresh Opus reviewer per look per round, sheets only)

| Round | keynote | desk |
|---|---|---|
| 1 | NOT YET (20 notes) | NOT YET (15 notes) |
| 2 | NOT YET (17 notes) | NOT YET (12 notes) |
| 3 | NOT YET (15 notes, 1 high) | NOT YET (16 notes, 1 high) |

Before round 1 (seen on the main session's own render): a lift on the clicked Add button read as a tiny button under a dark
scrim, so the gate films lift `hover` only; at the whole view a 1.1x lift left 7.4 px to the neighbouring cards, so a whole-view
lift scales 1.06 (`ff30528`).

Round 1 notes, both looks: about 3 s of page with no cursor; the travel to the Add click rushed; click rings over the labels; the
dim muddy over the whole frame; the lifted card losing its border; the last state held about 1 s; keynote's mark read as the
field's own focus border; the dissolve into the walk laid type over the page; the words did not match the beats.

Revision 1 (`eeaabc5`): cursor from the first frame; travel at least 0.6 s; a thin outline ring from 1.6x the cursor; the dim on the
picture only, with the rise; a 3 page px crop margin; a 2 s final hold; keynote's mark 10 units off and drawn on. Director: shorter
first sentence, words that name the search result, title "Projects", explicit cuts.

Round 2 notes, both looks: the cuts (a crossfade laid the headline over the page; earlier a fade had dipped to blank); no click
ring visible on the sheets (too thin); the cursor parked on labels; a white seam under the dimmed page at the title bar;
keynote's mark still read as a border.

Revision 2 (`937067d`): a visible ring (0.08 of the cursor, opaque 0.15 s); the cursor eases off a clicked label after 0.4 s;
the dim covers the whole window at 0.3; both looks mark with an ink ellipse centred on the box; hard cuts in and out of the walk;
no window title. Seen on the round 3 render before review: the ellipse at 1.45x half the box ran out of the window, so the
factor went back to the device's own 1.25 (`09d6eb7`); a ring on the wide search field still crossed the Add button, so the gate
films mark the Activity tab instead (`4f7ba3e`).

Round 3 notes, both looks, the same high one: **the Add click does not read as a click on the button.** The cursor eases off the
button 0.4 s after the act (revision 2), so when the new card appears the tip sits below the button on the Mobile onboarding
card, and the click ring is not on the sheets. Revision 2 caused this. Also both: on its way from the rest point to the Activity
tab the cursor passes over the Add button and puts it in hover; the search beat has only the product's thin outline; the dim
reads muddy; the lift shadow spreads a halo; the window is about 70 to 76% of the frame wide (the look's grid margin limits it,
not `wideShare`). Both hard cuts, the Activity ring, the lift's corners, slot and clearance, and the cards passed.

Full reports: `<repo>/.scratch/make-demo-p4/gate/review-<look>-r<round>.md`; revision reports `revision1-report.md`,
`revision2-report.md`; sheets `<look>-r<n>*.sheets/` (git-ignored, on the build machine).

## What it would take (for the owner)

- **The cursor at a click** (the round 3 high, both looks): keep the cursor on the clicked point until the step settles (its
  result is on screen), then move. This undoes revision 2's ease-off timing; the label it covers is the cost.
- **The path to the first click**: start the cursor at rest in empty page space and route it so it does not cross another
  control on the way.
- **The dim and the shadow**: a lighter, warmer dim and a tighter contact shadow under the lift.
- **A mark on a search result**: today only the product's own outline shows it; a director can ring the matched card.
- With those, a fourth gate round. Or ship `walk` parked as it is: every film that names it renders, with the experimental note.
