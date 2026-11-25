import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, dangerWord, isFollowable } from '../scripts/lib/effects.mjs';

const PAGE = 'https://s.test/app/';
const ORIGINS = ['https://s.test'];
const abs = (href) => (href === null ? null : new URL(href, PAGE).href);

const base = { href: null, newTab: false, download: false, submits: false, formAction: null, formMethod: null, scripted: false };
const link = (name, href) => ({ ...base, role: 'link', name, kind: 'link', href: abs(href) });
const button = (name) => ({ ...base, role: 'button', name, kind: 'button' });
const disclosure = (name) => ({ ...base, role: 'button', name, kind: 'disclosure' });
const field = (name) => ({ ...base, role: 'textbox', name, kind: 'field' });

const TABLE = [
  ['click', link('Docs', '/docs'), 'en', 'look'],
  ['click', link('Archive item 1', '/item/1/delete'), 'en', 'danger'], // address alone
  ['click', link('Bye', '/signOut'), 'en', 'danger'],
  ['click', link('Bye', '#/logout'), 'en', 'danger'],
  ['click', link('Abmelden', '/abmelden'), 'de', 'change'],
  ['click', link('Docs', '/docs'), null, 'change'], // no lang is unknown
  ['click', link('Elsewhere', 'https://other.test/'), 'en', 'change'],
  ['click', { ...link('Rails', '/x'), scripted: true }, 'en', 'change'],
  ['click', { ...link('Get', '/x'), newTab: true }, 'en', 'change'],
  ['click', { ...link('Get', '/x'), download: true }, 'en', 'change'],
  ['click', button('Filter'), 'en', 'change'],
  ['click', disclosure('Menu'), 'en', 'look'],
  ['click', { ...disclosure('Menu'), submits: true }, 'en', 'change'],
  ['click', { ...disclosure('Menu'), scripted: true }, 'en', 'change'],
  ['click', { ...disclosure('Menu'), href: abs('/menu') }, 'en', 'change'],
  ['click', disclosure('Delete…'), 'en', 'danger'],
  ['click', { ...button(''), formAction: 'https://s.test/pay' }, 'en', 'danger'],
  ['click', null, 'en', 'change'], // intent only: nothing known about it
  ['type', field('Search'), 'en', 'change'],
  ['select', field('Plan'), 'en', 'change'],
  ['press', field('Search'), 'en', 'change'],
  ['press', button('Send'), 'en', 'danger'],
  ['hover', button('Delete'), 'en', 'look'],
  ['scroll', null, 'en', 'look'],
  ['wait', null, 'en', 'look'],
  ['show', null, 'en', 'look'],
  ['goto', null, 'en', 'look', '/docs'],
  ['goto', null, 'en', 'look', 'https://s.test/docs?x=1'],
  ['goto', null, 'en', 'danger', '/account/close'],
  ['goto', null, 'en', 'change', 'https://other.test/'],
];

for (const [verb, control, lang, expected, value] of TABLE) {
  const label = `${verb} ${control ? JSON.stringify(control.name) : 'nothing'}${value ? ` ${value}` : ''} lang=${lang}`;
  test(`classify: ${label} is ${expected}`, () => {
    const got = classify({ do: verb, control, value, pageUrl: PAGE, origins: ORIGINS, lang });
    assert.equal(got.effect, expected, got.reason);
    assert.equal(typeof got.reason, 'string');
    assert.ok(got.reason.length > 0);
  });
}

const WRITES_ON_GET = [
  ['Cancel order', '/orders/5/cancel'], ['Add to cart', '/?add-to-cart=12'], ['Add to basket', '/basket/12'], ['Add to bag', '/b/12'], ['Approve', '/x/approve'], ['Reject', '/x/reject'], ['Confirm', '/confirm?id=1'],
  ['Clear history', '/history'], ['Unfollow', '/u/1'], ['Vote', '/poll/1'], ['Uninstall', '/apps/1'], ['Disconnect', '/net'], ['Unlink', '/acct-link'],
  ['Purge', '/cache'], ['Wipe', '/data'], ['Renew', '/plan'], ['Order now', '/o'], ['Leave team', '/team'], ['Sign me out', '/bye'], ['Log me out', '/session/end'],
  ['Payments', '/p'], ['Next', '/accounts'], ['Next', '/deleted'], ['Next', '/invites'], ['Signing out', '/s'], ['Deleting', '/s'], ['Removed', '/s'],
  ['Next', '/?action=Sign%20out'], ['Next', '/?do=log%20out'], ['Next', '/a%2Flogout'], ['Next', '/?x=add-to-cart'],
];
for (const [name, href] of WRITES_ON_GET) {
  test(`a plain English link ${JSON.stringify(name)} to ${href} is danger`, () => {
    const got = classify({ do: 'click', control: link(name, href), pageUrl: PAGE, origins: ORIGINS, lang: 'en' });
    assert.equal(got.effect, 'danger', got.reason);
  });
}

test('dangerWord decodes percent-escapes and leaves a malformed one as it is', () => {
  assert.equal(dangerWord('/x%zz/delete'), 'delete');
  assert.equal(dangerWord('100%'), null);
  assert.equal(dangerWord('/a%2Flogout'), 'logout');
  assert.equal(dangerWord('?action=Sign%20out'), 'sign out');
});

test('dangerWord matches plural, -ed and -ing forms and not look-alike words', () => {
  for (const [text, word] of [['Deleted', 'delete'], ['Deleting', 'delete'], ['Sending', 'send'], ['Invites', 'invite'], ['Transferred', 'transfer'], ['Logging out', 'log out'], ['Resets', 'reset'], ['Accounts', 'account']]) {
    assert.equal(dangerWord(text), word, text);
  }
  for (const text of ['Resender', 'Display', 'Paypal overview', 'Docs', 'Clearance', 'Leaflet', 'Voter guide', 'Approvals']) assert.equal(dangerWord(text), null, text);
});

test('an icon link with no name is a change, not a look', () => {
  const got = classify({ do: 'click', control: link('', '/zz/3'), pageUrl: PAGE, origins: ORIGINS, lang: 'en' });
  assert.equal(got.effect, 'change');
  assert.match(got.reason, /no name/);
});

test('a disclosure is a look only on an English page, like a link', () => {
  const at = (lang) => classify({ do: 'click', control: disclosure('Menu'), pageUrl: PAGE, origins: ORIGINS, lang }).effect;
  assert.equal(at('en'), 'look');
  assert.equal(at('de'), 'change');
  assert.equal(at(null), 'change');
});

test('isFollowable is false for any link with a query', () => {
  const ctx = { pageUrl: PAGE, origins: ORIGINS, lang: 'en' };
  assert.equal(isFollowable(link('Next', '/docs?page=2'), ctx), false);
  assert.equal(isFollowable(link('Next', '/app/?page=2'), ctx), false);
  assert.equal(isFollowable(link('Docs', '/docs'), ctx), true, 'control: no query is followed');
});

test('dangerWord finds whole words only', () => {
  assert.equal(dangerWord('Paypal overview'), null);
  assert.equal(dangerWord('Resender'), null);
  assert.equal(dangerWord('Display'), null);
  assert.equal(dangerWord('Delete account'), 'delete');
  assert.equal(dangerWord('signOut'), 'sign out');
  assert.equal(dangerWord('log-out'), 'log out');
  assert.equal(dangerWord('/billing/plan'), 'billing');
  assert.equal(dangerWord('Place order'), 'place order');
  assert.equal(dangerWord('Docs'), null);
});

test('isFollowable: a look link to another document on the page origin, and nothing else', () => {
  const ctx = { pageUrl: PAGE, origins: ORIGINS, lang: 'en' };
  assert.equal(isFollowable(link('Docs', '/docs'), ctx), true);
  assert.equal(isFollowable(link('Same', '/app/'), ctx), false, 'the page itself');
  assert.equal(isFollowable(link('Frag', '#top'), ctx), false, 'a fragment of the page');
  assert.equal(isFollowable(link('Out', 'https://other.test/'), ctx), false);
  assert.equal(isFollowable(link('Bye', '/logout'), ctx), false, 'danger');
  assert.equal(isFollowable(link('Docs', '/docs'), { ...ctx, lang: 'de' }), false);
  assert.equal(isFollowable(disclosure('Menu'), ctx), false, 'a look click, but not a link');
  assert.equal(isFollowable(null, ctx), false);
});
