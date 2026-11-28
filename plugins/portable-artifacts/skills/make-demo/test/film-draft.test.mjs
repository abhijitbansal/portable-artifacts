// draftFilm on hand-made inputs: shot order, the cut, one sentence per step, the lift rule, the third-party mark, and the refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { draftFilm } from '../scripts/lib/film-draft.mjs';
import { planHash } from '../scripts/lib/plan-rows.mjs';
import { Refused } from '../scripts/lib/demo-out.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseSay } = await import(pathToFileURL(path.join(SKILL, '..', 'make-motion', 'engine', 'script', 'say.mjs')).href);

const START = 'https://shop.example.test/';
const row = (id, useCase, over = {}) => ({ id, useCase, do: 'click', page: START, effect: 'look', target: { id: null, role: 'button', name: `Name ${id}`, css: `#${id}` }, control: { kind: 'button', href: null, formAction: null, formMethod: null }, value: null, intent: null, address: null, ...over });
const ROWS = [
  row('open', 'a', { do: 'goto', target: null, control: null, address: START }),
  row('card', 'a', { do: 'hover' }),
  row('buy', 'a', { do: 'click' }),
  row('open2', 'b', { do: 'goto', target: null, control: null, address: `${START}cart` }),
  row('field', 'b', { do: 'type', value: 'Ada' }),
];
const baseSpec = (over = {}) => ({
  version: 1,
  source: { url: START },
  rights: 'own',
  useCases: [{ id: 'a', title: 'Buy a thing', steps: [] }, { id: 'b', title: 'Check the cart', steps: [] }],
  ...over,
});
const stepOf = (id, doVerb, hasBox) => ({ id, do: doVerb, hasBox });
const STEPS = [stepOf('open', 'goto', false), stepOf('card', 'hover', true), stepOf('buy', 'click', true), stepOf('open2', 'goto', false), stepOf('field', 'type', true)];
const SCOUT = { pages: [{ url: START }, { url: `${START}cart` }] };
const takeOf = (spec, over = {}) => ({ dir: '/x/demo/take-3', signedIn: false, stoppedAt: null, steps: STEPS, planKey: `demo-${planHash(spec, ROWS)}`, ...over });
const draft = (spec, over = {}, rows = ROWS) => draftFilm({ spec, rows, scout: SCOUT, take: takeOf(spec, over) });
const sentences = (say) => parseSay(say).tokens.filter((t) => t.sentenceEnd).length;
const walks = (film) => film.shots.filter((s) => s.show === 'walk');

const FULL = baseSpec({
  opening: { hook: 'Buying is *quick*.', facts: [{ text: 'Three clicks', value: 3, from: 'user' }, { text: 'No account needed', from: START }] },
  ending: { ask: 'Try it today' },
  brand: { name: 'Shop', accent: '#1f6feb' },
});

test('the shot order is hook, facts, walk shots, close; the root carries the look, the accent and no voice, music or sound', () => {
  const { film, notes } = draft(FULL);
  assert.deepEqual(film.shots.map((s) => s.id), ['hook', 'fact-1', 'fact-2', 'uc-a', 'uc-b', 'close']);
  assert.deepEqual({ version: film.version, mode: film.mode, look: film.look, format: film.format, accent: film.accent }, { version: 2, mode: 'pro', look: 'keynote', format: '16:9', accent: '#1f6feb' });
  for (const key of ['voice', 'music', 'sound']) assert.equal(film[key], undefined);
  assert.deepEqual(film.shots[0], { id: 'hook', show: 'statement', say: 'Buying is *quick*.' });
  assert.deepEqual(film.shots[1], { id: 'fact-1', show: 'number', value: 3, label: 'Three clicks', say: 'Three clicks' });
  assert.deepEqual(film.shots[2], { id: 'fact-2', show: 'statement', say: 'No account needed' });
  assert.deepEqual(film.shots.at(-1), { id: 'close', show: 'end', say: 'That is Shop.', ask: 'Try it today', mark: 'Shop' });
  assert.deepEqual(notes, []);
});

test('the first walk shot cuts in with zoom (keynote) or crossfade (desk); the second has no cut', () => {
  const keynote = walks(draft(FULL).film);
  assert.equal(keynote[0].cut, 'zoom');
  assert.equal(keynote[1].cut, undefined);
  const desk = baseSpec({ ...FULL, look: 'desk' });
  const film = draft(desk).film;
  assert.equal(film.look, 'desk');
  assert.equal(walks(film)[0].cut, 'crossfade');
});

test('with no opening the first walk shot is the film\'s first shot and has no cut (make-motion refuses one there)', () => {
  const film = draft(baseSpec({ ending: { ask: 'Go' } })).film;
  assert.equal(film.shots[0].id, 'uc-a');
  assert.equal(Object.hasOwn(film.shots[0], 'cut'), false);
  assert.equal(Object.hasOwn(walks(film)[1], 'cut'), false);
});

test('a walk shot has the take folder name, the window frame, the use case title and one sentence per finished step', () => {
  const [a, b] = walks(draft(FULL).film);
  assert.deepEqual([a.src, a.frame, a.title], ['take-3', 'window', 'Buy a thing']);
  assert.deepEqual(a.steps, [{ id: 'open' }, { id: 'card' }, { id: 'buy' }]);
  assert.deepEqual(b.steps, [{ id: 'open2' }, { id: 'field' }]);
  assert.equal(a.stops, undefined);
  assert.equal(sentences(a.say), 3);
  assert.equal(sentences(b.say), 2);
  assert.equal(a.say, 'Open the start page. Point at Name card. Click Name buy.');
});

test('hostile control names still give one sentence per step', () => {
  const hostile = ROWS.map((r) => (r.target ? { ...r, target: { ...r.target, name: 'Save. Now? *all* (5) [x] _y_ (0.5)' } } : r));
  const { film } = draftFilm({ spec: FULL, rows: hostile, scout: SCOUT, take: takeOf(FULL, { planKey: `demo-${planHash(FULL, hostile)}` }) });
  const [a, b] = walks(film);
  assert.equal(sentences(a.say), a.steps.length);
  assert.equal(sentences(b.say), b.steps.length);
  assert.doesNotMatch(`${a.say}${b.say}`, /[*_([\]]/);
});

test('the lift goes on the last boxed hover, show, type or select step, never a click', () => {
  const lifts = (steps) => draftFilm({ spec: FULL, rows: ROWS, scout: SCOUT, take: takeOf(FULL, { steps }) }).film;
  const [a, b] = walks(draft(FULL).film);
  assert.deepEqual(a.lift, [{ step: 'card' }], 'the last boxed step of a is a click; the earlier hover gets the lift');
  assert.deepEqual(b.lift, [{ step: 'field' }], 'a typed field gets it');
  const onlyClicks = [stepOf('open', 'goto', false), stepOf('card', 'click', true), stepOf('buy', 'click', true), stepOf('open2', 'goto', false), stepOf('field', 'press', true)];
  const none = walks(lifts(onlyClicks));
  assert.equal(Object.hasOwn(none[0], 'lift'), false, 'only clicks have boxes: no lift');
  assert.equal(Object.hasOwn(none[1], 'lift'), false, 'a boxed press is not lifted either');
  const noBox = walks(lifts([stepOf('open', 'goto', false), stepOf('card', 'hover', false), stepOf('buy', 'click', true)]));
  assert.equal(Object.hasOwn(noBox[0], 'lift'), false, 'a hover with no box is not lifted');
});

test('a take that stopped names the row only; a use case with no finished step is left out; a missing ending is noted', () => {
  const spec = baseSpec({ opening: { hook: 'Hello there' } });
  const { film, notes } = draft(spec, { steps: STEPS.slice(0, 3), stoppedAt: 'open2' });
  assert.deepEqual(walks(film).map((s) => s.id), ['uc-a']);
  assert.equal(film.shots.at(-1).show, 'walk');
  assert.ok(notes.some((n) => /use case b left out/.test(n)), notes.join('|'));
  assert.ok(notes.some((n) => /stopped at row open2/.test(n)));
  assert.ok(notes.some((n) => /no ending/.test(n)));
});

test('an ending with no brand says the URL host; ending.say wins', () => {
  assert.equal(draft(baseSpec({ ending: { ask: 'Go' } })).film.shots.at(-1).say, 'That is shop.example.test.');
  const own = draft(baseSpec({ ending: { ask: 'Go', say: 'Buy it now.' } })).film.shots.at(-1);
  assert.equal(own.say, 'Buy it now.');
  assert.equal(own.mark, undefined);
});

test('a third-party demo gets a source credit as the mark, keeps the ask and has no accent', () => {
  const spec = baseSpec({ rights: 'third-party', ending: { ask: 'See the real site' } });
  const { film } = draft(spec);
  assert.deepEqual(film.shots.at(-1), { id: 'close', show: 'end', say: 'That is shop.example.test.', ask: 'See the real site', mark: 'Source: shop.example.test' });
  assert.equal(film.accent, undefined);
});

test('a changed brand, step or origins after the take is refused as another plan, and the message says what to do', () => {
  const taken = takeOf(FULL);
  const spec = baseSpec({ ...FULL, brand: { name: 'Shop', accent: '#ff0000' } });
  assert.throws(() => draftFilm({ spec, rows: ROWS, scout: SCOUT, take: taken }), (e) => e instanceof Refused && e.errors[0].path === 'take.planKey' && /another plan.*plan, approve and take again/.test(e.message));
  const origins = baseSpec({ ...FULL, origins: ['https://shop.example.test'] });
  assert.throws(() => draftFilm({ spec: origins, rows: ROWS, scout: SCOUT, take: taken }), (e) => e.errors[0].path === 'take.planKey');
  assert.throws(() => draftFilm({ spec: FULL, rows: ROWS.slice(0, 4), scout: SCOUT, take: taken }), (e) => e.errors[0].path === 'take.planKey');
  assert.throws(() => draft(FULL, { planKey: 'abc' }), (e) => e.errors[0].path === 'take.planKey');
});

test('a take step the plan does not have is refused by its position', () => {
  const steps = [...STEPS, stepOf('ghost', 'click', true)];
  assert.throws(() => draft(FULL, { steps }), (e) => e instanceof Refused && e.errors.some((x) => x.path === 'take.steps[5].id' && /step ghost/.test(x.message)));
});

test('a changed opening, ending or look is accepted: they are words, not bound by the plan', () => {
  const taken = takeOf(FULL);
  const edited = baseSpec({ ...FULL, opening: { hook: 'A new hook' }, ending: { ask: 'Another ask' }, look: 'desk' });
  const { film } = draftFilm({ spec: edited, rows: ROWS, scout: SCOUT, take: taken });
  assert.equal(film.shots[0].say, 'A new hook');
  assert.equal(film.look, 'desk');
});

test('a fact from an address scout did not read is refused; one it read is accepted', () => {
  const bad = baseSpec({ opening: { hook: 'Hi', facts: [{ text: 'Seen', from: `${START}elsewhere` }] } });
  assert.throws(() => draft(bad), (e) => e.errors[0].path === 'opening.facts[0].from');
  assert.doesNotThrow(() => draft(baseSpec({ opening: { hook: 'Hi', facts: [{ text: 'Seen', from: `${START}cart` }] } })));
});

test('a long fact text is cut to 40 characters in the number label', () => {
  const text = 'x'.repeat(80);
  const spec = baseSpec({ opening: { hook: 'Hi', facts: [{ text, value: 5, from: 'user' }] } });
  const fact = draft(spec).film.shots[1];
  assert.equal(fact.label.length, 40);
  assert.equal(fact.say, text);
});
