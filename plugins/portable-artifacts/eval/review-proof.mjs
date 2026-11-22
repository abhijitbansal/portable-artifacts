#!/usr/bin/env node
// The proof for the second reviewer (agents/motion-reviewer.md): run it PROOF_RUNS times on each of five films (one good,
// four with a planted defect, eval/fixtures/review/), through the `claude-director` host of this harness, and score the
// replies with review-score.mjs. BILLED: one host session per film per run (15 by default), each capped by --budget.
// It renders nothing: the sheets are made beforehand with `make.mjs <film> --sheets-only --json --out <dir>/<name>.mp4`,
// and each printed report is saved as <dir>/<name>.report.json. See eval/README.md, "Reviewer proof".
//
//   node review-proof.mjs --runs 3 --budget <usd> --sheets <dir> [--timeout sec] [--out dir] [--dry-run]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { MODEL_ENV_VARS, expandCmd, run } from './lib.mjs';
import { readSession } from './session.mjs';
import { isReviewerAgent, parseReply, replyText } from './review-reply.mjs';
import { GOOD_FIXTURE, MAX_FALSE_FAILS, PROOF_RUNS, scoreProof } from './review-score.mjs';
import { REVIEWER_NAME, reviewerFile } from '../shared/agents.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(here, 'fixtures/review');
const SKILL_DIR = path.resolve(here, '../skills/make-motion');
const HOST = 'claude-director';
const DEFAULT_TIMEOUT_SEC = 600;
// Names the reviewer must not see: the file names would say which film is good and which defect is planted.
const NEUTRAL_FILM = 'film.json';
const NEUTRAL_REPORT = 'film.report.json';
const NEUTRAL_SHEETS = 'film.sheets';

export const loadPlanted = (dir = FIXTURE_DIR) => JSON.parse(fs.readFileSync(path.join(dir, 'planted.json'), 'utf8'));
export const fixtureNames = (planted = loadPlanted()) => [GOOD_FIXTURE, ...Object.keys(planted)];

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * Check the sheets made beforehand, before anything is billed. -> { problems, films: { name: { report, sheetsDir } } }.
 * A bad film the mechanical review already catches proves nothing about the reviewer, so it is a problem too.
 */
export function checkSheets({ sheetsDir, planted = loadPlanted() }) {
  const problems = [];
  const films = {};
  for (const name of fixtureNames(planted)) {
    const reportFile = path.join(sheetsDir, `${name}.report.json`);
    const dir = path.join(sheetsDir, `${name}.sheets`);
    let report;
    try {
      report = readJson(reportFile);
    } catch (e) {
      problems.push(`${name}: cannot read ${reportFile} (${e.code ?? e.message}); save the make.mjs --json report there`);
      continue;
    }
    if (report.ok !== true) problems.push(`${name}: the report says ok ${report.ok}; a film that fails its own mechanical review is not a fixture`);
    const sheets = Array.isArray(report.sheets) ? report.sheets : [];
    if (sheets.length === 0) problems.push(`${name}: the report names no sheets`);
    for (const sheet of sheets) {
      if (!fs.existsSync(path.join(dir, path.basename(String(sheet))))) problems.push(`${name}: sheet ${path.basename(String(sheet))} is not in ${dir}`);
    }
    const shot = planted[name]?.shot;
    const caught = shot ? (Array.isArray(report.findings) ? report.findings : []).filter((f) => f?.shot === shot) : [];
    if (caught.length > 0) problems.push(`${name}: the mechanical review already has a finding on shot ${shot} (${caught[0].rule ?? caught[0].kind}); replace this film with one it does not catch`);
    films[name] = { report, sheetsDir: dir };
  }
  return { problems, films };
}

/**
 * A workdir for one session: the skill's references (the checklist), the reviewer agent file, the film under a neutral
 * name with its picture, the sheets, and the report with its paths pointing into this workdir. -> the workdir.
 */
export function prepareWork({ name, film, tmpDir, skillDir = SKILL_DIR, fixtureDir = FIXTURE_DIR }) {
  const work = fs.mkdtempSync(path.join(tmpDir, 'pa-review-proof-'));
  const refs = path.join(work, 'skills/make-motion/references');
  fs.cpSync(path.join(skillDir, 'references'), refs, { recursive: true, filter: (from) => path.basename(from) !== 'examples' });
  const { fileName, content } = reviewerFile('claude');
  fs.mkdirSync(path.join(work, '.claude/agents'), { recursive: true });
  fs.writeFileSync(path.join(work, '.claude/agents', fileName), content);
  fs.copyFileSync(path.join(fixtureDir, `${name}.json`), path.join(work, NEUTRAL_FILM));
  const picture = path.join(fixtureDir, 'two-squares.png');
  if (fs.existsSync(picture)) fs.copyFileSync(picture, path.join(work, 'two-squares.png'));
  const sheetsOut = path.join(work, NEUTRAL_SHEETS);
  fs.cpSync(film.sheetsDir, sheetsOut, { recursive: true });
  const report = {
    ...film.report,
    sheets: film.report.sheets.map((s) => path.join(sheetsOut, path.basename(String(s)))),
    sheetsDir: sheetsOut,
    output: film.report.output ? path.join(work, 'film.mp4') : film.report.output,
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (text.includes(`/${name}.`) || text.includes(`/${name}/`)) throw new Error(`the report for ${name} still names the fixture in a path; the reviewer would see it`);
  fs.writeFileSync(path.join(work, NEUTRAL_REPORT), text);
  return work;
}

// Never names the fixture. The director only starts the reviewer and hands its reply back.
export function reviewPrompt(work) {
  return [
    `Review the finished film with the ${REVIEWER_NAME} agent: start it with the Agent tool (subagent_type ${REVIEWER_NAME}).`,
    'Give it this brief:',
    `skill directory ${path.join(work, 'skills/make-motion')}; film ${path.join(work, NEUTRAL_FILM)}; report ${path.join(work, NEUTRAL_REPORT)} (its "sheets" array names every sheet PNG, and the sheets are in this folder).`,
    'When it replies, answer with its JSON reply exactly as it gave it, and nothing else.',
    'Do not review the film yourself and do not open the sheets: the proof is of the agent.',
  ].join(' ');
}

const mdCell = (s) => String(s ?? '-').replace(/\s+/g, ' ').replaceAll('|', '\\|');

export function summarizeProof({ score, cases, commandLine, pluginVersion, hostVersion, budget, runs, date }) {
  const models = [...new Set(cases.map((c) => c.operatorModel).filter(Boolean))];
  const directors = [...new Set(cases.map((c) => c.directorModel).filter(Boolean))];
  const cost = cases.reduce((sum, c) => sum + (typeof c.costUsd === 'number' ? c.costUsd : 0), 0);
  const lines = [
    `# Reviewer proof: ${REVIEWER_NAME}, ${date}`,
    '',
    `- Command: \`${commandLine}\``,
    `- Plugin version ${pluginVersion}; host \`${HOST}\`, CLI ${hostVersion}; ${runs} runs of 5 films, each session capped at ${budget} USD.`,
    `- Bar: every planted defect found in all ${runs} runs (a fail verdict with a P0 or P1 note on the planted shot), and at most ${MAX_FALSE_FAILS} false fail on the good film.`,
    `- **${score.pass ? 'PASSED' : 'FAILED'}**. Defects found per film: ${Object.entries(score.found).map(([f, n]) => `${f} ${n}/${runs}`).join(', ')}. False fails on the good film: ${score.falseFails}.`,
    `- Agent that ran, read from the stream: ${mdCell([...new Set(cases.map((c) => c.agent).filter(Boolean))].join(', ') || 'none')}; model of the agent's own messages: ${mdCell(models.join(', ') || 'none seen')}; director model: ${mdCell(directors.join(', ') || 'none seen')}.`,
    `- Cost read from the streams: ${cost.toFixed(2)} USD over ${cases.length} sessions.`,
    '',
    ...(score.problems.length ? ['Problems:', '', ...score.problems.map((p) => `- ${p}`), ''] : []),
    '| film | run | delegated | verdict | notes (level, shot) | cost USD | counted |',
    '|---|---|---|---|---|---|---|',
    ...cases.map((c) => `| ${c.fixture} | ${c.run} | ${c.delegated ? 'yes' : 'no'} | ${mdCell(c.verdict ?? c.excluded ?? '-')} | ${mdCell((c.notes ?? []).map((n) => `${n.level} ${n.shot}`).join(', ') || '-')} | ${typeof c.costUsd === 'number' ? c.costUsd.toFixed(2) : '-'} | ${c.counted ? 'yes' : 'no'} |`),
    '',
  ];
  return lines.join('\n');
}

// One billed session. Returns the case record; `counted` says whether the reply is the reviewer agent's own and valid.
async function runCase({ name, run: n, film, host, budget, timeoutSec, caseDir, tmpDir }) {
  const work = prepareWork({ name, film, tmpDir });
  fs.mkdirSync(caseDir, { recursive: true });
  const transcript = path.join(caseDir, 'transcript.txt');
  const argv = expandCmd(host, { prompt: reviewPrompt(work), cwd: work, budget });
  const r = await run(argv, { cwd: work, env: {}, dropEnv: MODEL_ENV_VARS, timeoutMs: timeoutSec * 1000, logFile: transcript });
  fs.rmSync(work, { recursive: true, force: true });
  const session = readSession(transcript, { specName: NEUTRAL_FILM });
  const record = {
    fixture: name, run: n, seconds: r.seconds, timedOut: r.timedOut,
    delegated: session.readable && session.delegations.some((d) => isReviewerAgent(d.agent)),
    agent: session.agent, operatorModel: session.operatorModel, directorModel: session.directorModel,
    requestedModel: session.requestedModel, costUsd: session.costUsd, capped: session.capped, counted: false,
  };
  if (!session.readable) return { ...record, excluded: `stream unreadable: ${session.reason}` };
  if (!record.delegated) return { ...record, excluded: `the director did not start ${REVIEWER_NAME}` };
  const reply = replyText(fs.readFileSync(transcript, 'utf8'));
  if (reply?.source !== 'agent') return { ...record, excluded: `${REVIEWER_NAME} gave no reply${record.capped ? ' (hit the budget cap)' : ''}` };
  const parsed = parseReply(reply.text);
  if (!parsed.ok) return { ...record, excluded: `invalid reply: ${parsed.error}`, rawReply: reply.text.slice(0, 2000) };
  return { ...record, counted: true, verdict: parsed.reply.verdict, notes: parsed.reply.notes, weakest: parsed.reply.weakest, unchecked: parsed.reply.unchecked };
}

/** Run every film `runs` times, run-major so an early stop leaves balanced data. -> { score, cases }. */
export async function runProof({ films, planted, runs, host, budget, timeoutSec, outDir, tmpDir, log = () => {} }) {
  const cases = [];
  for (let n = 1; n <= runs; n += 1) {
    for (const name of fixtureNames(planted)) {
      log(`▶ ${name} run ${n}/${runs}`);
      const c = await runCase({ name, run: n, film: films[name], host, budget, timeoutSec, caseDir: path.join(outDir, `${name}-run${n}`), tmpDir });
      cases.push(c);
      log(`  ${c.counted ? c.verdict : `not counted: ${c.excluded}`}  ${typeof c.costUsd === 'number' ? `${c.costUsd.toFixed(2)} USD` : ''}`);
    }
  }
  const results = cases.filter((c) => c.counted).map(({ fixture, run: n, verdict, notes }) => ({ fixture, run: n, verdict, notes }));
  return { score: scoreProof(results, planted, { runs }), cases };
}

const USAGE = 'usage: node eval/review-proof.mjs --runs 3 --budget <usd> [--sheets <dir>] [--timeout sec] [--out dir] [--dry-run] [--help]\n';

function usage(msg) {
  process.stderr.write(`${msg}\n${USAGE}`);
  return 2;
}

export async function main(argv) {
  let opts;
  try {
    ({ values: opts } = parseArgs({
      args: argv,
      options: {
        runs: { type: 'string', default: String(PROOF_RUNS) }, budget: { type: 'string' }, sheets: { type: 'string' },
        timeout: { type: 'string', default: String(DEFAULT_TIMEOUT_SEC) }, out: { type: 'string' },
        'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (e) {
    return usage(e.message);
  }
  if (opts.help) { process.stdout.write(USAGE); return 0; }
  // The first refusal: no cap, no billed session. Checked before anything is read, so nothing can start by accident.
  if (opts.budget === undefined) return usage('this proof is billed per session and needs --budget <usd>, the cap for one session');
  if (!(Number.isFinite(Number(opts.budget)) && Number(opts.budget) > 0)) return usage(`--budget must be a positive number of dollars, got "${opts.budget}"`);
  const runs = Number(opts.runs);
  if (!Number.isInteger(runs) || runs < 1) return usage(`--runs must be a positive whole number, got "${opts.runs}"`);
  const timeoutSec = Number(opts.timeout);
  if (!(timeoutSec > 0)) return usage(`--timeout must be a positive number of seconds, got "${opts.timeout}"`);

  const planted = loadPlanted();
  const sheetsDir = path.resolve(opts.sheets ?? '.scratch/review-proof');
  const { problems, films } = checkSheets({ sheetsDir, planted });
  if (problems.length) return usage(`the sheets are not ready (${sheetsDir}):\n- ${problems.join('\n- ')}`);
  // Build every workdir once before anything is billed, so a report that would leak a fixture name fails here, not mid-proof.
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-review-proof-probe-'));
  try {
    for (const name of fixtureNames(planted)) prepareWork({ name, film: films[name], tmpDir: probe });
  } catch (e) {
    return usage(`the workdir for a film cannot be built: ${e.message}`);
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
  const sessions = fixtureNames(planted).length * runs;
  process.stdout.write(`${sessions} sessions on host ${HOST} (${fixtureNames(planted).length} films, ${runs} runs each), at most ${opts.budget} USD each: ${(sessions * Number(opts.budget)).toFixed(2)} USD worst case.\n`);
  if (opts['dry-run']) { process.stdout.write('dry run: nothing was started\n'); return 0; }

  const host = readJson(path.join(here, 'hosts.json'))[HOST];
  const check = await run(host.check);
  if (check.code !== 0) { process.stderr.write(`host "${HOST}" not available (${host.check.join(' ')} failed)\n`); return 2; }

  const date = new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.resolve(opts.out ?? path.join(here, 'results', stamp), 'motion-reviewer');
  fs.mkdirSync(outDir, { recursive: true });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-review-proof-run-'));
  const { score, cases } = await runProof({ films, planted, runs, host, budget: opts.budget, timeoutSec, outDir, tmpDir, log: (l) => process.stdout.write(`${l}\n`) });
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const pluginVersion = readJson(path.resolve(here, '../.claude-plugin/plugin.json')).version;
  const summary = summarizeProof({
    score, cases, runs, budget: opts.budget, date, pluginVersion, hostVersion: check.out.trim().split('\n')[0],
    commandLine: `node eval/review-proof.mjs ${argv.join(' ')}`,
  });
  fs.writeFileSync(path.join(outDir, 'results.json'), `${JSON.stringify({ host: HOST, agent: REVIEWER_NAME, runs, budget: opts.budget, score, cases }, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'summary.md'), summary);
  process.stdout.write(`\n${summary}\nresults: ${outDir}\n`);
  return score.pass ? 0 : 1;
}

function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) process.exitCode = await main(process.argv.slice(2));
