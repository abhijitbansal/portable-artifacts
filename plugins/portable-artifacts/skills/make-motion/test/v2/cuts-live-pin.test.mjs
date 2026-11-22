// The layer and shader windows of references/examples/v2/cuts-desk.json, pinned (motion-steals W2 Task 8): inside each, the
// outgoing shot keeps moving past its end. No other golden holds a layer or shader window frame (kinds-frozen reads films
// of node cuts; baseline-keys.json reads node cuts). The fixture is made by helpers/live-window-fixture.mjs (run it directly).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../scripts/v2/list.mjs';
import { stateKey } from '../../engine/graph/sample.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm } from '../../engine/graph/film.mjs';
import { measure, canvasOf, viralOf } from './helpers/kinds.mjs';
import { liveWindowKeys } from './helpers/live-window.mjs';
import { liveWindowFixture } from './helpers/live-window-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '../..');
const pinned = JSON.parse(readFileSync(path.join(HERE, 'fixtures/cuts/live-window-keys.json'), 'utf8'));
const film = JSON.parse(readFileSync(path.join(SKILL, 'references/examples/v2', `${pinned.film}.json`), 'utf8'));
const engine = { stateKey, buildTimeline, buildFilm, measure, canvasOf, viralOf };

test('the fixture pins every layer and shader window of the film, each with a live outgoing shot', () => {
  const windows = Object.entries(pinned.windows);
  assert.equal(windows.length, 11, 'crossfade, fade, 2 wipes, iris, blur and the 5 shader cuts');
  for (const [name, w] of windows) {
    assert.equal(w.live, true, name);
    assert.match(w.sha, /^[0-9a-f]{64}$/, name);
    assert.ok(w.frames >= 12, `${name}: a window of at least 0.4 s at 30 fps`);
  }
});

// F-11: the generator used to stamp a fixed reason, so the next regeneration, for any cause, would have recorded a false one.
test('the generator records the reason it is given and refuses to run without one', () => {
  assert.equal(liveWindowFixture('a stated reason').regenerated, 'a stated reason');
  for (const none of [undefined, '', '  ']) assert.throws(() => liveWindowFixture(none), /give the reason/);
});

test('every frame inside the layer and shader windows of cuts-desk is the frame it was: the outgoing shot keeps moving', () => {
  assert.deepEqual(liveWindowKeys(engine, film), pinned.windows);
});
