# Known limits of the click plan

The plan says what each step would do, from what scout saw. It is a plan, not a proof. Nothing here is hidden by the page:
read it before you rely on a `look` label.

## What the labels can miss

- **English only.** The danger words are English. A page whose `lang` is not `en` (or has none) gets `change` on every link
  and every menu or tab, and scout does not follow them. The `lang` of a part of a page (a `lang="de"` section on an English
  page) is not read.
- **A harmless link that changes something.** A plain English link whose name and address hold no danger word, but which
  changes something when opened, is `look`. The word list grows with what was found (cancel, confirm, clear, vote, add to
  cart and the like), but a GET link outside it is `look`, and so is a list such as "Follow" (only "Unfollow" is a word).
- **Scripts on links and menus.** A JavaScript handler added with `addEventListener` to a plain link or a disclosure is not
  seen: only inline `onclick`, `data-method`, `data-turbo-method`, `ping` and `hx-post|put|patch|delete` (also with
  `data-`) are. Other event attributes (`onmousedown`) are not. A `look` disclosure may also send a request when it opens.
- **A page that moves itself inside its own site.** A script or a server redirect may send a followed page to an address with
  a danger word on the same origin; scout reads where it lands. Only a move to another origin is refused.
- **`goto` is not read for language or writes.** A `goto` is `look` in any language and for any address without a danger word
  (`/abmelden` is `look`).
- **Type and select in a form with a danger action.** They are `change`, not `danger`: only a click or a press reads the form.
- **A screen that moves on its own.** `type`, `select`, `hover` and a link to `#top` stay on the page. A `select` that
  navigates when it changes is not seen, and the rows after it name controls of a screen that is gone.

## What scout does not see

- **Frames, shadow roots, canvas.** Controls inside an `iframe`, a closed shadow root or a canvas are not listed; the digest
  names the frame origins it did not look into.
- **Popups and new tabs.** A popup is closed and counted; its content is never read.
- **Past the cap.** A page lists at most 400 controls; the digest prints at most 6 KB and states how many it left out.
- **Dialogs, downloads, sockets.** Dialogs are dismissed and downloads refused; both are counted.
- **A page that is not signed in by its own words.** Any visible password field means "not signed in", so a signed-in
  security or change-password page stops the scout.
- **Off the picture.** A control outside the picture's width (an off-canvas menu) has no box and no note, and boxes are taken
  before the picture, so a late layout shift marks the wrong control.

## What was sent

- **A server redirect.** A script, a link or a form that moves the page to another site is aborted before it is sent. A
  server redirect is not: its GET has gone out before scout can refuse it. There is no digest of the new site and the
  report says where the page went.
- **Loaded twice.** The first page is read once in real time and once under a stepped clock, so what it sends on load is
  sent twice. Both loads are listed on the first page, once, with the counts added.
- **The page's own writes.** A request that is not GET and that a page sends on its own is not stopped. It is listed with its
  method (a standard one, else `OTHER`), origin and masked path, with no body. The lists of requests and refused moves have no
  cap, so a page that retries in a loop makes a long `scout.json`.
- **The start address.** `source.url` is not checked for a danger word and is opened twice: you typed it.

## Signed-in sites

- Control names and headings are shown. Emails, long numbers and keys are masked; a person's name, a short code or an amount
  in a name is not. A control whose name carries what a field holds, and every option of a list, is only `<text N>`.
- Field values, body text and pictures are never kept or printed, and no picture is made. Scout does bring up to 3,000
  characters of page text into memory to spot a wall, and the stepped load takes pictures in memory; neither is kept.
- Addresses are cut to the origin and a masked path; masking leaves a short code, `+` or `/` inside a number or key, a letters-only
  token and a non-ASCII address alone. Origins are not masked, so a per-user subdomain shows, and `lang` is kept as the page wrote it.
- Google and similar sign-ins usually refuse Playwright's Chromium. A login kept only in `sessionStorage` is not saved.
- A session expires with the site's own cookie: scout then says it is not signed in and keeps the earlier `scout.json`.
- A sign-in with nothing in it is stored as "saved session: 0 cookies" and exit 0. The store's folder is outside the project
  only when the host sets a data folder or has a home folder; the file modes are POSIX and do nothing on Windows.

- A backtick in a typed value is shown as a quote mark on the plan page.

## The take

A take runs the approved rows and keeps frames (`references/take.md`). It does what the plan said and nothing else, but:

- **Frame by frame only.** The page's clock is stopped and stepped. A page with a playing video, or one that does not settle,
  cannot be taken yet, and a plan whose `scout.json` says so is refused. Scout makes that check on the first page only: a later
  page that plays a video is not checked before the take. Settled frames are as the stepped clock shows them; a page
  that reads real time in a worker, or plays sound or an animated image, is not stepped.
- **No pause.** An unknown screen (an `intent` row), a changed control, a refused move or a sneaky write ends the take, and what
  was recorded is kept. Retaking the same plan repeats every `change` and `danger` row, which is why it needs `--again`, after
  any earlier take of it that ran such a row (or died with frames and no `take.json`).
- **A sneaky write has gone before the take stops.** The stop for a `look` row that was followed by a write comes after the
  request left (the report says so). It also looks only at writes to the demo's own `origins`, and only after a `look` row:
  writes of a `change` or `danger` row are listed, never a stop, and a write to a third party is only listed.
- **A write scout saw anywhere does not stop a `look` row.** A write counts as listed when scout saw it on any scouted page, not
  on the row's own page. A `look` row that now sends, from another page, a write scout saw on a different page is not caught.
- **Controls.** The take compares the live control with the approved one by role, name, kind, address and form. Signed in, the
  name is masked as scout masked it, so a twin control with the same masked name is not detected (the css, role and kind must
  still match), and a stored `<text N>` name is not compared at all. Signed in, a heading with no css is found by its stored name,
  so a heading whose name masking changed is `no match`.
- **Masking covers emails, long numbers (7 or more digits), keys, password fields and `mask` targets.** Not covered: names,
  faces, short codes and amounts (use `mask` for those), text made by CSS (`content: attr(...)`), text inside an image, a canvas
  or a video, and a closed shadow root. A `mask` target that matches nothing, or whose css the browser refuses, covers nothing and
  says nothing. Signed in, a `{ role, name }` target is matched against the live name, which scout printed masked: use `css`.
- **A value that lands between the cover and the picture.** The cover is drawn once per frame, just before the picture. A value
  that arrives in real time after it (a network reply) and before the shot is not covered; list such a place in `mask`.
- **Over-covering.** A number written across sibling elements (a pager of separate links, `1 2 3 4 5 6 7`) counts as a long number
  and is covered in whole.
- **Downloads.** They are kept as the site sent them and never opened or checked. Each file over 100 MB is deleted and listed;
  the take caps neither their number nor their total size. Chromium cleans a download's suggested name before the take sees it, so
  the name in the report is the cleaned one (the take stores the file under a name of its own and shows the name through
  `agentText`).
- **Caps.** 180 s of film time and 3 GB of distinct frames; past either the take stops and keeps what it has. A row cut off by
  a cap or an error is not in `steps`, but its frames are in `frames` and, once its act began, the row is in `ran`, which is what
  `--again` reads.
- **A server redirect.** The take sees the first hop of a request only. A redirect to another origin is followed, and the take
  stops after that row with `the page moved to <origin>`; the first request of the new origin has gone by then.
- **A refused form.** A form that moved to another origin since scout is refused, and the page is left on the browser's error
  page; the take stops at that row.
- **A control is found by its place.** The css scout wrote is a position (`tr:nth-of-type(2) button`). If a list changed
  between scout and take, a same-named control of another record can sit in that place and pass the check: signed out its
  address must still match, signed in the address is masked (ids and queries dropped). Scout again right before a take whose
  `danger` row sits in a list.
- **The page is not compared before a row.** The take checks the control, not the page's address; a same-origin page that moved
  itself to another address with the same control in the same place passes.
- **Typing is filmed as typed.** An approved typed value is not masked (it is on the plan page). While it is typed, a part of an
  email, number or key that does not yet match a pattern (`alice@example.c`) shows in frames; the whole value is covered once it
  matches. Keys go to the focused element; a page that moves focus mid-typing gets the rest.
- **Long text is not scanned.** A text node over 100,000 characters (a log or JSON view) is not checked for emails, numbers or
  keys; list it in `mask`. Covering and the picture have no time limit of their own.
- **Frames inside the page.** A form with `target` set to an `iframe`, or any navigation inside a frame, is not guarded; only
  the main page's moves are.
- **Approval comments are not read.** A comment on an approval or the verdict ("only the test item") does not change what runs;
  the gate reads the choice only. Approve with `changes` instead.
- **`click-plan.json` is trusted.** The gate checks its key against the plan recomputed from `demo.json` and `scout.json`, and
  `answers.mjs` checks the answers against the file; the page the owner read is not compared again.
- **Scout's signed-out picture** is taken in real time after the cover is drawn, so a `mask` target that moves during the
  full-page shot can show.
- **A crash exits 1,** like a stop or a refusal; read the printed reason.
- **In tests only,** `NODE_ENV=test` with `PA_SIBLINGS_ROOT` picks which make-explainer `answers.mjs` the take trusts.
- **Hostile pages** are out of scope. A page can see the take (`window.__makeDemoCover`), remove or hide the cover layer, write
  over a WebSocket after a `look` row (counted, not a stop), react to the pointer passing over other elements on its way, and
  nest a link inside an approved button to take the click. Text in a broken image's `alt` or in a listbox's options is not
  covered.
- **The take is not a proof.** The hash shows drift between the plan, the answers and `demo.json`; it does not stop an agent that
  forges an answers file (see below).

## The walk shot

make-motion's `walk` shot plays a take as a film shot (make-motion's `references/walk.md`). What it does not do yet:

- **16:9 only.** A tall canvas is refused: "walk needs a wide frame (16:9) for now".
- **Not with one recording.** A film narrated by one recording is refused: its shots cannot stretch to their steps.
- **Only `keynote` and `desk`, and parked there.** `walk` is parked in both looks until its look gate passes. Every other look
  refuses it.
- **No captured parts.** A lift is a crop of the step's frame, so it is no sharper than the frame. It never scales past the
  take's own pixels: at a stop that already shows the take's resolution, a lift only dims the rest.
- **Marks are on a step's whole box.** A highlight, circle or underline goes on the step's box, not on one number inside it.
- **Idle means identical frame files.** Idle stretches are cut where the same file repeats. A blinking caret or a spinner makes a
  still screen play at real speed.
- **`textPx` is the main frame only.** Text in a canvas, an image or another origin's frame is not measured.
- **A covered value shows as its grey cover at any zoom.** Frames are drawn as stored, so a cover box stays a grey box when the
  camera pushes in.
- **The reader checks headers and first bytes.** It checks each frame's header and its first bytes, not a full decode. A corrupt
  frame fails in the page; the error does not always name the frame. A JPEG's EXIF orientation is not read, so a turned frame
  can decode at another size than the one checked.
- **The server rechecks place, not content.** Every request checks that the frame still resolves inside the take's `frames/`
  folder. It does not check the file's size or type again, so a file swapped in during a render is served as it is. The take is
  read again when the server starts, so a take changed between prepare and render is served as it is then. Hard links pass the
  folder check.
- **The signed-in rule trusts the take.** The notice comes from the take's own `signedIn` flag. The rule is the agent's to keep:
  make-motion still writes sheets and the film.
- **A box with no area keeps the picture whole.** A step whose box has no width or height, or lies off the page, has its marks
  and stops on the whole picture.
- **At most 4 takes a film**, counted by how `src` is spelled, and checked when the render starts, after the voice is made.
- **A stop onto a step is refused.** `step:<id>` stops give `a stop onto a step is parked`: a push can cut a row of the page. The
  walk plays the whole view and lifts only. A look turns pushes back on with `kinds.walk.pushes`; none does yet.
- **Walk stops make no sound in this phase.**
- **The text finding on a 3x take is narrow.** The push is capped at the take's own resolution, where text shows at three times
  its page size, so the finding "page text of <n> px shows at <m> px at its stop" fires at a stop only for text under about 9 px.

## The film

`film.mjs` drafts the film by fixed rules, with no model (`references/walkthrough.md`). What it does not do:

- **Silent, 16:9, walkthrough only.** The sentences are plain placeholders built from control names, for the agent to rewrite. A
  voice or a music bed is the agent's to add in `film.json`, and only when the user asks.
- **Whole view only.** No stop pushes in. Page text shows at about its CSS size at 1080p on a 1280-wide take (measured 0.94 times
  in keynote, 1.01 in desk; 1.26 and 1.35 on a 960-wide take), so small text stays small. The lift is the only closer look: one per use case, on the last boxed `hover`, `show`, `type` or `select`
  step, never on a click, and none when the use case has no such step.
- **Hard cuts.** The seams into and out of the product are plain cuts. A dissolve laid the opening's type over the page and a fade
  dipped to blank in the look gate. The film does not open from a named thing on the page.
- **One walk shot per use case.** `film.mjs` does not split one. make-motion refuses a walk shot of more than 40 steps; a use case
  has at most 20 steps in `demo.json`, so a draft stays under that.
- **Brand is a name and an accent.** They come from `og:site_name`, the title and `theme-color` of the first page. No logo, no
  colour read from the page's own styles. A site without `theme-color` gives no accent.
- **A third party's film has no brand.** It gets the mark `Source: <host>` and no accent.
- **Facts are checked by address, not by content.** `film.mjs` checks that a fact's `from` is `user` or a page scout read. It does
  not check the fact's words against that page. Never inventing a fact is the director's rule.
- **`film.mjs` reads little of `take.json`.** Only the step ids, verbs, box flags and frame names, the flags `signedIn` and
  `stopped`, and the plan key. The frames themselves are checked when make-motion renders.
- **It never overwrites.** A second draft needs `--out` with a new name, and a `film.json` you edited is kept as it is.
- **No storyboard for yes 2.** The user watches the MP4. Signed out, the director also views the sheets.
- **Signed in.** `film.mjs` prints a notice. The model never opens the film's sheets or the MP4, and gives them to no agent, not
  even `motion-reviewer`: it works from make-motion's `--json` report. The rule is the agent's to keep: make-motion still writes
  the sheets and the film.
- **`walk` in `cosmos`, `ledger`, `poster` and `pop`:** not yet.

## The guide

`guide.mjs` writes a make-explainer spec from the same take and the rendered MP4 (`references/walkthrough.md`):

- **It inlines the settled 3x frames.** A long guide weighs several MB. A picture over make-explainer's 1.5 MB limit fails at
  validation, so `build.mjs` refuses the guide until that picture is removed.
- **At most 40 sections.** Past that, only the last step of each use case keeps its picture, and a note says so.
- **The sentences are the draft film's placeholders,** not the words in `film.json`. The agent edits them in `guide.json`.
- **Paths.** `--out` must sit directly in the demo folder, because the guide's paths are relative to its own folder. `--video` is
  an `.mp4` inside the demo folder of at most 50 MB.
- **It never overwrites,** as `film.mjs` does not.
- **Signed in.** `guide.mjs` prints a notice. The model never opens the guide, its pictures or its check PNGs, and gives them to
  no agent. The user opens the page.
- **A third party's guide** carries the callout `Source: <host>. Not made by its owner.`

## The hash

The plan's hash covers `demo.json` (without its word-only fields) and each step's page, effect and resolved control (its role,
name, address and form). It shows drift between a plan and what was answered. It does not stop an agent that forges an answers
file. `click-plan.json` is written before make-explainer draws the page, so a failed draw leaves the new JSON beside the old
page; answers from the old page are then refused.
