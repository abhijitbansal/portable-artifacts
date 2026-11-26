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
  was recorded is kept. Retaking the same plan repeats every `change` and `danger` row, which is why it needs `--again`.
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
  a cap or an error is not in `steps`, but its frames are in `frames`.
- **A refused form.** A form that moved to another origin since scout is refused, and the page is left on the browser's error
  page; the take stops at that row.
- **The take is not a proof.** The hash shows drift between the plan, the answers and `demo.json`; it does not stop an agent that
  forges an answers file (see below).

## The hash

The plan's hash covers `demo.json` (without its word-only fields) and each step's page, effect and resolved control (its role,
name, address and form). It shows drift between a plan and what was answered. It does not stop an agent that forges an answers
file. `click-plan.json` is written before make-explainer draws the page, so a failed draw leaves the new JSON beside the old
page; answers from the old page are then refused.
