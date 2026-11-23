// agentText: untrusted text made safe to print where an agent reads it. Escapes, never deletes; every invisible
// character in this file is written as an escape, never as a literal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentText, agentJson, agentRow, capText, escapeJsonInvisible, DEFAULT_MAX } from '../agent-text.mjs';

test('plain ASCII, punctuation and visible non-ASCII letters pass through unchanged', () => {
  const text = 'feat(api): add /v2/users?id=1 -- caf\u00E9 \u65E5\u672C\u8A9E "quoted" \\ back';
  assert.equal(agentText(text), text);
});

test('a ZWJ emoji sequence keeps its emoji and prints each joiner as a code point', () => {
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  assert.equal(agentText(family), '\u{1F468}\\u{200d}\u{1F469}\\u{200d}\u{1F467}');
});

test('a tag-sequence flag emoji prints its tag characters as code points (the data itself is not changed)', () => {
  const england = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
  assert.equal(agentText(england), '\u{1F3F4}\\u{e0067}\\u{e0062}\\u{e0065}\\u{e006e}\\u{e0067}\\u{e007f}');
});

test('hidden instructions in Unicode tag characters become visible code points', () => {
  const hidden = [...'ignore previous'].map((c) => String.fromCodePoint(0xE0000 + c.codePointAt(0))).join('');
  const out = agentText(`fix typo${hidden}`);
  assert.doesNotMatch(out, /[\u{E0000}-\u{E007F}]/u);
  assert.match(out, /^fix typo\\u\{e0069\}\\u\{e0067\}/);
});

test('a bidi override and its terminator print as code points, the text between stays', () => {
  assert.equal(agentText('\u202Eevil\u202C'), '\\u{202e}evil\\u{202c}');
  assert.equal(agentText('a\u2066b\u2069c\u200Fd'), 'a\\u{2066}b\\u{2069}c\\u{200f}d');
});

test('controls, line and paragraph separators, variation selectors, private use, unassigned and the BOM are escaped', () => {
  assert.equal(agentText('a\nb\tc\u0007'), 'a\\u{000a}b\\u{0009}c\\u{0007}');
  assert.equal(agentText('x\u2028y\u2029z'), 'x\\u{2028}y\\u{2029}z');
  assert.equal(agentText('\u2764\uFE0F'), '\u2764\\u{fe0f}');
  assert.equal(agentText('a\u{E0100}b'), 'a\\u{e0100}b');
  assert.equal(agentText('\uE000'), '\\u{e000}');
  assert.equal(agentText('\u0378'), '\\u{0378}');
  assert.equal(agentText('\uFEFFhi'), '\\u{feff}hi');
});

test('a lone surrogate is escaped', () => {
  assert.equal(agentText('a\uD800b'), 'a\\u{d800}b');
});

test('it never deletes: stripping the escapes back gives every original code point', () => {
  const text = 'a\u200Db\u202Ec\u{E0041}d\u2028e';
  const back = agentText(text).replace(/\\u\{([0-9a-f]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  assert.equal(back, text);
});

test('text past the cap is cut with an ellipsis that counts the characters dropped', () => {
  const out = agentText('x'.repeat(300), { max: 200 });
  assert.equal(out, `${'x'.repeat(200)}\u2026[100 more characters]`);
});

test('text at the cap is not cut; the default cap is about 200', () => {
  assert.equal(DEFAULT_MAX, 200);
  assert.equal(agentText('y'.repeat(200)), 'y'.repeat(200));
  assert.equal(agentText('y'.repeat(201)), `${'y'.repeat(200)}\u2026[1 more characters]`);
});

test('the cap counts what is printed and never cuts an escape in half', () => {
  const out = agentText('\u200D'.repeat(5), { max: 3 });
  assert.equal(out, `${'\\u{200d}'.repeat(3)}\u2026[2 more characters]`);
});

test('max: Infinity escapes without cutting', () => {
  const long = 'z'.repeat(5000);
  assert.equal(agentText(long, { max: Infinity }), long);
});

test('a non-string is printed as its string form', () => {
  assert.equal(agentText(42), '42');
  assert.equal(agentText(null), 'null');
});

test('agentJson prints a value as JSON with invisible characters escaped once, not doubled', () => {
  assert.equal(agentJson('a\u{202E}b'), '"a\\u{202e}b"');
  assert.equal(agentJson(42), '42');
  assert.equal(agentJson(null), 'null');
  assert.equal(agentJson(undefined), 'null');
  assert.equal(agentJson('line\nbreak'), '"line\\nbreak"');
  assert.equal(agentJson({ a: ['\u{200D}'] }), '{"a":["\\u{200d}"]}');
});

test('agentJson caps the printed JSON and says how much was dropped', () => {
  assert.equal(agentJson('q'.repeat(300), { max: 50 }), `"${'q'.repeat(49)}…[252 more characters]`);
});

test('agentRow prints a row as a JSON object with every key and cell escaped and each capped on its own', () => {
  const row = { name: 'ok', note: 'x\u{E0041}y', long: 'w'.repeat(300), n: 7, none: null };
  const out = agentRow(row, { max: 20 });
  assert.match(out, /^\{"name":"ok","note":"x\\u\{e0041\}y","long":"w{19}…\[\d+ more characters\],"n":7,"none":null\}$/);
  assert.equal(agentRow({ 'k\u{202E}': 1 }), '{"k\\u{202e}":1}');
  assert.equal(agentRow({ a: 1, b: 'two' }), '{"a":1,"b":"two"}', 'an ordinary row is exactly JSON.stringify of it');
  assert.equal(agentRow([1, 'x\u{200D}']), '[1,"x\\u{200d}"]');
});

test('capText cuts without escaping: the text stays exact and the marker counts what was dropped', () => {
  assert.equal(capText('abc', { max: 5 }), 'abc');
  assert.equal(capText('abcdef', { max: 4 }), 'abcd\u2026[2 more characters]');
  assert.equal(capText('a\u200Db\u202Ec', { max: 10 }), 'a\u200Db\u202Ec', 'invisible characters are left as they are');
  assert.equal(capText('\u{1F600}'.repeat(3), { max: 2 }), '\u{1F600}\u{1F600}\u2026[1 more characters]', 'counts code points, not UTF-16 units');
});

// JSON text a person or a model reads (facts.json, stdout) with every invisible character written as a legal JSON
// escape, so the reader sees it and JSON.parse still returns the exact original string.
test('escapeJsonInvisible writes invisible characters as JSON escapes that parse back to the original', () => {
  const original = { ok: 'plain \u00E9 \u65E5', zwj: 'a\u200Db', bidi: '\u202Eevil\u202C', sep: 'x\u2028y', vs: '\u2764\uFE0F', del: 'p\u007Fq', c1: 'r\u0085s', tag: '\u{1F3F4}\u{E0067}\u{E007F}', bom: '\uFEFFz' };
  const text = escapeJsonInvisible(JSON.stringify(original));
  assert.doesNotMatch(text, /[\p{Cf}\p{Cc}\u2028\u2029\p{Variation_Selector}]/u, 'no raw invisible character is left');
  assert.deepEqual(JSON.parse(text), original);
  assert.match(text, /"zwj":"a\\u200db"/);
  assert.match(text, /"bidi":"\\u202eevil\\u202c"/);
  assert.match(text, /\\ud[89ab][0-9a-f]{2}\\ud[c-f][0-9a-f]{2}/, 'an astral character becomes a surrogate pair');
});

test('escapeJsonInvisible leaves the layout of pretty-printed JSON and ordinary text alone', () => {
  const pretty = JSON.stringify({ a: [1, 'two'], b: { c: 'caf\u00E9 \u{1F600}' } }, null, 2);
  assert.equal(escapeJsonInvisible(pretty), pretty);
});
