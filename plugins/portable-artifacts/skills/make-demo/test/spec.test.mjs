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
  const spec = example();
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
  for (const rights of ['own', 'permitted', 'third-party']) assert.deepEqual(errorsOf({ ...example(), rights }), []);
});

test('viewport is 320 to 1920 wide and 320 to 1200 high', () => {
  assert.deepEqual(errorsOf({ ...example(), viewport: { width: 320, height: 1200 } }), []);
  assert.deepEqual(errorsOf({ ...example(), viewport: { width: 1920, height: 320 } }), []);
  failsAt({ ...example(), viewport: { width: 319, height: 720 } }, 'viewport.width');
  failsAt({ ...example(), viewport: { width: 1921, height: 720 } }, 'viewport.width');
  failsAt({ ...example(), viewport: { width: 1280, height: 1201 } }, 'viewport.height');
});

test('session is a short lower-case name', () => {
  assert.deepEqual(errorsOf({ ...example(), session: 'shop-owner' }), []);
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

test('press needs a value and may have a target', () => {
  assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: 'press', value: 'Enter' }])), []);
  assert.deepEqual(errorsOf(withSteps([{ id: 'b', do: 'press', value: 'Enter', target: { css: '#q' } }])), []);
  failsAt(withSteps([{ id: 'b', do: 'press' }]), 'value');
  failsAt(withSteps([{ id: 'b', do: 'press', value: 7 }]), 'value');
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
