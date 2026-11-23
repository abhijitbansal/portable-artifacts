// Scene graph nodes for the v2 engine: node(type, id, props, opts) builds an immutable Node.
// Animatable props are a static value in `props` or a Track in `tracks` (a track wins). Rotation is in
// degrees. Pure and DOM-free.

export const NODE_TYPES = Object.freeze(['group', 'text', 'path', 'image', 'field']);
// `frame` (no default, so a node without it samples as before) is the decoded frame a clip's image node shows
// (engine/kinds/media-clip.mjs); it rises every film frame, so a playing clip is never taken for a held frame.
export const TRACK_NAMES = Object.freeze(['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'opacity', 'draw', 'reveal', 'blur', 'frame']);
// `ghost` is never drawn: above 0 it marks a word not yet spoken in a mode that reads from frame 0 (kinds/shared.mjs
// ghostTracks), so the contrast rule leaves it alone (engine/review/contrast.mjs).
// `glow` (0 to 1) lights a word's glyph glow, the text's props.glow ({ color, alpha, radius }), to that share of its alpha.
// `weight` (a CSS weight) and `width` (a stretch keyword) set the whole word's weight and width; layout reserves room
// for them (text/layout.mjs reserve), so a change never re-flows the line (graph/sample.mjs rounds and checks them).
export const WORD_TRACK_NAMES = Object.freeze(['opacity', 'x', 'y', 'scale', 'fill', 'ghost', 'glow', 'weight', 'width']);
// A text may also carry a track map per glyph of a word (`glyphTracks[wordIndex][glyphIndex]`, a glyph being a grapheme: a
// letter-by-letter entrance) and one per line (`lineTracks[lineIndex]`, a line that moves as one block). Opacity, offset
// and scale only.
export const GLYPH_TRACK_NAMES = Object.freeze(['opacity', 'x', 'y', 'scale']);
export const LINE_TRACK_NAMES = GLYPH_TRACK_NAMES;

const COLOUR_WORD_TRACKS = Object.freeze(['fill']);
const KEYWORD_WORD_TRACKS = Object.freeze(['width']); // stepped keyword strings
const created = new WeakSet();

const list = (names) => names.join(', ');
const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTrack = (v) => isPlainObject(v) && Array.isArray(v.points) && v.points.length > 0 && typeof v.kind === 'string';

// True for a value node() returned.
export const isNode = (v) => created.has(v);

// Copy plain objects and arrays and freeze the copy, so the caller's data is never frozen or aliased.
function freezeCopy(v) {
  if (Object.isFrozen(v)) return v;
  if (Array.isArray(v)) return Object.freeze(v.map(freezeCopy));
  if (!isPlainObject(v)) return v;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return v;
  return Object.freeze(Object.fromEntries(Object.entries(v).map(([k, val]) => [k, freezeCopy(val)])));
}

function checkTrackMap(map, allowed, where, colourNames = [], keywordNames = []) {
  if (!isPlainObject(map)) throw new Error(`${where} must be an object of tracks`);
  for (const [name, tr] of Object.entries(map)) {
    if (!allowed.includes(name)) throw new Error(`${where}: unknown track '${name}'; accepted: ${list(allowed)}`);
    if (!isTrack(tr)) throw new Error(`${where}.${name} must be a track (see track())`);
    const wantKind = colourNames.includes(name) ? ['colour', 'string'] : keywordNames.includes(name) ? ['string'] : ['number'];
    if (!wantKind.includes(tr.kind)) throw new Error(`${where}.${name} must be a ${wantKind.join(' or ')} track, got ${tr.kind}`);
  }
}

function checkStaticProps(props) {
  if (!isPlainObject(props)) throw new Error('props must be an object');
  for (const name of TRACK_NAMES) {
    if (name in props && !isFiniteNumber(props[name])) throw new Error(`props.${name} must be a finite number, got ${props[name]}`);
  }
}

function checkWordTracks(words, type) {
  if (!Array.isArray(words)) throw new Error('wordTracks must be an array, one entry per word index');
  if (words.length > 0 && type !== 'text') throw new Error(`wordTracks only apply to a text node, not '${type}'`);
  words.forEach((entry, i) => checkTrackMap(entry, WORD_TRACK_NAMES, `wordTracks[${i}]`, COLOUR_WORD_TRACKS, KEYWORD_WORD_TRACKS));
}

// A hole (an undefined entry or a missing one) is a word with no glyph tracks, a glyph with none, a line with none.
function checkGlyphTracks(words, type) {
  if (!Array.isArray(words)) throw new Error('glyphTracks must be an array, one entry per word index (an array of track maps, one per glyph)');
  if (words.length > 0 && type !== 'text') throw new Error(`glyphTracks only apply to a text node, not '${type}'`);
  words.forEach((glyphs, w) => {
    if (glyphs === undefined) return;
    if (!Array.isArray(glyphs)) throw new Error(`glyphTracks[${w}] must be an array, one track map per glyph`);
    glyphs.forEach((entry, k) => {
      if (entry !== undefined) checkTrackMap(entry, GLYPH_TRACK_NAMES, `glyphTracks[${w}][${k}]`);
    });
  });
}

function checkLineTracks(lines, type) {
  if (!Array.isArray(lines)) throw new Error('lineTracks must be an array, one track map per line');
  if (lines.length > 0 && type !== 'text') throw new Error(`lineTracks only apply to a text node, not '${type}'`);
  lines.forEach((entry, k) => {
    if (entry !== undefined) checkTrackMap(entry, LINE_TRACK_NAMES, `lineTracks[${k}]`);
  });
}

const freezeEntry = (entry) => (entry === undefined ? undefined : Object.freeze({ ...entry }));

/** The word, glyph and line track options of node `n`, for a copy that keeps them all: `node(type, id, props, { tracks, ...textTracksOf(n) })`. */
export const textTracksOf = (n) => ({ wordTracks: n.wordTracks, glyphTracks: n.glyphTracks, lineTracks: n.lineTracks });

function checkChildren(children) {
  if (!Array.isArray(children)) throw new Error('children must be an array of nodes');
  children.forEach((child, i) => {
    if (!isNode(child)) throw new Error(`children[${i}] must be a node built by node()`);
  });
}

function checkOptions({ depth, step }) {
  if (depth !== undefined && (!isFiniteNumber(depth) || depth <= -1)) throw new Error(`depth must be a finite number > -1 (0 is the picture plane), got ${depth}`);
  if (step !== undefined && (!isFiniteNumber(step) || step <= 0)) throw new Error(`step must be a finite frame rate > 0, got ${step}`);
}

export function node(type, id, props = {}, opts = {}) {
  if (!NODE_TYPES.includes(type)) throw new Error(`unknown node type '${type}'; accepted: ${list(NODE_TYPES)}`);
  if (typeof id !== 'string' || id.length === 0) throw new Error(`node id must be a non-empty string, got ${JSON.stringify(id)}`);
  const { tracks = {}, children = [], depth = 0, step, wordTracks = [], glyphTracks = [], lineTracks = [] } = opts;
  checkStaticProps(props);
  checkTrackMap(tracks, TRACK_NAMES, 'tracks');
  checkWordTracks(wordTracks, type);
  checkGlyphTracks(glyphTracks, type);
  checkLineTracks(lineTracks, type);
  checkChildren(children);
  checkOptions({ depth, step });
  const made = Object.freeze({
    type,
    id,
    props: freezeCopy(props),
    tracks: Object.freeze({ ...tracks }),
    children: Object.freeze([...children]),
    depth,
    step,
    wordTracks: Object.freeze(wordTracks.map((entry) => Object.freeze({ ...entry }))),
    // present only when there are some, so a node without them is the object it was before they existed
    ...(glyphTracks.length === 0 ? {} : { glyphTracks: Object.freeze(glyphTracks.map((glyphs) => (glyphs === undefined ? undefined : Object.freeze(glyphs.map(freezeEntry))))) }),
    ...(lineTracks.length === 0 ? {} : { lineTracks: Object.freeze(lineTracks.map(freezeEntry)) }),
  });
  created.add(made);
  return made;
}
