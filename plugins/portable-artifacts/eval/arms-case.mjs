// One case of the arms driver: a prompt run through one arm's copy of the skill, then scored with the repository's own skill.
import fs from 'node:fs';
import path from 'node:path';
import { MODEL_ENV_VARS, buildPrompt, expandCmd, prepareWorkdir, run, scoreRun } from './lib.mjs';
import { readSession } from './session.mjs';
import { blankCase, chargeOf, filmCounts, hostFaultOf } from './arms-lib.mjs';

// A film written before the session began cannot be this session's. File systems round mtimes, so allow a second.
const MTIME_SLACK_MS = 1000;

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

// A folder a driver left (a retry, or a run that was killed mid-case) is evidence, and its transcript the only record of what
// the session cost: move it aside as <arm>.old-<n>, never delete it.
function setAside(caseDir) {
  if (!fs.existsSync(caseDir)) return;
  let n = 1;
  while (fs.existsSync(`${caseDir}.old-${n}`)) n += 1;
  fs.renameSync(caseDir, `${caseDir}.old-${n}`);
}

const isFilm = (file, startedAt) => {
  try {
    const s = fs.statSync(file);
    return s.isFile() && s.size > 0 && s.mtimeMs >= startedAt - MTIME_SLACK_MS;
  } catch {
    return false;
  }
};

/**
 * The MP4 of a session, as `{ mp4, otherMp4 }`: `mp4` when a file the skill config names exists, is not empty and was written
 * after the session began; `otherMp4` lists the other non-empty MP4 files under the same folder (a film paid for under another
 * name is not delivered, but it is reported).
 */
function mp4Facts(work, skillCfg, startedAt) {
  const expected = (skillCfg.keepFiles ?? []).filter((f) => f.endsWith('.mp4'));
  const mp4 = expected.some((f) => isFilm(path.join(work, f), startedAt));
  const otherMp4 = [];
  for (const dir of new Set(expected.map((f) => path.dirname(f)))) {
    const root = path.join(work, dir);
    if (!fs.existsSync(root)) continue;
    for (const rel of fs.readdirSync(root, { recursive: true }).map(String).sort()) {
      const isOther = rel.endsWith('.mp4') && !expected.includes(path.join(dir, rel));
      if (isOther && isFilm(path.join(root, rel), 0)) otherMp4.push(rel);
    }
  }
  return { mp4, otherMp4 };
}

// What the session left, read before scoring (scoring rewrites the artifacts), then the repository's own score.
async function scoreCase({ work, p, skillCfg, skillsRoot, caseDir, seedSpec, startedAt }) {
  const film = filmCounts(readJson(path.join(work, skillCfg.spec)));
  const { mp4, otherMp4 } = mp4Facts(work, skillCfg, startedAt);
  for (const f of skillCfg.keepFiles ?? []) if (mp4 || !f.endsWith('.mp4')) keep(work, f, caseDir);
  for (const a of skillCfg.artifacts) fs.rmSync(path.join(work, a), { recursive: true, force: true });
  const score = await scoreRun({ work, skillCfg, skillDir: path.join(skillsRoot, skillCfg.dir), seedSpec, expect: p.expect, maxChanged: p.maxChanged });
  for (const f of [skillCfg.spec, 'output.log', ...skillCfg.artifacts]) keep(work, f, caseDir);
  return {
    specExists: score.specExists, finalValid: score.finalValid, outputOk: score.outputOk, checkOk: score.checkOk, mp4, otherMp4,
    featureOk: score.featureOk, missingFeatures: score.missingFeatures, errors: score.errors, film,
  };
}

/**
 * Run one case and return its ledger record. The workdir holds the arm's copy of the skill (`skillSrc`); the session runs there.
 * `journal` writes the case down before the host starts (charged the whole budget) and again the moment it exits (charged what
 * its stream says), before scoring, so a crash in scoring loses no spend; a scoring that throws is a recorded `scoringError`.
 * `signal` aborts the host: the case is then recorded `interrupted` and not scored. Scoring uses the repository's skill folder
 * (`skillsRoot/<dir>`), never the arm copy, so every arm is judged by one engine. The workdir is removed at the end; one that cannot
 * be removed is named in `workdirLeft` and costs the case nothing.
 */
export async function runCase(opts) {
  const { prompt: p, skillCfg, skillsRoot, evalDir, host, skillSrc } = opts;
  const { work, seedSpec } = prepareWorkdir(p, { skillCfg, skillsRoot, evalDir, host, skillSrc });
  let record;
  let leftover = null;
  try {
    record = await sessionAndScore({ ...opts, work, seedSpec });
  } finally {
    leftover = removeWorkdir(work);
  }
  return leftover ? { ...record, workdirLeft: leftover } : record;
}

// The workdir is scratch: failing to remove it (a leftover process still writing, a read-only folder) must not lose the paid case.
// -> null, or the path that was left behind. rmSync does not follow the node_modules links.
function removeWorkdir(work) {
  try {
    fs.rmSync(work, { recursive: true, force: true });
    return null;
  } catch {
    return work;
  }
}

async function sessionAndScore({ prompt: p, arm, skillCfg, host, model, budget, timeoutSec, caseDir, skillsRoot, journal, signal, work, seedSpec }) {
  setAside(caseDir);
  fs.mkdirSync(caseDir, { recursive: true });
  const transcript = path.join(caseDir, 'transcript.txt');
  const argv = expandCmd(host, { prompt: buildPrompt(skillCfg, p.prompt, host), cwd: work, model, budget: String(budget) });
  journal.started();
  const startedAt = Date.now();
  const r = await run(argv, {
    cwd: work, env: { PA_OUTPUT_DIR: path.join(work, 'out') }, dropEnv: MODEL_ENV_VARS, timeoutMs: timeoutSec * 1000, logFile: transcript, incremental: true, signal,
  });
  const session = readSession(transcript, { specName: skillCfg.spec });
  const hostFault = hostFaultOf({ session, exit: r.code, timedOut: r.timedOut, interrupted: r.interrupted });
  const base = {
    ...blankCase(p.id, arm), seconds: r.seconds, timedOut: r.timedOut, exit: r.code, capped: session.capped, chargeUsd: chargeOf(session, budget),
    usage: session.usage, hostFault, interrupted: r.interrupted,
  };
  journal.unscored({ chargeUsd: base.chargeUsd, hostFault, capped: base.capped, timedOut: r.timedOut, interrupted: r.interrupted, exit: r.code, seconds: r.seconds });
  if (r.interrupted) return base;
  try {
    return { ...base, ...(await scoreCase({ work, p, skillCfg, skillsRoot, caseDir, seedSpec, startedAt })) };
  } catch (e) {
    return { ...base, scoringError: String(e.message ?? e).slice(0, 300) };
  }
}
