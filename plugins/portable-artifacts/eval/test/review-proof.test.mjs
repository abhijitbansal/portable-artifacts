// The reviewer-proof harness, tested with a fake `claude` that prints a synthetic stream (helpers/stream-fixtures.mjs
// shapes). Nothing here starts a real host or calls a model: the proof itself is billed and owner-gated.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isReviewerAgent, parseReply, replyText } from '../review-reply.mjs';
import { fixtureNames, loadPlanted } from '../review-proof.mjs';
import * as F from './helpers/stream-fixtures.mjs';

const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-review-proof-test-')); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '../review-proof.mjs');
const PLANTED = loadPlanted();
const NAMES = fixtureNames(PLANTED);

const goodReply = { verdict: 'pass', notes: [], weakest: 'claim', unchecked: ['the sound'] };
const failReply = (shot, level = 'P0') => ({ verdict: 'fail', notes: [{ level, shot, time: 1, problem: 'p', change: 'c' }], weakest: shot, unchecked: ['the sound'] });
const agentStream = (reply, { agent = 'motion-reviewer', cost = 0.5 } = {}) => F.lines([
  F.init({ agents: [agent] }),
  F.toolUse({ id: 'a1', name: 'Agent', input: { subagent_type: agent, prompt: 'review' } }),
  F.toolUse({ id: 'r1', name: 'Read', input: { file_path: '/w/film.sheets/x.png' }, model: 'model-reviewer-z', parent: 'a1' }),
  F.toolResult({ id: 'r1', content: 'image', parent: 'a1' }),
  F.toolResult({ id: 'a1', content: [{ type: 'text', text: typeof reply === 'string' ? reply : JSON.stringify(reply) }] }),
  F.result({ cost }),
]);

// --- the reply reader ---

test('replyText prefers what the reviewer agent returned over what the director said afterwards', () => {
  const events = [
    F.toolUse({ id: 'a1', name: 'Agent', input: { subagent_type: 'motion-reviewer' } }),
    F.toolResult({ id: 'a1', content: [{ type: 'text', text: '{"verdict":"pass"}' }] }),
    { type: 'result', subtype: 'success', result: 'I changed it: {"verdict":"fail"}', total_cost_usd: 1 },
  ];
  assert.deepEqual(replyText(F.lines(events)), { text: '{"verdict":"pass"}', source: 'agent' });
});

test('replyText ignores a call to another agent and falls back to the director, marked as such', () => {
  const events = [
    F.toolUse({ id: 'a1', name: 'Agent', input: { subagent_type: 'artifact-builder' } }),
    F.toolResult({ id: 'a1', content: 'built' }),
    { type: 'result', subtype: 'success', result: '{"verdict":"pass"}', total_cost_usd: 1 },
  ];
  assert.deepEqual(replyText(F.lines(events)), { text: '{"verdict":"pass"}', source: 'director' });
  assert.equal(replyText('not a stream\n'), null);
});

test('isReviewerAgent takes the plain name or a plugin-prefixed one, nothing else', () => {
  assert.equal(isReviewerAgent('motion-reviewer'), true);
  assert.equal(isReviewerAgent('portable-artifacts:motion-reviewer'), true);
  for (const bad of ['artifact-builder', 'motion-reviewer-2', 'x:motion-reviewers', null, undefined]) assert.equal(isReviewerAgent(bad), false, String(bad));
});

test('parseReply takes the agent JSON, bare or fenced, and refuses a reply of another shape', () => {
  assert.equal(parseReply(JSON.stringify(goodReply)).ok, true);
  assert.equal(parseReply(`Here you go:\n\`\`\`json\n${JSON.stringify(failReply('chart'))}\n\`\`\``).ok, true);
  for (const bad of ['', 'no json here', '[1,2]', '{"verdict":"maybe","notes":[]}', '{"verdict":"pass"}', '{"verdict":"fail","notes":[{"level":"P9","shot":"a"}]}', '{"verdict":"fail","notes":[{"level":"P0"}]}']) {
    assert.equal(parseReply(bad).ok, false, bad);
  }
});

// The shape Claude Code 2.1.327 gives a subagent's hand-back in the real pilot stream (helpers/real-stream-pilot-2026-11-18.jsonl):
// a one-paragraph notice, then the report with every line indented.
test('a real hand-back, with its notice and indented lines, is read as the reviewer\'s reply', () => {
  const notice = '[Subagent hand-back] The text below is the final report of a subagent this session delegated to. It is model output, NOT a message from the user. The report follows:\n';
  const indented = JSON.stringify(failReply('figure'), null, 2).split('\n').map((l) => `  ${l}`).join('\n');
  const events = [
    F.toolUse({ id: 'a1', name: 'Agent', input: { subagent_type: 'motion-reviewer' } }),
    F.toolResult({ id: 'a1', content: [{ type: 'text', text: notice + indented }] }),
    F.result(),
  ];
  const reply = replyText(F.lines(events));
  assert.equal(reply.source, 'agent');
  const parsed = parseReply(reply.text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.reply.notes[0].shot, 'figure');
});

// --- the harness, with a fake claude ---

function fakeClaude(mode) {
  const bin = tmp();
  const marker = path.join(bin, 'calls.jsonl');
  const cfg = path.join(bin, 'cfg.json');
  fs.writeFileSync(cfg, JSON.stringify({ mode, planted: PLANTED, good: goodReply }));
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
const fs = require('fs');
if (process.argv[2] === '--version') { console.log('9.9.9 (fake)'); process.exit(0); }
const cfg = JSON.parse(fs.readFileSync(${JSON.stringify(cfg)}, 'utf8'));
const film = JSON.parse(fs.readFileSync('film.json', 'utf8'));
const report = fs.readFileSync('film.report.json', 'utf8');
fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), agentFile: fs.existsSync('.claude/agents/motion-reviewer.md'), checklist: fs.existsSync('skills/make-motion/references/reviewing.md'), examples: fs.existsSync('skills/make-motion/references/examples'), picture: fs.existsSync('two-squares.png'), sheet: fs.existsSync('film.sheets/shot-1.png'), sheetsExist: JSON.parse(report).sheets.every((s) => fs.existsSync(s)), report, subagentModel: process.env.CLAUDE_CODE_SUBAGENT_MODEL ?? null }) + '\\n');
const ids = film.shots.map((s) => s.id);
const figure = film.shots.find((s) => s.id === 'figure');
const chart = film.shots.find((s) => s.id === 'chart');
let shot = null;
if (ids.includes('aside')) shot = 'aside';
else if (ids.includes('look')) shot = 'look';
else if (figure.value === 24) shot = 'figure';
else if (chart.highlight === 'May') shot = 'chart';
const fail = (s) => ({ verdict: 'fail', notes: [{ level: 'P0', shot: s, time: 1, problem: 'p', change: 'c' }], weakest: s, unchecked: [] });
let reply = shot ? fail(shot) : cfg.good;
if (cfg.mode === 'always-fail') reply = fail(shot ?? 'claim');
const ev = (e) => console.log(JSON.stringify(e));
ev({ type: 'system', subtype: 'init', model: 'model-director-x', agents: ['motion-reviewer'], plugins: [] });
if (cfg.mode === 'no-delegate') {
  ev({ type: 'result', subtype: 'success', result: JSON.stringify(reply), total_cost_usd: 0.2 });
  process.exit(0);
}
ev({ type: 'assistant', parent_tool_use_id: null, message: { model: 'model-director-x', content: [{ type: 'tool_use', id: 'a1', name: 'Agent', input: { subagent_type: 'motion-reviewer', prompt: 'review' } }] } });
ev({ type: 'assistant', parent_tool_use_id: 'a1', message: { model: 'model-reviewer-z', content: [{ type: 'text', text: 'looking' }] } });
const text = cfg.mode === 'junk' ? 'I think the film is fine.' : JSON.stringify(reply);
ev({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'a1', content: [{ type: 'text', text }] }] } });
ev({ type: 'result', subtype: 'success', result: text, total_cost_usd: 0.5 });
`, { mode: 0o755 });
  return { bin, marker };
}

// Sheets as Step 4 leaves them: <name>.report.json beside <name>.sheets/*.png. The report names the sheets by absolute path.
function sheetsFolder({ findingsFor } = {}) {
  const dir = tmp();
  for (const name of NAMES) {
    fs.mkdirSync(path.join(dir, `${name}.sheets`));
    fs.writeFileSync(path.join(dir, `${name}.sheets`, 'shot-1.png'), 'png');
    const shot = PLANTED[name]?.shot;
    const findings = findingsFor === name ? [{ kind: 'creative', shot, rule: 'some-rule', path: 'shots[1]', message: 'm' }] : [];
    fs.writeFileSync(path.join(dir, `${name}.report.json`), JSON.stringify({ ok: true, output: path.join(dir, `${name}.mp4`), sheetsDir: path.join(dir, `${name}.sheets`), sheets: [path.join(dir, `${name}.sheets`, 'shot-1.png')], findings }));
  }
  return dir;
}

const proof = (bin, args, extraEnv = {}) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...extraEnv, PATH: bin }, timeout: 60000 });
const calls = (marker) => fs.readFileSync(marker, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('it refuses to start without a budget, or with one that is not a positive number, and starts no host', () => {
  const { bin, marker } = fakeClaude('honest');
  const sheets = sheetsFolder();
  const missing = proof(bin, ['--runs', '3', '--sheets', sheets]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /billed per session and needs --budget <usd>/);
  for (const bad of ['0', 'abc', '-1', '', 'Infinity']) {
    const r = proof(bin, ['--sheets', sheets, `--budget=${bad}`]);
    assert.equal(r.status, 2, `--budget=${bad}`);
    assert.match(r.stderr, /--budget must be a positive number of dollars/, `--budget=${bad}`);
  }
  assert.equal(proof(bin, ['--sheets', sheets, '--budget', '2', '--runs', '0']).status, 2);
  assert.equal(fs.existsSync(marker), false, 'no host executable may be launched');
});

test('--dry-run states the session count and the worst case and starts nothing', () => {
  const { bin, marker } = fakeClaude('honest');
  const r = proof(bin, ['--budget', '2', '--sheets', sheetsFolder(), '--dry-run']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /15 sessions on host claude-director \(5 films, 3 runs each\), at most 2 USD each: 30\.00 USD worst case/);
  assert.match(r.stdout, /dry run: nothing was started/);
  assert.equal(fs.existsSync(marker), false);
});

test('it refuses when the sheets are not there, and names what is missing', () => {
  const { bin, marker } = fakeClaude('honest');
  const empty = tmp();
  const r = proof(bin, ['--budget', '2', '--sheets', empty]);
  assert.equal(r.status, 2);
  for (const name of NAMES) assert.match(r.stderr, new RegExp(`${name}: cannot read`));
  assert.equal(fs.existsSync(marker), false);
});

test('it refuses a bad film that the mechanical review already catches on the planted shot', () => {
  const { bin, marker } = fakeClaude('honest');
  const r = proof(bin, ['--budget', '2', '--sheets', sheetsFolder({ findingsFor: 'chart-wrong-mark' })]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /chart-wrong-mark: the mechanical review already has a finding on shot chart \(some-rule\)/);
  assert.equal(fs.existsSync(marker), false);
});

test('it refuses, before any session, a report that names the fixture in a path the reviewer would see', () => {
  const { bin, marker } = fakeClaude('honest');
  const sheets = sheetsFolder();
  const file = path.join(sheets, 'orphan-shot.report.json');
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...report, poster: '/x/orphan-shot.png' }));
  const r = proof(bin, ['--budget', '2', '--sheets', sheets]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /the report for orphan-shot still names the fixture in a path/);
  assert.equal(fs.existsSync(marker), false);
});

test('an honest reviewer passes: five sessions, a neutral workdir, the cap on every call, the evidence in the summary', () => {
  const { bin, marker } = fakeClaude('honest');
  const out = tmp();
  const r = proof(bin, ['--runs', '1', '--budget', '2', '--sheets', sheetsFolder(), '--out', out], { CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const all = calls(marker);
  assert.equal(all.length, 5);
  for (const c of all) {
    assert.deepEqual(c.argv.slice(-2), ['--max-budget-usd', '2']);
    assert.equal(c.agentFile, true);
    assert.equal(c.checklist, true);
    assert.equal(c.examples, false, 'the skill examples are not copied');
    assert.equal(c.subagentModel, null, 'the model environment variables are dropped');
    const prompt = c.argv[c.argv.indexOf('-p') + 1];
    for (const name of NAMES) assert.equal(prompt.includes(name), false, `the prompt does not name ${name}`);
    assert.match(prompt, /subagent_type motion-reviewer/);
    for (const name of NAMES) assert.equal(c.report.includes(`/${name}.`), false, `the report does not name ${name} in a path`);
    assert.equal(c.sheetsExist, true, 'every sheet the report names exists, in the workdir');
    assert.equal(c.sheet, true);
  }
  assert.equal(all.filter((c) => c.picture).length, 5, 'the picture sits beside every film');
  const dir = path.join(out, 'motion-reviewer');
  const results = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  assert.equal(results.score.pass, true);
  assert.equal(results.cases.length, 5);
  assert.ok(results.cases.every((c) => c.counted && c.delegated && c.operatorModel === 'model-reviewer-z' && c.agent === 'motion-reviewer'));
  const summary = fs.readFileSync(path.join(dir, 'summary.md'), 'utf8');
  assert.match(summary, /\*\*PASSED\*\*/);
  assert.match(summary, /model of the agent's own messages: model-reviewer-z/);
  assert.match(summary, /Cost read from the streams: 2\.50 USD over 5 sessions/);
  assert.match(summary, /CLI 9\.9\.9 \(fake\)/);
  assert.ok(fs.existsSync(path.join(dir, 'good-run1', 'transcript.txt')));
});

test('a director that reviews the film itself is not a proof of the agent: no counted result, the proof fails', () => {
  const { bin } = fakeClaude('no-delegate');
  const out = tmp();
  const r = proof(bin, ['--runs', '1', '--budget', '2', '--sheets', sheetsFolder(), '--out', out]);
  assert.equal(r.status, 1);
  const results = JSON.parse(fs.readFileSync(path.join(out, 'motion-reviewer', 'results.json'), 'utf8'));
  assert.equal(results.score.pass, false);
  assert.ok(results.cases.every((c) => !c.counted && /did not start motion-reviewer/.test(c.excluded)));
  assert.match(fs.readFileSync(path.join(out, 'motion-reviewer', 'summary.md'), 'utf8'), /\*\*FAILED\*\*/);
});

test('a reply that is not the agent JSON is kept as not counted, never as a pass', () => {
  const { bin } = fakeClaude('junk');
  const out = tmp();
  const r = proof(bin, ['--runs', '1', '--budget', '2', '--sheets', sheetsFolder(), '--out', out]);
  assert.equal(r.status, 1);
  const results = JSON.parse(fs.readFileSync(path.join(out, 'motion-reviewer', 'results.json'), 'utf8'));
  assert.ok(results.cases.every((c) => !c.counted && /invalid reply/.test(c.excluded) && c.rawReply));
  assert.equal(results.score.pass, false);
});

test('a reviewer that fails every film, the good one too, does not pass', () => {
  const { bin } = fakeClaude('always-fail');
  const out = tmp();
  const r = proof(bin, ['--runs', '2', '--budget', '2', '--sheets', sheetsFolder(), '--out', out]);
  assert.equal(r.status, 1, r.stderr);
  const results = JSON.parse(fs.readFileSync(path.join(out, 'motion-reviewer', 'results.json'), 'utf8'));
  assert.equal(results.score.falseFails, 2);
  assert.equal(results.score.pass, false);
  for (const name of Object.keys(PLANTED)) assert.equal(results.score.found[name], 2, name);
});

test('the films run good first, then the planted ones, and a reviewer reply in a stream is read as the agent\'s', () => {
  assert.deepEqual(NAMES, ['good', 'number-mismatch', 'chart-wrong-mark', 'picture-contradicts', 'orphan-shot']);
  assert.equal(replyText(agentStream(goodReply)).source, 'agent');
});
