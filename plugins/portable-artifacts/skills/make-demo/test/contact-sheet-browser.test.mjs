// contactSheet: the settled frame of each step in a grid of three 640 px columns, one JPEG under 1.4 MB, drawn in a page that can reach
// nothing. Frames are made here by a real browser (3x pages, and noise to make the JPEG quality loop work). One browser for the file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser, liveBrowsers } from '../scripts/lib/browser.mjs';
import { contactSheet } from '../scripts/lib/contact-sheet.mjs';

const JPEG_LIMIT = 1.4 * 1024 * 1024;
const MAX_PAGE_PIXELS = 16384;
const COLUMN = 640;
const T = { timeout: 180000 };

let browser;
let blank;
let context;
let beacon;
let beaconHits = 0;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-contact-'));
let folders = 0;

before(async () => {
  assert.deepEqual(liveBrowsers(), [], 'another headless browser is running: wait for it, never run two');
  beacon = http.createServer((req, res) => { beaconHits += 1; res.end('x'); });
  await new Promise((resolve) => beacon.listen(0, '127.0.0.1', resolve));
  browser = await launchBrowser();
  context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 3 });
  blank = await context.newPage();
});
after(async () => {
  await context?.close();
  await browser?.close();
  await new Promise((resolve) => beacon?.close(resolve));
  fs.rmSync(work, { recursive: true, force: true });
});

const jpegSize = (buf) => {
  for (let i = 2; i + 9 < buf.length; ) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
};

/** A take folder holding `names` as frames; `page(i)` is the body of frame i's page. Returns { dir, files }. */
async function framesOf(count, body) {
  const dir = path.join(work, `take-${(folders += 1)}`);
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true });
  const files = [];
  for (let i = 0; i < count; i += 1) {
    await blank.setContent(body(i));
    const picture = await blank.screenshot({ type: 'jpeg', quality: 90 });
    const file = `frame${i}.jpg`;
    fs.writeFileSync(path.join(dir, 'frames', file), picture);
    files.push(file);
  }
  return { dir, files };
}

const plain = (i) => `<body style="margin:0;background:hsl(${i * 70} 60% 70%)"><h1 style="font:700 80px sans-serif">Frame ${i}</h1>`;
// Random 4 px blocks: still noisy after the sheet scales a 3x frame down to a 640 px thumbnail, so the JPEG quality loop has work to do.
const noise = (i) => `<body style="margin:0"><canvas id=c width=1280 height=720></canvas><script>
  const c = document.getElementById('c').getContext('2d'); let s = (${i} + 1) * 2654435761 >>> 0;
  for (let y = 0; y < 720; y += 4) for (let x = 0; x < 1280; x += 4) { s = (s * 1664525 + 1013904223) >>> 0; c.fillStyle = 'rgb(' + (s >>> 24) + ',' + ((s >>> 16) & 255) + ',' + ((s >>> 8) & 255) + ')'; c.fillRect(x, y, 4, 4); }</script>`;

const takeOf = (files, steps) => ({ frames: files, steps });
const stepAt = (id, settledIndex, extra = {}) => ({ id, settledIndex, ...extra });

test('three 3x frames: contact.jpg is a JPEG at least three 640 px columns wide, under 1.4 MB', T, async () => {
  const { dir, files } = await framesOf(3, plain);
  assert.equal(jpegSize(fs.readFileSync(path.join(dir, 'frames', files[0]))).width, 3840, 'control: the frames are 3840 px wide');
  const take = takeOf(files, [stepAt('a', 0), stepAt('b', 1), stepAt('c', 2)]);
  const file = await contactSheet(browser, take, dir);
  assert.equal(file, path.join(dir, 'contact.jpg'));
  const sheet = fs.readFileSync(file);
  assert.deepEqual([...sheet.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  assert.ok(sheet.length < JPEG_LIMIT);
  const { width, height } = jpegSize(sheet);
  assert.ok(width >= 3 * COLUMN && width < 3840, `width ${width}: thumbnails, not the frames`);
  assert.ok(height >= 360, `height ${height}: one row at least`);
});

test('fifty-five noisy frames: the JPEG quality is lowered until the sheet is under 1.4 MB', T, async () => {
  const { dir, files } = await framesOf(3, noise);
  const steps = Array.from({ length: 55 }, (_, i) => stepAt(`s${i}`, i % 3));
  const file = await contactSheet(browser, takeOf(files, steps), dir);
  const sheet = fs.readFileSync(file);
  assert.ok(sheet.length < JPEG_LIMIT, `${sheet.length} bytes`);
  assert.ok(sheet.length > 300 * 1024, `${sheet.length} bytes: the sheet is not blank`);
  assert.ok(jpegSize(sheet).height > 17 * 360, '19 rows of 360 px thumbnails');
});

test('more steps than a sheet can hold: the sheet stays a valid picture under the browser limit (its last cell names how many are left out)', T, async () => {
  const { dir, files } = await framesOf(2, plain);
  const steps = Array.from({ length: 90 }, (_, i) => stepAt(`s${i}`, i % 2));
  const file = await contactSheet(browser, takeOf(files, steps), dir);
  const sheet = fs.readFileSync(file);
  assert.ok(sheet.length < JPEG_LIMIT);
  assert.ok(jpegSize(sheet).height < MAX_PAGE_PIXELS);
});

test('a take with no finished step still gets a sheet', T, async () => {
  const dir = path.join(work, 'empty');
  fs.mkdirSync(dir);
  const file = await contactSheet(browser, takeOf([], []), dir);
  const sheet = fs.readFileSync(file);
  assert.deepEqual([...sheet.subarray(0, 3)], [0xff, 0xd8, 0xff]);
});

test('a step id that is markup is text under its picture, and the drawing page reaches nothing', T, async () => {
  const { dir, files } = await framesOf(1, plain);
  beaconHits = 0;
  const evil = `<img src="http://127.0.0.1:${beacon.address().port}/leak"><script>fetch("http://127.0.0.1:${beacon.address().port}/leak")</script>`;
  await contactSheet(browser, takeOf(files, [stepAt(evil, 0)]), dir);
  assert.equal(beaconHits, 0, 'the drawing page sent no request');
});

test('a step with no settledIndex falls back to the frame before its settleFrame', T, async () => {
  const { dir, files } = await framesOf(2, plain);
  const file = await contactSheet(browser, takeOf(files, [{ id: 'x', settleFrame: 2 }]), dir);
  assert.ok(fs.existsSync(file));
});

test('a frame file that is missing is an error, not a blank cell', T, async () => {
  const { dir } = await framesOf(1, plain);
  await assert.rejects(contactSheet(browser, takeOf(['gone.jpg'], [stepAt('a', 0)]), dir), /gone\.jpg/);
});
