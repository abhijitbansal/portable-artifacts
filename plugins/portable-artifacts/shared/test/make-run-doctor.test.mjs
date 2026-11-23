// make-run's doctor stage against the real doctor: error.hint must be one string naming the command for this platform
// (the doctor's fix.manual is an object keyed by platform), in both --json and text mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpDir, runNode, oneObject, stub } from './helpers/make-suite.mjs';

const SHARED = path.resolve(import.meta.dirname, '..');
const url = (name) => pathToFileURL(path.join(SHARED, name)).href;

// A make.mjs entry on the shared makeMain, and a doctor stage that is the real doctorMain over a skill with no node_modules.
function fixture() {
  const dir = tmpDir('make-doctor-');
  const skillDir = path.join(dir, 'skill');
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, 'package.json'), JSON.stringify({ dependencies: { ajv: '8.0.0' } }));
  const make = path.join(dir, 'make.mjs');
  fs.writeFileSync(make, `import { makeMain } from ${JSON.stringify(url('make-run.mjs'))};\nawait makeMain(process.argv.slice(2), { skill: 'make-x', scriptsDir: ${JSON.stringify(dir)} });\n`);
  const doctor = path.join(dir, 'real-doctor.mjs');
  fs.writeFileSync(doctor, [
    `import { doctorMain, nodeModules } from ${JSON.stringify(url('doctor.mjs'))};`,
    `await doctorMain(process.argv.slice(2), { skill: 'make-x', skillDir: ${JSON.stringify(skillDir)}, requirementsFor: () => [nodeModules()] });`,
    '',
  ].join('\n'));
  const spec = path.join(dir, 'spec.json');
  fs.writeFileSync(spec, '{}');
  const scripts = { doctor, validate: stub(dir, 'validate'), build: stub(dir, 'build'), check: stub(dir, 'check') };
  return { make, spec, skillDir, env: { PA_MAKE_TEST_SCRIPTS: JSON.stringify(scripts), NODE_ENV: 'test' } };
}

// PA_MAKE_TEST_SCRIPTS swaps the scripts make.mjs runs, so it only counts when NODE_ENV is "test".
test('PA_MAKE_TEST_SCRIPTS is ignored outside NODE_ENV=test: the stand-in scripts never run', async () => {
  const { make, spec, env } = fixture();
  const marker = path.join(path.dirname(make), 'ran');
  const scripts = { ...Object.fromEntries(['doctor', 'validate', 'build', 'check'].map((s) => [s, stub(path.dirname(make), s, { marker })])) };
  for (const NODE_ENV of ['production', '']) {
    const { stdout } = await runNode(make, [spec, '--json'], { env: { ...env, NODE_ENV, PA_MAKE_TEST_SCRIPTS: JSON.stringify(scripts) } });
    assert.equal(fs.existsSync(marker), false, `NODE_ENV=${JSON.stringify(NODE_ENV)}: a stand-in script ran: ${stdout}`);
  }
});

test('a missing node_modules from the real doctor gives --json error.hint as a string with the install command', async () => {
  const { make, spec, skillDir, env } = fixture();
  const { status, stdout } = await runNode(make, [spec, '--json'], { env });
  const report = oneObject(stdout);
  assert.equal(status, 2);
  assert.match(report.error.message, /^make-x needs node_modules/);
  assert.equal(typeof report.error.hint, 'string', `hint must be a string, got ${JSON.stringify(report.error.hint)}`);
  assert.ok(report.error.hint.includes('npm ci --ignore-scripts'), report.error.hint);
  assert.ok(report.error.hint.includes(skillDir), report.error.hint);
});

test('the text form prints the install command, not [object Object]', async () => {
  const { make, spec, env } = fixture();
  const { status, stdout, stderr } = await runNode(make, [spec], { env });
  assert.equal(status, 2);
  assert.doesNotMatch(stdout + stderr, /\[object Object\]/);
  assert.match(stdout, /failed: make-x needs node_modules.*; .*npm ci --ignore-scripts/);
});
