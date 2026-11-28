// draftFilm on hand-made inputs: shot order, the cut, one sentence per step, the lift rule, the third-party mark, and the refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
  assert.deepEqual(film.shots.at(-1), { id: 'close', show: 'end', cut: 'cut', say: 'That is Shop.', ask: 'Try it today', mark: 'Shop' });
  assert.deepEqual(notes, []);
});

// The look gate (phase 4) found a dissolve laid the opening's type over the page and a fade dipped to a blank frame: both seams are hard cuts.
test('the first walk shot and the closing card cut in hard in both looks; the second walk shot takes the look default', () => {
  const keynote = draft(FULL).film;
  assert.equal(walks(keynote)[0].cut, 'cut');
  assert.equal(walks(keynote)[1].cut, undefined);
  assert.equal(keynote.shots.at(-1).cut, 'cut');
  const film = draft(baseSpec({ ...FULL, look: 'desk' })).film;
  assert.equal(film.look, 'desk');
  assert.equal(walks(film)[0].cut, 'cut');
  assert.equal(film.shots.at(-1).cut, 'cut');
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
  assert.deepEqual(film.shots.at(-1), { id: 'close', show: 'end', cut: 'cut', say: 'That is shop.example.test.', ask: 'See the real site', mark: 'Source: shop.example.test' });
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

// make-motion keeps these two caps as unexported constants (scripts/v2/spec.mjs SAY_MAX, engine/kinds/end.mjs MARK_MAX), so the tests read them
// from the source rather than copy a number.
const constantOf = (name, ...parts) => Number(new RegExp(`const ${name} = (\\d+);`).exec(fs.readFileSync(path.join(SKILL, '..', 'make-motion', ...parts), 'utf8'))[1]);
const SAY_MAX = constantOf('SAY_MAX', 'scripts', 'v2', 'spec.mjs');
const MARK_MAX = constantOf('MARK_MAX', 'engine', 'kinds', 'end.mjs');

function longUseCase(count) {
  const verbs = ['hover', 'click', 'type'];
  const rows = Array.from({ length: count }, (_, i) => row(`s${i}`, 'a', {
    do: verbs[i % 3],
    value: 'Ada',
    target: { id: null, role: 'button', name: `Control number ${i} with a long descriptive name`, css: `#s${i}` },
  }));
  const spec = baseSpec({ useCases: [{ id: 'a', title: 'A long use case', steps: [] }], opening: { hook: 'Hello there' } });
  const steps = rows.map((r) => stepOf(r.id, r.do, true));
  const { film } = draftFilm({ spec, rows, scout: SCOUT, take: { ...takeOf(spec), steps, planKey: `demo-${planHash(spec, rows)}` } });
  return { film, rows };
}

test('a use case of 20 long steps splits into consecutive walk shots, each say within make-motion\'s cap, every step once in order', () => {
  const { film, rows } = longUseCase(20);
  const shots = walks(film);
  assert.ok(shots.length > 1, 'it needs more than one shot');
  assert.deepEqual(shots.map((s) => s.id), shots.map((_, i) => (i === 0 ? 'uc-a' : `uc-a-${i + 1}`)));
  for (const shot of shots) {
    assert.ok(shot.say.length <= SAY_MAX, `${shot.id}: ${shot.say.length} > ${SAY_MAX}`);
    assert.equal(sentences(shot.say), shot.steps.length);
    assert.equal(shot.title, 'A long use case');
  }
  assert.deepEqual(shots.flatMap((s) => s.steps.map((x) => x.id)), rows.map((r) => r.id));
  assert.deepEqual(shots.map((s) => s.cut), shots.map((_, i) => (i === 0 ? 'cut' : undefined)), 'only the first walk shot of the film cuts in');
});

test('each chunk gets its own lift, on its last boxed hover, show, type or select step', () => {
  const { film, rows } = longUseCase(20);
  const verbOf = new Map(rows.map((r) => [r.id, r.do]));
  for (const shot of walks(film)) {
    const want = shot.steps.map((s) => s.id).findLast((id) => ['hover', 'type'].includes(verbOf.get(id)));
    assert.equal(shot.lift?.[0]?.step, want, shot.id);
  }
});

test('a use case that fits in one shot keeps the id uc-<id> and is not split', () => {
  const { film } = longUseCase(1);
  assert.deepEqual(walks(film).map((s) => s.id), ['uc-a']);
  const { film: whole } = draft(FULL);
  assert.deepEqual(walks(whole).map((s) => s.id), ['uc-a', 'uc-b']);
});

test('a chunk id never collides with a use case id such as a-2', () => {
  const spec = baseSpec({ useCases: [{ id: 'a', title: 'A', steps: [] }, { id: 'a-2', title: 'B', steps: [] }] });
  const rows = [...Array.from({ length: 12 }, (_, i) => row(`s${i}`, 'a', { target: { id: null, role: 'button', name: `Control number ${i} with a long descriptive name`, css: '#x' } })), row('t0', 'a-2')];
  const steps = rows.map((r) => stepOf(r.id, r.do, true));
  const { film } = draftFilm({ spec, rows, scout: SCOUT, take: { ...takeOf(spec), steps, planKey: `demo-${planHash(spec, rows)}` } });
  const ids = film.shots.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, ids.join(','));
  assert.deepEqual(ids, ['uc-a', 'uc-a-3', 'uc-a-2'], 'the second chunk of a skips the number a-2 owns');
});

test('a brand name over the mark cap is cut at a word to the cap, with no trailing space', () => {
  const name = 'Northwind Traders Hardware Supply Company';
  assert.ok(name.length > MARK_MAX);
  const mark = draft(baseSpec({ ending: { ask: 'Go' }, brand: { name } })).film.shots.at(-1).mark;
  assert.equal(mark, 'Northwind Traders Hardware');
  const forty = draft(baseSpec({ ending: { ask: 'Go' }, brand: { name: 'x'.repeat(40) } })).film.shots.at(-1).mark;
  assert.equal(forty, 'x'.repeat(MARK_MAX));
  assert.equal(draft(baseSpec({ ending: { ask: 'Go' }, brand: { name: 'Acme' } })).film.shots.at(-1).mark, 'Acme');
});

test('the cut never leaves half of a \\u{...} escape', () => {
  const name = `${'a'.repeat(MARK_MAX - 3)}\\u{202e}more`;
  const mark = draft(baseSpec({ ending: { ask: 'Go' }, brand: { name } })).film.shots.at(-1).mark;
  assert.ok([...mark].length <= MARK_MAX);
  assert.doesNotMatch(mark, /\\(u(\{[0-9a-f]*)?)?$/i, mark);
});

test('a third-party source credit is cut in the host part and keeps "Source: "', () => {
  const host = 'docs.my-company-product-name.example.com';
  assert.ok(host.length > 24);
  const spec = baseSpec({ rights: 'third-party', source: { url: `https://${host}/` }, ending: { ask: 'See it' } });
  const mark = draftFilm({ spec, rows: ROWS, scout: SCOUT, take: takeOf(spec) }).film.shots.at(-1).mark;
  assert.ok(mark.startsWith('Source: docs.my-company'), mark);
  assert.ok(mark.length <= MARK_MAX, mark);
  assert.doesNotMatch(mark, /[\s.:-]$/);
});

test('a brand name blank after cleaning gives no mark and never an empty string', () => {
  for (const name of ['***', '   ', '()']) {
    const last = draft(baseSpec({ ending: { ask: 'Go' }, brand: { name } })).film.shots.at(-1);
    assert.equal(Object.hasOwn(last, 'mark'), false, JSON.stringify(name));
  }
});

test('a third-party demo with no ending still closes on a source credit and carries no ask', () => {
  const { film, notes } = draft(baseSpec({ rights: 'third-party' }));
  assert.deepEqual(film.shots.at(-1), { id: 'close', show: 'end', cut: 'cut', say: 'Shown from shop.example.test.', mark: 'Source: shop.example.test' });
  assert.ok(notes.some((n) => /no ending/.test(n)));
  assert.equal(draft(baseSpec()).film.shots.at(-1).show, 'walk', 'an own demo with no ending keeps no closing card');
});

test('a long fact text is cut to 40 characters in the number label', () => {
  const text = 'x'.repeat(80);
  const spec = baseSpec({ opening: { hook: 'Hi', facts: [{ text, value: 5, from: 'user' }] } });
  const fact = draft(spec).film.shots[1];
  assert.equal(fact.label.length, 40);
  assert.equal(fact.say, text);
});
