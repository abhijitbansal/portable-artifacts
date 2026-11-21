# Contributing

Thanks for helping. Bug reports, new chart kinds, shots, looks and host support are all welcome.

## Ground rules

- Open an issue first for anything bigger than a fix, so we agree on the shape before you build it.
- One logical change per PR. Every PR needs the maintainer's review and a green CI run before it merges.
- Skills stay offline and open-source: no hosted APIs, no remote URLs in generated pages, no new dependency
  without a lockfile.
- [AGENTS.md](AGENTS.md) is the full engineering guide, for people and coding agents alike.

## Layout

- `plugins/portable-artifacts/skills/<make-*>/` holds one skill each, as its own Node package with a lockfile.
- `plugins/portable-artifacts/shared/` holds code shared by the skills. Edit it there only, then run
  `node plugins/portable-artifacts/bin/sync-shared.mjs`. The per-skill `shared/` folders are copies.
- `docs/` is the site (GitHub Pages).

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

## Security

Report vulnerabilities privately, as described in [SECURITY.md](SECURITY.md).
