# Paired test: make-motion token budget, 2026-11-24

Arms: **A** today's make-motion (2.4.0). **D** a short path over existing commands. **C** a short path with throwaway
`start.mjs` and `draft.mjs`. Both short arms were scratch copies that fitted the SKILL.md budget. Nothing in them shipped.

- Host `claude-stream`, Claude Code 2.1.330, Sonnet 5.5 at high effort, `--setting-sources project --strict-mcp-config`; plugin 2.4.0 (working copy).
- Command: `node eval/run-arms.mjs --skill motion --set budget --host claude-stream --model sonnet --arm A=... --arm D=... --arm C=... --budget 1.00 --max-total 19.20 --timeout 1800 --out <dir>`.
- The pass rule, written before the run (design 5.4): median cost ratio to A at most 0.80; rated worse than A in at most 2 of 10; no failed case; designed cuts and devices not below A's on the five new briefs.
- Spend: $10.19 for these 30 cases (list price as reported by the CLI) plus $0.80 for a smoke run that was discarded, because the first arm's session had loaded 13 account MCP servers and 147 tools and the others none. All 30 kept cases had 0 MCP servers and 27 tools.
- Ratings: three Opus readers, blind names, ties allowed. **Deviation from the protocol:** each reader rated all ten prompts in one session from one montage per film (shots and cut strips in film order), not one fresh reader per prompt with full-size sheets. They are the same model family as each other and the film makers, and they saw stills, not motion.
- **How to read "rated worse on 6 of 10".** The limit was strict: an arm exactly as good as A, with forced ranks and few ties, lands below A on about half the prompts and passes "at most 2 of 10" about 5% of the time (binomial, p = 0.5). Mean rank over the 30 readings: A 1.77 (13 firsts), D 1.93 (12), C 2.17 (8). Read that as D about level with A and C somewhat worse. The split is clearer than the average: on the five long briefs A was first for all three readers on three; on the five short ones D was first or tied first for all three readers on two and above A on four.
- **The drop is not explained by length of path.** D and C also told the agent to give each shot a designed cut, which A does not. On the long briefs they wrote 2 to 6 author cuts each. A wrote none and no root cut either: its films used the look's own cuts, which `filmCounts` does not count. So the designed-cuts column shows the instruction, not the quality of the cuts. The two changes cannot be separated in this run.
- **The earlier figure did not replicate.** The spike (one run per arm, large context) had C 30% cheaper. Here C is 13% cheaper by median and 19% in total; D is 2% and 4%. On the five short prompts D cost more than A ($1.47 against $1.31).
- **What fell with the shorter paths:** renders 21 (A) to 10 (D) and 12 (C); pictures opened 59 to 44 and 33.
- Totals over ten prompts: A $3.67, D $3.53, C $2.99. Cache writes are 61 to 63% of each arm's bill, cache reads 17 to 18%, output 20 to 21%.

# Verdict: none

Reasons:

- D: median cost ratio 0.9789 is above 0.80
- D: rated worse than A in 6 prompts, at most 2 allowed
- C: median cost ratio 0.8672 is above 0.80
- C: rated worse than A in 6 prompts, at most 2 allowed

10 usable prompts of 10. Ten prompts is a small sample: one model, one host, one machine. Costs are USD; a ratio is the arm's cost over A's. At most 2 prompts may be rated worse, whatever the number of usable prompts (10 usable here: 2 of 10).

| arm | median cost ratio | rated worse | failed | median designed cuts (new briefs) | median devices (new briefs) | rule |
|---|---|---|---|---|---|---|
| D | 0.9789 | 6 | 0 | 4 (A 0) | 0 (A 0) | fails |
| C | 0.8672 | 6 | 0 | 4 (A 0) | 0 (A 0) | fails |

| prompt | A cost | D cost | D ratio | D vs A | C cost | C ratio | C vs A | missing features (report only) | note |
|---|---|---|---|---|---|---|---|---|---|
| short-statement-hook | 0.21 | 0.24 | 1.1481 | no | 0.19 | 0.8913 | worse | - |  |
| short-clipping-highlight | 0.25 | 0.26 | 1.0666 | no | 0.26 | 1.0598 | no | - |  |
| short-chart-bar | 0.25 | 0.28 | 1.1609 | worse | 0.22 | 0.8878 | worse | - |  |
| short-viral-vertical | 0.22 | 0.33 | 1.5247 | no | 0.19 | 0.9028 | worse | - |  |
| short-voiced-pro | 0.39 | 0.36 | 0.9117 | no | 0.27 | 0.6871 | no | - |  |
| film-data | 0.40 | 0.35 | 0.8762 | worse | 0.34 | 0.8466 | no | - |  |
| film-launch | 0.47 | 0.42 | 0.8909 | worse | 0.39 | 0.8374 | worse | - |  |
| film-how | 0.66 | 0.47 | 0.7149 | worse | 0.47 | 0.7186 | worse | - |  |
| film-before-after | 0.37 | 0.38 | 1.0228 | worse | 0.37 | 1.0023 | no | - |  |
| film-recap | 0.47 | 0.44 | 0.935 | worse | 0.29 | 0.6058 | worse | - |  |
