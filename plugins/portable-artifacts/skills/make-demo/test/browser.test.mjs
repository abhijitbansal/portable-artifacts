import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveBrowsers, launchBrowser } from '../scripts/lib/browser.mjs';

const answer = (status, stdout = '', error) => () => ({ status, stdout, error });

test('liveBrowsers lists the pgrep lines of a live headless shell (D2)', () => {
  assert.deepEqual(liveBrowsers(answer(0, '12 chrome-headless-shell --headless\n34 chrome-headless-shell --type=gpu\n')), ['12 chrome-headless-shell --headless', '34 chrome-headless-shell --type=gpu']);
});

test('liveBrowsers says none only when pgrep ran and found none (status 1) (D2)', () => {
  assert.deepEqual(liveBrowsers(answer(1)), []);
});

test('liveBrowsers fails closed: a missing pgrep, an error status or a signal is an error, not "none live" (D2)', () => {
  assert.throws(() => liveBrowsers(answer(null, '', new Error('spawn pgrep ENOENT'))), /pgrep/);
  assert.throws(() => liveBrowsers(answer(2)), /status 2/);
  assert.throws(() => liveBrowsers(answer(3)), /status 3/);
  assert.throws(() => liveBrowsers(answer(null)), /did not finish/);
});

test('liveBrowsers asks only for chrome-headless-shell processes', () => {
  let asked;
  liveBrowsers((command, args) => { asked = [command, ...args]; return { status: 1, stdout: '' }; });
  assert.deepEqual(asked, ['pgrep', '-fl', 'chrome-headless-shell']);
});

test('launchBrowser starts the bundled Chromium and nothing else: no Chrome fallback to slip past the live check (D2)', async () => {
  const calls = [];
  const fake = { launch: async (options) => { calls.push(options); throw new Error('no bundled browser\nmore detail'); } };
  await assert.rejects(launchBrowser(fake), /no bundled browser/);
  assert.deepEqual(calls, [undefined], 'one launch, with no channel');
});

test('launchBrowser with headed: true opens a visible window of the same bundled Chromium (the sign-in command)', async () => {
  const calls = [];
  const browser = { name: 'fake' };
  const fake = { launch: async (options) => { calls.push(options); return browser; } };
  assert.equal(await launchBrowser(fake, { headed: true }), browser);
  assert.deepEqual(calls, [{ headless: false }]);
});

test('launchBrowser returns what the bundled launch gives', async () => {
  const browser = { name: 'fake' };
  assert.equal(await launchBrowser({ launch: async () => browser }), browser);
});
