// draftGuide on hand-made inputs: the section order, the frame paths, the 40-section cut, the third-party callout and the plan refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftGuide } from '../scripts/lib/guide-draft.mjs';
import { sayLine } from '../scripts/lib/say-line.mjs';
import { planHash } from '../scripts/lib/plan-rows.mjs';
import { Refused } from '../scripts/lib/demo-out.mjs';

const START = 'https://shop.example.test/';
const row = (id, useCase, over = {}) => ({ id, useCase, do: 'click', page: START, effect: 'look', target: { id: null, role: 'button', name: `Name ${id}`, css: `#${id}` }, control: { kind: 'button', href: null, formAction: null, formMethod: null }, value: null, intent: null, address: null, ...over });
const ROWS = [
  row('open', 'a', { do: 'goto', target: null, control: null, address: START }),
  row('card', 'a', { do: 'hover' }),
  row('buy', 'a'),
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
const frame = (i) => `${i.toString(16).padStart(16, '0')}.jpg`;
const FRAMES = Array.from({ length: 5 }, (_, i) => frame(i));
const STEPS = ROWS.map((r, i) => ({ id: r.id, do: r.do, hasBox: true, settledIndex: i }));
const takeOf = (spec, over = {}) => ({ dir: '/x/demo/take-3', signedIn: false, stoppedAt: null, frames: FRAMES, steps: STEPS, planKey: `demo-${planHash(spec, ROWS)}`, ...over });
const draft = (spec, over = {}) => draftGuide({ spec, rows: ROWS, take: takeOf(spec, over), video: 'film.mp4' });
const types = (guide) => guide.sections.map((s) => s.type);

test('the title is the brand name, else the host, plus walkthrough', () => {
  assert.equal(draft(baseSpec({ brand: { name: 'Shop', accent: '#1f6feb' } })).guide.title, 'Shop walkthrough');
  assert.equal(draft(baseSpec()).guide.title, 'shop.example.test walkthrough');
});

test('a brand name with markup gives a plain title: no link, bracket, star or backtick', () => {
  const title = (name) => draft(baseSpec({ brand: { name } })).guide.title;
  const link = title('[Sign in](https://evil.test)');
  assert.doesNotMatch(link, /[[\]()]/);
  assert.equal(link, 'Sign in https evil.test walkthrough');
  assert.doesNotMatch(title('**Bold** `code` _x_ <b>'), /[*`_<>]/);
  assert.equal(title("Smith & Sons, Inc. - o'neil"), "Smith & Sons, Inc. - o'neil walkthrough");
  assert.equal(title('***'), 'shop.example.test walkthrough', 'a name with no word falls back to the host');
});

test('the sections are the film first, then per use case its steps and one image per finished step', () => {
  const { guide, notes } = draft(baseSpec());
  assert.deepEqual(types(guide), ['motion', 'steps', 'image', 'image', 'image', 'steps', 'image', 'image']);
  assert.equal(guide.sections[0].video, 'film.mp4');
  assert.equal(typeof guide.sections[0].caption, 'string');
  const [, stepsA] = guide.sections;
  assert.equal(stepsA.title, 'Buy a thing');
  assert.deepEqual(stepsA.items.map((i) => i.title), ['Open the start page.', 'Point at Name card.', 'Click Name buy.']);
  assert.deepEqual(notes, []);
});

test('each image is the step\'s settled frame under take-<n>/frames/, with its sentence as alt and caption', () => {
  const { guide } = draft(baseSpec());
  const images = guide.sections.filter((s) => s.type === 'image');
  assert.equal(images.length, 5);
  images.forEach((image, i) => {
    assert.equal(image.src, `take-3/frames/${FRAMES[i]}`);
    assert.equal(image.alt, sayLine(ROWS[i]));
    assert.equal(image.caption, sayLine(ROWS[i]));
  });
  const settled = draft(baseSpec(), { steps: STEPS.map((s) => ({ ...s, settledIndex: 4 })) }).guide.sections.find((s) => s.type === 'image');
  assert.equal(settled.src, `take-3/frames/${FRAMES[4]}`, 'the frame comes from settledIndex, not from the step position');
});

test('hostile control names add no markup to a sentence', () => {
  const hostile = ROWS.map((r) => (r.target ? { ...r, target: { ...r.target, name: 'Save. Now? *all* (5) [x]' } } : r));
  const spec = baseSpec();
  const { guide } = draftGuide({ spec, rows: hostile, take: takeOf(spec, { planKey: `demo-${planHash(spec, hostile)}` }), video: 'film.mp4' });
  assert.equal(guide.sections[1].items[2].title, 'Click Save Now all 5 x.');
});

test('a use case with no finished step is left out and noted; a take that stopped is noted by its row only', () => {
  const { guide, notes } = draft(baseSpec(), { steps: STEPS.slice(0, 3), stoppedAt: 'open2' });
  assert.equal(guide.sections.filter((s) => s.type === 'steps').length, 1);
  assert.ok(notes.some((n) => /use case b left out/.test(n)), notes.join('|'));
  assert.ok(notes.some((n) => /stopped at row open2/.test(n)));
});

test('past 40 sections only the last step of each use case keeps its image, and a note says so', () => {
  const rows = Array.from({ length: 45 }, (_, i) => row(`s${i}`, 'a', { do: 'goto', target: null, control: null, address: START }));
  const spec = baseSpec({ useCases: [{ id: 'a', title: 'Long one', steps: [] }] });
  const frames = Array.from({ length: 45 }, (_, i) => frame(i));
  const steps = rows.map((r, i) => ({ id: r.id, do: 'goto', hasBox: false, settledIndex: i }));
  const take = { dir: '/x/demo/take-3', signedIn: false, stoppedAt: null, frames, steps, planKey: `demo-${planHash(spec, rows)}` };
  const { guide, notes } = draftGuide({ spec, rows, take, video: 'film.mp4' });
  assert.deepEqual(types(guide), ['motion', 'steps', 'image']);
  assert.equal(guide.sections[1].items.length, 45, 'every step stays in the list');
  assert.equal(guide.sections[2].src, `take-3/frames/${frames[44]}`);
  assert.ok(notes.some((n) => /40 sections/.test(n)), notes.join('|'));
  assert.ok(guide.sections.length <= 40);
});

test('a take that fits in 40 sections keeps every image and has no note', () => {
  const { guide, notes } = draft(baseSpec());
  assert.equal(guide.sections.filter((s) => s.type === 'image').length, 5);
  assert.ok(!notes.some((n) => /40 sections/.test(n)));
});

test('a third-party demo adds a source callout and no brand in the title', () => {
  const spec = baseSpec({ rights: 'third-party', brand: { name: 'Shop', accent: '#1f6feb' } });
  const { guide } = draft(spec);
  assert.equal(guide.title, 'shop.example.test walkthrough');
  const callout = guide.sections.find((s) => s.type === 'callout');
  assert.equal(callout.text, 'Source: shop.example.test. Not made by its owner.');
  assert.ok(['info', 'warn', 'good', 'bad'].includes(callout.tone));
  assert.equal(draft(baseSpec()).guide.sections.some((s) => s.type === 'callout'), false);
});

test('a changed brand after the take is refused as another plan, with the film command\'s message; a take step the plan lacks is refused', () => {
  const taken = takeOf(baseSpec({ brand: { name: 'Shop', accent: '#1f6feb' } }));
  const spec = baseSpec({ brand: { name: 'Shop', accent: '#ff0000' } });
  assert.throws(() => draftGuide({ spec, rows: ROWS, take: taken, video: 'film.mp4' }), (e) => e instanceof Refused && e.errors[0].path === 'take.planKey' && /another plan.*plan, approve and take again/.test(e.message));
  const ghost = [...STEPS, { id: 'ghost', do: 'click', hasBox: true, settledIndex: 0 }];
  assert.throws(() => draft(baseSpec(), { steps: ghost }), (e) => e instanceof Refused && e.errors.some((x) => x.path === 'take.steps[5].id'));
});

test('a changed opening, ending or look is accepted: they are words, not bound by the plan', () => {
  const taken = takeOf(baseSpec());
  const edited = baseSpec({ opening: { hook: 'A new hook' }, ending: { ask: 'Another ask' }, look: 'desk' });
  assert.doesNotThrow(() => draftGuide({ spec: edited, rows: ROWS, take: taken, video: 'film.mp4' }));
});
