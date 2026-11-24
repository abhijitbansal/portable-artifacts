# Design: make-demo

Date 2026-11-24. Status: **draft, waiting for the owner's approval.** Branch `feat/make-demo`, from `origin/main`.
Lines marked **[call]** are the author's choices; the owner has not answered them.

## 1. Intent

A user gives a URL (or a recording they already have) and some use cases. A new skill, make-demo, plans what to click,
waits for a yes, records the product, and builds a film: an opening with the user's own text, facts and graphics, then the
product in use with a moving camera, a drawn cursor, marked clicks and highlighted numbers, then one ask. Voice, music and
sound are optional. It should cost few tokens and work on every host the other skills support.

Who it is for: people who show how a web tool works, their own or one they have permission to film.

## 2. What the owner decided

| Question | Answer |
|---|---|
| Network | Yes, in the capture step only. Rendering stays offline and network-blocked. This reverses "What not to copy: `capture <url>`" in `2026-10-30-make-motion-hyperframes-parity-design.md` |
| Sites | Public, localhost and sites behind a login |
| Picture | Stills and video; a different engine than Playwright's recorder if quality needs it |
| How the product is drawn | Lifted real UI: high-resolution captures, plus key cards, rows and numbers captured on their own |
| Home | A new skill, `make-demo` |
| Styles | Calm walkthrough, short promo, over an existing recording |
| Opening | The film opens with text and graphics the user chooses, then moves to the demo |
| Delivery | One PR. Phases run locally; each is tested and cleaned before the next starts |
| Sounds | Keep synthesised cues |
| Brand | Accent, logo and wording, read from the site and approved |
| Screens behind a click | The take pauses with the browser open, shows the screen, and resumes after a yes |
| Private text | On a signed-in site the model sees control names, headings and layout, not values, unless the user allows an area or pictures |
| Whose site | Own or permitted. A third party's product can be explained, without its logo and brand, with a source credit |
| Vertical | Lifted parts and close-ups from the one desktop take |
| Model use | Cheapest model that does not cost quality; recommend it |

## 3. Goals, non-goals, anti-goals

Goals

- One request, one film. Two approvals when every screen is known; one more for each pause at an unknown screen.
- Every picture that claims to be the product is the product.
- The recording is repeatable: the same plan against the same site state gives the same frames.
- A change to the words never needs a new recording.

Non-goals

- Native apps, desktop windows, terminals, browser extensions. A recording of one can come in through phase 6.
- Rebuilding a product's interface as drawings. Free-form HTML or JavaScript films.
- Interactive click-through demos. Publishing or hosting.
- A talking-head avatar, cloud voices, generated footage.
- Getting past a CAPTCHA, a bot check or a site's terms. The skill stops and says so.
- Typing a secret during a take. Sign-in is by hand, before it (6.6). A login that lives only in `sessionStorage` is not supported: scout reports "not signed in" and stops.

Anti-goals

- A click the user did not approve.
- A password or token in a spec, a log, a picture or the model's context.
- Values from a signed-in site in the model's context without the user's yes. (Detection is not perfect: 6.6 says what is missed.)
- An invented number, customer or button.
- A camera move over a frozen screenshot passed off as the product doing something.
- make-motion gaining network code.

## 4. What was learned

### 4.1 Recording test (measured 2026-11-24)

Three local pages (a form with typing, CSS transitions and a count-up; a gallery dashboard; a canvas chart), 1280 × 720, 6.5 s, one
run per method, one machine. Sharpness is SSIM of a 2x zoom on the settled last frame against a 3x screenshot (1 is equal).

| Method | Sharpness | Distinct frames at 30 fps | Longest hold | Seconds per page |
|---|---|---|---|---|
| Frame by frame: page clock stepped, 3x screenshots | 0.9992 to 0.9998 | 100% | 33 ms | 13 to 15 |
| rrweb record, 3x replay | 0.9998; canvas 0.78 | 99 to 100% | 67 ms | 22 to 23 |
| Playwright `recordVideo`, 1280 px | 0.949 to 0.973 | 81 to 87% | 300 ms | 7 |
| `page.screencast` raw frames, own encode, 1280 px | 0.950 to 0.975 | 78 to 83% | 300 ms | 7 |

Not tested: live sites, logins, embedded video, WebGL, slow networks, motion in the middle of a transition (looked at by eye on one
frame: frame-by-frame and rrweb were at slightly different moments, both plausible). A double-resolution raw-frame arm was thrown out: zoom
moved the scroll position on two pages, and on the third it scored 0.952.

The real-time arms came back 1280 px wide at any device scale asked for, so the sharpness column compares capture scale as much as method.
Frame by frame wrote 53, 83 and 53 MB for 6.5 s (`du -sk`, 195 JPEGs of 3840 × 2160 at quality 95), 8 to 13 MB a second. The test's frame
marker moved on every frame, so what storing repeats once saves is not measured.

Result: frame by frame, with the Playwright make-motion already pins. No new dependency. Real time, with a 3x still at each step's settle point, is the fallback.

### 4.2 From other work

- `Barty-Bart/motion-graphics` (MIT; instructions read, nothing run): it redraws the UI as HTML and films that. Taken as ideas, no code: chapter
  pattern (title line, close action, pull back), camera that follows the action, cursor manners, length budgets, plan table with a reason per
  moment, section detection in existing footage, before/after page, list of what is illustrative.
- HyperFrames `types/launch.md` (Apache-2.0, ideas only): real UI; show the workspace, isolate one part at 1.6 to 2x, return it to its place; text at
  least 26 px at 1080p; cursor 4 to 7% of the frame. Openers to avoid: typing into a prompt box, a title over a dimmed screenshot, three feature cards.
- Vendor roundups put the first product picture at 0 to 9 s in most examples, and about 45 s in one long film. No source found
  measured problem-first against product-first. So the opening is a choice with a default, not a rule.
- Of the tools read (clipwise, screenci, playcast, playwright-recast and others), none documents an approved click plan.

## 5. Approaches

1. **Flat capture.** Whole screenshots and video with zoom. Least work; sharpness limited by pixels; looks like a screen recording.
2. **Lifted real UI** (picked). A take at 3x with every element's box and its own picture, drawn by make-motion's engine with a new `walk` shot.
   Close to a designed product film, with the real product. Most engine work of the honest options.
3. **Rebuilt UI.** Sharpest, but not the product, most tokens, and it breaks spec-first.

## 6. Shape

```
make-demo (network, consent, capture)              make-motion (offline, as today)
demo.json ─ scout ─ click plan ─ [yes 1] ─ take ─┬─ film.json ─ sheets ─ [yes 2] ─ MP4
                                                 └─ guide.json (make-explainer, optional)
existing recording ─ import ─ moments ─ [yes 1] ─┘
```

make-demo writes files; make-motion draws them. make-demo needs make-motion beside it (doctor, `sisterSkill`), and uses make-explainer's `plan`
page when it is there (a Markdown table in the reply when it is not).

### 6.1 `demo.json`

Spec-first, closed schema, like the other skills. Root: `version` 1, `source` (`{ "url" }` or `{ "recording" }`), `origins` (defaults to the URL's own),
`rights` (`own`, `permitted`, `third-party`), `viewport` (default 1280 × 720 **[call]**), `session` (a name, never a secret), `allow` (areas whose values the model may read), `pictures` (the model may open screenshots), `style` (`walkthrough`, `promo`, `over`), `length`, `format`, `look`, `voice`, `music`,
`sound`, `brand`, `opening`, `useCases`, `ending`, `mask`, `context` (the user's notes), `generatedBy`.

- `useCases[]`: `id`, `title` (the line shown), `goal`, `steps[]`.
- A step: `id`, `do` (`goto`, `click`, `type`, `press`, `select`, `hover`, `scroll`, `wait`, `show`), `target`, `value`, `effect` (6.4), `say`, `look` (what to mark, lift or
  zoom to) and `expect` (what must be on screen afterwards).
- `target` is, in order of preference, `{ role, name }`, `{ label }`, `{ text }`, `{ testId }`, `{ css }`. It must match exactly one visible element.
- `value` never holds a secret; a step that types into a password field is refused.
- `opening`: `type` (`problem`, `number`, `before-after`, `question`, `result`, `none`), `facts[]` in order, each `{ text, value?, from }` where `from` is `user` or a scouted page's URL. A fact
  with any other origin is an error.

### 6.2 Intake (one round)

URL or recording, whose product it is, use cases, who watches, the one thing to remember, style, length, format, opening type and its facts, voice, music, sound, login needed, things never to
click, what to hide, the ask, anything else to know. Every item has a default, as in make-motion. Length decides breadth: 45 s is 2 or 3 use cases, 60 s 3 or 4, 90 s 4 or 5. A
missing fact is asked for once, never made up. The skill drafts three openings from the facts and recommends one.

### 6.3 Scout

`scout.mjs demo.json` opens the URL and same-origin pages reached by plain links (at most 12 pages **[call]**). It never clicks, types or submits. A link is followed only when the classifier (6.4) reads
its name and its address as `look`, so a GET sign-out or delete link is skipped and listed. With a session it opens only the URL and the pages the user names. The page's own requests run, POST on load included; blocking them would leave many apps blank.

Per page it writes a digest: title, headings, landmarks, controls (role, name, box, effect class), numbers with their labels, brand candidates, and one screenshot on disk. It prints the digest only,
at most 6 KB a page, escaped by `agent-text.mjs`. With a session the digest holds control names, headings and layout; values, table cells and body text become their kind and length (`<money>`, `<text 34>`) outside `allow`. A fact taken from such a value needs `allow` or the user's own words.

It also loads the first page once under the stepped clock and once in real time, compares controls and page errors, and records which capture mode the site can take.

### 6.4 Click plan, approvals and pauses

Every step carries an effect class, computed from the control, its form, its address and the action:

| Class | Examples | Rule |
|---|---|---|
| `look` | hover, scroll, `goto` or a plain link whose name and address are clear, an in-page tab, menu or disclosure with no form and no address | runs after yes 1 |
| `change` | typing, submit, save, create, upload, any plain button, anything unknown | its own line in the plan |
| `danger` | delete, pay, buy, send, invite, publish, sign out, account or billing pages, by name or address, GET links included | refused unless that line is approved by name |

Markup can lie. A `look` step that sends a non-GET request to the site pauses the take and is shown to the user as `change`. The first such request has already gone; the report says so.

- **Yes 1, the click plan.** One row per step: target with its box on the screenshot, action, value, class, zoom or lift, words, plus the opening and its facts. A step on a screen not seen yet is listed as intent ("open the first result") with no target, and cannot run until a pause fills it in.
- **What the yes binds.** A hash of the steps, `origins`, `mask`, `allow`, `pictures`, `session`, `rights`, `viewport`, and each target's role, name and scouted box. The plan page's `key` carries it, so the answers file (read only through make-explainer's `answers.mjs`) returns it with
  the verdict. `take.mjs` takes that file and refuses another hash, a verdict that is not approve, or a target whose role or name no longer matches. Boxes may move; the report lists those that did. This stops drift and mistakes. It cannot stop an agent that writes the answers file itself; the skill forbids that, and the hash makes the approved rows checkable afterwards.
- **Without make-explainer** the plan is a table with a short code from the hash, which the user repeats and the agent passes. That proves less (it is the agent's word), the reply says so, and `danger` steps are refused on this path.
- **One take.** Rehearsal and recording are the same run. `take.mjs start` runs a holder process that owns the browser; `resume` and `stop` talk to it through files in the take folder. At an unknown step, a failed `expect`, no match or two matches, a new origin, a page error or a
  CAPTCHA it pauses: page clock stopped, browser open, digest and screenshot written. The agent drafts the next steps, the user approves them as in yes 1 (new rows only), and the take resumes where it stood. After 15 minutes without a resume it closes and keeps what it has **[call]**. In a run that cannot ask, a pause is a stop, exit 1.
- **Doing it again.** A fresh take replays every `change` step, so it needs a new yes that says which steps will run twice. Takes are not spliced: to re-record one use case, its steps must start from a `goto`.
- **Yes 2, the film.** make-motion's storyboard with the real stills. Word, zoom and order changes need no new take.

### 6.5 Capture

`take.mjs start demo.json --answers <file>` runs approved steps with no model call.

- **Frame by frame** (default): Playwright's page clock is paused and stepped at 30 fps; running animations are set to the frame's time; each frame is a 3x screenshot. Waiting for the network happens
  between frames and takes no film time.
- **Real time** (fallback): `page.screencast` frames with their timestamps, resampled, and one 3x still where each step settles, so holds, zooms and lifts use the still and only the motion is 1x. Used when scout says the site cannot be stepped, or a step asks for it (`"capture": "live"`).
- A repeated frame is stored once, so a still screen costs nothing.
- The browser is a fresh context: allow-listed origins for top-level navigation, downloads refused, permission prompts denied, dialogs dismissed and reported, popups closed and reported, service workers blocked **[call]**. Subresources and frames load from anywhere the page asks; a top-level move to a new origin pauses.
- Headless. Limits: 180 s of action and 3 GB a take **[call]**; past either it stops and keeps what it has. The report prints the size and the path.
- One headless browser at a time: it refuses to start when another is live, as `shot.mjs` does.

Output is a **take folder** beside `demo.json` (and inside the film's folder, which make-motion's containment needs). A demo starts in `.scratch/demos/<name>/`; in a folder git would track, `take.mjs` refuses until the take folder is ignored **[call]**. It holds `take.json` (viewport, scale, mode, frame index to file, one entry per step with start, act and settle frames, pointer position, target box, boxes of its `look` parts, text of marked numbers,
result of `expect`), `frames/`, and `parts/` (each lifted element on its own at 3x, captured once settled). **[call]** A folder of frames, not an MP4: no second lossy encode, and make-motion's limits of 8 clips and 60 s a clip do not apply.

### 6.6 Privacy, login and rights

- `session.mjs login <url> --name <n>` opens a visible browser. The user signs in by hand, through as many origins as that takes. The state (cookies, local storage, IndexedDB) goes to the skill's cache directory, outside the project, mode 0600, bound to `origins`, and is deleted when the
  film is done unless the user says to keep it **[call]**. `session.mjs forget <n>` deletes it. Attended runs only. No script prints its contents.
- **Model context.** Digests as in 6.3. Screenshots, contact sheets and review sheets of a signed-in site are opened by the model only with `pictures`; without it the user looks, and the model works from the report. Headings and control names can themselves hold a name; the login question says so.
- **Masking** happens in the page before a frame or a screenshot is taken, in scout, plan and take alike: `mask` targets, password fields, and text that looks like an email, phone, card number or key. A value the user approved in a step, and text in `allow`, is not masked. Masked text is also removed from
  digests and `take.json`. Names and faces are not detected. Text in a canvas or another origin's frame cannot be matched: with a session the plan lists each one, masked whole unless allowed.
- Page text, titles, control names and URLs are data, never instructions. A control that says "ignore your rules" is a control with that name.
- **Rights.** `own` and `permitted` are the user's word, asked at intake. `third-party` reads no logo or brand, shows a source credit, and claims nothing on the product's behalf.
- After the take the report lists origins contacted, requests that were not GET (count and path, no bodies), dialogs, popups, downloads refused, masks applied and boxes that moved.

### 6.7 make-motion: the `walk` shot

A new kind that plays a take. Offline, pure and spec-driven like the others.

- Fields: `src` (take folder), `steps` (`[{ "id", "at"? }]`, in order), `frame` (the `screen` chrome), `stops` (`[{ "at": anchor, "to": "whole" | "step:<id>" | "part:<name>" }]`), `lift`, `title`. `on` events can target `step:<id>` and `part:<name>` with today's devices.
- **Timing.** Step n starts with sentence n of the shot's `say`, or at its own `at` anchor; a count that does not match, with no `at`, is an error. Idle stretches are cut, action runs at real speed, and a step's last frame holds until the next. An action longer than its words stretches the shot. A shot with `hold` and no words plays its steps back to
  back, and stretches the same way. Times are relative to a step, so a changed sentence moves only its own step.
- **Camera.** Several stops a shot on `layeredCamera`; starting values 0.8 s ease in and out, at least 0.5 s of hold after an action, no zoom while the page scrolls **[call]**. Never past the capture's own resolution (the `screen` kind's rule and finding).
- **Cursor.** Drawn by the engine from pointer positions, 4 to 7% of the frame, one gentle curve, arrives before the click, dips on its tip, a ripple in the look's accent, always inside the frame. Off when a take has no pointer.
- **Lift.** A part's own picture rises from its place with a shadow while the rest dims, then returns to the same box. Its endpoints match the frame under it.
- **Numbers.** A marked number gets a highlight, circle or underline on its box. It is never redrawn or counted up in place of the page.
- Findings: text under 26 px at 1080p at a stop, a stop past resolution, an action outside the frame, a lift whose endpoints differ from the frame, a step never shown.
- Looks: `keynote` (default for demos), `desk`, `cosmos`, `ledger`, `poster`, `pop`. `marker` excludes it, as it does `screen`. A look ships the kind only after the look gate.

`server.mjs` serves take frames by index under the same containment rules as clips: folder inside the film's folder after links are followed, names from `take.json` checked against a pattern, JPEG or PNG by content.

### 6.8 The films

Walkthrough (60 s): hook 2 to 3 s; proof from the user's facts 3 to 5 s; hand-off 0.5 s (`match`, `flood`, `iris` or `zoom` opening from a named thing); whole workspace 2 s; per use case a title line, isolate, act, result, return; payoff that
answers the hook 3 s; `end` with one ask. The product is on screen by about 8 s unless the user asks otherwise. The opening uses today's kinds (`statement`, `number`, `list`, `compare`, `quote`, `diagram`).

Promo (15 to 30 s): 1 to 2 s hook, product by about 3 s, one or two use cases, cuts on the beat with `music.snap` when there is a track and no voice (make-motion refuses snap with narration), `16:9` or `9:16` (viral). A tall film fills its frame with lifted parts and close-ups from the same desktop take; a step with no part large enough to read is a finding. An optional recap shows all screens on one board joined by a `route` line.

Over a recording: the user's footage with zooms, marks, an opening in front, title cutaways and side panels.

`film.mjs demo.json` writes a draft `film.json` from the spec and the take, by rule, with no model. The agent then edits words and stops. `guide.mjs` writes an explainer spec (steps with stills, and the MP4 as a `motion` section).

### 6.9 Existing recordings

`import.mjs` checks a file with make-motion's container and codec rules (files up to 10 minutes, chosen ranges up to 180 s in all **[call]**) and turns the ranges into a take folder, so the `walk` shot, lift and stops work the same. It proposes moments (scene cuts, stills, change regions) and sections (full picture, box in an
empty frame, black). The user confirms moments and boxes, with `locate.mjs` for a region. Each moment gets a treatment and a reason: zoom, cutaway, side panel or nothing. There is no pointer data, so no cursor or ripple is drawn, and lift crops from the frame. The recording's own sound stays only where a range plays unbroken at real speed; a held or cut step drops it, with a note. Nothing is masked automatically in a recording: the user gives boxes with times, and the plan says so.
`.srt` and `.vtt` become a words file. Output also has a synced before/after page and a timing sheet. make-explainer's `motion.video` keeps taking `.mp4` only.

### 6.10 Model use

- Scouting, capture, the draft film and the checks are scripts. No picture is opened to plan a click; the model opens contact sheets at yes 2 only.
- Rendering hand-off: today's `artifact-builder` (Haiku).
- A new `demo-scout` agent (Haiku, Read and Write only, no shell because it reads page text) turns the digests (never pictures) and use cases into draft steps. The director reviews every step. It ships only if the gate in 9 passes; until then the director
  drafts. SKILL.md names the cheap path as a recommendation, with the measured result, and claims no saving that was not measured (the 2026-11-24 token-budget test ended with verdict none).

### 6.11 Brand

Scout proposes accent, logo file and product wording with where each came from. The user approves them on the click plan. `accent` and `overlays.logo` take them; contrast rules still apply. Fonts and ground stay the look's. A third party's logo is never taken.

## 7. Phases

One branch, one PR. Each phase: a plan, tests first, a fresh reviewer (security lens in 1, 2 and 6), fixes, clean tree, then the owner tries it and says go. No phase starts before the one before it is accepted.

| Phase | Delivers | The owner can try |
|---|---|---|
| 0 | Fixture sites (plain, single-page app, slow, canvas, login, hostile text, dangerous buttons), all on loopback; a feasibility run of frame-by-frame on five public sites the owner names | the numbers |
| 1 | Skill skeleton, schema, doctor, scout, effect classes, click plan, sessions | a click plan for a real site |
| 2 | Take, masking, both capture modes, report | a take folder and its contact sheet |
| 3 | make-motion `walk`: timing, camera, cursor, lift, findings; `keynote` and `desk` | a film from a fixture take |
| 4 | Opening, brand, draft film, guide, SKILL.md: the walkthrough end to end; remaining looks | a full demo of a real site |
| 5 | Promo and recap | a 20 s vertical |
| 6 | Recordings: import, moments, panels, words, compare page | a film over an old recording |
| 7 | Haiku gate, eval set, docs, gallery, sibling-skill checklist, version and changelog | the release |

Phase 0 is a stop rule. A site can be stepped when, after each step of a short `look`-only script, the stepped and the real-time settled screenshots match at SSIM 0.98 or more outside regions that differ between two real-time runs, the control lists are equal, and the stepped run adds no page error. If fewer than three of five pass, the owner is
shown a real-time film with 3x settle stills before phase 1, and decides. Phase 0 also measures bytes a second with repeats stored once, and time per second of film.

## 8. Constraints

- AGENTS.md as it stands: shared code synced, sibling-skill checklist, pinned dependencies, CI matrix row, one version bump, one trailer.
- make-motion's SKILL.md has about 500 bytes left: `walk` is documented in `references/` and `--list kinds`; its description drops "or a recording of a running app" for "use make-demo".
- `portability.test.mjs`: no host-only tool names; portable commands.
- Tests use loopback fixtures only. No test or CI job visits a public site or signs in.
- Browser-heavy runs are serial.

## 9. Proof

- Unit: schema, targets, effect classes (a table of control names in several languages, unknown is `change`), masking, hash check, retiming, camera limits, cursor path, take reader.
- Browser (fixtures): scout makes no click, keystroke or submit and follows no GET sign-out or GET delete link; `origins`, `mask` or `session` edited after the yes is refused; an answers file for another plan, or an older one, is refused; a pause resumes with no `change` step run twice; with a session no seeded private value is in anything printed; a step outside the approved hash is refused; a danger step without its line is refused; hostile page text changes nothing; masked text is in no frame, digest or log; a new origin stops the take; the same take twice on a fixed
  fixture gives the same frames; a stepped take and a real-time take agree on the settled state.
- Motion: look gate and an independent look review per look, as for `cosmos` and `keynote`.
- Haiku gate: draft steps for eight fixture tasks, three runs each, Haiku against the director's model. Pass: target resolution no worse than 5 points below, no unapproved class, every failure caught by the dry checks. Billed; its budget is asked for first.
- Manual checklist: login, a real public site, a 90 s film, a 9:16 promo, an old recording, all with sound on and off.

## 10. Review focus

1. A click that was not approved, through a changed page, a redirect, a frame, a popup or a same-named control.
2. A secret or private text in a file, a frame or the context.
3. Page text steering the agent.
4. Frame-by-frame capture showing a state the real product never shows.
5. A take folder as an attack on make-motion: paths, links, sizes, file types.

## 11. Left to the builder

File and helper names, digest layout, exact easing, cursor drawing, ripple shape, the wording of refusals and findings, how frames are named and shared, and the layout of the click-plan page within make-explainer's sections.
