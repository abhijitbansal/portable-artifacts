# demo.json

One file that says which site to scout and which use cases to plan. Phase 1 reads it and checks it
(`node scripts/validate.mjs <demo.json>`); nothing in it is ever clicked, typed or submitted. The schema is closed: a key
not listed here is an error. A worked file is in `examples/walkthrough.demo.json`.

| Field | Type | Rule |
|---|---|---|
| `version` | `1` | required |
| `source.url` | string | required; an `http` or `https` address, the first page |
| `origins` | 1 to 5 strings | bare origins such as `https://shop.example.test` (no path, no trailing slash). Default: the origin of `source.url`, which must always be one of them |
| `rights` | `own`, `permitted` or `third-party` | required |
| `viewport` | `{ width, height }` | width 320 to 1920, height 320 to 1200, whole pixels. Default 1280 by 720, applied where it is read |
| `session` | string | `^[a-z0-9][a-z0-9-]{0,40}$`; the name of a saved sign-in |
| `pages` | up to 5 strings | addresses or paths scout also opens, each on an allowed origin |
| `mask` | up to 20 targets | each `{ role, name }` or `{ css }`, written like a step's `target`. Every element it matches is covered by an opaque box in each picture of a take, and in scout's signed-out pictures. It is part of the plan the owner approves, so changing it needs a new scout and a new approval. Default: none |
| `useCases` | 1 to 5 | `{ id, title, goal?, steps }` |
| `look` | `keynote` or `desk` | the look of the film. Default `keynote`, applied where it is read. A word field (see below) |
| `opening` | `{ hook, facts? }` | the start of the film. `hook` is 1 to 120 characters. `facts` is 1 to 3 entries of `{ text, value?, from }`: `text` is 1 to 80 characters, `value` is a number, `from` is `user` or an `http` or `https` address. A word field |
| `ending` | `{ ask, say? }` | the end of the film. `ask` is 1 to 60 characters, `say` is 1 to 120. A word field |
| `brand` | `{ name?, accent? }` | at least one key. `name` is 1 to 40 characters. `accent` is `#` and six lower-case hex digits, such as `#1f6feb`. The user approves it on the click plan, so the plan hash binds it |
| `generatedBy` | `{ model?, effort?, agent? }` | provenance |

A use case has 1 to 20 `steps`, and its first step is a `goto`. A step is `{ id, do, target?, value?, intent? }`.
Every `id`, of a use case or a step, is `^[a-z][a-z0-9-]{0,40}$` and unique across the whole file.

| `do` | Needs |
|---|---|
| `goto` | `value`: an address or a path on an allowed origin |
| `click`, `hover`, `show` | `target`, or `intent` alone |
| `type`, `select` | `target` and `value` (no control character, at most 300 characters), or `intent` alone. Never on a password field |
| `press` | `value`: a key or chord name (`Tab`, `Escape`, `Enter`, `Space`, `Backspace`, `Delete`, `Home`, `End`, `PageUp`, `PageDown`, `Arrow*`, `F1` to `F12`, one letter or digit, with optional `Control+`, `Meta+`, `Alt+`, `Shift+` prefixes). `Enter` and `Space` need a `target` |
| `scroll` | `target`, or `value` in pixels |
| `wait` | `value` in seconds, 0.1 to 10 |

`target` is `{ "role": "link", "name": "Pricing" }` as scout lists the control, or `{ "css": … }` copied whole from where the
digest prints `css=` (an nth-of-type path such as `html > body:nth-of-type(1) > main:nth-of-type(1) > button:nth-of-type(2)`). `intent` is words for a screen not seen yet; it stands alone and excludes `target` and `value`.

`mask` is for what no pattern can know: a person's name, an address, an order number in words. On a signed-in take every password
field and every email, long number (7 or more digits) and key (20 or more letters, digits, `_` and `-`, with a digit and a letter)
is covered without being listed, in the page, in shadow roots and in frames. A `mask` target that matches nothing on a page covers
nothing there, and says nothing.

Rules for `brand` and for the facts in `opening`:

- A `third-party` demo has no `brand`. The error is "a third party's brand is not taken: remove brand".
- A fact whose `from` is an address must give an address on an allowed origin (`origins`). Later, `film.mjs` also checks that
  it is a page that scout read; that check needs scout.json, so validation alone does not do it.
- With a `session`, every fact has `from: "user"`. The error is "signed in, a fact comes from the user's own words".

Word fields and bound fields: `look`, `opening` and `ending`, with `generatedBy` and each use case's `title` and `goal`, are
word fields. Changing one does not change the plan hash, so the click plan stays approved and a take stays valid. Every other
field is bound by the hash, `brand` included. Changing `brand`, a step, `origins`, `mask` or `session` makes the take stale: plan,
approve and take again.

Validation reads the file only. Whether a `target` names a control on the page is checked later, against scout's digest.
