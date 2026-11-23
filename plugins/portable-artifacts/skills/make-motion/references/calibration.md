# How `dead-space`, `scale-contrast`, `cut-variety` and `sameness` were calibrated

The two composition findings and the two outline findings are the only rules whose threshold comes from a table of ours (the `measured` rows in `rules.md`); the outline rules have their own section below. This page is that table, cut down to its final numbers. The composition constants are in `engine/looks/fill.mjs` (`DEFAULT_FILL`) and in the `fill` data of the `desk` and `ledger` looks (`engine/looks/desk.mjs`, `engine/looks/ledger.mjs`); the outline constants are in `engine/review/outline.mjs`. A test holds the numbers `rules.md` states equal to the constants in both files; this page records where they came from, and is not read by the code.

## Method

- The last frame of every shot of ten films from `references/examples/v2` (91 shots): `look-cosmos`, `look-poster`, `gate-ledger`, `gate-keynote`, `gate-marker`, `showreel-pro`, `showreel-viral`, `kinds-desk`, `kinds-pop` and `whats-new` (30 shots). This is the set the thresholds were chosen on. Task F1b then rewrote `showreel-pro` (9 shots to 11), `showreel-viral` (8 shots, new pictures and cuts) and `look-cosmos` (3 shots to 4, a short statement added): the sweep below was not re-run on the new shots, and the sentence "9 of the 91 shots" under "What fires" is the figure for the 91. What the three films raise now is measured by their draft renders (`make.mjs --json`, 2026-11-22): `showreel-pro` and `showreel-viral` raise no composition finding, and `look-cosmos` raises one in four shots (`close`, `scale-contrast`, hero 0.43, the finding the table below already counts).
- `band` is the longest empty stretch of the safe rectangle as a share of its side. `extent` is the hero's larger side over the matching safe side. The safe rectangle is 1800 by 960 on a 1920 by 1080 frame (60 px margins).
- A fixed overlay (a slug, a mark, a rule) is furniture and does not count as an element. A caption's reserved zone is taken out of the safe rectangle first. A kind that lays out equals (`peers`: `list`, `compare`, `timeline`, `feed`) is not judged for `scale-contrast`.
- Shots were sorted by eye into "fills well" (12 shots) and "reads empty" (10 shots), then each threshold was checked against them, and every shot a threshold flagged was viewed. The two sets cross on both measures (for `band`, the emptiest "fills well" shot is at 0.208 and the fullest "reads empty" shot at 0.159), so no value separates them. 0.35 is the lowest `band` that kept every film at or under a third of its shots flagged, after the `desk` and `ledger` overrides below.

## The values

| Constant | Value | Where it lives |
|---|---|---|
| `band` | 0.35 | `DEFAULT_FILL.band` |
| `hero` | 0.50 | `DEFAULT_FILL.hero` |
| `desk` `fill.band` | 0.40 | its flush-left statements, lists and timelines leave 35 to 39% bare beside the slug and read filled |
| `ledger` `fill.band`, `fill.hero` | 0.40, 0.45 | the same, and its `year` timeline has a hero at 0.466 |
| `HERO_LEAD` | 1.5 | not tunable from this data: 16 peer-kind shots sit at 1.5, so peer kinds are skipped instead |

## Why 0.35 and not a higher band

Share of the 91 shots flagged, and the films with more than a third of their shots flagged, at a hero of 0.55 (ledger 0.45), peers skipped:

| Default band | Films over a third | Shots flagged |
|---|---|---|
| 0.25 | 6 | 34 of 91 |
| 0.30 | 3 (`look-cosmos`, `kinds-desk`, `kinds-pop`) | 21 of 91 |
| 0.35 | 1 (`look-cosmos`, three shots) | 12 of 91 |
| 0.40 | 0 | 8 of 91, all of them hero findings |

At 0.40 `dead-space` fired on none of the 91 shots, so it missed every shot that reads empty. At 0.35 `dead-space` catches the shots that read empty with a band of 0.35 or more (`look-cosmos` `distance` was one, at 0.394) and `kinds-pop` `hook`, and only `look-cosmos` has more than a third of its shots flagged (one of three). It does not catch `no-animation-code` (0.159), `look-pop` (0.227) or `frame-zero` (0.264): they read empty and sit below every band tried, and catching them would put more films over a third. That is the cost of the bound. The hero outcome is the same from 0.50 to 0.55; 0.50 clears the cluster of near misses at 51 to 54%.

## What fires with the final values

Band 0.35, hero 0.50, `desk` band 0.40, `ledger` band 0.40 and hero 0.45: 9 of the 91 shots, and no film over a third.

| Film | Shots | Firing | Share | Which |
|---|---|---|---|---|
| `look-cosmos` | 3 (4 after F1b, still 1 firing, 0.25) | 1 | 0.33 | `close` (hero 0.43) |
| `whats-new` | 30 | 6 | 0.20 | the six `look-*` cutout cards (hero) |
| `gate-marker` | 6 | 1 | 0.17 | `print` (hero) |
| `kinds-pop` | 8 | 1 | 0.13 | `hook` (band) |
| the other six films | 43 | 0 | 0 | |

## Reference shots

Fills well, none flagged by the final values: `look-poster` `idea` (band 0.113), `flow` (0.100), `shot` (0.090), `close` (0.146); `gate-ledger` `lede` (0.104), `growth` (0.105), `regions` (0.164), `gap` (0.177), `year` (0.101; hero 0.466), `reach` (0.166), `next` (0.101) and `close` (0.208).

Reads empty, kept: `look-cosmos` `distance` (band 0.394, the lower 40% bare; the number layout has since been recentred and it now measures 0.267, under 0.35), `whats-new` `no-animation-code` (one quote card alone, 0.159), the six `look-*` cutout cards (a card and one word; hero 0.447 to 0.460), `look-pop` (a 9:16 clip with the right half bare, 0.227) and `frame-zero` (one tall card between wide margins, 0.264).

Removed from the "reads empty" set after viewing: `look-cosmos` `giants` (empty only while its bars grow, which a resting-frame rule cannot see), and `whats-new` `hook`, `locked`, `same-everywhere` and `keepwarm` (statements and lists set flush left, which read as composed).

## The outline rules, `cut-variety` and `sameness`

Both rules read the spec alone, so the table is a run of `node scripts/make.mjs references/examples/v2/<film>.json --outline --json` on every example film (30 films), counting the findings of each rule before any cap (`sameness` is capped at 2 a film for each of its three forms, kind, cut and move, which two examples reach, `cuts-pop` and `whats-new`, each with 2 findings of the kind form, and none exceeds). The constants are `MIN_SEAMS` 4 (a film with fewer cuts is never judged: three cuts make any one of them "more than two thirds"), `REPEATED_CUT_SHARE` 2/3 and `SAME_RUN` 3, in `engine/review/outline.mjs`. The plain `cut` has no window and never counts as the repeated cut.

The bound is the one the composition rules use: if more than a third of the films were flagged, the rule would teach the agent to ignore it. Result: `cut-variety` flags 0 of 30 films, `sameness` flags 2 of 30 (7%), so both stay. Only `sameness` is measured by this table: no example flags `cut-variety`, so its 2/3 share is the plan's number, listed as `unmeasured` in the rules page.

The table was first taken before the showreels were rewritten (task F1b): `showreel-pro` (9 shots) then raised 2 findings (5 `clipping` shots in a row, and the same move, `highlight`, on all 5) and `showreel-viral` (8 shots) raised 2 (5 `media` shots in a row, and the same move, `sweep`, on all 5), so `sameness` flagged 4 of 29 films (14%). The rewrite, which has to show the five pictures and every new feature, breaks each run with another kind (pro: the code shot moved between the pictures, a diagram shot and a statement added; viral: a phone-framed screen shot), so neither film raises a finding now and neither is in the table. The rows below are the table as it stands after that rewrite; the 4 of 29 above is the number the rule was kept on.

| Film | Shots | `cut-variety` | `sameness` | Which |
|---|---|---|---|---|
| `cuts-pop` | 16 | no | 2 | 4 `statement` shots in a row, then 3 |
| `whats-new` | 30 | no | 3 | 7 `media` shots in a row, then 3 `clipping` shots, which also arrive by one slide (`redrawn-diagram` to `redrawn-scene`) three times running |
| `how-it-works` | 15 | no | 0 | |
| the other 27 films, the two showreels among them (11 and 8 shots) | 2 to 16 | no | 0 | |

Each finding is a true one: a run of one kind. The films are left as they are, and `test/v2/review-outline.test.mjs` lists the findings (`KNOWN`). `whats-new` is the only example with a run of one windowed cut, so `cut-variety` itself is held by its unit tests and not by an example.

## Known limits

- The threshold holds for the measure it was computed on. Changing what counts as an element (for example counting fixed overlays) moves the band by 0.05 or more in 17 of the 91 shots.
- A resting-frame rule cannot see a frame that reads empty only while its elements arrive.
- `desk`'s 16:9 statement and 16:9 timeline are let through by the 0.40 band although viewed as sparse; look at them on the sheets even when no finding is printed.
- Two small far-apart elements in one group union into one large box; measured on 415 elements, it moved no threshold.
- `SAME_RUN` 3 was kept although both showreels once ran 5 shots of one kind: raising it to 6 would have flagged only `whats-new` (1 of 29), 8 none. The showreels were a demonstration of one picture kind on five pictures, which is the case the rule exists to ask about, and they were rewritten to answer it instead of the rule being loosened.
- `cut-variety` has never fired on a shipped film, so its 2/3 share is the plan's number, tested only on built films.

## Outside numbers, for comparison only

Six figures from two other tools' briefs for product promo films: video-shotcraft's polish brief and motionmaxxing's layout rules. They are two authors' statements with no measurement behind them that we know of. They never enter the arithmetic of a rule and trigger nothing; the table lets a reader see how far our thresholds sit from two other tools'. The bases differ, and the last column says how.

| Outside figure | From | Our nearest number | The difference of basis |
|---|---|---|---|
| The main subject takes 50 to 75% of the frame's width | video-shotcraft | `hero` 0.50 (`DEFAULT_FILL.hero`; `ledger` 0.45; the `ledger` `year` shot that reads as filled sits at 0.466) | Our `extent` is the hero's larger side over the matching side of the safe rectangle (1800 by 960 on a 1920 by 1080 frame), and the hero may be type. Theirs is a product screenshot's width over the whole frame. On the width, our 0.50 of 1800 px is 0.47 of the 1920 px frame. |
| A safe margin of at least 96 px at 1080 | video-shotcraft | the 60 px margin of the safe rectangle at 1080 | Same frame height, so the two compare directly: our margin is the smaller. Ours is where the review rules judge text and the composition rules count elements; theirs is a layout brief. |
| Headline to body size about 3 to 1 | video-shotcraft | `MIN_HERO_RATIO` 3 (`engine/review/frame.mjs`) | The same number on a different basis: ours is a floor, the `hero` finding fires under 3 times the smallest text on the frame, and it compares the hero with the smallest text, not with the body. Theirs is a target for headline over body. |
| A picture fragment takes at least 0.55 of the frame's width, or is cropped by an edge of the frame | motionmaxxing | none: no rule of ours judges a picture's width | The nearest is the hero `extent` above, which covers type as well as pictures, over the safe rectangle. |
| Readable text inside a picture is at least 0.04 of the frame's height | motionmaxxing | `min-size` 28 units, 0.026 of the short side (one unit is the short side over 1080) | Ours applies to every text on the frame, not only text in a picture. Theirs is 43 px at 1080: about half as large again. `min-size` is `unmeasured` in `rules.md`. |
| Two panels only when one has twice the other's area | motionmaxxing | none: no rule of ours judges panel areas | Not applied to `compare` shots, which are two equal panels by design. |
