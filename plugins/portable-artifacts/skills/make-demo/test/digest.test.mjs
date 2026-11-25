// The pure parts of a page digest: reading the accessibility tree, turning the facts of one element into a control, masking a
// signed-in digest, and the printed text. No browser here; test/scout-browser.test.mjs runs the same code on real pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkTree, controlOf, maskDigest, CONTROL_CAP } from '../scripts/lib/digest.mjs';
import { printDigest, PRINT_BYTES } from '../scripts/lib/digest-print.mjs';

const box = (x = 0, y = 0, width = 100, height = 20) => ({ x, y, width, height });
const facts = (over) => ({ tag: 'button', type: null, hrefAttr: null, href: null, newTab: false, download: false, expandable: false, submits: false, formAction: null, formMethod: null, scripted: false, css: 'html > body:nth-of-type(1)', ...over });

// ---- walkTree ----

test('walkTree reads an array root, skips bare strings, zero boxes and options without a ref, and keeps headings', () => {
  const tree = [{ role: 'generic', ref: 'e1', box: box(), children: [
    { role: 'heading', name: 'Title', level: 1, ref: 'e2', box: box(0, 0, 200, 30) },
    'a bare string',
    { role: 'link', name: 'Docs', ref: 'e3', box: box(), url: '/docs' },
    { role: 'link', name: 'Hidden', ref: 'e4', box: box(0, 0, 0, 0) },
    { role: 'combobox', ref: 'e5', box: box(), children: [{ role: 'option', name: 'One', box: box(0, 0, 0, 0) }] },
    { role: 'listbox', ref: 'e6', box: box(), children: [{ role: 'option', name: 'A', ref: 'e7', box: box() }] },
    { role: 'generic', name: 'More', ref: 'e8', box: box() },
    { role: 'generic', ref: 'e9', box: box() },
    { role: 'paragraph', name: 'ignored', ref: 'e10', box: box() },
    { role: 'button', ref: 'e11', box: box() },
  ] }];
  const { headings, candidates } = walkTree(tree);
  assert.deepEqual(headings, [{ level: 1, name: 'Title', box: box(0, 0, 200, 30) }]);
  assert.deepEqual(candidates.map((c) => c.ref), ['e3', 'e5', 'e6', 'e7', 'e8', 'e11']);
  assert.equal(candidates.find((c) => c.ref === 'e11').name, '', 'a nameless button has an empty name');
  assert.equal(candidates.find((c) => c.ref === 'e8').viaTag, true, 'a named generic is only a candidate: its tag decides');
});

test('walkTree does not descend into an iframe: the controls inside it are not listed', () => {
  const tree = [{ role: 'generic', ref: 'e1', box: box(), children: [
    { role: 'button', name: 'Outside', ref: 'e2', box: box() },
    { role: 'iframe', ref: 'e3', box: box(), children: [
      { role: 'heading', name: 'Inner heading', level: 1, ref: 'e4', box: box() },
      { role: 'button', name: 'Inside', ref: 'e5', box: box() },
    ] },
  ] }];
  const { headings, candidates } = walkTree(tree);
  assert.deepEqual(candidates.map((c) => c.name), ['Outside']);
  assert.deepEqual(headings, []);
});

test('walkTree never reads text, whatever the node holds', () => {
  const tree = [{ role: 'textbox', name: 'User', ref: 'e1', box: box(), text: 'typed-by-script-4711' }];
  assert.ok(!JSON.stringify(walkTree(tree)).includes('typed-by-script'));
});

test('walkTree moves boxes to page coordinates', () => {
  const { candidates } = walkTree([{ role: 'button', name: 'Go', ref: 'e1', box: box(10, 20, 30, 40) }], { scrollX: 5, scrollY: 100 });
  assert.deepEqual(candidates[0].box, { x: 15, y: 120, width: 30, height: 40 });
});

// ---- controlOf ----

const KINDS = [
  ['a plain link', { role: 'link', name: 'Docs' }, { tag: 'a', hrefAttr: '/docs', href: 'http://h.test/docs' }, 'link'],
  ['a link whose address is only #', { role: 'link', name: 'Top' }, { tag: 'a', hrefAttr: '#', href: 'http://h.test/#' }, 'other'],
  ['a link with an empty address', { role: 'link', name: 'Top' }, { tag: 'a', hrefAttr: '', href: 'http://h.test/' }, 'other'],
  ['a javascript: link', { role: 'link', name: 'Js' }, { tag: 'a', hrefAttr: 'javascript:void(0)', href: 'javascript:void(0)' }, 'other'],
  ['a mailto: link', { role: 'link', name: 'Mail' }, { tag: 'a', hrefAttr: 'mailto:a@b.test', href: 'mailto:a@b.test' }, 'other'],
  ['a link to #/logout', { role: 'link', name: 'Bye' }, { tag: 'a', hrefAttr: '#/logout', href: 'http://h.test/#/logout' }, 'link'],
  ['a button', { role: 'button', name: 'Go' }, {}, 'button'],
  ['a button that opens something', { role: 'button', name: 'Menu' }, { expandable: true }, 'disclosure'],
  ['a summary', { role: 'generic', name: 'More' }, { tag: 'summary' }, 'disclosure'],
  ['a tab', { role: 'tab', name: 'Tab' }, { tag: 'div' }, 'disclosure'],
  ['a text field', { role: 'textbox', name: 'User' }, { tag: 'input', type: 'text' }, 'field'],
  ['a search box', { role: 'searchbox', name: 'Find' }, { tag: 'input', type: 'search' }, 'field'],
  ['a textarea', { role: 'textbox', name: 'Note' }, { tag: 'textarea' }, 'field'],
  ['a password field', { role: 'textbox', name: 'Password' }, { tag: 'input', type: 'password' }, 'password'],
  ['a native select', { role: 'combobox', name: 'Size' }, { tag: 'select' }, 'select'],
  ['a listbox', { role: 'listbox', name: 'Size' }, { tag: 'div' }, 'select'],
  ['an option on its own', { role: 'option', name: 'A' }, { tag: 'div' }, 'other'],
  ['a checkbox', { role: 'checkbox', name: 'Agree' }, { tag: 'input', type: 'checkbox' }, 'toggle'],
  ['a switch', { role: 'switch', name: 'On' }, { tag: 'div' }, 'toggle'],
  ['a slider', { role: 'slider', name: 'Vol' }, { tag: 'input', type: 'range' }, 'field'],
  ['a menu item', { role: 'menuitem', name: 'Open' }, { tag: 'div' }, 'button'],
  ['a named generic that is only a div', { role: 'generic', name: 'Title' }, { tag: 'div' }, null],
];
for (const [label, node, over, kind] of KINDS) {
  test(`controlOf: ${label} is ${kind === null ? 'not a control' : kind}`, () => {
    const control = controlOf(node, facts(over));
    if (kind === null) assert.equal(control, null);
    else assert.equal(control.kind, kind);
  });
}

test('controlOf carries role, name, address, form and script facts, and drops what is not a control fact', () => {
  const control = controlOf({ role: 'button', name: 'Search', ref: 'e1', box: box() }, facts({ submits: true, formAction: 'http://h.test/search', formMethod: 'get', scripted: true, newTab: true, download: true, css: 'html > body:nth-of-type(1) > button:nth-of-type(2)' }));
  assert.deepEqual(control, {
    role: 'button', name: 'Search', css: 'html > body:nth-of-type(1) > button:nth-of-type(2)', box: box(), kind: 'button', href: null, newTab: true, download: true,
    submits: true, formAction: 'http://h.test/search', formMethod: 'get', scripted: true,
  });
});

test('a link gets its absolute href; a button gets none', () => {
  assert.equal(controlOf({ role: 'link', name: 'Docs', box: box() }, facts({ tag: 'a', hrefAttr: '/docs', href: 'http://h.test/docs' })).href, 'http://h.test/docs');
  assert.equal(controlOf({ role: 'button', name: 'Go', box: box() }, facts({ href: 'http://h.test/x' })).href, null);
});

// ---- maskDigest ----

const page = (over = {}) => ({
  id: 'p1', url: 'http://h.test/u/83920114/home?token=abc#frag', lang: 'en', title: 'Hi maria.ostrowski@example.test', wall: null, video: false, shot: null, frames: [],
  headings: [{ level: 2, name: 'Signed in as maria.ostrowski@example.test', box: box() }],
  controls: [
    { id: 'c1', role: 'button', name: 'Switch to maria.ostrowski@example.test', css: 'html', box: box(), kind: 'button', href: null, newTab: false, download: false, submits: false, formAction: null, formMethod: null, scripted: false, effect: 'change', reason: 'x' },
    { id: 'c2', role: 'link', name: 'Card 4111 1111 1111 1111', css: 'html', box: box(), kind: 'link', href: 'http://h.test/card/4111111111111111?holder=Maria+Ostrowski#x', newTab: false, download: false, submits: false, formAction: 'http://h.test/pay/key_demo_7f3a91c2d85e40b6a1f9?q=1', formMethod: 'post', scripted: false, effect: 'change', reason: 'x' },
  ],
  left: 0, requests: [], dialogs: 0, popups: 0, refused: [], errors: 0, ...over,
});

test('maskDigest masks names, headings and the title, and cuts addresses to origin and masked path', () => {
  const masked = maskDigest(page());
  const text = JSON.stringify(masked);
  assert.equal(masked.title, 'Hi <email>');
  assert.equal(masked.headings[0].name, 'Signed in as <email>');
  assert.equal(masked.controls[0].name, 'Switch to <email>');
  assert.equal(masked.controls[1].name, 'Card <number>');
  assert.equal(masked.url, 'http://h.test/u/<id>/home');
  assert.equal(masked.controls[1].href, 'http://h.test/card/<id>');
  assert.equal(masked.controls[1].formAction, 'http://h.test/pay/<id>');
  for (const leak of ['maria.ostrowski', '4111', 'key_demo', 'token=abc', 'Maria+Ostrowski', 'frag']) assert.ok(!text.includes(leak), leak);
});

test('a name or heading over 60 characters (after masking) is only its length: a card that is one link holds body text', () => {
  const body = 'Maria Ostrowski paid the invoice for the spring order and the card ends 1111';
  const exactly60 = 'a'.repeat(60);
  const masked = maskDigest(page({
    headings: [{ level: 2, name: body, box: box() }, { level: 2, name: exactly60, box: box() }],
    controls: [{ ...page().controls[0], name: body }, { ...page().controls[0], name: 'Mail maria.ostrowski@example.test and a note that runs on and on and on and on and on and on' }],
  }));
  assert.equal(masked.headings[0].name, `<text ${body.length}>`);
  assert.equal(masked.headings[1].name, exactly60, 'sixty is allowed');
  assert.equal(masked.controls[0].name, `<text ${body.length}>`);
  assert.match(masked.controls[1].name, /^<text \d+>$/);
  assert.ok(!JSON.stringify(masked).includes('Ostrowski'));
});

test('maskDigest returns a new object and leaves its input as it was', () => {
  const input = page();
  const before = JSON.stringify(input);
  assert.notEqual(maskDigest(input), input);
  assert.equal(JSON.stringify(input), before);
});

// ---- printDigest ----

const many = (n, name = (i) => `Link number ${i} with a fairly long name to fill the line`) => Array.from({ length: n }, (_, i) => ({
  id: `c${i + 1}`, role: 'link', name: name(i + 1), css: 'html', box: box(), kind: 'link', href: `http://h.test/#link-${i + 1}`, newTab: false, download: false, submits: false,
  formAction: null, formMethod: null, scripted: false, effect: 'look', reason: 'a plain link',
}));

test('a page of 400 controls with 2,600 more left out prints at most 6,144 bytes and says how many were left', () => {
  const text = printDigest(page({ url: 'http://h.test/many', title: 'Many', headings: [], controls: many(CONTROL_CAP), left: 2600 }));
  assert.ok(Buffer.byteLength(text) <= 6144, `${Buffer.byteLength(text)} bytes`);
  assert.equal(PRINT_BYTES, 6144);
  assert.match(text, /left 2600/);
  assert.match(text, /\d+ more controls? (are )?not shown/);
});

test('a short page prints every control, one per line, with its effect, and shows no "not shown" line', () => {
  const text = printDigest(page({ controls: many(3), headings: [], left: 0 }));
  assert.equal(text.split('\n').filter((l) => /^ *c\d+ /.test(l)).length, 3);
  assert.ok(!/not shown/.test(text));
  assert.match(text, /left 0/);
});

test('names with invisible characters, newlines and Markdown are printed escaped on one line', () => {
  const hostile = [{ ...many(1)[0], name: 'Line one\nLine two `tick` | pipe [a](http://x.test) TODO: x​‮' }];
  const text = printDigest(page({ controls: hostile, headings: [] }));
  assert.ok(!text.includes('​') && !text.includes('‮'));
  assert.match(text, /\\u\{200b\}/);
  assert.match(text, /\\u\{000a\}/);
  assert.equal(text.split('\n').filter((l) => /Line one/.test(l)).length, 1);
});

const lineOf = (text, id) => text.split('\n').find((l) => new RegExp(`^ *${id} `).test(l));
const ctl = (id, role, kind, name, extra = {}) => ({ ...many(1)[0], id, role, kind, name, href: null, css: `css-of-${id}`, effect: 'change', reason: 'x', ...extra });

test('a control is printed with its role, so a target can be written from the print; kind stays only for disclosure and password', () => {
  const text = printDigest(page({ headings: [], controls: [
    ctl('c1', 'textbox', 'field', 'User'),
    ctl('c2', 'button', 'disclosure', 'More options', { effect: 'look' }),
    ctl('c3', 'textbox', 'password', 'Password'),
    ctl('c4', 'link', 'link', 'Docs', { href: 'http://h.test/docs', effect: 'look' }),
    ctl('c5', 'combobox', 'select', 'Size'),
  ] }));
  assert.match(lineOf(text, 'c1'), /^ *c1 textbox "User"/);
  assert.match(lineOf(text, 'c2'), /^ *c2 button "More options" \(disclosure\)/);
  assert.match(lineOf(text, 'c3'), /^ *c3 textbox "Password" \(password\)/);
  assert.match(lineOf(text, 'c4'), /^ *c4 link "Docs"/);
  assert.match(lineOf(text, 'c5'), /^ *c5 combobox "Size"/);
  assert.ok(!/field|select/.test(`${lineOf(text, 'c1')}${lineOf(text, 'c5')}`));
});

test('css is printed only where role and name cannot name the control: an empty name, a pair that is not unique, a name that was cut or escaped', () => {
  const long = 'a'.repeat(70);
  const text = printDigest(page({ headings: [], controls: [
    ctl('c1', 'button', 'button', ''),
    ctl('c2', 'button', 'button', 'Save'),
    ctl('c3', 'button', 'button', 'Save'),
    ctl('c4', 'button', 'button', long),
    ctl('c5', 'button', 'button', 'Line one\nLine two'),
    ctl('c6', 'link', 'link', 'Save'),
    ctl('c7', 'button', 'button', 'Unique'),
  ] }));
  for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) assert.ok(lineOf(text, id).includes(` css=css-of-${id}`), `${id}: ${lineOf(text, id)}`);
  for (const id of ['c6', 'c7']) assert.ok(!lineOf(text, id).includes('css='), `${id}: ${lineOf(text, id)}`);
});

test('headings are printed without css, and a long css is printed whole', () => {
  const deep = `html > ${'div:nth-of-type(1) > '.repeat(12)}button:nth-of-type(1)`;
  const text = printDigest(page({ headings: [{ level: 1, name: 'Title', box: box() }], controls: [ctl('c1', 'button', 'button', '', { css: deep })] }));
  assert.ok(!/h1 "Title".*css=/.test(text));
  assert.ok(lineOf(text, 'c1').includes(`css=${deep}`));
});

test('printDigest prints the wall note, the video flag and what the page did on its own, as counts and masked paths', () => {
  const text = printDigest(page({ wall: 'a consent notice covers half the view', video: true, dialogs: 1, popups: 2, errors: 3, sockets: 1, refused: [{ method: 'GET', origin: 'http://other.test', path: '/foreign/' }, { method: 'POST', origin: 'http://h.test', path: '/pay' }], requests: [{ method: 'POST', origin: 'http://h.test', path: '/scout/track', count: 2 }] }));
  assert.match(text, /a consent notice covers half the view/);
  assert.match(text, /video: playing/);
  assert.match(text, /POST http:\/\/h\.test\/scout\/track x2/);
  assert.match(text, /dialogs 1/);
  assert.match(text, /popups 2/);
  assert.match(text, /errors 3/);
  assert.match(text, /sockets 1/);
  assert.match(text, /refused move: left to http:\/\/other\.test \(GET \/foreign\/\)/);
  assert.match(text, /refused move: POST http:\/\/h\.test\/pay \(not a GET\)/);
});
