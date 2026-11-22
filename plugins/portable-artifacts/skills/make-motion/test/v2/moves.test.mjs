// The move registry (engine/moves/index.mjs): the seven named moves, a look's entry for each (a Move, or null where the
// look does not use it), moveOf with did-you-mean, and --list moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registries, createRegistry } from '../../engine/registry.mjs';
import { MOVE_NAMES, moveOf, motionFacts } from '../../engine/moves/index.mjs';
import { validateLook } from '../../engine/looks/index.mjs';
import { listEntries, formatList } from '../../scripts/v2/list.mjs';

const MAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/make.mjs');
const make = (args) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8' });
const SEVEN = ['rise', 'wipe', 'slam', 'pop', 'draw', 'count', 'settle'];
const NINE = [...SEVEN, 'letters', 'lines'];

test('the nine moves are registered, each with a summary', () => {
  assert.deepEqual(MOVE_NAMES, NINE);
  assert.deepEqual(registries.moves.names(), NINE);
  for (const name of NINE) assert.ok(registries.moves.get(name).summary.length > 10, `${name} has a summary`);
});

test('every look, shipped, experimental and test, gives letters and lines a value or null', async () => {
  const { handLook } = await import('./helpers/hand-look.mjs');
  handLook();
  for (const name of registries.looks.names.all()) {
    const { moves } = registries.looks.get(name);
    assert.ok(Object.hasOwn(moves, 'letters') && Object.hasOwn(moves, 'lines'), `${name} names letters and lines`);
  }
});

test('the looks that adopt: cosmos takes letters and desk takes lines; no other shipped look takes either', () => {
  const adopts = Object.fromEntries(registries.looks.names().map((name) => {
    const { moves } = registries.looks.get(name);
    return [name, [moves.letters !== null && 'letters', moves.lines !== null && 'lines'].filter(Boolean)];
  }));
  assert.deepEqual(adopts, { desk: ['lines'], pop: [], cosmos: ['letters'], ledger: [], poster: [], keynote: [], marker: [] });
  assert.equal(registries.looks.get('cosmos').kinds.statement.entrance, 'letters');
  assert.equal(registries.looks.get('desk').kinds.statement.entrance, 'lines');
});

test('desk and pop name a move for every registered move; the first five keep their values', () => {
  for (const look of ['desk', 'pop']) {
    const moves = registries.looks.get(look).moves;
    for (const name of SEVEN) assert.equal(typeof moves[name]?.ease, 'string', `${look}.${name}`);
  }
  assert.deepEqual(registries.looks.get('desk').moves.rise, registries.looks.get('desk').moves.enter, 'desk rise is its enter');
  assert.deepEqual(registries.looks.get('desk').moves.pop, registries.looks.get('desk').moves.enter, 'desk pop is its rise');
  assert.equal(registries.looks.get('desk').moves.slam.dur, 0, 'desk does not slam: a hard arrival');
  assert.deepEqual(registries.looks.get('pop').moves.pop, registries.looks.get('pop').moves.enter, 'pop pop is its enter');
});

const desk = () => registries.looks.get('desk');
const withMoves = (moves) => ({ ...desk(), name: 'moves-test', moves });

test('a look missing a registered move fails validateLook naming the look and the move', () => {
  const { settle, ...rest } = desk().moves;
  assert.ok(settle);
  assert.throws(() => validateLook(withMoves(rest)), /look "moves-test": moves\.settle must be a move \{ ease, dur \} or null/);
});

test('a move entry of null passes (the look does not use it); a malformed one fails', () => {
  assert.doesNotThrow(() => validateLook(withMoves({ ...desk().moves, slam: null })));
  assert.throws(() => validateLook(withMoves({ ...desk().moves, wipe: { dur: 0.2 } })), /moves\.wipe must be a move/);
  assert.throws(() => validateLook(withMoves({ ...desk().moves, wipe: { ease: 'linear', dur: -1 } })), /moves\.wipe must be a move/);
});

test('validateLook checks the moves of the registry it is given', () => {
  const moves = createRegistry('move');
  moves.add('glide', { summary: 'a test move that no look has' });
  assert.throws(() => validateLook(desk(), { moves }), /moves\.glide/);
});

// ---- letters and lines: entrances that end at rest, a statement entrance only a look with the move may name ----

const withEntrance = ({ look = desk(), moves = {}, statement = {}, ...rest } = {}) => ({
  ...look, ...rest, name: 'entrance-test', moves: { ...look.moves, ...moves }, kinds: { ...look.kinds, statement: { ...look.kinds.statement, ...statement } },
});
const LETTERS = { ease: 'outCubic', dur: 0.3, stagger: 0.04 };
const LINES = { ease: 'outCubic', dur: 0.6, dist: 20 };

test('an entrance the look gives null for is refused', () => {
  assert.throws(() => validateLook(withEntrance({ statement: { entrance: 'letters' } })), /look "entrance-test": kinds\.statement\.entrance "letters" needs moves\.letters/);
  assert.doesNotThrow(() => validateLook(withEntrance({ moves: { letters: LETTERS }, statement: { entrance: 'letters' } })));
  assert.throws(() => validateLook(withEntrance({ statement: { entrance: 'fade' } })), /kinds\.statement\.entrance must be "letters" or "lines", got "fade"/);
});

test('letters and lines are entrances only: a move with an end value, or an unknown field, is refused', () => {
  for (const extra of [{ scale: 0.5 }, { to: 0.5 }, { opacity: 0.4 }, { y: 12 }]) {
    assert.throws(() => validateLook(withEntrance({ moves: { letters: { ...LETTERS, ...extra } } })), /look "entrance-test": moves\.letters is an entrance and ends at rest: it takes ease, dur, dist, stagger/);
    assert.throws(() => validateLook(withEntrance({ moves: { lines: { ...LINES, ...extra } } })), /look "entrance-test": moves\.lines is an entrance and ends at rest: it takes ease, dur, dist/);
  }
  assert.throws(() => validateLook(withEntrance({ moves: { lines: { ...LINES, stagger: 0.1 } } })), /moves\.lines is an entrance and ends at rest/, 'lines have no stagger');
});

test('letters need a stagger of 0 or more seconds; a distance, when given, is a finite number of units', () => {
  assert.throws(() => validateLook(withEntrance({ moves: { letters: { ease: 'linear', dur: 0.3 } } })), /moves\.letters\.stagger must be a number of seconds, 0 or more, got undefined/);
  assert.throws(() => validateLook(withEntrance({ moves: { letters: { ...LETTERS, stagger: -0.1 } } })), /moves\.letters\.stagger must be a number of seconds, 0 or more, got -0\.1/);
  assert.throws(() => validateLook(withEntrance({ moves: { lines: { ...LINES, dist: 'far' } } })), /moves\.lines\.dist must be a finite number of units, got "far"/);
  assert.doesNotThrow(() => validateLook(withEntrance({ moves: { letters: { ...LETTERS, stagger: 0 }, lines: LINES } })));
});

test('a look drawn by hand may not set letters or lines: what is written is never faded in', () => {
  const hand = { rest: 0.8 };
  assert.throws(() => validateLook(withEntrance({ hand, moves: { letters: LETTERS } })), /look "entrance-test": a look drawn by hand cannot use moves\.letters: what it writes is never faded in/);
  assert.throws(() => validateLook(withEntrance({ hand, moves: { lines: LINES } })), /a look drawn by hand cannot use moves\.lines/);
  assert.doesNotThrow(() => validateLook(withEntrance({ hand, moves: { letters: null, lines: null }, statement: { entrance: undefined } })));
  assert.equal(registries.looks.get('marker').moves.letters, null);
  assert.equal(registries.looks.get('marker').moves.lines, null);
});

// F-15: the engine reads `look.hand` as true or false (kinds/shared.mjs), so validateLook does too: `hand: null` is no hand.
test('a look with hand: null is not drawn by hand, and may use letters and lines', () => {
  assert.doesNotThrow(() => validateLook(withEntrance({ hand: null, moves: { letters: LETTERS, lines: LINES } })));
  assert.throws(() => validateLook(withEntrance({ hand: { rest: 0.8 }, moves: { letters: LETTERS } })), /a look drawn by hand cannot use moves\.letters/);
});

// F-26: a look's chart grow ease is parsed with the look, as a move's ease is, so a typo fails at registration and not when a
// chart is first drawn.
test('kinds.chart.growEase must be an ease that parses', () => {
  const cosmos = registries.looks.get('cosmos');
  const withGrow = (growEase) => ({ ...cosmos, name: 'grow-test', kinds: { ...cosmos.kinds, chart: { ...cosmos.kinds.chart, growEase } } });
  assert.doesNotThrow(() => validateLook(withGrow('outCubic')));
  assert.doesNotThrow(() => validateLook(withGrow('cubic-bezier(0.2,0.8,0.2,1)')));
  assert.throws(() => validateLook(withGrow('outCubc')), /look "grow-test": kinds\.chart\.growEase: unknown ease "outCubc"; did you mean "outCubic"/);
  assert.throws(() => validateLook(withGrow('cubic-bezier(2,0,0,1)')), /kinds\.chart\.growEase: bad ease/);
  assert.throws(() => validateLook(withGrow(3)), /kinds\.chart\.growEase must be an ease name/);
});

test('a stack look takes no statement entrance, because a stack sets its own words', () => {
  assert.throws(() => validateLook(withEntrance({ look: registries.looks.get('pop'), moves: { lines: LINES }, statement: { entrance: 'lines' } })), /look "entrance-test": kinds\.statement\.entrance "lines" is not read by a stack composition/);
});

test('a look that opens composed takes no statement entrance, because its words are set from frame 0', () => {
  for (const name of ['poster', 'keynote', 'ledger']) {
    assert.throws(() => validateLook(withEntrance({ look: registries.looks.get(name), moves: { lines: LINES }, statement: { entrance: 'lines' } })), /look "entrance-test": kinds\.statement\.entrance "lines" is not read by a look that opens composed/, name);
  }
});

test('moveOf returns the look entry, did-you-means an unknown name and refuses a null entry naming the look', () => {
  assert.deepEqual(moveOf(desk(), 'settle'), desk().moves.settle);
  assert.throws(() => moveOf(desk(), 'rse'), /unknown move "rse"; did you mean "rise"\?/);
  assert.throws(() => moveOf(withMoves({ ...desk().moves, wipe: null }), 'wipe'), /look "moves-test" does not use the move "wipe"/);
});

test('--list moves gives nine entries with each listed look values', () => {
  const entries = listEntries('moves');
  assert.deepEqual(entries.map((e) => e.name), NINE);
  for (const entry of entries) assert.deepEqual(Object.keys(entry.looks), registries.looks.names(), entry.name);
  assert.deepEqual(entries.find((e) => e.name === 'settle').looks.desk, desk().moves.settle);
  const text = formatList('moves', entries);
  assert.match(text, /^moves \(9\)/);
  assert.match(text, /^settle {2}/m);
  assert.match(text, /^ {2}desk: outCubic 0\.6 s/m);
});

// ---- motionFacts: a move read as bounce and visible length ----

test('a linear move is visible for 99% of its length and does not bounce', () => assert.deepEqual(motionFacts({ ease: 'linear', dur: 1 }), { bounce: 0, visible: 0.99 }));
test('outQuad settles at 90% of its length, outCubic at 78.5%', () => {
  assert.equal(motionFacts({ ease: 'outQuad', dur: 1 }).visible, 0.9);
  assert.equal(motionFacts({ ease: 'outCubic', dur: 0.5 }).visible, 0.39);
});
test('outBack passes its end by ten percent; inBack does not bounce', () => {
  assert.equal(motionFacts({ ease: 'outBack', dur: 1 }).bounce, 0.1);
  assert.equal(motionFacts({ ease: 'inBack', dur: 1 }).bounce, 0);
});
test('a spring at half damping bounces 16%; a critically damped one does not', () => {
  assert.equal(motionFacts({ ease: 'spring(100,10)', dur: 1 }).bounce, 0.16);
  assert.equal(motionFacts({ ease: 'spring(100,20)', dur: 1 }).bounce, 0);
});
test('a spring is visible for less than its length', () => assert.ok(motionFacts({ ease: 'spring(100,10)', dur: 1 }).visible < 1));
test('the two new forms have facts', () => {
  assert.equal(motionFacts({ ease: 'steps(4)', dur: 1 }).visible, 1);
  assert.equal(motionFacts({ ease: 'steps(4,start)', dur: 1 }).visible, 0.75);
  assert.ok(motionFacts({ ease: 'cubic-bezier(0.34,1.56,0.64,1)', dur: 1 }).bounce > 0);
});
test('a move of no length has no facts to show', () => assert.deepEqual(motionFacts({ ease: 'linear', dur: 0 }), { bounce: 0, visible: 0 }));
test('--list moves prints them, and --json carries them', () => {
  assert.match(formatList('moves', listEntries('moves')), /desk: outCubic 0\.5 s, 24 units, visible 0\.39 s/);
  assert.deepEqual(listEntries('moves').find((m) => m.name === 'rise').facts.desk, { bounce: 0, visible: 0.39 });
});
test('a bounce prints as a percent; a look that does not use a move has null facts and its line is unchanged', () => {
  const entries = listEntries('moves');
  const pop = entries.find((m) => m.name === 'pop');
  const bouncing = Object.entries(pop.facts).find(([, f]) => f !== null && f.bounce > 0);
  assert.ok(bouncing, 'some look pops with a bounce');
  assert.match(formatList('moves', entries), new RegExp(`^ {2}${bouncing[0]}: .*, bounce ${Math.round(bouncing[1].bounce * 100)}%, visible `, 'm'));
  const slam = entries.find((m) => m.name === 'slam');
  const unused = Object.entries(slam.looks).find(([, move]) => move === null);
  assert.ok(unused, 'some look does not slam');
  assert.equal(slam.facts[unused[0]], null);
  assert.match(formatList('moves', entries), new RegExp(`^ {2}${unused[0]}: not used$`, 'm'));
});
test('letters report one letter plus the stagger, and the text prints the stagger', () => {
  const letters = listEntries('moves').find((m) => m.name === 'letters');
  assert.deepEqual(letters.facts.cosmos, { ...motionFacts({ ease: 'steps(3)', dur: 0.18 }), stagger: 0.035 });
  assert.equal(letters.facts.cosmos.visible, 0.18);
  assert.equal(letters.facts.desk, null);
  assert.match(formatList('moves', listEntries('moves')), /^ {2}cosmos: steps\(3\) 0\.18 s, visible 0\.18 s, stagger 0\.035 s$/m);
  const lines = listEntries('moves').find((m) => m.name === 'lines');
  assert.equal(Object.hasOwn(lines.facts.desk, 'stagger'), false);
});

test('make --list moves exits 0; --list movs exits 2 naming the accepted lists', () => {
  const ok = make(['--list', 'moves']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^moves \(9\)/);
  const bad = make(['--list', 'movs']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /kinds, looks, modes, devices, moves, cuts, fields/);
});
