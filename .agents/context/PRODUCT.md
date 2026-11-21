# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers who already work in a coding agent (Claude Code first; also Codex, Copilot, Gemini CLI and other hosts
that read files and run shell commands). They want their agent to hand back a finished artifact, such as a dashboard,
diagram, explainer page, 3D scene or short film, instead of a wall of text, and they want it to work offline, on their
machine, with no account.

## Product Purpose

portable-artifacts is a plugin of five agent skills: make-dashboard, make-diagram, make-explainer, make-motion and
make-scene. The model writes one small JSON spec; deterministic Node scripts validate it and build one self-contained
HTML file or an MP4. Success: a visitor installs it in one command and gets a real artifact on the first prompt.

## Positioning

Three claims, all true in the code, which hosted "artifact" features cannot make together:

1. **Real outputs, offline.** Every artifact is a single file built locally from open-source parts, with no network
   at view time (strict Content-Security-Policy, no remote URLs in specs).
2. **Any agent, any model.** The same skills install into several agent hosts through one installer.
3. **Spec to artifact.** The model only writes a small JSON spec; scripts do the layout, rendering and checks, so the
   result is reproducible.

## Operating Context

Visitors arrive from GitHub, a plugin marketplace listing or a shared link. They read in a browser next to a terminal,
copy an install command, and try one prompt. The site is static (GitHub Pages, `docs/`, no build step).

## Capabilities and Constraints

- Five skills; counts of chart kinds, themes, shot kinds, looks and hosts come from the code, never from memory.
- The site is plain HTML/CSS/JS in `docs/`, deployed by `.github/workflows/pages.yml`.
- Site structure (confirmed 2026-11-20): one home page plus one gallery page of real outputs. Options, security
  model and release notes link out to the GitHub README, USAGE and CHANGELOG.
- Install commands print the repo as `abhijitbansal/portable-artifacts`.

## Brand Commitments

- Name: portable-artifacts (lowercase, hyphenated). Skill names are `make-*` and appear as slash commands.
- Voice: minimal, few words, plain English. Show the artifact instead of describing it.
- MIT licence, open source, owner-maintained.

## Evidence on Hand

Real outputs in `docs/` (showreel GIFs, dashboard renders, a diagram story GIF, gallery pages with their source specs
and prompts, an MP4 with poster). No testimonials, user counts, stars or benchmarks exist; do not invent them.

## Product Principles

1. Show the artifact, not a description of it.
2. Every number on the site is checkable in the code.
3. Offline and local by default; any network use is opt-in and named.
4. One command to install, one prompt to a first result.

## Accessibility & Inclusion

Generated artifacts and the site keep WCAG AA contrast in light and dark, respect reduced motion, and work on phones.
