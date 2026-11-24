// A fake repository (a skills root with a make-motion folder), fake arm folders, a prompt set and a fake `claude` on PATH,
// so the arms driver runs end to end with no model and no billing. Nothing here starts a real host.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as F from './stream-fixtures.mjs';

export const FILM = {
  version: 2,
  shots: [
    { id: 'one', show: 'statement' },
    { id: 'two', show: 'chart', cut: 'slide', on: [{ at: 'x', do: 'pulse' }] },
  ],
};

const made = [];
export const tmp = (prefix = 'pa-arms-test-') => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };
export const cleanup = () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); };

// make.mjs as the real one is called by the harness: `<film> --outline --json` checks, `<film> --sheets-only --json --out <mp4>`
// writes <dir of mp4>/film.sheets/strip-01.png (and a board/ folder) holding `label`, and reports `ok`.
const makeScript = (label, ok) => `import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.includes('--outline')) {
  // a test can ask what the ledger held when scoring began: PA_PROBE_FROM is copied to PA_PROBE_TO
  if (process.env.PA_PROBE_FROM && process.env.PA_PROBE_TO && fs.existsSync(process.env.PA_PROBE_FROM)) fs.appendFileSync(process.env.PA_PROBE_TO, fs.readFileSync(process.env.PA_PROBE_FROM, 'utf8'));
  console.log(JSON.stringify({ ok: true, findings: [] })); process.exit(0);
}
const dir = path.join(path.dirname(args[args.indexOf('--out') + 1]), 'film.sheets');
fs.mkdirSync(path.join(dir, 'board'), { recursive: true });
fs.writeFileSync(path.join(dir, 'strip-01.png'), ${JSON.stringify(label)});
fs.writeFileSync(path.join(dir, 'board', 'board.png'), 'board');
console.log(JSON.stringify({ ok: ${ok}, findings: [], sheets: [] }));
`;

/** A skill folder: SKILL.md, scripts/make.mjs, an empty node_modules (so "npm ci" is not asked for). */
export function skillFolder(dir, { label, ok = true, skillMd = true, nodeModules = false } = {}) {
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  if (skillMd) fs.writeFileSync(path.join(dir, 'SKILL.md'), `# fake skill ${label}\n`);
  fs.writeFileSync(path.join(dir, 'scripts', 'make.mjs'), makeScript(label, ok));
  if (nodeModules) fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  return dir;
}

/** A skills root whose make-motion scores with `repo-sheet` and reports `ok`. */
export function fakeRepo({ ok = true } = {}) {
  const root = tmp('pa-arms-repo-');
  skillFolder(path.join(root, 'make-motion'), { label: 'repo-sheet', ok, nodeModules: true });
  return root;
}

/** Arm folders that say `arm-sheet` and always report ok, so only the repository's own engine can fail a case. */
export function fakeArms(names = ['A', 'D']) {
  const root = tmp('pa-arms-arms-');
  return Object.fromEntries(names.map((n) => [n, skillFolder(path.join(root, n), { label: 'arm-sheet', ok: true })]));
}

/** prompts/motion-budget.json in a fresh prompts dir. */
export function fakePrompts(ids = ['p1', 'p2']) {
  const dir = tmp('pa-arms-prompts-');
  fs.writeFileSync(path.join(dir, 'motion-budget.json'), JSON.stringify(ids.map((id) => ({ id, prompt: `Make film ${id}.` }))));
  return dir;
}

/**
 * A fake `claude` in a fresh folder. It logs each real call to calls.jsonl (argv, cwd, its pid, and the text of the `watch` file
 * as it was at that moment), writes film.json (and out/<mp4Name> of `mp4Bytes`, `mp4Age` ms old, unless `mp4: false`) in its
 * working directory, then prints a stream ending with a result event of `cost` and `subtype` (`stream` replaces the whole
 * stream) and exits with `exit`. With `sleep` it hangs and prints nothing; with `hang` it prints the init event, then hangs; with
 * `locked` it leaves a read-only folder with a file in it, which the workdir's removal cannot delete.
 * -> { bin, calls() }.
 */
export function fakeClaude({
  cost = 0.9, mp4 = true, sleep = false, staleSheet = false, hang = false, subtype = 'success', stream: raw, exit = 0, watch,
  mp4Name = 'film.mp4', mp4Bytes = 'mp4', mp4Age = 0, locked = false,
} = {}) {
  const bin = tmp('pa-arms-bin-');
  const marker = path.join(bin, 'calls.jsonl');
  const stream = path.join(bin, 'stream.txt');
  fs.writeFileSync(stream, raw ?? F.lines(hang ? [F.init()] : [F.init(), F.result({ cost, subtype })]));
  const mp4Path = `out/${mp4Name}`;
  const mp4Lines = `fs.mkdirSync('out', { recursive: true }); fs.writeFileSync(${JSON.stringify(mp4Path)}, ${JSON.stringify(mp4Bytes)});${mp4Age ? ` const t = new Date(Date.now() - ${mp4Age}); fs.utimesSync(${JSON.stringify(mp4Path)}, t, t);` : ''}`;
  const ending = sleep ? 'setTimeout(() => {}, 600000);'
    : `process.stdout.write(fs.readFileSync(${JSON.stringify(stream)}, 'utf8'));${hang ? ' setTimeout(() => {}, 600000);' : ` process.exitCode = ${exit};`}`;
  fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
const fs = require('fs');
if (process.argv[2] === '--version') { console.log('9.9.9 (fake)'); process.exit(0); }
const watch = ${JSON.stringify(watch ?? null)};
fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid, inflight: watch && fs.existsSync(watch) ? fs.readFileSync(watch, 'utf8') : null }) + '\\n');
fs.writeFileSync('film.json', ${JSON.stringify(JSON.stringify(FILM))});
${mp4 ? mp4Lines : ''}
${staleSheet ? "fs.mkdirSync('out/film.sheets', { recursive: true }); fs.writeFileSync('out/film.sheets/stale.png', 'stale');" : ''}
${locked ? "fs.mkdirSync('locked'); fs.writeFileSync('locked/f', 'x'); fs.chmodSync('locked', 0o500);" : ''}
${ending}
`, { mode: 0o755 });
  const calls = () => (fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { bin, calls };
}

/** Run `fn` with the fake claude first on PATH (node stays reachable for the harness's own `node` calls). */
export async function withClaude(bin, fn) {
  const saved = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${saved}`;
  try { return await fn(); } finally { process.env.PATH = saved; }
}

/** A writer that keeps what it was given. */
export const sink = () => { const s = { text: '', write(t) { s.text += t; return true; } }; return s; };
