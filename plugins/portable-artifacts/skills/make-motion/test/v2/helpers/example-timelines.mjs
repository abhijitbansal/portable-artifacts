// The estimated timeline of every example film in references/examples/v2, as a digest, and the digests frozen in
// fixtures/timeline-examples.json (read by narration-shift.test.mjs, which pins today's timeline for a film with no
// `narration`). Regenerate the fixture only for an intended change of a film's timeline, or after adding an example film:
//   node plugins/portable-artifacts/skills/make-motion/test/v2/helpers/example-timelines.mjs
import { createHash } from 'node:crypto';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { loadFilm } from '../../../scripts/v2/pipeline.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXAMPLES_DIR = path.resolve(HERE, '../../../references/examples/v2');
export const FIXTURE = path.resolve(HERE, '../fixtures/timeline-examples.json');
const HASH_LENGTH = 12;

const hashOf = (value) => createHash('sha256').update(String(JSON.stringify(value))).digest('hex');
// One short hash per key, in the object's key order; a key whose value is undefined still gets one.
const partsOf = (object) => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, hashOf(value).slice(0, HASH_LENGTH)]));

/** { sha, top, shots }: the whole timeline's sha256, and a hash per top-level key and per key of each shot entry. */
export function digestOf(timeline) {
  const { shots, ...top } = timeline;
  return { sha: hashOf(timeline), top: partsOf(top), shots: shots.map(partsOf) };
}

const sameKeys = (a, b) => JSON.stringify(Object.keys(a)) === JSON.stringify(Object.keys(b));

function firstPartDifference(actual, frozen, where) {
  if (!sameKeys(actual, frozen)) return `${where}: keys are ${Object.keys(actual).join(', ')}, frozen ${Object.keys(frozen).join(', ')}`;
  const key = Object.keys(actual).find((k) => actual[k] !== frozen[k]);
  return key === undefined ? null : `${where}.${key} differs`;
}

/** Where `actual` first differs from the `frozen` digest as a sentence, or null when the sha is the same. */
export function firstDifference(actual, frozen) {
  if (actual.sha === frozen.sha) return null;
  const top = firstPartDifference(actual.top, frozen.top, 'timeline');
  if (top !== null) return top;
  if (actual.shots.length !== frozen.shots.length) return `timeline has ${actual.shots.length} shots, frozen ${frozen.shots.length}`;
  for (let i = 0; i < actual.shots.length; i += 1) {
    const found = firstPartDifference(actual.shots[i], frozen.shots[i], `shots[${i}]`);
    if (found !== null) return found;
  }
  return 'the sha differs but no part does (key order of the timeline?)';
}

/** The example film files, sorted. */
export const exampleFiles = () => readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.json')).sort();

/** The digest of every example film's estimated timeline (no voice), by file name. */
export const exampleDigests = () => Object.fromEntries(exampleFiles().map((name) => [name, digestOf(loadFilm(path.join(EXAMPLES_DIR, name)).timeline)]));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const digests = exampleDigests();
  writeFileSync(FIXTURE, `${JSON.stringify(digests, null, 1)}\n`);
  console.log(`${Object.keys(digests).length} example timelines frozen in ${FIXTURE}`);
}
