// Frame store: each distinct picture is one file named by its hash, so a still screen costs nothing after the first frame.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const NAME_HEX_CHARS = 16;

/** Write `buffer` to `file`, or keep the file already there when it holds exactly these bytes; a file with the name and other bytes is an error. */
function keep(file, buffer) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, buffer);
    return;
  }
  if (!fs.readFileSync(file).equals(buffer)) throw new Error(`${path.basename(file)} exists and is not the same bytes: a name clash, or a folder that holds something else`);
}

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
        keep(path.join(dir, file), buffer);
        sizes.set(file, buffer.length);
      }
      order.push(file);
      return { index: order.length - 1, file, repeated };
    },
    index: () => [...order],
    bytes: () => [...sizes.values()].reduce((sum, n) => sum + n, 0),
  };
}
