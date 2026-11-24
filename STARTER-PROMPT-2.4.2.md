# Starter prompt: finish 2.4.2

Paste the block below into a new session. Delete this file in the last commit before the PR merges.

```text
Finish portable-artifacts 2.4.2 (symlink and output-path containment) and open its PR.

Where
- Repo abhijitbansal/portable-artifacts, branch fix/output-containment. Work in the existing worktree
  <repo>/.claude/worktrees/fix-2.4.1 on this machine. Read AGENTS.md and CLAUDE.md first.
- Code commits: 2790073, d2c957b, 4d4b5db, then the commit that adds this file.
- The branch sits on 3c84776, the head of PR 12 (2.4.1, open when this was written). Leave PR 12 alone.
  Check its state. If it was squash-merged, ask me before moving the commits onto origin/main
  (git rebase --onto origin/main 3c84776; the branch is already pushed, so this needs a force-push).
  If it is still open, ask me how to base the PR.
- Do not touch fix/git-config-gate or other sessions' worktrees.

What 2.4.2 does
- One check (shared/write-file.mjs: assertContained, ensureOutputFolder, writeFileReplacing): an output
  path that lies in a git repository by name must lie there by its real path, checked before any create,
  write or delete. It also covers device paths, FIFOs, kept file modes, marked make-motion work folders,
  the DuckDB spill folder, project-scope agent files and project installs.
- CHANGELOG has [2.4.2]; [2.4.1] must stay identical to 3c84776. plugin.json and the docs/index.html
  Revision are 2.4.2. The docs sweep (SKILL.md sandbox lines) is already on the branch.

History
- Two reviews blocked earlier versions (sec4, sec5). The third fix pass (fix5) is 4d4b5db.
- The fresh Opus gate review of 4d4b5db PASSED: 0 CRITICAL, 0 HIGH, 4 MEDIUM, 20 LOW. Its findings are
  not reproduced or fixed yet.
- Reports (gitignored, only on this machine): .scratch/2.4.2/ in the worktree holds sec4-241, sec5-241,
  fix4-241, fix5-241 and sec6-242 (-report.md). If they are missing, stop and tell me.

Do
1. Read the sec6 report. Reproduce, then fix its 4 MEDIUM, M1 to M4 (Sonnet, effort high, failing test
   first): clips.mjs, sql.mjs twice, write-file.mjs with locate.mjs. Also fix the false doc claims and
   the cheap LOWs; list the rest as limits. Then get a fresh review of that commit by an agent that did
   not write it. If it blocks, stop and ask me about a smaller scope: page builds, screenshots and the
   sheets delete only.
2. Open: the /dev/stdout and socket tests have never run on Linux (CI is their first run). Not run
   either: Windows, npm other than 11.5.1, a real DuckDB spill, the make-motion browser suites as a whole.
3. Gates: sync-shared --check, shared, bin, eval and non-browser skill tests, pytest, both plugin
   validates. One headless browser at a time; never kill a process you did not start.
4. No further push while a CRITICAL or HIGH is open. Then git fetch, report ahead/behind, push, open the
   PR (symptom, root cause, fix, test that failed before; summary, test plan, limits), wait for CI.
5. Build the make-explainer recap page for 2.4.2 and the manual-test checklist (branch-test-checklist).
   Extras are already chosen: recap and docs sweep, no make-motion video.
6. Remove STARTER-PROMPT-2.4.2.md before the PR is ready. End with the paste-ready merge line. Do not
   merge. After I merge, check pages.yml and the live cover for 2.4.2. Then offer
   core-workflow:cleanup-branches once.

Rules
- Commit trailer exactly: Co-Authored-By: Claude <noreply@anthropic.com> (no Claude-Session line).
- No exploit recipe in public text (CHANGELOG, PR body, commits, files on the branch).
- Never execute the downloaded git-lfs builds in the old session's scratchpad (permission was denied).
  Do not run npx skills add.
- Dispatch prompts state: no commit or push, COMMAND LIMITS, QUIET, report file. Reviewers report only.

Left over, not urgent
- Mode-000 folders in $TMPDIR: pa-ex-86ivli and pa-sc-rBHGkr (chmod before removing).
- The old session's scratchpad holds copies with node_modules symlinks into this worktree. Remove the
  links, never their targets.
- Out of scope, listed as 2.4.1 limits: nested repositories and worktrees in the PATH rule, global
  filters, ffmpeg and doctor PATH lookup.
```
