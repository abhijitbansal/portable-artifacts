// saveDownload with a stand-in for a Playwright Download, so the name the site suggests can be anything (Chromium cleans most of it before
// a real Download reports it). No browser, no network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveDownload } from '../scripts/lib/take-run.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-take-download-'));
after(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const MB = 1024 * 1024;
const row = { id: 'odd' };
/** A Download whose file has `size` bytes (sparse). */
const fake = (suggested, { size = 3, fail = false } = {}) => ({
  suggestedFilename: () => suggested,
  async saveAs(target) {
    if (fail) throw new Error('disk full');
    fs.writeFileSync(target, '');
    fs.truncateSync(target, size);
  },
});
const inside = () => fs.readdirSync(dir).sort();

test('a hostile suggested name is stored under a name of our own and listed only through agentText', async () => {
  const hostile = `../../x\ny‮end${'a'.repeat(300)}`;
  const entry = await saveDownload({ dir, signedIn: false }, row, fake(hostile), 1);
  assert.equal(entry.file, 'downloads/odd-1', 'no extension: the name does not end in .xxx');
  assert.ok(fs.existsSync(path.join(dir, entry.file)));
  assert.deepEqual(inside(), ['downloads'], 'nothing outside downloads/');
  assert.ok(!/[\u0000-\u001f‮]/.test(entry.name), 'no raw control or bidi character');
  assert.ok(entry.name.includes('\\u{000a}') && entry.name.includes('\\u{202e}'), entry.name);
  assert.match(entry.name, /\[\d+ more characters\]$/, 'cut');
  assert.equal(entry.bytes, 3);
});

test('the extension is the last .xxx of 1 to 8 letters or digits, and nothing else', async () => {
  const ext = async (name) => (await saveDownload({ dir, signedIn: false }, { id: 'e' }, fake(name), 1)).file;
  assert.equal(await ext('report.final.PDF'), 'downloads/e-1.PDF');
  assert.equal(await ext('a.tar.gz'), 'downloads/e-1.gz');
  assert.equal(await ext('archive.123456789'), 'downloads/e-1', 'nine characters: no extension');
  assert.equal(await ext('x.t/xt'), 'downloads/e-1', 'a slash is not an extension');
  assert.equal(await ext('x.tx\nt'), 'downloads/e-1', 'a newline is not an extension');
  assert.equal(await ext('noext'), 'downloads/e-1');
});

test('signed in, the suggested name is masked before it is listed', async () => {
  const entry = await saveDownload({ dir, signedIn: true }, { id: 's' }, fake('invoice for maria.ostrowski@example.test.txt'), 1);
  assert.ok(!entry.name.includes('maria'), entry.name);
  assert.ok(entry.name.includes('<email>'), entry.name);
});

test('a file over 100 MB is deleted and listed too large; exactly 100 MB is kept', async () => {
  const big = await saveDownload({ dir, signedIn: false }, { id: 'big' }, fake('big.bin', { size: 100 * MB + 1 }), 1);
  assert.deepEqual(big, { row: 'big', file: null, bytes: 100 * MB + 1, name: 'big.bin', skipped: 'too large' });
  assert.ok(!fs.existsSync(path.join(dir, 'downloads', 'big-1.bin')));
  const edge = await saveDownload({ dir, signedIn: false }, { id: 'edge' }, fake('edge.bin', { size: 100 * MB }), 1);
  assert.equal(edge.file, 'downloads/edge-1.bin');
  assert.equal(edge.skipped, undefined);
});

test('a download that cannot be saved is listed, not thrown', async () => {
  const entry = await saveDownload({ dir, signedIn: false }, { id: 'bad' }, fake('x.txt', { fail: true }), 1);
  assert.deepEqual(entry, { row: 'bad', file: null, bytes: 0, name: 'x.txt', skipped: 'could not be saved' });
});
