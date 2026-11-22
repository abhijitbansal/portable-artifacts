# AGENTS.md — portable-artifacts conventions

The engineering guide for **portable-artifacts**, for human contributors and AI coding agents (Claude Code, Cursor,
Codex, …). [`CLAUDE.md`](./CLAUDE.md) imports this file (`@AGENTS.md`), so Claude Code loads it every session in this
repo; other tools read it directly. Whether the import loads it in a given session is checked from the next session's
context listing, not assumed.

This file is adapted from the `AGENTS.md` of the claude-skills repository, where this plugin lived until 2.1.0. The
orchestration, model-routing and branch rules came across unchanged; the claude-skills-only material (inventory-count
sweeps, mods, machine setup, bats) was dropped.

---

## Repo shape (what agents touch)

- **The plugin** lives at `plugins/portable-artifacts/` (skills, shared code, installer, agent file, eval harness). The
  marketplace file `.claude-plugin/marketplace.json` lists it as `portable-artifacts@portable-artifacts`. Existing users
  of the old claude-skills marketplace keep `portable-artifacts@claude-skills`, which resolves to this repo.
- **Tests.** Node tests sit beside the code: `plugins/portable-artifacts/shared/test/`, `bin/test/`,
  `skills/<skill>/test/` and `eval/test/`. Python tests that check the site page and the CI workflow sit in
  `tests/pytest/`. Each skill is a self-contained Node package with its own lockfile: run `npm ci` in the skill folder
  before its tests.
- **CI** (`.github/workflows/test.yml`) runs on every PR: `checks` (manifests, pytest, shellcheck on macOS and Ubuntu),
  `node` (shared copies in sync, shared and installer tests), `node-skills` (one runner per skill, make-motion split into 4 shards and make-scene and make-explainer into 2, with Chromium and
  ffmpeg), `commit-trailers` and `plugin-version-guard`. `webgl-spike-macos` runs by hand only.
  `audit-on-demand-deps.yml` audits the lockfiles of the packages make-motion installs on demand, weekly and on
  changes. `pages.yml` deploys `docs/` on every push to `main` that touches `docs/`,
  `scripts/build_dashboard_gallery.py`, `eval/fixtures/data/**` or `LICENSE`, on a published release and by hand (Pages
  is enabled, source GitHub Actions). It stages `docs/` into `_site` and builds the dashboard gallery ZIPs into it.
  Every action is pinned to a commit SHA with the version in a comment; Dependabot bumps them monthly.
- **Site.** `docs/` is the Pages root, hand-written static files with no build step in the repo (the Pages job adds the gallery ZIPs when it stages
  `_site`). `docs/index.html` is a reel band, the cover sheet and one sheet per skill (a spec excerpt beside the artifact it built, with leader lines);
  `docs/gallery.html` is the register of every output with its spec. `docs/assets/pa.css` and `pa.js` are the only
  stylesheet and script; `docs/media/` holds the muted plate loops (under 2 MB each), posters and thumbnails;
  `docs/showcase/portable-artifacts/gallery/` holds the outputs and their specs. The design system is recorded in
  `.agents/context/DESIGN.md`, product truth in `.agents/context/PRODUCT.md`. Old one-page anchors are redirected by
  the `LEGACY` table in `pa.js`. `docs/superpowers/` keeps design specs and plans; they quote old commands on purpose,
  so leave their text as written. The one exception: machine paths are written as `<repo>` and `<scratchpad>`, never
  a real home folder (the owner scrubbed them on 2026-11-21, since the folder is public).
- **Copy-button contract.** On `docs/index.html`, a command block (`.code.cmds`) holds one
  `<div class="cl"><code class="ct">cmd</code><button class="copy" data-copy="cmd">copy</button></div>` per command: one
  button per command, never one button for several. A trailing `# comment` may stay in the visible `<code class="ct">`
  text but must never appear in `data-copy`. Full multi-line code samples keep a single copy-all button wrapped in
  `.code-body`. `tests/pytest/test_portable_artifacts_page.py` checks the quick-install block, and also pins the sheet
  order, that every local link resolves, that each spec's `x.y KB` label matches the file, that spec lines and plate
  tags pair up, and that the cover's Revision equals `plugin.json`.

---

## Agent behavior

- **Think before coding.** State assumptions; if several readings exist, present them; if something is unclear, stop
  and ask.
- **Simplicity first.** The minimum code that solves the problem. No speculative features, flags or abstractions.
- **Surgical changes.** Touch only what the task requires: don't reformat or "clean up" adjacent skill prose. If your
  change orphans a helper or import, remove it (yours); pre-existing dead code you only flag.
- **Goal-driven execution.** Turn the task into a check that fails first (a failing test for a bug), then make it pass,
  then run the suite. For multi-step work, state a short plan with a verify step each.

---

## Orchestration modes

Pick the cheapest mode that fits the task shape — escalate the mode, don't default to the heaviest:

| Mode | When |
|---|---|
| **Solo** (orchestrator edits directly) | Single-file skill/doc edits, conversational turns, mid-review touch-ups — no dispatch ceremony |
| **Single Agent dispatch** | One bounded delegation with one perspective: a search, a focused skill review, a test-run verify, a doc lookup |
| **Workflow** | Deterministic fan-out over a known work-list (e.g. audit every skill's frontmatter); find→verify pipelines; loop-until-dry discovery; anything needing schema-validated aggregation of many agents |
| **Agent team** | Long-lived roles that need cross-talk and mid-flight steering across phases — determinism matters less than interaction |

A standing ultracode/session directive authorizes orchestration; it does not mandate the heaviest mode — this rubric
picks it. Verification-heavy work (skill audits, reviews, research) defaults to **Workflow with adversarial verify**.

---

## Model routing & dispatch cost

Claude Code's orchestrator dispatches subagents with per-subagent **model tier** and **reasoning effort** overrides.
This section governs those decisions. It is **dispatch guidance only — never grounds for the current session to refuse
or deflect work because of the model it runs as.** If the session's model is below the tier named for a task, note the
mismatch once and proceed.

Rules use **tiers**, not model names (names rot). The mapping is the only line to edit when the lineup changes:

> **Current tier mapping (edit me, not the rules):** planner/orchestrator tier = **Fable 5 / Opus** · reviewer tier =
> **Opus** · executor tier = **Sonnet** · chore tier = **Haiku** (**Sonnet** at low effort when the chore needs a
> little judgment). Fable is the fast planner-tier default for fan-out orchestration; reserve Opus at planner effort
> for the hardest single planning/verification step. Nothing else in this file names a model; `subagent-dispatch`
> defers to this line.

- **Never dispatch with both knobs implicit.** An unset knob silently inherits the orchestrator's — top tier, high
  effort — which for mechanical work is pure waste. Workflow stages set `opts.effort` always, and `opts.model`
  whenever the stage doesn't genuinely need session tier. Agent-tool dispatches likewise. Custom agents pin `model:`
  in frontmatter.
- **Dispatch matrix:**
  | Task | Tier | Effort |
  |---|---|---|
  | Plan authoring · architecture · adversarial verify · judging | planner | high–xhigh (`max` for one hardest verify, never fleets) |
  | Skill/doc implementation · TDD | executor | medium–high |
  | Breadth finders | executor | medium |
  | Phase-gate review of an executor-authored diff, verifier fleets | reviewer | medium (`high` for an adversarial or final review) |
  | Inventory, grep sweeps, digests, file moves, git summaries, checklist generation | chore | low |
- **Effort escalates before tier.** Bump effort one step first, then tier. Escalate when: (a) the *identical*
  diagnostic survives two materially different fix strategies (a *changing* diagnostic is progress — keep iterating);
  (b) a subagent reports a framework-level anomaly or something contradicting the spec — escalate immediately; (c) the
  task turns out to amend a locked convention. Both escalations logged with cause.
- **Executor tier is the floor for any code/skill change.** Chore tier only for the explicit list above — never drafts
  skill content, never edits a `SKILL.md` body or a plugin manifest.
- **Hard rule: build work runs on the executor tier, not above it.** Every implementer dispatch (a feature, a look, a
  fix pass, a revision round) sets the executor tier and `effort: high`. It moves to the reviewer or planner tier only
  through the escalation rule above (effort first, then tier), with the cause written in the run's ledger before the
  dispatch. Reviewers stay at the reviewer tier at medium; plans and the hardest single verification at the planner
  tier at high.
- **Caching etiquette.** Subagents do **not** share the session's prompt cache — each pays its own context from zero.
  Anchor `file:line` in prompts, never re-paste repo code; continue a warm agent via `SendMessage` instead of
  respawning cold; iterate inside the ~5-minute prompt-cache TTL; prefer Workflow **resume** over rerun (completed
  stages replay from cache). For a large package (diff over ~40,000 chars or 1,000 lines) the review prompt gives the
  diff path plus `git diff --stat` and says to read by `offset` and `limit` or per file; small diffs may be read whole.
- **Schema every data-returning dispatch** — parse-and-retry loops are pure token burn.
- **Report delivery.** A subagent report is cut at about 3,000 to 4,000 characters (estimated from transcripts). Put in
  every prompt for an agent whose report you need in full: write the full report to a named file, return its path plus
  a summary of at most 2,500 characters, verdict first, ending `END OF REPORT`; send it once.
- **Shell rules, every session** (macOS zsh, BSD userland): quote globs (`'*.md'`), because zsh stops with
  `no matches found`; no `====` separator lines (zsh reads `=` as a command); use the Edit tool instead of `sed -i`
  (BSD `sed` needs a backup suffix and a failed chain writes nothing); no `timeout` command, it is missing here; list a
  directory before opening a guessed path. `grep` may be ugrep: run `grep -n 'word' <file>`, then Read with an offset,
  and never use `.{0,N}` windows (ugrep stops on complexity).
- **Shell rules with the worktree guard.** Follow these, and put them in every dispatch prompt as COMMAND LIMITS: one
  plain command per Bash call with literal absolute paths; no `cd … &&`, pipes, `;`, shell variables, loops, heredocs,
  or paths outside the worktree except the session scratchpad; scripts via the Write tool under `.scratch/`; run noisy
  commands bare, with no pipe into `head`, `tail` or `grep`. A subagent never runs `rm`: the Blast Radius hold stops an
  `rm` for 10 minutes and a subagent cannot answer it. It writes scratch under `.scratch/` or the session scratchpad by
  literal path, leaves it in place, and lists it in its report; the attended orchestrator removes it with one plain
  `rm -rf <literal absolute path>`, never a variable path. No foreground `sleep` and no `timeout`: use Monitor with an
  until-loop.
- **One headless browser at a time.** Many short-lived headless launches have wedged this Mac. Run
  `pgrep -fl chrome-headless-shell` before a browser-heavy run (Playwright suites, gallery rebuilds, screenshot loops)
  and wait if one is live. CI runs the per-skill browser suites; run one locally only when you must, with
  `--test-concurrency=1`.
- **Close what you start.** Stop an agent or teammate with `TaskStop` once its result is read and no follow-up is
  planned. Commit on green only when the dispatch prompt authorises it; otherwise the orchestrator commits.

---

## Branch & commit workflow

Context: multiple contributors, **PR + CI is the gate**. Work batches onto a feature branch, opens a PR, merges once CI
is green and review passes.

- **Branch first — never commit work directly to `main`.** One integration branch and one PR per plan, wave or topic
  (`feat/<slug>`, `fix/<slug>`, `docs/<slug>`, `chore/<slug>`); the phases are commits on it (`fix(phaseN):` for
  follow-ups). Default to the session's current branch. On `main`, branch off and say so in one line, without asking. A
  second branch only when the owner asks; follow-ups go on the existing branch and PR, and sibling PRs are folded into
  it and closed. Stack branches only when the owner picks that. In a session worktree, rename a `worktree-*` branch to
  the prefix above before the first commit.
- **No finishing menu.** When `superpowers:finishing-a-development-branch` asks how to integrate and the plan names a
  PR, push the branch and open the PR; skip the merge/PR/keep menu.
- **Reviewing or testing a PR: work on that PR's own branch.** Check it out (`gh pr checkout <n>`, or fetch
  `pull/<n>/head` and switch to it), test there, and put follow-up commits (learnings, fixes) on the same branch so
  they ship with the PR. Push author rework to the original PR branch, not a new branch unless asked; open a superseding
  PR only when that branch cannot be pushed, and say why in the new PR. In a session worktree, push with
  `git push origin HEAD:<pr-branch>`. For a contributor's PR:
  - Reproduce each claimed bug with a failing test before you fix it, then leave one PR comment naming the fix commit
    sha and what it changed.
  - When several contributor PRs overlap, merge the oldest first and rebase the rest before re-review.
  - Close a duplicate PR with a comment that points at the surviving one; never merge it.
- **Commits are task-level and atomic** — conventional format (`feat`/`fix`/`refactor`/`docs`/`test`/`chore`), one
  logical change, each leaving the tree green. Prefer several focused commits over one sprawling commit; never bundle
  unrelated edits.
- **Standing authorization to commit and push** at natural boundaries — no per-commit confirmation. Still pause and
  confirm before a **force-push**, a history rewrite of shared history, or pushing directly to a protected branch.
- **Push feature branches** with `-u` once a unit of work is complete and has had the pre-push review (gates below),
  then open a PR. PR body: analyze the full commit history (`git diff main...HEAD`), draft a comprehensive summary,
  include a test plan. A bug-fix PR body opens with four lines: the symptom, the root cause, the fix, and the test that
  failed before it.
- **Pre-review gates, in order:** relevant tests green locally → a fresh-context reviewer (`/code-review` on the diff)
  **before the first push** → CI green on the PR → merge (see Merging) with no CRITICAL/HIGH unfixed. Each code fix ships
  with a regression test that failed first (docs and prose fixes are exempt). MEDIUM/LOW may defer as follow-up
  commits.
- **Merging.** `main` needs the owner's approval, so the owner merges with one plain command:
  `gh pr merge <N> --squash --admin`. An agent confirms CI is green (`gh pr checks <N>`), then ends its report with that
  line, ready to paste; it runs the merge itself only when the owner asks for it in that turn, and then as the single
  plain command, never inside a pipe, `&&` chain or `$(…)`. Before merging a parent PR with `--delete-branch`, retarget
  each open child PR (`gh pr edit <child> --base main`): deleting the parent's branch closes the child, and a closed
  PR's base cannot be changed.
- **After the merge, verify the deploy.** A merge that touches `docs/**` triggers `pages.yml`. Run
  `gh run list --workflow pages.yml --limit 3`; poll until it is green, then fetch the live page and look for a marker
  from the change before saying it is deployed.
- **Plugin versions.** The `plugin-version-guard` job in `test.yml` fails a PR that touches `plugins/<name>/**` and
  leaves that plugin's `.claude-plugin/plugin.json` `version` unchanged. Make one bump per PR, with one
  `plugins/portable-artifacts/CHANGELOG.md` heading: one version bump per merged release, not per commit. A change that
  ships nothing to users puts `[skip-plugin-bump]` in a commit message, which skips the check for the whole PR.
- **Site changes** must keep the copy-button contract above. Verify the rendered page before committing when the change
  is visual: serve `docs/` with `python3 -m http.server --directory docs <free port>`, then navigate, inspect the DOM and
  screenshot (Chrome MCP).
- **Test installs in a temp dir.** Run an installer (`plugins/portable-artifacts/bin/install.mjs`, `npx skills add`)
  against a temporary directory or a fake `HOME`, never the repo checkout: a project-scope install leaves `.agents/`,
  `.claude/skills/` and `skills-lock.json` that shadow the plugin's skills for every later session here.

---

## Shipping a portable-artifacts change

Before the PR for any change under `plugins/portable-artifacts/`. These are the steps no test already enforces; the
install-command guard (`bin/test/install-commands.test.mjs`), the dependency-pin guard and the page test cover the rest.

- **Version and notes.** Bump `plugins/portable-artifacts/.claude-plugin/plugin.json` once (`marketplace.json` carries no
  per-plugin version). Write the new `CHANGELOG.md` heading as user-facing release notes with behaviour changes first,
  then set the cover's Revision in `docs/index.html` to the new version (the page test pins it), and update the plugin
  `README.md` and `USAGE.md`.
- **Shared code.** After editing `plugins/portable-artifacts/shared/`, run
  `node plugins/portable-artifacts/bin/sync-shared.mjs`, then `--check`. Never hand-edit the per-skill `shared/` copies.
- **Goldens** change only for an intended visual change, stated in the commit. Never regenerate one to clear a red test.
- **Gallery.** Rebuild each page under `docs/showcase/portable-artifacts/gallery/` that the change affects, from its
  source spec; set `SOURCE_DATE_EPOCH` so the stamped date is stable and record the value in the PR body. Run
  `check.mjs` on each rebuilt page one at a time (one browser at a time) and open the `--shots` PNGs. Hero images and
  clips come from real files in the repo, never mock-ups. A new output gets a `reg-item` in `docs/gallery.html` (and the
  plate count in its header). If a rebuilt page is a home-page plate, recheck its detail-tag positions and spec excerpt.
  `tests/pytest/test_portable_artifacts_page.py` checks both pages.
- **A new skill** also needs its `test.yml` matrix row and `npm ci` loop entry, its doctor requirements, and an icon in
  `shared/icons.mjs`; the full list is "Adding a sibling skill" in `plugins/portable-artifacts/shared/README.md`.
- **A release showcase** (feature clips, a promo, an explainer with the clips embedded, a guide) follows one order: read
  the `CHANGELOG.md` entry for the release; render one draft clip per capability, one at a time; render one promo in
  viral mode (with voiceover only after `doctor --for voiceover` and one ask); build the explainer in a folder where the
  relative `video` paths resolve (`sections[n].video: file not found` otherwise); write the guide from `USAGE.md`; copy
  the results into the gallery and the register page and run the page test; zip without `rm`; end the report with the
  steps only the owner can do.

---

### Lessons from the voiceover dependency fix (claude-skills PRs #45, #46)

- **Dependencies installed on demand are invisible to the skill's own `npm audit`.** Until 2026-11 make-motion's
  voiceover (`kokoro-js`) was installed with an unlocked `--no-save` install, so audit, Dependabot and CI all reported
  clean while the user's machine got the vulnerable tree (`sharp` 0.34.5, 3 high). Now make-motion's on-demand installs
  are `npm ci --ignore-scripts --prefix <skill>/optional/<name>`, from a committed lockfile in that folder, with the
  folder's own exact-version `overrides`, so `npm audit --package-lock-only` sees them. When you add or bump one: (1)
  audit it with `scripts/audit-on-demand-deps.sh`, which CI also runs weekly in `audit-on-demand-deps.yml` because
  advisories land without a commit; (2) fix transitive advisories with exact-version `overrides` in that folder's
  `package.json`, not by waiting on upstream; (3) keep `--ignore-scripts` on the install while any package in its
  lockfile has an install script (`onnxruntime-node` downloads Linux x64 CUDA libraries, unhashed;
  `bin/test/dependency-pins.test.mjs` fails without the flag). In a guarded worktree (Shell rules above), run
  `npm --prefix <absolute dir> …` or a `.scratch/` script instead of `cd … &&`.
- **Changing an install command or pin is a cross-surface edit.** The doctor fix (`shared/doctor.mjs`, synced into every
  skill with `node plugins/portable-artifacts/bin/sync-shared.mjs`), the runtime error hint (`skills/*/scripts/lib/doctor-hint.mjs`), README,
  USAGE, `references/schema.md` and the changelog all print it. Grep the old form across the whole plugin before you
  push (claude-skills PR #45 fixed the doctor and missed the hint and schema.md; `bin/test/dependency-pins.test.mjs` now
  guards docs and code).
- **A pin that fixes a vulnerability must also reach existing installs.** The doctor's check must go red for an install
  made before the pin (see `staleOverrides` in `shared/doctor.mjs`), otherwise everyone who already installed keeps the
  vulnerable version and is never told. Prove it with a real pre-pin install, not a mock: install without the pin,
  restore it, run the doctor, run `--fix`, confirm the version moved.
- **Never assert a root cause you did not reproduce.** "npm ignores overrides under `--prefix`" went into a PR body and a
  code comment from one environment; a second environment disproved it. Say "reported" and name the environment, as the
  CHANGELOG now does.

---

## Commit / PR trailers

End commit messages with exactly this one trailer:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

No model-named `Co-Authored-By` or `Claude-Session:` line, even where the harness asks; the `commit-trailers` job in
`test.yml` fails a PR that carries one (`scripts/check_trailers.sh`). Dispatch prompts here deny commit; the
orchestrating session commits.

End PR bodies with the Claude Code generation trailer. Follow the repo's existing PR style (see recent merged PRs for
the house format).
