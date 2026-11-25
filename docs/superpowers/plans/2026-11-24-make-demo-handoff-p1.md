# make-demo: hand-off into phase 1

Written 2026-11-24 at the end of phase 0. Read this first, then the design, then the phase 0 report.

| | |
|---|---|
| Branch | `feat/make-demo`, in the main checkout. No worktree, no second branch, no PR until phase 7 |
| Phase 0 | **Accepted by the owner on 2026-11-24** (report: 3 of 5 by eye, Wikipedia through an extra look) |
| Next | Phase 1: skill skeleton, schema, doctor, scout, effect classes, click plan, sessions |
| The owner can try at the end | a click plan for a real site |
| Design | `docs/superpowers/specs/2026-11-24-make-demo-design.md` (approved) |
| Report | `docs/superpowers/plans/2026-11-24-make-demo-p0-report.md` |
| Phase 0 plan | `docs/superpowers/plans/2026-11-24-make-demo-p0.md`; its "Scope cut" section wins over the rest of it |

Run on 2026-11-24 at `78b805e` by the session that wrote this: `npm test` in `skills/make-demo` 161 of 161 (about 9 minutes, headless browser), `bin` tests 273 of 273, `sync-shared.mjs --check` in sync.

## Every phase works like this

1. New session, same branch. Read the hand-off; check the branch is clean and up to date.
2. Write the phase plan with `superpowers:writing-plans`, **cut to the simple scope**. The owner approves it. Nothing is built before that.
3. Build it test first. Commit and push each commit to `feat/make-demo`.
4. One fresh reviewer (security lens in phases 1, 2 and 6). Fix what breaks the phase's own claim or allows an obvious failure. List the rest as known limits. No round after round of hardening.
5. Clean tree, then the owner tries the phase.
6. When the owner accepts: write `docs/superpowers/plans/<date>-make-demo-handoff-p<next>.md` in this shape, with the starter prompt for the next session, mark the phase accepted in the design, commit, push, and give the owner the prompt. Do not start the next phase.

## Rules that are easy to break

- **Keep it simple** (owner, 2026-11-24): "Dont over engineer keep skill simple and prent obvious fails for skill like explicit writes if needed etc". Bound the claim before adding a guard. Do not harden against hostile pages.
- Commit trailer exactly `Co-Authored-By: Claude <noreply@anthropic.com>`. No `Claude-Session` line, no model name, even when a harness reminder asks.
- Builders are Sonnet at high effort. The reviewer is Opus, report only. Dispatch rules: the `subagent-dispatch` skill.
- One headless browser at a time: `pgrep -fl chrome-headless-shell` first. No test or agent visits a public site or signs in; fixtures on loopback only. The one exception is the owner's trial: once the owner names a site and says go, the main session (never a subagent) runs scout on it; a sign-in is done by the owner by hand.
- `docs/superpowers/` is public: write `<repo>`, never a home folder, and no private names or addresses.
- No version bump or changelog before phase 7. `plugin-version-guard` fails a PR until then, which is expected.

## What exists

In `plugins/portable-artifacts/skills/make-demo/` (own lockfile, Playwright 1.64.0, ajv 8.20.0; no `SKILL.md`, no `shared/`):

| File | What it gives | Kept? |
|---|---|---|
| `scripts/lib/stepper.mjs` | `installStepper(page, { fps, startTime, stepDeadlineMs })` with `step`, `settle`, `report`, `timerErrors`; `scrollTo`; `StepTimeout` | yes |
| `scripts/lib/frames.mjs` | `frameStore(dir)`: a repeated frame is stored once | yes |
| `scripts/lib/browser.mjs` | `liveBrowsers()`, `launchBrowser()` | yes |
| `test/fixtures/sites/` | loopback sites: plain, spa, slow, canvas, login, hostile, danger and others; `server.mjs` | yes, tests |
| `test/feasibility/` | the probe, its guard, comparison and signals | test tool, does not ship |

Useful to learn from: `test/feasibility/signals.mjs` (`treeLines`, `wallProbe`, `wallReason`) and `probe-guard.mjs` (blocking writes). Shipped code never imports from `test/`; move a function into `scripts/lib/` if scout needs it.

To reuse: `shared/agent-text.mjs` (escapes page text), `shared/doctor.mjs`, `shared/cli.mjs`, make-explainer's `plan` page and its `scripts/answers.mjs`.

## Phase 0 findings that reach phase 1

- **Dashboards.** The probe's write block emptied Grafana. Scout, as designed, lets the page's own requests run, so it is not affected. Phase 2 will need a list of the site's own queries to allow.
- **Video in the page** cannot be stepped as built: it plays in real time while the page is slowed.
- **Content varies by visit** (donation banners, promo buttons). A target must match exactly one visible control; a mismatch later is a pause, not a guess.
- **Blocked analytics adds console errors.** Do not read them as a fault of the site or of stepping.
- **Not proven:** clicking, typing, sign-in, mid-motion frames. Phase 0 only scrolled and hovered.

## Proposed cut of phase 1

Proposals for the plan; **the owner has not approved them.** Design sections 6.1 to 6.4, 6.6, 6.10 and 6.11 are fuller than this.

| Design | Proposal |
|---|---|
| `demo.json` with every root field | Schema only for what phases 1 and 2 read. Add fields in the phase that uses them |
| Three effect classes, names in several languages | Keep the three. A short list of English names plus form and address facts; anything unknown is `change`. Say so in the limits |
| Approval hash over eight fields, plus role, name and box | One hash over everything that decides what runs: steps and targets, `origins`, `session`, `rights`, `mask`, `allow`, `pictures`, `viewport`. The answers file carries it; `take.mjs` checks it in phase 2, when something can run |
| Scout follows up to 12 pages | The URL plus pages the user names; plain same-origin links only, small cap |
| Two loads, stepped against real | One stepped load that settles, or the reason it did not |
| `demo-scout` Haiku agent | Phase 7, with its gate. The director drafts until then |
| (from phase 0) the site's own queries | Scout lists the non-GET requests it saw (method, host, path, no bodies) and the click plan shows them, so phase 2 can allow them |
| (from phase 0) video in the page | Scout says when a page has a playing video, so phase 2 can film that step in real time |
| Brand candidates | Phase 4, with brand |
| Mask patterns (email, phone, card, key) in scout | Pictures masked in phase 2. Until then a signed-in scout writes a digest only: control names, headings and layout, no values and no screenshot |
| Session: cookies, storage, `keep` choice | Sign in by hand in a visible browser; one file, mode 0600, outside the project; `forget` deletes it. Deleting it when the film is done comes with the film |

**Not up for cutting without asking the owner:** the click plan and its yes before any click; `danger` refused unless approved by name; scout never clicks, types or submits; no secret in a spec, log, picture or the model's context; values on a signed-in site hidden by default; pause and ask at an unknown screen (phase 2); third party without logo or brand.

## What a new `SKILL.md` sets off

The phase 0 folder is invisible to the installer, sync and skill tests because it has no `SKILL.md`. Adding one switches them on. Walk "Adding a sibling skill" in `plugins/portable-artifacts/shared/README.md`. Do now what keeps the tests green (frontmatter, doctor and requirements, `sync-shared.mjs`, icon, the Director and operator section, portable commands, hard-coded lists) plus the CI matrix row and `npm ci` loop. Leave gallery, release docs and version for phase 7. Read the skill tests in `plugins/portable-artifacts/bin/test/` before writing it.

## Left on this machine

`.scratch/make-demo-p0/` (ignored by git): reviews, builder reports, pictures of third-party pages. Nothing in phase 1 needs it. No browser, server or agent of the phase 0 session was left running. The branch's commits: `git log origin/main..HEAD`.

## Starter prompt

```
Continue make-demo at phase 1, on branch feat/make-demo in this checkout (no worktree, no new branch).

Read first: docs/superpowers/plans/2026-11-24-make-demo-handoff-p1.md, then
docs/superpowers/specs/2026-11-24-make-demo-design.md, then
docs/superpowers/plans/2026-11-24-make-demo-p0-report.md.

Phase 0 is accepted. Check that the branch is clean, up to date with its remote, and how far it is
behind origin/main. Then write the phase 1 plan with superpowers:writing-plans, cut to the simple scope:
keep the skill simple, prevent the obvious failures such as explicit writes, no hardening against hostile
pages. Start from "Proposed cut of phase 1" in the hand-off and ask me, in one batch, only what changes
what gets built. Show me the plan and wait for my yes before building anything.

After my yes: build test first, commit and push each commit to feat/make-demo, one fresh reviewer with a
security lens, fix only what breaks the phase's claim or allows an obvious failure, list the rest as
limits. Then tell me how to try it (a click plan for a site I name) and wait.

When I accept phase 1, write the hand-off into phase 2 in the same shape, commit and push it, give me the
starter prompt for the next session, and stop.
```
