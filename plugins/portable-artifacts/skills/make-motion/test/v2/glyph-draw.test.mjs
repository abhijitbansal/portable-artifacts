// The glyph path of engine/page/draw.mjs (engine/page/glyph-draw.mjs) with a recording fake 2D context: where each glyph is
// drawn, which calls are skipped, and when a word is drawn whole. The browser test (glyphs-browser.test.mjs) holds the real
// pixels; this one holds each branch the identity path never reaches.
// The fake: every glyph is 10 wide, a kerned pair "AV" pulls its second glyph 2 closer (as a GPOS kern does, on the first
// glyph's advance), and a word "fi" drawn whole is one ligature shape the two letters drawn apart do not make. A scratch
// canvas (the faithfulness check) is the same fake, and its picture is the list of glyph shapes it holds with their places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawFrame } from '../../engine/page/draw.mjs';
import { graphemesOf, setGlyphPath } from '../../engine/page/glyph-draw.mjs';

const ADVANCE = 10;
const KERN = { AV: 2 };
const widthOf = (text) => {
  const chars = graphemesOf(text);
  const kerns = Object.entries(KERN).reduce((sum, [pair, by]) => sum + by * (text.split(pair).length - 1), 0);
  return ADVANCE * chars.length - kerns;
};

// The shapes a fillText leaves, as [shape, x]: a word drawn whole is one shape per glyph at the whole word's own places,
// except a ligature, which is one shape.
function shapesOf(text, x) {
  if (text === 'fi') return [['LIG', x]];
  const chars = graphemesOf(text);
  return chars.map((char, k) => [char, x + widthOf(chars.slice(0, k + 1).join('')) - widthOf(char)]);
}

function fakeContext() {
  const log = [];
  let state = { alpha: 1, m: [1, 0, 0, 1, 0, 0] };
  const stack = [];
  const at = (x, y) => [state.m[4] + state.m[0] * x, state.m[5] + state.m[3] * y];
  const ctx = {
    log,
    canvas: { width: 1000, height: 400 },
    font: '', fontStretch: 'normal', letterSpacing: '0px', textBaseline: '', textAlign: '', fillStyle: '', strokeStyle: '',
    globalCompositeOperation: 'source-over', filter: 'none', lineWidth: 1, lineJoin: '', lineCap: '',
    get globalAlpha() { return state.alpha; },
    set globalAlpha(v) { state = { ...state, alpha: v }; },
    save() { stack.push(state); },
    restore() { state = stack.pop(); },
    setTransform() { state = { ...state, m: [1, 0, 0, 1, 0, 0] }; },
    transform() {},
    translate(x, y) { const [e, f] = at(x, y); state = { ...state, m: [state.m[0], 0, 0, state.m[3], e, f] }; },
    scale(sx, sy) { state = { ...state, m: [state.m[0] * sx, 0, 0, state.m[3] * sy, state.m[4], state.m[5]] }; },
    measureText(text) {
      const width = widthOf(text);
      return { width, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width };
    },
    fillText(text, x, y) { const [px, py] = at(x, y); log.push({ op: 'fillText', text, x: px, y: py, scale: state.m[0], alpha: state.alpha }); },
    strokeText(text, x, y) { const [px, py] = at(x, y); log.push({ op: 'strokeText', text, x: px, y: py, scale: state.m[0], alpha: state.alpha }); },
  };
  return ctx;
}

// The scratch canvas of the faithfulness check: its picture is the shapes its fillText calls made, in a typed array.
class FakeOffscreenCanvas {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    const ctx = fakeContext();
    const clear = ctx.log;
    ctx.getImageData = () => ({ data: new Uint8ClampedArray(Buffer.from(JSON.stringify(clear.filter((c) => c.op === 'fillText').flatMap((c) => shapesOf(c.text, c.x))))) });
    ctx.clearRect = () => { clear.length = 0; };
    return ctx;
  }
}
globalThis.OffscreenCanvas = FakeOffscreenCanvas;

const FONT = { family: 'Fake', size: 40, weight: 700 };
const GLOW = { color: '#ffd24a', alpha: 0.8, radius: 12 };
const ID = { opacity: 1, x: 0, y: 0, scale: 1 };

// One word on one line at (0, 0), centred on the origin (its left is -width / 2), drawn through drawFrame.
function drawWord(text, wordTracks, { glow } = {}) {
  const ctx = fakeContext();
  const width = widthOf(text);
  const node = {
    type: 'text', id: 't', x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1, scale: 1, opacity: 1, reveal: 1, blur: 0, children: [],
    props: { font: FONT, layout: { lines: [{ x: 0, y: 0, words: [{ text, x: -width / 2, width, index: 0 }] }] }, ...(glow ? { glow } : {}) },
    words: [wordTracks],
  };
  drawFrame(ctx, [node], { canvas: { w: 1000, h: 400 } });
  const left = -width / 2; // the word's centre is its x + width / 2 = 0
  return { ctx, left, fills: ctx.log.filter((c) => c.op === 'fillText'), strokes: ctx.log.filter((c) => c.op === 'strokeText') };
}
const word = (extra) => ({ opacity: 1, x: 0, y: 0, scale: 1, ...extra });

test('every glyph at the identity: the word is drawn whole, in one fillText', () => {
  const { fills, left } = drawWord('AVAX', word({ glyphs: [ID, ID, ID, ID] }));
  assert.deepEqual(fills.map((f) => [f.text, f.x]), [['AVAX', left]]);
});

test('no glyph values: the word is drawn whole', () => {
  const { fills } = drawWord('AVAX', word());
  assert.deepEqual(fills.map((f) => f.text), ['AVAX']);
});

test('a glyph of opacity 0 is skipped; the others are drawn at their own places', () => {
  const { fills } = drawWord('ABC', word({ glyphs: [ID, { ...ID, opacity: 0 }, ID] }));
  assert.deepEqual(fills.map((f) => f.text), ['A', 'C']);
});

test('a glyph draws at the advance the whole word gives it: the kern pair AV pulls V in by 2, as the whole word does', () => {
  const { fills, left } = drawWord('AVA', word({ glyphs: [{ ...ID, opacity: 0.5 }, ID, ID] }));
  assert.deepEqual(fills.map((f) => [f.text, f.x - left]), [['A', 0], ['V', 8], ['A', 18]]);
  assert.equal(fills[0].alpha, 0.5);
});

test('x and y offsets move a glyph and nothing else', () => {
  const { fills, left } = drawWord('ABC', word({ glyphs: [ID, { ...ID, x: 7, y: -3 }, ID] }));
  assert.deepEqual(fills.map((f) => [f.text, f.x - left, f.y]), [['A', 0, 0], ['B', 17, -3], ['C', 20, 0]]);
});

test('a scaled glyph scales about its own centre on the baseline', () => {
  const { fills, left } = drawWord('ABC', word({ glyphs: [ID, { ...ID, scale: 2 }, ID] }));
  const b = fills.find((f) => f.text === 'B');
  assert.equal(b.scale, 2);
  assert.equal(b.y, 0);
  // B's origin is 10 and its centre 15; drawn at twice the size its left edge is 15 - 2 * 5 = 5 and its centre is still 15
  assert.equal(b.x - left, 5);
  assert.equal(b.x - left + (ADVANCE / 2) * b.scale, 15);
});

test('a glyph value that is not a number is read as the identity (no NaN reaches the canvas)', () => {
  const bad = { opacity: Number.NaN, x: Number.NaN, y: Number.NaN, scale: Number.NaN };
  const whole = drawWord('ABC', word({ glyphs: [bad, bad, bad] }));
  assert.deepEqual(whole.fills.map((f) => f.text), ['ABC']);
  const mixed = drawWord('ABC', word({ glyphs: [bad, { ...ID, opacity: 0.5 }, bad] }));
  assert.ok(mixed.fills.every((f) => Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.scale) && Number.isFinite(f.alpha)));
  assert.deepEqual(mixed.fills.map((f) => f.text), ['A', 'B', 'C']);
});

test('a missing glyph value is the identity: a short list leaves the rest in place', () => {
  const { fills, left } = drawWord('ABC', word({ glyphs: [{ ...ID, x: 5 }] }));
  assert.deepEqual(fills.map((f) => [f.text, f.x - left]), [['A', 5], ['B', 10], ['C', 20]]);
});

test('a word whose letters draw differently apart (a ligature) is drawn whole, whatever its glyph values', () => {
  const { fills } = drawWord('fi', word({ glyphs: [{ ...ID, opacity: 0 }, ID] }));
  assert.deepEqual(fills.map((f) => f.text), ['fi']);
});

test('a right-to-left word is drawn whole', () => {
  for (const text of ['שלום', 'مرحبا']) {
    const { fills } = drawWord(text, word({ glyphs: graphemesOf(text).map(() => ({ ...ID, opacity: 0.5 })) }));
    assert.deepEqual(fills.map((f) => f.text), [text]);
  }
});

test('a glyph is a grapheme: a decomposed accent is one glyph, drawn with its letter', () => {
  const text = 'café';
  assert.equal(graphemesOf(text).length, 4);
  const { fills } = drawWord(text, word({ glyphs: [ID, ID, ID, { ...ID, opacity: 0.5 }] }));
  assert.deepEqual(fills.map((f) => f.text), ['c', 'a', 'f', 'é']);
});

test('the test seam draws every word glyph by glyph at the identity, and a word that cannot be drawn so stays whole', () => {
  setGlyphPath(true);
  try {
    assert.deepEqual(drawWord('ABC', word()).fills.map((f) => f.text), ['A', 'B', 'C']);
    assert.deepEqual(drawWord('fi', word()).fills.map((f) => f.text), ['fi']);
    assert.deepEqual(drawWord('שלום', word()).fills.map((f) => f.text), ['שלום']);
  } finally {
    setGlyphPath(false);
  }
  assert.deepEqual(drawWord('ABC', word()).fills.map((f) => f.text), ['ABC']);
});

test('a glowing word with every glyph at rest strokes its halo whole; glyphs still arriving each carry their own halo', () => {
  const rest = drawWord('ABC', word({ glow: 1, glyphs: [ID, ID, ID] }), { glow: GLOW });
  assert.ok(rest.strokes.length > 0);
  assert.ok(rest.strokes.every((s) => s.text === 'ABC'), 'one halo round the whole word');

  const arriving = drawWord('ABC', word({ glow: 1, glyphs: [{ ...ID, opacity: 0.5 }, { ...ID, opacity: 0 }, ID] }), { glow: GLOW });
  const halos = (char) => arriving.strokes.filter((s) => s.text === char);
  assert.ok(arriving.strokes.every((s) => ['A', 'C'].includes(s.text)), 'no halo for the glyph that has not arrived, none for the whole word');
  assert.ok(halos('A').length > 0 && halos('C').length > 0);
  assert.ok(halos('A').every((s) => s.alpha === 0.5), 'a half-arrived glyph has half its halo');
  assert.ok(halos('C').every((s) => s.alpha === 1));
  // every halo is stroked before any letter is filled: the light lies under the type
  const lastStroke = arriving.ctx.log.map((c) => c.op).lastIndexOf('strokeText');
  assert.ok(lastStroke < arriving.ctx.log.findIndex((c) => c.op === 'fillText'));
});

test('a glowing word with no glyph values strokes its halo whole, as before', () => {
  const { strokes, fills } = drawWord('ABC', word({ glow: 1 }), { glow: GLOW });
  assert.ok(strokes.length > 0 && strokes.every((s) => s.text === 'ABC'));
  assert.deepEqual(fills.map((f) => f.text), ['ABC']);
});
