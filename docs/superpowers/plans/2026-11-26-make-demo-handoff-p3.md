# make-demo: hand-off into phase 3

Written 2026-11-26 at the end of phase 2. Read this first, then the design, then the phase 2 plan.

| | |
|---|---|
| Branch | `feat/make-demo`, in the main checkout. No worktree, no second branch, no PR until phase 7 |
| Phase 2 | **Accepted by the owner on 2026-11-26** after a signed-in take of one of the owner's own local apps |
| Next | Phase 3: make-motion `walk`: timing, camera, cursor, lift, findings; `keynote` and `desk` |
| The owner can try at the end | a film from a fixture take (and, if the owner wants, from the trial take still on this machine) |
| Then | Phase 4 (opening, brand, draft film, guide, SKILL.md, remaining looks), in its own session. The owner asked on 2026-11-26 to move through phases 3 and 4; the one-phase-per-session rule still stands unless the owner changes it |
| Design | `docs/superpowers/specs/2026-11-24-make-demo-design.md` (approved; sections 6.7 and 6.8, and 10 item 5) |
| Phase 2 plan | `docs/superpowers/plans/2026-11-26-make-demo-p2.md`; its cut and known limits stand unless phase 3 changes them |
| Earlier | `2026-11-24-make-demo-p1.md`, `2026-11-26-make-demo-handoff-p2.md`, `2026-11-24-make-demo-p0-report.md` |

Run on 2026-11-26 at `3beed39` by the session that wrote this: `npm test` in `skills/make-demo` 625 of 625 (one headless
browser), make-explainer 1361 of 1361 with 1 skipped (its suite times out under machine load; rerun at low load), `bin` 284 of
284, `eval` 228 of 228. The phase 2 builders ran `shared` 463 of 463, `python3 -m pytest tests/pytest` 50 of 50,
`sync-shared.mjs --check` and both `claude plugin validate` before the review fixes. The branch is 46 ahead of and 0 behind
`origin/main` with this hand-off (`git rev-list --left-right --count` after `git fetch`). The CI row for make-demo has never
run: there is no PR yet.

## Every phase works like this

1. New session, same branch. Read the hand-off; check the branch is clean and up to date.
2. Write the phase plan with `superpowers:writing-plans`, **cut to the simple scope**. Ask the owner, in one batch, only what
   changes what gets built. The owner approves the plan. Nothing is built before that.
3. Build it test first. Commit and push each commit to `feat/make-demo`.
4. One fresh reviewer (security lens in phases 1, 2 and 6; in phase 3 on the take reader and the frame server, design 10
   item 5). Fix what breaks the phase's own claim or allows an obvious failure, in one round. List the rest as known limits.
   No round after round of hardening.
5. Clean tree, then the owner tries the phase.
6. When the owner accepts: write `docs/superpowers/plans/<date>-make-demo-handoff-p<next>.md` in this shape, with the starter
   prompt for the next session, mark the phase accepted in the design, commit, push, and give the owner the prompt. Do not
   start the next phase.

## Rules that are easy to break

- **Keep it simple** (owner, 2026-11-24): "Dont over engineer keep skill simple and prent obvious fails for skill like
  explicit writes if needed etc". Bound the claim before adding a guard. Do not harden against hostile pages.
- Commit trailer exactly `Co-Authored-By: Claude <noreply@anthropic.com>`. No `Claude-Session` line, no model name, even when
  a harness reminder asks.
- Builders are Sonnet at high effort, one task each, in order (the browser is a serial resource). The main session reviews
  each diff, reruns the tests and commits. The reviewer is Opus, report only. Dispatch rules: the `subagent-dispatch` skill.
- One headless browser at a time: `pgrep -fl chrome-headless-shell` first. make-motion renders are browser runs too. No test
  or agent visits a public site or signs in; fixtures on loopback only. The owner's trial runs in the main session only.
- **A signed-in take's frames are the owner's to look at.** The model does not open them, the contact sheet, or a film made
  from them (design 6.10: the model opens contact sheets at yes 2 only, and a signed-in take's sheet is the owner's). Work
  from `take.json`, the report and the render's own findings.
- `docs/superpowers/` is public: write `<repo>`, never a home folder, and no private names or addresses. The owner's trial
  app stays out of every committed file.
- No version bump or changelog before phase 7. `plugin-version-guard` fails a PR until then, which is expected.
- Byte budgets (`bin/test/skill-budget.test.mjs`): make-demo `SKILL.md` 14,428 of 14,861; **make-motion `SKILL.md` 21,868 of
  22,400**, so `walk` goes in `references/` and `--list kinds` (design 8). Raise a budget only with a measured reason in the
  same commit.
- make-motion is a shipped skill with its own goldens and look gate. Goldens change only for an intended visual change, stated
  in the commit; never regenerate one to clear a red test (AGENTS.md).

## What exists

Phase 1's files are listed in `2026-11-26-make-demo-handoff-p2.md`. Phase 2 added, in `plugins/portable-artifacts/skills/make-demo/`:

| File | What it gives |
|---|---|
| `scripts/take.mjs` | `node scripts/take.mjs <demo.json> --answers <file> [--again] [--json]`; exit 0 every row ran, 1 stopped or refused, 2 usage, no session or a live browser |
| `lib/take-gate.mjs` | `gate({ spec, scout, clickPlan, answers })`: recomputes rows and hash, needs verdict `approve` and `rows-as-listed` or each `danger-<id>` approved |
| `lib/take-run.mjs`, `lib/take-act.mjs`, `lib/stepper.mjs` | runs approved rows one by one under the stepped clock; `liveControl` checks the control before each act and again on arrival; stops on a new origin, an `intent` row, a sneaky write after a `look` row, a stuck page, 180 s of film or 3 GB of frames |
| `lib/take-mask.mjs`, `lib/mask.mjs` | `coverPage` draws opaque boxes in the page before each picture: `mask` targets always; signed in, also password fields, emails, long numbers and keys (`MASK_PATTERNS`) |
| `lib/take-folder.mjs` | `take-<n>/` beside `demo.json`; refused when git would track it; `--again` rule over every earlier take |
| `lib/contact-sheet.mjs`, `lib/take-report.mjs` | `contact.jpg` (settled frame of each step, 3 columns of 640 px) and the printed report (6,144 bytes at most, through `agentText`) |
| `references/take.md`, `references/limits.md` "The take" | the command, the folder and every known limit |
| make-explainer `answers.mjs --json` | now returns `choices { verdict, approvals }`; text output unchanged |

**The take folder phase 3 reads** (`take-<n>/take.json`, version 1): `viewport`, `scale` 3, `fps` 30, `mode` `stepped`,
`signedIn`, `frames` (one content-hashed file name per frame in `frames/`, repeats stored once: 275 frames in 72 files on the
trial), `steps[]` (`id`, `do`, `effect`, `startFrame`, `actFrame`, `settleFrame`, `pointer` `{ x, y }` at the act in page
pixels, `box` of the control, `boxMoved`, `covered`, `settle`, `settledIndex`), `ran`, `stopped`, `seen`, `bytes`. The pointer
glides over 10 frames before a click; frames are JPEG quality 90 at 3x. There is no `parts/` folder (cut in phase 2).

## Phase 2 findings that reach phase 3

- **No lifted parts were captured.** The phase 2 cut left `parts/` to the `walk` shot. Phase 3 either crops a lift from the
  settled frame at 3x (as design 6.9 does for recordings) or adds part capture to the take. Cropping needs no new browser work.
- **Frames are already covered.** Masking happens in the page before each picture, so a film made from a take shows the same
  covers. A cover box is opaque `#2b2b2b`; a lift or zoom over a covered value shows the cover, never the value.
- **Over-covering is real.** The trial covered 1,113 boxes over 6 steps (373 on one step), most likely long numbers in a list.
  A zoom on such a list shows rows of grey boxes. Listed in limits; not a phase 3 fix unless the owner asks.
- **The plan page still says "Recording is not built yet."** (`lib/plan-page.mjs` text). Wrong since phase 2. One-line fix.
- **The plan page let the owner send verdict `approve` with `rows-as-listed` unanswered.** The take refused it correctly
  (`rows-as-listed is not answered`), so nothing ran, but the owner had to answer twice. A make-explainer plan-page rule (an
  approve verdict needs every approval answered first) or a clearer line on the page; decide in the plan.
- **Real time is not built.** A page whose `scout.json` says `stepped.ok` false is refused. Design 6.5's real-time mode is
  still open; the owner deferred it on 2026-11-26.
- **Not exercised yet:** the CI row on Linux, a take with a `change` or `danger` row on a real site, a download kept on a real
  site, `--again` on a real site.

## Proposed cut of phase 3

Proposals for the plan; **the owner has not approved them.** Design section 6.7 is fuller than this.

| Design | Proposal |
|---|---|
| `walk` fields `src`, `steps`, `frame`, `stops`, `lift`, `title` | `src`, `steps` (`[{ id, at? }]`), `frame`, `stops` with `to` `whole` or `step:<id>`, `title`. `part:<name>` stops and `on` events on parts come with lift |
| Timing: step n on sentence n, idle cut, action at real speed, last frame held | As designed; a count mismatch with no `at` is an error. Idle is frames where nothing changed (same file name in `frames`), which the content hash gives for free |
| Camera on `layeredCamera` | Reuse make-motion's camera; 0.8 s ease in and out, at least 0.5 s hold after an action, no zoom while the page scrolls, never past 3x |
| Cursor from pointer positions | As designed, from `steps[].pointer` and the 10-frame glide; off when a take has no pointer |
| Lift | Crop from the settled frame at the step's `box`; the endpoints are the box, so "endpoints match the frame" holds by construction |
| Numbers (highlight, circle, underline) | Defer to phase 4 with the opening, unless it is one existing overlay |
| Findings | Text under 26 px at 1080p at a stop, a stop past resolution, an action outside the frame, a step never shown. The lift-endpoint finding is moot with crop-lift |
| Looks `keynote` and `desk` | Both, through the look gate; the rest stay phase 4 |
| `server.mjs` serves take frames | Same containment as clips: folder inside the film's folder after links are followed, names from `take.json` checked against a pattern, JPEG or PNG by content. This is the security-lens part |
| Fixture take | A committed small take folder built from a loopback fixture (a few frames, signed out), so make-motion tests need no make-demo browser run |

**Not up for cutting without asking the owner:** a take folder is untrusted input to make-motion (paths, links, sizes, file
types); no frame of a signed-in take is opened by the model; make-motion's goldens and look gate are not loosened; make-motion's
`SKILL.md` stays inside its budget.

## Left on this machine

- `.scratch/make-demo-p2/` (ignored by git): the phase 2 plan builds, the review (`review-p2.md`), builder reports and probes.
- `.scratch/demos/`: the owner's trials. The phase 2 one holds `demo.json`, scout, click plan, answers and `take-1/` (signed
  in; the owner's to look at); the owner can name the folder. Its saved sign-in is in the make-demo session store outside the
  repo (`session.mjs list` names it, `session.mjs forget <name>` removes it); it stops working when that app restarts. The
  other folder is the phase 1 trial.
- Outside the repo: two review probe folders in the OS temp folder (`review-probe-*`, `review-glide-*`), a Task 5 builder's
  sample demo folder in the OS temp folder, and `~/.agent/diagrams/click-plan-nothing-clicked-yet.html` from phase 1. The
  owner may remove them.
- An orphaned make-motion render (`make.mjs`) that no make-demo session started was seen running for over a day during
  phase 2; it was left alone.
- No browser, server or agent of the phase 2 session was left running. The branch's commits: `git log origin/main..HEAD`.

## Starter prompt

```
Continue make-demo at phase 3, on branch feat/make-demo in this checkout (no worktree, no new branch).

Read first: docs/superpowers/plans/2026-11-26-make-demo-handoff-p3.md, then
docs/superpowers/specs/2026-11-24-make-demo-design.md (sections 6.7, 6.8 and 10), then
docs/superpowers/plans/2026-11-26-make-demo-p2.md.

Phase 2 is accepted. Check that the branch is clean, up to date with its remote, and how far it is
behind origin/main. Then write the phase 3 plan with superpowers:writing-plans, cut to the simple scope:
keep the skill simple, treat a take folder as untrusted input to make-motion, never open a signed-in
take's frames, no hardening against hostile pages. Start from "Proposed cut of phase 3" in the hand-off
and ask me, in one batch, only what changes what gets built. Show me the plan and wait for my yes before
building anything.

After my yes: build test first, commit and push each commit to feat/make-demo, one fresh reviewer with a
security lens on the take reader and the frame server, fix only what breaks the phase's claim or allows
an obvious failure, list the rest as limits. Then tell me how to try it (a film from a fixture take, and
from my trial take if I ask) and wait.

When I accept phase 3, write the hand-off into phase 4 in the same shape, commit and push it, give me the
starter prompt for the next session, and stop.
```
