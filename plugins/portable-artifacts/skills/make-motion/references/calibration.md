# How `dead-space` and `scale-contrast` were calibrated

The two composition findings are the only rules whose threshold comes from a table of ours (the `measured` rows in `rules.md`). This page is that table, cut down to its final numbers. The constants themselves are in `engine/looks/fill.mjs` (`DEFAULT_FILL`) and in the `fill` data of the `desk` and `ledger` looks (`engine/looks/desk.mjs`, `engine/looks/ledger.mjs`). A test holds the numbers `rules.md` states equal to those constants; this page records where they came from, and is not read by the code.

## Method

- The last frame of every shot of ten films from `references/examples/v2` (91 shots): `look-cosmos`, `look-poster`, `gate-ledger`, `gate-keynote`, `gate-marker`, `showreel-pro`, `showreel-viral`, `kinds-desk`, `kinds-pop` and `whats-new` (30 shots).
- `band` is the longest empty stretch of the safe rectangle as a share of its side. `extent` is the hero's larger side over the matching safe side. The safe rectangle is 1800 by 960 on a 1920 by 1080 frame (60 px margins).
- A fixed overlay (a slug, a mark, a rule) is furniture and does not count as an element. A caption's reserved zone is taken out of the safe rectangle first. A kind that lays out equals (`peers`: `list`, `compare`, `timeline`, `feed`) is not judged for `scale-contrast`.
- Shots were sorted by eye into "fills well" (12 shots) and "reads empty" (10 shots), then each threshold was set where it separated them, and every shot a threshold flagged was viewed.

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

At 0.40 `dead-space` fired on none of the 91 shots, so it missed every shot that reads empty. At 0.35 every shot that reads empty because of a bare band is caught, and only `look-cosmos` has more than a third of its shots flagged (one of three). The hero outcome is the same from 0.50 to 0.55; 0.50 clears the cluster of near misses at 51 to 54%.

## What fires with the final values

Band 0.35, hero 0.50, `desk` band 0.40, `ledger` band 0.40 and hero 0.45: 9 of the 91 shots, and no film over a third.

| Film | Shots | Firing | Share | Which |
|---|---|---|---|---|
| `look-cosmos` | 3 | 1 | 0.33 | `close` (hero 0.43) |
| `whats-new` | 30 | 6 | 0.20 | the six `look-*` cutout cards (hero) |
| `gate-marker` | 6 | 1 | 0.17 | `print` (hero) |
| `kinds-pop` | 8 | 1 | 0.13 | `hook` (band) |
| the other six films | 43 | 0 | 0 | |

## Reference shots

Fills well, none flagged by the final values: `look-poster` `idea` (band 0.113), `flow` (0.100), `shot` (0.090), `close` (0.146); `gate-ledger` `lede` (0.104), `growth` (0.105), `regions` (0.164), `gap` (0.177), `year` (0.101; hero 0.466), `reach` (0.166), `next` (0.101) and `close` (0.208).

Reads empty, kept: `look-cosmos` `distance` (band 0.394, the lower 40% bare), `whats-new` `no-animation-code` (one quote card alone, 0.159), the six `look-*` cutout cards (a card and one word; hero 0.447 to 0.460), `look-pop` (a 9:16 clip with the right half bare, 0.227) and `frame-zero` (one tall card between wide margins, 0.264).

Removed from the "reads empty" set after viewing: `look-cosmos` `giants` (empty only while its bars grow, which a resting-frame rule cannot see), and `whats-new` `hook`, `locked`, `same-everywhere` and `keepwarm` (statements and lists set flush left, which read as composed).

## Known limits

- The threshold holds for the measure it was computed on. Changing what counts as an element (for example counting fixed overlays) moves the band by 0.05 or more in 17 of the 91 shots.
- A resting-frame rule cannot see a frame that reads empty only while its elements arrive.
- `desk`'s 16:9 statement and 16:9 timeline are let through by the 0.40 band although viewed as sparse; look at them on the sheets even when no finding is printed.
- Two small far-apart elements in one group union into one large box; measured on 415 elements, it moved no threshold.
