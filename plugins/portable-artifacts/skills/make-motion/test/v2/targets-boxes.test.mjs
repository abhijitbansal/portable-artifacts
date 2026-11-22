// Every target a kind lists has a box (motion-steals W2 gate F1). A cut's `at` and an `on` target are checked against
// `kind.targets(shot)`, and the build (graph/film.mjs withOrigin, devices onDevices) throws on a name with no box, so a
// film that validates would crash the page. The gap is copy width, not look or format: an end card that cannot set its
// title at the hero floor leaves its ask and mark out, and a quote card that cannot hold its attribution leaves `by` out
// (each says so in props.dropped, and the review's "dropped" finding tells the author). The validator has no text
// measure, so it cannot know; a left-out target keeps a box instead (the title's, the text's) and the build never throws.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import { kindSupportProblems } from '../../engine/looks/index.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm } from '../../engine/graph/film.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import '../../scripts/v2/list.mjs';
import { FORMATS } from '../../engine/formats.mjs';
import { filmOf, filmFor, expandIn, all, IMAGES, FPS, measure, canvasOf, viralOf } from './helpers/kinds.mjs';
import { PICTURES } from './helpers/frozen.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC_DIR = path.join(HERE, '../../references/examples/v2');
const FORMAT_NAMES = Object.keys(FORMATS);
// the pictures the examples name, at their real sizes
for (const [src, [width, height]] of Object.entries(PICTURES)) IMAGES.set(src, { width, height });

// The example as a one-shot film in `look` at `format`; its devices are dropped (a look draws some, not all, and an
// `on` event adds no target of its own).
function oneShot(name, lookName, format) {
  const example = Object.fromEntries(Object.entries(registries.kinds.get(name).example).filter(([key]) => key !== 'on'));
  return filmOf([example], lookName, format);
}

test('every target a kind lists for its example has a box, in every look and format', () => {
  const failures = [];
  let checked = 0;
  for (const name of registries.kinds.names()) {
    const kind = registries.kinds.get(name);
    for (const lookName of registries.looks.names()) {
      if (kindSupportProblems(name, registries.looks.get(lookName)).length > 0) continue;
      for (const format of FORMAT_NAMES) {
        const film = oneShot(name, lookName, format);
        const prepared = kind.prepared === true ? prepareFilm(film, { filmDir: SPEC_DIR }).prepared : {};
        const { boxes, nodes } = expandIn(film, 0, { prepared });
        const listed = typeof kind.targets === 'function' ? kind.targets(film.shots[0]) : [];
        checked += 1;
        const missing = listed.filter((target) => !(target in boxes));
        const left = all(nodes).flatMap((n) => n.props.dropped ?? []);
        if (missing.length > 0) failures.push(`${name} in ${lookName} at ${format}: no box for ${missing.join(', ')} (have: ${Object.keys(boxes).join(', ')}; left out: ${left.join(', ') || 'nothing'})`);
      }
    }
  }
  assert.ok(checked > 100, `the sweep ran (${checked} cases)`);
  assert.deepEqual(failures, []);
});

const END = { id: 'e', show: 'end', say: 'Every number, with its source.', ask: 'Start today', mark: 'make-motion' };
const QUOTE = { id: 'q', show: 'quote', say: 'Every chart should show its work.', by: 'The data desk' };
const NEXT = { id: 'b', show: 'statement', say: 'Next one here.' };

const validates = (shots, look, format) => {
  const { errors } = validateFilm({ version: 2, mode: 'pro', look, format, shots }, { specDir: SPEC_DIR });
  assert.deepEqual(errors, []);
};
const leftOut = (nodes) => all(nodes).flatMap((n) => n.props.dropped ?? []);

// Where the cut into shot 1 opens from, as the built film draws it.
function originOf(shots, look, format) {
  const film = filmOf(shots, look, format);
  const timeline = buildTimeline(film, { fps: FPS });
  const canvas = canvasOf(format);
  const built = buildFilm({ film, timeline, measure, assets: IMAGES, canvas, viralInsets: viralOf(canvas) });
  return built.frameAt(timeline.shots[1].start + 0.05).cut.at;
}

// cosmos 16:9 under the test measure: the closing line cannot be set at the hero floor, so the ask and mark are left out
test('an end card that left its mark out still has one to open a cut from: the title', () => {
  const cut = (at) => [END, { ...NEXT, cut: { type: 'iris', at } }];
  validates(cut('mark'), 'cosmos', '16:9');
  const rest = expandIn(filmOf([END], 'cosmos', '16:9'));
  assert.ok(leftOut(rest.nodes).includes('mark'), 'the card left its mark out (the premise of this case)');
  assert.deepEqual(rest.boxes.mark, rest.boxes.title);
  assert.deepEqual(originOf(cut('mark'), 'cosmos', '16:9'), originOf(cut('title'), 'cosmos', '16:9'));
});

test('an end card that left its ask or mark out still builds an on event aimed at it', () => {
  for (const target of ['ask', 'mark']) {
    const shots = [{ ...END, on: [{ at: 'word:1', do: 'highlight', target }] }];
    validates(shots, 'cosmos', '16:9');
    filmFor(shots, 'cosmos', '16:9');
    assert.deepEqual(expandIn(filmOf(shots, 'cosmos', '16:9')).boxes[target], expandIn(filmOf([END], 'cosmos', '16:9')).boxes.title, target);
  }
});

test('a quote card that left its byline out still has one to open a cut from: the text', () => {
  for (const look of ['cosmos', 'ledger', 'keynote', 'marker']) {
    const cut = (at) => [QUOTE, { ...NEXT, cut: { type: 'iris', at } }];
    validates(cut('by'), look, '1:1');
    const rest = expandIn(filmOf([QUOTE], look, '1:1'));
    assert.ok(leftOut(rest.nodes).length > 0, `${look}: the card left its attribution out (the premise of this case)`);
    assert.deepEqual(rest.boxes.by, rest.boxes.text, look);
    assert.deepEqual(originOf(cut('by'), look, '1:1'), originOf(cut('text'), look, '1:1'), look);
  }
});

test('a target the card does draw keeps its own box', () => {
  const end = expandIn(filmOf([END], 'desk', '16:9'));
  assert.notDeepEqual(end.boxes.mark, end.boxes.title);
  const quote = expandIn(filmOf([QUOTE], 'desk', '16:9'));
  assert.notDeepEqual(quote.boxes.by, quote.boxes.text);
});
