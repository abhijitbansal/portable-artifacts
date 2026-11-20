# portable-artifacts

**Dashboards, diagrams, explainer pages, 3D scenes and animated videos from a prompt — built locally, offline,
from open-source parts, by any coding agent.**

Five agent skills that do what hosted "artifact" features do, without a cloud, an account or a particular model.
The model writes one small JSON spec; deterministic Node scripts validate it and build the page or the MP4.

| Skill | You get |
|---|---|
| `make-dashboard` | One self-contained HTML page of KPI tiles and charts from CSV, Parquet, JSON, DuckDB, SQLite, Postgres or MySQL. Every chart shows its SQL and refresh time. |
| `make-diagram` | An architecture, flow, sequence or state diagram with zoom, hover tracing and a story player. |
| `make-explainer` | A page or slide deck of typed sections: branch recap, concept explainer, test checklist, plan to answer. |
| `make-motion` | An MP4 explainer film from a script of shots, in seven looks, silent or with a local voiceover. |
| `make-scene` | An explorable 3D world (city, forest, galaxy, terrain) from your rows, with a camera tour. |

**See them in action:** [abhijitbansal.github.io/portable-artifacts](https://abhijitbansal.github.io/portable-artifacts/)
— showreel films, a gallery of real outputs with their specs, and the install guide. (The site goes live when the owner
enables GitHub Pages; until then open `docs/index.html` from a checkout.)

## Install

Claude Code:

```
/plugin marketplace add abhijitbansal/portable-artifacts
/plugin install portable-artifacts@portable-artifacts
```

Other agents (Codex, Copilot, Gemini CLI and more):

```
npx skills add abhijitbansal/portable-artifacts --skill make-dashboard make-diagram make-explainer make-motion make-scene
git clone https://github.com/abhijitbansal/portable-artifacts
node portable-artifacts/plugins/portable-artifacts/bin/install.mjs codex
```

Already installed from the claude-skills marketplace? `portable-artifacts@claude-skills` still works and updates from
this repository. Install from one marketplace only, either `portable-artifacts@portable-artifacts` or
`portable-artifacts@claude-skills`: both at once load duplicate `/make-*` skills. Installed with `npx skills add` or a
clone of claude-skills? Reinstall with the commands above, because claude-skills no longer carries the skills. More hosts, flags and the dependency notes are in the
[plugin README](plugins/portable-artifacts/README.md) and [USAGE](plugins/portable-artifacts/USAGE.md).

## Where to read next

- [`plugins/portable-artifacts/README.md`](plugins/portable-artifacts/README.md): what each skill does, how it works, the security model.
- [`plugins/portable-artifacts/USAGE.md`](plugins/portable-artifacts/USAGE.md): install per host, prompts to try, troubleshooting.
- [`plugins/portable-artifacts/CHANGELOG.md`](plugins/portable-artifacts/CHANGELOG.md): what changed in each release.
- [`AGENTS.md`](AGENTS.md): how to work in this repo (branches, tests, the "Shipping a portable-artifacts change" checklist). [`CLAUDE.md`](CLAUDE.md) imports it.
- [`SECURITY.md`](SECURITY.md): how to report a vulnerability.

## Repo layout

```
.claude-plugin/marketplace.json   one-plugin marketplace: portable-artifacts@portable-artifacts
plugins/portable-artifacts/       the plugin
  .claude-plugin/plugin.json      name, description, version
  skills/<make-*>/                the five skills: SKILL.md, scripts, tests, own package.json and lockfile
  shared/                         code shared by the skills; synced into each skill by bin/sync-shared.mjs
  bin/                            cross-host installer (install.mjs), sync-shared.mjs, installer tests
  agents/                         the optional artifact-builder agent
  eval/                           cross-host eval harness (fake host, no LLM, in CI)
docs/                             the Pages site root: index.html, showcase/ gallery, img/, assets/
docs/superpowers/                 design specs and plans
tests/pytest/                     checks on the site page and the CI workflow
scripts/                          audit-on-demand-deps.sh, check_trailers.sh
.github/workflows/                test.yml, audit-on-demand-deps.yml, pages.yml
```

## Licence

MIT. See [`LICENSE`](LICENSE).
