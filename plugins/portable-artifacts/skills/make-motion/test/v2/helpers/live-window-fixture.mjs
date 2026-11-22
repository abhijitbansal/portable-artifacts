// The generator of fixtures/cuts/live-window-keys.json, the pin of cuts-live-pin.test.mjs: the digest of every frame inside
// each layer or shader cut window of references/examples/v2/cuts-desk.json. Writes only when run directly, as
// example-timelines.mjs does. Regenerate it only for an intended change of those frames (stated in the commit), never to
// clear a red test:
//   node plugins/portable-artifacts/skills/make-motion/test/v2/helpers/live-window-fixture.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../../scripts/v2/list.mjs'; // registers the looks, kinds, devices and cuts, as make.mjs does
import { stateKey } from '../../../engine/graph/sample.mjs';
import { buildTimeline } from '../../../engine/script/timing.mjs';
import { buildFilm } from '../../../engine/graph/film.mjs';
import { measure, canvasOf, viralOf } from './kinds.mjs';
import { liveWindowKeys } from './live-window.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE = path.resolve(HERE, '../fixtures/cuts/live-window-keys.json');
const EXAMPLES_DIR = path.resolve(HERE, '../../../references/examples/v2');
export const PINNED_FILM = 'cuts-desk';
const REGENERATED = 'motion-steals W6 task 4 (desk takes the `lines` statement entrance, so a desk statement on one side of a window carries line tracks, not word fades): the 7 windows with a desk statement on one side, into dissolve, dip, page, focus, curl, drop and warp; the other 4 (steps, circle, gust, slats) are unchanged.';
const NOTE = 'Every frame inside a layer or shader cut window of the film, digested over the incoming shot, the cut and its progress, and the outgoing shot with its film second and live flag. Made after motion-steals W2 Task 8, when the outgoing shot began to keep moving past its end: a window whose outgoing shot freezes again, or is carried on differently, changes its sha. Regenerate with a stated reason if the film or a look changes under it, never to clear a red test.';

/** The fixture as it is written: the note, the film's name and the digest of each of its windows. */
export function liveWindowFixture() {
  const film = JSON.parse(readFileSync(path.join(EXAMPLES_DIR, `${PINNED_FILM}.json`), 'utf8'));
  const windows = liveWindowKeys({ stateKey, buildTimeline, buildFilm, measure, canvasOf, viralOf }, film);
  return { note: NOTE, film: PINNED_FILM, regenerated: REGENERATED, windows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fixture = liveWindowFixture();
  writeFileSync(FIXTURE, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`${Object.keys(fixture.windows).length} live windows frozen in ${FIXTURE}`);
}
