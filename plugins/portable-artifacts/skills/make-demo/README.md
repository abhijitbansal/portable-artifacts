# make-demo

**A URL and some use cases → a click plan you approve → a take → a draft film and a guide page.** Scripts open the site
read-only, list what each page holds, and build one offline page where every step is labelled `look`, `change` or `danger`.
Nothing is clicked, typed or submitted until you approve it. After your yes, a take runs the approved steps and records frames;
a script drafts a film from the take by fixed rules, make-motion renders it, and make-explainer builds a guide page. Works with
any agent that can run shell commands.

- **One spec, `demo.json`**: the site, whose product it is (`own`, `permitted` or `third-party`), and up to 5 use cases of
  steps. Steps name a control as scout lists it, or say in words (`intent`) what happens on a screen scout did not see. Optional
  `look`, `opening`, `ending` and `brand` shape the film.
- **Scout reads, never acts**: it follows only plain links it classes `look`, refuses a move to another site, and lists the
  requests a page sends on its own. It also proposes a brand (a name and an accent), which the plan shows for your yes.
- **Sign in by hand**: `session.mjs login` opens a window; you sign in and close it. The state is kept outside the project
  and a plan made with it holds control names and headings only (emails, long numbers and keys masked), no pictures.
- **A plan page**: made with make-explainer, one approval per `danger` step and an overall verdict.
- **A take**: `take.mjs` runs the approved plan once, frame by frame, and keeps 3x pictures, a contact sheet and a report.
- **A draft film**: `film.mjs` writes a make-motion film from the take, with no model: one walk shot per use case, one sentence per
  step, the whole page in view with a lift on one step. The sentences are placeholders for the agent to rewrite.
- **A guide**: `guide.mjs` writes a make-explainer spec from the take and the rendered MP4; `build.mjs` of make-explainer builds it.
- **Signed in**: the agent never opens the take's frames, the film's sheets, the MP4 or the guide. You open them.

> Agents: the instructions you follow are in [`SKILL.md`](SKILL.md) and [`references/walkthrough.md`](references/walkthrough.md).
> This README is for people.

## Quick start

```bash
cd make-demo && npm ci --ignore-scripts && cd -     # one-time
node make-demo/scripts/doctor.mjs                   # what is missing, and how to fix it
node make-demo/scripts/validate.mjs demo.json
node make-demo/scripts/scout.mjs    demo.json       # writes scout/scout.json beside demo.json
node make-demo/scripts/make.mjs     demo.json       # builds click-plan.html beside it
node make-demo/scripts/check.mjs    click-plan.html --shots shots
```

After you approve the plan, the take, the film and the guide each have a command: `take.mjs <demo.json> --answers
plan-answers.json`, `film.mjs <demo.json> --take take-1`, then make-motion's `make.mjs film.json --json`, then `guide.mjs
<demo.json> --take take-1 --video <the MP4>` and make-explainer's `build.mjs guide.json --out guide.html`. Each prints the next one.
The steps are in [`references/walkthrough.md`](references/walkthrough.md).

Or ask your agent: *"Make a demo of https://shop.example.test: find the pricing, then search the catalog."* It asks whose
product it is, writes `demo.json`, scouts, writes the steps and hands you the page.

## Requirements

- Node.js 20 or later and `npm ci --ignore-scripts` in this folder (Ajv and Playwright).
- Playwright's own Chromium (`node scripts/doctor.mjs` names the command; an installed Chrome is not used).
- make-explainer installed beside this skill; it draws the plan page and the guide.
- make-motion installed beside this skill; it renders the film.

## Limits

See [`references/limits.md`](references/limits.md): English danger words only, scripts on links and menus are not seen,
frames are not listed, a plan is not a proof, and the film is silent, 16:9, whole view with lifts only. Field reference:
[`references/schema.md`](references/schema.md). The take: [`references/take.md`](references/take.md).

## Tests

```bash
npm ci --ignore-scripts && npm test      # one headless browser at a time; the browser tests fail when Chromium will not start
```
