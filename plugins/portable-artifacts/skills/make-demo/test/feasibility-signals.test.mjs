import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeLines, diffTrees, errorKey, newErrors, wallReason, LEFT_OUT_MAX } from './feasibility/signals.mjs';

const tree = (...nodes) => treeLines(nodes);

test('treeLines keeps role, name, state flags, address and text, indented by depth (B6)', () => {
  const lines = treeLines([
    { role: 'heading', name: 'Verify you are human: step 1', level: 1 },
    { role: 'button' },
    { role: 'button', name: 'T', pressed: true },
    { role: 'link', name: 'Go', url: '/x' },
    { role: 'list', children: [{ role: 'listitem', text: 'one' }] },
  ]);
  assert.deepEqual(lines, [
    'heading "Verify you are human: step 1"[level=1]',
    'button',
    'button "T"[pressed=true]',
    'link "Go"[url=/x]',
    'list',
    '  listitem = one',
  ]);
});

test('a name with a colon, quotes or a line break stays one line', () => {
  const [line] = treeLines([{ role: 'button', name: 'Delete: "all"\nnow' }]);
  assert.equal(line, 'button "Delete: "all" now"');
});

test('diffTrees finds nothing when the stepped tree is the real one', () => {
  const real = tree({ role: 'heading', name: 'A' }, { role: 'button', name: 'Save' });
  const result = diffTrees(real, [real, real, real]);
  assert.deepEqual([result.differences, result.leftOutShare], [[], 0]);
});

test('a counter that reads 241 where every real run reads 247 is a difference (B1)', () => {
  const real = tree({ role: 'heading', name: 'Total 247 units' });
  const stepped = tree({ role: 'heading', name: 'Total 241 units' });
  const { differences } = diffTrees(stepped, [real, real, real]);
  assert.ok(differences.some((d) => d.startsWith('missing') && d.includes('247')), differences.join('; '));
  assert.ok(differences.some((d) => d.startsWith('extra') && d.includes('241')));
});

test('six Edit buttons against one is a difference: counts matter, not only names (B7)', () => {
  const edit = { role: 'button', name: 'Edit' };
  const real = tree(edit, edit, edit, edit, edit, edit);
  assert.match(diffTrees(tree(edit), [real, real, real]).differences.join(), /missing 5× button "Edit"/);
  assert.match(diffTrees(real, [tree(edit), tree(edit), tree(edit)]).differences.join(), /extra 5× button "Edit"/);
});

test('a state flag is part of the line: pressed against not pressed is a difference', () => {
  const [on, off] = [tree({ role: 'button', name: 'T', pressed: true }), tree({ role: 'button', name: 'T' })];
  assert.notDeepEqual(diffTrees(off, [on, on, on]).differences, []);
});

test('stable lines in another order are a difference', () => {
  const [a, b] = [{ role: 'link', name: 'A' }, { role: 'link', name: 'B' }];
  assert.match(diffTrees(tree(b, a), [tree(a, b), tree(a, b), tree(a, b)]).differences.join(), /different order/);
});

test('a line the real runs disagree on is left out, and the stepped run may differ there', () => {
  const [one, two, three] = [1, 2, 3].map((n) => tree({ role: 'heading', name: 'Reports' }, { role: 'button', name: `Open ${n}` }));
  const stepped = tree({ role: 'heading', name: 'Reports' }, { role: 'button', name: 'Open 9' });
  const result = diffTrees(stepped, [one, two, three]);
  assert.deepEqual(result.differences, []);
  assert.equal(result.leftOutShare, 0.5, 'one line of two is not stable');
  assert.ok(result.leftOutShare > LEFT_OUT_MAX, 'so the site is inconclusive');
});

test('a stepped run with no controls where the real runs have changing ones is still inconclusive, never a pass (B7)', () => {
  const real = [1, 2, 3].map((n) => tree({ role: 'heading', name: 'Reports' }, { role: 'button', name: `A${n}` }));
  const result = diffTrees(tree({ role: 'heading', name: 'Reports' }), real);
  assert.ok(result.leftOutShare > LEFT_OUT_MAX);
});

test('more unknown lines than the real runs vary by is a difference: a banner only the stepped run has', () => {
  const real = tree({ role: 'heading', name: 'A' });
  const stepped = tree({ role: 'heading', name: 'A' }, { role: 'text', text: 'ERROR STATE' });
  assert.match(diffTrees(stepped, [real, real, real]).differences.join(), /extra 1× text = ERROR STATE/);
});

test('errorKey strips ids and numbers so the same error twice is one key', () => {
  assert.equal(errorKey('pageerror', 'boom 123456'), errorKey('pageerror', 'boom 999'));
  assert.equal(errorKey('request', 'GET /a/deadbeefcafe0123 failed'), errorKey('request', 'GET /a/0123456789abcdef failed'));
  assert.notEqual(errorKey('console', 'x'), errorKey('pageerror', 'x'));
});

test('newErrors reports a key the stepped run has more often than any real run, not one both have equally', () => {
  const key = errorKey('console', 'hydration mismatch');
  assert.deepEqual(newErrors([key, key, key], [[key], [key, key], []]), [{ key, stepped: 3, real: 2 }]);
  assert.deepEqual(newErrors([key], [[key], [], []]), []);
  assert.deepEqual(newErrors([], [[key], [key], [key]]), [], 'fewer errors than real time is not a failure');
  assert.equal(newErrors([errorKey('pageerror', 'other')], [[key], [key], [key]]).length, 1);
});

const PAGE = { textLength: 5000, sample: 'An ordinary article about web browsers.', controls: 40, consentCover: false };

test('a normal page is not a wall, even when a long article mentions a captcha', () => {
  assert.equal(wallReason({ statuses: [200], title: 'Web browser', headings: ['History'], probe: { ...PAGE, sample: 'a captcha is a test' }, frameUrls: [] }), null);
});

test('an error status on any navigation is a wall and the reason names it (B5)', () => {
  assert.equal(wallReason({ statuses: [302, 404], title: 'x', probe: PAGE }), 'status 404');
});

test('a title or heading that reads like a bot check is a wall, even with a colon in it (B6)', () => {
  assert.match(wallReason({ statuses: [200], title: 'x', headings: ['Verify you are human: step 1'], probe: PAGE }), /bot check/);
  assert.match(wallReason({ statuses: [200], title: 'Just a moment...', headings: [], probe: PAGE }), /bot check/);
});

test('a short page whose body says it is a bot check or a consent page is a wall (B5)', () => {
  const short = (sample) => ({ statuses: [200], title: 'Welcome', headings: [], probe: { textLength: sample.length, sample, controls: 1, consentCover: false } });
  assert.match(wallReason(short('Checking if the site connection is secure. Verify you are human.')), /short page/);
  assert.match(wallReason(short('We value your privacy. Accept cookies to continue.')), /short page/);
});

test('an empty page is a wall: no text and no control (B5)', () => {
  assert.match(wallReason({ statuses: [200], title: 'x', probe: { textLength: 0, sample: '', controls: 0, consentCover: false } }), /no text and no control/);
  assert.equal(wallReason({ statuses: [200], title: 'x', probe: { textLength: 0, sample: '', controls: 2, consentCover: false } }), null);
});

test('a consent notice over half the view is a wall on a long page too (B5)', () => {
  assert.match(wallReason({ statuses: [200], title: 'x', probe: { ...PAGE, consentCover: true } }), /consent notice/);
});

test('a challenge frame is a wall (Turnstile, hCaptcha, reCAPTCHA) (B5)', () => {
  assert.match(wallReason({ statuses: [200], title: 'x', probe: PAGE, frameUrls: ['about:blank', 'https://challenges.cloudflare.com/cdn-cgi/x'] }), /challenge frame.*challenges\.cloudflare\.com/);
});

test('a redirect to a sign-in address is a wall, one that was asked for is not (B5)', () => {
  const base = { statuses: [200], title: 'x', probe: PAGE };
  assert.match(wallReason({ ...base, requestedUrl: 'https://a.test/account', finalUrl: 'https://a.test/login?next=/account' }), /sign-in/);
  assert.equal(wallReason({ ...base, requestedUrl: 'https://a.test/login', finalUrl: 'https://a.test/login' }), null);
  assert.equal(wallReason({ ...base, requestedUrl: 'http://a.test/', finalUrl: 'https://a.test/en/' }), null);
});
