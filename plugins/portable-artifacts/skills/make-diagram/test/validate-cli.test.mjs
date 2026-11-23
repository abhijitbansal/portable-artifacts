import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VALIDATE = fileURLToPath(new URL('../scripts/validate.mjs', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}.diagram.json`, import.meta.url));
const run = (args, env = {}) => spawnSync(process.execPath, [VALIDATE, ...args], {
  encoding: 'utf8',
  env: { ...process.env, EVAL_LOG: '', ...env },
});

const tmpSpec = (obj) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-validate-'));
  const file = path.join(dir, 'bad.diagram.json');
  fs.writeFileSync(file, JSON.stringify(obj));
  return { dir, file };
};

test('valid spec exits 0 and says so', () => {
  const r = run([fixture('architecture')]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /architecture\.diagram\.json: valid\n$/);
});

test('invalid spec exits 1 with path: message lines', () => {
  const { dir, file } = tmpSpec({ title: 'T', type: 'flow', nodes: [{ id: 'a', label: 'A', kind: 'servce' }] });
  try {
    const r = run([file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^nodes\[0\]\.kind: kind "servce" is not valid for flow diagrams; allowed: step,/m);
    assert.match(r.stdout, /bad\.diagram\.json: 1 error\n$/);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('--json prints one machine-readable result line', () => {
  const { dir, file } = tmpSpec({ title: 'T', type: 'flow', nodes: [{ id: 'a', label: 'A' }], titel: 1 });
  try {
    const r = run([file, '--json']);
    assert.equal(r.status, 1);
    assert.deepEqual(JSON.parse(r.stdout), {
      ok: false,
      errors: [{ path: 'titel', message: 'unknown property; did you mean "title"?' }],
    });
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('missing file, bad JSON and bad usage exit 2', () => {
  const missing = run(['/nonexistent/x.diagram.json']);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /cannot read/);
  const none = run([]);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /expected one spec file; usage: node scripts\/validate\.mjs/);
  const flag = run([fixture('flow'), '--bogus']);
  assert.equal(flag.status, 2);
  const json = run(['/nonexistent/x.diagram.json', '--json']);
  assert.equal(json.status, 2);
  assert.equal(JSON.parse(json.stdout).ok, false);
  const { dir, file } = tmpSpec({});
  try {
    fs.writeFileSync(file, '{ nope');
    assert.match(run([file]).stderr, /is not valid JSON/);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('EVAL_LOG gets one line per run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-evallog-'));
  const log = path.join(dir, 'log.jsonl');
  try {
    run([fixture('flow')], { EVAL_LOG: log });
    run([fixture('flow'), '--bogus'], { EVAL_LOG: log });
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((l) => [l.ok, l.errors]), [[true, 0], [false, 1]]);
    assert.ok(!Number.isNaN(Date.parse(lines[0].ts)));
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

test('a broken EVAL_LOG path never changes the outcome', () => {
  const r = run([fixture('flow')], { EVAL_LOG: '/nonexistent-dir/x/log.jsonl' });
  assert.equal(r.status, 0);
});

// ---- a bug inside the tool is one line, not a stack trace -------------------

// A real fault, with nothing patched: a copy of the skill whose default theme (blueprint) is a folder instead of a
// file, as a damaged install would leave it. Reading it fails with EISDIR, which is neither a spec nor a usage error.
// The copy holds the scripts, shared/ (with the damage), icons, template and a link to this skill's node_modules.
const SKILL = fileURLToPath(new URL('..', import.meta.url));
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function damagedCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-damaged-'));
  made.push(root);
  const copy = path.join(root, 'make-diagram');
  fs.mkdirSync(copy);
  for (const part of ['scripts', 'shared', 'icons', 'template']) fs.cpSync(path.join(SKILL, part), path.join(copy, part), { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'package.json'), path.join(copy, 'package.json'));
  fs.symlinkSync(path.join(SKILL, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
  const theme = path.join(copy, 'shared', 'themes', 'blueprint.json');
  fs.rmSync(theme);
  fs.mkdirSync(theme);
  return copy;
}

for (const script of ['validate', 'build']) {
  const crash = (args) => spawnSync(process.execPath, [path.join(damagedCopy(), 'scripts', `${script}.mjs`), fixture('flow'), ...args], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', PA_OUTPUT_DIR: os.tmpdir() } });

  test(`${script}: an internal error prints one line and exits 1`, () => {
    const r = crash([]);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, 'internal error: EISDIR: illegal operation on a directory, read; please report it\n');
    assert.equal(r.stdout, '');
  });

  test(`${script} --json: an internal error is one { ok: false } line`, () => {
    const r = crash(['--json']);
    assert.equal(r.status, 1);
    assert.equal(r.stderr, '');
    assert.deepEqual(JSON.parse(r.stdout), { ok: false, errors: [{ path: '', message: 'internal error: EISDIR: illegal operation on a directory, read; please report it' }] });
  });
}
