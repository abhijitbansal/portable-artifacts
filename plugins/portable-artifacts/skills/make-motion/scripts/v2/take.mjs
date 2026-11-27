// The take reader: a take folder (make-demo's take.json and frames/) is untrusted input to make-motion, so every rule the
// `walk` shot depends on is checked here, in Node, before the page opens or a frame is served. A take that breaks a rule
// is refused with a SpecError at the shot's `src` whose message names the take field that broke it (and repeats at most
// a short, escaped piece of what the take said). Nothing is clamped or repaired. The frame files are checked in
// take-frames.mjs. Paths stay in Node: `Take` carries `dir` and `framesDir`, the preparer drops them.
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileInside, MISSING_CODES } from './inside.mjs';
import { SpecError, isPlainObject, quote } from './spec-common.mjs';
import { checkFrameFiles } from './take-frames.mjs';

export const TAKE_JSON_MAX = 8 * 1024 * 1024;
export const MAX_FRAMES = 6000;
export const MAX_STEPS = 200;
const FPS = 30;
const SCALE_MAX = 3;
const VIEWPORT_WIDTH = [320, 1920];
const VIEWPORT_HEIGHT = [320, 1200];
const TEXT_PX = [1, 200];
const BOX_SIDE_MAX = 16384; // px of one side of a step's box: a long list may be taller than the viewport
const FRAME_NAME = /^[0-9a-f]{16}\.(?:jpg|png)$/;
const STEP_ID = /^[a-z][a-z0-9-]{0,39}$/;
const STEP_DO_MAX = 20;
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

const intIn = (v, [lo, hi]) => Number.isInteger(v) && v >= lo && v <= hi;
const numIn = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const range = ([lo, hi]) => `from ${lo} to ${hi}`;

// The real path of `target`, or null when it is missing; other filesystem errors the take can cause are its to fix.
function realOrNull(target, f, label) {
  try {
    return realpathSync(target);
  } catch (err) {
    if (MISSING_CODES.has(err.code)) return null;
    if (typeof err.code !== 'string') throw err;
    return f(`${label} cannot be read (${err.code})`);
  }
}

// Check 1: the take folder, a real folder inside the film's folder.
function takeFolder(specDir, src, f) {
  if (typeof src !== 'string' || src === '') f('src must be a non-empty path to the take folder');
  if (src.includes('\0')) f('src must not hold a NUL byte');
  if (path.isAbsolute(src)) f(`src ${quote(src)} must be relative to the film's folder`);
  const root = realpathSync(specDir);
  const dir = realOrNull(path.resolve(root, src), f, 'src');
  const notFolder = `src ${quote(src)} is not a folder inside the film's folder`;
  if (dir === null || !dir.startsWith(root + path.sep) || !statSync(dir).isDirectory()) f(notFolder);
  return dir;
}

// take.json as text, by its size first: opened without following a link, sized by the open file, read for exactly that many bytes.
function takeJsonText(dir, f) {
  const file = fileInside(dir, path.join(dir, 'take.json'));
  if (file === null) f('take.json is not a file inside the take folder');
  const fd = openSync(file, OPEN_FLAGS);
  try {
    const { size } = fstatSync(fd);
    if (size > TAKE_JSON_MAX) f(`take.json is ${size} bytes; at most ${TAKE_JSON_MAX}`);
    const bytes = Buffer.alloc(size);
    readSync(fd, bytes, 0, size, 0);
    return bytes.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function parseTake(text, f) {
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    return f('take.json is not valid JSON');
  }
  if (!isPlainObject(root)) f('take.json must be an object');
  return root;
}

// Check 2: version, fps, mode, scale, viewport, signedIn. Any other root key is ignored.
function checkRoot(root, f) {
  if (root.version !== 1) f('take.json version must be 1');
  if (root.fps !== FPS) f(`take.json fps must be ${FPS}`);
  if (root.mode !== 'stepped') f('take.json mode must be "stepped"');
  if (!intIn(root.scale, [1, SCALE_MAX])) f(`take.json scale must be a whole number from 1 to ${SCALE_MAX}`);
  if (!isPlainObject(root.viewport)) f('take.json viewport must be an object with width and height');
  if (!intIn(root.viewport.width, VIEWPORT_WIDTH)) f(`take.json viewport.width must be a whole number ${range(VIEWPORT_WIDTH)}`);
  if (!intIn(root.viewport.height, VIEWPORT_HEIGHT)) f(`take.json viewport.height must be a whole number ${range(VIEWPORT_HEIGHT)}`);
  if (typeof root.signedIn !== 'boolean') f('take.json signedIn must be true or false');
  return { viewport: { width: root.viewport.width, height: root.viewport.height }, scale: root.scale, signedIn: root.signedIn };
}

// Check 3, frames: 1 to MAX_FRAMES names of the form <16 hex>.jpg|png.
function checkNames(frames, f) {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > MAX_FRAMES) {
    f(`take.json frames must list 1 to ${MAX_FRAMES} names${Array.isArray(frames) ? `; this lists ${frames.length}` : ''}`);
  }
  frames.forEach((name, i) => {
    if (typeof name !== 'string' || !FRAME_NAME.test(name)) f(`take.json frames[${i}] ${quote(name)} is not a frame name: 16 lowercase hex digits and .jpg or .png`);
  });
  return frames.slice();
}

// Check 3, steps: 1 to MAX_STEPS entries, each with a unique id.
function checkStepList(steps, f) {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > MAX_STEPS) {
    f(`take.json steps must list 1 to ${MAX_STEPS} steps${Array.isArray(steps) ? `; this lists ${steps.length}` : ''}`);
  }
  const ids = new Map();
  steps.forEach((step, i) => {
    if (!isPlainObject(step)) f(`take.json steps[${i}] must be an object`);
    if (typeof step.id !== 'string' || !STEP_ID.test(step.id)) f(`take.json steps[${i}].id ${quote(step.id)} must be a lowercase name (a to z, 0 to 9 and "-", up to 40 characters)`);
    if (ids.has(step.id)) f(`take.json steps[${i}].id ${quote(step.id)} is already the id of steps[${ids.get(step.id)}]`);
    ids.set(step.id, i);
  });
  return steps;
}

// A step's frame numbers (startFrame and actFrame in 0..count, settleFrame in 1..count, in that order), refused not clamped.
function checkFrameNumbers(step, at, count, f) {
  const [start, act, settle] = [step.startFrame, step.actFrame, step.settleFrame];
  const rule = (field, lo) => `${at}.${field} must be a whole number from ${lo} to ${count} (this take has ${count} frames)`;
  if (!intIn(start, [0, count])) f(rule('startFrame', 0));
  if (!intIn(act, [0, count])) f(rule('actFrame', 0));
  if (!intIn(settle, [1, count])) f(rule('settleFrame', 1));
  if (settle < start) f(`${at}.settleFrame (${settle}) is before its startFrame (${start})`);
  if (act < start) f(`${at}.actFrame (${act}) is before its startFrame (${start})`);
  if (act > settle) f(`${at}.actFrame (${act}) is after its settleFrame (${settle})`);
}

// settledIndex is settleFrame - 1, or in range and at or after actFrame - 1 (the take's own rule).
function checkSettled(step, at, count, f) {
  const first = Math.max(step.actFrame - 1, 0);
  const ok = step.settledIndex === step.settleFrame - 1 || (intIn(step.settledIndex, [0, count - 1]) && step.settledIndex >= first);
  if (!ok) f(`${at}.settledIndex ${quote(step.settledIndex)} must be settleFrame - 1 (${step.settleFrame - 1}) or a frame index from ${first} to ${count - 1}`);
}

// A pointer: null, or { x, y } within the viewport grown by its own size on every side.
function readPointer(value, at, viewport, f) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) f(`${at}.pointer must be null or { x, y }`);
  if (!numIn(value.x, -viewport.width, 2 * viewport.width)) f(`${at}.pointer.x must be a number from ${-viewport.width} to ${2 * viewport.width}`);
  if (!numIn(value.y, -viewport.height, 2 * viewport.height)) f(`${at}.pointer.y must be a number from ${-viewport.height} to ${2 * viewport.height}`);
  return { x: value.x, y: value.y };
}

// A box: null, or { x, y, width, height } whose edges reach into the viewport grown by the box's own size.
function readBox(value, at, viewport, f) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) f(`${at}.box must be null or { x, y, width, height }`);
  if (!numIn(value.width, 0, BOX_SIDE_MAX)) f(`${at}.box.width must be a number from 0 to ${BOX_SIDE_MAX}`);
  if (!numIn(value.height, 0, BOX_SIDE_MAX)) f(`${at}.box.height must be a number from 0 to ${BOX_SIDE_MAX}`);
  if (!numIn(value.x, -value.width, viewport.width)) f(`${at}.box.x must be a number from ${-value.width} to ${viewport.width}`);
  if (!numIn(value.y, -value.height, viewport.height)) f(`${at}.box.y must be a number from ${-value.height} to ${viewport.height}`);
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

// Check 4: one step. `previous`: the step before, as read. Indexes are 0-based into the frame names (frame f is names[f - 1];
// a take's first step starts at frame 0, before any frame is stored).
function readStep(step, i, previous, { count, viewport }, f) {
  const at = `take.json steps[${i}]`;
  if (typeof step.do !== 'string' || step.do === '' || step.do.length > STEP_DO_MAX) f(`${at}.do must be a short string`);
  checkFrameNumbers(step, at, count, f);
  checkSettled(step, at, count, f);
  const startIndex = Math.max(step.startFrame - 1, 0);
  if (previous && startIndex < previous.settledIndex) f(`${at}.startFrame (${step.startFrame}) is before steps[${i - 1}] settles (its settledIndex is ${previous.settledIndex})`);
  const textPx = step.textPx ?? null;
  if (textPx !== null && !numIn(textPx, ...TEXT_PX)) f(`${at}.textPx must be null or a number from ${TEXT_PX[0]} to ${TEXT_PX[1]}`);
  return {
    id: step.id, do: step.do, startIndex, actIndex: Math.max(step.actFrame - 1, 0), settledIndex: step.settledIndex,
    pointer: readPointer(step.pointer, at, viewport, f), box: readBox(step.box, at, viewport, f), textPx,
  };
}

// Check 5's folder: frames/ resolves to a folder inside the take folder.
function framesFolder(dir, f) {
  const framesDir = realOrNull(path.join(dir, 'frames'), f, 'frames/');
  if (framesDir === null || !framesDir.startsWith(dir + path.sep) || !statSync(framesDir).isDirectory()) f('frames/ is not a folder inside the take folder');
  return framesDir;
}

/**
 * Reads the take folder `src` names, inside `specDir`, and checks every rule of the walk shot's input.
 * @param {string} specDir the film's folder @param {string} src the shot's `src` @param {{ owner: string }} options owner: `shots[<i>]`
 * @returns {{ src: string, dir: string, framesDir: string, names: string[], fps: 30, viewport: { width: number, height: number },
 *   scale: number, width: number, height: number, signedIn: boolean, steps: object[] }}
 * @throws {SpecError} at `<owner>.src`, naming the take field that broke
 */
export function readTake(specDir, src, { owner = 'shot' } = {}) {
  const f = (message) => { throw new SpecError([{ path: `${owner}.src`, message }]); };
  const dir = takeFolder(specDir, src, f);
  const root = parseTake(takeJsonText(dir, f), f);
  const { viewport, scale, signedIn } = checkRoot(root, f);
  const names = checkNames(root.frames, f);
  const rawSteps = checkStepList(root.steps, f);
  const steps = [];
  rawSteps.forEach((step, i) => steps.push(readStep(step, i, steps[i - 1], { count: names.length, viewport }, f)));
  const framesDir = framesFolder(dir, f);
  const [width, height] = [viewport.width * scale, viewport.height * scale];
  checkFrameFiles(framesDir, names, { width, height, viewport, scale }, f);
  return { src, dir, framesDir, names, fps: FPS, viewport, scale, width, height, signedIn, steps };
}
