// Blind packets and the reader replies: what a reader is shown names no arm, and the key lives apart.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WORDS, makeNames, readRatings, writePackets } from '../arms-packets.mjs';
import { cleanup, tmp } from './helpers/arms-fixtures.mjs';

after(cleanup);

const PNG = (label) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]), Buffer.from(label)]);
const PROMPTS = [{ id: 'film-1', prompt: 'Make a launch film.' }, { id: 'film-2', prompt: 'Make a recap film.' }];

// <out>/cases/<prompt>/<arm>/film.sheets/{strip-01.png, strip-02.png, board/board.png, notes.txt, extra.json}
function caseFolders(out, specs) {
  for (const { prompt, arm } of specs) {
    const dir = path.join(out, 'cases', prompt, arm, 'film.sheets');
    fs.mkdirSync(path.join(dir, 'board'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'strip-01.png'), PNG(`one-${prompt}`));
    fs.writeFileSync(path.join(dir, 'strip-02.png'), PNG(`two-${prompt}`));
    fs.writeFileSync(path.join(dir, 'board', 'board.png'), PNG('board'));
    fs.writeFileSync(path.join(dir, 'notes.txt'), `arm ${arm}`);
    fs.writeFileSync(path.join(dir, 'extra.json'), JSON.stringify({ arm }));
    fs.writeFileSync(path.join(out, 'cases', prompt, arm, 'film.json'), '{}');
  }
}
const good = (prompt, arm) => ({ prompt, arm, timedOut: false, capped: false, specExists: true, mp4: true, checkOk: true });
const specsFor = (prompts) => prompts.flatMap((prompt) => ['A', 'D', 'C'].map((arm) => ({ prompt, arm })));

function packets({ cases, prompts = PROMPTS, randomInt } = {}) {
  const out = tmp('pa-packets-out-');
  const list = cases ?? specsFor(['film-1', 'film-2']).map((s) => good(s.prompt, s.arm));
  caseFolders(out, list.map(({ prompt, arm }) => ({ prompt, arm })));
  const key = writePackets({ out, cases: list, prompts, sheetsDir: 'film.sheets', ...(randomInt ? { randomInt } : {}) });
  return { out, key, blind: path.join(out, 'blind') };
}

test('the word list is words of one length, no repeats', () => {
  assert.ok(WORDS.length >= 32);
  assert.equal(new Set(WORDS.map((w) => w.length)).size, 1);
  assert.equal(new Set(WORDS).size, WORDS.length);
  for (const w of WORDS) assert.match(w, /^[a-z]+$/);
});

test('makeNames: unique names of three words of equal length', () => {
  const names = makeNames(40);
  assert.equal(new Set(names).size, 40);
  for (const n of names) assert.match(n, new RegExp(`^[a-z]{${WORDS[0].length}}-[a-z]{${WORDS[0].length}}-[a-z]{${WORDS[0].length}}$`));
});

test('makeNames: an exhausted random source stops with an error instead of looping forever', () => {
  assert.throws(() => makeNames(2, () => 0), /could not draw/);
});

test('a packet holds only the PNG sheets of the repository-made folder, copied by content', () => {
  const { blind, key } = packets();
  const names = Object.keys(key['film-1']);
  assert.equal(names.length, 3);
  for (const name of names) {
    const dir = path.join(blind, 'film-1', name);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['strip-01.png', 'strip-02.png']);
    assert.deepEqual(fs.readFileSync(path.join(dir, 'strip-01.png')), PNG('one-film-1'));
  }
});

test('a packet names no arm: no A, D or C folder, no .json, no board, no arm in a file name or in the text files', () => {
  const { blind, out, key } = packets();
  const all = fs.readdirSync(blind, { recursive: true }).map(String);
  for (const rel of all) {
    for (const segment of rel.split(path.sep)) assert.doesNotMatch(segment, /^(A|D|C)$/, rel);
    assert.doesNotMatch(rel, /\.json$/, rel);
    assert.doesNotMatch(rel, /board/i, rel);
  }
  const files = all.filter((rel) => fs.statSync(path.join(blind, rel)).isFile());
  assert.ok(files.length > 0);
  for (const rel of files) assert.ok(rel.endsWith('.png') || path.basename(rel) === 'brief.txt', `only sheets and the brief: ${rel}`);
  for (const rel of files.filter((f) => f.endsWith('.png'))) assert.doesNotMatch(fs.readFileSync(path.join(blind, rel), 'latin1'), /\b(arm|[ADC]\b)/, `no arm named inside ${rel}`);
  assert.equal(fs.existsSync(path.join(blind, 'key.json')), false);
  assert.ok(fs.existsSync(path.join(out, 'key.json')), 'the key sits beside blind/, not inside it');
  void key;
});

test('the brief of a prompt is its text, and the key maps each name to an arm', () => {
  const { blind, out, key } = packets();
  assert.equal(fs.readFileSync(path.join(blind, 'film-1', 'brief.txt'), 'utf8'), 'Make a launch film.');
  assert.equal(fs.readFileSync(path.join(blind, 'film-2', 'brief.txt'), 'utf8'), 'Make a recap film.');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8')), key);
  assert.deepEqual(Object.values(key['film-1']).sort(), ['A', 'C', 'D']);
  assert.deepEqual(fs.readdirSync(path.join(blind, 'film-1')).sort(), [...Object.keys(key['film-1']), 'brief.txt'].sort());
});

test('names are random: they are not derived from the arm, and two runs over the same cases differ', () => {
  const one = packets().key;
  const two = packets().key;
  assert.notDeepEqual(Object.keys(one['film-1']).sort(), Object.keys(two['film-1']).sort());
  const names = Object.keys(one['film-1']).concat(Object.keys(one['film-2']));
  assert.equal(new Set(names).size, 6, 'no name repeats across prompts');
});

test('a failed case has no packet and its name is absent from the key', () => {
  const cases = specsFor(['film-1', 'film-2']).map((s) => (s.prompt === 'film-1' && s.arm === 'D' ? { ...good(s.prompt, s.arm), checkOk: false } : good(s.prompt, s.arm)));
  const { blind, key } = packets({ cases });
  assert.deepEqual(Object.values(key['film-1']).sort(), ['A', 'C']);
  assert.equal(fs.readdirSync(path.join(blind, 'film-1')).length, 3, 'two films and the brief');
  assert.equal(Object.keys(key['film-2']).length, 3);
});

test('a prompt where A failed has no packet at all, and one with a single live film needs no rating', () => {
  const cases = [
    ...specsFor(['film-1']).map((s) => (s.arm === 'A' ? { ...good(s.prompt, s.arm), mp4: false } : good(s.prompt, s.arm))),
    ...specsFor(['film-2']).map((s) => (s.arm === 'A' ? good(s.prompt, s.arm) : { ...good(s.prompt, s.arm), timedOut: true })),
  ];
  const { blind, key } = packets({ cases });
  assert.deepEqual(key, {});
  assert.equal(fs.existsSync(path.join(blind, 'film-1')), false);
  assert.equal(fs.existsSync(path.join(blind, 'film-2')), false);
});

test('a live case with no PNG sheets stops the packets with an error naming it', () => {
  const out = tmp('pa-packets-out-');
  const cases = specsFor(['film-1']).map((s) => good(s.prompt, s.arm));
  caseFolders(out, cases);
  fs.rmSync(path.join(out, 'cases', 'film-1', 'D', 'film.sheets', 'strip-01.png'));
  fs.rmSync(path.join(out, 'cases', 'film-1', 'D', 'film.sheets', 'strip-02.png'));
  assert.throws(() => writePackets({ out, cases, prompts: PROMPTS, sheetsDir: 'film.sheets' }), /no sheets.*film-1.*D/);
});

test('packets are made once: a second run over the same out folder is refused, the key stays', () => {
  const { out, key } = packets();
  assert.throws(() => writePackets({ out, cases: specsFor(['film-1']).map((s) => good(s.prompt, s.arm)), prompts: PROMPTS, sheetsDir: 'film.sheets' }), /key\.json already exists/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'key.json'), 'utf8')), key);
});

test('a case whose prompt is not in the set is an error', () => {
  const out = tmp('pa-packets-out-');
  const cases = specsFor(['film-9']).map((s) => good(s.prompt, s.arm));
  caseFolders(out, cases);
  assert.throws(() => writePackets({ out, cases, prompts: PROMPTS, sheetsDir: 'film.sheets' }), /film-9/);
});

const KEY = { 'film-1': { 'aaaaa-bbbbb-ccccc': 'A', 'ddddd-eeeee-fffff': 'D' }, 'film-2': { 'ggggg-hhhhh-iiiii': 'A', 'jjjjj-kkkkk-lllll': 'C' } };

test('readRatings: <prompt>.<reader>.json files, parsed against the names of that prompt; a bad reply is null; unknown prompts are ignored', () => {
  const dir = tmp('pa-ratings-');
  const put = (name, text) => fs.writeFileSync(path.join(dir, name), text);
  put('film-1.r1.json', '{"ranks":{"aaaaa-bbbbb-ccccc":1,"ddddd-eeeee-fffff":2}}');
  put('film-1.r2.json', 'My ranking: ```json\n{"ranks":{"aaaaa-bbbbb-ccccc":2,"ddddd-eeeee-fffff":1}}\n```');
  put('film-1.r3.json', 'I could not decide');
  put('film-2.r1.json', '{"ranks":{"aaaaa-bbbbb-ccccc":1,"jjjjj-kkkkk-lllll":2}}'); // a film-1 name in film-2's reply
  put('film-9.r1.json', '{"ranks":{"x":1}}');
  put('notes.txt', 'ignored');
  const ratings = readRatings(dir, KEY);
  assert.deepEqual(Object.keys(ratings).sort(), ['film-1', 'film-2']);
  assert.deepEqual(ratings['film-1'], [{ ranks: { 'aaaaa-bbbbb-ccccc': 1, 'ddddd-eeeee-fffff': 2 } }, { ranks: { 'aaaaa-bbbbb-ccccc': 2, 'ddddd-eeeee-fffff': 1 } }, null]);
  assert.deepEqual(ratings['film-2'], [null], 'it names a film that is not in this prompt');
});

test('readRatings: a prompt with no file has no readings; a dotted prompt id keeps its dots', () => {
  const dir = tmp('pa-ratings-');
  fs.writeFileSync(path.join(dir, 'v1.5.r1.json'), '{"ranks":{"x":1,"y":2}}');
  const ratings = readRatings(dir, { 'v1.5': { x: 'A', y: 'D' }, other: { p: 'A', q: 'D' } });
  assert.deepEqual(ratings['v1.5'], [{ ranks: { x: 1, y: 2 } }]);
  assert.deepEqual(ratings.other, []);
});
