// The named moves of the v2 engine. Importing this file registers each in registries.moves (once: a second evaluation
// leaves the registry as it is). A move is only a name and a summary here; its values are look data (look.moves.<name>:
// a Move { ease, dur, dist?, step?, scale? }, or null where the look does not use it), which validateLook requires for
// every registered move and moveOf reads. Kinds name moves; `on` events still place devices. `letters` ({ ease, dur,
// dist?, stagger }) and `lines` ({ ease, dur, dist? }) are entrances only: no end value, so every track built from them
// ends at the identity. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { ease } from '../time/ease.mjs';

export const MOVES = Object.freeze([
  { name: 'rise', summary: 'An entrance that rises a short way into place as it fades in.' },
  { name: 'wipe', summary: 'A reveal that wipes across the part, as a mask opening.' },
  { name: 'slam', summary: 'A hard arrival: the part lands from larger with a spring, or appears at once where the look does not slam.' },
  { name: 'pop', summary: 'A springy entrance that grows the part in from smaller.' },
  { name: 'draw', summary: 'A stroke that draws on along its path.' },
  { name: 'count', summary: 'A figure that counts up to its value.' },
  { name: 'settle', summary: 'A slow ease into a new place or size, for parts that move or rank while on screen.' },
  { name: 'letters', summary: "An entrance that brings a word in one letter after another, the word's spacing kept." },
  { name: 'lines', summary: 'An entrance that brings each line in as one block.' },
].map(Object.freeze));

export const MOVE_NAMES = Object.freeze(MOVES.map((m) => m.name));

for (const { name, summary } of MOVES) {
  if (!registries.moves.has(name)) registries.moves.add(name, Object.freeze({ summary }));
}

/** A sample within this of 1 counts as arrived: the viewer no longer sees the move. */
export const VISIBLE_EPSILON = 0.01;
/** How many steps of p the curve is sampled at (0 to 1). */
export const FACT_SAMPLES = 1000;

const round2 = (x) => Math.round(x * 100) / 100;

/**
 * A move read as numbers a person can compare. `bounce`: how far the curve passes its end (0.1 is ten percent past; a dip
 * below 0 on the way in is not bounce). `visible`: the seconds a viewer sees it move, `dur` times the first sampled p from
 * which every later sample stays within VISIBLE_EPSILON of 1, so a spring, whose tail the ease stretches to `dur`, is
 * visible for less than `dur`. A `dur` of 0 has neither. Both to 2 decimals.
 * @param {{ ease: string, dur: number }} move
 * @returns {{ bounce: number, visible: number }}
 */
export function motionFacts(move) {
  if (!(move.dur > 0)) return { bounce: 0, visible: 0 };
  const f = ease(move.ease);
  let peak = 0;
  let lastAway = -1; // the last sample still further than VISIBLE_EPSILON from 1
  for (let i = 0; i <= FACT_SAMPLES; i++) {
    const y = f(i / FACT_SAMPLES);
    if (y > peak) peak = y;
    if (Math.abs(1 - y) > VISIBLE_EPSILON) lastAway = i;
  }
  return { bounce: round2(Math.max(0, peak - 1)), visible: round2(move.dur * ((lastAway + 1) / FACT_SAMPLES)) };
}

/** look.moves[name], the look's values for a registered move; throws for an unknown name (with did-you-mean) and for a
 *  move the look does not use (its entry is null). */
export function moveOf(look, name) {
  registries.moves.get(name); // throws the registry's own message: the unknown name, the close one and the names it has
  const move = look.moves?.[name];
  if (move === null || move === undefined) throw new Error(`look "${look.name}" does not use the move "${name}"`);
  return move;
}
