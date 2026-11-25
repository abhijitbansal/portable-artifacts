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
| `useCases` | 1 to 5 | `{ id, title, goal?, steps }` |
| `generatedBy` | `{ model?, effort?, agent? }` | provenance |

A use case has 1 to 20 `steps`, and its first step is a `goto`. A step is `{ id, do, target?, value?, intent? }`.
Every `id`, of a use case or a step, is `^[a-z][a-z0-9-]{0,40}$` and unique across the whole file.

| `do` | Needs |
|---|---|
| `goto` | `value`: an address or a path on an allowed origin |
| `click`, `hover`, `show` | `target`, or `intent` alone |
| `type`, `select` | `target` and `value`, or `intent` alone |
| `press` | `value` (the key, such as `Enter`); `target` is optional |
| `scroll` | `target`, or `value` in pixels |
| `wait` | `value` in seconds, 0.1 to 10 |

`target` is `{ "role": "link", "name": "Pricing" }` as scout lists the control, or `{ "css": "#plans" }` copied from the
digest. `intent` is words for a screen not seen yet; it stands alone and excludes `target` and `value`.

Validation reads the file only. Whether a `target` names a control on the page is checked later, against scout's digest.
