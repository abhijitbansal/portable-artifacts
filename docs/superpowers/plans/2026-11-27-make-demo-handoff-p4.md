# make-demo: hand-off into phase 4

Written 2026-11-27 at the end of phase 3. Read this first, then the design, then the phase 3 plan and its gate record.

| | |
|---|---|
| Branch | `feat/make-demo`, in the main checkout. No worktree, no second branch, no PR until phase 7 |
| Phase 3 | **Accepted by the owner on 2026-11-27** after the two gate films rendered from the fixture take. The trial take was not tried |
| Next | Phase 4: opening, brand, draft film, guide, SKILL.md: the walkthrough end to end; remaining looks |
| The owner can try at the end | a full demo of a real site |
| Then | Phase 5 (promo and recap), in its own session |
| Design | `docs/superpowers/specs/2026-11-24-make-demo-design.md` (approved; sections 6.7, 6.8, 6.11, 8 and 10) |
| Phase 3 plan | `docs/superpowers/plans/2026-11-26-make-demo-p3.md`; its cut and known limits stand unless phase 4 changes them |
| Phase 3 gate | `docs/superpowers/plans/2026-11-26-make-demo-p3-gate.md`: `walk` did **not** pass the look gate and stays parked |
| Earlier | `2026-11-26-make-demo-p2.md`, `2026-11-26-make-demo-handoff-p3.md`, `2026-11-24-make-demo-p1.md`, `2026-11-24-make-demo-p0-report.md` |

Run at `65bec7c` by the session that wrote this: make-demo `npm test` 630 of 630 (one headless browser), make-motion
`npm run test:serial` 5545 pass, 4 skipped, 0 fail, `bin` 284 of 284. Phase 3's Task 6 also ran `shared` 463 of 463, `eval` 228
of 228, `python3 -m pytest tests/pytest` 50 of 50, `sync-shared.mjs --check` (in sync) and both `claude plugin validate` (pass).
On 2026-11-27 both gate films rendered again from the committed take (`make.mjs`): desk 685 frames, keynote 715 frames. The
branch is 65 ahead of and 0 behind `origin/main` with this hand-off (`git rev-list --left-right --count` after `git fetch`). The
CI row for make-demo has never run: there is no PR yet.

## Every phase works like this

1. New session, same branch. Read the hand-off; check the branch is clean and up to date.
2. Write the phase plan with `superpowers:writing-plans`, **cut to the simple scope**. Ask the owner, in one batch, only what
   changes what gets built. The owner approves the plan. Nothing is built before that.
3. Build it test first. Commit and push each commit to `feat/make-demo`.
4. One fresh reviewer (security lens in phases 1, 2 and 6; in phase 4 on whatever reads page text or a take into a film:
   brand proposals and the draft film). Fix what breaks the phase's own claim or allows an obvious failure, in one round.
   List the rest as known limits. No round after round of hardening.
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
  each diff, reruns the tests and commits. Reviewers are Opus, report only. Dispatch rules: the `subagent-dispatch` skill.
- One headless browser at a time: `pgrep -fl chrome-headless-shell` first. make-motion renders are browser runs too. No test
  or agent visits a public site or signs in; fixtures on loopback only. The owner's trial runs in the main session only.
- **A signed-in take's frames are the owner's to look at.** The model does not open them, the contact sheet, a make-motion
  sheet or film made from them, or a guide page with their stills. It never sends them to a reviewer agent. Work from
  `take.json`, the reports and the render's own findings. make-motion prints a `notice:` line for such a film.
- `docs/superpowers/` is public: write `<repo>`, never a home folder, and no private names or addresses. The owner's trial
  app stays out of every committed file and every dispatch prompt.
- No version bump or changelog before phase 7. `plugin-version-guard` fails a PR until then, which is expected.
- Byte budgets (`bin/test/skill-budget.test.mjs`): **make-demo `SKILL.md` 14,428 of 14,861** (433 left; the walkthrough
  goes in `references/`, SKILL.md points to it); **make-motion `SKILL.md` 21,925 of 22,400** (475 left). Raise a budget only
  with a measured reason in the same commit.
- make-motion is a shipped skill with its own goldens and look gate. Goldens change only for an intended visual change, stated
  in the commit; never regenerate one to clear a red test (AGENTS.md). Adding a film to `references/examples/v2/` moves the
  example count and the frozen-timeline fixtures (`test/v2/fixtures/timeline-examples.json`): add the new entries only.

## What exists

Phase 1's files are listed in `2026-11-26-make-demo-handoff-p2.md`, phase 2's in `2026-11-26-make-demo-handoff-p3.md`. Phase 3
added:

| File | What it gives |
|---|---|
| make-demo `scripts/lib/take-text.mjs`, `take-run.mjs` | `textPx` per step: the smallest visible font size in the step's box, CSS px, or null |
| make-demo `scripts/lib/plan-page.mjs` | "After your yes, the take records exactly these rows." and "Answer every approval row before you choose Approve." |
| make-demo `test/fixtures/sites/walk/`, `test/helpers/fixture-take.mjs` | the "Harbor" board page on loopback, and `recordWalkTake` (960 × 540, steps open, tab, search "42", hover, add) |
| make-motion `references/examples/v2/walk-take/` | the committed signed-out fixture take (take.json and 14 frames, 3,012 KB) |
| make-motion `scripts/v2/take.mjs`, `take-frames.mjs`, `inside.mjs` | `readTake(specDir, src, { owner })`: the take as untrusted input (links, sizes, names, magic bytes, header size) |
| make-motion `scripts/v2/prepare/walk.mjs`, `server.mjs` | the `walk` preparer; take frames served as clips by their names, containment checked per request, at most 4 takes a film |
| make-motion `engine/kinds/walk*.mjs` | the kind: retime (idle cut, stretch through the `minSeconds` kind hook), stops `whole` and `step:<id>`, cursor and ripple, lift (a crop, never past native pixels), `on` marks on `step:<id>`, findings |
| make-motion `engine/script/timing.mjs` | `buildTimeline(..., { prepared })` and `kind.minSeconds`; no other kind's timeline moved |
| make-motion `engine/looks/keynote.mjs`, `desk.mjs` | `kinds.walk` look data, **`experimental: true`** |
| make-motion `engine/page/draw.mjs` | opt-in image prop `round` (rounded clip), used by the lift |
| make-motion `scripts/v2/report.mjs`, `batch.mjs`, `run.mjs` | the signed-in `notice:` line in the report, `--batch` and `--preview` |
| make-motion `references/walk.md`, `SKILL.md` kinds sentence | the shot's fields, timing, stops, cursor, lift, marks, findings, limits |
| make-motion `references/examples/v2/gate-walk-keynote.json`, `gate-walk-desk.json` | the gate films (statement, walk of five steps, end) |
| make-demo `references/take.md`, `references/limits.md` "The walk shot" | `textPx`; every known limit of the walk shot |

**How to write a walk shot today** (from the gate films): `{ "show": "walk", "src": "walk-take", "frame": "window", "say": "<one
sentence per step>", "steps": [{ "id": "open" }, …], "stops": [{ "to": "step:tab" }, …, { "to": "whole" }], "lift": [{ "step":
"hover" }], "on": [{ "at": "sentence:2", "do": "circle", "target": "step:search" }] }`. `src` is a take folder inside the
film's folder. Sentence anchors are 0-based.

## Phase 3 findings that reach phase 4

- **`walk` is parked in both looks.** After two revision rounds every fresh look reviewer said NOT YET. The fault left in
  both looks: a push onto a small control cuts the page's top rows (header, heading or tab row) for several seconds.
  Revision 2's no-sliced-word test passed on the untouched engine, so it does not catch this. The owner accepted phase 3
  without choosing a fix. **The owner's choice is the first question of the phase 4 batch.** The two options from the gate
  record:
  1. A framing rule that snaps a stop's top and bottom to whole page rows. The take would record the boxes of the visible
     text lines per step (make-demo), and the camera would use them (make-motion). Then the look gate runs again.
  2. Ship `walk` with `whole` stops and lifts only, which round 3 found reads well, and leave pushes for later.
- **"Remaining looks" depends on that choice.** `cosmos`, `ledger`, `poster` and `pop` cannot pass a look gate for `walk`
  before keynote and desk do. Every other look refuses `walk` today.
- **A parked kind still renders.** A film that names `walk` renders in keynote and desk with the report's experimental note.
  A phase 4 draft film can use it before it ships.
- **Walk stops make no sound.** The zoom device event was removed in phase 3. A cue on a stop is open.
- **The text finding is narrow on a 3x take.** The push is capped at the take's resolution, where text shows at three times
  its page size, so "page text of <n> px shows at <m> px" fires only for text under about 9 px.
- **16:9 only, not with one recording.** A tall canvas and a film narrated by one recording are refused. Vertical comes with
  the promo (phase 5).
- **make-motion's description still says "Not for … a recording of a running app".** Design 8 changes it to point at
  make-demo; phase 3 deferred it to phase 4, with make-demo's `SKILL.md`.
- **Not exercised yet:** a film from a signed-in take (the owner's trial take is still on this machine), a walk of a real
  site's take, the CI row on Linux, a take with a `change` or `danger` row on a real site.

## Proposed cut of phase 4

Proposals for the plan; **the owner has not approved them.** Design sections 6.8 and 6.11 are fuller than this.

| Design | Proposal |
|---|---|
| Walk framing (gate record) | The owner picks option 1 or 2 above. Option 2 is the smaller build and lets `walk` ship in keynote and desk this phase |
| Opening: hook, proof from the user's facts, hand-off from a named thing (`match`, `flood`, `iris`, `zoom`) | Hook and proof from today's kinds (`statement`, `number`, `list`), filled from `demo.json`. The hand-off is whichever of those openings make-motion already has, else a plain cut; check before planning |
| Draft film: `film.mjs demo.json` by rule, no model | One film per take: opening, one `walk` shot of every step (a sentence per step from the step's own label, `step:` stops on the use-case steps, a `whole` return), payoff, `end` with one ask. The agent edits words and stops. A signed-in take's film is rendered by the agent and opened by the owner only |
| Guide: `guide.mjs` writes an explainer spec | Steps with stills (settled frames), the MP4 as a `motion` section. A signed-in take's guide is the owner's to open |
| Brand (6.11): scout proposes accent, logo file and wording, approved on the click plan | Accent and product name only, from what scout already reads, with where each came from, approved on the click plan. Logo later. Contrast rules still apply; fonts and ground stay the look's. A third party's logo is never taken |
| SKILL.md: the walkthrough end to end | A short flow in make-demo `SKILL.md` (433 bytes left) and the detail in `references/walkthrough.md` |
| make-motion description (design 8) | "or a recording of a running app" becomes "use make-demo", inside its 475 bytes |
| Remaining looks (`cosmos`, `ledger`, `poster`, `pop`) | Defer to after `walk` ships in keynote and desk (phase 5 or 7), unless the owner wants them now |
| Stop sound | None, unless the owner asks |

**Not up for cutting without asking the owner:** a take folder is untrusted input to make-motion; no frame of a signed-in take
is opened by the model; make-motion's goldens and look gate are not loosened (a look ships `walk` only after its gate); both
`SKILL.md` files stay inside their budgets; the draft film is written by rule, with no model.

## Left on this machine

- `.scratch/make-demo-p3/` (ignored by git): builder and revision reports, the gate renders, sheets and reviews
  (`gate/`), the security review probes (`review-probes/`), and the 2026-11-27 try renders (`try/desk.mp4`, `try/keynote.mp4`).
- `.scratch/` probes from phase 3: `diag-*.mjs`, `digest-walk*.mjs`, `walk-probe*.mjs`.
- `.scratch/demos/`: the owner's trials. The phase 2 one holds `take-1/` (signed in; the owner's to look at). Its saved
  sign-in is in the make-demo session store outside the repo (`session.mjs list`, `session.mjs forget <name>`).
- Outside the repo: probe folders in the OS temp folder from the phase 2 and phase 3 reviewers, and the phase 1 diagram
  named in the phase 3 hand-off. The owner may remove them.
- No browser, server or agent of the phase 3 session was left running. The branch's commits: `git log origin/main..HEAD`.

## Starter prompt

```
Continue make-demo at phase 4, on branch feat/make-demo in this checkout (no worktree, no new branch).

Read first: docs/superpowers/plans/2026-11-27-make-demo-handoff-p4.md, then
docs/superpowers/specs/2026-11-24-make-demo-design.md (sections 6.7, 6.8, 6.11, 8 and 10), then
docs/superpowers/plans/2026-11-26-make-demo-p3.md and its gate record
docs/superpowers/plans/2026-11-26-make-demo-p3-gate.md.

Phase 3 is accepted; walk is still parked in keynote and desk. Check that the branch is clean, up to date
with its remote, and how far it is behind origin/main. Then write the phase 4 plan with
superpowers:writing-plans, cut to the simple scope: keep the skill simple, treat a take folder as
untrusted input, never open a signed-in take's frames or anything made from them, no hardening against
hostile pages, the draft film written by rule with no model. Start from "Proposed cut of phase 4" in the
hand-off and ask me, in one batch, only what changes what gets built; the walk framing choice comes first.
Show me the plan and wait for my yes before building anything.

After my yes: build test first, commit and push each commit to feat/make-demo, one fresh reviewer, fix
only what breaks the phase's claim or allows an obvious failure, list the rest as limits. Then tell me how
to try it (a full demo of a real site, which I run with you in this session) and wait.

When I accept phase 4, write the hand-off into phase 5 in the same shape, commit and push it, give me the
starter prompt for the next session, and stop.
```
