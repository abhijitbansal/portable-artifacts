// The frame files of a take folder (scripts/v2/take.mjs check 5). Each distinct frame name is looked at once: it must
// resolve, through its links, to a regular file inside the take's frames/ folder (fileInside, the server's own rule), be
// at most MAX_FRAME_BYTES, start with the bytes of its extension, and say in its header (JPEG SOF, PNG IHDR) the size
// the take claims. The distinct files together may weigh MAX_TAKE_BYTES. Only a header is read; the picture is never
// decoded here. Node only.
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileInside } from './server.mjs';
import { quote } from './spec-common.mjs';

export const MAX_FRAME_BYTES = 16 * 1024 * 1024;
export const MAX_TAKE_BYTES = 3 * 1024 ** 3;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_HEADER_BYTES = 24; // signature 8, IHDR length 4 + type 4, width 4, height 4
const MAX_JPEG_MARKERS = 1000; // segments looked through for the SOF
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0); // a link put in the file's place after it was found is refused

function readAt(fd, length, position) {
  const buffer = Buffer.alloc(length);
  const got = readSync(fd, buffer, 0, length, position);
  return buffer.subarray(0, got);
}

// { width, height } from a PNG's IHDR (the first chunk), or null.
function pngSize(fd) {
  const head = readAt(fd, PNG_HEADER_BYTES, 0);
  if (head.length < PNG_HEADER_BYTES || head.readUInt32BE(8) !== 13 || head.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

// A start-of-frame marker: C0 to CF except C4 (huffman table), C8 (reserved) and CC (arithmetic conditioning).
const isSof = (marker) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
const isStandalone = (marker) => marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);

// { width, height } from the first SOF segment of a JPEG, hopping from segment to segment by their lengths; null when
// the file ends, breaks its framing, or reaches the scan before any SOF.
function jpegSize(fd, fileSize) {
  let at = 2;
  for (let n = 0; n < MAX_JPEG_MARKERS && at + 4 <= fileSize; n++) {
    const head = readAt(fd, 9, at);
    if (head.length < 4 || head[0] !== 0xff) return null;
    const marker = head[1];
    if (marker === 0xff) { at += 1; continue; } // a fill byte
    if (isStandalone(marker)) { at += 2; continue; }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = head.readUInt16BE(2);
    if (length < 2) return null;
    if (isSof(marker)) return length >= 8 && head.length >= 9 ? { height: head.readUInt16BE(5), width: head.readUInt16BE(7) } : null;
    at += 2 + length;
  }
  return null;
}

// The file's header size, after its first bytes were checked against its extension; fails with `label` otherwise.
function headerSize(fd, size, ext, label, f) {
  const [signature, kind] = ext === 'png' ? [PNG_SIGNATURE, 'PNG'] : [JPEG_SIGNATURE, 'JPEG'];
  if (!readAt(fd, signature.length, 0).equals(signature)) f(`${label}: its first bytes are not a ${kind}'s, which its .${ext} name says it is`);
  const dims = ext === 'png' ? pngSize(fd) : jpegSize(fd, size);
  if (dims === null) f(`${label}: its ${kind} header has no size header that can be read`);
  return dims;
}

// The open file's size and header size checks. `claim`: { width, height, viewport, scale }.
function checkFile(file, ext, label, claim, f) {
  const fd = openSync(file, OPEN_FLAGS);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) f(`${label} is not a regular file`);
    if (stat.size > MAX_FRAME_BYTES) f(`${label} is ${stat.size} bytes; at most ${MAX_FRAME_BYTES}`);
    const dims = headerSize(fd, stat.size, ext, label, f);
    if (dims.width !== claim.width || dims.height !== claim.height) {
      f(`${label} is ${dims.width}x${dims.height}; this take's frames are ${claim.width}x${claim.height} (viewport ${claim.viewport.width}x${claim.viewport.height} at scale ${claim.scale})`);
    }
    return stat.size;
  } finally {
    closeSync(fd);
  }
}

// A filesystem failure a take can cause (a link loop, no permission) is the take's to fix, said with its code only.
function guarded(label, f, fn) {
  try {
    return fn();
  } catch (err) {
    if (typeof err?.code !== 'string') throw err;
    return f(`${label} cannot be read (${err.code})`);
  }
}

/**
 * Checks every distinct frame of `names` in `framesDir` (a real path). `f(message)` throws the take's refusal.
 * @param {string} framesDir @param {string[]} names @param {{ width: number, height: number, viewport: object, scale: number }} claim
 */
export function checkFrameFiles(framesDir, names, claim, f) {
  const seen = new Set();
  let total = 0;
  names.forEach((name, i) => {
    if (seen.has(name)) return;
    seen.add(name);
    const label = `frames[${i}] ${quote(name)}`;
    const file = guarded(label, f, () => fileInside(framesDir, path.join(framesDir, name)));
    if (file === null) f(`${label} is not a file inside the take's frames/ folder`);
    total += guarded(label, f, () => checkFile(file, name.slice(-3), label, claim, f));
    if (total > MAX_TAKE_BYTES) f(`${label}: the distinct frames together weigh over 3 GiB`);
  });
}
