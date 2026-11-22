// cut-variety and sameness (engine/review/outline.mjs): two spec-only rules that run in --outline and in the full review,
// and the cap that keeps two findings of each a film. Pure: the spec and its estimated timeline, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import '../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { buildTimeline } from '../../engine/script/timing.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { outlineText } from '../../scripts/v2/report.mjs';
import { RULES } from '../../engine/review/rules.mjs';
import { COMPOSITION_RULES } from '../../engine/review/frame.mjs';
import {
  MIN_SEAMS, REPEATED_CUT_SHARE, SAME_RUN, CREATIVE_CAP, CAPPED_HERE, cutVarietyFindings, samenessFindings, outlineFindings, capCreative, cutPath,
} from '../../engine/review/outline.mjs';

const FPS = 30;
const EXAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../references/examples/v2');

// `cuts` are the cuts of shots 1.., shot 0 has none; a falsy entry leaves the shot's cut unset (the hard cut on desk).
const film = (cuts, shows = [], extra = {}) => ({
  version: 2, look: 'desk', ...extra,
  shots: [undefined, ...cuts].map((cut, i) => ({ id: `s${i}`, show: shows[i] ?? (i % 2 ? 'number' : 'statement'), hold: 2, ...(cut ? { cut } : {}) })),
});
const timed = (f) => [f, buildTimeline(f, { fps: FPS })];
const cutsOf = (f) => cutVarietyFindings(...timed(f));
const samenessOf = (f) => samenessFindings(...timed(f));
const withOn = (f, indexes, on) => ({ ...f, shots: f.shots.map((shot, i) => (indexes.includes(i) ? { ...shot, on } : shot)) });

test('the thresholds are the ones the rules page states', () => {
  assert.deepEqual([MIN_SEAMS, SAME_RUN, CREATIVE_CAP], [4, 3, 2]);
  assert.equal(REPEATED_CUT_SHARE, 2 / 3);
});

test('one windowed cut on more than two thirds of the seams is a finding with the cuts to use instead', () => {
  const [f, ...rest] = cutsOf(film(['slide', 'slide', 'slide', 'slide', 'cut', 'slide'])); // 5 of 6
  assert.deepEqual(rest, []);
  assert.equal(f.rule, 'cut-variety'); assert.equal(f.node, 'slide'); assert.equal(f.kind, 'creative');
  assert.equal(f.shot, 's1'); assert.equal(f.path, 'shots[1].cut'); assert.equal(f.t, 2);
  assert.ok(f.suggest.cuts.length > 0 && !f.suggest.cuts.includes('slide'));
  assert.match(f.message, /5 of the 6 cuts/);
});

test('the cuts it suggests are every cut the look allows but the repeated one, not only its preferred few', () => {
  const [f] = cutsOf(film(['slide', 'slide', 'slide', 'slide', 'slide']));
  const allowed = registries.looks.get('desk').cuts;
  assert.deepEqual(f.suggest.cuts, allowed.filter((cut) => cut !== 'slide'));
  assert.ok(f.suggest.cuts.length > registries.looks.get('desk').cutPalette.length - 1);
});

test('exactly two thirds is not a finding', () => assert.deepEqual(cutsOf(film(['slide', 'slide', 'slide', 'slide', 'cut', 'cut'])), []));
test('fewer than four seams is never judged', () => assert.deepEqual(cutsOf(film(['slide', 'slide', 'slide'])), []));
test('four seams are judged', () => assert.equal(cutsOf(film(['slide', 'slide', 'slide', 'slide'])).length, 1));
test('a film of plain cuts is not a finding', () => assert.deepEqual(outlineFindings(...timed(film(['cut', 'cut', 'cut', 'cut', 'cut']))).filter((f) => f.rule === 'cut-variety'), []));
test('a film with no cut named at all (the hard cut everywhere) is not a finding', () => assert.deepEqual(cutsOf(film([null, null, null, null, null])), []));

test('a root cut that every seam takes is found at "cut", on the first shot that uses it', () => {
  const [f] = cutsOf(film([null, null, null, null, null], [], { cut: 'slide' }));
  assert.equal(f.path, 'cut'); assert.equal(f.shot, 's1'); assert.equal(f.node, 'slide');
});

test('the path of a cut finding: the shot\'s own cut, or the root cut only when the film names one (a cut the look picks is set on the shot)', () => {
  const own = film(['slide', null, null]); // shot 1 names its cut; shots 2 and 3 take the film's or the look's
  assert.equal(cutPath(own, 1), 'shots[1].cut');
  assert.equal(cutPath(own, 2), 'shots[2].cut', 'no root cut: the repeated cut is the look\'s pick, so the shot is where to change it');
  const rooted = film([null, null, null], [], { cut: 'slide' });
  assert.equal(cutPath(rooted, 2), 'cut', 'a root cut that the shot takes is changed at the root');
  assert.equal(cutPath(film(['crossfade', null, null], [], { cut: 'slide' }), 1), 'shots[1].cut');
});

test('three shots of one kind running is a finding at the third; two is not', () => {
  const [f, ...rest] = samenessOf(film([null, null, null], ['statement', 'statement', 'statement', 'number']));
  assert.deepEqual(rest, []);
  assert.equal(f.path, 'shots[2].show'); assert.equal(f.node, 'kind:statement'); assert.equal(f.shot, 's2'); assert.equal(f.rule, 'sameness');
  assert.equal(f.suggest, undefined);
  assert.deepEqual(samenessOf(film([null, null], ['statement', 'statement', 'number'])), []);
});

test('a longer run of one kind is one finding, not one per shot', () => {
  assert.equal(samenessOf(film([null, null, null, null], ['list', 'list', 'list', 'list', 'list'])).length, 1);
});

test('one different shot breaks a run of one kind: two and three, not five', () => {
  assert.deepEqual(samenessOf(film([null, null, null, null], ['list', 'list', 'number', 'list', 'list'])), []);
  const [f, ...rest] = samenessOf(film([null, null, null, null, null], ['list', 'list', 'number', 'list', 'list', 'list']));
  assert.deepEqual(rest, []);
  assert.equal(f.path, 'shots[5].show'); assert.equal(f.node, 'kind:list');
  assert.match(f.message, /3 shots in a row \("s3" to "s5"\)/);
});

test('the same windowed cut three seams running is a finding at the third, with the cuts to use instead', () => {
  const [f, ...rest] = samenessOf(film(['slide', 'slide', 'slide'])); // shots 1 to 3 arrive by a slide
  assert.deepEqual(rest, []);
  assert.equal(f.path, 'shots[3].cut'); assert.equal(f.node, 'cut:slide');
  assert.ok(f.suggest.cuts.length > 0 && !f.suggest.cuts.includes('slide'));
  assert.deepEqual(samenessOf(film(['slide', 'slide', 'cut', 'slide'])), []);
});

test('the plain cut three seams running is not a run', () => assert.deepEqual(samenessOf(film(['cut', 'cut', 'cut', 'cut'])), []));

test('the same devices three shots running is a finding at the third; the order and a repeat of a device do not matter', () => {
  const base = film([null, null, null, null]); // statement, number, statement, number, statement
  const [f, ...rest] = samenessOf(withOn(base, [1, 2, 3], [{ at: 1, do: 'highlight' }]));
  assert.deepEqual(rest, []);
  assert.equal(f.path, 'shots[3].on'); assert.equal(f.node, 'move:highlight');
  const mixed = { ...base, shots: base.shots.map((shot, i) => ({ ...shot, ...(i >= 1 && i <= 3 ? { on: [{ at: 1, do: i === 2 ? 'underline' : 'circle' }, { at: 2, do: i === 2 ? 'circle' : 'underline' }, { at: 2.5, do: 'circle' }] } : {}) })) };
  assert.equal(samenessOf(mixed).find((x) => x.path === 'shots[3].on').node, 'move:circle+underline');
  assert.deepEqual(samenessOf(withOn(base, [1, 2], [{ at: 1, do: 'highlight' }])), [], 'two is not a run');
  assert.deepEqual(samenessOf(withOn(base, [0, 1, 3], [{ at: 1, do: 'highlight' }])), [], 'a shot with no move breaks the run');
});

test('a run is found in each of the three forms at once, in time order', () => {
  const found = outlineFindings(...timed(withOn(film(['slide', 'slide', 'slide'], ['list', 'list', 'list', 'list']), [1, 2, 3], [{ at: 1, do: 'circle' }])));
  assert.deepEqual(found.map((f) => f.node).sort(), ['cut:slide', 'kind:list', 'move:circle']);
  assert.deepEqual(found.map((f) => f.t), [...found.map((f) => f.t)].sort((a, b) => a - b));
});

test('capCreative keeps two per capped rule and says how many more', () => {
  const kept = capCreative([1, 2, 3, 4].map((t) => ({ kind: 'creative', rule: 'sameness', shot: `s${t}`, t, message: 'm' })));
  assert.equal(kept.length, 2);
  assert.equal(kept[0].message, 'm');
  assert.ok(kept[1].message.endsWith(' (and 2 more: s3, s4)'));
});

test('capCreative keeps the earliest two whatever order it is given, and caps each rule on its own', () => {
  const sameness = [4, 1, 3, 2].map((t) => ({ kind: 'creative', rule: 'sameness', shot: `s${t}`, t, message: 'm' }));
  const variety = [{ kind: 'creative', rule: 'cut-variety', shot: 'v', t: 9, message: 'v' }];
  const kept = capCreative([...sameness, ...variety]);
  assert.deepEqual(kept.map((f) => f.shot), ['s1', 's2', 'v'], 'the survivors keep their place in the list');
  assert.equal(kept.find((f) => f.shot === 'v').message, 'v', 'one finding is under the cap');
  assert.ok(kept.find((f) => f.shot === 's2').message.endsWith(' (and 2 more: s3, s4)'));
  assert.equal(kept.find((f) => f.shot === 's1').message, 'm');
});

test('capCreative caps each sameness form on its own, so kind runs cannot hide the cut run and its suggested cuts', () => {
  const at = (node, t, extra = {}) => ({ kind: 'creative', rule: 'sameness', node, shot: `s${t}`, t, message: node, ...extra });
  const cut = at('cut:slide', 9, { suggest: { cuts: ['wipe'] } });
  const kept = capCreative([at('kind:a', 1), at('kind:b', 2), at('kind:c', 3), at('move:x', 4), cut]);
  assert.deepEqual(kept.map((f) => f.node), ['kind:a', 'kind:b', 'move:x', 'cut:slide']);
  assert.deepEqual(kept.at(-1), cut, 'the cut run keeps its message and its suggestion');
  assert.equal(kept[1].message, 'kind:b (and 1 more: s3)');
});

test('the "and n more" count is the findings left out, and each shot it lists is named once, in order of first finding', () => {
  const found = [1, 2, 3, 4, 5].map((t) => ({ kind: 'creative', rule: 'sameness', node: 'kind:a', shot: t < 3 ? `s${t}` : (t === 4 ? 's7' : 's9'), t, message: 'm' }));
  // s9 holds two of the three findings left out (t 3 and 5), s7 one (t 4)
  assert.ok(capCreative(found)[1].message.endsWith(' (and 3 more: s9, s7)'));
  const same = [1, 2, 3, 4].map((t) => ({ kind: 'creative', rule: 'sameness', node: 'kind:a', shot: t < 3 ? `s${t}` : 's9', t, message: 'm' }));
  assert.ok(capCreative(same)[1].message.endsWith(' (and 2 more: s9)'));
});

test('capCreative leaves an uncapped rule, and the two composition rules, alone', () => {
  for (const rule of ['still', 'dead-space']) assert.equal(capCreative([1, 2, 3].map((t) => ({ kind: 'creative', rule, shot: 'a', t, message: 'm' }))).length, 3, rule);
});

test('capCreative does not change its input', () => {
  const input = [1, 2, 3].map((t) => ({ kind: 'creative', rule: 'sameness', shot: `s${t}`, t, message: 'm' }));
  const before = JSON.stringify(input);
  capCreative(input);
  assert.equal(JSON.stringify(input), before);
});

test('the text form of --outline ends on a creative line however many other findings the report holds', () => {
  const lines = (outlineText([{ id: 'a', show: 'free', start: 0, end: 2, narration: '' }], 'a note', [
    { kind: 'creative', path: 'shots[3].cut', message: 'first creative' },
    { kind: 'mechanical', path: 'shots[0]', message: 'pre-existing' },
    { kind: 'creative', path: 'shots[4].show', message: 'second creative' },
  ])).split('\n');
  assert.deepEqual(lines.slice(1), ['note: a note', 'mechanical: shots[0]: pre-existing', 'creative: shots[3].cut: first creative', 'creative: shots[4].show: second creative']);
  assert.ok(lines.at(-1).startsWith('creative: '));
});

test('every capped rule is capped by exactly one function', () => {
  for (const { id } of RULES.filter((r) => r.capped)) assert.notEqual(COMPOSITION_RULES.includes(id), CAPPED_HERE.includes(id), id);
  for (const id of CAPPED_HERE) assert.equal(RULES.find((r) => r.id === id)?.capped, true, `${id} is registered as capped`);
});

// The outline findings of the shipped example films (29 films, the calibration table of references/calibration.md): "<rule> <node> <path>".
// No film raises cut-variety. Every film not named here raises nothing. Each sameness form is capped on its own, so no
// film here is cut by the cap (the three forms of one film are three entries at most).
const KNOWN = Object.freeze({
  // true finding: 4 and 3 statement shots in a row (a cut demo that names the cuts on plain statements)
  'cuts-pop.json': ['sameness kind:statement shots[2].show', 'sameness kind:statement shots[14].show'],
  // true finding: 5 clipping shots with one move in a row; F1b rewrites the showreels
  'showreel-pro.json': ['sameness kind:clipping shots[4].show', 'sameness move:highlight shots[4].on'],
  // true finding: 5 media shots with one move in a row; F1b rewrites the showreels
  'showreel-viral.json': ['sameness kind:media shots[4].show', 'sameness move:sweep shots[4].on'],
  // true finding: 7 media shots in a row, then 3 clipping shots that also arrive by one slide three times running
  'whats-new.json': ['sameness kind:media shots[12].show', 'sameness kind:clipping shots[22].show', 'sameness cut:slide shots[22].cut'],
});

test('the shipped example films raise only the outline findings named in KNOWN, and the two showreels are among them', () => {
  const files = readdirSync(EXAMPLES).filter((name) => name.endsWith('.json')).sort();
  assert.equal(files.length, 29, 'a film added to the examples is calibrated into references/calibration.md first');
  for (const name of files) {
    const { film: f, timeline } = loadFilm(path.join(EXAMPLES, name));
    const found = outlineFindings(f, timeline).map((x) => `${x.rule} ${x.node} ${x.path}`);
    assert.deepEqual(found, KNOWN[name] ?? [], name);
  }
  assert.ok(KNOWN['showreel-pro.json'] && KNOWN['showreel-viral.json']);
});

test('at most a third of the example films raise an outline finding, so the rules do not teach the agent to ignore them', () => {
  const files = readdirSync(EXAMPLES).filter((name) => name.endsWith('.json'));
  assert.ok(Object.keys(KNOWN).length <= files.length / 3, `${Object.keys(KNOWN).length} of ${files.length}`);
});
