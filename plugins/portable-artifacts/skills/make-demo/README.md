# make-demo

**A URL and some use cases → a click plan you can approve.** Scripts open the site read-only, list what each page holds, and
build one offline page where every step is labelled `look`, `change` or `danger`. Nothing is clicked, typed or submitted.
Recording and film are not part of this release. Works with any agent that can run shell commands.

- **One spec, `demo.json`**: the site, whose product it is (`own`, `permitted` or `third-party`), and up to 5 use cases of
  steps. Steps name a control as scout lists it, or say in words (`intent`) what happens on a screen scout did not see.
- **Scout reads, never acts**: it follows only plain links it classes `look`, refuses a move to another site, and lists the
  requests a page sends on its own.
- **Sign in by hand**: `session.mjs login` opens a window; you sign in and close it. The state is kept outside the project
  and a plan made with it holds control names and headings only (emails, long numbers and keys masked), no pictures.
- **A plan page**: made with make-explainer, one approval per `danger` step and an overall verdict.

> Agents: the instructions you follow are in [`SKILL.md`](SKILL.md). This README is for people.

## Quick start

```bash
cd make-demo && npm ci --ignore-scripts && cd -     # one-time
node make-demo/scripts/doctor.mjs                   # what is missing, and how to fix it
node make-demo/scripts/validate.mjs demo.json
node make-demo/scripts/scout.mjs    demo.json       # writes scout/scout.json beside demo.json
node make-demo/scripts/make.mjs     demo.json       # builds click-plan.html beside it
node make-demo/scripts/check.mjs    click-plan.html --shots shots
```

Or ask your agent: *"Plan a demo of https://shop.example.test: find the pricing, then search the catalog."* It asks whose
product it is, writes `demo.json`, scouts, writes the steps and hands you the page.

## Requirements

- Node.js 20 or later and `npm ci --ignore-scripts` in this folder (Ajv and Playwright).
- Playwright's own Chromium (`node scripts/doctor.mjs` names the command; an installed Chrome is not used).
- make-explainer installed beside this skill; it draws the page.

## Limits

See [`references/limits.md`](references/limits.md): English danger words only, scripts on links and menus are not seen,
frames are not listed, and a plan is not a proof. Field reference: [`references/schema.md`](references/schema.md).

## Tests

```bash
npm ci --ignore-scripts && npm test      # one headless browser at a time; the browser tests fail when Chromium will not start
```
