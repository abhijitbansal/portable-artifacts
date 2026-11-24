// The blind half of the arms test: what a reader is shown, the key kept apart, and the readers' reply files. A packet holds
// the repository-made PNG sheets of a film under a random name and nothing else (no arm letter, no spec, no board, no JSON);
// the name -> arm key goes to <out>/private/key.json, apart from blind/ (the only folder a reader is given).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BASELINE, isFailed, parseRatings } from './arms-lib.mjs';

// Words of one length, so no name is told apart by its size.
export const WORDS = [
  'amber', 'birch', 'cedar', 'cloud', 'coral', 'crane', 'daisy', 'delta', 'eagle', 'ember', 'finch', 'flint', 'frost', 'glade',
  'grain', 'grove', 'haven', 'hazel', 'heron', 'ivory', 'jewel', 'kayak', 'lemon', 'lilac', 'lunar', 'maple', 'marsh', 'mocha',
  'noble', 'north', 'oasis', 'olive', 'onion', 'otter', 'pearl', 'pilot', 'plume', 'quail', 'raven', 'ridge', 'river', 'robin',
  'sable', 'slate', 'stone', 'swift', 'tulip', 'umber', 'vivid', 'wheat', 'xenon', 'yacht', 'zebra',
];
const WORDS_PER_NAME = 3;
const MAX_DRAWS_PER_NAME = 1000;
const MIN_FILMS_TO_RATE = 2;

/** `count` names not in `used`, each three random words joined by `-` (added to `used`). `randomInt` is crypto.randomInt unless a test gives one. */
export function makeNames(count, randomInt = crypto.randomInt, used = new Set()) {
  const names = [];
  for (let draws = 0; names.length < count; draws += 1) {
    if (draws > count * MAX_DRAWS_PER_NAME) throw new Error('could not draw enough unused names: the random source repeats itself');
    const name = Array.from({ length: WORDS_PER_NAME }, () => WORDS[randomInt(WORDS.length)]).join('-');
    if (used.has(name)) continue;
    used.add(name);
    names.push(name);
  }
  return names;
}

// Fisher-Yates over a copy, so which name a film gets does not follow the order the arms ran in.
function shuffled(list, randomInt) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The PNG files directly in the sheets folder, by name: a folder inside it (the board) and any other file are left out.
function sheetFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && /\.png$/i.test(e.name)).map((e) => e.name).sort();
}

function writePacket(blindDir, name, sheetsFrom, files) {
  const dir = path.join(blindDir, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(dir, f), fs.readFileSync(path.join(sheetsFrom, f)));
}

/**
 * Write <out>/blind/<prompt>/<name>/*.png and <out>/blind/<prompt>/brief.txt, and the key ({ prompt: { name: arm } }) to
 * <out>/private/key.json, from the finished cases. Everything a reader may be given is under blind/; the key is kept in private/.
 * A failed case has no packet; a prompt whose A failed has none at all, and one with fewer than two live films has nothing to
 * rank. Made once: an existing key.json is refused, because the ratings are tied to its names. -> the key.
 */
export function writePackets({ out, cases, prompts, sheetsDir, randomInt = crypto.randomInt }) {
  const keyFile = path.join(out, 'private', 'key.json');
  if (fs.existsSync(keyFile)) throw new Error(`${keyFile} already exists: packets are made once, because the ratings are tied to its names`);
  const plan = planPackets({ out, cases, prompts, sheetsDir }); // everything is checked before the first file is written
  const used = new Set();
  const key = {};
  for (const { prompt, text, films } of plan) {
    const names = makeNames(films.length, randomInt, used);
    const blindDir = path.join(out, 'blind', prompt);
    fs.mkdirSync(blindDir, { recursive: true });
    fs.writeFileSync(path.join(blindDir, 'brief.txt'), text);
    key[prompt] = {};
    shuffled(films, randomInt).forEach((film, i) => {
      key[prompt][names[i]] = film.arm;
      writePacket(blindDir, names[i], film.dir, film.files);
    });
  }
  fs.mkdirSync(path.dirname(keyFile), { recursive: true });
  fs.writeFileSync(keyFile, `${JSON.stringify(key, null, 2)}\n`);
  return key;
}

// The prompts that need rating, each with its text and its live films (arm, sheets folder, PNG names).
function planPackets({ out, cases, prompts, sheetsDir }) {
  const byPrompt = new Map();
  for (const c of cases) byPrompt.set(c.prompt, [...(byPrompt.get(c.prompt) ?? []).filter((x) => x.arm !== c.arm), c]);
  const plan = [];
  for (const [prompt, group] of byPrompt) {
    const a = group.find((c) => c.arm === BASELINE);
    const live = group.filter((c) => !isFailed(c));
    if (!a || isFailed(a) || live.length < MIN_FILMS_TO_RATE) continue;
    const text = prompts.find((p) => p.id === prompt)?.prompt;
    if (typeof text !== 'string') throw new Error(`prompt ${prompt} is not in the prompt set`);
    const films = live.map((c) => {
      const dir = path.join(out, 'cases', prompt, c.arm, sheetsDir);
      return { arm: c.arm, dir, files: sheetFiles(dir) };
    });
    for (const f of films) if (f.files.length === 0) throw new Error(`no sheets for ${prompt} ${f.arm}: ${f.dir} has no PNG files`);
    plan.push({ prompt, text, films });
  }
  return plan;
}

/**
 * The readers' replies in `dir`: one file per reader per prompt, named <prompt>.<reader>.json, holding the reader's reply text.
 * -> { prompt: [parseRatings result or null, ...] } for every prompt of the key, in file name order; files of other prompts and
 * files that are not .json are ignored.
 */
export function readRatings(dir, key) {
  const ratings = Object.fromEntries(Object.keys(key).map((p) => [p, []]));
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) continue;
    const stem = file.slice(0, -'.json'.length);
    const prompt = stem.slice(0, stem.lastIndexOf('.'));
    if (!prompt || !Object.hasOwn(ratings, prompt)) continue;
    ratings[prompt].push(parseRatings(fs.readFileSync(path.join(dir, file), 'utf8'), Object.keys(key[prompt])));
  }
  return ratings;
}
