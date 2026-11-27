# make-demo phase 3: walk look gate record

Plan: `docs/superpowers/plans/2026-11-26-make-demo-p3.md`, Task 7. Films:
`plugins/portable-artifacts/skills/make-motion/references/examples/v2/gate-walk-keynote.json` and `gate-walk-desk.json`, both on
the committed signed-out fixture take `walk-take/` (960 × 540 at scale 3).

The bar (from `2026-11-15-pa2-gate-report.md`): zero mechanical and creative findings, and an independent reviewer who has not
seen the design passes every frame. At most two revision rounds; a look that still fails keeps the kind parked and goes to the
owner.

**Result: walk does not ship in either look. It stays parked (`experimental: true`) in keynote and desk.** It renders when a
film names it, with the report's experimental note, and `--list kinds --all` lists it. The owner decides what happens next.

## Renders

Every render: `node <repo>/plugins/portable-artifacts/skills/make-motion/scripts/make.mjs <film> --out <repo>/.scratch/make-demo-p3/gate/<look>-r<n>.mp4 --json`,
one at a time. Figures are from each run's `--json` report.

| Round | Engine at | keynote | desk |
|---|---|---|---|
| 1 | `5ab07f9` | 510 frames, 0 findings | 480 frames, 0 findings |
| 2 | `f70d08d` (revision 1) | 646 frames, 0 findings | 616 frames, 0 findings |
| 3 | `ad830e1` (revision 2) | 715 frames, 0 findings | 685 frames, 0 findings |

## Reviews (one fresh Opus reviewer per look per round, sheets only)

| Round | keynote | desk |
|---|---|---|
| 1 | NOT YET | NOT YET |
| 2 | NOT YET | NOT YET |
| 3 | NOT YET | NOT YET |

Round 1 faults, both looks: the camera pushed before the whole page was seen (keynote); text sliced at the frame edge on the
push to `add`; the lift read as a dim only; the last click played in the wide shot; marks stayed on to the end; the script did
not match the page.

Revision 1 (engine): 2 s of whole page before any move; step stops frame a context region with no ground beside the page; the
lift eases the camera back so the card rises within the take's own pixels; marks clear at the next step; the last result holds
1 s and the whole page 1.5 s. Director: script matched to the page, `window` frame, a stop on the hover.

Round 2 faults: the lift showed square corners and the card's slot under it (both looks); a mark appeared before the cursor
reached its step (keynote); UI sliced at the top edge during holds (keynote); faint click rings (desk).

Revision 2 (engine): the lift draws through a rounded clip and covers its slot; a mark never starts before its step's act;
keynote marks are rounded ink rectangles; ink click ripples; the last step frames the full width. Director: pauses after the
open and close lines.

Round 3 faults, both looks, the same one: **the pushed frames cut the page's top text** (the header row, the heading or the
tab row) for several seconds, including during the lift. Both reviewers rated it high and confirmed it on full-resolution crops.
Revision 2's own "no sliced word at any hold frame" test passed on the untouched engine, so it does not catch this: it measures
the fixture's text rectangles, and the header row the reviewers saw cut is evidently not among them, or the test's notion of a
slice is looser than a reader's. Other round 3 notes: the activity beat never shows the activity list; the cursor sits on the
label it clicks; the new card is never framed; marks hug the field's own focus border.

Full reports: `<repo>/.scratch/make-demo-p3/gate/review-<look>-r<round>.md`; revision reports `revision1-report.md`,
`revision2-report.md`; sheets `<look>-r<n>.sheets/` (git-ignored, on the build machine).

## What it would take (for the owner)

- The one fault left in both looks is framing: a push onto a small control at up to the take's resolution slices the rows
  around it. The likely fix is a framing rule that snaps the frame's top and bottom to whole page rows. That needs row bounds
  (the take could record the boxes of the visible text lines) or a much wider frame at every stop.
- Or: ship `walk` with stops limited to `whole` and lifts, which round 3 found reads well, and leave pushes for later.
