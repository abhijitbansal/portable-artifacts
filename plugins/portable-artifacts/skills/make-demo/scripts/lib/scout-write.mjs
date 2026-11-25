// What scout writes, and only once the walk is over: the pictures of this scout (older p*.jpg go), then scout.json last, through a
// temp file and a rename, so a scout that stops early leaves what was there before exactly as it was.
import fs from 'node:fs';
import path from 'node:path';

const OLD_SHOT = /^p\d+\.jpg$/;

/** Write scout/ beside demo.json (`dir`). `shots` maps a page id to a JPEG buffer. Returns the path of scout.json. */
export function writeScout(dir, scout, shots) {
  const folder = path.join(dir, 'scout');
  fs.mkdirSync(folder, { recursive: true });
  for (const name of fs.readdirSync(folder)) if (OLD_SHOT.test(name)) fs.rmSync(path.join(folder, name));
  for (const [id, picture] of shots) fs.writeFileSync(path.join(folder, `${id}.jpg`), picture);
  const file = path.join(folder, 'scout.json');
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(scout, null, 2)}\n`);
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
  return file;
}
