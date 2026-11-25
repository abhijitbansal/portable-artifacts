# Known limits of the click plan

The plan says what each step would do, from what scout saw. It is a plan, not a proof. Nothing here is hidden by the page:
read it before you rely on a `look` label.

## What the labels can miss

- **English only.** The danger words are English. A page whose `lang` is not `en` (or has none) gets `change` on every link,
  and scout does not follow them.
- **A harmless link that changes something.** A plain English link whose name and address hold no danger word, but which
  changes something when opened, is `look`.
- **Scripts on links and menus.** A JavaScript handler added with `addEventListener` to a plain link or a disclosure is not
  seen: only inline `onclick`, `data-method`, `data-turbo-method` and `hx-post|put|patch|delete` are. A `look` disclosure may
  also send a request when it opens.

## What scout does not see

- **Frames, shadow roots, canvas.** Controls inside an `iframe`, a closed shadow root or a canvas are not listed; the digest
  names the frame origins it did not look into.
- **Popups and new tabs.** A popup is closed and counted; its content is never read.
- **Past the cap.** A page lists at most 400 controls; the digest prints at most 6 KB and states how many it left out.
- **Dialogs, downloads, sockets.** Dialogs are dismissed and downloads refused; both are counted.

## What was sent

- **A server redirect.** A script, a link or a form that moves the page to another site is aborted before it is sent. A
  server redirect is not: its GET has gone out before scout can refuse it. There is no digest of the new site and the
  report says where the page went.
- **Loaded twice.** The first page is read once in real time and once under a stepped clock, so what it sends on load is sent
  twice.
- **The page's own writes.** A request that is not GET and that a page sends on its own is not stopped. It is listed with its
  method, origin and masked path, with no body.

## Signed-in sites

- Control names and headings are shown. Emails, long numbers and keys are masked; a person's name, a short code or an amount
  in a name is not.
- Field values, body text and pictures are never read or kept, and no picture is made.
- Google and similar sign-ins usually refuse Playwright's Chromium. A login kept only in `sessionStorage` is not saved.
- A session expires with the site's own cookie: scout then says it is not signed in and keeps the earlier `scout.json`.

## The hash

The plan's hash covers `demo.json` (without its word-only fields) and each step's page and effect. It shows drift between a
plan and what was answered. It does not stop an agent that forges an answers file.
