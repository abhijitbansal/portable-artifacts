import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ALL, browser } from '../shared/doctor.mjs';
import { targets, requirementsFor } from '../scripts/lib/requirements.mjs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const byId = (list, id) => list.find((r) => r.id === id);

test('the one doctor target is check, and every target lists the same six needs', () => {
  assert.deepEqual(targets, ['check']);
  for (const target of ['check', ALL, 'demo.json']) {
    assert.deepEqual(requirementsFor(target).map((r) => r.id), ['node', 'node_modules', 'chromium', 'make-explainer', 'make-motion', 'builder_agent'], String(target));
  }
});

test('make-motion is a required sister skill: the film is made there', () => {
  const motion = byId(requirementsFor('check'), 'make-motion');
  assert.equal(motion.required, true);
  const here = { platform: 'darwin', env: {}, skillDir: '/x/make-demo', exists: () => false };
  assert.equal(motion.check(here), false, 'absent when the folder next to the skill has no SKILL.md');
});

test('the browser is required and an installed Chrome does not count as present', async () => {
  const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-req-'));
  const ctx = { platform: 'darwin', env: {}, skillDir, exists: (p) => p === CHROME };
  assert.equal(await browser({ required: true }).check(ctx), true, 'the shared browser check accepts Chrome');
  const chromium = byId(requirementsFor('check'), 'chromium');
  assert.equal(chromium.required, true);
  assert.equal(await chromium.check(ctx), false, 'this skill does not');
});

test('the bundled Chromium counts as present when playwright knows where it is', async () => {
  const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-req-'));
  const binary = path.join(skillDir, 'chrome');
  fs.writeFileSync(binary, '');
  fs.mkdirSync(path.join(skillDir, 'node_modules/playwright-core'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'node_modules/playwright'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'node_modules/playwright/package.json'), '{"name":"playwright","version":"0.0.0","main":"index.js"}');
  fs.writeFileSync(path.join(skillDir, 'node_modules/playwright/index.js'), `module.exports = { chromium: { executablePath: () => ${JSON.stringify(binary)} } };`);
  const ctx = { platform: 'darwin', env: {}, skillDir, exists: fs.existsSync };
  assert.equal(await byId(requirementsFor('check'), 'chromium').check(ctx), true);
  fs.unlinkSync(binary);
  assert.equal(await byId(requirementsFor('check'), 'chromium').check(ctx), false, 'a binary that is not there');
});

test('playwright is a production dependency here: the install is a plain npm ci, never --omit=dev', () => {
  const fix = byId(requirementsFor('check'), 'node_modules').fix({ platform: 'darwin', skillDir: '/x/make-demo', exists: () => false });
  assert.deepEqual(fix.auto[0], ['npm', 'ci', '--ignore-scripts', '--prefix', '/x/make-demo']);
});
