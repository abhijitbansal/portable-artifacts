// A minimal PNG writer for the helper pictures (locate.mjs): 8-bit RGB or RGBA, no filter, not interlaced. Node's zlib
// deflates; the CRC-32 is a table here because `zlib.crc32` is newer than Node 20.0, which package.json `engines` allows.
import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COLOUR_TYPE = Object.freeze({ 3: 2, 4: 6 }); // channels -> PNG colour type: RGB, RGBA
const CRC_POLYNOMIAL = 0xedb88320;
const BYTE_VALUES = 256;
const CRC_BITS = 8;

const CRC_TABLE = Uint32Array.from({ length: BYTE_VALUES }, (_, n) => {
  let c = n;
  for (let bit = 0; bit < CRC_BITS; bit++) c = c & 1 ? CRC_POLYNOMIAL ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> CRC_BITS);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** The PNG file of `{ width, height, channels: 3 | 4, data }` (data: width * height * channels bytes, row by row). */
export function encodePng({ width, height, channels, data }) {
  const colour = COLOUR_TYPE[channels];
  if (colour === undefined) throw new Error(`png: channels must be 3 or 4, got ${channels}`);
  if (data.length !== width * height * channels) throw new Error(`png: ${data.length} bytes for ${width}x${height}x${channels}`);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = colour;
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1)); // each row: filter byte 0 (none), then its pixels
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
