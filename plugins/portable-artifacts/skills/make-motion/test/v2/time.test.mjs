import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ease } from '../../engine/time/ease.mjs';
import { track, sample } from '../../engine/time/track.mjs';
import { registries } from '../../engine/registry.mjs';
import { validateLook } from '../../engine/looks/index.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

test('sample holds before the first key and after the last', () => {
  const tr = track([{ t: 1, v: 10 }, { t: 2, v: 20, ease: 'linear' }]);
  assert.equal(sample(tr, 0), 10); assert.equal(sample(tr, 1.5), 15); assert.equal(sample(tr, 9), 20);
});
test('stepFps quantises time ("on twos" at 12 fps)', () => {
  const tr = track([{ t: 0, v: 0 }, { t: 1, v: 12, ease: 'linear' }]);
  assert.equal(sample(tr, 0.16, 12), 1); assert.equal(sample(tr, 0.17, 12), 2);
});
test('colours interpolate per channel', () => {
  assert.equal(sample(track([{ t: 0, v: '#000000' }, { t: 1, v: '#ffffff', ease: 'linear' }]), 0.5), '#808080');
});
test('a spring overshoots then settles at exactly 1', () => {
  const s = ease('spring(170,12)');
  assert.equal(s(0), 0); assert.equal(s(1), 1); assert.ok(Math.max(...[0.2, 0.3, 0.4, 0.5].map(s)) > 1);
});
test('an unknown ease names the closest', () => {
  assert.throws(() => ease('outCubik'), /did you mean "outCubic"/);
});

// ---- ease: curve family ----

const FAMILIES = ['Quad', 'Cubic', 'Quart', 'Expo', 'Back'];
const DIRECTIONS = ['in', 'out', 'inOut'];

test('every named ease starts at 0 and ends at 1', () => {
  for (const f of FAMILIES) for (const d of DIRECTIONS) {
    const fn = ease(`${d}${f}`);
    close(fn(0), 0); close(fn(1), 1);
  }
  assert.equal(ease('linear')(0.3), 0.3);
});
test('in eases lag, out eases lead, inOut eases pass through the midpoint', () => {
  for (const f of FAMILIES) {
    assert.ok(ease(`in${f}`)(0.5) < 0.5, `in${f}`);
    assert.ok(ease(`out${f}`)(0.5) > 0.5, `out${f}`);
    close(ease(`inOut${f}`)(0.5), 0.5, 1e-9);
  }
});
test('known values: quad, cubic, expo and the back undershoot', () => {
  close(ease('inQuad')(0.5), 0.25);
  close(ease('outCubic')(0.5), 0.875);
  close(ease('inOutQuart')(0.25), 0.03125);
  close(ease('inExpo')(0.5), 2 ** -5);
  assert.ok(ease('inBack')(0.2) < 0, 'inBack undershoots below 0');
  assert.ok(ease('outBack')(0.8) > 1, 'outBack overshoots above 1');
});
test('an ease name is case-sensitive and a name with no direction is unknown', () => {
  assert.throws(() => ease('Cubic'), /unknown ease "Cubic"/);
  assert.throws(() => ease(''), /unknown ease ""/);
});
test('the unknown-ease message lists what exists', () => {
  assert.throws(() => ease('nope'), /\(have: linear, inQuad, outQuad, inOutQuad/);
});
test('non-string ease names throw', () => {
  assert.throws(() => ease(undefined), /unknown ease/);
});

// ---- ease: spring ----

test('a spring is deterministic and returns the same curve each call', () => {
  const a = ease('spring(170,12)'); const b = ease('spring(170,12)');
  for (const p of [0.1, 0.37, 0.8]) assert.equal(a(p), b(p));
});
test('a spring is clamped outside [0, 1]', () => {
  const s = ease('spring(170,12)');
  assert.equal(s(-0.5), 0); assert.equal(s(2), 1);
});
test('a spring approaches 1 smoothly near the end (no visible snap)', () => {
  const s = ease('spring(170,12)');
  assert.ok(Math.abs(s(0.99) - 1) < 0.01, `s(0.99) = ${s(0.99)}`);
});
test('a more damped spring overshoots less', () => {
  const peak = (fn) => Math.max(...Array.from({ length: 200 }, (_, i) => fn(i / 199)));
  assert.ok(peak(ease('spring(170,12)')) > peak(ease('spring(170,24)')));
  assert.ok(peak(ease('spring(170,24)')) >= 1 - 1e-6);
});
test('a critically damped and an overdamped spring never overshoot and end at 1', () => {
  for (const name of ['spring(100,20)', 'spring(100,40)']) {
    const s = ease(name);
    assert.equal(s(0), 0); assert.equal(s(1), 1);
    for (let i = 0; i <= 100; i++) assert.ok(s(i / 100) <= 1 + 1e-3, `${name} at ${i / 100}`);
  }
});
test('spring accepts decimals and spaces', () => {
  const s = ease('spring( 170.5 , 12.25 )');
  assert.equal(s(1), 1);
});
test('a malformed or non-positive spring throws and says the form', () => {
  assert.throws(() => ease('spring(170)'), /spring\(<stiffness>,<damping>\)/);
  assert.throws(() => ease('spring(a,b)'), /spring\(<stiffness>,<damping>\)/);
  assert.throws(() => ease('spring(0,12)'), /stiffness and damping must be > 0/);
  assert.throws(() => ease('spring(170,0)'), /stiffness and damping must be > 0/);
});

// ---- ease: cubic-bezier and steps ----

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
test('cubic-bezier(0,0,1,1) is linear', () => { for (const p of [0.1, 0.3, 0.77]) near(ease('cubic-bezier(0,0,1,1)')(p), p); });
test('cubic-bezier matches the CSS ease and ease-in-out at the midpoint', () => {
  near(ease('cubic-bezier(0.25,0.1,0.25,1)')(0.5), 0.8024, 1e-3);
  near(ease('cubic-bezier(0.42,0,0.58,1)')(0.5), 0.5);
});
test('a cubic-bezier may overshoot and still ends on 1', () => {
  const f = ease('cubic-bezier(0.34, 1.56, 0.64, 1)');
  assert.ok(Math.max(...Array.from({ length: 101 }, (_, i) => f(i / 100))) > 1);
  assert.equal(f(0), 0); assert.equal(f(1), 1);
});
test('a cubic-bezier is clamped outside [0, 1]', () => {
  const f = ease('cubic-bezier(0,1,1,0)');
  assert.equal(f(-1), 0); assert.equal(f(2), 1);
  for (let i = 0; i <= 100; i++) assert.ok(Number.isFinite(f(i / 100)));
  near(f(0.5), 0.5);
});
test('a cubic-bezier whose slope is flat at the start still solves to a reference value', () => {
  // x1 = 0: dx/dt is ~6p at t = p, under the 1e-6 flat-slope limit for p = 1.5e-7, and x(p) - p is over the 1e-7 precision,
  // so the Newton step is refused and the bisection runs. Near t = 0, y = 1.5t^2 and x = 3t^2, so y is p / 2.
  const f = ease('cubic-bezier(0,0,1,0.5)');
  const p = 1.5e-7;
  near(f(p), p / 2, 6e-8);
  assert.ok(f(p) > 0);
  // and the curve is sane through its whole run
  let last = 0;
  for (let i = 1; i <= 200; i++) { const v = f(i / 200); assert.ok(v >= last - 1e-9, `monotonic at ${i}`); last = v; }
});
test('steps(4) holds each quarter and lands on 1', () => {
  const f = ease('steps(4)');
  assert.deepEqual([0, 0.24, 0.25, 0.5, 0.99, 1].map(f), [0, 0, 0.25, 0.5, 0.75, 1]);
  assert.deepEqual([-1, 2].map(f), [0, 1]);
});
test('steps(4,end) is steps(4); steps(4,start) jumps at the start of each quarter and still starts at 0', () => {
  assert.equal(ease('steps(4,end)')(0.3), 0.25);
  const f = ease('steps(4, start)');
  assert.deepEqual([0, 0.01, 0.25, 0.26, 1].map(f), [0, 0.25, 0.25, 0.5, 1]);
});
test('a bad cubic-bezier or steps says the form', () => {
  assert.throws(() => ease('cubic-bezier(1.2,0,0,1)'), /expected cubic-bezier\(<x1>,<y1>,<x2>,<y2>\) with x1 and x2 from 0 to 1/);
  assert.throws(() => ease('cubic-bezier(0,0,1)'), /expected cubic-bezier/);
  assert.throws(() => ease('cubic-bezier(0,0,1,a)'), /expected cubic-bezier/);
  assert.throws(() => ease(`cubic-bezier(0,${'9'.repeat(400)},1,1)`), /y1 and y2 must be finite numbers/);
  assert.throws(() => ease('steps(0)'), /expected steps\(<n>\) or steps\(<n>,start\|end\) with n from 1 to 120/);
  assert.throws(() => ease('steps(121)'), /with n from 1 to 120/);
  assert.throws(() => ease('steps(2.5)'), /with n from 1 to 120/);
  assert.throws(() => ease('steps(4,middle)'), /expected steps/);
});
test('a look may name either form as its punch ease and anywhere else it names an ease', () => {
  const look = (cutMotion) => () => validateLook({ ...registries.looks.get('desk'), name: 'test-ease', cutMotion });
  assert.doesNotThrow(look({ punchEase: 'cubic-bezier(0.2,0,0,1)' }));
  assert.doesNotThrow(look({ punchEase: 'steps(5,start)' }));
  assert.throws(look({ punchEase: 'cubic-bezier(2,0,0,1)' }), /cutMotion\.punchEase/);
  assert.throws(look({ punchEase: 'steps(0)' }), /cutMotion\.punchEase/);
  const desk = registries.looks.get('desk');
  for (const key of ['rise', 'enter']) { // a registered move, and a legacy key the kinds still read
    const move = (ease) => () => validateLook({ ...desk, name: 'test-ease-move', moves: { ...desk.moves, [key]: { ...desk.moves[key], ease } } });
    assert.doesNotThrow(move('steps(6)'), key);
    assert.doesNotThrow(move('cubic-bezier(0.2,0,0,1)'), key);
    assert.throws(move('bogus'), new RegExp(`look "test-ease-move": moves\\.${key}\\.ease: .*unknown ease "bogus"`), key);
    assert.throws(move('steps(0)'), new RegExp(`look "test-ease-move": moves\\.${key}\\.ease: .*expected steps`), key);
    assert.throws(move('cubic-bezier(2,0,0,1)'), new RegExp(`look "test-ease-move": moves\\.${key}\\.ease: .*expected cubic-bezier`), key);
  }
  const cover = (ease) => () => validateLook({ ...desk, name: 'test-ease-cover', cutStyle: { cover: { ease } } });
  assert.doesNotThrow(cover('steps(8,start)'));
  assert.doesNotThrow(cover('cubic-bezier(0.2,0,0,1)'));
});

// ---- track ----

test('the ease of key n shapes the segment from n-1 to n', () => {
  const tr = track([{ t: 0, v: 0 }, { t: 1, v: 100, ease: 'inQuad' }, { t: 2, v: 0, ease: 'linear' }]);
  close(sample(tr, 0.5), 25);
  close(sample(tr, 1.5), 50);
});
test('a key with no ease interpolates linearly', () => {
  const tr = track([{ t: 0, v: 0 }, { t: 2, v: 10 }]);
  close(sample(tr, 0.5), 2.5);
});
test('sample returns exact key values at the keys', () => {
  const tr = track([{ t: 0, v: 3 }, { t: 1, v: 7, ease: 'outBack' }, { t: 2, v: 9, ease: 'inOutCubic' }]);
  assert.equal(sample(tr, 0), 3); assert.equal(sample(tr, 1), 7); assert.equal(sample(tr, 2), 9);
});
test('a single key is a constant', () => {
  const tr = track([{ t: 5, v: 42 }]);
  assert.equal(sample(tr, 0), 42); assert.equal(sample(tr, 5), 42); assert.equal(sample(tr, 9), 42);
});
test('two keys at the same time make a step to the later value', () => {
  const tr = track([{ t: 0, v: 1 }, { t: 1, v: 1 }, { t: 1, v: 9, ease: 'linear' }, { t: 2, v: 9, ease: 'linear' }]);
  assert.equal(sample(tr, 0.999), 1); assert.equal(sample(tr, 1), 9);
});
test('arrays interpolate per element', () => {
  const tr = track([{ t: 0, v: [0, 10, 100] }, { t: 1, v: [10, 20, 0], ease: 'linear' }]);
  assert.deepEqual(sample(tr, 0.5), [5, 15, 50]);
});
test('sample returns a fresh array, never the stored one', () => {
  const tr = track([{ t: 0, v: [1, 2] }, { t: 1, v: [3, 4], ease: 'linear' }]);
  const a = sample(tr, 0); a[0] = 99;
  assert.deepEqual(sample(tr, 0), [1, 2]);
  const b = sample(tr, 9); b[0] = 99;
  assert.deepEqual(sample(tr, 9), [3, 4]);
});
test('track copies its input: later edits to the keys do not change the track', () => {
  const keys = [{ t: 0, v: 0 }, { t: 1, v: 10, ease: 'linear' }];
  const tr = track(keys);
  keys[1].v = 1000; keys.push({ t: 2, v: 5 });
  assert.equal(sample(tr, 1), 10);
  assert.equal(sample(tr, 9), 10);
});
test('colours accept upper case and hold at the ends', () => {
  const tr = track([{ t: 0, v: '#FF0000' }, { t: 1, v: '#0000ff', ease: 'linear' }]);
  assert.equal(sample(tr, -1), '#ff0000');
  assert.equal(sample(tr, 0.5), '#800080');
  assert.equal(sample(tr, 3), '#0000ff');
});
test('a colour channel never leaves 0-255 under an overshooting ease', () => {
  const tr = track([{ t: 0, v: '#000000' }, { t: 1, v: '#ffffff', ease: 'outBack' }]);
  for (let i = 0; i <= 100; i++) assert.match(sample(tr, i / 100), /^#[0-9a-f]{6}$/);
});
test('other strings step: hold the earlier value until the next key', () => {
  const tr = track([{ t: 0, v: 'one' }, { t: 1, v: 'two' }, { t: 2, v: 'three' }]);
  assert.equal(sample(tr, 0.99), 'one'); assert.equal(sample(tr, 1), 'two'); assert.equal(sample(tr, 5), 'three');
});
test('stepFps snaps to the frame start and leaves exact boundaries alone', () => {
  const tr = track([{ t: 0, v: 0 }, { t: 1, v: 24, ease: 'linear' }]);
  assert.equal(sample(tr, 0.5, 24), 12);
  assert.equal(sample(tr, 0.49, 24), 11);
  assert.equal(sample(tr, 1, 24), 24);
});
test('stepFps applies before the ease is evaluated', () => {
  const tr = track([{ t: 0, v: 0 }, { t: 1, v: 100, ease: 'inQuad' }]);
  close(sample(tr, 0.3, 2), 0);
  close(sample(tr, 0.6, 2), 25);
});
test('a bad stepFps throws', () => {
  const tr = track([{ t: 0, v: 0 }]);
  assert.throws(() => sample(tr, 0, 0), /stepFps/);
  assert.throws(() => sample(tr, 0, -12), /stepFps/);
  assert.throws(() => sample(tr, 0, Number.NaN), /stepFps/);
});
test('sample rejects a non-finite time', () => {
  const tr = track([{ t: 0, v: 0 }]);
  assert.throws(() => sample(tr, Number.NaN), /finite/);
  assert.throws(() => sample(tr, undefined), /finite/);
});

// ---- track: validation ----

test('track rejects an empty or non-array key list', () => {
  assert.throws(() => track([]), /at least one key/);
  assert.throws(() => track(null), /at least one key/);
});
test('track rejects out-of-order or non-finite times', () => {
  assert.throws(() => track([{ t: 1, v: 0 }, { t: 0, v: 1 }]), { message: /^keys\[1\]\.t: .*ascending/ });
  assert.throws(() => track([{ t: Number.NaN, v: 0 }]), { message: /^keys\[0\]\.t: must be a finite number/ });
  assert.throws(() => track([{ t: '1', v: 0 }]), { message: /^keys\[0\]\.t: must be a finite number/ });
});
test('track rejects mixed value types and ragged arrays', () => {
  assert.throws(() => track([{ t: 0, v: 1 }, { t: 1, v: 'x' }]), { message: /^keys\[1\]\.v: must be a number/ });
  assert.throws(() => track([{ t: 0, v: [1, 2] }, { t: 1, v: [1] }]), { message: /^keys\[1\]\.v: must be an array of 2 numbers/ });
  assert.throws(() => track([{ t: 0, v: '#000000' }, { t: 1, v: 'red' }]), { message: /^keys\[1\]\.v: must be a #rrggbb colour/ });
});
test('track rejects values it cannot interpolate', () => {
  assert.throws(() => track([{ t: 0, v: Number.NaN }]), { message: /^keys\[0\]\.v: / });
  assert.throws(() => track([{ t: 0, v: [1, 'a'] }]), { message: /^keys\[0\]\.v: / });
  assert.throws(() => track([{ t: 0, v: {} }]), { message: /^keys\[0\]\.v: / });
  assert.throws(() => track([{ t: 0 }]), { message: /^keys\[0\]\.v: / });
});
test('a stepped string keeps its case', () => {
  const tr = track([{ t: 0, v: 'Hello' }, { t: 1, v: 'World', ease: 'linear' }]);
  assert.equal(sample(tr, 0), 'Hello');
  assert.equal(sample(tr, 0.5), 'Hello');
  assert.equal(sample(tr, 1), 'World');
});
test('a string that starts with # but is not #rrggbb throws instead of stepping', () => {
  for (const bad of ['#fff', '#ff000080', '#ggg000', '#']) {
    assert.throws(() => track([{ t: 0, v: bad }]), { message: /^keys\[0\]\.v: colours must be #rrggbb/ }, bad);
    assert.throws(() => track([{ t: 0, v: '#000000' }, { t: 1, v: bad }]), { message: /^keys\[1\]\.v: colours must be #rrggbb/ }, bad);
  }
});
test('an array value stored in a track is frozen', () => {
  const tr = track([{ t: 0, v: [1, 2] }, { t: 1, v: [3, 4] }]);
  assert.ok(Object.isFrozen(tr.points[0].v));
  assert.ok(Object.isFrozen(tr.points[1].v));
  assert.throws(() => { tr.points[0].v[0] = 99; }, TypeError);
  assert.deepEqual(sample(tr, 0), [1, 2]);
});
test('track and sample errors read "<path>: <message>"', () => {
  assert.throws(() => track([]), { message: /^keys: must have at least one key/ });
  assert.throws(() => sample(track([{ t: 0, v: 0 }]), Number.NaN), { message: /^sample t: must be a finite number/ });
  assert.throws(() => sample(track([{ t: 0, v: 0 }]), 0, 0), { message: /^sample stepFps: must be a finite number > 0/ });
});
test('track names the key whose ease is unknown', () => {
  assert.throws(() => track([{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'outCubik' }]), { message: /^keys\[1\]\.ease: .*did you mean "outCubic"/ });
});
