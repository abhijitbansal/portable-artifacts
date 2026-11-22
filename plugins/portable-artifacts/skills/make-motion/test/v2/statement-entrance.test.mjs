// The statement's letter and line entrances (W6 Task 4): `letters` (cosmos) brings a word in one letter after another and
// `lines` (desk) brings each line in as one block, both only on the plain path: never on a hook, a matched hero, or a look
// that opens composed. The builders end every track at the identity; the word's own entrance is left out; emphasis stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { graphemesOf } from '../../engine/graph/rollup.mjs';
import * as shared from '../../engine/kinds/shared.mjs';
import { sample, track } from '../../engine/time/track.mjs';
import { node } from '../../engine/graph/node.mjs';
import { beatPair } from '../../engine/kinds/stack.mjs';
import '../../engine/looks/index.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/devices/index.mjs';
import '../../engine/kinds/index.mjs';
import '../../engine/cuts/index.mjs';
import { filmOf, expandIn, expandShot, FILLER, FPS, textNode, all, lastKey, near } from './helpers/kinds.mjs';
import { frameZeroViolations } from './helpers/bar.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { lateFrameOf } from '../../scripts/v2/plan.mjs';

const LETTER_LOOK = 'cosmos';
const LINES_LOOK = 'desk';
const shotOf = (say) => ({ id: 's', show: 'statement', hold: 4, say });
const heroOf = (out) => textNode(out.nodes, 's.text');
const landsAt = (tr) => lastKey(tr).t;
const UNIT = 1;
// every sampled node of the shot at time t, a group's children included
const sampledAt = (nodes, t) => sampleGraph(nodes, t).flatMap(function walk(n) { return [n, ...n.children.flatMap(walk)]; });

// the same statement with the look's entrance switched off: what the look built before it adopted one
function withoutEntrance(shot, look) {
  const { ctx } = expandShot(shot, look);
  const kinds = { ...ctx.look.kinds, statement: { ...ctx.look.kinds.statement, entrance: undefined } };
  return registries.kinds.get('statement').expand(shot, { ...ctx, look: { ...ctx.look, kinds } });
}

test('the builders end every track at the identity: opacity 1, offsets 0', () => {
  const cosmos = registries.looks.get(LETTER_LOOK), desk = registries.looks.get(LINES_LOOK);
  const maps = [...shared.letterTracks(cosmos, UNIT, 1.5, 6), ...shared.letterTracks(cosmos, UNIT, 0, 2), shared.lineEntrance(desk, UNIT, 1.5), shared.lineEntrance(desk, UNIT, 0)];
  assert.equal(maps.length, 10);
  assert.ok(maps.some((map) => map.y !== undefined), 'desk lines travel, so there is an offset to end at 0');
  for (const map of maps.filter(Boolean)) {
    assert.equal(lastKey(map.opacity).v, 1);
    for (const name of ['x', 'y']) if (map[name]) assert.equal(lastKey(map[name]).v, 0, name);
    assert.equal(map.scale, undefined, 'no scale: an entrance that never scales');
  }
});

test('letterTracks gives one track map per glyph, letter k landing at at + k * stagger', () => {
  const look = registries.looks.get(LETTER_LOOK);
  const maps = shared.letterTracks(look, UNIT, 2, 5);
  assert.equal(maps.length, 5);
  maps.forEach((map, k) => near(landsAt(map.opacity), 2 + k * look.moves.letters.stagger, `letter ${k}`));
});

test('letterTracks: a 45-letter word still lands its last letter within the spread cap after its spoken time', () => {
  const look = registries.looks.get(LETTER_LOOK);
  assert.ok(Number.isFinite(shared.LETTER_SPREAD_CAP) && shared.LETTER_SPREAD_CAP > 0, 'the cap is a named, exported number of seconds');
  const maps = shared.letterTracks(look, UNIT, 2, 45);
  assert.equal(maps.length, 45);
  near(landsAt(maps[0].opacity), 2, 'the first letter stays on the spoken time');
  assert.ok(landsAt(maps[44].opacity) <= 2 + shared.LETTER_SPREAD_CAP + 1e-9, `last letter lands ${landsAt(maps[44].opacity) - 2} s after at`);
  const steps = maps.map((m) => landsAt(m.opacity)).map((t, k, all) => (k ? t - all[k - 1] : 0)).slice(1);
  assert.ok(steps.every((s) => Math.abs(s - steps[0]) < 1e-9), 'the letters stay evenly spaced');
});

test('letterTracks: a short word keeps the look\'s own stagger, up to the longest word that fits the cap', () => {
  const look = registries.looks.get(LETTER_LOOK), { stagger } = look.moves.letters;
  const fits = Math.floor(shared.LETTER_SPREAD_CAP / stagger) + 1; // letters whose spread (count - 1) * stagger is within the cap
  assert.ok(fits >= 18, `the cap leaves "portable-artifacts" (18 letters) alone, it fits ${fits}`);
  const maps = shared.letterTracks(look, UNIT, 1, fits);
  maps.forEach((map, k) => near(landsAt(map.opacity), 1 + k * stagger, `letter ${k} of ${fits}`));
});

test('letters: a statement ending in a 47-character URL is at rest before its shot\'s 85% frame', () => {
  const url = 'docs.example.com/portable-artifacts/make-motion';
  assert.equal(url.length, 47);
  for (const say of [`Read ${url}`, `Our platform supports this and everything on ${url}`]) {
    const film = filmOf([{ id: 's', show: 'statement', say }], LETTER_LOOK);
    const out = expandIn(film);
    const late = 0.85 * out.timing.duration;
    const seen = sampledAt(out.nodes, late).find((n) => n.id === 's.text').seen;
    const last = seen.length - 1;
    assert.ok(seen.every((word) => word.rest), `${say}: every word at rest at ${late.toFixed(3)} s, the last one ${JSON.stringify(seen[last])}`);
  }
});

// R-1: the late frame the compare cell, board tile and phone tile read is the later of the 85% frame and the last landing of the
// shot's text, still inside the shot. A long statement leaves too little room after its last word for the letters.
const LONG_LINE = 'Our platform supports internationalization and accessibility for every team that ships software to customers around the world, and accessibility.';
const frameAt = (film) => lateFrameOf(buildTimeline(film, { fps: FPS }), 0, film);

test('letters: the late frame of a 7 s cosmos statement waits for "accessibility." to land, and shows it at rest', () => {
  const film = filmOf([{ id: 's', show: 'statement', say: LONG_LINE }], LETTER_LOOK);
  const out = expandIn(film);
  const { duration } = out.timing;
  const frame = frameAt(film), t = frame / FPS;
  assert.ok(duration >= 7, `the premise: a shot of ${duration} s`);
  const hero = heroOf(out);
  const lands = Math.max(...hero.glyphTracks.flat().map((g) => landsAt(g.opacity)));
  assert.ok(lands > 0.85 * duration, `the premise: the last letter lands at ${lands} s, after the 85% frame ${0.85 * duration}`);
  assert.ok(t >= lands - 1e-9 && t < duration, `the picked frame ${t} s is at or after ${lands} s and inside the shot (${duration} s)`);
  const seen = sampledAt(out.nodes, t).find((n) => n.id === 's.text').seen;
  assert.ok(seen.every((word) => word.rest), 'every word is at rest on the picked frame');
});

test('the late frame stays the 85% frame where nothing lands after it: a short statement, a desk line, a viral hook', () => {
  const at85 = (film) => Math.round(0.85 * buildTimeline(film, { fps: FPS }).shots[0].duration * FPS);
  for (const film of [
    filmOf([{ id: 's', show: 'statement', say: 'Ship it today.' }], LETTER_LOOK),
    filmOf([{ id: 's', show: 'statement', say: LONG_LINE }], LINES_LOOK),
    filmOf([{ id: 's', show: 'statement', say: LONG_LINE }], LETTER_LOOK, '9:16', { mode: 'viral' }),
  ]) assert.equal(frameAt(film), at85(film), `${film.look} ${film.mode}`);
});

test('lineEntrance lands at the time given', () => {
  assert.ok(Math.abs(landsAt(shared.lineEntrance(registries.looks.get(LINES_LOOK), UNIT, 1.25).opacity) - 1.25) < 1e-9);
});

test('letters: each glyph lands one stagger after the one before, the first on the word\'s spoken time, and the word has no entrance of its own', () => {
  const out = expandShot(shotOf('Ship it'), LETTER_LOOK);
  const hero = heroOf(out);
  const [g0, g1, g2] = hero.glyphTracks[0];
  const { stagger } = registries.looks.get(LETTER_LOOK).moves.letters;
  near(landsAt(g1.opacity) - landsAt(g0.opacity), stagger, 'g1 - g0');
  near(landsAt(g2.opacity) - landsAt(g1.opacity), stagger, 'g2 - g1');
  near(landsAt(g0.opacity), out.timing.words[0].start, 'the first letter on the spoken word');
  assert.equal(hero.wordTracks[0].opacity, undefined);
  assert.equal(hero.wordTracks[1].opacity, undefined);
  assert.equal(hero.lineTracks, undefined, 'letters carry no line tracks');
  near(landsAt(hero.glyphTracks[1][0].opacity), out.timing.words[1].start, 'the second word\'s first letter on its spoken word');
});

test('letters: a glyph is a grapheme, so an accent or an emoji sequence is one track', () => {
  const family = [0x1F468, 0x1F469, 0x1F467].map((c) => String.fromCodePoint(c)).join(String.fromCodePoint(0x200D)); // one grapheme: three people joined
  const text = ['Cafe' + String.fromCodePoint(0x301), family, 'now'].join(' '); // a decomposed accent is one grapheme too
  const hero = heroOf(expandShot(shotOf(text), LETTER_LOOK));
  const words = hero.props.layout.lines.flatMap((line) => line.words).sort((a, b) => a.index - b.index);
  words.forEach((word) => assert.equal(hero.glyphTracks[word.index].length, graphemesOf(word.text).length, word.text));
  assert.ok(hero.glyphTracks[0].length < [...words[0].text].length, 'the decomposed accent is not counted twice');
});

test('letters: the emphasis of the word is untouched, only its own entrance is left out', () => {
  const shot = shotOf('It is *lying* to you.');
  const now = heroOf(expandShot(shot, LETTER_LOOK)), before = textNode(withoutEntrance(shot, LETTER_LOOK).nodes, 's.text');
  assert.ok(before.wordTracks.every((w) => w.opacity !== undefined), 'before: every word fades in');
  assert.ok(Object.keys(before.wordTracks[2]).length > 1, 'the emphasised word has more than its fade');
  now.wordTracks.forEach((tracks, i) => {
    // the look's enter move built the opacity, the rise and the start scale of the word: the glyphs carry the arrival now
    const { opacity, y, scale, ...rest } = before.wordTracks[i];
    assert.deepEqual(tracks, rest, `word ${i}: its tracks without the entrance`);
  });
});

test('letters: no letter is visible before its own entrance begins, a stepped ease included', () => {
  const hero = heroOf(expandShot(shotOf('Ship it now'), LETTER_LOOK));
  const { dur } = registries.looks.get(LETTER_LOOK).moves.letters;
  hero.glyphTracks.forEach((glyphs, w) => glyphs.forEach((g, k) => {
    const begins = Math.max(0, landsAt(g.opacity) - dur);
    // a letter that lands on 0 (the first word of an unnarrated shot) is there from frame 0, as a word landing on 0 is
    assert.equal(sample(g.opacity, 0), landsAt(g.opacity) === 0 ? 1 : 0, `word ${w} letter ${k} on frame 0`);
    if (begins > 0) assert.equal(sample(g.opacity, begins - 1e-6), 0, `word ${w} letter ${k} just before it begins`);
    assert.equal(sample(g.opacity, landsAt(g.opacity)), 1, `word ${w} letter ${k} when it lands`);
  }));
});

test('letters: mid-entrance the word has not arrived, and it has landed only when the last letter rests', () => {
  const out = expandShot(shotOf('Ship it'), LETTER_LOOK);
  const hero = heroOf(out), last = hero.glyphTracks[0].length - 1;
  const first = landsAt(hero.glyphTracks[0][0].opacity), end = landsAt(hero.glyphTracks[0][last].opacity);
  const seenAt = (t) => sampledAt(out.nodes, t).find((n) => n.id === 's.text').seen[0];
  assert.equal(seenAt(0).rest, false, 'on frame 0');
  assert.equal(seenAt((first + end) / 2).rest, false, 'half way through its letters');
  assert.equal(seenAt(end).rest, true, 'when the last letter lands');
  assert.equal(seenAt(end + 1).rest, true);
});

test('lines: every line takes one entrance at its first word\'s time, and no word has an entrance of its own', () => {
  const out = expandShot(shotOf('Most dashboards cannot tell you where a number came from, and nobody asks.'), LINES_LOOK);
  const hero = heroOf(out), { lines } = hero.props.layout;
  assert.ok(lines.length > 1, `the statement is set on ${lines.length} lines`);
  assert.equal(hero.lineTracks.length, lines.length);
  lines.forEach((line, k) => near(landsAt(hero.lineTracks[k].opacity), out.timing.words[line.words[0].index].start, `line ${k}`));
  assert.ok(hero.wordTracks.every((w) => w.opacity === undefined), 'no word fades in on its own');
  assert.equal(hero.glyphTracks, undefined, 'lines never become glyph tracks');
});

test('lines: the highlight band of an emphasised word is untouched', () => {
  const shot = shotOf('Every number needs a *source* you can open.');
  const now = expandShot(shot, LINES_LOOK).nodes, before = withoutEntrance(shot, LINES_LOOK).nodes;
  assert.deepEqual(all(now).filter((n) => n.type !== 'text').map((n) => n.id), all(before).filter((n) => n.type !== 'text').map((n) => n.id));
  assert.deepEqual(all(now).filter((n) => n.props.under).map((n) => n.tracks), all(before).filter((n) => n.props.under).map((n) => n.tracks));
});

test('the first shot of a viral film in a letters look keeps every word on frame 0', () => {
  const film = filmOf([shotOf('Ship it')], LETTER_LOOK, '16:9', { mode: 'viral' });
  const hero = heroOf(expandIn(film));
  assert.equal(hero.glyphTracks, undefined);
  assert.equal(hero.lineTracks, undefined);
  const [first] = sampledAt(expandIn(film).nodes, 0).filter((n) => n.id === 's.text');
  assert.ok(first.words.length === 2 && first.words.every((w) => w.opacity > 0), 'every word is on screen on frame 0');
});

test('a later shot of a viral film, and a matched hero, keep their own entrance', () => {
  const viral = filmOf([FILLER, shotOf('Ship it')], LETTER_LOOK, '16:9', { mode: 'viral' });
  assert.equal(heroOf(expandIn(viral, 1)).glyphTracks, undefined, 'viral words are ghosts lit as spoken');
  const matched = filmOf([FILLER, { ...shotOf('Ship it'), cut: 'match' }], LETTER_LOOK);
  const hero = heroOf(expandIn(matched, 1));
  assert.equal(hero.glyphTracks, undefined, 'a matched hero is on screen already');
  assert.equal(hero.wordTracks[0].opacity, undefined);
});

// The hook rule is the mode's (hookFromFrameZero), not the ghost words': a viral look whose emphasis is the highlight sets
// no ghosts, and its first shot still shows every word on frame 0.
test('a viral first shot in a highlight look with an entrance gets no glyph or line tracks', () => {
  const desk = registries.looks.get('desk');
  const name = 'desk-viral-test';
  if (!registries.looks.has(name)) registries.looks.add(name, Object.freeze({ ...desk, name, experimental: true, modes: Object.freeze(['pro', 'viral']) }));
  for (const [entrance, moves] of [['lines', {}], ['letters', { letters: { ease: 'outCubic', dur: 0.3, stagger: 0.04 } }]]) {
    const look = registries.looks.get(name);
    const used = { ...look, moves: { ...look.moves, ...moves }, kinds: { ...look.kinds, statement: { ...look.kinds.statement, entrance } } };
    for (const index of [0, 1]) {
      const film = filmOf([FILLER, shotOf('Ship it today')], name, '16:9', { mode: 'viral' });
      const { ctx } = expandIn(film, index);
      const out = registries.kinds.get('statement').expand(film.shots[index], { ...ctx, look: used });
      const hero = all(out.nodes).find((n) => n.type === 'text' && n.props.role === 'hero');
      assert.equal(ctx.mode.hookFromFrameZero, true);
      assert.equal(hero.glyphTracks, undefined, `${entrance}, shot ${index}: no glyph tracks`);
      assert.equal(hero.lineTracks, undefined, `${entrance}, shot ${index}: no line tracks`);
    }
  }
});

test('a look with neither entrance builds the statement it built before: no glyph or line tracks anywhere', () => {
  for (const look of ['pop', 'ledger', 'poster', 'keynote', 'marker']) {
    const out = expandShot(shotOf('Ship it today. It is *plain*.'), look);
    for (const n of all(out.nodes).filter((x) => x.type === 'text')) {
      assert.equal(n.glyphTracks, undefined, `${look} ${n.id}`);
      assert.equal(n.lineTracks, undefined, `${look} ${n.id}`);
    }
  }
});

test('the beat bar\'s knockout copy of a row keeps the row\'s glyph and line tracks, as it keeps its word tracks', () => {
  const { ctx } = expandShot(shotOf('Ship it'), 'poster');
  const fade = track([{ t: 0, v: 0 }, { t: 1, v: 1 }]);
  const row = node('text', 'h.line0', { layout: { lines: [] }, font: { family: 'Archivo', size: 60 }, fill: '#141414', role: 'hero' },
    { wordTracks: [{}], glyphTracks: [[{ opacity: fade }]], lineTracks: [{ opacity: fade }] });
  const [bar, copy] = beatPair('h.beat0', { k: 0, at: 1, until: Infinity }, [[0, 0, 100, 50]], row, { baseline: 100, ink: { up: 40, down: 10 }, font: { size: 60 } }, ctx);
  assert.equal(bar.type, 'path');
  assert.strictEqual(copy.glyphTracks[0][0].opacity, fade, 'the copy fades in letter by letter with its row');
  assert.strictEqual(copy.lineTracks[0].opacity, fade, 'and line by line');
});

test('the frame-0 bar reads glyph and line tracks, so an entrance that moved onto letters or lines is still judged', () => {
  const part = track([{ t: 0, v: 0.5 }, { t: 1, v: 1 }]);
  const layout = { lines: [{ x: 0, y: 80, width: 100, words: [{ index: 0, text: 'ab', x: 0, width: 100 }] }], width: 100, height: 100 };
  const text = (tracks) => node('text', 't', { layout, font: { family: 'Fraunces', size: 96 }, fill: '#000000', x: 10, y: 10 }, tracks);
  const canvas = { w: 1920, h: 1080 };
  const letters = frameZeroViolations({ nodes: [text({ wordTracks: [{}], glyphTracks: [[{ opacity: part }]] })], duration: 5, canvas });
  assert.deepEqual(letters, ['t word 0 glyph 0: opacity part-way at frame 0']);
  const lines = frameZeroViolations({ nodes: [text({ wordTracks: [{}], lineTracks: [{ opacity: part }] })], duration: 5, canvas });
  assert.deepEqual(lines, ['t line 0: opacity part-way at frame 0']);
  const settled = frameZeroViolations({ nodes: [text({ wordTracks: [{}], lineTracks: [{ y: track([{ t: 0, v: 0 }, { t: 1, v: 0 }]) }] })], duration: 5, canvas });
  assert.deepEqual(settled, ['nothing changes after frame 0: the shot is a still']);
  const late = frameZeroViolations({ nodes: [text({ wordTracks: [{}], glyphTracks: [[{ opacity: track([{ t: 0, v: 0 }, { t: 4.8, v: 1 }]) }]] })], duration: 5, canvas });
  assert.match(late.join('\n'), /word 0 glyph 0 opacity lands at 4\.80 s/);
});
