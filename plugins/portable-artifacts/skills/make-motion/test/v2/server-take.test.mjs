// A take folder's frames are served as a clip, by the names in its take.json (/clip/<k>/<n>), and the server looks again
// at every request: the file must still resolve to a regular file inside the take's frames/ folder. No path reaches
// /film.json. The `walk` kind is not registered yet, so the film's shots only need `show: 'walk'` and a `src`.
// Run with --test-concurrency=1.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startV2Server, fileInside as serverFileInside } from '../../scripts/v2/server.mjs';
import { fileInside, MISSING_CODES } from '../../scripts/v2/inside.mjs';
import { writeSyntheticTake, makeFilmDir, frameName } from './helpers/synthetic-take.mjs';

const dirs = [];
const newDir = () => {
  const dir = makeFilmDir('mm-take-serve-');
  dirs.push(dir);
  return dir;
};
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const walkFilm = (...srcs) => ({ version: 2, fps: 30, shots: srcs.map((src, i) => ({ id: `w${i}`, show: 'walk', src })) });
const start = (film, specDir, t) => startV2Server({ film, timeline: { shots: [] }, specDir }).then((s) => {
  t.after(() => s.close());
  return s;
});
const get = (s, route) => fetch(new URL(route, s.url));

test('fileInside moved to inside.mjs and server.mjs still exports it', () => {
  assert.equal(serverFileInside, fileInside);
  assert.deepEqual([...MISSING_CODES].sort(), ['ENOENT', 'ENOTDIR']);
});

test('/clip/0/n serves each named frame of a take, and n = count is 404', async (t) => {
  const dir = newDir();
  const { framesDir, take } = writeSyntheticTake(dir);
  const s = await start(walkFilm('take'), dir, t);
  for (const [n, name] of take.frames.entries()) {
    const res = await get(s, `/clip/0/${n}`);
    assert.equal(res.status, 200, `frame ${n}`);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), readFileSync(path.join(framesDir, name)), `frame ${n} is ${name}`);
  }
  assert.equal((await get(s, `/clip/0/${take.frames.length}`)).status, 404);
  assert.equal((await get(s, '/clip/1/0')).status, 404, 'no second clip');
});

test('/film.json lists the take as a clip with its size and no path', async (t) => {
  const dir = newDir();
  writeSyntheticTake(dir);
  const s = await start(walkFilm('take'), dir, t);
  const text = await (await get(s, '/film.json')).text();
  assert.deepEqual(JSON.parse(text).clips, [{ src: 'take', count: 12, width: 320, height: 320, from: 0, fps: 30 }]);
  assert.ok(!text.includes(dir), 'the film folder is not in /film.json');
  assert.ok(!text.includes('frames/'), 'no frames path');
  assert.ok(!text.includes(frameName(0)), 'no frame name');
});

test('two shots on the same take make one clip', async (t) => {
  const dir = newDir();
  writeSyntheticTake(dir);
  const s = await start(walkFilm('take', 'take'), dir, t);
  assert.equal(JSON.parse(await (await get(s, '/film.json')).text()).clips.length, 1);
});

test('take clips come after the video clips', async (t) => {
  const dir = newDir();
  writeSyntheticTake(dir);
  const frames = path.join(dir, 'clip-frames');
  mkdirSync(frames);
  writeFileSync(path.join(frames, 'f000001.png'), 'video-frame');
  const s = await startV2Server({
    film: walkFilm('take'), timeline: { shots: [] }, specDir: dir,
    clips: [{ src: 'v.mp4', dir: frames, count: 1, width: 4, height: 4, from: 0, fps: 30 }],
  });
  t.after(() => s.close());
  assert.deepEqual(JSON.parse(await (await get(s, '/film.json')).text()).clips.map((c) => c.src), ['v.mp4', 'take']);
  assert.equal(await (await get(s, '/clip/0/0')).text(), 'video-frame');
  assert.equal((await get(s, '/clip/1/0')).status, 200);
});

test('a frame swapped for a link to a file outside the take after start is 404, and nothing is read', async (t) => {
  const dir = newDir();
  const { framesDir, take } = writeSyntheticTake(dir);
  const outside = path.join(dir, 'secret.png');
  writeFileSync(outside, 'secret-bytes');
  const s = await start(walkFilm('take'), dir, t);
  const file = path.join(framesDir, take.frames[0]);
  unlinkSync(file);
  symlinkSync(outside, file);
  const res = await get(s, '/clip/0/0');
  assert.equal(res.status, 404);
  assert.ok(!(await res.text()).includes('secret'));
  assert.equal((await get(s, '/clip/0/3')).status, 200, 'an untouched frame still serves');
});

test('a take whose frames folder is deleted after start is 404, not 500', async (t) => {
  const dir = newDir();
  const { framesDir } = writeSyntheticTake(dir);
  const s = await start(walkFilm('take'), dir, t);
  rmSync(framesDir, { recursive: true });
  assert.equal((await get(s, '/clip/0/0')).status, 404);
});

test('a film with five takes is refused, four are served', async (t) => {
  const dir = newDir();
  const srcs = ['t0', 't1', 't2', 't3', 't4'];
  for (const src of srcs) writeSyntheticTake(dir, { dir: src });
  await assert.rejects(startV2Server({ film: walkFilm(...srcs), timeline: { shots: [] }, specDir: dir }), /at most 4 takes/);
  const s = await start(walkFilm(...srcs.slice(0, 4)), dir, t);
  assert.equal(JSON.parse(await (await get(s, '/film.json')).text()).clips.length, 4);
});

test('a take the reader refuses stops the server before it starts', async () => {
  const dir = newDir();
  writeSyntheticTake(dir, { edit: (take) => { take.version = 2; } });
  await assert.rejects(startV2Server({ film: walkFilm('take'), timeline: { shots: [] }, specDir: dir }), /version/);
});
