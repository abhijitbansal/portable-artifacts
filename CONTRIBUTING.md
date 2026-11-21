# Contributing

Thanks for helping. Bug reports, new chart kinds, shots, looks and host support are all welcome.

## Ground rules

- Open an issue first for anything bigger than a fix, so we agree on the shape before you build it.
- One logical change per PR. Every PR needs the maintainer's review and a green CI run before it merges.
- Skills stay offline and open-source: no hosted APIs, no remote URLs in generated pages, no new dependency
  without a lockfile.
- [AGENTS.md](AGENTS.md) is the full engineering guide, for people and coding agents alike.

## Layout

```
.claude-plugin/marketplace.json   one-plugin marketplace: portable-artifacts@portable-artifacts
plugins/portable-artifacts/       the plugin
  .claude-plugin/plugin.json      name, description, version
  skills/<make-*>/                the five skills: SKILL.md, scripts, tests, own package.json and lockfile
  shared/                         code shared by the skills; synced into each skill by bin/sync-shared.mjs
  bin/                            cross-host installer (install.mjs), sync-shared.mjs, installer tests
  agents/                         the optional artifact-builder agent
  eval/                           cross-host eval harness (fake host, no LLM, in CI)
docs/                             the GitHub Pages site: index.html, gallery.html, assets/, media/, showcase/
docs/superpowers/                 design specs and plans (not published)
tests/pytest/                     checks on the site pages and the CI workflow
scripts/                          audit-on-demand-deps.sh, check_trailers.sh
.agents/context/                  PRODUCT.md and DESIGN.md: product truth and the site's design system
```

Edit shared code in `plugins/portable-artifacts/shared/` only, then run
`node plugins/portable-artifacts/bin/sync-shared.mjs`. The per-skill `shared/` folders are copies.

## Before you open a PR

Run what CI runs for the area you touched:

```sh
node plugins/portable-artifacts/bin/sync-shared.mjs --check
node --test "plugins/portable-artifacts/shared/test/*.test.mjs"
python3 -m pytest tests/pytest
```

For a skill, run `npm ci` and then `npm test` in its folder. The installer tests run from
`plugins/portable-artifacts/bin` with `node --test "test/*.test.mjs"` and need `npm ci` in `skills/make-motion`.

Any change under `plugins/` bumps the `version` in `plugins/portable-artifacts/.claude-plugin/plugin.json` once per PR
and adds a heading to `plugins/portable-artifacts/CHANGELOG.md`. CI checks this.

Golden images and snapshots change only for an intended visual change, stated in the commit message.

## Commits

Conventional format: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`. A bug fix comes with a test that failed
before it.

If an AI agent helped, credit it with `Co-Authored-By: Claude <noreply@anthropic.com>` (or your agent's equivalent).
The `commit-trailers` check rejects `Claude-Session:` lines and model-named `Co-Authored-By` trailers, which some
agents add by default; edit them out before you push.

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
