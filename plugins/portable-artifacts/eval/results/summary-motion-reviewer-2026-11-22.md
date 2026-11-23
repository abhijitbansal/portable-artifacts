# Reviewer proof: motion-reviewer, 2026-11-22

- Command: `node eval/review-proof.mjs --runs 3 --budget 2 --max-total 30 --sheets <repo>/.scratch/review-proof` (the sheets folder is shortened here from its absolute path; it holds `<name>.report.json` and `<name>.sheets/` for the five films in `eval/fixtures/review/`, made with `make.mjs <film> --sheets-only --json`)
- Copied from `results/2026-11-22T17-33-35/motion-reviewer/summary.md` (gitignored), then edited: the sheets path is shortened to `<repo>`, and a few lines are added (the pilot, the reworded checklist, what the proof does not show).
- Plugin version 2.2.1, W5 branch at commit 6173284 (the agent file's instructions are that commit's wording); host `claude-director`, CLI 2.1.330 (Claude Code); 3 runs of 5 films, each session capped at 2 USD.
- Bar: every planted defect found in all 3 runs (a fail verdict with a P0 or P1 note on the planted shot), and at most 1 false fail on the good film.
- **PASSED**. Defects found per film: number-mismatch 3/3, chart-wrong-mark 3/3, picture-contradicts 3/3, orphan-shot 3/3. False fails on the good film: 0.
- Agent that ran, read from the stream: motion-reviewer; model of the agent's own messages: claude-opus-5-5; director model: claude-opus-5-5.
- Cost read from the streams: 4.83 USD over 15 sessions.
- Pilot before it: `--runs 1 --budget 2 --max-total 10` (5 sessions, 1.74 USD, same agent file). It found 4/4 with 0 false fails. The full run above is the proof; the pilot only decided to spend on it.
- The reviewer's checklist (`agents/motion-reviewer.md`, format 3) was reworded before the pilot so that it checks each shot's `say` line against its sheets and names no planted defect class. Those are the instructions this proof is of; a later rewording is a new proof.
- **What the proof shows, and what it does not (corrected after review).** It shows that the agent finds defects that the film's spec and its narration state, and that it replies in the agent's JSON format. Every planted defect could also be read from `film.json` alone (`value: 24` against "Forty two percent", `highlight: "May"` against "March was the peak", the region `blue` against "the red button", the shot id `aside`), and the scorer (`eval/review-score.mjs`) never checks `looked`, the sheets the agent names. So it does not show that the agent reads pictures. A later proof should record `looked`, require that it names the planted shot's sheet, and add a defect that only the pixels show.
- The proof ran the agent as a workdir file (`.claude/agents/motion-reviewer.md`), not as the plugin's `portable-artifacts:motion-reviewer`. `references/reviewing.md` gained its `## Second reviewer` section after this proof, so the proven agent read a `reviewing.md` without it.
- What this does not show: the films are silent, have one defect each and use one look (`desk`); the reviewer ran on one model (the agent file pins `model: opus`, which was claude-opus-5-5 here), and 15 sessions are one sample of its variance. It also wrote P2 notes on shots without a planted defect (the good film drew a P2 in 2 of 3 runs, which the verdict ignores).

| film | run | delegated | verdict | notes (level, shot) | cost USD | counted |
|---|---|---|---|---|---|---|
| good | 1 | yes | pass | - | 0.30 | yes |
| number-mismatch | 1 | yes | fail | P0 figure, P2 claim | 0.30 | yes |
| chart-wrong-mark | 1 | yes | fail | P0 chart | 0.30 | yes |
| picture-contradicts | 1 | yes | fail | P0 look, P1 look | 0.35 | yes |
| orphan-shot | 1 | yes | fail | P1 aside | 0.34 | yes |
| good | 2 | yes | pass | P2 claim | 0.30 | yes |
| number-mismatch | 2 | yes | fail | P0 figure, P2 chart | 0.32 | yes |
| chart-wrong-mark | 2 | yes | fail | P0 chart | 0.30 | yes |
| picture-contradicts | 2 | yes | fail | P0 look, P1 look, P2 chart | 0.36 | yes |
| orphan-shot | 2 | yes | fail | P1 aside, P2 claim | 0.34 | yes |
| good | 3 | yes | pass | P2 chart | 0.31 | yes |
| number-mismatch | 3 | yes | fail | P0 figure, P2 chart | 0.33 | yes |
| chart-wrong-mark | 3 | yes | fail | P0 chart, P2 chart | 0.30 | yes |
| picture-contradicts | 3 | yes | fail | P0 look, P1 look | 0.35 | yes |
| orphan-shot | 3 | yes | fail | P1 aside | 0.34 | yes |
