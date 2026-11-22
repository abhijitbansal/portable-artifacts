// The frames inside the layer and shader cut windows of a film, pinned (cuts-live-pin.test.mjs,
// fixtures/cuts/live-window-keys.json). A layer or shader window composes two pictures (engine/graph/film.mjs frameAt):
// the incoming shot and the outgoing one in `from`, which since motion-steals W2 Task 8 keeps moving past its end. The
// 2D state key of the cut-baseline pin holds only the incoming shot, so it cannot see the outgoing one; this digest reads
// both, with the outgoing shot's film second and `live` flag, so a window whose outgoing shot froze again (or was carried
// on wrongly) changes it. One SHA-256 per window, over the digest of each of its frames. Built with the estimated timeline
// and the stand-in text measure of helpers/kinds.mjs. This file imports nothing but node:crypto: the engine it reads is
// passed in, so the same code runs against the working tree (the test) and the generator (live-window-fixture.mjs).
import { createHash } from 'node:crypto';

const DEFAULT_FPS = 30; // a film that names no fps (scripts/v2/spec.mjs DEFAULT_FPS)
// every picture the example films name, at one size: the pin needs a size, not the picture's own
const PICTURE_SIZE = Object.freeze([1600, 1000]);
const PICTURES = Object.freeze(['clipping.png', 'photo.png', 'dashboard.png']);

const sha = (text) => createHash('sha256').update(text).digest('hex');

// One frame inside a window: the incoming shot, the cut and its progress, the outgoing shot and where it stands.
function frameDigest(stateKey, frame) {
  const { background, sampled, cut, from } = frame;
  return sha(JSON.stringify({
    to: stateKey({ background, sampled }),
    cut: [cut.name, cut.family, cut.direction, cut.p],
    from: { shot: from.shot, t: from.t, live: from.live === true, state: stateKey({ background: from.background, sampled: from.sampled }) },
  }));
}

/** { "into <shot id>": { frames, live, sha } } for every layer or shader window of `film`: how many frames it has, whether
 *  its outgoing shot is live, and one SHA-256 over every frame's digest. `engine`: { stateKey, buildTimeline, buildFilm,
 *  measure, canvasOf, viralOf } of the tree being pinned or checked. */
export function liveWindowKeys(engine, film) {
  const { stateKey, buildTimeline, buildFilm, measure, canvasOf, viralOf } = engine;
  const timeline = buildTimeline(film, { fps: film.fps ?? DEFAULT_FPS });
  const canvas = canvasOf(film.format);
  const assets = new Map(PICTURES.map((src) => [src, { width: PICTURE_SIZE[0], height: PICTURE_SIZE[1] }]));
  const built = buildFilm({ film, timeline, measure, assets, canvas, viralInsets: viralOf(canvas) });
  const windows = new Map();
  for (let i = 0; i < timeline.frameCount; i += 1) {
    const frame = built.frameAt(i / timeline.fps);
    if (frame.from === undefined) continue;
    const into = film.shots[frame.from.shot + 1].id;
    const entry = windows.get(into) ?? { digests: [], live: frame.from.live === true };
    entry.digests.push(frameDigest(stateKey, frame));
    windows.set(into, entry);
  }
  return Object.fromEntries([...windows].map(([into, { digests, live }]) => [`into ${into}`, { frames: digests.length, live, sha: sha(digests.join('\n')) }]));
}
