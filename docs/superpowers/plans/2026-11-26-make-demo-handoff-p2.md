# make-demo: hand-off into phase 2

Written 2026-11-26 at the end of phase 1. Read this first, then the design, then the phase 1 plan.

| | |
|---|---|
| Branch | `feat/make-demo`, in the main checkout. No worktree, no second branch, no PR until phase 7 |
| Phase 1 | **Accepted by the owner on 2026-11-26** after a click plan of one of the owner's own pages |
| Next | Phase 2: take, masking, both capture modes, report |
| The owner can try at the end | a take folder and its contact sheet |
| Design | `docs/superpowers/specs/2026-11-24-make-demo-design.md` (approved; sections 6.4 to 6.6) |
| Phase 1 plan | `docs/superpowers/plans/2026-11-24-make-demo-p1.md`; its "Cut from the design" stands unless phase 2 changes it |
| Phase 0 | `docs/superpowers/plans/2026-11-24-make-demo-p0-report.md` |

Run on 2026-11-26 at `6063d86` by the session that wrote this: `npm test` in `skills/make-demo` 490 of 490 (about 11 minutes,
one headless browser), `bin` 284 of 284, `shared` 463 of 463, `eval` 228 of 228, `python3 -m pytest tests/pytest` 50 of 50,
`sync-shared.mjs --check` in sync. The branch is 34 ahead of and 0 behind `origin/main` (`git rev-list --left-right --count`
after `git fetch`). The CI row for make-demo has never run: there is no PR yet.

## Every phase works like this

1. New session, same branch. Read the hand-off; check the branch is clean and up to date.
2. Write the phase plan with `superpowers:writing-plans`, **cut to the simple scope**. Ask the owner, in one batch, only what
   changes what gets built. The owner approves the plan. Nothing is built before that.
3. Build it test first. Commit and push each commit to `feat/make-demo`.
4. One fresh reviewer (security lens in phases 1, 2 and 6). Fix what breaks the phase's own claim or allows an obvious
   failure, in one round. List the rest as known limits. No round after round of hardening.
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
- One headless browser at a time: `pgrep -fl chrome-headless-shell` first. No test or agent visits a public site or signs in;
  fixtures on loopback only. The one exception is the owner's trial: once the owner names a site and says go, the main
  session (never a subagent) runs scout and, in phase 2, the take; a sign-in is done by the owner by hand.
- **Phase 2 is the first phase that clicks.** A take may run only rows the owner approved, through `answers.mjs`, against the
  hash. A `danger` row runs only with its own approval. No test clicks anything off loopback.
- `docs/superpowers/` is public: write `<repo>`, never a home folder, and no private names or addresses. The owner's trial
  site stays out of every committed file.
- No version bump or changelog before phase 7. `plugin-version-guard` fails a PR until then, which is expected.
- `SKILL.md` has a byte budget (`bin/test/skill-budget.test.mjs`, 13,850 bytes; it is at 13,772). Put new detail in
  `references/`, and raise the budget only with a measured reason in the same commit.

## What exists

In `plugins/portable-artifacts/skills/make-demo/` (own lockfile, Playwright 1.64.0, ajv 8.20.0, `SKILL.md`, synced
`shared/`, CI row with `--test-concurrency=1`):

| File | What it gives |
|---|---|
| `scripts/validate.mjs`, `lib/schema.mjs`, `lib/spec.mjs` | `demo.json`, closed schema: `version`, `source.url`, `origins`, `rights`, `viewport`, `session`, `pages`, `useCases[].steps[]` (`do`, `target` `{ role, name }` or `{ css }`, `value`, `intent`), `generatedBy` |
| `scripts/session.mjs`, `lib/session-store.mjs` | `login` (headed bundled Chromium, saved when the user closes the window), `list`, `forget`; `readSession(name, origins)` returns state cut to those origins |
| `scripts/scout.mjs`, `lib/scout-run.mjs`, `scout-page.mjs`, `visit.mjs`, `digest.mjs`, `page-facts.mjs`, `digest-print.mjs`, `scout-stepped.mjs`, `scout-write.mjs`, `wall.mjs`, `shot.mjs` | read-only scout of up to 6 pages; `openVisit` is the guarded context (service workers blocked, downloads refused, dialogs dismissed, popups closed, a main-frame move off `origins` or not a GET aborted, non-GET requests listed); writes `scout/scout.json` and signed-out `scout/p*.jpg` |
| `lib/effects.mjs`, `lib/mask.mjs`, `lib/page-identity.mjs` | `classify`, `dangerWord`, `isFollowable`; `maskText`, `maskPath`; page identity keeps `#/` and `#!` routes |
| `scripts/build.mjs`, `lib/plan-rows.mjs`, `plan-page.mjs`, `mark-shots.mjs`, `explainer.mjs` | rows, errors and `planHash(spec, rows)`; the plan page as a make-explainer plan spec with `key: "demo-<hash>"`; boxed pictures |
| `scripts/make.mjs`, `check.mjs`, `doctor.mjs`, `lib/requirements.mjs`, `lib/siblings.mjs` | the commands every skill has; make-explainer is a required sister skill |
| `lib/stepper.mjs`, `lib/frames.mjs`, `lib/browser.mjs` | phase 0: the stepped page clock, the frame store, `liveBrowsers`, `launchBrowser(chromium, { headed })` |
| `references/schema.md`, `references/limits.md`, `references/examples/walkthrough.demo.json` | the fields, the known limits, a worked file |
| `test/fixtures/sites/` | loopback sites, phase 0's plus `scout/` and more on `/login/home`; `PRIVATE_SEEDS` |

Not shipped: `test/feasibility/` (the phase 0 probe). Shipped code never imports from `test/`.

## Phase 1 findings that reach phase 2

- **What the yes binds.** `planHash` covers `demo.json` without `generatedBy` and use case titles and goals, plus each row's
  id, page, effect and resolved control (`role`, `name`, `css`, `kind`, `href`, `formAction`, `formMethod`). It rides in the
  plan page's `key` (`demo-<12 hex>`), so make-explainer's `answers.mjs` returns it. A take must recompute rows and hash from
  the current `demo.json` and `scout.json`, compare with the answers file's `planKey`, and refuse on any difference, a
  verdict other than approve, or a `danger` row whose `danger-<step id>` approval is not approve. A plan with no `danger`
  row carries one `rows-as-listed` approval instead. The answers file is read only through `answers.mjs`.
- **Signed-in targets are masked.** In a signed-in scout a control's name may be `<email>`, `<number>`, `<key>` or
  `<text N>`, and addresses are origin plus masked path. A take cannot match those names on the live page. Match by `css`
  plus role, and check the live name masks to the stored one.
- **Intent rows** cannot run (`not seen yet`). In phase 2 they are where the take pauses and asks (design 6.4).
- **The site's own non-GET requests** are listed per page (method, origin, masked path, count). The owner's trial page sent
  Cloudflare's challenge and analytics posts on load. Phase 2 needs a rule for these, agreed on the plan, or a stepped take
  of such a page will either block them (and may break the page, as phase 0 saw with Grafana) or let them through.
- **`stepped`** in `scout.json` says whether the first page settled under the stepped clock and whether a video plays in real
  time. A page with a playing video, or one that does not settle, needs the real-time capture for that step.
- **A `change` or `danger` click makes the next screen unknown** in the plan, so plans return to a page with `goto` after
  each one. The owner's trial plan had 14 steps for 7 controls for that reason. Phase 2 may let a take learn the next screen
  at a pause instead.
- **Downloads are refused** in scout. The owner's use case was "download the resume and cover letter": phase 2 decides
  whether a take keeps a download (and where) or only films the click.
- **Typed values** are shown on the plan as written, signed in too (the author's own words, at most 300 characters, no
  control character). `press` takes key names only; Enter and Space need a target.
- **Not exercised yet:** the headed `session.mjs login` window, the CI row on Linux, a director following `SKILL.md` on a
  site other than the owner's one page.
- **Limits a take inherits** (all in `references/limits.md`): danger words in English only; a GET link outside the word list
  is `look`; script handlers added with `addEventListener` are not seen; a page may move itself within its own origin; a
  server redirect to another origin sends one GET before it is refused; people's names in headings are not masked.

## Proposed cut of phase 2

Proposals for the plan; **the owner has not approved them.** Design sections 6.4 to 6.6 are fuller than this.

| Design | Proposal |
|---|---|
| `take.mjs start` holder process, `resume`, `stop` through files | One process per take with no pause in phase 2: a row that cannot run (intent, a failed match, a new screen) stops the take there and keeps what it has. Pausing and resuming come in a later phase if the owner wants them |
| Frame by frame and real time | Frame by frame by default (phase 0's stepper); real time per step only when `stepped.ok` is false or the step asks for it |
| Masking in the page before every frame | Only on a signed-in take: `mask` targets, password fields, and text matching `maskText`, hidden in the page before each picture. Signed out, nothing is masked |
| The site's own requests | Let them run as scout does, list them in the report, and stop the take on a non-GET request that a `look` row caused (design 6.4) |
| Take folder with `take.json`, `frames/`, `parts/` | `take.json` and `frames/` only; lifted parts come with the `walk` shot in phase 3 |
| 180 s and 3 GB limits | Keep both, plus refuse a take folder that git would track (design 6.5) |
| Report | One printed report and `take.json`: origins contacted, non-GET requests (no bodies), dialogs, popups, downloads refused, masks applied, boxes that moved, where it stopped and why |
| Contact sheet | A grid of the settled frame of each step, one picture |

**Not up for cutting without asking the owner:** only approved rows run, checked against the hash and through `answers.mjs`;
a `danger` row needs its own approval; no secret in a spec, log, picture or the model's context; values on a signed-in site
hidden by default; a new origin stops the take; one headless browser at a time; third party without logo or brand.

## Left on this machine

`.scratch/make-demo-p1/` (ignored by git): plan builds, reviews (`review-p1.md`), builder reports, e2e runs and probes.
`.scratch/demos/resume/`: the owner's trial plan, with pictures of the owner's page. Nothing in phase 2 needs either. No
browser, server or agent of the phase 1 session was left running. Outside the repo, a builder's test run left
`~/.agent/diagrams/click-plan-nothing-clicked-yet.html`; the owner may remove it. The branch's commits: `git log origin/main..HEAD`.

## Starter prompt

```
Continue make-demo at phase 2, on branch feat/make-demo in this checkout (no worktree, no new branch).

Read first: docs/superpowers/plans/2026-11-26-make-demo-handoff-p2.md, then
docs/superpowers/specs/2026-11-24-make-demo-design.md (sections 6.4 to 6.6), then
docs/superpowers/plans/2026-11-24-make-demo-p1.md.

Phase 1 is accepted. Check that the branch is clean, up to date with its remote, and how far it is
behind origin/main. Then write the phase 2 plan with superpowers:writing-plans, cut to the simple scope:
keep the skill simple, prevent the obvious failures such as an unapproved click or a secret in a frame,
no hardening against hostile pages. Start from "Proposed cut of phase 2" in the hand-off and ask me, in
one batch, only what changes what gets built. Show me the plan and wait for my yes before building anything.

After my yes: build test first, commit and push each commit to feat/make-demo, one fresh reviewer with a
security lens, fix only what breaks the phase's claim or allows an obvious failure, list the rest as
limits. Then tell me how to try it (a take of a site I name, from a click plan I approve) and wait.

When I accept phase 2, write the hand-off into phase 3 in the same shape, commit and push it, give me the
starter prompt for the next session, and stop.
```
