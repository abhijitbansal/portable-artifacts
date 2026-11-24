// The arms driver end to end: a fake `claude` on PATH, a fake repository skill, two prompts, two arms. No model, no billing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, fakeArms, fakeClaude, fakePrompts, fakeRepo, skillFolder, tmp } from './helpers/arms-fixtures.mjs';
import { drive, tool } from './helpers/arms-drive.mjs';

after(cleanup);

test('(a) four cases run in the rotating order and cases.jsonl has four lines, each with its record', async () => {
  const r = await drive();
  assert.equal(r.code, 0, r.stderr);
  const { cases, spentUsd } = r.ledger();
  assert.deepEqual(cases.map((c) => c.prompt + c.arm), ['p1A', 'p1D', 'p2D', 'p2A']);
  assert.equal(r.calls.length, 4);
  assert.ok(Math.abs(spentUsd - 3.6) < 1e-9);
  const c = cases[0];
  assert.deepEqual(Object.keys(c).sort(), [
    'arm', 'capped', 'chargeUsd', 'checkOk', 'errors', 'exit', 'featureOk', 'film', 'finalValid', 'hostFault', 'interrupted', 'missingFeatures', 'mp4',
    'otherMp4', 'outputOk', 'prompt', 'scoringError', 'seconds', 'specExists', 'timedOut', 'usage',
  ].sort());
  assert.equal(c.mp4, true);
  assert.equal(c.specExists, true);
  assert.equal(c.finalValid, true);
  assert.equal(c.outputOk, true);
  assert.equal(c.checkOk, true);
  assert.equal(c.timedOut, false);
  assert.equal(c.capped, false);
  assert.equal(c.chargeUsd, 0.9);
  assert.deepEqual(c.film, { designedCuts: 1, devices: 1 });
  assert.equal(c.usage.costUsd, 0.9);
  assert.match(r.stdout, /▶ p1 A/);
});

test('(a) a case keeps its transcript, spec, repository-made sheets, output log and MP4 under cases/<prompt>/<arm>/', async () => {
  const r = await drive({ args: { '--limit': 1 } });
  const dir = path.join(r.out, 'cases', 'p1', 'A');
  for (const f of ['transcript.txt', 'film.json', 'output.log', 'film.mp4', 'film.sheets/strip-01.png']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'film.json'), 'utf8')).shots.length, 2);
  assert.equal(fs.readFileSync(path.join(dir, 'film.mp4'), 'utf8'), 'mp4');
});

test('(a) the host is called as claude-stream with the model and the cap, in the arm\'s workdir', async () => {
  const r = await drive({ args: { '--limit': 1 } });
  const call = r.calls[0];
  assert.deepEqual(call.argv.slice(-4), ['--model', 'sonnet', '--max-budget-usd', '1']);
  assert.ok(call.argv.includes('stream-json'));
  assert.ok(call.argv[1].startsWith('Read skills/make-motion/SKILL.md'), 'the prompt is the harness prompt');
  assert.match(call.argv[1], /looking at what you made as it says/);
});

test('(b) --max-total 2 with --budget 1 and $0.90 cases stops after two and exits 3 with "ceiling reached"', async () => {
  const r = await drive({ args: { '--max-total': 2 } });
  assert.equal(r.code, 3);
  assert.match(r.stderr, /ceiling reached/);
  assert.equal(r.calls.length, 2);
  assert.equal(r.ledger().cases.length, 2);
});

const earlier = (out) => {
  fs.mkdirSync(out, { recursive: true });
  const line = (prompt, arm) => JSON.stringify({ prompt, arm, chargeUsd: 0.9 });
  fs.writeFileSync(path.join(out, 'cases.jsonl'), `${line('p1', 'A')}\n${line('p1', 'D')}\n{"prompt":"p2","arm":"D","charg`);
};

test('(c) --resume after two finished cases runs only the other two and drops the half-written line', async () => {
  const r = await drive({ args: { '--resume': true }, pre: earlier });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.calls.length, 2);
  const { cases } = r.ledger();
  assert.deepEqual(cases.map((c) => c.prompt + c.arm), ['p1A', 'p1D', 'p2D', 'p2A']);
  assert.match(r.stdout, /skipping 2 finished/);
});

test('(c) a resumed run starts its spend at the finished cases: 1.8 spent leaves room for one more case under 3', async () => {
  const r = await drive({ args: { '--resume': true, '--max-total': 3 }, pre: earlier });
  assert.equal(r.code, 3);
  assert.equal(r.calls.length, 1);
  assert.match(r.stderr, /ceiling reached: 2\.70 USD spent/, '1.8 from the finished cases plus 0.9 for the one that ran; alone, 0.9 would not stop a 3 ceiling');
});

test('(c) without --resume an out folder that already has cases is refused before any case', async () => {
  const r = await drive({ pre: earlier });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /cases\.jsonl already has cases.*--resume/);
  assert.equal(r.calls.length, 0);
});

test('(c) --resume with a bad line in the middle of the ledger is an error that names the line, and runs nothing', async () => {
  const r = await drive({
    args: { '--resume': true },
    pre: (out) => { fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, 'cases.jsonl'), `{"prompt":"p1","arm":"A","chargeUsd":1}\nnot json\n{"prompt":"p1","arm":"D","chargeUsd":1}\n`); },
  });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /line 2/);
  assert.equal(r.calls.length, 0);
});

test('(d) --dry-run prints the case count, the order and the worst-case spend, and starts no host', async () => {
  const r = await drive({ args: { '--dry-run': true } });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.calls.length, 0);
  assert.match(r.stdout, /4 cases/);
  assert.match(r.stdout, /p1 A, p1 D, p2 D, p2 A/);
  assert.match(r.stdout, /4\.40 USD worst case/, '4 cases x (1.00 budget + 10% reserve)');
  assert.match(r.stdout, /dry run: nothing was started/);
  assert.equal(fs.existsSync(path.join(r.out, 'cases.jsonl')), false);
});

test('(e) an arm whose folder has no SKILL.md is refused before any case', async () => {
  const bad = skillFolder(path.join(tmp(), 'D'), { label: 'x', skillMd: false });
  const r = await drive({ arms: { ...fakeArms(['A']), D: bad } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /arm D.*SKILL\.md/);
  assert.equal(r.calls.length, 0);
});

test('(e) an arm that is not name=folder, a repeated name, a missing folder and no arm at all are refused', async () => {
  const { A } = fakeArms(['A']);
  const refused = [
    [{}, /at least one --arm/],
    [{ A, D: path.join(tmp(), 'nowhere') }, /arm D/],
  ];
  for (const [arms, pattern] of refused) {
    const r = await drive({ arms });
    assert.equal(r.code, 2);
    assert.match(r.stderr, pattern);
    assert.equal(r.calls.length, 0);
  }
  for (const [armArgs, pattern] of [[['--arm', 'noequals'], /name=<skill folder>/], [['--arm', `A=${A}`, '--arm', `A=${A}`], /repeated/]]) {
    const r = await drive({ arms: {}, armArgs });
    assert.equal(r.code, 2);
    assert.match(r.stderr, pattern);
    assert.equal(r.calls.length, 0);
  }
});

test('(f) a case that times out is charged the whole budget and recorded timedOut, with its reason', async () => {
  const r = await drive({ claude: fakeClaude({ sleep: true }), arms: fakeArms(['A']), args: { '--timeout': 1, '--limit': 1 } });
  assert.equal(r.code, 0, r.stderr);
  const [c] = r.ledger().cases;
  assert.equal(c.timedOut, true);
  assert.equal(c.chargeUsd, 1);
  assert.equal(c.usage.costUsd, null);
  assert.match(r.stdout, /timed out/);
});

test('(g) the repository\'s skill scores: an arm whose make.mjs always says ok is still failed by the repository\'s own', async () => {
  const r = await drive({ repo: fakeRepo({ ok: false }), args: { '--limit': 1 } });
  assert.equal(r.code, 0, r.stderr);
  for (const c of r.ledger().cases) {
    assert.equal(c.outputOk, true, 'the sheets were made');
    assert.equal(c.checkOk, false, `${c.arm}: the repository's check fails it`);
  }
  assert.equal(fs.readFileSync(path.join(r.out, 'cases', 'p1', 'A', 'film.sheets', 'strip-01.png'), 'utf8'), 'repo-sheet', 'the sheets are the repository engine\'s, not the arm copy\'s');
  assert.match(r.stdout, /check failed/);
});

test('a session that wrote no MP4 is recorded mp4 false, read before scoring', async () => {
  const r = await drive({ claude: fakeClaude({ mp4: false }), arms: fakeArms(['A']), args: { '--limit': 1 } });
  const [c] = r.ledger().cases;
  assert.equal(c.mp4, false);
  assert.equal(c.outputOk, true, 'the MP4 is never part of outputOk');
  assert.equal(fs.existsSync(path.join(r.out, 'cases', 'p1', 'A', 'film.mp4')), false);
  assert.match(r.stdout, /no MP4/);
});

test('the sheets of a case are the ones the scoring run made: a stale sheet from the session is cleared first', async () => {
  const r = await drive({ claude: fakeClaude({ staleSheet: true }), arms: fakeArms(['A']), args: { '--limit': 1 } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(r.out, 'cases', 'p1', 'A', 'film.sheets')), ['strip-01.png'], 'PNG files only: no board folder, no stale sheet');
});

test('a case folder left by a run that was killed mid-case is cleared before the case runs again', async () => {
  const out = tmp('pa-arms-out-');
  const stale = path.join(out, 'cases', 'p1', 'A');
  fs.mkdirSync(path.join(stale, 'film.sheets'), { recursive: true });
  fs.writeFileSync(path.join(stale, 'film.sheets', 'old.png'), 'old');
  fs.writeFileSync(path.join(stale, 'film.mp4'), 'old');
  const r = await drive({ out, claude: fakeClaude({ mp4: false }), arms: fakeArms(['A']), args: { '--limit': 1 } });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(fs.readdirSync(path.join(stale, 'film.sheets')), ['strip-01.png']);
  assert.equal(fs.existsSync(path.join(stale, 'film.mp4')), false, 'the old MP4 is not this case\'s');
});

test('the run writes plan.json, the prompts and arms it set out to run, which --verdict reads to see a prompt that never started', async () => {
  const r = await drive({ args: { '--max-total': 2 } });
  assert.equal(r.code, 3);
  const plan = JSON.parse(fs.readFileSync(path.join(r.out, 'plan.json'), 'utf8'));
  assert.deepEqual({ skill: plan.skill, set: plan.set, arms: plan.arms, prompts: plan.prompts }, { skill: 'motion', set: 'budget', arms: ['A', 'D'], prompts: ['p1', 'p2'] });
});

// --- --packets and --verdict: no host, no budget ---

async function finished() {
  const r = await drive({ args: { '--limit': 2 } });
  assert.equal(r.code, 0, r.stderr);
  return r.out;
}

test('--packets writes blind/<prompt>/<name>/*.png, a brief and key.json from the finished cases; no host, no budget', async () => {
  const out = await finished();
  const r = await tool(['--packets', '--out', out, '--skill', 'motion', '--set', 'budget']);
  assert.equal(r.code, 0, r.stderr);
  const key = JSON.parse(fs.readFileSync(path.join(out, 'private', 'key.json'), 'utf8'));
  assert.equal(fs.existsSync(path.join(out, 'key.json')), false, 'the key is not left beside blind/ and cases/');
  assert.match(r.stdout, /Give each rater only the paths .*blind.*<prompt>.*never .* itself/);
  assert.deepEqual(Object.keys(key).sort(), ['p1', 'p2']);
  assert.deepEqual(Object.values(key.p1).sort(), ['A', 'D']);
  assert.equal(fs.readFileSync(path.join(out, 'blind', 'p1', 'brief.txt'), 'utf8'), 'Make film p1.');
  const [name] = Object.keys(key.p1);
  assert.deepEqual(fs.readdirSync(path.join(out, 'blind', 'p1', name)), ['strip-01.png'], 'the board folder is not copied');
  assert.match(r.stdout, /2 prompts/);
});

test('--verdict reads the ratings folder, prints the verdict and writes verdict.md (two prompts are far too few: inconclusive)', async () => {
  const out = await finished();
  assert.equal((await tool(['--packets', '--out', out, '--skill', 'motion', '--set', 'budget'])).code, 0);
  const key = JSON.parse(fs.readFileSync(path.join(out, 'private', 'key.json'), 'utf8'));
  const ratings = tmp('pa-ratings-');
  for (const p of Object.keys(key)) {
    const reply = `{"ranks":${JSON.stringify(Object.fromEntries(Object.keys(key[p]).map((n) => [n, 1])))}}`;
    for (const reader of ['r1', 'r2', 'r3']) fs.writeFileSync(path.join(ratings, `${p}.${reader}.json`), `My ranking: ${reply}`);
  }
  const r = await tool(['--verdict', '--out', out, '--ratings', ratings]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /# Verdict: inconclusive/);
  const md = fs.readFileSync(path.join(out, 'verdict.md'), 'utf8');
  assert.match(md, /# Verdict: inconclusive/);
  assert.match(md, /no case for C/);
  for (const id of ['p1', 'p2']) assert.ok(md.includes(`| ${id} |`));
});

test('--verdict counts a planned prompt with no case as missing, read from plan.json', async () => {
  const out = await finished();
  fs.writeFileSync(path.join(out, 'plan.json'), JSON.stringify({ skill: 'motion', set: 'budget', arms: ['A', 'D'], prompts: ['p1', 'p2', 'p3'] }));
  assert.equal((await tool(['--packets', '--out', out, '--skill', 'motion', '--set', 'budget'])).code, 0);
  const ratings = tmp('pa-ratings-');
  const r = await tool(['--verdict', '--out', out, '--ratings', ratings]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /p3 has no case for A/);
  assert.ok(r.stdout.includes('| p3 |'));
});

test('--packets and --verdict usage errors exit 2 and touch nothing', async () => {
  const out = await finished();
  const refused = [
    [['--packets'], /--out/],
    [['--verdict', '--out', out], /--ratings/],
    [['--packets', '--verdict', '--out', out, '--skill', 'motion'], /only one of/],
    [['--verdict', '--out', out, '--ratings', path.join(out, 'nowhere')], /--ratings/],
    [['--verdict', '--out', out, '--ratings', out], /key\.json/],
    [['--packets', '--out', out], /--skill/],
    [['--packets', '--out', path.join(out, 'nowhere'), '--skill', 'motion'], /cases\.jsonl/],
  ];
  for (const [argv, pattern] of refused) {
    const r = await tool(argv);
    assert.equal(r.code, 2, argv.join(' '));
    assert.match(r.stderr, pattern, argv.join(' '));
  }
  assert.equal(fs.existsSync(path.join(out, 'private')), false);
  assert.equal(fs.existsSync(path.join(out, 'blind')), false);
});

test('usage errors exit 2 before any host: no --out, no --budget, a host with no stream, an unknown skill or set', async () => {
  const cases = [
    [{ '--out': undefined }, /--out/],
    [{ '--budget': undefined }, /--budget/],
    [{ '--budget': 0 }, /--budget must be a positive number/],
    [{ '--max-total': undefined }, /--max-total/],
    [{ '--max-total': 0.5 }, /below --budget/],
    [{ '--host': 'codex', '--model': undefined, '--budget': undefined }, /stream/],
    [{ '--skill': 'nope' }, /unknown --skill/],
    [{ '--set': 'nope' }, /unknown --set/],
    [{ '--timeout': 0 }, /--timeout/],
    [{ '--limit': 0 }, /--limit/],
  ];
  for (const [args, pattern] of cases) {
    const r = await drive({ args });
    assert.equal(r.code, 2, JSON.stringify(args));
    assert.match(r.stderr, pattern, JSON.stringify(args));
    assert.equal(r.calls.length, 0);
  }
});
