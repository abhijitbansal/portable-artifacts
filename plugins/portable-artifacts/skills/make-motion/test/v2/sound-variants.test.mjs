// Cue variants: a cue that sounds more than once in a film rotates through three takes (a new noise seed and a small
// detune each), so a repeated sound is not one sample stamped down again. Variant 0 is today's bytes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CUE_LAYERS, CUE_VARIANTS, VARIANT_CENTS, cueWav, layerCue, typingLayers, variantRatio } from '../../scripts/v2/sound/cue-synth.mjs';
import { KNOWN_CUES, cueSamples, renderCues, riserTo } from '../../scripts/v2/sound/synth.mjs';
import { mulberry32 } from '../../engine/seeded.mjs';

const RATE = 48000;
const HEADER = 44;
const BASE_PLAIN_SHA = 'c307781a0561c3881242a5dcdd3aae187424cf173f671aa0b4765424fd6d6198'; // pop at 1 s, click at 2 s, seed 1, 3 s: the bytes before variants existed
const BASE_ALL_ONCE_SHA = '604a5ddbd779f1c7f668cb78e1b23475071c80db0bc324124caee6f4251e18c9'; // every known cue once, seed 12345: measured on b32d5f0, before variants existed
const dir = mkdtempSync(path.join(tmpdir(), 'sound-variants-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const peakOf = (xs) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
// The `seconds` of the left channel of a 16-bit stereo WAV from time `t`.
function window(file, t, seconds) {
  const buf = readFileSync(file);
  const from = HEADER + Math.round(t * RATE) * 4;
  return Array.from({ length: Math.round(seconds * RATE) }, (_, i) => buf.readInt16LE(from + i * 4));
}

test('three takes, the first with no detune', () => {
  assert.equal(CUE_VARIANTS, 3);
  assert.deepEqual(VARIANT_CENTS, [0, 30, -30]);
});

test('typing: the 3 kHz ping of each key is detuned by the take ratio, as every other voice is', () => {
  const flat = () => 0.5; // no jitter and no noise burst: only the ping is left
  const crossings = (xs) => xs.reduce((n, x, i) => n + (i > 0 && (x > 0) !== (xs[i - 1] > 0) ? 1 : 0), 0);
  const ping = (ratio) => typingLayers(1, 0.05).transient(440 * ratio, flat, ratio);
  const [one, up] = [ping(1), ping(1.5)];
  assert.ok(Math.abs(crossings(up) / crossings(one) - 1.5) < 0.05, `${crossings(one)} crossings at ratio 1, ${crossings(up)} at 1.5`);
  assert.ok(Buffer.from(ping(1).buffer).equals(Buffer.from(typingLayers(1, 0.05).transient(440, flat).buffer)), 'ratio 1 is the layer as it was');
});

test('variant 0 is today: the same bytes with and without the argument', () => {
  for (const cue of Object.keys(CUE_LAYERS)) assert.ok(cueWav({ cue }).equals(cueWav({ cue, variant: 0 })), cue);
});

test('every cue the synth knows has three takes that differ and are the same length', () => {
  for (const cue of KNOWN_CUES) {
    const takes = [0, 1, 2].map((variant) => cueSamples(cue, { seed: 1, variant }));
    assert.equal(new Set(takes.map((t) => t.length)).size, 1, cue);
    assert.notDeepEqual(takes[0], takes[1], cue);
    assert.notDeepEqual(takes[1], takes[2], cue);
    assert.notDeepEqual(takes[0], takes[2], cue);
  }
});

test('cueSamples without a variant is variant 0', () => {
  for (const cue of KNOWN_CUES) assert.deepEqual(cueSamples(cue, { seed: 3 }), cueSamples(cue, { seed: 3, variant: 0 }), cue);
});

test('a take is the same bytes twice, and peaks where the cue peaks', () => {
  assert.deepEqual(cueSamples('whoosh', { seed: 7, variant: 2 }), cueSamples('whoosh', { seed: 7, variant: 2 }));
  // A detune moves where the peak falls, so the amplitude is compared within 2 %.
  for (const variant of [1, 2]) {
    const a = peakOf(cueSamples('pop', { seed: 1, variant }));
    const b = peakOf(cueSamples('pop', { seed: 1 }));
    assert.ok(Math.abs(a - b) <= 0.02 * b, `peak ${a} vs ${b}`);
  }
});

test('three whooshes in one film are three takes; the fourth is the first again', async () => {
  const out = path.join(dir, 'whoosh.wav');
  await renderCues([1, 2, 3, 4].map((t) => ({ t, cue: 'whoosh', gainDb: 0, pan: 0 })), { seconds: 5, seed: 1, out });
  const [a, b, c, d] = [1, 2, 3, 4].map((t) => window(out, t, 0.8));
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(b, c);
  assert.notDeepEqual(a, c);
  assert.deepEqual(a, d);
});

test('the n-th sounding is by time, not by list order', async () => {
  const cues = [1, 2, 3].map((t) => ({ t, cue: 'whoosh', gainDb: 0, pan: 0 }));
  const inOrder = path.join(dir, 'in-order.wav');
  const reversed = path.join(dir, 'reversed.wav');
  await renderCues(cues, { seconds: 5, seed: 1, out: inOrder });
  await renderCues([...cues].reverse(), { seconds: 5, seed: 1, out: reversed });
  assert.ok(readFileSync(inOrder).equals(readFileSync(reversed)));
});

test('each cue name counts on its own', async () => {
  const out = path.join(dir, 'mixed.wav');
  await renderCues([{ t: 1, cue: 'pop', gainDb: 0, pan: 0 }, { t: 2, cue: 'click', gainDb: 0, pan: 0 }, { t: 3, cue: 'pop', gainDb: 0, pan: 0 }], { seconds: 4, seed: 1, out });
  const solo = path.join(dir, 'solo.wav');
  await renderCues([{ t: 1, cue: 'pop', gainDb: 0, pan: 0 }, { t: 2, cue: 'click', gainDb: 0, pan: 0 }], { seconds: 4, seed: 1, out: solo });
  // the click at 2 s is its first click: the same as in a film with one pop
  assert.deepEqual(window(out, 2, 0.04), window(solo, 2, 0.04));
  // the second pop is a different take from the first
  assert.notDeepEqual(window(out, 1, 0.16), window(out, 3, 0.16));
});

// Zero crossings of `xs`: for band-limited noise it follows the band's centre, so a detune shows in it.
const crossings = (xs) => xs.reduce((n, x, i) => (i > 0 && (x < 0) !== (xs[i - 1] < 0) ? n + 1 : n), 0);
const MIN_RATIO = 1.02; // +30 against -30 cents is 1.035; averaging over seeds keeps the noise well under that

test('variantRatio: the detune of a take, 1 exactly for take 0, and a bad take is a prefixed RangeError', () => {
  assert.equal(variantRatio(0), 1);
  assert.ok(Math.abs(variantRatio(1) - 2 ** (30 / 1200)) < 1e-12);
  assert.ok(Math.abs(variantRatio(2) - 2 ** (-30 / 1200)) < 1e-12);
  assert.throws(() => variantRatio(3, 'somewhere'), /^RangeError: somewhere: variant must be/);
  assert.throws(() => cueWav({ cue: 'pop', variant: 3 }), /^RangeError: cueWav: variant must be/);
  assert.throws(() => cueSamples('pop', { seed: 1, variant: -1 }), /^RangeError: cueSamples: variant must be/);
  assert.throws(() => riserTo(1, { seed: 1, variant: 1.5 }), /^RangeError: riserTo: variant must be/);
});

test('the noise cues of version 1 are detuned: the same noises through a band moved +30 against -30 cents cross zero 2 % or more oftener', () => {
  for (const cue of ['click', 'whoosh', 'swoosh', 'riser']) {
    const body = { ...CUE_LAYERS[cue], transient: undefined, tail: undefined }; // the filtered noise alone: a click's burst is broadband
    const mean = (variant) => Array.from({ length: 24 }, (_, seed) => crossings(layerCue(body, 440, mulberry32(seed), variantRatio(variant)).left)).reduce((a, b) => a + b, 0) / 24;
    const ratio = mean(1) / mean(2);
    assert.ok(ratio >= MIN_RATIO, `${cue}: ${ratio}`);
  }
});

test('the new noise voices and the riser are detuned: over 24 seeds take 1 crosses zero 2 % or more oftener than take 2', () => {
  for (const cue of ['paper', 'marker', 'erase', 'riser']) {
    const mean = (variant) => Array.from({ length: 24 }, (_, seed) => crossings(cueSamples(cue, { seed, variant }))).reduce((a, b) => a + b, 0) / 24;
    const ratio = mean(1) / mean(2);
    assert.ok(ratio >= MIN_RATIO, `${cue}: ${ratio}`);
  }
});

test('a film that plays every cue once keeps its bytes, the new voices and the riser included', async () => {
  const out = path.join(dir, 'all-once.wav');
  const cues = KNOWN_CUES.map((cue, i) => ({ t: 0.5 + i * 1.5, cue, gainDb: -(i % 4) * 3, pan: ((i % 5) - 2) / 2 }));
  await renderCues(cues, { seconds: 0.5 + KNOWN_CUES.length * 1.5 + 2, seed: 12345, out });
  assert.equal(KNOWN_CUES.length, 13);
  assert.equal(createHash('sha256').update(readFileSync(out)).digest('hex'), BASE_ALL_ONCE_SHA);
});

test('a film that plays each cue once keeps its bytes', async () => {
  const out = path.join(dir, 'once.wav');
  await renderCues([{ t: 1, cue: 'pop', gainDb: 0, pan: 0 }, { t: 2, cue: 'click', gainDb: 0, pan: 0 }], { seconds: 3, seed: 1, out });
  assert.equal(createHash('sha256').update(readFileSync(out)).digest('hex'), BASE_PLAIN_SHA);
});
