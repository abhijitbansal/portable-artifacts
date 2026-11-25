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
const OTHER_MARK = '{{OTHER}}';

/** Answer, and say so (true): a route returns false when the request is not its own. */
const send = (res, status, body, type = HTML, headers = {}) => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
  res.end(body);
  return true;
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

// The page ground keeps one lightness and steps its hue by a third of the wheel on successive loads, so grounds are near-equal in
// brightness but never the same colour: a brightness-only picture check (the first version of the probe) could pass this page.
const GROUND_HUE_STEP = 120;
const randomPage = (load) => {
  const hue = () => Math.floor(Math.random() * 360);
  const word = () => randomBytes(4).toString('hex');
  return `<!doctype html><meta charset="utf-8"><title>Random ${word()}</title>
<body style="margin:0;background:hsl(${(load * GROUND_HUE_STEP) % 360} 70% 85%);color:hsl(${hue()} 60% 25%);font:24px system-ui">
<h1>Visit ${word()}</h1><p>Today's code is ${word()} ${word()}.</p><div style="width:300px;height:120px;background:hsl(${hue()} 80% 50%)"></div></body>`;
};

const wallPage = '<!doctype html><meta charset="utf-8"><title>Just a moment...</title><h1>Verify you are human</h1><p>Checking your browser before access is granted.</p>';

// A signed-in page. The seeds sit in the places a scout could leak them from: a button name, a heading, a link address, a field value,
// a table cell and a JSON copy in a script. Only the button, the heading and the link are names or addresses a digest may list (masked).
const loginHome = () => `<!doctype html><meta charset="utf-8"><title>Account</title><h1>Account</h1>
<h2>Signed in as ${PRIVATE_SEEDS[0]}</h2>
<dl><dt>Name</dt><dd>${PRIVATE_SEEDS[3]}</dd><dt>Email</dt><dd>${PRIVATE_SEEDS[0]}</dd><dt>Phone</dt><dd>${PRIVATE_SEEDS[1]}</dd>
<dt>Card</dt><dd>${PRIVATE_SEEDS[2]}</dd><dt>API key</dt><dd>${PRIVATE_SEEDS[4]}</dd></dl>
<button type="button">Switch to ${PRIVATE_SEEDS[0]}</button>
<a href="/login/card/4111111111111111?holder=Maria+Ostrowski">Card ${PRIVATE_SEEDS[2]}</a>
<a href="/login/summary">${PRIVATE_SEEDS[3]} paid the invoice for the spring order, and the card on file is the one we charged.</a>
<label for="key">API key</label> <input id="key" type="text" value="${PRIVATE_SEEDS[4]}">
<table><tr><td>${PRIVATE_SEEDS[3]}</td><td>${PRIVATE_SEEDS[1]}</td></tr></table>
<script type="application/json" id="me">{"name":"${PRIVATE_SEEDS[3]}","email":"${PRIVATE_SEEDS[0]}","key":"${PRIVATE_SEEDS[4]}"}</script>
<a href="/login/signout">Sign out</a>`;

const DONE_PAGE = '<!doctype html><title>Done</title><h1>Done</h1>';
const NOT_FOUND_PAGE = '<!doctype html><title>Not found</title><h1>Not found</h1>';
const sessionCookie = (value, extra) => `${SESSION_COOKIE}=${value}; Path=/; ${extra}`;

/** The path of a request, or null when the URL parser refuses it (`//`, `//[`): such a request is a 400, never a crash. */
function pathOf(req) {
  try {
    return new URL(req.url, 'http://fixture.invalid').pathname;
  } catch {
    return null;
  }
}

/** The sign-in pages: POST /login/signin sets the cookie, GET /login/signout clears it, /login/home needs it. */
function loginRoute(world, req, res, pathname) {
  if (pathname === '/login/signin' && req.method === 'POST') {
    world.signedIn = true;
    return send(res, 303, '', HTML, { location: '/login/home', 'set-cookie': sessionCookie(SESSION_VALUE, 'HttpOnly; SameSite=Lax') });
  }
  if (pathname === '/login/signout') {
    world.signedIn = false;
    return send(res, 303, '', HTML, { location: '/login/', 'set-cookie': sessionCookie('', 'Max-Age=0') });
  }
  if (pathname !== '/login/home') return false;
  if (!world.signedIn || !hasSession(req)) return send(res, 302, '', HTML, { location: '/login/' });
  return send(res, 200, loginHome());
}

/** The danger pages: a GET delete link and POST buttons, each recorded so a test can tell whether anything reached them. */
function dangerRoute(world, req, res, pathname) {
  const del = /^\/danger\/item\/([\w-]+)\/delete$/.exec(pathname);
  if (del) {
    world.deleted = [...world.deleted, del[1]];
    return send(res, 200, '<!doctype html><title>Deleted</title><h1>Deleted</h1>');
  }
  if (!pathname.startsWith('/danger/') || req.method !== 'POST') return false;
  world.submitted += 1;
  return send(res, 200, DONE_PAGE);
}

/** Pages made by a handler, not read from a file. */
function dynamicRoute(world, res, pathname) {
  const seen = (p) => world.log.filter((r) => r.path === p).length;
  if (pathname === '/wall/') return send(res, 403, wallPage);
  if (pathname === '/trap/needs-login') return send(res, 302, '', HTML, { location: '/login/' });
  if (pathname === '/random/') return send(res, 200, randomPage(seen('/random/')));
  if (pathname === '/scout/bounce') return send(res, 302, '', HTML, { location: `${world.otherOrigin}/foreign/` });
  if (pathname === '/scout/track') return send(res, 204, '');
  if (pathname === '/slow/data') return send(res, 200, JSON.stringify({ items: ['Quarterly report', 'Team roster', 'Open tasks'] }), TYPES['.json']);
  if (pathname === '/slow/poll/tick') return send(res, 200, JSON.stringify({ n: seen('/slow/poll/tick') }), TYPES['.json']);
  return false;
}

function handleMain(world, req, res) {
  const pathname = pathOf(req);
  if (pathname === null) return send(res, 400, 'bad request', 'text/plain');
  world.log.push({ method: req.method, path: pathname });
  if (dynamicRoute(world, res, pathname) || loginRoute(world, req, res, pathname) || dangerRoute(world, req, res, pathname)) return true;
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed', 'text/plain');
  const file = fileFor(pathname);
  if (!file) return send(res, 404, NOT_FOUND_PAGE);
  const body = fs.readFileSync(file);
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  // A page may link to the other server, whose port is only known at run time: {{OTHER}} is its origin.
  if (path.extname(file) === '.html' && body.includes(OTHER_MARK)) return send(res, 200, body.toString('utf8').replaceAll(OTHER_MARK, world.otherOrigin), type);
  return send(res, 200, body, type);
}

function handleOther(world, req, res) {
  const pathname = pathOf(req);
  if (pathname === null) return send(res, 400, 'bad request', 'text/plain');
  world.log.push({ method: req.method, path: pathname, server: 'other' }); // only these entries say which server: the main ones keep two fields
  if (pathname !== '/foreign/') return send(res, 404, 'not found', 'text/plain');
  return send(res, 200, fs.readFileSync(path.join(ROOT, 'foreign', 'index.html')));
}

const listen = (handler) => new Promise((resolve, reject) => {
  const server = http.createServer(handler);
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server));
});
const closeServer = (server) => new Promise((done) => { server.closeAllConnections?.(); server.close(() => done()); });

/** Start both servers. `requests()` lists every request seen since the start or the last `reset()`. */
export async function startSites() {
  const world = { log: [], signedIn: false, deleted: [], submitted: 0, otherOrigin: '' };
  const main = await listen((req, res) => handleMain(world, req, res));
  // A WebSocket upgrade is logged and refused: a test then sees whether a page ever reached the server with one.
  main.on('upgrade', (req, socket) => {
    world.log.push({ method: 'UPGRADE', path: pathOf(req) ?? '?' });
    socket.destroy();
  });
  const other = await listen((req, res) => handleOther(world, req, res));
  world.otherOrigin = `http://127.0.0.1:${other.address().port}`;
  return {
    origin: `http://127.0.0.1:${main.address().port}`,
    otherOrigin: world.otherOrigin,
    requests: () => world.log.map((r) => ({ ...r })),
    state: () => ({ signedIn: world.signedIn, deleted: [...world.deleted], submitted: world.submitted }),
    reset() { Object.assign(world, { log: [], signedIn: false, deleted: [], submitted: 0 }); },
    close: () => Promise.all([closeServer(main), closeServer(other)]).then(() => undefined),
  };
}
