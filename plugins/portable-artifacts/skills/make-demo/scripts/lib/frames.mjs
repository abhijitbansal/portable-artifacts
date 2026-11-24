// Frame store: each distinct picture is one file named by its hash, so a still screen costs nothing after the first frame.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const NAME_HEX_CHARS = 16;

/**
 * A folder of frames. `add(buffer)` stores the buffer once per distinct content and returns the frame's place in film order.
 * `index()` is the file of every added frame in order; `bytes()` is what the distinct files weigh on disk.
 */
export function frameStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const order = [];
  const sizes = new Map();
  return {
    add(buffer) {
      const file = `${createHash('sha256').update(buffer).digest('hex').slice(0, NAME_HEX_CHARS)}.jpg`;
      const repeated = sizes.has(file);
      if (!repeated) {
        fs.writeFileSync(path.join(dir, file), buffer);
        sizes.set(file, buffer.length);
      }
      order.push(file);
      return { index: order.length - 1, file, repeated };
    },
    index: () => [...order],
    bytes: () => [...sizes.values()].reduce((sum, n) => sum + n, 0),
  };
}
