// brand.mjs: what a page's theme-color and site name become. Pure, no browser. Page values are data: a colour is a 6-digit hex or
// null, a name is escaped and cut, and the page's own cleaning is never trusted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accentOf, nameOf, proposeBrand } from '../scripts/lib/brand.mjs';
import { printDigest } from '../scripts/lib/digest-print.mjs';
import { page } from './fixtures/plan-scouts.mjs';

test('accentOf reads #rgb, #rrggbb and rgb(r, g, b) as lower-case #rrggbb', () => {
  assert.equal(accentOf('#1F6FEB'), '#1f6feb');
  assert.equal(accentOf('#abc'), '#aabbcc');
  assert.equal(accentOf('rgb(31, 111, 235)'), '#1f6feb');
  assert.equal(accentOf('rgb(31,111,235)'), '#1f6feb');
  assert.equal(accentOf('  #1f6feb  '), '#1f6feb');
});

test('accentOf gives null for a name, a hostile value, a bad length or a channel over 255', () => {
  for (const hostile of ['red', 'red; background:url(//x)', 'javascript:alert(1)', '#12345', 'rgb(300,0,0)', '#1f6feb; x', 'rgb(1,2,3) url(//x)', '#'.repeat(2000), `#${'a'.repeat(2000)}`, '', null, undefined]) {
    assert.equal(accentOf(hostile), null, String(hostile).slice(0, 40));
  }
});

test('nameOf takes the site name, else the title; empty or whitespace gives null', () => {
  assert.equal(nameOf('Harbor', 'Harbor: Projects'), 'Harbor');
  assert.equal(nameOf(null, 'Harbor: Projects'), 'Harbor: Projects');
  assert.equal(nameOf('   ', 'Harbor: Projects'), 'Harbor: Projects');
  assert.equal(nameOf(null, null), null);
  assert.equal(nameOf('  \n ', ' '), null);
});

test('nameOf writes control and bidi characters as code points and cuts to 40 characters', () => {
  const long = `Harbor\u0007 ‮${'word '.repeat(400)}`;
  const name = nameOf(long, null);
  assert.ok(name.length <= 40, `${name.length}: ${name}`);
  assert.ok(name.includes('\\u{0007}') && name.includes('\\u{202e}'), name);
  assert.ok(!/[\u0007‮]/.test(name));
  assert.ok(!/\\u?\{?[0-9a-f]*$/.test(name.replace(/\\u\{[0-9a-f]{4}\}/g, '')), 'no half escape at the cut');
});

test('nameOf cuts at a word, and collapses newlines and runs of spaces', () => {
  assert.equal(nameOf('Alpha  beta\ngamma delta epsilon zeta eta theta iota', null), 'Alpha beta gamma delta epsilon zeta eta');
  assert.equal(nameOf('x'.repeat(100), null), 'x'.repeat(40));
});

const first = (over = {}) => ({ url: 'http://h.test/', title: 'Harbor: Projects', siteName: 'Harbor', themeColor: '#1F6FEB', ...over });

test('proposeBrand: name and accent, each with the page and the source', () => {
  assert.deepEqual(proposeBrand(first(), { rights: 'own' }), {
    name: { text: 'Harbor', from: { page: 'http://h.test/', source: 'og:site_name' } },
    accent: { color: '#1f6feb', from: { page: 'http://h.test/', source: 'theme-color' } },
  });
});

test('proposeBrand falls back to the title, and gives a null part for what it did not find', () => {
  assert.deepEqual(proposeBrand(first({ siteName: null, themeColor: 'red' }), { rights: 'permitted' }), {
    name: { text: 'Harbor: Projects', from: { page: 'http://h.test/', source: 'title' } },
    accent: null,
  });
  assert.deepEqual(proposeBrand(first({ siteName: null, title: '', themeColor: null }), { rights: 'own' }), { name: null, accent: null });
});

test('proposeBrand gives null for a third party, and reads nothing of the page', () => {
  assert.equal(proposeBrand(first(), { rights: 'third-party' }), null);
});

test('the digest prints one brand line, escaped, or says none or not read', () => {
  const head = page({ url: 'http://h.test/', title: 'Harbor', headings: [{ level: 1, name: 'Projects', box: {} }] });
  const brand = { name: { text: 'Harbor', from: { page: 'http://h.test/', source: 'og:site_name' } }, accent: { color: '#1f6feb', from: { page: 'http://h.test/', source: 'theme-color' } } };
  const lines = printDigest(head, { brand }).split('\n');
  const at = lines.findIndex((l) => l.startsWith('headings'));
  assert.equal(lines[at + 1], 'brand: name "Harbor" (og:site_name), accent #1f6feb (theme-color)');
  assert.match(printDigest(head, { brand: { name: null, accent: null } }), /\nbrand: none found\n/);
  assert.match(printDigest(head, { brand: null }), /\nbrand: not read \(third-party\)\n/);
  assert.ok(!/\nbrand:/.test(printDigest(head)), 'a later page prints no brand line');
  const odd = printDigest(head, { brand: { name: { text: 'A\nB\u0007', from: { page: 'http://h.test/', source: 'title' } }, accent: null } });
  assert.equal(odd.split('\n').filter((l) => l.startsWith('brand:')).length, 1, 'a name with a newline is one line');
  assert.ok(!odd.includes('\u0007'));
});

test('proposeBrand signed in: the name passes through the mask first, and a name the mask reduced to its length is dropped', async () => {
  const { maskName } = await import('../scripts/lib/digest.mjs');
  const masked = proposeBrand(first({ siteName: 'Harbor for maria.ostrowski@example.test' }), { rights: 'own', mask: maskName });
  assert.equal(masked.name.text, 'Harbor for <email>');
  const long = proposeBrand(first({ siteName: 'x'.repeat(100), title: 'T'.repeat(100) }), { rights: 'own', mask: maskName });
  assert.equal(long.name, null, 'a long text is body text, not a name');
  assert.equal(long.accent.color, '#1f6feb', 'the colour is not text and is kept');
});
