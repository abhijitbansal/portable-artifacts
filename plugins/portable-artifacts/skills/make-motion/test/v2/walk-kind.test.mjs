// The `walk` kind (engine/kinds/walk.mjs): registered and parked in keynote and desk, its schema and its refusals, the
// preparer's problems reaching the user, its layout (the framed picture, one image node on the take's frames, the boxes),
// its camera stops, and its findings. Pure: the take is the committed fixture, or a hand-made one of plain runs of frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registries } from '../../engine/registry.mjs';
import { isParkedKind, listedKinds } from '../../engine/looks/index.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { signedInNotices } from '../../scripts/v2/report.mjs';
import { walkFrameTrack, walkMinSeconds, walkProblems } from '../../engine/kinds/walk-time.mjs';
import { walkSetup } from '../../engine/kinds/walk-layout.mjs';
import { all, expandIn, filmOf } from './helpers/kinds.mjs';
import { EXAMPLES_DIR, STEPS, committed, expandWalk, handShot, handTake, reviewCtx, walkFilm, walkShot } from './helpers/walk.mjs';

const walk = registries.kinds.get('walk');
const errorsOf = (film) => validateFilm(film, { specDir: EXAMPLES_DIR }).errors.map((e) => `${e.path}: ${e.message}`);
const problemsOf = (film) => prepareFilm(film, { filmDir: EXAMPLES_DIR }).problems.map((e) => `${e.path}: ${e.message}`);
const near = (actual, wanted, label) => assert.ok(Math.abs(actual - wanted) < 1e-9, `${label}: ${actual} is not ${wanted}`);

// ---- registration ----

test('walk is registered and parked in keynote and desk, so no listing shows it', () => {
  assert.ok(registries.kinds.has('walk'));
  for (const look of ['keynote', 'desk']) assert.ok(isParkedKind(registries.looks.get(look), 'walk'), `${look} parks walk`);
  assert.ok(!listedKinds().includes('walk'));
  // no event devices: the sound plan gets no prepared data, so walk stops are silent (a known limit)
  assert.deepEqual([walk.srcFields, walk.lookData, walk.prepared, walk.showsWords, walk.numbered, walk.eventDevices, walk.events], [[], true, true, false, false, undefined, undefined]);
});

test('look data: the frame keys copied from each look\'s screen, a wide share, and the lift', () => {
  for (const name of ['keynote', 'desk']) {
    const look = registries.looks.get(name);
    for (const key of ['fill', 'line', 'lineWidth', 'dots', 'pill', 'text', 'urlText', 'wideShare']) assert.equal(look.kinds.walk[key], look.kinds.screen[key], `${name}.${key}`);
    const { lift, pushPad, context, snap, mark, ripple } = look.kinds.walk;
    assert.deepEqual([lift.scale, lift.hold, lift.rise, lift.radius], [1.1, 1.2, 0.005, 12]);
    assert.ok(lift.layers.length >= 2 && lift.dim > 0 && typeof lift.scrim === 'string', `${name}: the lift's own shadow layers and scrim`);
    assert.deepEqual([pushPad, snap, context], [60, 0.1, { width: 0.7, height: 0.45, last: { width: 0.99, height: 0.8, pad: 0 } }]);
    assert.equal(typeof (mark.rounded ?? mark.circle).color, 'string', `${name}: the mark's style`);
    assert.deepEqual([ripple.color, ripple.keyline], ['ink', 'paper'], `${name}: the ripple's ink on a paper keyline`);
  }
});

// ---- the schema and the refusals ----

test('the example validates in keynote and desk', () => {
  for (const look of ['keynote', 'desk']) assert.deepEqual(errorsOf(walkFilm({ ...walk.example, src: 'walk-take' }, { look })), [], look);
});

test('a shot with every field validates', () => {
  const shot = walkShot({ title: 'Shop', frame: 'window', stops: [{ to: 'whole' }, { to: 'step:tab', at: 'sentence:1' }], lift: [{ step: 'search', at: 'word:word' }], on: [{ at: 'sentence:2', do: 'circle', target: 'step:search' }] });
  assert.deepEqual(errorsOf(walkFilm(shot)), []);
});

test('steps: 1 to 40, each with an id; frame is browser, window or none; no other field', () => {
  assert.ok(errorsOf(walkFilm(walkShot({ steps: [] }))).length > 0);
  assert.ok(errorsOf(walkFilm(walkShot({ steps: Array.from({ length: 41 }, (_, i) => ({ id: `s${i}` })) }))).length > 0);
  assert.ok(errorsOf(walkFilm(walkShot({ frame: 'phone' }))).length > 0);
  assert.ok(errorsOf(walkFilm(walkShot({ pointer: true }))).length > 0);
});

test('a tall canvas is refused: walk needs a wide frame', () => {
  for (const format of ['9:16', '1:1', '4:5']) {
    const errors = errorsOf(walkFilm(walkShot(), { format }));
    assert.ok(errors.some((e) => e.startsWith('shots[0].show: ') && e.includes('walk needs a wide frame (16:9) for now')), `${format}: ${errors.join(' | ')}`);
  }
  assert.deepEqual(errorsOf(walkFilm(walkShot(), { format: '16:9' })), []);
});

test('a film narrated by one recording is refused', () => {
  const errors = errorsOf(walkFilm(walkShot(), { voice: { src: 'voice.wav', words: 'words.json' } }));
  assert.ok(errors.some((e) => e.startsWith('shots[0].show: ') && /recording/.test(e)), errors.join(' | '));
});

test('a look without walk data refuses it', () => {
  const errors = errorsOf(walkFilm(walkShot(), { look: 'pop', mode: 'viral', format: '16:9' }));
  assert.ok(errors.some((e) => e.includes('kind "walk" is not supported by look "pop"')), errors.join(' | '));
});

test('a stop or a lift on a step the shot does not have is refused at its field', () => {
  const stop = errorsOf(walkFilm(walkShot({ stops: [{ to: 'whole' }, { to: 'step:nope' }] })));
  assert.ok(stop.some((e) => e.startsWith('shots[0].stops[1].to: ') && e.includes('nope') && e.includes('tab')), stop.join(' | '));
  const lift = errorsOf(walkFilm(walkShot({ lift: [{ step: 'nope' }] })));
  assert.ok(lift.some((e) => e.startsWith('shots[0].lift[0].step: ')), lift.join(' | '));
});

test('a step\'s at in the end form is refused (it reads the natural length); other forms are fine', () => {
  for (const at of ['end', 'end-1', 'end+0.5']) {
    const errors = errorsOf(walkFilm(walkShot({ steps: [{ id: 'open' }, { id: 'tab', at }, ...STEPS.slice(2).map((id) => ({ id }))] })));
    assert.ok(errors.some((e) => e.startsWith('shots[0].steps[1].at: ') && e.includes('end')), `${at}: ${errors.join(' | ')}`);
  }
  for (const at of [2.5, 'start', 'sentence:1', 'word:tab', 'word:tab+0.2']) {
    assert.deepEqual(errorsOf(walkFilm(walkShot({ steps: [{ id: 'open' }, { id: 'tab', at }, ...STEPS.slice(2).map((id) => ({ id }))] }))), [], String(at));
  }
});

test('an anchor that does not parse on a step, a stop or a lift is an error at its field, not a crash', () => {
  const shot = walkShot({ steps: [{ id: 'open', at: 'banana' }, ...STEPS.slice(1).map((id) => ({ id }))], stops: [{ to: 'whole', at: 'sentence:99' }], lift: [{ step: 'tab', at: 'nope:1' }] });
  const errors = errorsOf(walkFilm(shot));
  for (const path of ['shots[0].steps[0].at', 'shots[0].stops[0].at', 'shots[0].lift[0].at']) assert.ok(errors.some((e) => e.startsWith(`${path}: `)), `${path}: ${errors.join(' | ')}`);
});

test('a walk at in seconds past 180 is refused on a step, a stop and a lift, naming its field; 180 and the sentence forms are fine', () => {
  const steps = (at) => [{ id: 'open' }, { id: 'tab', at }, ...STEPS.slice(2).map((id) => ({ id }))];
  for (const at of [180.5, 1e7, '1000000', 'start+999999']) {
    const step = errorsOf(walkFilm(walkShot({ steps: steps(at) })));
    assert.ok(step.some((e) => e.startsWith('shots[0].steps[1].at: ') && e.includes('180')), `step ${at}: ${step.join(' | ')}`);
    const stop = errorsOf(walkFilm(walkShot({ stops: [{ to: 'whole', at }] })));
    assert.ok(stop.some((e) => e.startsWith('shots[0].stops[0].at: ') && e.includes('180')), `stop ${at}: ${stop.join(' | ')}`);
    const lift = errorsOf(walkFilm(walkShot({ lift: [{ step: 'tab', at }] })));
    assert.ok(lift.some((e) => e.startsWith('shots[0].lift[0].at: ') && e.includes('180')), `lift ${at}: ${lift.join(' | ')}`);
  }
  assert.deepEqual(errorsOf(walkFilm(walkShot({ stops: [{ to: 'whole', at: 180 }] }))).filter((e) => /\.at: /.test(e) && e.includes('180')), []);
  assert.deepEqual(errorsOf(walkFilm(walkShot({ steps: steps('sentence:1+2') }))), []);
});

test('walkMinSeconds is capped at the natural length plus 180 s, whatever the anchors say', () => {
  const data = handTake([60, 60], [[10, 10, 100, 40], [500, 300, 100, 40]]);
  const shot = { ...handShot(data), steps: [{ id: 's0' }, { id: 's1', at: 1e7 }] };
  const least = walkMinSeconds(shot, { sentences: [], words: [], seconds: 5, prepared: data });
  assert.equal(least, 5 + 180);
  const small = walkMinSeconds(handShot(data), { sentences: [], words: [], seconds: 5, prepared: data });
  assert.ok(small < 5 + 180, `a normal shot is not touched: ${small}`);
});

// ---- the preparer's problems reach the user ----

test('a take that fits prepares with no problem', () => {
  assert.deepEqual(problemsOf(walkFilm()), []);
  assert.deepEqual(problemsOf(walkFilm(walkShot({ say: undefined, hold: 4 }))), []);
});

test('three steps on two sentences: the count mismatch names both counts, at the shot\'s steps', () => {
  const problems = problemsOf(walkFilm(walkShot({ say: 'Open the page. Pick the tab.', steps: [{ id: 'open' }, { id: 'tab' }, { id: 'search' }] })));
  assert.deepEqual(problems, ['shots[0].steps: 3 steps, 2 sentences: give each step a sentence or an at']);
});

test('the sentence count is estimated from the say: one sentence, no pause, is one', () => {
  const problems = problemsOf(walkFilm(walkShot({ say: 'Open the page then pick the tab then type', steps: [{ id: 'open' }, { id: 'tab' }] })));
  assert.deepEqual(problems, ['shots[0].steps: 2 steps, 1 sentence: give each step a sentence or an at']);
  const withAt = walkShot({ say: 'Open the page then pick the tab then type', steps: [{ id: 'open', at: 'word:open' }, { id: 'tab', at: 'word:pick' }] });
  assert.deepEqual(problemsOf(walkFilm(withAt)), []);
});

test('a step the take lacks, and steps out of the take\'s order, are problems at the step', () => {
  const unknown = problemsOf(walkFilm(walkShot({ say: 'A. B.', steps: [{ id: 'open' }, { id: 'missing' }] })));
  assert.equal(unknown.length, 1);
  assert.ok(unknown[0].startsWith('shots[0].steps[1].id: ') && unknown[0].includes('"missing"'));
  const order = problemsOf(walkFilm(walkShot({ say: 'A. B.', steps: [{ id: 'tab' }, { id: 'open' }] })));
  assert.equal(order.length, 1);
  assert.ok(order[0].startsWith('shots[0].steps[1].id: ') && order[0].includes('take\'s order'));
});

test('a lift on a step whose box has no area, or lies wholly off the page, is a problem like a null box', () => {
  const boxes = { zeroWidth: { x: 80, y: 100, width: 0, height: 40 }, zeroHeight: { x: 80, y: 100, width: 60, height: 0 }, left: { x: -60, y: 100, width: 60, height: 40 },
    right: { x: 960, y: 100, width: 60, height: 40 }, above: { x: 80, y: -40, width: 60, height: 40 }, below: { x: 80, y: 540, width: 60, height: 40 } };
  for (const [name, box] of Object.entries(boxes)) {
    const data = handTake([30, 30], [[10, 10, 100, 40], [500, 300, 100, 40]]);
    data.steps[1].box = box;
    const problems = walkProblems({ ...handShot(data), lift: [{ step: 's1' }] }, {}, data);
    assert.deepEqual(problems.map((p) => [p.path, p.message]), [['lift[0].step', 'lift on step s1: the take has no box for it']], name);
  }
  const edge = handTake([30, 30], [[10, 10, 100, 40], [500, 300, 100, 40]]);
  edge.steps[1].box = { x: -59, y: 539, width: 60, height: 40 }; // reaches one px into the page
  assert.deepEqual(walkProblems({ ...handShot(edge), lift: [{ step: 's1' }] }, {}, edge), []);
});

test('a film with no say is not held to a sentence count', () => {
  assert.deepEqual(problemsOf(walkFilm(walkShot({ say: undefined, hold: 3, steps: [{ id: 'open' }, { id: 'search' }] }))), []);
});

// ---- the layout ----

test('expanding: one image node plays the take\'s frames on the walk frame track, inside the framed screen', () => {
  const prepared = { w: committed() };
  const out = expandWalk(walkFilm(), prepared);
  const images = all(out.nodes).filter((n) => n.type === 'image');
  assert.equal(images.length, 1);
  const [image] = images;
  assert.equal(image.id, 'w.screen.image');
  assert.equal(image.props.src, 'walk-take');
  assert.deepEqual(image.props.video, { count: prepared.w.names.length });
  assert.deepEqual(image.tracks.frame, walkFrameTrack(out.plan, prepared.w));
  assert.deepEqual([image.props.x, image.props.y, image.props.w, image.props.h], out.boxes.image);
  assert.equal(out.hero, 'w.screen');
  assert.ok(all(out.nodes).some((n) => n.id === 'w.frame.body'), 'the browser frame is drawn');
});

test('the picture is as large as fits the room at the look\'s wide share, never past its own pixels in shape', () => {
  const prepared = { w: committed() };
  for (const look of ['keynote', 'desk']) {
    const out = expandWalk(walkFilm(walkShot(), { look }), prepared);
    const [x, y, w, h] = out.boxes.image;
    near(w / h, 960 / 540, `${look} aspect`);
    assert.ok(x >= 0 && y >= 0 && x + w <= 1920 && y + h <= 1080, `${look} inside the canvas`);
    const share = registries.looks.get(look).kinds.walk.wideShare;
    assert.ok(w <= 1920 * share + 1e-6, `${look} within its share`);
    const [sx, sy, sw, sh] = out.boxes.screen;
    assert.ok(sx <= x && sy < y && sx + sw >= x + w && sy + sh >= y + h, `${look}: the frame holds the picture`);
  }
});

test('boxes: screen, image and one per step, mapped from page px; a step with no box is the whole picture', () => {
  const prepared = { w: committed() };
  const { boxes } = expandWalk(walkFilm(), prepared);
  assert.deepEqual(Object.keys(boxes).sort(), ['image', 'screen', ...STEPS.map((id) => `step:${id}`)].sort());
  const [ix, iy, iw, ih] = boxes.image;
  const tab = prepared.w.steps.find((s) => s.id === 'tab').box;
  const [bx, by, bw, bh] = boxes['step:tab'];
  near(bx, ix + (tab.x / 960) * iw, 'tab x');
  near(by, iy + (tab.y / 540) * ih, 'tab y');
  near(bw, (tab.width / 960) * iw, 'tab width');
  near(bh, (tab.height / 540) * ih, 'tab height');
  assert.deepEqual(boxes['step:open'], boxes.image);
});

test('a step box that reaches past the page is cut to the picture', () => {
  const data = handTake([30], [[900, 500, 200, 200]]);
  const { boxes } = expandWalk(filmOfWalk(data), { w: data });
  const [ix, iy, iw, ih] = boxes.image;
  const [x, y, w, h] = boxes['step:s0'];
  near(x + w, ix + iw, 'right edge');
  near(y + h, iy + ih, 'bottom edge');
  assert.ok(w > 0 && h > 0 && x >= ix && y >= iy);
});

test('the title sits in the browser chrome, and an on device can aim at a step', () => {
  const prepared = { w: committed() };
  const out = expandWalk(walkFilm(walkShot({ title: 'Shop', on: [{ at: 'sentence:2', do: 'circle', target: 'step:search' }] })), prepared);
  assert.ok(all(out.nodes).some((n) => n.id === 'w.title'));
  assert.ok(all(out.nodes).some((n) => n.id.startsWith('w.on0')), 'the circle is built on the step\'s box');
});

test('the shot stretches to its steps: its timeline entry lasts at least the plan\'s end', () => {
  const data = handTake([60, 60], [[10, 10, 100, 40], [500, 300, 100, 40]]);
  const out = expandWalk(filmOfWalk(data, { hold: 1 }), { w: data });
  assert.ok(out.plan.end > 1);
  assert.ok(out.timing.duration >= out.plan.end - 1e-9, `${out.timing.duration} vs ${out.plan.end}`);
});

const filmOfWalk = (data, extra = {}) => walkFilm(handShot(data, extra));

// ---- findings ----

const reviewOf = (film, data) => walk.review(film.shots[0], reviewCtx(film, { w: data })).map((f) => `${f.path}: ${f.message}`);
const TEXT_RE = /page text of/;
const bigBoxes = [[100, 80, 700, 400], [100, 80, 700, 400], [100, 80, 700, 400]];

test('the committed take with no stops reviews clean, and a first whole stop with no at is the shot start, not a finding', () => {
  const prepared = { w: committed() };
  assert.deepEqual(walk.review(walkShot(), reviewCtx(walkFilm(), prepared)), []);
  const start = walkFilm(walkShot({ stops: [{ to: 'whole' }] }));
  assert.deepEqual(walk.review(start.shots[0], reviewCtx(start, prepared)), []);
  const later = walkFilm(walkShot({ stops: [{ to: 'whole', at: 'sentence:2' }] }));
  assert.deepEqual(walk.review(later.shots[0], reviewCtx(later, prepared)).map((f) => f.message), ['stop 1 has no room to move']);
});

test('the review says nothing without the prepared take', () => {
  const film = walkFilm();
  assert.deepEqual(walk.review(film.shots[0], { ...reviewCtx(film, { w: committed() }), prepared: undefined }), []);
});

test('text size: page text that shows under 26 px at a stop the take\'s pixels stop short: the message says lift it', () => {
  const data = { ...handTake([30, 30, 30], [[40, 40, 120, 60], [400, 200, 120, 60], [700, 400, 120, 60]], { textPx: 5 }), width: 1920, height: 1080, scale: 2 }; // a take at 2x: its native zoom is under the push (s1 is not the last step)
  const found = reviewOf(filmOfWalk(data, { stops: [{ to: 'step:s1' }] }), data);
  assert.equal(found.length, 1, found.join(' | '));
  assert.match(found[0], /^stops\[0\]: step "s1": page text of 5 px shows at \d+(\.\d)? px at its stop; the take's own resolution stops the push at \d\.\dx; lift it instead$/);
});

test('text size: page text that shows under 26 px at a stop with room to push: push closer or lift it', () => {
  const data = handTake([30, 30, 30], bigBoxes, { textPx: 5 });
  const found = reviewOf(filmOfWalk(data, { stops: [{ to: 'step:s1' }] }), data);
  assert.equal(found.length, 1, found.join(' | '));
  assert.match(found[0], /^stops\[0\]: step "s1": page text of 5 px shows at \d+(\.\d)? px at its stop; push closer or lift it$/);
});

test('text size: readable text, an unknown size and a whole stop are silent', () => {
  const read = handTake([30, 30], [[40, 40, 120, 60], [400, 200, 120, 60]], { textPx: 16 });
  assert.deepEqual(reviewOf(filmOfWalk(read, { stops: [{ to: 'step:s1' }] }), read).filter((f) => TEXT_RE.test(f)), []);
  const unknown = handTake([30, 30], [[40, 40, 120, 60], [400, 200, 120, 60]], { textPx: null });
  assert.deepEqual(reviewOf(filmOfWalk(unknown, { stops: [{ to: 'step:s1' }] }), unknown).filter((f) => TEXT_RE.test(f)), []);
  const tiny = handTake([30, 30], [[40, 40, 120, 60], [400, 200, 120, 60]], { textPx: 3 });
  assert.deepEqual(reviewOf(filmOfWalk(tiny, { stops: [{ to: 'whole', at: 1.5 }] }), tiny).filter((f) => TEXT_RE.test(f)), []);
});

test('there is no standalone resolution finding: a small box that wants more than the take carries is silent when its text reads', () => {
  const data = handTake([30, 30], [[40, 40, 120, 60], [400, 200, 120, 60]]);
  assert.deepEqual(reviewOf(filmOfWalk(data, { stops: [{ to: 'step:s1' }] }), data), []);
  const unknown = handTake([30, 30], [[40, 40, 120, 60], [400, 200, 120, 60]], { textPx: null });
  assert.deepEqual(reviewOf(filmOfWalk(unknown, { stops: [{ to: 'step:s1' }] }), unknown), [], 'an unknown text size at a capped stop gets no finding');
});

test('the gate film\'s setup on the committed take (two step stops, a whole return, a lift, a circle) has zero findings in both looks', () => {
  const prepared = { w: committed() };
  const shot = walkShot({ stops: [{ to: 'step:tab' }, { to: 'step:add' }, { to: 'whole' }], lift: [{ step: 'hover' }], on: [{ at: 'sentence:3', do: 'circle', target: 'step:search' }] });
  for (const look of ['keynote', 'desk']) {
    const film = walkFilm(shot, { look });
    assert.deepEqual(walk.review(shot, reviewCtx(film, prepared)), [], look);
    const stops = walkSetup(shot, expandWalk(film, prepared).ctx).planned.stops;
    assert.ok(stops.filter((s) => s.id !== undefined).every((s) => Math.abs(s.zoom - Math.min(s.wanted, s.cap)) < 1e-9), `${look}: every step stop is the fit of its context, at most the take carries`);
  }
});

test('action leaves the frame: a step whose box is off screen at the pushed camera', () => {
  const data = handTake([30, 30], [[20, 20, 100, 40], [820, 440, 100, 40]]);
  const found = reviewOf(filmOfWalk(data, { stops: [{ to: 'step:s0' }] }), data).filter((f) => /leaves the frame/.test(f));
  assert.deepEqual(found, ['steps[1]: step "s1"\'s action leaves the frame']);
});

test('action leaves the frame: no stops, or a next step the pushed camera still shows, is silent', () => {
  const far = handTake([30, 30], [[20, 20, 100, 40], [820, 440, 100, 40]]);
  assert.deepEqual(reviewOf(filmOfWalk(far), far), []);
  const close = handTake([30, 30], [[20, 20, 100, 40], [200, 100, 100, 40]]);
  const found = reviewOf(filmOfWalk(close, { stops: [{ to: 'step:s0' }] }), close).filter((f) => /leaves the frame/.test(f));
  assert.deepEqual(found, []);
});

test('a take step the shot skips is a finding: the film jumps across it', () => {
  const prepared = { w: committed() };
  const film = walkFilm(walkShot({ say: 'Open it. Type it.', steps: [{ id: 'open' }, { id: 'search' }] }));
  assert.deepEqual(walk.review(film.shots[0], reviewCtx(film, prepared)).map((f) => f.message), ['take step "tab" is not in this shot\'s steps: the film jumps across it']);
  const ends = walkFilm(walkShot({ say: 'Pick it. Type it.', steps: [{ id: 'tab' }, { id: 'search' }] }));
  assert.deepEqual(walk.review(ends.shots[0], reviewCtx(ends, prepared)), [], 'steps before the first and after the last are not jumped across');
});

test('a stop that moves nothing has no room to move; a stop dropped for the next is a finding too', () => {
  const data = handTake([30, 30, 30], [[40, 40, 120, 60], [400, 200, 120, 60], [760, 420, 120, 60]]);
  const same = reviewOf(filmOfWalk(data, { stops: [{ to: 'whole' }, { to: 'whole', at: 3 }] }), data);
  assert.deepEqual(same, ['stops[1]: stop 2 has no room to move']);
  const dropped = reviewOf(filmOfWalk(data, { stops: [{ to: 'step:s1', at: 1.5 }, { to: 'step:s2', at: 1.6 }] }), data).filter((f) => /dropped/.test(f));
  assert.equal(dropped.length, 1);
  assert.match(dropped[0], /^stops\[0\]: stop 1 cannot land before stop 2 starts moving, so it is dropped/);
});

test('findings carry the second they are about, inside the shot', () => {
  const data = handTake([30, 30], [[40, 40, 120, 60], [400, 200, 120, 60]], { textPx: 5 });
  const film = filmOfWalk(data, { stops: [{ to: 'step:s1' }] });
  for (const f of walk.review(film.shots[0], reviewCtx(film, { w: data }))) assert.ok(f.at >= 0 && f.at <= 5, `${f.path} at ${f.at}`);
});

// ---- the notice ----

test('a walk shot on a signed-in take says so; a signed-out take, and every other kind, say nothing', () => {
  const film = filmOf([walkShot({ id: 'a' }), { id: 'b', show: 'statement', hold: 1, text: 'Hi' }, walkShot({ id: 'c' })], 'keynote');
  const prepared = { a: { ...committed(), signedIn: true }, c: committed() };
  assert.deepEqual(signedInNotices(film, prepared), ['shot "a" plays a signed-in take: its frames, sheets and film are the user\'s to look at; do not open them.']);
  assert.deepEqual(signedInNotices(film, {}), []);
});

// ---- the screen kind is untouched ----

// sha256 (first 16 hex) of the nodes, camera and boxes a screen shot expands to, taken before the layout helpers were exported
const SCREEN = { id: 's', show: 'screen', src: 'shot.png', say: 'This is the weekly report. The total sits at the bottom of the page.', title: 'Weekly report', url: 'example.com/report', regions: { total: [0.05, 0.6, 0.9, 0.3] }, zoom: 'total' };
const SCREEN_HASHES = {
  'desk 16:9 zoom': '06f8efb2d7ced861', 'desk 16:9 plain': '8ace3f3b754b0991', 'desk 16:9 phone': '2fbde0c7f9e8ce50',
  'desk 9:16 zoom': 'f38bcdc7210b8369', 'desk 9:16 plain': '316223b78572705e', 'desk 9:16 phone': '301ef94d2cde37ed',
  'keynote 16:9 zoom': '3192fca1ecebc36f', 'keynote 16:9 plain': '284dc98bfe125881', 'keynote 16:9 phone': '313c6b185a6d008a',
  'keynote 9:16 zoom': 'b6cb06d76ec5cd61', 'keynote 9:16 plain': '30648c4d26ad9c78', 'keynote 9:16 phone': '96780944be510133',
  'pop 9:16 zoom': '57b5f37b1cf441cd', 'pop 9:16 plain': 'cb4ad0a5b1d2cfb0', 'pop 9:16 phone': '14cd71c3b7eeb9b6',
  'pop 16:9 zoom': '377fd090204dd228', 'pop 16:9 plain': '51ed4ad92be09f2a', 'pop 16:9 phone': 'b55cbc62d373bf93',
};

test('expanding a screen shot is deep-equal to before the layout helpers were exported (hashes taken at the parent commit)', () => {
  const got = {};
  for (const [look, format] of [['desk', '16:9'], ['desk', '9:16'], ['keynote', '16:9'], ['keynote', '9:16'], ['pop', '9:16'], ['pop', '16:9']]) {
    for (const [name, shot] of [['zoom', SCREEN], ['plain', { ...SCREEN, regions: undefined, zoom: undefined }], ['phone', { ...SCREEN, src: 'phone.png' }]]) {
      const { nodes, camera, boxes } = expandIn(filmOf([shot], look, format));
      got[`${look} ${format} ${name}`] = createHash('sha256').update(JSON.stringify({ nodes, camera, boxes })).digest('hex').slice(0, 16);
    }
  }
  assert.deepEqual(got, SCREEN_HASHES);
});
