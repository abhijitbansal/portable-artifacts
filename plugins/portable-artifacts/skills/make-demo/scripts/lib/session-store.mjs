// Sign-in state kept outside the project: <stable cache>/demo-sessions/<name>.json, folder 0700, file 0600.
// A saved state is cookies and storage of the listed origins and nothing else. Nothing in here prints any of it.
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableCacheDir } from '../../shared/doctor.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { SESSION_PATTERN } from './schema.mjs';
import { isBareOrigin } from './spec.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const NAME = new RegExp(SESSION_PATTERN);
const FILE_VERSION = 1;
export const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const LOGIN_COMMAND = 'node scripts/session.mjs login <url> --name <name>';

/** The sign-in did not finish, so the store was not touched. The message is fixed text: nothing from the browser goes into it. */
export class NothingSaved extends Error {
  constructor(why) {
    super(`${why}; nothing saved`);
    this.name = 'NothingSaved';
  }
}

export function checkName(name) {
  if (typeof name !== 'string' || !NAME.test(name)) throw new UsageError('a session name is lower-case letters, digits and hyphens, starting with a letter or digit, up to 41 characters');
  return name;
}

export function checkOrigins(origins) {
  if (!Array.isArray(origins) || origins.length === 0) throw new UsageError('give at least one origin, such as "https://example.test"');
  for (const origin of origins) {
    if (!isBareOrigin(origin)) throw new UsageError('an origin is a bare http or https origin such as "https://example.test" (no path, no trailing slash)');
  }
  return origins;
}

const sessionsDir = (env) => path.join(stableCacheDir({ skillDir: SKILL_ROOT, env }), 'demo-sessions');

/** Where a session lives; refuses a name outside the pattern, so no name can climb out of the folder. */
export function sessionFile(name, env = process.env) {
  return path.join(sessionsDir(env), `${checkName(name)}.json`);
}

// ---- what is kept -----------------------------------------------------------------------------------------------------------

// A cookie for `.example.test` is sent to app.example.test, never the other way, and never to `ample.test`.
const cookieCovers = (domain, host) => {
  const bare = String(domain).replace(/^\./, '');
  return bare !== '' && (host === bare || host.endsWith(`.${bare}`));
};

/** The state cut down to the origins listed: cookies whose domain covers one of their hosts, storage of those origins. A new object. */
export function filterState(state, origins) {
  const hosts = origins.map((o) => new URL(o).hostname);
  return {
    ...state,
    cookies: (state.cookies ?? []).filter((c) => hosts.some((host) => cookieCovers(c.domain, host))),
    origins: (state.origins ?? []).filter((o) => origins.includes(o.origin)),
  };
}

// ---- the store --------------------------------------------------------------------------------------------------------------

/** Keep a state. Written beside and renamed into place. Returns how many cookies were kept (the only thing a command may print of it). */
export function saveSession(name, { origins, state }, env = process.env) {
  const file = sessionFile(name, env);
  checkOrigins(origins);
  const kept = filterState(state, origins);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  fs.chmodSync(dir, DIR_MODE);
  // A random name, opened with `wx` (it must not exist): a file or symlink already there is never followed or reused. A process killed
  // between the write and the rename leaves `<name>.json.<random>.tmp`, which `forgetSession` removes.
  const temp = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify({ version: FILE_VERSION, name, origins, savedAt: new Date().toISOString(), state: kept }), { mode: FILE_MODE, flag: 'wx' });
    fs.chmodSync(temp, FILE_MODE);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
  return kept.cookies.length;
}

/** The line `session.mjs login` prints: the name, the origins and the number of cookies kept, and nothing else of the state. */
export const savedLine = (name, cookies, origins) => `saved session "${name}": ${cookies} cookies, origins ${origins.join(', ')}`;

function readFile(name, env) {
  const file = sessionFile(name, env);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new UsageError(`no saved session named "${name}"; sign in with: ${LOGIN_COMMAND}`);
    throw error;
  }
  try {
    const saved = JSON.parse(text);
    if (Array.isArray(saved.origins) && saved.state && typeof saved.state === 'object') return saved;
  } catch {
    // falls through to the same message
  }
  throw new UsageError(`the saved session "${name}" cannot be read; sign in again with: ${LOGIN_COMMAND}`);
}

/** The stored state cut down to `origins`, for a spec that needs them. Refuses a session saved for fewer origins than the spec visits. */
export function readSession(name, origins, env = process.env) {
  const saved = readFile(name, env);
  const missing = origins.filter((o) => !saved.origins.includes(o));
  if (missing.length > 0) throw new UsageError(`the saved session "${name}" does not cover ${missing.join(', ')}; sign in again with --origin for each origin`);
  return filterState(saved.state, origins); // a session saved for A and B does not hand B's cookies to a demo of A
}

/** Remove a session and any temporary file of its name that a killed save left. False when there was nothing to remove. */
export function forgetSession(name, env = process.env) {
  const file = sessionFile(name, env);
  const leftovers = fs.existsSync(path.dirname(file)) ? fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(`${name}.json.`) && f.endsWith('.tmp')) : [];
  for (const f of leftovers) fs.rmSync(path.join(path.dirname(file), f), { force: true });
  if (!fs.existsSync(file)) return leftovers.length > 0;
  fs.rmSync(file);
  return true;
}

/** Name, origins and time of every saved session; never the state. A file that cannot be read is left out. */
export function listSessions(env = process.env) {
  const dir = sessionsDir(env);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && NAME.test(f.slice(0, -'.json'.length)))
    .sort()
    .flatMap((f) => {
      const name = f.slice(0, -'.json'.length);
      try {
        const { origins, savedAt } = readFile(name, env);
        return [{ name, origins, savedAt }];
      } catch {
        return [];
      }
    });
}

// ---- signing in -------------------------------------------------------------------------------------------------------------

/**
 * Resolves when every page of the page's context is closed (the person closed the window); ends with NothingSaved after `timeoutMs`.
 * The command passes this as `untilDone`.
 */
export function untilClosed(page, { timeoutMs = LOGIN_TIMEOUT_MS } = {}) {
  const context = page.context();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new NothingSaved(`timed out after ${Math.round(timeoutMs / 1000)} seconds`)), timeoutMs);
    const check = () => {
      if (context.pages().length > 0) return;
      clearTimeout(timer);
      resolve();
    };
    const watch = (p) => p.on('close', check);
    context.pages().forEach(watch);
    context.on('page', watch);
  });
}

/**
 * Open `url` in a fresh context of `browser`, wait for `untilDone(page)`, and return the state cut down to `origins`.
 * The state is taken in memory (never with a `path`), so the file mode stays ours. A browser that is gone gives NothingSaved.
 */
export async function login({ browser, url, origins, untilDone }) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'commit' }); // a slow page is the person's to wait for
    } catch {
      throw new NothingSaved('the page did not open');
    }
    await untilDone(page);
    let state;
    try {
      state = await context.storageState({ indexedDB: true });
    } catch {
      throw new NothingSaved('the browser was closed before the sign-in could be read');
    }
    return filterState(state, origins);
  } finally {
    await context.close().catch(() => {});
  }
}
