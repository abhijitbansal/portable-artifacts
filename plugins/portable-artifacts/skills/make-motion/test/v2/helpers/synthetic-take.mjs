// A tiny take folder written to an OS temp folder, for the take reader's tests (no browser, no make-demo): 12 frames of
// solid-colour 320x320 PNGs (the smallest viewport the reader accepts, scale 1), three steps, four distinct pictures.
// `edit(take)` changes the take.json object before it is written; `frames` overrides the PNG bytes by frame name.
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { encodePng } from '../../../scripts/lib/png-write.mjs';

export const SIDE = 320;
const COLOURS = [[200, 30, 30], [30, 200, 30], [30, 30, 200], [200, 200, 30]];

/** A new empty folder to act as the film's folder; returns its real path. Tests remove it in an `after` hook. */
export const makeFilmDir = (prefix = 'take-test-') => realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));

/** The PNG of one solid colour, `side` by `side` pixels. */
export function solidPng(colour = COLOURS[0], width = SIDE, height = SIDE) {
  const data = Buffer.alloc(width * height * 3);
  for (let i = 0; i < data.length; i += 3) data.set(colour, i);
  return encodePng({ width, height, channels: 3, data });
}

/** The head of a JPEG: SOI, a 20-byte APP0, a baseline SOF0 saying `width` by `height`, EOI. Not decodable, readable by a header reader. */
export function minimalJpeg(width = SIDE, height = SIDE) {
  const sof = Buffer.alloc(19);
  sof.set([0xff, 0xc0, 0x00, 0x11, 0x08]);
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof.set([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 9);
  const app0 = Buffer.alloc(18);
  app0.set([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}

/** The 16-hex name of distinct picture k. */
export const frameName = (k, ext = 'png') => `${k.toString(16).padStart(16, '0')}.${ext}`;

/** The take.json of the synthetic take as an object, and the PNG of each distinct name. */
export function takeOf() {
  const names = Array.from({ length: 12 }, (_, f) => frameName(Math.floor(f / 3)));
  const pngs = new Map([0, 1, 2, 3].map((k) => [frameName(k), solidPng(COLOURS[k])]));
  const take = {
    version: 1, planKey: 'demo-synthetic', startedAt: '1970-01-01T00:00:00.000Z',
    viewport: { width: SIDE, height: SIDE }, scale: 1, fps: 30, mode: 'stepped', signedIn: false, frames: names,
    steps: [
      { id: 'open', do: 'goto', startFrame: 0, actFrame: 0, settleFrame: 3, settledIndex: 2, pointer: { x: 0, y: 0 }, box: null, textPx: null },
      { id: 'tab', do: 'click', startFrame: 3, actFrame: 5, settleFrame: 8, settledIndex: 7, pointer: { x: 100, y: 120 }, box: { x: 80, y: 100, width: 60, height: 40 }, textPx: 14 },
      { id: 'search', do: 'type', startFrame: 8, actFrame: 9, settleFrame: 12, settledIndex: 11, pointer: { x: 150, y: 200 }, box: { x: 20, y: 180, width: 280, height: 34 }, textPx: 13.5 },
    ],
  };
  return { take, pngs };
}

/**
 * Writes the synthetic take into `<specDir>/<dir>/` (take.json and frames/) and returns { takeDir, framesDir, take }.
 * `edit(take, pngs)` may change both before they are written.
 */
export function writeSyntheticTake(specDir, { dir = 'take', edit } = {}) {
  const { take, pngs } = takeOf();
  edit?.(take, pngs);
  const takeDir = path.join(specDir, dir);
  const framesDir = path.join(takeDir, 'frames');
  mkdirSync(framesDir, { recursive: true });
  writeFileSync(path.join(takeDir, 'take.json'), JSON.stringify(take));
  for (const [name, bytes] of pngs) writeFileSync(path.join(framesDir, name), bytes);
  return { takeDir, framesDir, take };
}
