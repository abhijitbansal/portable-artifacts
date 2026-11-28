// What a row binds and where a step stands: the hash covers the control's address and form, page identity keeps hash routes, a signed-in
// goto names a scouted page only by an address scout was given, and the refusals around a password field. Pure, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRows } from '../scripts/lib/plan-rows.mjs';
import { control, page, link, scoutOf, specOf, loginScout, loginSpec } from './fixtures/plan-scouts.mjs';

const ORIGIN = 'http://127.0.0.1:4001';
const messages = (result) => result.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
const only = (result) => { assert.deepEqual(result.errors, [], messages(result)); return result.rows; };
const hashOf = (spec, scout) => { const r = planRows(spec, scout); assert.deepEqual(r.errors, [], messages(r)); return r.hash; };

// ---- the hash binds what the control does (F5, T4) ----

test('the hash changes when the scouted href, the form action, the form method or the name behind a css target changes', () => {
  const click = (target) => specOf([{ id: 'go', do: 'click', target }]);
  const linkAt = (href) => scoutOf([page({ controls: [link('Continue', href)] })]);
  assert.notEqual(hashOf(click({ role: 'link', name: 'Continue' }), linkAt('/docs')), hashOf(click({ role: 'link', name: 'Continue' }), linkAt('/elsewhere')), 'href');
  const buttonWith = (over) => scoutOf([page({ controls: [control({ name: 'Go', submits: true, formAction: `${ORIGIN}/search`, formMethod: 'get', ...over })] })]);
  const goButton = click({ role: 'button', name: 'Go' });
  const reference = hashOf(goButton, buttonWith({}));
  assert.notEqual(reference, hashOf(goButton, buttonWith({ formAction: `${ORIGIN}/find` })), 'form action');
  assert.notEqual(reference, hashOf(goButton, buttonWith({ formMethod: 'post' })), 'form method');
  const byCss = click({ css: 'html > body:nth-of-type(1) > button:nth-of-type(1)' });
  assert.notEqual(hashOf(byCss, scoutOf([page({ controls: [control({ name: 'Save draft' })] })])), hashOf(byCss, scoutOf([page({ controls: [control({ name: 'Save' })] })])), 'name behind a css target');
  assert.equal(hashOf(goButton, buttonWith({})), reference, 'control: the same scout gives the same hash');
});

test('the hash changes when a typed value changes', () => {
  const scout = scoutOf([page({ controls: [control({ role: 'textbox', name: 'Find', kind: 'field' })] })]);
  const typed = (value) => specOf([{ id: 't', do: 'type', target: { role: 'textbox', name: 'Find' }, value }]);
  assert.notEqual(hashOf(typed('tent'), scout), hashOf(typed('tents'), scout));
});

test('a row carries the control it resolved: id, kind, address and form', () => {
  const scout = scoutOf([page({ controls: [control({ id: 'c7', name: 'Go', submits: true, formAction: `${ORIGIN}/search`, formMethod: 'get' }), link('Docs', '/docs')] })]);
  const rows = only(planRows(specOf([{ id: 'a', do: 'hover', target: { role: 'button', name: 'Go' } }, { id: 'b', do: 'hover', target: { role: 'link', name: 'Docs' } }]), scout));
  assert.equal(rows[1].target.id, 'c7');
  assert.deepEqual(rows[1].control, { kind: 'button', href: null, formAction: `${ORIGIN}/search`, formMethod: 'get' });
  assert.equal(rows[2].control.href, `${ORIGIN}/docs`);
  assert.equal(rows[0].control, null, 'a goto holds no control');
  assert.equal(rows[0].address, `${ORIGIN}/`, 'a goto holds the whole address, resolved');
});

test('the hash ignores look, opening and ending, and binds brand', () => {
  const scout = scoutOf([page({ controls: [control({ role: 'textbox', name: 'Find', kind: 'field' })] })]);
  const base = specOf([{ id: 't', do: 'type', target: { role: 'textbox', name: 'Find' }, value: 'tent' }], { brand: { name: 'Harbor', accent: '#1f6feb' } });
  const reference = hashOf(base, scout);
  assert.equal(hashOf({ ...base, look: 'desk' }, scout), reference, 'look');
  assert.equal(hashOf({ ...base, opening: { hook: 'A hook', facts: [{ text: 'A fact', from: 'user' }] } }, scout), reference, 'opening');
  assert.equal(hashOf({ ...base, ending: { ask: 'Try it' } }, scout), reference, 'ending');
  assert.equal(hashOf({ ...base, look: 'desk', opening: { hook: 'Other' }, ending: { ask: 'Other' } }, scout), reference, 'all three together');
  assert.notEqual(hashOf({ ...base, brand: { name: 'Harbor', accent: '#1f6fec' } }, scout), reference, 'brand accent');
  assert.notEqual(hashOf({ ...base, brand: { name: 'Other', accent: '#1f6feb' } }, scout), reference, 'brand name');
  const { brand, ...unbranded } = base;
  assert.notEqual(hashOf(unbranded, scout), reference, 'brand present or not');
});

// ---- page identity (F6, F17, F18) ----

const hashRoutes = () => scoutOf([page({ controls: [link('Settings', '/#/settings'), control({ name: 'Save', css: 'save' })] })]);

test('signed out, a hash route is a page of its own: a click on a link to one that was not scouted leaves the screen unknown', () => {
  const steps = [{ id: 'a', do: 'click', target: { role: 'link', name: 'Settings' } }, { id: 'b', do: 'hover', target: { role: 'button', name: 'Save' } }];
  assert.match(messages(planRows(specOf(steps), hashRoutes())), /not seen yet: use intent/);
  const scouted = hashRoutes();
  scouted.pages.push(page({ id: 'p2', url: `${ORIGIN}/#/settings`, controls: [control({ name: 'Save', css: 'save2' })] }));
  const rows = only(planRows(specOf(steps), scouted));
  assert.equal(rows[2].pageId, 'p2', 'the route that was scouted is where the next step reads');
});

test('signed out, goto of a hash route not scouted is not the scouted page, and a plain fragment still is', () => {
  const unseen = planRows(specOf([{ id: 'g', do: 'goto', value: '/#/admin' }, { id: 'h', do: 'hover', target: { role: 'button', name: 'Save' } }]), hashRoutes());
  assert.match(messages(unseen), /not seen yet/);
  assert.equal(only(planRows(specOf([{ id: 'g', do: 'goto', value: '/#top' }]), hashRoutes()))[1].pageId, 'p1');
});

test('signed in, goto names a scouted page only by the start address or a named one, never by a masked path', () => {
  const rows = only(planRows(loginSpec(), loginScout()));
  assert.equal(rows[0].pageId, 'p1');
  const at = (value) => only(planRows({ ...loginSpec(), useCases: [{ id: 'uc', title: 'T', steps: [{ id: 'open', do: 'goto', value }] }] }, loginScout()))[0];
  assert.equal(at('/login/summary').pageId, 'p2', 'a named page');
  assert.equal(at('/login/home?tab=admin').pageId, null, 'another query is another address');
  assert.equal(at('/login/card/222222').pageId, null, 'never by what the masked path of a scouted page looks like');
});

test('signed in, a start page that redirected still answers for goto of the start address', () => {
  const scout = loginScout();
  scout.pages[0].url = `${ORIGIN}/dashboard`;
  const rows = only(planRows({ ...loginSpec(), useCases: [{ id: 'uc', title: 'T', steps: [{ id: 'open', do: 'goto', value: '/login/home' }, { id: 'n', do: 'hover', target: { role: 'link', name: 'Next' } }] }] }, scout));
  assert.equal(rows[0].pageId, 'p1');
  assert.equal(rows[1].pageId, 'p1');
});

test('signed in, a click on a link makes the next screen known only for one match and an address that lost nothing to masking', () => {
  const next = (scout) => planRows({ ...loginSpec(), useCases: [{ id: 'uc', title: 'T', steps: [{ id: 'open', do: 'goto', value: '/login/home' }, { id: 'c', do: 'click', target: { css: 's4' } }, { id: 'h', do: 'hover', target: { role: 'link', name: 'Back' } }] }] }, scout);
  assert.deepEqual(next(loginScout()).errors, [], 'control: an exact, uncut link to one scouted page moves there');
  const cut = loginScout();
  cut.pages[0].controls[3].hrefCut = true;
  assert.match(messages(next(cut)), /not seen yet/, 'the stored address lost an id, a query or a hash');
  const unknown = loginScout();
  delete unknown.pages[0].controls[3].hrefCut;
  assert.match(messages(next(unknown)), /not seen yet/, 'when it cannot be known it is unknown');
  const twice = loginScout();
  twice.pages.push({ ...twice.pages[1], id: 'p3', fromEntry: undefined });
  assert.match(messages(next(twice)), /not seen yet/, 'two pages match');
});

// ---- a password field takes no value, whatever the verb (F2b) ----

test('type, select and press on a password field are errors that point at session.mjs', () => {
  const scout = scoutOf([page({ controls: [control({ role: 'textbox', name: 'Password', kind: 'password', css: 'pw' })] })]);
  for (const step of [{ do: 'type', value: 'x' }, { do: 'select', value: 'x' }, { do: 'press', value: 'Tab' }]) {
    const result = planRows(specOf([{ id: 'pw', target: { role: 'textbox', name: 'Password' }, ...step }]), scout);
    assert.equal(result.errors.length, 1, step.do);
    assert.match(result.errors[0].message, /password/);
    assert.match(result.errors[0].message, /session\.mjs/);
  }
  assert.deepEqual(planRows(specOf([{ id: 'pw', do: 'hover', target: { role: 'textbox', name: 'Password' } }]), scout).errors, [], 'control: hover is allowed');
});

// ---- mask is bound by the hash, and a scout made for another mask is stale ----

test('adding, changing or removing a mask entry changes the hash (mask is not a word field)', () => {
  const scoutFor = (mask) => scoutOf([page({ controls: [control({ name: 'Go' })] })], { mask });
  const specFor = (mask) => specOf([{ id: 'go', do: 'hover', target: { role: 'button', name: 'Go' } }], mask === undefined ? {} : { mask });
  const none = hashOf(specFor(undefined), scoutFor([]));
  const one = hashOf(specFor([{ css: '#card' }]), scoutFor([{ css: '#card' }]));
  const other = hashOf(specFor([{ css: '#card2' }]), scoutFor([{ css: '#card2' }]));
  const two = hashOf(specFor([{ css: '#card' }, { role: 'heading', name: 'Account' }]), scoutFor([{ css: '#card' }, { role: 'heading', name: 'Account' }]));
  assert.equal(new Set([none, one, other, two]).size, 4);
  assert.equal(hashOf(specFor([]), scoutFor([])), none, 'an empty mask is no mask');
});

test('a scout made for another mask is stale: run scout again', () => {
  const steps = [{ id: 'go', do: 'hover', target: { role: 'button', name: 'Go' } }];
  const scout = (mask) => scoutOf([page({ controls: [control({ name: 'Go' })] })], mask === undefined ? {} : { mask });
  const stale = [
    [specOf(steps, { mask: [{ css: '#card' }] }), scout([])],
    [specOf(steps, { mask: [{ css: '#card' }] }), scout(undefined)],
    [specOf(steps), scout([{ css: '#card' }])],
    [specOf(steps, { mask: [{ css: '#card' }] }), scout([{ css: '#other' }])],
  ];
  for (const [spec, made] of stale) {
    const result = planRows(spec, made);
    assert.match(result.errors[0]?.message ?? '', /other mask; run scout again/);
    assert.deepEqual(result.rows, []);
  }
  assert.deepEqual(planRows(specOf(steps), scout(undefined)).errors, [], 'control: no mask on either side, scout.json without the field (made before it existed)');
  assert.deepEqual(planRows(specOf(steps, { mask: [{ css: '#card' }] }), scout([{ css: '#card' }])).errors, []);
});

// ---- css in errors (F13) ----

test('an error that names a css cuts it from the left; the list of controls that match is whole', () => {
  const deep = (n) => `html > ${'div:nth-of-type(1) > '.repeat(n)}button:nth-of-type(${n})`;
  const one = deep(30);
  const missing = planRows(specOf([{ id: 'x', do: 'click', target: { css: `${one}x` } }]), scoutOf([page({ controls: [control({ css: one })] })]));
  assert.match(messages(missing), /more characters\]….*button:nth-of-type\(30\)x/, 'the end of the css is the part that is kept');
  const same = planRows(specOf([{ id: 'x', do: 'click', target: { role: 'button', name: 'Save' } }]), scoutOf([page({ controls: [control({ css: deep(20) }), control({ id: 'c2', css: deep(21) })] })]));
  assert.ok(messages(same).includes(deep(20)) && messages(same).includes(deep(21)), 'both whole, so the author can copy one');
});
