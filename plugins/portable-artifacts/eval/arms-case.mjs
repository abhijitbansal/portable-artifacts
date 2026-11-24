// One case of the arms driver: a prompt run through one arm's copy of the skill, then scored with the repository's own skill.
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_ENV_VARS, buildPrompt, expandCmd, prepareWorkdir, run, scoreRun } from './lib.mjs';
import { readSession } from './session.mjs';
import { chargeOf, filmCounts } from './arms-lib.mjs';

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
};

// A path inside the workdir, copied to the case folder under its base name when it is there. A folder (the sheets) is copied
// as its PNG files only: no board folder, no other file.
function keep(work, rel, caseDir) {
  const src = path.join(work, rel);
  if (!fs.existsSync(src)) return;
  const filter = fs.statSync(src).isDirectory() ? (from) => from === src || (fs.statSync(from).isFile() && /\.png$/i.test(from)) : undefined;
  fs.cpSync(src, path.join(caseDir, path.basename(rel)), { recursive: true, filter });
}

const wroteMp4 = (work, skillCfg) => (skillCfg.keepFiles ?? []).filter((f) => f.endsWith('.mp4')).some((f) => fs.existsSync(path.join(work, f)));

/**
 * Run one case and return its ledger record. The workdir holds the arm's copy of the skill (`skillSrc`); the session runs there.
 * Before scoring, the MP4 and the film counts are read from what the session left, and the artifact folders are cleared, because
 * scoring rewrites them and the sheets kept are exactly those the repository's engine drew. Scoring uses the repository's skill
 * folder (`skillsRoot/<dir>`), never the arm copy, so every arm is judged by one engine. The workdir is removed at the end.
 */
export async function runCase({ prompt: p, arm, skillSrc, skillCfg, host, model, budget, timeoutSec, caseDir, skillsRoot, evalDir }) {
  const { work, seedSpec } = prepareWorkdir(p, { skillCfg, skillsRoot, evalDir, host, skillSrc });
  try {
    fs.rmSync(caseDir, { recursive: true, force: true }); // what a killed earlier try of this case left must not mix into this one
    fs.mkdirSync(caseDir, { recursive: true });
    const transcript = path.join(caseDir, 'transcript.txt');
    const argv = expandCmd(host, { prompt: buildPrompt(skillCfg, p.prompt, host), cwd: work, model, budget: String(budget) });
    const r = await run(argv, {
      cwd: work, env: { PA_OUTPUT_DIR: path.join(work, 'out') }, dropEnv: MODEL_ENV_VARS, timeoutMs: timeoutSec * 1000, logFile: transcript,
    });
    const session = readSession(transcript, { specName: skillCfg.spec });
    const film = filmCounts(readJson(path.join(work, skillCfg.spec)));
    const mp4 = wroteMp4(work, skillCfg);
    for (const f of skillCfg.keepFiles ?? []) keep(work, f, caseDir);
    for (const a of skillCfg.artifacts) fs.rmSync(path.join(work, a), { recursive: true, force: true });
    const score = await scoreRun({ work, skillCfg, skillDir: path.join(skillsRoot, skillCfg.dir), seedSpec, expect: p.expect, maxChanged: p.maxChanged });
    for (const f of [skillCfg.spec, 'output.log', ...skillCfg.artifacts]) keep(work, f, caseDir);
    return {
      prompt: p.id, arm, seconds: r.seconds, timedOut: r.timedOut, exit: r.code,
      specExists: score.specExists, finalValid: score.finalValid, outputOk: score.outputOk, checkOk: score.checkOk, mp4,
      capped: session.capped, chargeUsd: chargeOf(session, budget), usage: session.usage, errors: score.errors, film,
    };
  } finally {
    fs.rmSync(work, { recursive: true, force: true }); // rmSync does not follow the node_modules links
  }
}
