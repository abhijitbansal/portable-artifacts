#!/usr/bin/env node
// node scripts/session.mjs login <url> --name <name> [--origin <origin>]...
// node scripts/session.mjs list
// node scripts/session.mjs forget <name>
// Sign in by hand once; the state is kept outside the project (see lib/session-store.mjs) and a demo names it with `session`.
// `login` opens a visible window of the bundled Chromium, waits until you close it, then saves cookies and storage of the listed origins.
// It prints the name, the origins and the number of cookies, and nothing else of what it saved. `list` and `forget` open no browser.
// exit 0 ok, 1 nothing saved or no such session, 2 usage
//
// Imports only built-ins and shared/ up here: the store (ajv) and Playwright load after preflight has found node_modules, so --help
// and a missing install are one line, not a stack.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseCli, exitUsage } from '../shared/cli.mjs';
import { agentText } from '../shared/agent-text.mjs';
import { preflight } from '../shared/preflight.mjs';
import { exitInternal } from './lib/internal-error.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'node scripts/session.mjs login <url> --name <name> [--origin <origin>]... | list | forget <name>';
const OPTIONS = { name: { type: 'string' }, origin: { type: 'string', multiple: true } };
const say = (line) => process.stdout.write(`${line}\n`);
const complain = (line) => process.stderr.write(`${line}\n`);

function httpUrl(text) {
  try {
    const url = new URL(text);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url;
  } catch {
    // falls through to the same message
  }
  throw new UsageError('login needs an http or https address, such as https://example.test/sign-in');
}

/** The arguments of `login`, checked before any browser starts. */
async function loginArgs(values, rest) {
  const { checkName, checkOrigins } = await import('./lib/session-store.mjs');
  if (rest.length !== 1) throw new UsageError(`login takes one address; usage: ${USAGE}`);
  if (values.name === undefined) throw new UsageError(`login needs --name; usage: ${USAGE}`);
  const url = httpUrl(rest[0]);
  const origins = checkOrigins(values.origin ?? [url.origin]);
  if (!origins.includes(url.origin)) throw new UsageError(`--origin must include the origin of the address, ${url.origin}`);
  return { url: url.href, name: checkName(values.name), origins };
}

async function login(values, rest) {
  const { url, name, origins } = await loginArgs(values, rest);
  const store = await import('./lib/session-store.mjs');
  const { launchBrowser } = await import('./lib/browser.mjs');
  const browser = await launchBrowser(undefined, { headed: true });
  say(`A browser window opened. Sign in, then close the window. Nothing is saved until you do (it waits ${store.LOGIN_TIMEOUT_MS / 60000} minutes).`);
  try {
    const state = await store.login({ browser, url, origins, untilDone: (page) => store.untilClosed(page) });
    const cookies = store.saveSession(name, { origins, state });
    say(`saved session "${name}": ${cookies} cookies, origins ${origins.join(', ')}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function list() {
  const { listSessions } = await import('./lib/session-store.mjs');
  const sessions = listSessions();
  if (sessions.length === 0) say('no saved sessions');
  for (const s of sessions) say(`${agentText(s.name)}  ${agentText(String(s.savedAt))}  ${s.origins.map((o) => agentText(String(o))).join(', ')}`);
}

async function forget(rest) {
  const { forgetSession } = await import('./lib/session-store.mjs');
  if (rest.length !== 1) throw new UsageError(`forget takes one name; usage: ${USAGE}`);
  if (forgetSession(rest[0])) say(`forgot session "${rest[0]}"`);
  else {
    complain(`no saved session named "${rest[0]}"`);
    process.exitCode = 1;
  }
}

const argv = process.argv.slice(2);
try {
  const { values, positionals } = parseCli(argv, OPTIONS, USAGE);
  const [command, ...rest] = positionals;
  if (!['login', 'list', 'forget'].includes(command)) throw new UsageError(`expected login, list or forget; usage: ${USAGE}`);
  if (preflight(SKILL_ROOT, { argv })) {
    const { NothingSaved } = await import('./lib/session-store.mjs');
    try {
      if (command === 'login') await login(values, rest);
      else if (command === 'list') await list();
      else await forget(rest);
    } catch (e) {
      if (!(e instanceof NothingSaved)) throw e;
      complain(e.message);
      process.exitCode = 1;
    }
  }
} catch (e) {
  if (e instanceof UsageError) exitUsage(e);
  else exitInternal(e);
}
