# Motion Token Budget Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The eval can run one prompt set through several versions of the make-motion skill under one spend ceiling, count what each session cost, prepare blind ratings, and apply the pass rule; then the paired test is run.

**Architecture:** `eval/session.mjs` gains usage counts read from stream events. `hosts.json` gains `claude-stream`; `lib.mjs` gains small options (arm folder, dependency source, look ending, optional-package links). A new driver, `run-arms.mjs`, owns ordering, the ledger and the ceiling; the pure logic (order, ledger, summary, pass rule, blind packets) sits in `arms-lib.mjs`. No product code under `skills/` changes in this phase.

**Tech Stack:** Node 20+, `node:test`, the existing eval harness. No new dependency.

**Spec:** `docs/superpowers/specs/2026-11-23-motion-token-budget-design.md` sections 5 and 8. Paths below are relative to `plugins/portable-artifacts/` unless noted.

## Global Constraints

- No billed run in Tasks 1 to 4: tests use a fake `claude` and a fake skill. Task 6 is the only billed task and the orchestrator runs it.
- Sonnet, effort high, `--timeout 1800`, `--budget 1.00` per case, `--max-total 20`, 10 prompts, 3 arms (A, D, C), one session at a time.
- The owner approved $20 in total and no more. A case may start only if spend so far plus `--budget` is at most `--max-total`. A case with no cost event is charged its full `--budget`.
- `run-eval.mjs`'s behaviour for existing hosts is unchanged; committed summaries stay comparable; `buildPrompt` for hosts without `stream` is byte for byte as before.
- Every guardrail and fix is shown failing first (RED), then passing.
- `skills/**` is not edited in this phase. No `plugin.json` bump in Phase 1: the PR's one bump is made when the PR is opened.
- One headless browser at a time: `pgrep -fl chrome-headless-shell` first.
- Commits: conventional, named files only, ending with exactly one trailer line `Co-Authored-By: Claude <noreply@anthropic.com>` and no `Claude-Session` line. Implementers do not commit; the orchestrator commits each task on green.
- Shell: one plain command per call, literal absolute paths, no `cd`, `&&`, pipes, `;`, variables, loops or heredocs; quote globs; never `rm`.

## Review Focus

1. A killed session (timeout) prints no `result` event: its spend must be charged at `--budget`, never 0, and a resumed run must count it. Tested in Task 3.
2. A crash or Ctrl-C between cases: finished cases are on disk and `--resume` neither repeats nor forgets them; a half-written last line of `cases.jsonl` is ignored, not fatal. Tested in Task 3.
3. A stream with the same message id on several events (one per content block): calls must count ids, not events. Tested in Task 1.
4. A film that mentions an arm in its file names or leaves a `board/` in the workdir: the blind packet holds only the driver's own sheets under random names. Tested in Task 4.
5. A hostile or malformed `cases.jsonl` / ratings reply (a missing film, a rank for a name that does not exist, a tie): a missing rating makes that prompt undecided and says so, and is never counted as "not worse". Tested in Task 4.

## File Structure

| File | Responsibility |
|---|---|
| `eval/session.mjs` (modify) | parses a stream; adds `usage` |
| `eval/session-columns.mjs` (modify) | summary cells for `usage` |
| `eval/hosts.json` (modify) | adds `claude-stream` |
| `eval/lib.mjs` (modify) | arm folder, `depsFrom`, optional links, look ending |
| `eval/run-eval.mjs` (modify) | reads a stream for any `stream` host |
| `eval/run-arms.mjs` (create) | CLI driver |
| `eval/arms-lib.mjs` (create) | pure: order, ledger, medians, pass rule, blind packets, rating parsing |
| `eval/prompts/motion-budget.json` (create) | the ten prompts |
| `eval/test/usage.test.mjs`, `arms-lib.test.mjs`, `run-arms.test.mjs` (create) | tests |
| `eval/test/director-host.test.mjs`, `lib.test.mjs` (modify) | one host more has `budgetArgs`; new options |
| `eval/README.md` (modify) | the new host, driver, columns |

---

### Task 1: Usage columns from a session stream

**Files:** Modify `eval/session.mjs`, `eval/session-columns.mjs`. Test: `eval/test/usage.test.mjs`, `eval/test/session.test.mjs`.

**Interfaces:**
- Produces: `parseSession(text, opts).usage: { costUsd: number|null, calls, toolUses, pictures, renders, drafts, input: { fresh, write, read }, output }` for a readable session; `null` fields in an unreadable one. `usageCells(s)` and `USAGE_HEADERS = ['cost $', 'calls', 'tools', 'pictures', 'renders', 'drafts', 'input', 'output']` from `session-columns.mjs`.

Rules: `calls` is the number of distinct `assistant` message ids (any parent). `toolUses` is the number of `tool_use` blocks. `pictures` counts `Read` calls whose path ends in `png|jpg|jpeg|webp|gif`, anywhere. `input`/`output` are summed over `result.modelUsage` (`inputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`, `outputTokens`); with no `modelUsage`, over the distinct message ids' `usage`. `costUsd` is `result.total_cost_usd`. A **draft** is a Bash call that runs `draft.mjs`, or `make.mjs` with `--sheets-only`, `--no-render` or `--draft`. A **render** is a `make.mjs` call with none of those and none of `--list --outline --preview --poster --inspect --phonemes --compare-looks`. `--draft` joins `MAKE_LOOK_ONLY`.

- [ ] **Step 1: Write the failing tests** in `eval/test/usage.test.mjs`, using `helpers/stream-fixtures.mjs`:

```js
test('calls counts distinct message ids, not events', () => { /* two assistant events, id 'm1' twice and 'm2' */ assert.equal(u.calls, 2); });
test('tokens and cost come from the result event, subagent models included', () => { /* modelUsage with two models */
  assert.deepEqual(u.input, { fresh: 18, write: 43771, read: 234703 }); assert.equal(u.output, 3377); assert.equal(u.costUsd, 0.39786671); });  // the real pilot stream
test('no modelUsage: tokens are summed once per message id', () => { assert.deepEqual(u.input, { fresh: 3, write: 10, read: 20 }); });
test('a killed stream has no cost', () => assert.equal(parseSession(withoutResult).usage.costUsd, null));
test('drafts and renders are told apart', () => {
  // make.mjs film.json --json -> render; --sheets-only, --no-render, --draft, and node x/draft.mjs -> draft;
  // --list kinds, --outline, --poster 1, --compare-looks a -> neither
  assert.deepEqual([u.renders, u.drafts], [1, 4]); });
test('pictures counts image Reads only', () => assert.equal(u.pictures, 2)); // .png, .jpg; not film.json
```

and in `session.test.mjs`: `make.mjs film.json --draft --json` is not a make step.

- [ ] **Step 2: Run** `node --test "<abs>/eval/test/usage.test.mjs"`. Expected: FAIL (`usage` undefined).
- [ ] **Step 3: Implement** `usage` in `parseSession`, and `USAGE_HEADERS`/`usageCells` in `session-columns.mjs` (`-` for null; `unreadable` for an unreadable session; input shown as the sum of its three parts).
- [ ] **Step 4: Run** `node --test "<abs>/eval/test/*.test.mjs"`. Expected: all pass.
- [ ] **Step 5: Hand back** for the commit `feat(eval): read cost, calls, pictures and renders from a session stream`.

### Task 2: Host `claude-stream`, arm folders, and the workdir

**Files:** Modify `eval/hosts.json`, `eval/lib.mjs`, `eval/run-eval.mjs`, `eval/test/director-host.test.mjs`, `eval/test/lib.test.mjs`.

**Interfaces:**
- Consumes: `parseSession(...).usage`.
- Produces: `copySkill(src, work, { depsFrom = src, name = path.basename(src) })`; `prepareWorkdir(p, { ..., skillSrc })` (default `skillsRoot/<dir>`; `depsFrom` is always the repository's folder); `buildPrompt(skillCfg, task, host)` ends for a host with `stream: true` and no `agentFile` with exactly: `follow the workflow to the end, looking at what you made as it says; stop when the film is rendered and reported.` (the sentence before it, "Do not start serve.mjs or preview.mjs (they never exit);", stays); `summarize(rows, opts)` adds the `USAGE_HEADERS` columns after the session columns when a row has `session.usage`.

Host entry: `cmd` is the `claude-director` command without `Agent`, `Task`, `--forward-subagent-text` and `--include-hook-events`, plus `--effort high` before `--setting-sources`; `modelArgs`, `budgetArgs` as in the spec, `"stream": true`; `claude-director` gets `"stream": true`. `run-eval.mjs` reads the session and drops `MODEL_ENV_VARS` for any host with `stream`.

- [ ] **Step 1: Write the failing tests.** `lib.test.mjs`: (a) `copySkill` of a fake skill with `optional/voice/node_modules/pkg` and `node_modules/pkg` gives links in both places that resolve to the source packages, and a delete inside the copy leaves the source; (b) `prepareWorkdir` with `skillSrc` set to an arm folder that has no `node_modules` copies the arm's `SKILL.md` and links the repository's packages (top level and optional); (c) `buildPrompt` for `claude-stream` ends with the exact sentence above, and for `hosts.claude` is unchanged. `director-host.test.mjs`: the list test becomes `budgetArgs: ['claude-director', 'claude-stream']`, `agentFile: ['claude-director']`; `claude-stream` has `--effort high`, no `Agent`/`Task`, `--setting-sources project`, `--allowedTools` last. A fake-`claude` run through `run-eval.mjs --host claude-stream --model sonnet --budget 1` writes a `session.usage` in `results.json` and refuses to start without `--budget`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.** `copySkill`'s filter still skips `node_modules`; optional links are made after the copy with `linkNodeModules` for each `optional/*/node_modules` of `depsFrom`.
- [ ] **Step 4: Run** `node --test "<abs>/eval/test/*.test.mjs"`. Expected: all pass.
- [ ] **Step 5: Hand back** for `feat(eval): claude-stream host, arm folders and linked voice packages`.

### Task 3: `run-arms.mjs`, the driver

**Files:** Create `eval/run-arms.mjs`, `eval/arms-lib.mjs`, `eval/test/arms-lib.test.mjs`, `eval/test/run-arms.test.mjs`.

**Interfaces:**
- Consumes: Task 1 and 2 exports.
- Produces (`arms-lib.mjs`): `caseOrder(promptIds, arms) -> [{ prompt, arm }]` (arms rotate by one each prompt: A D C, D C A, C A D, …); `readLedger(text) -> { cases, spentUsd }` (a last line that does not parse is dropped; every other bad line throws); `chargeOf(session, budget) -> number`; `mayStart(spentUsd, budget, maxTotal) -> boolean`.
- CLI: `node eval/run-arms.mjs --skill motion --set budget --host claude-stream --model sonnet --arm A=<folder> --arm D=<folder> --arm C=<folder> --budget 1.00 --max-total 20 --timeout 1800 --out <dir> [--resume] [--limit n] [--dry-run]`. `--dry-run` prints the case count, order, worst-case spend and starts nothing.

Each case: workdir from `prepareWorkdir` with the arm's `skillSrc`; `run`; score with the repository's own skill folder (`scoreRun({ skillDir: <repo skill> })`); copy to `<out>/cases/<prompt>/<arm>/`: `transcript.txt`, the spec, the sheets folder the repository's run made, `output.log`, and `out/film.mp4` if the session wrote one (`keepFiles: ['out/film.mp4']` on the motion entry of `SKILLS`, copied if present, never part of `outputOk`). `mp4` in the case record says whether the session wrote it, read before `scoreRun`. Append the record to `<out>/cases.jsonl` at once: `{ prompt, arm, seconds, timedOut, exit, specExists, finalValid, outputOk, checkOk, mp4, chargeUsd, usage, errors, film: { designedCuts, devices } }`. `failed` is computed by the reader, not stored: not `mp4`, or not `checkOk`, or `timedOut`, or `session.capped`.

`film` counts, from the saved spec: `designedCuts` = number of shots whose own `cut` is a string other than `cut` or an object whose `type` is not `cut`; `devices` = number of `on` events with a `do`. A look's or root cut is not counted.

- [ ] **Step 1: Write the failing tests.**

```js
test('caseOrder rotates arms', () => assert.deepEqual(caseOrder(['p','q'], ['A','D','C']).map((c) => c.prompt + c.arm), ['pA','pD','pC','qD','qC','qA']));
test('a case with no cost event is charged the whole budget', () => assert.equal(chargeOf({ readable: true, usage: { costUsd: null } }, 1), 1));
test('a case starts only if the budget still fits', () => { assert.equal(mayStart(19, 1, 20), true); assert.equal(mayStart(19.01, 1, 20), false); });
test('a half-written last line of the ledger is dropped, a bad middle line throws', () => { /* ... */ });
test('filmCounts: a root cut, a look cut and a plain cut are not designed cuts', () => assert.deepEqual(filmCounts(spec), { designedCuts: 2, devices: 3 }));
```

`run-arms.test.mjs` (fake `claude` printing a stream, fake skill, two prompts, two arms): (a) four cases run in order and `cases.jsonl` has four lines; (b) `--max-total 2` with `--budget 1` and a fake that reports $0.90 stops after two and exits 3 with `ceiling reached`; (c) kill after two lines, `--resume` runs only the other two and its spend starts at the first two's; (d) `--dry-run` starts no host; (e) an arm whose folder lacks `SKILL.md` is refused before any case; (f) a fake that times out is charged the budget and recorded `timedOut`; (g) the repository's skill scores: an arm copy whose `make.mjs` always reports ok is still scored by the fake repository skill, which fails it.

- [ ] **Step 2: Run** the two files. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** both modules; `filmCounts(spec)` is exported from `arms-lib.mjs`.
- [ ] **Step 4: Run** `node --test "<abs>/eval/test/*.test.mjs"`. Expected: all pass.
- [ ] **Step 5: Hand back** for `feat(eval): run-arms driver with one spend ceiling and resume`.

### Task 4: Blind packets, ratings and the pass rule

**Files:** Modify `eval/arms-lib.mjs`, `eval/run-arms.mjs`; tests in `arms-lib.test.mjs`.

**Interfaces:**
- Consumes: the case records of Task 3.
- Produces: `node eval/run-arms.mjs --packets <out>` writes `<out>/blind/<prompt>/<name>/*.png` (only PNG files of the repository-made sheets folder, no `board/`, no text files), `<out>/blind/<prompt>/brief.txt` (the prompt's text), and `<out>/key.json` (`{ prompt: { name: arm } }`), names being three random words of equal length from `crypto.randomInt`. A failed case has no packet and its name is absent. `parseRatings(text, names) -> { ranks: { name: 1..3 } } | null` (a reader's JSON `{ "ranks": { "<name>": 1 } }`, ties allowed; unknown or missing names give null). `worseThanA(rankings, name, aName) -> boolean|null` (true when at least 2 of 3 readers put it strictly below A; null when fewer than 2 readers parsed). `verdict(cases, ratings, key) -> { prompts, arms: { D, C }, decision: 'C'|'D'|'none'|'inconclusive', reasons }` and `--verdict <out>` printing it and writing `<out>/verdict.md`.

Pass rule, per arm: median of (arm cost / A cost) over usable prompts at most 0.80; rated worse in at most 2 of 10; a failed case counts as worse and as a ratio above 0.80; no failed case except where A failed too; median `designedCuts` and median `devices` over the new briefs (ids starting `film-`) not below A's. A failed A drops the prompt; fewer than 8 usable prompts, an undecided rating, or missing cases give `inconclusive`. `C` is chosen when it passes and its median ratio is at least 0.05 below D's or D fails; `D` when D passes otherwise; else `none`.

- [ ] **Step 1: Write the failing tests** for each rule above, one test per clause, plus: a packet holds no file whose name or content names an arm (`readdirSync` recursive, no `A`/`D`/`C` folder, no `.json`, no `board`); a reply naming a film that does not exist gives null; a tie with A is not worse; two readers of three below A is worse; one is not; a prompt with no rating is undecided and the verdict is `inconclusive`; a `0.80` ratio passes and `0.8001` does not; nine usable prompts are fine and seven are `inconclusive`.
- [ ] **Step 2: Run** `node --test "<abs>/eval/test/arms-lib.test.mjs"`. Expected: FAIL.
- [ ] **Step 3: Implement.** Names are never derived from the arm; the packet copy is by file content, sheets only.
- [ ] **Step 4: Run** `node --test "<abs>/eval/test/*.test.mjs"`. Expected: all pass.
- [ ] **Step 5: Hand back** for `feat(eval): blind packets, rating parser and the pre-registered pass rule`.

### Task 5: The ten prompts and the arms

**Files:** Create `eval/prompts/motion-budget.json`; scratch `.scratch/token-budget/arms/{A,D,C}/make-motion/` (repository root, not committed). Modify `eval/test/lib.test.mjs` if its prompt-file checks need the new set; `eval/README.md`.

- [ ] **Step 1:** Write the set: the five existing prompts, unchanged except `viral-vertical`, which adds "Make it silent: write sound off.", and `clipping-highlight`, whose "when the narration says 'face'" and "Narrate" become "when the `say` text names the face" and "Write `say` lines for", with no voice; and five new ones with ids `film-data`, `film-launch`, `film-how`, `film-before-after`, `film-recap`. Each new brief: 20 to 40 s, `pro` mode, silent, no shot list, numbers and facts given in the text, no asset outside `fixtures/data/`, and an `expect` list (for example `show=chart` for `film-data`). A test checks: ten entries, unique ids, no `seed`, the set loads with `loadPrompts(dir, 'motion', 'budget')`, every existing-prompt expectation kept.
- [ ] **Step 2:** Build the arm folders from the repository's `skills/make-motion` without `node_modules`, `test`, `out`. A: untouched. D and C: `SKILL.md` edited to the short path of design 6.2 within 22,400 bytes and 129 lines (the script `node --test bin/test/skill-budget.test.mjs` logic, run by hand on the two files). Both keep the storyboard rule and name cuts and devices. C also has `scripts/start.mjs` and `scripts/draft.mjs`, pure Node, no counter: `draft.mjs film.json` runs the outline, then `--sheets-only` (voice made), then `--sheets-only --estimated` (board), and prints `{ ok, findings, shots, open, board, sheets }`.
- [ ] **Step 3:** Prove them without a model: run `doctor.mjs --json` inside a prepared workdir of each arm and of a voiced film (`prepareWorkdir`), and confirm voice is found; run C's `start.mjs data`, `start.mjs explainer`, `start.mjs vertical` (each under 30,000 characters) and C's `draft.mjs` on `fixtures/review/good.json` (one browser, `pgrep` first) and open the board picture. If voice is not found in the workdir, replace `voiced-pro` by a sixth new brief and say so.
- [ ] **Step 4:** `node eval/run-arms.mjs … --dry-run` lists 30 cases, worst case $30 capped at $20.
- [ ] **Step 5:** Hand back for `feat(eval): the token-budget prompt set`; the arms stay in `.scratch`.

### Task 6 (orchestrator): review, then the billed test

- [ ] **Step 1:** Reviewer-tier review of Tasks 1 to 5's diff; fix CRITICAL and HIGH; push is after review.
- [ ] **Step 2:** Run the first prompt's three cases (`--limit 1`). Check: cost present in each stream, model is Sonnet, only project settings, no fault in the harness. A fault stops here.
- [ ] **Step 3:** `--resume` for the rest, in the background, no other browser work.
- [ ] **Step 4:** `--packets`; three reviewer-tier readers per prompt, each told only the brief and the packet folder, writing ranks as JSON; no key, no cost.
- [ ] **Step 5:** `--verdict`; write `docs/superpowers/plans/2026-11-24-motion-token-budget-p1-report.md` and a row in `eval/results/INDEX.md` with host version, plugin version, command line and spend. Report to the owner. Stop before Phase 2.

**Result (2026-11-24):** verdict none; see `plugins/portable-artifacts/eval/results/summary-motion-token-budget-2026-11-24.md`, which replaces the report of Task 6 step 5. Phase 2 is not started. Open before any push: the six HIGH findings of the second review of the driver, and one `plugin.json` bump or `[skip-plugin-bump]`.
