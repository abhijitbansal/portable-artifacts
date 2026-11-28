import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpec, validateSpec, originsOf } from '../scripts/lib/spec.mjs';
import { siblingDir, SiblingError, siblingScript } from '../scripts/lib/siblings.mjs';

const EXAMPLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../references/examples/walkthrough.demo.json');
const example = () => structuredClone(loadSpec(EXAMPLE).spec);
// The example without look, opening, ending and brand: for a test about another rule, where a changed origin, rights or session
// would also trip a rule those fields carry (a fact's address, a third party's brand, a signed-in fact).
const plain = () => { const { look, opening, ending, brand, ...rest } = example(); return rest; };
const step = (extra) => ({ id: 'a-step', do: 'click', target: { css: '#x' }, ...extra });
const withSteps = (steps) => ({ ...example(), useCases: [{ id: 'uc', title: 'A use case', steps: [{ id: 'go', do: 'goto', value: '/' }, ...steps] }] });
const errorsOf = (spec) => validateSpec(spec).errors;
const messages = (spec) => errorsOf(spec).map((e) => `${e.path}: ${e.message}`).join('\n');
const failsAt = (spec, pathPart) => assert.ok(errorsOf(spec).some((e) => e.path.includes(pathPart)), `expected an error at ${pathPart}, got:\n${messages(spec)}`);

test('the example is valid and loads with its folder', () => {
  const { spec, dir } = loadSpec(EXAMPLE);
  assert.equal(path.basename(dir), 'examples');
  assert.deepEqual(validateSpec(spec), { ok: true, errors: [] });
});

test('loadSpec says so for a missing file and for bad JSON', () => {
  assert.throws(() => loadSpec('/no/such/dir/x.demo.json'), /cannot read/);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-spec-')), 'bad.demo.json');
  fs.writeFileSync(file, '{ nope');
  assert.throws(() => loadSpec(file), /not valid JSON/);
});

test('an empty object, null and a list give errors and never throw', () => {
  for (const bad of [{}, null, [], 'x', 7]) {
    const result = validateSpec(bad);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
  }
  assert.ok(errorsOf({}).some((e) => e.path === 'rights' || e.path === 'source'));
});

test('the schema is closed: an unknown root key, step key and target key are errors', () => {
  failsAt({ ...example(), extra: 1 }, 'extra');
  failsAt(withSteps([step({ extra: 1 })]), 'extra');
  failsAt(withSteps([step({ target: { css: '#x', role: 'link' } })]), 'target');
});

test('version must be 1', () => failsAt({ ...example(), version: 2 }, 'version'));

test('mask: up to 20 targets, each { css } or { role, name }, and the entry is closed', () => {
  const targets = (n) => Array.from({ length: n }, (_, i) => (i % 2 === 0 ? { css: `#card-${i}` } : { role: 'heading', name: `Account ${i}` }));
  assert.deepEqual(errorsOf({ ...example(), mask: targets(20) }), [], '20 are allowed');
  failsAt({ ...example(), mask: targets(21) }, 'mask');
  failsAt({ ...example(), mask: [{ css: '#x', extra: 1 }] }, 'mask');
  failsAt({ ...example(), mask: [{ css: '#x', role: 'link' }] }, 'mask');
  failsAt({ ...example(), mask: [{ role: 'link' }] }, 'mask');
  failsAt({ ...example(), mask: [{ css: '' }] }, 'mask');
  failsAt({ ...example(), mask: 'all' }, 'mask');
});

test('source.url is http or https', () => {
  for (const url of ['ftp://shop.example.test/', 'javascript:alert(1)', 'not a url', 'constructor']) {
    failsAt({ ...example(), source: { url } }, 'source.url');
  }
});

test('origins: 1 to 5 bare origins, and the URL origin is one of them', () => {
  failsAt({ ...example(), origins: [] }, 'origins');
  failsAt({ ...example(), origins: Array.from({ length: 6 }, (_, i) => `https://s${i}.example.test`) }, 'origins');
  failsAt({ ...example(), origins: ['https://shop.example.test/pricing'] }, 'origins[0]');
  failsAt({ ...example(), origins: ['ftp://shop.example.test'] }, 'origins[0]');
  failsAt({ ...example(), origins: ['https://other.example.test'] }, 'origins');
});

test('originsOf defaults to the URL origin and returns what the file says otherwise', () => {
  assert.deepEqual(originsOf(example()), ['https://shop.example.test']);
  const spec = plain();
  delete spec.origins;
  spec.source.url = 'https://shop.example.test:8443/a/b';
  assert.deepEqual(originsOf(spec), ['https://shop.example.test:8443']);
  assert.deepEqual(originsOf({}), []);
  assert.deepEqual(validateSpec(spec).errors, []);
});

test('rights is required and one of own, permitted, third-party', () => {
  const spec = example();
  delete spec.rights;
  failsAt(spec, 'rights');
  failsAt({ ...example(), rights: 'mine' }, 'rights');
  for (const rights of ['own', 'permitted', 'third-party']) assert.deepEqual(errorsOf({ ...plain(), rights }), []);
});

test('viewport is 320 to 1920 wide and 320 to 1200 high', () => {
  assert.deepEqual(errorsOf({ ...example(), viewport: { width: 320, height: 1200 } }), []);
  assert.deepEqual(errorsOf({ ...example(), viewport: { width: 1920, height: 320 } }), []);
  failsAt({ ...example(), viewport: { width: 319, height: 720 } }, 'viewport.width');
  failsAt({ ...example(), viewport: { width: 1921, height: 720 } }, 'viewport.width');
  failsAt({ ...example(), viewport: { width: 1280, height: 1201 } }, 'viewport.height');
});

test('session is a short lower-case name', () => {
  assert.deepEqual(errorsOf({ ...plain(), session: 'shop-owner' }), []);
  for (const session of ['Owner', '-x', '', 'a'.repeat(42), 'a/b', '../x']) failsAt({ ...example(), session }, 'session');
});

test('pages: up to 5, each on an allowed origin', () => {
  assert.deepEqual(errorsOf({ ...example(), pages: ['/a', '/b', 'https://shop.example.test/c'] }), []);
  failsAt({ ...example(), pages: ['/a', '/b', '/c', '/d', '/e', '/f'] }, 'pages');
  failsAt({ ...example(), pages: ['https://evil.example.test/'] }, 'pages[0]');
});

test('useCases: 1 to 5, each with id, title and 1 to 20 steps', () => {
  failsAt({ ...example(), useCases: [] }, 'useCases');
  const one = example().useCases[0];
  failsAt({ ...example(), useCases: Array.from({ length: 6 }, (_, i) => ({ ...one, id: `uc-${i}`, steps: [{ id: `go-${i}`, do: 'goto', value: '/' }] })) }, 'useCases');
  failsAt({ ...example(), useCases: [{ id: 'uc', steps: one.steps }] }, 'title');
  failsAt({ ...example(), useCases: [{ id: 'uc', title: 't', steps: [] }] }, 'steps');
  const many = Array.from({ length: 21 }, (_, i) => step({ id: `s-${i}` }));
  failsAt(withSteps(many.slice(0, 20)), 'steps');
  assert.deepEqual(errorsOf(withSteps(many.slice(0, 19))), []);
});

test('ids are lower-case words and unique across the whole file', () => {
  failsAt(withSteps([step({ id: 'Bad_Id' })]), 'id');
  failsAt(withSteps([step({ id: '1st' })]), 'id');
  failsAt(withSteps([step({ id: 'go' })]), 'id'); // the goto above
  failsAt(withSteps([step({ id: 'uc' })]), 'id'); // the use case's own id
  const spec = withSteps([step({ id: 'one' }), step({ id: 'two' })]);
  assert.deepEqual(errorsOf(spec), []);
});

test('each use case starts with goto', () => {
  const spec = example();
  spec.useCases[0].steps.shift();
  failsAt(spec, 'useCases[0].steps[0]');
});

test('goto needs a value inside origins', () => {
  assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: 'goto', value: 'https://shop.example.test/pricing' }])), []);
  failsAt(withSteps([{ id: 'b', do: 'goto', value: 'https://other.example.test/' }]), 'value');
  failsAt(withSteps([{ id: 'b', do: 'goto' }]), 'value');
  failsAt(withSteps([{ id: 'b', do: 'goto', value: 5 }]), 'value');
});

test('click, hover and show need a target or an intent', () => {
  for (const verb of ['click', 'hover', 'show']) {
    assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: verb, target: { role: 'link', name: 'Docs' } }])), [], verb);
    assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: verb, intent: 'the docs link' }])), [], verb);
    failsAt(withSteps([{ id: 'b', do: verb }]), 'steps[1]');
  }
});

test('type and select need target and value, or an intent alone', () => {
  for (const verb of ['type', 'select']) {
    assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: verb, target: { css: '#q' }, value: 'x' }])), [], verb);
    assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: verb, intent: 'the search box' }])), [], verb);
    failsAt(withSteps([{ id: 'b', do: verb, target: { css: '#q' } }]), 'value');
    failsAt(withSteps([{ id: 'b', do: verb, value: 'x' }]), 'target');
    failsAt(withSteps([{ id: 'b', do: verb }]), 'steps[1]');
  }
});

test('press needs a value that is a key or chord name; Enter and Space also need a target', () => {
  assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: 'press', value: 'Enter', target: { css: '#q' } }])), []);
  for (const key of ['Tab', 'Escape', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowDown', 'ArrowLeft', 'F1', 'F12', 'a', '7', 'Control+a', 'Meta+Shift+z', 'Alt+ArrowUp']) {
    assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: 'press', value: key }])), [], key);
  }
  for (const key of ['Enter', 'Space', 'Shift+Enter', 'Control+Space']) failsAt(withSteps([{ id: 'b', do: 'press', value: key }]), 'target');
  for (const key of ['Enter', 'Space']) assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: 'press', value: key, intent: 'the form' }])).filter((e) => /target/.test(e.path)), [], 'an intent stands alone');
  for (const value of ['hunter2', 'hello world', 'F13', 'Ctrl+a', 'Enter+', '', 'ab']) failsAt(withSteps([{ id: 'b', do: 'press', value, target: { css: '#q' } }]), 'value');
  failsAt(withSteps([{ id: 'b', do: 'press' }]), 'value');
  failsAt(withSteps([{ id: 'b', do: 'press', value: 7 }]), 'value');
});

test('a type or select value may not hold a control character or run past 300 characters', () => {
  for (const verb of ['type', 'select']) {
    for (const value of ['tent\n', 'a\tb', 'bell\u0007', `x${'y'.repeat(300)}`]) failsAt(withSteps([{ id: 'b', do: verb, target: { css: '#q' }, value }]), 'value');
    assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: verb, target: { css: '#q' }, value: 'y'.repeat(300) }])), [], 'exactly 300 is allowed');
  }
});

test('an address with a user name or password is an error in source.url, pages and goto', () => {
  failsAt({ ...example(), source: { url: 'https://user:hunter2@shop.example.test/' } }, 'source.url');
  failsAt({ ...example(), pages: ['https://user:hunter2@shop.example.test/a'] }, 'pages[0]');
  failsAt(withSteps([{ id: 'b', do: 'goto', value: 'https://u:p@shop.example.test/x' }]), 'value');
  assert.ok(!messages({ ...example(), source: { url: 'https://user:hunter2@shop.example.test/' } }).includes('hunter2'), 'the password is not echoed');
});

test('scroll takes a target, or a value in pixels', () => {
  assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: 'scroll', target: { css: '#end' } }])), []);
  assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: 'scroll', value: 400 }])), []);
  failsAt(withSteps([{ id: 'b', do: 'scroll' }]), 'steps[1]');
  failsAt(withSteps([{ id: 'b', do: 'scroll', value: 'far' }]), 'value');
});

test('wait takes seconds from 0.1 to 10', () => {
  for (const value of [0.1, 3, 10]) assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: 'wait', value }])), [], String(value));
  for (const value of [0, 0.05, 10.5, '2']) failsAt(withSteps([{ id: 'b', do: 'wait', value }]), 'value');
  failsAt(withSteps([{ id: 'b', do: 'wait' }]), 'value');
});

test('an intent excludes a target and a value', () => {
  failsAt(withSteps([{ id: 'b', do: 'click', intent: 'a thing', target: { css: '#x' } }]), 'intent');
  failsAt(withSteps([{ id: 'b', do: 'click', intent: 'a thing', value: 'x' }]), 'intent');
});

test('a target is { role, name } or { css }, not both and not neither', () => {
  assert.deepEqual(errorsOf(withSteps([step({ target: { role: 'button', name: 'Go' } })])), []);
  failsAt(withSteps([step({ target: { role: 'button' } })]), 'target');
  failsAt(withSteps([step({ target: {} })]), 'target');
  failsAt(withSteps([step({ target: { css: '' } })]), 'target');
});

test('an unknown verb is an error that names the verbs', () => {
  const found = errorsOf(withSteps([{ id: 'b', do: 'drag', target: { css: '#x' } }]));
  assert.ok(found.some((e) => e.path.endsWith('.do') && /click/.test(e.message)), messages(withSteps([{ id: 'b', do: 'drag' }])));
});

// ---- look, opening, ending, brand (phase 4) ----

const FACT = { text: 'Plans start at 5 dollars', value: 5, from: 'https://shop.example.test/pricing' };

test('the example carries look, opening, ending and brand, and is valid', () => {
  const spec = example();
  for (const key of ['look', 'opening', 'ending', 'brand']) assert.ok(Object.hasOwn(spec, key), `the example holds ${key}`);
  assert.deepEqual(validateSpec(spec), { ok: true, errors: [] });
});

test('look is keynote or desk', () => {
  for (const look of ['keynote', 'desk']) assert.deepEqual(errorsOf({ ...example(), look }), [], look);
  failsAt({ ...example(), look: 'pop' }, 'look');
  failsAt({ ...example(), look: 7 }, 'look');
});

test('opening: a hook of 1 to 120 characters, up to 3 facts, the object closed', () => {
  const hook = 'Find a plan in two clicks';
  assert.deepEqual(errorsOf({ ...example(), opening: { hook } }), [], 'a hook alone');
  assert.deepEqual(errorsOf({ ...example(), opening: { hook: 'x'.repeat(120) } }), [], '120 characters');
  failsAt({ ...example(), opening: { hook: 'x'.repeat(121) } }, 'opening.hook');
  failsAt({ ...example(), opening: { hook: '' } }, 'opening.hook');
  failsAt({ ...example(), opening: { facts: [FACT] } }, 'opening');
  failsAt({ ...example(), opening: { hook, extra: 1 } }, 'opening');
  failsAt({ ...example(), opening: { hook, facts: [] } }, 'opening.facts');
  const fact = (n) => ({ text: `Fact ${n}`, from: 'user' });
  assert.deepEqual(errorsOf({ ...example(), opening: { hook, facts: [fact(1), fact(2), fact(3)] } }), [], 'three facts');
  failsAt({ ...example(), opening: { hook, facts: [fact(1), fact(2), fact(3), fact(4)] } }, 'opening.facts');
});

test('a fact: text 1 to 80 characters, value a finite number, from user or an http(s) address, closed', () => {
  const opening = (fact) => ({ ...example(), opening: { hook: 'A hook', facts: [fact] } });
  assert.deepEqual(errorsOf(opening({ text: 'x'.repeat(80), from: 'user' })), [], '80 characters');
  failsAt(opening({ text: 'x'.repeat(81), from: 'user' }), 'facts[0].text');
  failsAt(opening({ text: '', from: 'user' }), 'facts[0].text');
  failsAt(opening({ text: 'A fact' }), 'facts[0]');
  failsAt(opening({ text: 'A fact', from: 'the internet' }), 'facts[0].from');
  failsAt(opening({ text: 'A fact', from: 'ftp://shop.example.test/x' }), 'facts[0].from');
  failsAt(opening({ text: 'A fact', from: 'user', value: '5' }), 'facts[0].value');
  failsAt(opening({ text: 'A fact', from: 'user', extra: 1 }), 'facts[0]');
  assert.deepEqual(errorsOf(opening({ text: 'A fact', from: 'user', value: 0.5 })), [], 'a value of 0.5');
});

test('ending: an ask of 1 to 60 characters, an optional say of 1 to 120, the object closed', () => {
  assert.deepEqual(errorsOf({ ...example(), ending: { ask: 'x'.repeat(60) } }), [], '60 characters');
  assert.deepEqual(errorsOf({ ...example(), ending: { ask: 'Try it free', say: 'x'.repeat(120) } }), [], 'a say of 120');
  failsAt({ ...example(), ending: { ask: 'x'.repeat(61) } }, 'ending.ask');
  failsAt({ ...example(), ending: { ask: '' } }, 'ending.ask');
  failsAt({ ...example(), ending: { say: 'Bye' } }, 'ending');
  failsAt({ ...example(), ending: { ask: 'Go', say: 'x'.repeat(121) } }, 'ending.say');
  failsAt({ ...example(), ending: { ask: 'Go', extra: 1 } }, 'ending');
});

test('brand: a name of 1 to 40 characters and an accent of six lower-case hex digits, at least one key', () => {
  assert.deepEqual(errorsOf({ ...example(), brand: { name: 'Harbor' } }), [], 'a name alone');
  assert.deepEqual(errorsOf({ ...example(), brand: { accent: '#1f6feb' } }), [], 'an accent alone');
  assert.deepEqual(errorsOf({ ...example(), brand: { name: 'x'.repeat(40) } }), [], '40 characters');
  failsAt({ ...example(), brand: { name: 'x'.repeat(41) } }, 'brand.name');
  failsAt({ ...example(), brand: { name: '' } }, 'brand.name');
  failsAt({ ...example(), brand: {} }, 'brand');
  for (const accent of ['#FFF', 'red', '#1F6FEB', '#12345', '#1f6febff', '1f6feb']) failsAt({ ...example(), brand: { accent } }, 'brand.accent');
  failsAt({ ...example(), brand: { name: 'Harbor', logo: 'x.png' } }, 'brand');
});

test('a third-party demo carries no brand', () => {
  const found = errorsOf({ ...example(), rights: 'third-party', brand: { name: 'Harbor' } });
  assert.deepEqual(found.filter((e) => e.path === 'brand'), [{ path: 'brand', message: "a third party's brand is not taken: remove brand" }]);
  const { brand, ...without } = example();
  assert.deepEqual(errorsOf({ ...without, rights: 'third-party' }), [], 'no brand is fine');
});

test('a fact from an address must sit on an allowed origin', () => {
  const opening = (from) => ({ ...example(), opening: { hook: 'A hook', facts: [{ text: 'A fact', from }] } });
  assert.deepEqual(errorsOf(opening('https://shop.example.test/plans')), [], 'an allowed origin');
  failsAt(opening('https://other.example.test/plans'), 'opening.facts[0].from');
});

test('signed in, a fact comes from the user', () => {
  const opening = (from) => ({ ...example(), session: 'my-shop', opening: { hook: 'A hook', facts: [{ text: 'A fact', from }] } });
  assert.deepEqual(errorsOf(opening('user')), [], 'user is fine');
  const found = errorsOf(opening('https://shop.example.test/pricing'));
  assert.ok(found.some((e) => e.path === 'opening.facts[0].from' && e.message === "signed in, a fact comes from the user's own words"), messages(opening('https://shop.example.test/pricing')));
});

test('siblingDir is the folder next to this skill; a missing sibling names the install command', () => {
  assert.equal(path.basename(siblingDir('make-explainer')), 'make-explainer');
  assert.throws(() => siblingDir('../etc'), TypeError);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-sib-'));
  assert.throws(() => siblingScript('make-explainer', 'scripts/build.mjs', { root }), (e) => e instanceof SiblingError && /npx --yes skills@.* add .*make-explainer/.test(e.message) && /make-explainer/.test(e.command));
});

test('siblingScript is the absolute path of a script that exists; a folder without it is a SiblingError that says which script', () => {
  assert.equal(siblingScript('make-explainer', 'scripts/build.mjs'), path.join(siblingDir('make-explainer'), 'scripts', 'build.mjs'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-sib-'));
  fs.mkdirSync(path.join(root, 'make-explainer'));
  assert.throws(() => siblingScript('make-explainer', 'scripts/build.mjs', { root }), (e) => e instanceof SiblingError && /scripts\/build\.mjs not found/.test(e.message));
  assert.throws(() => siblingScript('make-explainer', '../../etc/passwd', { root }), TypeError);
  assert.throws(() => siblingScript('make-explainer', '/etc/passwd', { root }), TypeError);
});
