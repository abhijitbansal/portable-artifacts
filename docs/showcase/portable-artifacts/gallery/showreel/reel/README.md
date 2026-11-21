# make-motion 2 reel

The reel at the top of the site. It is nine make-motion films, one per look plus an intro and a close, joined into one
MP4 by `join.mjs`. Every frame comes from make-motion; `join.mjs` only adds a 0.6 s dip through black between films,
crossfades the sound and normalises it to -16 LUFS.

| File | Look | Shows |
|---|---|---|
| `chapters/00-poster-intro.json` | poster | the counts, as kinetic type, with `punch`, `cover` and `iris` cuts |
| `chapters/01-desk.json` | desk | a dashboard clipping, a hand-drawn circle on a word, the `page-curl` cut |
| `chapters/02-cosmos.json` | cosmos | a bar chart of NASA planet widths, the `ripple` cut, an offline world map |
| `chapters/03-pop.json` | pop (viral mode at 16:9) | a chat feed, the `glitch-memories` and `polka-dots` cuts, a number |
| `chapters/04-ledger.json` | ledger | a bar chart of the 2.2.0 test counts that labels itself |
| `chapters/05-marker.json` | marker | a whiteboard cycle diagram drawn by hand, the `erase` cut |
| `chapters/06-keynote.json` | keynote | a JSON code card, a pipeline diagram, a product screen with a push-in, `blur` and `cross-zoom` cuts |
| `chapters/07-poster.json` | poster | a before/after compare and a list, `punch` and `cover` cuts |
| `chapters/08-keynote-close.json` | keynote | the end card |

## What the reel calls new, and the evidence

Each label on screen is checked against the plugin's `CHANGELOG.md` and `skills/make-motion/references/migrating.md`.

- **Seven looks** (desk, pop, cosmos, ledger, poster, keynote, marker): new in 2.0.0, where a look replaced the nine
  themes (CHANGELOG 2.0.0; migrating.md, "Nine themes and `--theme`"). The marker look is labelled *redrawn*, not new:
  1.2.0 had a hand-drawn style (`"style": "sketch"`) and an `erase` transition, and marker replaces them
  (migrating.md, "Hand-drawn style").
- **Sixteen kinds replace 38 blocks**: CHANGELOG 2.0.0 ("the 38 blocks and `blocks.mjs` (kinds and `--list kinds`)").
- **Ten new WebGL cuts**: `make.mjs --list cuts --json` lists 12 cuts in the `shader` family. 1.x had two WebGL
  transitions, `gl-ripple` and `gl-cube` (CHANGELOG 1.1.0), so ten are new: page-curl, directional-warp, cross-warp,
  cross-zoom, wind, window-slices, polka-dots, glitch-memories, pixelize and water-drop.
- **Frame zero names the product** in a viral film: CHANGELOG 2.0.0 ("A viral film's first frame names the product").
- **Synthesised music beds** (`pulse`, `drift`, `tape`): no 1.x release note mentions a bed; inferred new in 2.0.
  Synthesised sound cues already existed in 1.x, so the reel does not call them new.
- **The 2.2.0 test counts** in the ledger chart come from the local runs listed in the test plan of the 2.2.0 pull
  request (#7, `gh pr view 7`):
  make-motion 4,570, make-explainer 1,318, make-diagram 1,050, make-scene 716, shared 376.
- **The planet widths** come from NASA's Planetary Fact Sheet, as in `look-cosmos.json`.

## Rebuild

From this folder, with make-motion's npm packages and its voice package installed
(`node <skill>/scripts/doctor.mjs --fix kokoro --for voiceover`):

```
node <skill>/scripts/make.mjs chapters/00-poster-intro.json --json --out out/00-poster-intro.mp4
… one per chapter, one at a time …
node join.mjs --out video.mp4 --loop ../../../../../media/reel-loop.mp4 --loop-from 0 --loop-seconds 24 \
  --poster poster.jpg --poster-at 0.9 out/00-poster-intro.mp4 out/01-desk.mp4 … out/08-keynote-close.mp4
```

`<skill>` is the absolute path of `plugins/portable-artifacts/skills/make-motion` in your clone. The render date is stamped in the MP4 metadata, so a
rebuild is not byte-identical.

Nobody has listened to the reel yet. The make-motion reports printed -14.1 to -16.2 LUFS per chapter (pop is the
louder viral master); the joined reel measured -16.0 LUFS integrated with `ffmpeg -af ebur128`.
