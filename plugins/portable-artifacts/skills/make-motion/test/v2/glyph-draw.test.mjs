// The glyph path of engine/page/draw.mjs (engine/page/glyph-draw.mjs) with a recording fake 2D context: where each glyph is
// drawn, which calls are skipped, and when a word is drawn whole. The browser test (glyphs-browser.test.mjs) holds the real
// pixels; this one holds each branch the identity path never reaches.
// The fake: every glyph is 10 wide, a kerned pair "AV" pulls its second glyph 2 closer (as a GPOS kern does, on the first
// glyph's advance), and a word "fi" drawn whole is one ligature shape the two letters drawn apart do not make. A scratch
// canvas (the faithfulness check) is the same fake, and its picture is the list of glyph shapes it holds with their places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { drawFrame } from '../../engine/page/draw.mjs';
import { faithfulOf, glyphRollup, graphemesOf, setGlyphPath } from '../../engine/page/glyph-draw.mjs';

const ADVANCE = 10;
const KERN = { AV: 2 };
const widthOf = (text) => {
  const chars = graphemesOf(text);
  const kerns = Object.entries(KERN).reduce((sum, [pair, by]) => sum + by * (text.split(pair).length - 1), 0);
  return ADVANCE * chars.length - kerns;
};

// The shapes a fillText leaves, as [shape, x]: a word drawn whole is one shape per glyph at the whole word's own places,
// except a ligature, which is one shape.
let failWeight = null; // when set, a whole word checked in this font weight differs from its letters apart (see the scratch canvas)
let failPhase = null; // when set, a whole word drawn at this quarter pixel leaves one more shape than its letters apart
function shapesOf(text, x) {
  if (text === 'fi') return [['LIG', x]];
  const chars = graphemesOf(text);
  const odd = failPhase !== null && chars.length > 1 && Math.abs(((x % 1) + 1) % 1 - failPhase) < 1e-9 ? [['PHASE', x]] : [];
  return [...odd, ...chars.map((char, k) => [char, x + widthOf(chars.slice(0, k + 1).join('')) - widthOf(char)])];
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
    getTransform() { return { a: state.m[0], e: state.m[4] }; },
    translate(x, y) { const [e, f] = at(x, y); state = { ...state, m: [state.m[0], 0, 0, state.m[3], e, f] }; },
    scale(sx, sy) { state = { ...state, m: [state.m[0] * sx, 0, 0, state.m[3] * sy, state.m[4], state.m[5]] }; },
    measureText(text) {
      // the width carries the letter spacing after every glyph, as the browser's does
      const width = widthOf(text) + (Number.parseFloat(ctx.letterSpacing) || 0) * graphemesOf(text).length;
      return { width, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width };
    },
    fillText(text, x, y) { const [px, py] = at(x, y); log.push({ op: 'fillText', text, x: px, y: py, scale: state.m[0], alpha: state.alpha }); },
    strokeText(text, x, y) { const [px, py] = at(x, y); log.push({ op: 'strokeText', text, x: px, y: py, scale: state.m[0], alpha: state.alpha }); },
  };
  return ctx;
}

// The scratch canvas of the faithfulness check: its picture is the shapes its fillText calls made, in a typed array.
const scratches = []; // each scratch context made, so a test can read the whole-word draw of its check
class FakeOffscreenCanvas {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    const ctx = fakeContext();
    const clear = ctx.log;
    scratches.push(ctx);
    ctx.drawn = []; // every fillText of the check, kept after clearRect: the whole-word draw comes first
    const fill = ctx.fillText;
    ctx.fillText = (text, x, y) => { ctx.drawn.push({ text, x }); fill(text, x, y); };
    // failWeight: a whole word drawn in this weight leaves one more shape than its letters apart (a face whose heavy instance
    // shapes a word differently)
    const heavy = () => failWeight !== null && ctx.font.startsWith(`${failWeight} `);
    const shapes = (c) => [...(heavy() && graphemesOf(c.text).length > 1 ? [['HEAVY', c.x]] : []), ...shapesOf(c.text, c.x)];
    ctx.getImageData = () => ({ data: new Uint8ClampedArray(Buffer.from(JSON.stringify(clear.filter((c) => c.op === 'fillText').flatMap(shapes)))) });
    ctx.clearRect = () => { clear.length = 0; };
    return ctx;
  }
}
globalThis.OffscreenCanvas = FakeOffscreenCanvas;

const FONT = { family: 'Fake', size: 40, weight: 700 };
const GLOW = { color: '#ffd24a', alpha: 0.8, radius: 12 };
const ID = { opacity: 1, x: 0, y: 0, scale: 1 };

// One word on one line at (0, 0), centred on the origin (its left is -width / 2), drawn through drawFrame.
function drawWord(text, trackValues, { glow, shift = 0, font = FONT, reserve, lines, widthless = false } = {}) {
  const ctx = fakeContext();
  const width = widthOf(text);
  const { glyphs, ...wordTracks } = trackValues; // a sampled node carries the glyph values beside the words' (sampled.glyphs)
  const node = {
    type: 'text', id: 't', x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1, scale: 1, opacity: 1, reveal: 1, blur: 0, children: [],
    props: { font, layout: { lines: [{ x: 0, y: 0, ...(widthless ? {} : { width }), words: [{ text, x: -width / 2 + shift, width, index: 0 }] }], ...(reserve ? { reserve } : {}) }, ...(glow ? { glow } : {}) },
    words: [wordTracks],
    ...(glyphs ? { glyphs: [glyphs] } : {}),
    ...(lines ? { lines } : {}),
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

// ---- a word drawn whole still arrives with its letters ----

test('a rejected word whose glyphs are all at opacity 0 draws nothing, halo included', () => {
  const none = { ...ID, opacity: 0 };
  const plain = drawWord('fi', word({ glyphs: [none, none] }));
  assert.deepEqual(plain.fills, []);
  const glowing = drawWord('fi', word({ glow: 1, glyphs: [none, none] }), { glow: GLOW });
  assert.deepEqual([glowing.fills, glowing.strokes], [[], []]);
  const rtl = drawWord('שלום', word({ glyphs: graphemesOf('שלום').map(() => none) }));
  assert.deepEqual(rtl.fills, []);
});

test('a rejected word is drawn whole with the mean of its glyph values: opacity, offset and scale', () => {
  const { fills, left } = drawWord('fi', word({ glyphs: [{ opacity: 0, x: 0, y: 0, scale: 1 }, { opacity: 1, x: 10, y: -4, scale: 1.5 }] }));
  assert.equal(fills.length, 1);
  const [fill] = fills;
  assert.equal(fill.text, 'fi');
  assert.equal(fill.alpha, 0.5);
  assert.equal(fill.y, -2);
  assert.equal(fill.scale, 1.25);
  // centred on the word's centre (the origin), moved by the mean offset 5: its left edge is -width / 2 * 1.25 + 5
  assert.equal(fill.x, left * 1.25 + 5);
});

test('a rejected word with every glyph at the identity is drawn whole, untouched', () => {
  const { fills, left } = drawWord('fi', word({ glyphs: [ID, ID] }));
  assert.deepEqual(fills.map((f) => [f.text, f.x, f.alpha, f.scale]), [['fi', left, 1, 1]]);
});

test('the test seam can set the glyph values every word is drawn with: a rejected word follows them too', () => {
  setGlyphPath(true, { opacity: 0 });
  try {
    assert.deepEqual(drawWord('ABC', word()).fills, []);
    assert.deepEqual(drawWord('fi', word()).fills, []);
  } finally {
    setGlyphPath(false);
  }
});

// Canvases a faithfulness check drew on (the measuring probe draws nothing): one per word checked.
const checks = () => scratches.filter((c) => c.drawn.length > 0).length;

test('a word moved by sub-pixel offsets from frame to frame keeps one verdict: it is checked once, and drawn by letter every frame', () => {
  const glyphs = [{ ...ID, opacity: 0.5 }, ID, ID];
  const before = checks();
  const drawn = [0, 0.3, 0.55, 0.8, 1.1].map((shift) => drawWord('PQR', word({ glyphs }), { shift }).fills.map((f) => f.text));
  assert.deepEqual(drawn, Array(5).fill(['P', 'Q', 'R']), 'letters drawn one by one at every offset, never the word whole');
  assert.equal(checks(), before + 1, 'one check for the word, whatever the offsets');
});

test('a word that differs at one quarter pixel only is drawn whole at every offset; one that passes was checked at all four', () => {
  const phasesOf = (word, since) => scratches.slice(since).flatMap((c) => c.drawn.filter((d) => d.text === word).map((d) => d.x % 1));
  const glyphs = [{ ...ID, opacity: 0.5 }, ID, ID];
  const offsets = [0, 0.3, 0.55, 0.8];
  const before = scratches.length;
  const passing = offsets.map((shift) => drawWord('MNO', word({ glyphs }), { shift }).fills.length);
  assert.deepEqual(passing, [3, 3, 3, 3]);
  assert.deepEqual([...new Set(phasesOf('MNO', before))].sort(), [0, 0.25, 0.5, 0.75], 'the whole word was drawn at all four quarters');
  failPhase = 0.5;
  try {
    const failing = offsets.map((shift) => drawWord('JKL', word({ glyphs }), { shift }).fills.map((f) => f.text));
    assert.deepEqual(failing, Array(4).fill(['JKL']), 'whole at every offset: the one it fails at and the ones it passes');
  } finally {
    failPhase = null;
  }
});

test('a word passes only if it passes at its emphasis weight too: a reserve weight that fails draws it whole', () => {
  const glyphs = [{ ...ID, opacity: 0.5 }, ID, ID];
  const reserve = { weight: 900 };
  failWeight = 900;
  try {
    // the base font (700) alone would pass; the reserved font (900), the heaviest weight an emphasis sweep reaches, does not
    assert.deepEqual(drawWord('DEF', word({ glyphs }), { reserve }).fills.map((f) => f.text), ['DEF']);
    assert.deepEqual(drawWord('DEF', word({ glyphs })).fills.map((f) => f.text), ['D', 'E', 'F'], 'with no reserve only the base font counts');
    assert.deepEqual(drawWord('GHI', word({ glyphs }), { reserve: { weight: 800 } }).fills.map((f) => f.text), ['G', 'H', 'I'], 'a reserve weight that passes keeps the glyph path');
  } finally {
    failWeight = null;
  }
});

test('the verdict is made on the base font: a weight sweep keeps one check', () => {
  const before = checks();
  const sweep = [400, 500, 600, 700].map((weight) => drawWord('XYZ', word({ weight, glyphs: [{ ...ID, opacity: 0.5 }, ID, ID] })).fills.map((f) => f.text).join(''));
  assert.deepEqual(sweep, Array(4).fill('XYZ'));
  assert.equal(checks(), before + 1);
});

test('the verdict is cached on the shaping settings that change shaping, not on the font alone', () => {
  const ctx = fakeContext();
  const before = checks();
  faithfulOf(ctx, FONT, 'STU');
  faithfulOf(ctx, FONT, 'STU');
  assert.equal(checks(), before + 1);
  const settings = [['fontKerning', 'none'], ['fontVariantCaps', 'small-caps'], ['textRendering', 'optimizeSpeed'], ['wordSpacing', '3px'], ['direction', 'rtl']];
  settings.forEach(([setting, value], i) => {
    ctx[setting] = value;
    faithfulOf(ctx, FONT, 'STU');
    assert.equal(checks(), before + 2 + i, setting);
  });
  faithfulOf(ctx, { ...FONT, tracking: 0.05 }, 'STU');
  assert.equal(checks(), before + 2 + settings.length, 'another tracking is another verdict');
});

test('the roll-up of a word\'s glyphs is one function, the mean: opacity (clamped), offsets and scale', () => {
  assert.deepEqual(glyphRollup([{ opacity: 0, x: 0, y: 0, scale: 1 }, { opacity: 1, x: 10, y: -4, scale: 1.5 }]), { opacity: 0.5, dx: 5, dy: -2, scale: 1.25 });
  assert.equal(glyphRollup([{ opacity: 1.5, x: 0, y: 0, scale: 1 }, { opacity: -1, x: 0, y: 0, scale: 1 }]).opacity, 0.5, 'each opacity is clamped before the mean');
});

test('a scaled glyph pivots on the centre of its ink: the letter spacing the advance carries is not part of it', () => {
  // each glyph is 10 wide and the spacing adds 2 after it: advance 12, ink centre 5, so a glyph at scale 2 starts 12 + 5 - 10 = 7 on
  const font = { ...FONT, tracking: 0.05 };
  const { fills, left } = drawWord('ABC', word({ glyphs: [ID, { ...ID, scale: 2 }, ID] }), { font });
  assert.equal(fills.find((f) => f.text === 'B').x - left, 7);
});

// ---- a line moves as one block ----

const LINE_ID = { opacity: 1, x: 0, y: 0, scale: 1 };

test('a line track fades, moves and scales the whole line, and its words are drawn whole (never expanded into glyphs)', () => {
  const faded = drawWord('ABC', word(), { lines: [{ ...LINE_ID, opacity: 0.5 }] });
  assert.deepEqual(faded.fills.map((f) => [f.text, f.alpha]), [['ABC', 0.5]]);
  const moved = drawWord('ABC', word(), { lines: [{ ...LINE_ID, x: 10, y: -3 }] });
  assert.deepEqual(moved.fills.map((f) => [f.text, f.x - moved.left, f.y]), [['ABC', 10, -3]]);
  // the line's centre is its x plus half its width (15) on its baseline; the word's centre is 0, so scaled by 2 about 15 its
  // centre goes to -15 and its left edge (-15 from its centre) to -45
  const scaled = drawWord('ABC', word(), { lines: [{ ...LINE_ID, scale: 2 }] });
  assert.deepEqual(scaled.fills.map((f) => [f.text, f.scale, f.x]), [['ABC', 2, -45]]);
});

test('a line at opacity 0 draws nothing, glow included; a line at its rest values is drawn as if it had no track', () => {
  const none = drawWord('ABC', word({ glow: 1 }), { glow: GLOW, lines: [{ ...LINE_ID, opacity: 0 }] });
  assert.deepEqual([none.fills, none.strokes], [[], []]);
  const rest = drawWord('ABC', word(), { lines: [LINE_ID] });
  const bare = drawWord('ABC', word());
  assert.deepEqual(rest.fills.map(({ text, x, y, scale, alpha }) => ({ text, x, y, scale, alpha })), bare.fills.map(({ text, x, y, scale, alpha }) => ({ text, x, y, scale, alpha })));
});

test('a hand-built line with no width scales about its start: a finite transform, never NaN', () => {
  const { fills } = drawWord('ABC', word(), { lines: [{ ...LINE_ID, scale: 2 }], widthless: true });
  assert.equal(fills.length, 1);
  assert.ok(Number.isFinite(fills[0].x) && Number.isFinite(fills[0].y) && fills[0].scale === 2);
});

test('a line track composes with a word track and with letters still arriving', () => {
  const both = drawWord('ABC', word({ opacity: 0.5 }), { lines: [{ ...LINE_ID, opacity: 0.5 }] });
  assert.equal(both.fills[0].alpha, 0.25);
  const letters = drawWord('ABC', word({ glyphs: [{ ...ID, opacity: 0.5 }, ID, ID] }), { lines: [{ ...LINE_ID, x: 4 }] });
  assert.deepEqual(letters.fills.map((f) => [f.text, f.x - letters.left, f.alpha]), [['A', 4, 0.5], ['B', 14, 1], ['C', 24, 1]]);
});
