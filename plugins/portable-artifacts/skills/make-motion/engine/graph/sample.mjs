// Resolve a scene graph at time t: sampleGraph(nodes, t) returns the same tree with every animatable prop
// a plain value. Children stay nested and keep local values (nothing is pre-multiplied). stateKey() makes a
// stable string of a sampled tree so the renderer can skip a frame that equals the previous one.
import { sample } from '../time/track.mjs';
import { GLYPH_TRACK_NAMES, isNode, TRACK_NAMES } from './node.mjs';
import { graphemesOf, paddedGlyphs, seenOf } from './rollup.mjs';
import { STRETCH_KEYWORDS } from '../fonts/index.mjs';

const DEFAULTS = Object.freeze({ x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0 });
const WORD_DEFAULTS = Object.freeze({ opacity: 1, x: 0, y: 0, scale: 1 });

// Each name takes its track if there is one, else the static value, else the default.
function resolve(names, tracks, statics, defaults, t, step) {
  const out = {};
  for (const name of names) {
    if (tracks[name]) out[name] = sample(tracks[name], t, step);
    else if (statics[name] !== undefined) out[name] = statics[name];
    else if (defaults[name] !== undefined) out[name] = defaults[name];
  }
  return out;
}

// A word's weight and width tracks (looks-four Task 1), each for the whole word: a weight is a whole CSS weight from
// WEIGHT_RANGE (an eased track may overshoot, so it is rounded and clamped), a width one of the stretch keywords canvas
// reaches (STRETCH_KEYWORDS; a width track's keyword values step).
const WEIGHT_RANGE = Object.freeze([100, 900]);
const WIDTHS = Object.freeze(STRETCH_KEYWORDS.map(([, keyword]) => keyword));

function typeValues(values) {
  const out = { ...values };
  if (out.weight !== undefined) out.weight = Math.min(WEIGHT_RANGE[1], Math.max(WEIGHT_RANGE[0], Math.round(out.weight)));
  if (out.width !== undefined && !WIDTHS.includes(out.width)) {
    throw new Error(`a word's width must be one of ${WIDTHS.join(', ')}, got ${JSON.stringify(out.width)}`);
  }
  return out;
}

function sampleWords(n, t) {
  const names = [...Object.keys(WORD_DEFAULTS), 'fill', 'ghost', 'glow', 'weight', 'width'];
  const statics = { fill: n.props.fill };
  return Object.freeze(n.wordTracks.map((entry) => Object.freeze(typeValues(resolve(names, entry, statics, WORD_DEFAULTS, t, n.step)))));
}

// A glyph's and a line's tracks (opacity, x, y, scale): sampled per word index (an array of glyph values) and per line index.
// A hole stays a hole (no track for that word, glyph or line).
const sampleEntry = (n, t) => (entry) => Object.freeze(resolve(GLYPH_TRACK_NAMES, entry ?? {}, {}, WORD_DEFAULTS, t, n.step));
const sampleGlyphs = (n, t) => Object.freeze(n.glyphTracks.map((glyphs) => (glyphs === undefined ? undefined : Object.freeze(glyphs.map(sampleEntry(n, t))))));
const sampleLines = (n, t) => Object.freeze(n.lineTracks.map((entry) => (entry === undefined ? undefined : sampleEntry(n, t)(entry))));

// The roll-up of each word that has glyph tracks or sits in a line with tracks (graph/rollup.mjs seenOf): how far it has
// arrived with its letters and its line counted, which the review reads in place of the word's own values (the draw puts
// the first letter on screen at the word's full strength, so the word's own opacity says nothing about the rest). A word's
// glyphs are padded to its grapheme count, as the draw pads them. The line of each word comes from props.layout; without
// one only the glyph tracks count. A word with neither stays out (undefined): it is its own values.
function sampleSeen(n, { words, glyphs, lines }) {
  const seen = [];
  const own = (index) => words?.[index] ?? WORD_DEFAULTS;
  const put = (index, text, line) => {
    const mine = glyphs?.[index];
    if (!mine && !line) return;
    const count = typeof text === 'string' ? graphemesOf(text).length : (mine?.length ?? 0);
    seen[index] = seenOf(own(index), mine ? paddedGlyphs(mine, count) : null, line);
  };
  let wordCount = 0; // how many words the layout has: a word in a line with no tracks is its own values, but it is counted
  (n.props.layout?.lines ?? []).forEach((row, k) => (row.words ?? []).forEach((w) => {
    if (!Number.isInteger(w?.index)) return;
    wordCount = Math.max(wordCount, w.index + 1);
    put(w.index, w.text, lines?.[k]);
  }));
  glyphs?.forEach((mine, index) => { if (seen[index] === undefined) put(index, undefined, undefined); });
  seen.length = Math.max(seen.length, wordCount);
  return Object.freeze(Array.from(seen));
}

function sampleNode(n, t) {
  if (!isNode(n)) throw new Error('sampleGraph needs nodes built by node()');
  const values = resolve(TRACK_NAMES, n.tracks, n.props, DEFAULTS, t, n.step);
  const statics = Object.fromEntries(Object.entries(n.props).filter(([name]) => !TRACK_NAMES.includes(name)));
  const sampled = {
    type: n.type,
    id: n.id,
    depth: n.depth,
    props: Object.freeze(statics),
    ...values,
    visible: values.opacity > 0,
    children: Object.freeze(n.children.map((child) => sampleNode(child, t))),
  };
  if (n.wordTracks.length > 0) sampled.words = sampleWords(n, t);
  if (n.glyphTracks) sampled.glyphs = sampleGlyphs(n, t); // a node has them only when it was given some
  if (n.lineTracks) sampled.lines = sampleLines(n, t);
  if (sampled.glyphs || sampled.lines) sampled.seen = sampleSeen(n, sampled);
  return Object.freeze(sampled);
}

export function sampleGraph(nodes, t) {
  if (!Array.isArray(nodes)) throw new Error('sampleGraph needs an array of nodes');
  if (typeof t !== 'number' || !Number.isFinite(t)) throw new Error(`sample time must be a finite number, got ${t}`);
  return Object.freeze(nodes.map((n) => sampleNode(n, t)));
}

// JSON with object keys sorted at every depth; undefined members are dropped, as JSON.stringify does.
function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (v === null || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, stable(v[k])]));
}

export function stateKey(sampled) {
  return JSON.stringify(stable(sampled));
}
