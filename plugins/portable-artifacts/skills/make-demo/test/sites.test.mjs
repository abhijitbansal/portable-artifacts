import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startSites, PRIVATE_SEEDS } from './fixtures/sites/server.mjs';

let sites;
before(async () => { sites = await startSites(); });
after(async () => { await sites.close(); });
beforeEach(() => { sites.reset(); });

const get = (path, init = {}) => fetch(sites.origin + path, { redirect: 'manual', ...init });

async function signIn() {
  const res = await get('/login/signin', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'user=demo&pass=demo' });
  return String(res.headers.get('set-cookie')).split(';')[0];
}

const OK_PATHS = ['/plain/', '/plain/two', '/spa/', '/slow/', '/slow/poll', '/canvas/', '/login/', '/hostile/', '/danger/', '/random/'];

for (const path of OK_PATHS) {
  test(`${path} answers 200 with a page`, async () => {
    const res = await get(path);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });
}

test('/wall/ answers 403 with a human check', async () => {
  const res = await get('/wall/');
  assert.equal(res.status, 403);
  assert.match(await res.text(), /Verify you are human/);
});

test('/login/home without the cookie is a 302 to /login/', async () => {
  const res = await get('/login/home');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login/');
});

/** A raw GET, because fetch rewrites paths like `//`. */
const rawGet = (path) => new Promise((resolve, reject) => {
  const { port } = new URL(sites.origin);
  http.get({ host: '127.0.0.1', port, path }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
});

test('GET // and other paths the URL parser refuses answer 400 and leave the server running (D7)', async () => {
  for (const path of ['//', '//[']) assert.equal(await rawGet(path), 400, path);
  assert.equal((await get('/plain/')).status, 200);
});

test('the two origins differ and the second serves a page', async () => {
  assert.notEqual(sites.origin, sites.otherOrigin);
  const res = await fetch(sites.otherOrigin + '/foreign/');
  assert.equal(res.status, 200);
});

test('a path outside the site folders is a 404, never a file read', async () => {
  const res = await get('/..%2f..%2fserver.mjs');
  assert.equal(res.status, 404);
});

test('signing in sets the cookie, and GET /login/signout clears state().signedIn', async () => {
  assert.equal(sites.state().signedIn, false);
  const cookie = await signIn();
  assert.equal(sites.state().signedIn, true);
  const home = await get('/login/home', { headers: { cookie } });
  assert.equal(home.status, 200);
  await get('/login/signout', { headers: { cookie } });
  assert.equal(sites.state().signedIn, false);
  assert.equal((await get('/login/home', { headers: { cookie } })).status, 302);
});

test('/login/home with the cookie shows every private seed', async () => {
  const cookie = await signIn();
  const body = await (await get('/login/home', { headers: { cookie } })).text();
  assert.ok(PRIVATE_SEEDS.length >= 5);
  for (const seed of PRIVATE_SEEDS) assert.ok(body.includes(seed), `seed missing: ${seed}`);
});

test('GET /danger/item/1/delete is recorded in state().deleted', async () => {
  await get('/danger/item/1/delete');
  assert.deepEqual(sites.state().deleted, ['1']);
});

test('a POST to the icon button path raises state().submitted to 1', async () => {
  const page = await (await get('/danger/')).text();
  const iconPath = /<button[^>]*formaction="([^"]+)"[^>]*class="icon"/.exec(page)?.[1];
  assert.ok(iconPath, 'the icon button names its path');
  const res = await get(iconPath, { method: 'POST' });
  assert.ok(res.status < 400);
  assert.equal(sites.state().submitted, 1);
});

test('the danger page has buttons named Delete, Pay and Send invite and one icon button with no name', async () => {
  const page = await (await get('/danger/')).text();
  for (const name of ['Delete', 'Pay', 'Send invite']) assert.match(page, new RegExp(`<button[^>]*>\\s*${name}\\s*</button>`));
  assert.match(page, /<button[^>]*class="icon"[^>]*>\s*<svg[^>]*aria-hidden="true"/);
});

test('requests() lists what was asked, with method and path', async () => {
  await get('/plain/');
  assert.deepEqual(sites.requests().filter((r) => r.path === '/plain/'), [{ method: 'GET', path: '/plain/' }]);
});

test('reset() returns state and requests to the start', async () => {
  await signIn();
  await get('/danger/item/1/delete');
  await get('/danger/icon', { method: 'POST' });
  sites.reset();
  assert.deepEqual(sites.state(), { signedIn: false, deleted: [], submitted: 0 });
  assert.deepEqual(sites.requests(), []);
});

test('two loads of /random/ differ in text and colour', async () => {
  const [a, b] = [await (await get('/random/')).text(), await (await get('/random/')).text()];
  assert.notEqual(a, b);
});

// ---- the scout fixtures ----

test('/scout/ is an English page whose links to the other origin carry its real address', async () => {
  const page = await (await get('/scout/')).text();
  assert.match(page, /<html lang="en">/);
  assert.ok(!page.includes('{{OTHER}}'), 'the placeholder is filled in');
  assert.ok(page.includes(`href="${sites.otherOrigin}/foreign/"`));
  for (const href of ['/scout/docs', '/scout/de', '/scout/loud', '/scout/jump', '/scout/signout', '/scout/item/7/delete']) assert.ok(page.includes(`href="${href}"`), href);
});

test('/scout/de is German and links to /scout/fremd; /scout/many writes 3,000 links by script', async () => {
  const de = await (await get('/scout/de')).text();
  assert.match(de, /<html lang="de">/);
  assert.ok(de.includes('href="/scout/fremd"'));
  assert.match(await (await get('/scout/many')).text(), /3000/);
});

test('/scout/bounce is a 302 to the other origin, and POST /scout/track answers 204 and is logged', async () => {
  const bounce = await get('/scout/bounce');
  assert.equal(bounce.status, 302);
  assert.equal(bounce.headers.get('location'), `${sites.otherOrigin}/foreign/`);
  assert.equal((await get('/scout/track', { method: 'POST', body: 'x' })).status, 204);
  assert.ok(sites.requests().some((r) => r.method === 'POST' && r.path === '/scout/track'));
});

test('a request to the other origin says so in its log entry; the main origin entries keep their two fields', async () => {
  await fetch(`${sites.otherOrigin}/foreign/`);
  await get('/plain/');
  const log = sites.requests();
  assert.deepEqual(log.find((r) => r.path === '/foreign/'), { method: 'GET', path: '/foreign/', server: 'other' });
  assert.deepEqual(log.find((r) => r.path === '/plain/'), { method: 'GET', path: '/plain/' });
});

test('/login/home also has a button named with the email, a field holding the key, a table cell with the name and a JSON copy', async () => {
  const cookie = await signIn();
  const body = await (await get('/login/home', { headers: { cookie } })).text();
  assert.match(body, new RegExp(`<button[^>]*>[^<]*${PRIVATE_SEEDS[0].replace('.', '\\.')}[^<]*</button>`));
  assert.match(body, new RegExp(`<input[^>]*value="${PRIVATE_SEEDS[4]}"`));
  assert.match(body, new RegExp(`<td>${PRIVATE_SEEDS[3]}</td>`));
  assert.match(body, /<script type="application\/json"[^>]*>[^<]*Maria Ostrowski/);
  assert.ok(!/type="password"/.test(body), 'a signed-in page holds no password field');
});

test('the hostile page has instruction-like headings with bidi and zero-width characters', async () => {
  const page = await (await get('/hostile/')).text();
  assert.match(page, /ignore (all )?(your|previous)/i);
  assert.match(page, /&#x202e;|‮/i);
  assert.match(page, /&#x200b;|​/i);
});
