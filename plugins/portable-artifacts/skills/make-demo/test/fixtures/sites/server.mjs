// Loopback fixture sites for make-demo tests. Two servers on port 0: `origin` serves every site, `otherOrigin` is a foreign origin.
// Nothing here loads anything off loopback.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SESSION_COOKIE = 'sid';
const SESSION_VALUE = 'fixture-session';

/** Private-looking values shown on /login/home; a scan for any of them in printed output means a leak. */
export const PRIVATE_SEEDS = [
  'maria.ostrowski@example.test',
  '+44 7700 900123',
  '4111 1111 1111 1111',
  'Maria Ostrowski',
  'key_demo_7f3a91c2d85e40b6a1f9',
];

const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css' };
const HTML = 'text/html; charset=utf-8';

const send = (res, status, body, type = HTML, headers = {}) => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(body);
};

/** The file a path maps to: `/a/` is a/index.html, `/a/b` is a/b.html or a/b/index.html; never outside ROOT. */
function fileFor(pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return null; }
  const base = path.resolve(ROOT, `.${rel}`);
  if (base !== ROOT && !base.startsWith(ROOT + path.sep)) return null;
  const candidates = rel.endsWith('/') ? [path.join(base, 'index.html')] : [base, `${base}.html`, path.join(base, 'index.html')];
  const hit = candidates.find((c) => path.extname(c) !== '.mjs' && fs.existsSync(c) && fs.statSync(c).isFile());
  return hit ?? null;
}

const hasSession = (req) => (req.headers.cookie ?? '').split(/;\s*/).includes(`${SESSION_COOKIE}=${SESSION_VALUE}`);

// The page ground steps through dark, middle and light greys on successive loads, so no two consecutive loads agree
// in brightness (a random colour alone could land within a few luma levels of the last one and look the same to a picture check).
const GROUND_LIGHTNESS = [18, 52, 86];
const randomPage = (load) => {
  const hue = () => Math.floor(Math.random() * 360);
  const word = () => randomBytes(4).toString('hex');
  return `<!doctype html><meta charset="utf-8"><title>Random ${word()}</title>
<body style="margin:0;background:hsl(0 0% ${GROUND_LIGHTNESS[load % GROUND_LIGHTNESS.length]}%);color:hsl(${hue()} 60% 60%);font:24px system-ui">
<h1>Visit ${word()}</h1><p>Today's code is ${word()} ${word()}.</p><div style="width:300px;height:120px;background:hsl(${hue()} 80% 50%)"></div></body>`;
};

const wallPage = '<!doctype html><meta charset="utf-8"><title>Just a moment...</title><h1>Verify you are human</h1><p>Checking your browser before access is granted.</p>';

const loginHome = () => `<!doctype html><meta charset="utf-8"><title>Account</title><h1>Account</h1>
<dl><dt>Name</dt><dd>${PRIVATE_SEEDS[3]}</dd><dt>Email</dt><dd>${PRIVATE_SEEDS[0]}</dd><dt>Phone</dt><dd>${PRIVATE_SEEDS[1]}</dd>
<dt>Card</dt><dd>${PRIVATE_SEEDS[2]}</dd><dt>API key</dt><dd>${PRIVATE_SEEDS[4]}</dd></dl>
<a href="/login/signout">Sign out</a>`;

/** Start both servers. `requests()` lists every request seen since the start or the last `reset()`. */
export async function startSites() {
  let log = [];
  let signedIn = false;
  let deleted = [];
  let submitted = 0;

  const handle = (req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid');
    const { pathname } = url;
    log.push({ method: req.method, path: pathname });
    if (pathname === '/wall/') return send(res, 403, wallPage);
    if (pathname === '/random/') return send(res, 200, randomPage(log.filter((r) => r.path === '/random/').length));
    if (pathname === '/slow/data') return send(res, 200, JSON.stringify({ items: ['Quarterly report', 'Team roster', 'Open tasks'] }), TYPES['.json']);
    if (pathname === '/slow/poll/tick') return send(res, 200, JSON.stringify({ n: log.filter((r) => r.path === '/slow/poll/tick').length }), TYPES['.json']);
    if (pathname === '/login/signin' && req.method === 'POST') {
      signedIn = true;
      return send(res, 303, '', HTML, { location: '/login/home', 'set-cookie': `${SESSION_COOKIE}=${SESSION_VALUE}; Path=/; HttpOnly; SameSite=Lax` });
    }
    if (pathname === '/login/signout') {
      signedIn = false;
      return send(res, 303, '', HTML, { location: '/login/', 'set-cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0` });
    }
    if (pathname === '/login/home') {
      if (!signedIn || !hasSession(req)) return send(res, 302, '', HTML, { location: '/login/' });
      return send(res, 200, loginHome());
    }
    const del = /^\/danger\/item\/([\w-]+)\/delete$/.exec(pathname);
    if (del) {
      deleted = [...deleted, del[1]];
      return send(res, 200, '<!doctype html><title>Deleted</title><h1>Deleted</h1>');
    }
    if (pathname.startsWith('/danger/') && req.method === 'POST') {
      submitted += 1;
      return send(res, 200, '<!doctype html><title>Done</title><h1>Done</h1>');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain');
    const file = fileFor(pathname);
    if (!file) return send(res, 404, '<!doctype html><title>Not found</title><h1>Not found</h1>');
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] ?? 'application/octet-stream');
  };

  const handleOther = (req, res) => {
    const { pathname } = new URL(req.url, 'http://fixture.invalid');
    log.push({ method: req.method, path: pathname });
    if (pathname !== '/foreign/') return send(res, 404, 'not found', 'text/plain');
    return send(res, 200, fs.readFileSync(path.join(ROOT, 'foreign', 'index.html')));
  };

  const listen = (handler) => new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const closeServer = (server) => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); });

  const main = await listen(handle);
  // A WebSocket upgrade is logged and refused: a test then sees whether a page ever reached the server with one.
  main.on('upgrade', (req, socket) => {
    log.push({ method: 'UPGRADE', path: new URL(req.url, 'http://fixture.invalid').pathname });
    socket.destroy();
  });
  const other = await listen(handleOther);
  return {
    origin: `http://127.0.0.1:${main.address().port}`,
    otherOrigin: `http://127.0.0.1:${other.address().port}`,
    requests: () => log.map((r) => ({ ...r })),
    state: () => ({ signedIn, deleted: [...deleted], submitted }),
    reset() { log = []; signedIn = false; deleted = []; submitted = 0; },
    close: () => Promise.all([closeServer(main), closeServer(other)]).then(() => undefined),
  };
}
