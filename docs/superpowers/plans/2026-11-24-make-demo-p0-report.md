# make-demo phase 0 report

Can a site be captured frame by frame? Five public sites, signed out, fresh browser, scroll and hover only.

Command (from `plugins/portable-artifacts/skills/make-demo`): `node test/feasibility/probe.mjs test/feasibility/sites.json --out <repo>/.scratch/make-demo-p0/run1`, then again with `run2`. Commit `8e8df7d`, macOS 27.0.1, Apple M4 Pro, Node v24.7.0, 2026-11-24, one browser at a time. Both runs gave the same word for every site.

## Result

Judged by eye: **3 of 5 match, so phase 1 may go ahead once the owner accepts this.** One of the three (Wikipedia) rests on an extra look outside the probe command. Taken from the probe alone, 2 of 5 match. The tool's own word is `no difference found` for 1 of 5.

| Site | Tool, both runs | By eye | Why |
|---|---|---|---|
| react.dev/learn | difference found | **match** | 0 pixels differ from each real run in all 4 steps, both runs. The tool's reason is console lines from the probe blocking the stepped run's Google Analytics posts |
| Excalidraw | no difference found | **match** | 0 to 4 pixels (off by 1 level) from a real run showing the same promo button. The button changes between visits, also between real runs. Hovers only |
| Wikipedia "Web_browser" | inconclusive | **match, extra look** | The probe stopped before comparing: Wikipedia's own analytics post was blocked. The same guarded capture, pictures kept, run twice: 0 pixels differ in all 4 steps from real runs that got the same page, and the accessible tree is equal. Wikipedia shows a donation banner on some visits, real ones too; those runs differ from the rest |
| portable-artifacts Pages | difference found | no | The embedded video plays in real time while the page is stepped 4 times slower, so it is at a different moment. Outside the video box nothing differs, but for up to 1,828 pixels by at most 13 levels where the blurred header lies over or beside it |
| Grafana Play | inconclusive | not compared | The write block stopped its chart queries, flags and live socket, as expected. The owner chose to report it this way |

"By eye" here: side-by-side sheets of stepped against real for react.dev run 1, Excalidraw run 2, portable-artifacts run 2 and both Wikipedia looks, plus full-size pictures of one step each on portable-artifacts, react.dev and Excalidraw in run 1. Every pair in both runs also had an exact pixel comparison, which is what the numbers above are.

## Cost

Stepping and 3x screenshots only; settling, loading and the three real runs are extra. JPEG quality 95, 1280 x 720 at 3x, 30 fps.

| Site | Wall seconds per film second | MB per film second, repeats stored once | MB per film second, all frames |
|---|---|---|---|
| Excalidraw | 2.0 | 0.25 | 7.4 |
| Wikipedia (extra look) | 2.5 | 18.6 | 33.7 |
| react.dev | 4.0 | 4.9 | 15.9 |
| portable-artifacts | 3.9 to 4.3 | 22.4 | 22.4 |

## What the five sites did after load

No write reached a site after load through the probe, as far as it can see (workers and sockets opened during load are not covered). Reads let through per run: 3 to 5 portable-artifacts, 1 to 16 Wikipedia, 16 to 21 react.dev, 0 Excalidraw, 269 Grafana. Before the lock, as any visit does: one analytics post per run on react.dev, one error-report post on Excalidraw, at most one on Wikipedia and Grafana. Blocked afterwards: analytics and error reporting (react.dev, Wikipedia, Grafana) and Grafana's queries and sockets.

## For later phases

- **Video in the page** is not steppable as built. Seek it with the film clock, or film that step in real time.
- **The write block empties dashboards.** Phase 2 needs an allowed list for the site's own queries, agreed in the click plan.
- **Blocking analytics adds console errors** to the stepped run; do not read them as a fault of stepping.
- **Content that changes by visit** (banners, promo buttons) means a take has to be looked at; real visits disagree with each other too.

## Limits

Settled pictures only; no mid-motion frame was compared. Five sites, four of them compared, one machine, one evening. Grafana numbers come from one real run each time. Nothing was clicked or typed. Pictures stay in `.scratch/make-demo-p0/` (not committed, third-party pages).
