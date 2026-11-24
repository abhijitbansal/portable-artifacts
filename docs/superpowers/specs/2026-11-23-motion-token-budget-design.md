# Design: make-motion token budget

Date 2026-11-23. Status: approved by the owner on 2026-11-24 (section 10 answered). The owner approved the plan this is built from (plan page
`token-budget-plan-nov-2026`, verdict approve) with: skill only, paired test first, 2 polish rounds and a hard stop at 6,
release orchestration left out. Lines marked **[call]** are the author's choices, made while turning the plan into a
design; the owner has not answered them.

Evidence (gitignored, local): `.scratch/token-budget/` holds `plan.md` (revision 3), two planner-tier reviews and
`evidence/` (scripts, outputs, the spike arms).

## 1. Intent

A film should cost fewer tokens to make, on any agent host, with nothing to install. Cost is calls times context: every
call resends the conversation, every picture stays in it. The skill can cut the calls it asks for, the text and
pictures it puts in the context, and repeat renders. It cannot cut the host's own start or a long session's history.

What is known: one run per arm, one silent 30 s `desk` film, Sonnet, Claude Code. Today 17 calls and $0.54; a short path
with existing commands 19 calls and $0.45; a short path with merged commands 13 calls and $0.37. The two cheaper films
had fewer designed cuts (1 and 0, against 4). Dollars are tokens at list price.

## 2. Goals, non-goals, anti-goals

Goals

- Median cost of a film at least 20% lower than today's skill on the same prompts, films rated not worse.
- The same text and commands on Claude Code, Codex, Copilot, opencode and Gemini. Only Claude Code is measured here.
- The picture `review.md` cites still exists after the final render.

Non-goals

- No agent file, no installer change, no doctor change (plan Part 2, parked until a whole-session measurement).
- No change to this repository's `AGENTS.md` or release process.
- The other four skills: each is measured first, in a later change.
- No pixel-hash "changed shots only", no `--job` or `--wait`, no viewer agent, no diet of consent text.

Anti-goals

- Cheaper because plainer: fewer designed cuts or devices is a failure even at half the cost.
- A film reported done with an open `mechanical` finding.
- Losing a step that asks the user: intake, doctor consent, voice consent, the storyboard for a film over 20 s.
- A draft limit that stops a valid film from being finished.

## 3. Constraints

- `skills/make-motion/SKILL.md` is 21,868 bytes and 125 lines against a pinned 22,400 and 129 (`bin/test/skill-budget.test.mjs`).
  Both spike arms (22,995 and 23,059 bytes) are over it. The short path replaces Workflow text; it does not raise the cap, and
  the arms under test fit it, so the tested text can ship.
- One command per call, no pipes or chains (SKILL.md's own rule). Arm D's one-call `cat` of four files fits it.
- The `make.mjs --json` report keeps `ok`, `output`, `sheets`, `stages` and `findings`: `artifact-builder`,
  `motion-reviewer` and `eval/session.mjs` read them.
- One headless browser at a time. No new dependency. `engine/**` is not touched.

## 4. Approaches

1. **Skill text only** (short path over existing commands). Smallest change; saved 16% in one run, all of it by opening
   one board instead of six sheets; calls did not fall.
2. **Short path plus merged commands** (`--draft`, `start.mjs`). Saved 30% in one run, because calls fell too. More code.
3. **Skill plus an installed agent.** Small start context (23.7K against 47.7K to 65.5K), but it pays only once the
   conversation is past roughly 65K to 100K (estimate), and the install, offer-once and opencode parts do not exist.

The owner picked skill only. The paired test chooses between 1 and 2.

## 5. Phase 1: measure (gate for everything after it)

### 5.1 Eval changes (code, needs no billed run)

The harness cannot run the test today: only `claude-director` streams the session, and it refuses `--model`, writes the
operator file and changes the prompt; the plain `claude` host loads user-level setup and records no cost; every host
copies the one `skills/make-motion` and scores with that copy.

- **Host `claude-stream`** in `hosts.json`: the `claude` command plus `--output-format stream-json --verbose`
  `--setting-sources project`, `modelArgs`, `budgetArgs` and effort high; no agent file. `run-eval.mjs` reads a stream for any
  host marked `"stream": true` (`claude-director` too) and drops the two model variables for it. Its prompt ends "follow the workflow
  to the end, looking at what you made as it says; stop when the film is rendered and reported". **[call]** The plain ending
  ("stop after validate and build/render") invites arm A to skip its look step, which would hide the cost being measured.
- **A driver, `eval/run-arms.mjs`** **[call]**: one process that owns the whole test, because `run-eval.mjs` runs one set and one skill
  folder per process, so a cap and an interleaving across arms cannot live there. It takes `--arm name=<skill folder>` (repeatable), one
  prompt set, `--model`, `--budget`, `--max-total` and `--out`; it runs prompt by prompt, arms in rotating order; it appends
  each case to `cases.jsonl` as it ends, and `--resume` skips finished cases and counts their spend. A case may start only if spend so
  far plus `--budget` fits under `--max-total`. A case whose stream has no cost event (a timeout) is charged its full `--budget`.
- **Scoring uses the repository's engine.** Today the harness scores with the workdir's copy of the skill. The driver scores and redraws
  sheets with the repository's own copy, so every arm is judged by one engine; a spec the repository refuses is a failed case.
- **Voice in the workdir.** `copySkill` drops `optional/*/node_modules`. It links them as it links the top-level folder. The smoke check
  runs the doctor in a prepared workdir, no model call: if voice is not found there, the voiced prompt is replaced by a sixth new brief.
- **Columns** from stream events: cost, model calls (distinct assistant message ids), tool uses, pictures opened (Read of an image),
  renders, drafts, input tokens (fresh, cache write, cache read) and output tokens. A draft is a `make.mjs --sheets-only`, a
  `make.mjs --draft` or a `draft.mjs` call. `--draft` counts as look-only for the "make" step, as `--list` and `--outline` do.
- **Kept files** for motion: the MP4 and the spec, through a new list that does not change `outputOk`.

### 5.2 Prompts **[call, changes the approved test]**

`motion.json` holds eleven prompts, not ten, and six of them ask for a single shot. A one-shot film cannot show lost cuts, so the
ten alone could pass the quality rule without testing it. The set becomes ten: five existing (`statement-hook`, `clipping-highlight`,
`chart-bar`, `viral-vertical`, `voiced-pro`) and five new briefs of 20 to 40 s with no shot list: a data story, a product launch, a
how-it-works, a before and after, a news-style recap. They live in one file, `prompts/motion-budget.json` (`--set budget`). Where a
brief must be silent it says so, with `"sound": "off"` for the `viral` one, and `clipping-highlight`'s "narrate" is reworded.

### 5.3 Arms

- **A** today's skill, unchanged.
- **D** the short path over existing commands.
- **C** the short path with two throwaway Node scripts, `start.mjs` and `draft.mjs` (outline, sheets, board, compact verdict). It does not
  implement the counter, the refusals or the render skip. The spike's Python overview is dropped: the test host does not allow
  `python3`, and the board replaces it.

Both short paths name the registered cuts and devices and ask for designed ones, because the first spike lost them, and keep the
storyboard rule (`--non-interactive` in this host). A keeps its own wording, since it is the baseline. Arms are scratch copies under
`.scratch/token-budget/arms/`.

### 5.4 Runs, spend and the rule

- Sonnet, effort high, `--timeout 1800`. 10 prompts times 3 arms is 30 sessions, one at a time. The first prompt's three cases are the
  smoke test; a harness fault there stops the run before the other 27.
- Expected about $14 at list price (estimate: three runs' mean times 30). `--budget 1.00` per case; `--max-total 20`, because a cap
  equal to the expected spend would stop the test a few cases short. The owner approved the $20 ceiling on 2026-11-24.
- **Incomplete or failed.** A case that hits its budget or timeout, writes no MP4, or fails the repository's check is a failed case: it counts as rated
  worse than A and as a cost ratio above 0.80. If A fails a prompt, that prompt is dropped; with fewer than eight prompts left,
  or the ceiling reached, the test is inconclusive and the owner decides.
- **Ratings.** Films are judged from contact sheets the driver redraws, under random names; the key is in a separate file. Three reviewer-tier readers,
  one prompt at a time, see the brief and three films in shuffled order and rank them, ties allowed, for clarity, design (cuts, devices, pacing as
  the strips show) and faults. A film is "rated worse than A" when at least two of three rank it strictly below A. No reader sees cost. They
  run as subagents of this session, not as billed `claude -p` runs; their tokens are reported apart.
- **Pass rule**, written before the run, for each of D and C:
  1. the median over prompts of (arm cost / A cost) is at most 0.80;
  2. rated worse than A in at most 2 of 10;
  3. no failed case except where A failed too;
  4. over the five new briefs, the median count of designed cuts and the median count of devices per film are not below A's. A designed
     cut is a `cut` the author wrote on a shot, other than a plain `cut`; a look's own or a root cut does not count. A device is one named in the film.
- **What happens next**

| Result | Build |
|---|---|
| C passes, and its median ratio is at least 5 points below D's, or D fails | Section 6 whole |
| D passes otherwise | 6.1 and 6.2 over existing commands; no new commands |
| Neither passes | 6.1 only, if the owner wants it; the rest stops |

Ten prompts is a small sample. The report gives each prompt's numbers, not only medians, and says one model, one host, one machine.

## 6. Phase 2: build what passed

### 6.1 The board outlives the render

`scripts/v2/run.mjs` writes the board only under `--estimated`, and every whole-film run first deletes the old strips. The
change: every whole-film run that writes sheets also writes the board; a slice still leaves it alone, and batch rows write theirs. A
new `board` stage in the report is expected. A test that fails today: render a film, then every strip in `report.board` exists.

This removes one protection: today `storyboard.mjs --stills` after a render finds no strips; with them kept, an edit followed by
`--stills` would carry old pictures. So the board folder gains `board.json` (a hash of the film and whether times were measured or estimated), and
`--stills` refuses strips whose hash is not the film's, and prints "estimated" only when they are. `references/tools.md` and `schema.md` follow.

### 6.2 Short path in SKILL.md

One numbered path, one command each, replacing the Workflow's Outline, Build and Look steps. It keeps intake, the doctor
consent, voice and the storyboard rule. It says: write the whole film once with designed cuts and devices; open the board first; open another
sheet only for a shot the report lists; fix everything in one round; render once; write `review.md` and report
in the same turn. No `storylines.md` after the fact. Follow-ups stay in the conversation, as today.

- **Hand-off.** **[call]** On the short path the director runs the commands itself. The operator is for a finished film that only needs rendering
  (a batch, or a user who asks for it). The Director and operator section, its "view the files listed under `sheets`" line and
  `references/reviewing.md` ("open every sheet") are changed to agree. `motion-reviewer` is not part of the short path and still opens every sheet.

### 6.3 `make.mjs <film.json> --draft`

- Does what `--sheets-only` does, with the voice made and cached, so timed anchors are judged on measured times.
  **[call]** One rule for voiced and silent films; `--estimated` stays for the storyboard. `--sheets-only` stays and is not counted.
- Refuses flags that make no sense with it, in the style of `cli.mjs`.
- The report gains `draft: { number, polish, left, open: [{ shot, sheet, why }] }` and one line per shot (start, end, words).
  `sheets`, `stages`, `findings` stay as they are.
- **`open`** holds each shot that has a finding, `on` events, a clip, a screen, a map, `media`, `free` or `marker`; every
  shot of a `viral` film; and the strip of each designed cut (5.4's definition).
- **Counter.** Only a run that drew sheets counts: an invalid film, machine trouble and Ctrl-C do not. A draft is a polish round when the counted draft
  before it was `ok`. A third polish round is refused. Six counted drafts is the hard stop, whatever their `ok`. A refusal is exit 2 with
  `error.hint`: render if `ok`, else report the open findings. A render whose report is `ok` (an unchanged one too) resets the counter.
  A not-`ok` render does not. `--force` on a draft resets it; SKILL.md allows that only after a new message from the user.
- **State file** `<out dir>/.draft/<output name>.json` **[call]**, keyed by the output path: the counter, the last `ok` render's
  fingerprint and its whole report, and the fingerprint of the pictures last drawn. A missing or unreadable file means "start at zero", never an error.

### 6.4 An unchanged film is not rendered again

A whole-film render is skipped when the last `ok` render's fingerprint is equal, the MP4 is still there with the recorded size, and the pictures last
drawn are this film's. It exits 0 with the stored report plus `unchanged: true`. If the pictures are not this film's, it runs in full. The
fingerprint covers the film text, the bytes of every file the film names, every flag that changes the output, and the plugin version. Slices, posters,
batches and `--subtitles` are never skipped. `--force` renders.

### 6.5 `scripts/start.mjs <explainer|data|vertical>`

`--part 1` prints the type guide, `story.md` and `tells.md` (about 14,000 characters); `--part 2` prints the kinds and the cut and device names (about
14,000). SKILL.md says to run both in one turn. Two parts because a Copilot probe on 2026-11-24 saw whole output at 18 KB and a saved file with a short preview at 24 KB;
each part stays under 18,000 characters and a test pins that. `reviewing.md` is left out: the short path carries the part it needs. It does not run the doctor or hide consent text.

### 6.6 Around it

`eval/session.mjs` and `docs-facts` follow the new flags. `artifact-builder` keeps running `make.mjs <spec> --json`;
nothing in its text changes. Version bump, changelog, USAGE and README as for any change under `plugins/`.

## 7. Phase 3: prove the shipped text

One paired run of the text that ships against today's skill on the same ten prompts (about 20 more billed runs, a new yes from the
owner). And an overview power test at the board's real size: planted clipped text mid-shot, a wrong highlight, small text on a
vertical film, a broken cut, three readers. If the readers miss one the full sheets catch, that fault's shot type joins `open`; if
they miss two or more, the short path goes back to opening every sheet.

## 8. Review focus

1. A film finished with a wrong picture because `open` left a shot out. Covered by the power test and by `open` reasons in the report.
2. A legitimate render refused. The fingerprint test changes one asset byte, one flag and the version, each alone.
3. A counter that blocks a follow-up. Tests: six failed drafts then a render; a render then a new edit; a deleted state file.
4. An arm with an unfair advantage. Same wording on cuts, same storyboard rule, scored by one engine, blind names.
5. A spend over the owner's yes. `--budget` and `--max-total` are tested with a fake host that reports cost.

## 9. Left to the builder

Names of helpers and test files, the exact wording of refusals, where the fingerprint code lives, how the summary formats
the new columns, and the wording of the five new briefs within 5.2.

## 10. Answered by the owner (2026-11-24)

- The design is approved. Run to the paired test's result; Phase 2 code waits for the owner to see it.
- Prompts: five existing and five new (5.2).
- Ceiling: $20 in total, $1.00 per run (5.4).
- Host probe: Copilot only, now; no Codex.
- Still to ask: Phase 3's extra runs (about 20), when Phase 2 is done.
