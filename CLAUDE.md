# CLAUDE.md — portable-artifacts

Instructions for Claude when working in this repository.

@AGENTS.md

## Working in this repo

- The plugin is `plugins/portable-artifacts/`; the site is `docs/` (Pages root, `docs/index.html`). Read
  [`AGENTS.md`](./AGENTS.md) before dispatching subagents, before committing and before opening a PR.
- Edit shared code in `plugins/portable-artifacts/shared/` only, then run
  `node plugins/portable-artifacts/bin/sync-shared.mjs`. The per-skill `shared/` folders are copies.
- Before you push, run what CI runs for the area you touched: `node plugins/portable-artifacts/bin/sync-shared.mjs --check`,
  `node --test "plugins/portable-artifacts/shared/test/*.test.mjs"`, the bin tests (from `plugins/portable-artifacts/bin`:
  `node --test "test/*.test.mjs"`, which needs `npm ci` in `skills/make-motion`), `python3 -m pytest tests/pytest`, and the
  tests of the skill you changed (`npm ci` in its folder first). The per-skill browser suites run in CI; run one locally
  only with no other headless browser live.
- Any change under `plugins/` needs a `plugin.json` version bump and a `CHANGELOG.md` heading in the same PR.
- Install commands print the repo as `abhijitbansal/portable-artifacts`; `portable-artifacts@claude-skills` appears only
  as the legacy name for installs made from the old marketplace.
