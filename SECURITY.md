# Security Policy

## Reporting a vulnerability

If you find a security issue in a script, the installer, a skill, or anything
that executes on a user's machine, **please do not open a public issue.**
Instead, [report it privately on GitHub](https://github.com/abhijitbansal/portable-artifacts/security/advisories/new)
or email **contact@abhijitbansal.com** with:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept), and
- the affected file(s) / version.

You'll get an acknowledgement, and a fix or mitigation will be prioritized.

## Scope & what to look for

This repo ships code that agents and installers run locally. The highest-value
areas:

- **The installer** (`plugins/portable-artifacts/bin/install.mjs`) and each
  skill's **doctor** (`scripts/doctor.mjs`) — they write into `~/.claude`,
  `~/.agents`, `~/.copilot` and `~/.gemini`, and install dependencies.
- **On-demand installs** — `npm ci --ignore-scripts` from committed lockfiles,
  and the pinned model downloads (checked against a SHA-256) in make-motion.
- **Skill scripts** — anything a `SKILL.md` tells an agent to run, including
  make-dashboard's SQL allowlist and the local servers (bound to `127.0.0.1`).
- **The generated pages** — their Content-Security-Policy and the rule that a
  spec cannot name a remote URL.

The security model of the skills is described on the site
(`docs/index.html`, "Security model") and in `plugins/portable-artifacts/README.md`.

## Notes for users

- The one network use a skill can start without a download prompt is make-explainer's
  `--image-api <https-endpoint>` flag, and only when you pass it.
- Dashboards run model-written SQL: use a read-only database role for Postgres and MySQL.
