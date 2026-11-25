// The sign-in store and the session command. No browser here: the fixture-site tests are in session-browser.test.mjs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  sessionFile, saveSession, readSession, forgetSession, listSessions, filterState, login, NothingSaved,
} from '../scripts/lib/session-store.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMMAND = path.join(SKILL, 'scripts', 'session.mjs');
const SECRET = 'cookie-secret-value-1';

let data;
let env;
before(() => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-session-'));
  env = { ...process.env, CLAUDE_PLUGIN_DATA: data };
});
after(() => fs.rmSync(data, { recursive: true, force: true }));

const cookie = (domain, value = SECRET) => ({ name: 'sid', value, domain, path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' });
const stateOf = (cookies, origins = []) => ({ cookies, origins });
const ORIGIN = 'https://app.example.test';

test('sessionFile is <cache>/demo-sessions/<name>.json, and CLAUDE_PLUGIN_DATA moves the cache', () => {
  assert.equal(sessionFile('work', env), path.join(data, 'demo-sessions', 'work.json'));
});

test('a name outside the pattern is refused everywhere, ../x included', () => {
  for (const bad of ['../x', '', 'A', '-a', 'a/b', 'a.b', 'x'.repeat(42)]) {
    assert.throws(() => sessionFile(bad, env), /session name/, bad);
    assert.throws(() => saveSession(bad, { origins: [ORIGIN], state: stateOf([]) }, env), /session name/, bad);
    assert.throws(() => readSession(bad, [ORIGIN], env), /session name/, bad);
    assert.throws(() => forgetSession(bad, env), /session name/, bad);
  }
});

test('saveSession writes the file at mode 0600 in a folder at 0700, and leaves no temporary file beside it', () => {
  saveSession('modes', { origins: [ORIGIN], state: stateOf([cookie('.example.test')]) }, env);
  const file = sessionFile('modes', env);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith('modes')), ['modes.json']);
});

test('saveSession returns how many cookies it kept, and keeps only those for the listed origins', () => {
  const kept = saveSession('filtered', {
    origins: [ORIGIN],
    state: stateOf([cookie('.example.test'), cookie('other.test', 'other-secret'), cookie('ample.test', 'ample-secret')]),
  }, env);
  assert.equal(kept, 1);
  const text = fs.readFileSync(sessionFile('filtered', env), 'utf8');
  assert.ok(text.includes(SECRET));
  assert.ok(!text.includes('other-secret') && !text.includes('ample-secret'));
});

test('saveSession refuses an origin that is not a bare http(s) origin', () => {
  for (const bad of ['https://app.example.test/', 'ftp://x.test', 'app.example.test', 'https://x.test/a']) {
    assert.throws(() => saveSession('bad-origin', { origins: [bad], state: stateOf([]) }, env), /origin/, bad);
  }
  assert.throws(() => saveSession('bad-origin', { origins: [], state: stateOf([]) }, env), /origin/);
});

test('readSession returns the stored state, and a second save replaces the first', () => {
  saveSession('again', { origins: [ORIGIN], state: stateOf([cookie('app.example.test', 'one')]) }, env);
  saveSession('again', { origins: [ORIGIN], state: stateOf([cookie('app.example.test', 'two')]) }, env);
  const state = readSession('again', [ORIGIN], env);
  assert.deepEqual(state.cookies.map((c) => c.value), ['two']);
  assert.equal(fs.statSync(sessionFile('again', env)).mode & 0o777, 0o600);
});

test('readSession refuses a file whose origins do not cover the spec\'s', () => {
  saveSession('narrow', { origins: [ORIGIN], state: stateOf([]) }, env);
  assert.deepEqual(readSession('narrow', [ORIGIN], env), stateOf([]));
  assert.throws(() => readSession('narrow', [ORIGIN, 'https://other.test'], env), /does not cover/);
  assert.throws(() => readSession('narrow', ['https://other.test'], env), /does not cover/);
});

test('readSession on a name never saved says so and names the login command', () => {
  assert.throws(() => readSession('never-saved', [ORIGIN], env), /no saved session.*session\.mjs login/s);
});

test('forgetSession removes the file, and a second call says there was none', () => {
  saveSession('gone', { origins: [ORIGIN], state: stateOf([]) }, env);
  assert.equal(forgetSession('gone', env), true);
  assert.equal(fs.existsSync(sessionFile('gone', env)), false);
  assert.equal(forgetSession('gone', env), false);
});

test('listSessions gives name, origins and savedAt, and never the state', () => {
  saveSession('listed', { origins: [ORIGIN], state: stateOf([cookie('app.example.test')]) }, env);
  const row = listSessions(env).find((r) => r.name === 'listed');
  assert.deepEqual(Object.keys(row).sort(), ['name', 'origins', 'savedAt']);
  assert.deepEqual(row.origins, [ORIGIN]);
  assert.ok(!Number.isNaN(Date.parse(row.savedAt)));
});

test('listSessions on a store that does not exist yet is empty', () => {
  assert.deepEqual(listSessions({ ...env, CLAUDE_PLUGIN_DATA: path.join(data, 'nowhere') }), []);
});

// ---- filterState ------------------------------------------------------------------------------------------------------------

test('filterState: a cookie domain matches the exact host, or a parent domain of it, with or without the leading dot', () => {
  const origins = [ORIGIN];
  const domains = (cookies) => filterState(stateOf(cookies), origins).cookies.map((c) => c.domain);
  assert.deepEqual(domains([cookie('.example.test'), cookie('example.test'), cookie('app.example.test'), cookie('.app.example.test')]),
    ['.example.test', 'example.test', 'app.example.test', '.app.example.test']);
  assert.deepEqual(domains([cookie('other.test'), cookie('ample.test'), cookie('.ample.test'), cookie('xapp.example.test'), cookie('sub.app.example.test')]), [],
    'another site, a suffix that is not a parent domain, and a child host all go');
});

test('filterState: storage only for the listed origins, and the rest of the state is untouched', () => {
  const state = {
    cookies: [],
    origins: [
      { origin: ORIGIN, localStorage: [{ name: 'k', value: 'v' }] },
      { origin: 'https://other.test', localStorage: [{ name: 'k2', value: 'v2' }] },
    ],
  };
  assert.deepEqual(filterState(state, [ORIGIN]).origins, [state.origins[0]]);
});

test('filterState does not change its input', () => {
  const state = stateOf([cookie('other.test')], [{ origin: 'https://other.test', localStorage: [] }]);
  const before = JSON.stringify(state);
  filterState(state, [ORIGIN]);
  assert.equal(JSON.stringify(state), before);
});

// ---- login with a browser that is gone --------------------------------------------------------------------------------------

test('login: a browser that is gone when the state is read gives NothingSaved, and its text never reaches the message', async () => {
  const page = { goto: async () => {} };
  const context = {
    newPage: async () => page,
    storageState: async () => { throw new Error('Target page, context or browser has been closed'); },
    close: async () => { throw new Error('already closed'); },
  };
  const browser = { newContext: async () => context };
  await assert.rejects(login({ browser, url: 'https://app.example.test/', origins: [ORIGIN], untilDone: async () => {} }), (e) => e instanceof NothingSaved && /nothing saved/.test(e.message));
});

test('login does not wait for the page to finish loading: a slow sign-in page must not close in the person\'s face', async () => {
  const seen = [];
  const page = { goto: async (url, options) => { seen.push(options?.waitUntil); } };
  const context = { newPage: async () => page, storageState: async () => ({ cookies: [], origins: [] }), close: async () => {} };
  await login({ browser: { newContext: async () => context }, url: 'https://app.example.test/', origins: [ORIGIN], untilDone: async () => {} });
  assert.deepEqual(seen, ['commit']);
});

// ---- the command -------------------------------------------------------------------------------------------------------------

const run = (args) => spawnSync('node', [COMMAND, ...args], { encoding: 'utf8', env, cwd: os.tmpdir() });

test('session.mjs --help prints a usage line on stdout and exits 0; an unknown flag exits 2 with a usage line', () => {
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^usage:.*login.*list.*forget/s);
  const bad = run(['--no-such-flag-xyz']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage:/);
});

test('session.mjs list shows names, origins and times, and not one cookie value', () => {
  saveSession('shown', { origins: [ORIGIN], state: stateOf([cookie('app.example.test')]) }, env);
  const r = run(['list']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /shown/);
  assert.ok(r.stdout.includes(ORIGIN));
  assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
});

test('session.mjs list on an empty store says there are none', () => {
  const r = spawnSync('node', [COMMAND, 'list'], { encoding: 'utf8', env: { ...env, CLAUDE_PLUGIN_DATA: path.join(data, 'empty') }, cwd: os.tmpdir() });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no saved sessions/);
});

test('session.mjs forget removes the file; the second forget says there was none and exits 1', () => {
  saveSession('forgotten', { origins: [ORIGIN], state: stateOf([]) }, env);
  const first = run(['forget', 'forgotten']);
  assert.equal(first.status, 0);
  assert.match(first.stdout, /forgot/);
  assert.equal(fs.existsSync(sessionFile('forgotten', env)), false);
  const second = run(['forget', 'forgotten']);
  assert.equal(second.status, 1);
  assert.match(second.stdout + second.stderr, /no saved session/);
});

test('session.mjs refuses a bad name, a missing name, a bad origin, an unknown command and a bad url with exit 2 and no browser', () => {
  for (const args of [
    ['forget', '../x'],
    ['forget'],
    ['login', 'https://app.example.test/', '--name', '../x'],
    ['login', 'https://app.example.test/'],
    ['login', 'not a url', '--name', 'ok'],
    ['login', 'ftp://app.example.test/', '--name', 'ok'],
    ['login', 'https://app.example.test/', '--name', 'ok', '--origin', 'https://app.example.test/path'],
    ['login', 'https://app.example.test/', '--name', 'ok', '--origin', 'https://other.test'],
    ['dance'],
    [],
  ]) {
    const r = run(args);
    assert.equal(r.status, 2, `${args.join(' ')} -> ${r.status} ${r.stderr}`);
    assert.ok(r.stderr.trim().length > 0, args.join(' '));
  }
});
