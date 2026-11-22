// make.mjs --inspect <film time>: one moment of the film as a PNG and a JSON dump. The PNG is the film's own frame, post
// pass and captions included; the JSON lists every node on it (engine/review/inspect-nodes.mjs: id, box, opacity, and for a
// text its height in units, its ink and whether it left the safe area), the safe rectangle and, inside a cut's window, the
// cut. Inside a layer or shader cut's window the PNG is the cut's composition at `p`: the outgoing shot (still moving) and
// the incoming one, each as faded, moved or covered as the cut's recipe has it at that `p`, so one of them may be partly or
// wholly gone (a crossfade shows both only for p between 0.3 and 0.5). `nodes` lists the incoming shot alone (the page's
// __snapshot, engine/page/stage.mjs), so `cut` names the outgoing shot and the second it stands at. No review, no sound,
// no ffmpeg: the browser writes the picture.
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cutWindowAt } from '../../engine/graph/film.mjs';
import { inspectNodes } from '../../engine/review/inspect-nodes.mjs';
import { unitOf } from '../../engine/units.mjs';
import { frameContext } from './review.mjs';

const SECONDS_DECIMALS = 4;
const OUTGOING_DECIMALS = 3;
const round = (n, decimals) => Number(n.toFixed(decimals));

/** Where `<dir>/<frame>.png` and `<frame>.json` go: `<out stem>.inspect/` beside the MP4 path. */
export const inspectDir = (videoOut) => path.join(path.dirname(videoOut), `${path.basename(videoOut, path.extname(videoOut))}.inspect`);

/**
 * The cut whose window frame `frame` is in, or null (the film's first shot, a hard cut, a frame past the window): { name,
 * family, p, from: { shot, seconds, live } }. `p` is how far the cut has come (0 on its first frame); `from.shot` is the
 * outgoing shot's id and `from.seconds` the second of that shot the page draws it at, which a layer or shader cut keeps
 * moving past the shot's end (`live`), and any other cut, or a look drawn by hand, holds at its last frame. The window is the
 * engine's own (engine/graph/film.mjs cutWindowAt, the one frameAt opens): the cut's own length, or the shot's when shorter.
 */
export function cutAt(film, timeline, frame) {
  const found = cutWindowAt(film, timeline, frame);
  if (found === null) return null;
  const { cut } = found;
  return { name: cut.name, family: cut.family, p: round(found.p, SECONDS_DECIMALS), from: { shot: timeline.shots[found.from].id, seconds: round(found.outgoingT, OUTGOING_DECIMALS), live: found.live } };
}

// Both files written whole or not at all: each to a partial beside it, renamed once every partial is written.
function writeWhole(files) {
  mkdirSync(path.dirname(files[0][0]), { recursive: true });
  const partials = files.map(([file]) => path.join(path.dirname(file), `.${path.basename(file)}.partial-${process.pid}`));
  try {
    files.forEach(([, data], k) => writeFileSync(partials[k], data, { flag: 'wx' }));
    files.forEach(([file], k) => renameSync(partials[k], file));
  } finally {
    partials.forEach((partial) => rmSync(partial, { force: true }));
  }
}

/**
 * Draws `frame` on the session's page, and writes `<dir>/<frame>.png` and `<dir>/<frame>.json`. The JSON: { frame, seconds,
 * shot, timed, canvas: { w, h }, unit, safe: { left, top, right, bottom }, cut: { name, family, p, from } | null, nodes }.
 * `shot` is the shot the frame belongs to (the incoming one inside a window). `nodes` are as the page's __snapshot gives
 * them: inside a layer or shader cut's window the incoming shot's alone, whatever the PNG shows of the outgoing one at that
 * `p`; a node cut moves both shots' nodes in one tree, which `nodes` lists as drawn. -> { png, json, frame, seconds, shot }.
 */
export async function writeInspect({ session, frame, dir }) {
  const { page, film, timeline, info } = session;
  await page.evaluate((i) => window.__seek(i), frame);
  const picture = await page.screenshot({ type: 'png' });
  const sampled = await page.evaluate((i) => window.__snapshot(i), frame);
  const ctx = frameContext(film, timeline, new Map(), { frame, whole: false }, info.backgrounds);
  const seconds = round(frame / timeline.fps, SECONDS_DECIMALS);
  const dump = { frame, seconds, shot: ctx.shotId, timed: timeline.timed, canvas: ctx.canvas, unit: unitOf(ctx.canvas), safe: ctx.safe, cut: cutAt(film, timeline, frame), nodes: inspectNodes(sampled, ctx) };
  const png = path.join(dir, `${frame}.png`), json = path.join(dir, `${frame}.json`);
  writeWhole([[png, picture], [json, `${JSON.stringify(dump, null, 2)}\n`]]);
  return { png, json, frame, seconds, shot: ctx.shotId };
}
