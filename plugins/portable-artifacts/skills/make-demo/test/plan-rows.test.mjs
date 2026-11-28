// planRows and planHash: pure, from a spec and a scout.json object. Every rule and error of the click plan, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planRows, planHash, WORD_FIELDS } from '../scripts/lib/plan-rows.mjs';
import { control, page, link, scoutOf, specOf, dangerScout, dangerSpec, loginScout, loginSpec, HOSTILE_NAME } from './fixtures/plan-scouts.mjs';

const ORIGIN = 'http://127.0.0.1:4001';
const messages = (result) => result.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
const only = (result) => { assert.deepEqual(result.errors, [], messages(result)); return result.rows; };

test('a goto row names its page and is a look; rows are numbered from 1 and the hash is 12 hex characters', () => {
  const scout = scoutOf([page({ title: 'Start' })]);
  const result = planRows(specOf([{ id: 'wait', do: 'wait', value: 1 }]), scout);
  const rows = only(result);
  assert.deepEqual(rows.map((r) => r.n), [1, 2]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['address', 'box', 'control', 'do', 'effect', 'id', 'intent', 'n', 'page', 'pageId', 'reason', 'target', 'useCase', 'value', 'viaCss']);
  assert.equal(rows[0].do, 'goto');
  assert.equal(rows[0].page, `${ORIGIN}/`);
  assert.equal(rows[0].pageId, 'p1');
  assert.equal(rows[0].effect, 'look');
  assert.match(result.hash, /^[0-9a-f]{12}$/);
  assert.equal(rows[1].effect, 'look');
});

test('a target is matched by exact role and name and carries its box and its recomputed effect', () => {
  const scout = scoutOf([page({ controls: [control({ name: 'Save' }), control({ name: 'Save as', css: 'x' }), link('Docs', '/docs', { effect: 'danger', reason: 'stored value that is not trusted signed out' })] })]);
  const rows = only(planRows(specOf([{ id: 'save', do: 'click', target: { role: 'button', name: 'Save' } }, { id: 'again', do: 'goto', value: '/' }, { id: 'docs', do: 'click', target: { role: 'link', name: 'Docs' } }]), scout));
  assert.deepEqual(rows[1].target, { id: 'c1', role: 'button', name: 'Save', css: 'html > body:nth-of-type(1) > button:nth-of-type(1)' });
  assert.deepEqual(rows[1].box, { x: 32, y: 100, width: 80, height: 30 });
  assert.equal(rows[1].effect, 'change');
  assert.equal(rows[3].effect, 'look', 'signed out the effect is computed again from the name and the address');
});

test('a target by css must equal a control css', () => {
  const scout = scoutOf([page({ controls: [control({ css: 'one' }), control({ css: 'two', name: 'Other' })] })]);
  const rows = only(planRows(specOf([{ id: 'x', do: 'click', target: { css: 'two' } }, { id: 'g', do: 'goto', value: '/' }, { id: 'y', do: 'hover', target: { role: 'button', name: 'Other' } }]), scout));
  assert.equal(rows[1].target.name, 'Other');
  assert.equal(rows[1].viaCss, true);
  assert.equal(rows[3].viaCss, false);
  assert.equal(rows[0].viaCss, false);
  const bad = planRows(specOf([{ id: 'x', do: 'click', target: { css: 'three' } }]), scout);
  assert.equal(bad.errors.length, 1);
  assert.equal(bad.errors[0].path, 'useCases[0].steps[1].target');
  assert.match(bad.errors[0].message, /no control/);
});

test('a target that is not in the digest is an error with the path of the step and the text escaped', () => {
  const scout = scoutOf([page({ controls: [control()] })]);
  const result = planRows(specOf([{ id: 'x', do: 'click', target: { role: 'button', name: 'Missing​' } }]), scout);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].path, 'useCases[0].steps[1].target');
  assert.match(result.errors[0].message, /Missing\\u\{200b\}/, 'page and spec text goes through agentText');
  assert.match(result.errors[0].message, /p1/);
  assert.ok(!result.errors[0].message.includes('​'));
});

test('two controls with the same role and name: an error that lists each css', () => {
  const scout = scoutOf([page({ controls: [control({ css: 'first-css' }), control({ id: 'c2', css: 'second-css' })] })]);
  const result = planRows(specOf([{ id: 'x', do: 'click', target: { role: 'button', name: 'Save' } }]), scout);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /2 controls/);
  assert.match(result.errors[0].message, /first-css/);
  assert.match(result.errors[0].message, /second-css/);
});

test('two masked names that match each other are as ambiguous as any other two', () => {
  const scout = scoutOf([page({ fromEntry: 0, controls: [control({ name: '<email>', css: 'a-css' }), control({ id: 'c2', name: '<email>', css: 'b-css' })] })], { session: 'fixture' });
  const result = planRows(specOf([{ id: 'x', do: 'click', target: { role: 'button', name: '<email>' } }], { session: 'fixture' }), scout);
  assert.match(messages(result), /a-css/);
  assert.match(messages(result), /b-css/);
});

test('a heading is a target by role "heading" and its name', () => {
  const scout = scoutOf([page({ headings: [{ level: 1, name: 'Settings', box: { x: 1, y: 2, width: 3, height: 4 } }] })]);
  const rows = only(planRows(specOf([{ id: 'h', do: 'show', target: { role: 'heading', name: 'Settings' } }]), scout));
  assert.equal(rows[1].target.role, 'heading');
  assert.deepEqual(rows[1].box, { x: 1, y: 2, width: 3, height: 4 });
  assert.equal(rows[1].effect, 'look');
});

test('typing into a password field is refused and points at session.mjs', () => {
  const scout = scoutOf([page({ controls: [control({ role: 'textbox', name: 'Password', kind: 'password', css: 'pw' })] })]);
  const result = planRows(specOf([{ id: 'pw', do: 'type', target: { role: 'textbox', name: 'Password' }, value: 'x' }]), scout);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /password/);
  assert.match(result.errors[0].message, /session\.mjs/);
});

test('a look click on a link to a scouted page moves there; a later target is read on that page', () => {
  const scout = scoutOf([page({ controls: [link('Docs', '/docs')] }), page({ id: 'p2', url: `${ORIGIN}/docs`, controls: [control({ name: 'Copy', css: 'copy' })] })]);
  const rows = only(planRows(specOf([{ id: 'go', do: 'click', target: { role: 'link', name: 'Docs' } }, { id: 'copy', do: 'hover', target: { role: 'button', name: 'Copy' } }]), scout));
  assert.equal(rows[2].pageId, 'p2');
  assert.equal(rows[2].page, `${ORIGIN}/docs`);
});

test('a look disclosure, type, select, hover, scroll, wait and show stay on the page', () => {
  const scout = scoutOf([page({ controls: [control({ name: 'More', css: 'more', kind: 'disclosure', effect: 'look' }), control({ id: 'c2', role: 'textbox', name: 'User', css: 'user', kind: 'field' }), control({ id: 'c3', role: 'combobox', name: 'Size', css: 'size', kind: 'select' })] })]);
  const rows = only(planRows(specOf([
    { id: 'more', do: 'click', target: { role: 'button', name: 'More' } },
    { id: 'type', do: 'type', target: { role: 'textbox', name: 'User' }, value: 'maria' },
    { id: 'pick', do: 'select', target: { role: 'combobox', name: 'Size' }, value: 'L' },
    { id: 'over', do: 'hover', target: { role: 'textbox', name: 'User' } },
    { id: 'down', do: 'scroll', value: 400 },
    { id: 'rest', do: 'wait', value: 1 },
    { id: 'see', do: 'show', target: { role: 'textbox', name: 'User' } },
  ]), scout));
  assert.ok(rows.slice(1).every((r) => r.pageId === 'p1'), rows.map((r) => r.pageId).join());
  assert.equal(rows[1].effect, 'look');
  assert.equal(rows[2].effect, 'change');
  assert.equal(rows[3].effect, 'change');
});

test('a change click, a press and a link to an unscouted page make the screen unknown until the next goto', () => {
  const unscoutedLink = link('Elsewhere', '/nowhere');
  for (const first of [
    { id: 'a', do: 'click', target: { role: 'button', name: 'Save' } },
    { id: 'a', do: 'press', value: 'Tab' },
    { id: 'a', do: 'click', target: { role: 'link', name: 'Elsewhere' } },
    { id: 'a', do: 'goto', value: '/nowhere' },
  ]) {
    const scout = scoutOf([page({ controls: [control(), unscoutedLink] })]);
    const bad = planRows(specOf([first, { id: 'b', do: 'hover', target: { role: 'button', name: 'Save' } }]), scout);
    assert.equal(bad.errors.length, 1, `${first.do}: ${messages(bad)}`);
    assert.equal(bad.errors[0].path, 'useCases[0].steps[2]');
    assert.match(bad.errors[0].message, /not seen yet: use intent/);
    const healed = planRows(specOf([first, { id: 'b', do: 'goto', value: '/' }, { id: 'c', do: 'hover', target: { role: 'button', name: 'Save' } }]), scout);
    assert.deepEqual(healed.errors, [], `${first.do} then goto`);
  }
});

test('an intent row has effect change, no target and no box, says it is not seen yet, and keeps the screen unknown after a click', () => {
  const scout = scoutOf([page({ controls: [control()] })]);
  const ok = planRows(specOf([{ id: 'ask', do: 'click', intent: 'confirm the dialog' }]), scout);
  const row = only(ok)[1];
  assert.equal(row.effect, 'change');
  assert.equal(row.intent, 'confirm the dialog');
  assert.equal(row.target, null);
  assert.equal(row.box, null);
  assert.equal(row.pageId, 'p1', 'the row keeps the page its step sits on; the plan page shows an intent row as not seen yet');
  assert.match(row.reason, /not seen yet/);
  assert.match(row.reason, /cannot run/);
  const after = planRows(specOf([{ id: 'ask', do: 'click', intent: 'confirm' }, { id: 'b', do: 'hover', target: { role: 'button', name: 'Save' } }]), scout);
  assert.match(messages(after), /not seen yet: use intent/);
});

test('press: a key is a change; with a control whose name is a danger word it is danger', () => {
  const scout = scoutOf([page({ controls: [control({ name: 'Delete', css: 'del' })] })]);
  const rows = only(planRows(specOf([{ id: 'k', do: 'press', value: 'Tab' }, { id: 'g', do: 'goto', value: '/' }, { id: 'd', do: 'press', value: 'Enter', target: { css: 'del' } }]), scout));
  assert.equal(rows[1].effect, 'change');
  assert.equal(rows[3].effect, 'danger');
});

test('danger comes from the classifier: a danger word in the name, the address or the form action', () => {
  const rows = only(planRows(dangerSpec(), dangerScout()));
  assert.deepEqual(rows.map((r) => r.effect), ['look', 'look', 'danger', 'look', 'danger', 'change', 'change']);
  assert.match(rows[2].reason, /archive/);
});

test('a target on a wall page is an error that names the wall', () => {
  const scout = scoutOf([page(), page({ id: 'p2', url: `${ORIGIN}/wall`, wall: 'status 403​', controls: [] })]);
  const result = planRows(specOf([{ id: 'w', do: 'goto', value: '/wall' }, { id: 'x', do: 'click', target: { role: 'button', name: 'Save' } }]), scout);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /p2/);
  assert.match(result.errors[0].message, /status 403\\u\{200b\}/);
});

test('a first page that is a wall is an error', () => {
  const scout = scoutOf([page({ wall: 'status 403', controls: [] })]);
  const result = planRows(specOf([]), scout);
  assert.ok(result.errors.some((e) => /wall/.test(e.message)), messages(result));
});

test('a scout made for another url, origins, session, named pages or version is stale: run scout again', () => {
  const good = scoutOf([page()]);
  const stale = [
    [specOf([], { source: { url: `${ORIGIN}/other` } }), good],
    [specOf([], { origins: [ORIGIN, 'http://127.0.0.1:4002'] }), good],
    [specOf([], { session: 'work' }), good],
    [specOf([], { pages: [`${ORIGIN}/more`] }), good],
    [specOf([]), { ...good, version: 2 }],
    [specOf([]), { ...good, session: 'work' }],
  ];
  for (const [spec, scout] of stale) {
    const result = planRows(spec, scout);
    assert.equal(result.errors.length > 0, true);
    assert.match(result.errors[0].message, /run scout again/);
    assert.deepEqual(result.rows, []);
  }
  assert.deepEqual(planRows(specOf([]), good).errors, []);
});

test('signed in, a click takes the stored effect: a harmless masked name with a stored danger stays danger', () => {
  const scout = scoutOf([page({ fromEntry: 0, controls: [control({ name: '<key>', css: 'k', effect: 'danger', reason: 'the name holds the danger word "delete"' }), control({ id: 'c2', name: 'Delete', css: 'd', effect: 'look', reason: 'stored' })] })], { session: 'fixture' });
  const rows = only(planRows(specOf([{ id: 'a', do: 'click', target: { css: 'k' } }, { id: 'g', do: 'goto', value: '/' }, { id: 'b', do: 'click', target: { css: 'd' } }], { session: 'fixture' }), scout));
  assert.equal(rows[1].effect, 'danger');
  assert.equal(rows[3].effect, 'look', 'the stored click effect is used for click, signed in');
});

test('signed in, press is the stricter of the stored and the recomputed effect; a stored danger click makes the press danger', () => {
  const scout = scoutOf([page({ fromEntry: 0, controls: [control({ name: '<key>', css: 'k', effect: 'danger', reason: 'the name holds the danger word "delete"' }), control({ id: 'c2', name: 'Next', css: 'n', effect: 'look', reason: 'stored' })] })], { session: 'fixture' });
  const rows = only(planRows(specOf([{ id: 'a', do: 'press', value: 'Enter', target: { css: 'k' } }, { id: 'g', do: 'goto', value: '/' }, { id: 'b', do: 'press', value: 'Enter', target: { css: 'n' } }], { session: 'fixture' }), scout));
  assert.equal(rows[1].effect, 'danger');
  assert.equal(rows[3].effect, 'change', 'recomputed change beats a stored look');
});

test('signed in, a look link click is matched to a scouted page by its masked address; no exact match leaves the screen unknown', () => {
  const rows = only(planRows(loginSpec(), loginScout()));
  assert.deepEqual(rows.map((r) => r.pageId), ['p1', 'p1', 'p1', 'p1', 'p2', 'p1'], 'a row sits on the page its step happens on; the goto row on the page it opens');
  assert.equal(rows[1].effect, 'danger');
  const noMatch = planRows(specOf([], { session: 'fixture', pages: ['/login/summary'], source: { url: `${ORIGIN}/login/home` }, useCases: [{ id: 'uc', title: 'T', steps: [{ id: 'open', do: 'goto', value: '/login/home' }, { id: 'c', do: 'click', target: { css: 's2' } }, { id: 'x', do: 'hover', target: { role: 'link', name: 'Back' } }] }] }), loginScout());
  assert.match(messages(noMatch), /not seen yet: use intent/, 'the card link points at a masked address no page has');
});

test('signed in, goto finds a scouted page by its masked address', () => {
  const rows = only(planRows(loginSpec(), loginScout()));
  assert.equal(rows[0].pageId, 'p1');
  assert.equal(rows[0].page, `${ORIGIN}/login/home`);
});

test('hostile names are rows like any other: the target is kept as scout saw it', () => {
  const scout = scoutOf([page({ controls: [control({ name: HOSTILE_NAME, css: 'h' })] })]);
  const rows = only(planRows(specOf([{ id: 'x', do: 'click', target: { css: 'h' } }]), scout));
  assert.equal(rows[1].target.name, HOSTILE_NAME);
});

test('a page that left controls out past the cap is a warning when a step reads it', () => {
  const scout = scoutOf([page({ controls: [control()], left: 12 })]);
  const result = planRows(specOf([{ id: 'x', do: 'click', target: { role: 'button', name: 'Save' } }]), scout);
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings[0].message, /12/);
});

// ---- the hash ------------------------------------------------------------------------------------------------------------

const hashOf = (spec, scout = scoutOf([page({ controls: [control({ name: 'Save', css: 'save' }), control({ id: 'c2', name: 'Other', css: 'other' })] })])) => {
  const result = planRows(spec, scout);
  assert.deepEqual(result.errors, [], messages(result));
  return result.hash;
};
const base = () => specOf([{ id: 'save', do: 'click', target: { role: 'button', name: 'Save' } }], { session: undefined, viewport: { width: 1280, height: 720 }, generatedBy: { model: 'm' } });

test('the hash changes when a target, a value, origins, rights, viewport, pages or an unheard-of root field changes', () => {
  const reference = hashOf(base());
  const variants = {
    target: (s) => { s.useCases[0].steps[1].target = { role: 'button', name: 'Other' }; },
    value: (s) => { s.useCases[0].steps.push({ id: 'w', do: 'wait', value: 1 }); },
    rights: (s) => { s.rights = 'permitted'; },
    viewport: (s) => { s.viewport = { width: 1024, height: 720 }; },
    origins: (s) => { s.origins = [ORIGIN]; s.origins.push('http://127.0.0.1:4009'); },
    newRoot: (s) => { s.somethingNew = 1; },
    stepId: (s) => { s.useCases[0].steps[1].id = 'save-it'; },
  };
  const seen = new Set([reference]);
  for (const [name, change] of Object.entries(variants)) {
    const spec = base();
    change(spec);
    const scout = name === 'origins' ? scoutOf([page({ controls: [control({ name: 'Save', css: 'save' }), control({ id: 'c2', name: 'Other', css: 'other' })] })], { origins: [ORIGIN, 'http://127.0.0.1:4009'] }) : undefined;
    const hash = name === 'newRoot' ? planRows(spec, scoutOf([page({ controls: [control({ name: 'Save', css: 'save' })] })])).hash : hashOf(spec, scout);
    assert.ok(!seen.has(hash), `${name} must change the hash`);
    seen.add(hash);
  }
});

test('the hash changes with the pages named and the session', () => {
  const reference = planRows(base(), scoutOf([page({ controls: [control({ name: 'Save', css: 'save' })] })])).hash;
  const named = planRows({ ...base(), pages: [`${ORIGIN}/more`] }, scoutOf([page({ controls: [control({ name: 'Save', css: 'save' })] })], { named: [`${ORIGIN}/more`] })).hash;
  const session = planRows({ ...base(), session: 'work' }, scoutOf([page({ controls: [control({ name: 'Save', css: 'save' })] })], { session: 'work' })).hash;
  assert.equal(new Set([reference, named, session]).size, 3);
});

test('the hash changes when a row effect or a page address changes, and not for title, goal, generatedBy or key order', () => {
  const spec = base();
  const rows = planRows(spec, scoutOf([page({ controls: [control({ name: 'Save', css: 'save' })] })])).rows;
  const reference = planHash(spec, rows);
  assert.notEqual(planHash(spec, rows.map((r, i) => (i === 1 ? { ...r, effect: 'danger' } : r))), reference);
  assert.notEqual(planHash(spec, rows.map((r, i) => (i === 1 ? { ...r, page: `${ORIGIN}/else` } : r))), reference);
  const words = structuredClone(spec);
  words.useCases[0].title = 'A different title';
  words.useCases[0].goal = 'A different goal';
  words.generatedBy = { model: 'another', effort: 'low' };
  assert.equal(planHash(words, rows), reference);
  const shuffled = Object.fromEntries(Object.entries(spec).reverse());
  shuffled.useCases = [Object.fromEntries(Object.entries(spec.useCases[0]).reverse())];
  shuffled.useCases[0].steps = spec.useCases[0].steps.map((s) => Object.fromEntries(Object.entries(s).reverse()));
  assert.equal(planHash(shuffled, rows), reference);
  assert.deepEqual(WORD_FIELDS, ['generatedBy', 'useCases[].title', 'useCases[].goal', 'look', 'opening', 'ending']);
});
