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

## The hash

The plan's hash covers `demo.json` (without its word-only fields) and each step's page, effect and resolved control (its role,
name, address and form). It shows drift between a plan and what was answered. It does not stop an agent that forges an answers
file. `click-plan.json` is written before make-explainer draws the page, so a failed draw leaves the new JSON beside the old
page; answers from the old page are then refused.
