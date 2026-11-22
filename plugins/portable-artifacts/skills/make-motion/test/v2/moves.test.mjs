// The move registry (engine/moves/index.mjs): the seven named moves, a look's entry for each (a Move, or null where the
// look does not use it), moveOf with did-you-mean, and --list moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registries, createRegistry } from '../../engine/registry.mjs';
import { MOVE_NAMES, moveOf } from '../../engine/moves/index.mjs';
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

test('a stack look takes no statement entrance, because a stack sets its own words', () => {
  assert.throws(() => validateLook(withEntrance({ look: registries.looks.get('poster'), moves: { lines: LINES }, statement: { entrance: 'lines' } })), /look "entrance-test": kinds\.statement\.entrance "lines" is not read by a stack composition/);
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

test('make --list moves exits 0; --list movs exits 2 naming the accepted lists', () => {
  const ok = make(['--list', 'moves']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^moves \(9\)/);
  const bad = make(['--list', 'movs']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /kinds, looks, modes, devices, moves, cuts, fields/);
});
