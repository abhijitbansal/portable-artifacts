// A query that does not fit in memory spills to DuckDB's temp_directory, which is `.tmp` under the working folder unless set:
// a repository that ships `.tmp -> <elsewhere>` would have the spill files made there. The folder is private, outside the
// repository, and gone when the database is closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, openLockedDb } from '../scripts/lib/sql.mjs';

const setting = async (db) => (await db.conn.runAndReadAll("SELECT current_setting('temp_directory') AS d")).getRowObjectsJS()[0].d;
const underTmp = (dir) => path.dirname(fs.realpathSync(dir)) === fs.realpathSync(os.tmpdir());

test('openDb: temp_directory is a private folder in the system temp folder, removed at close', async () => {
  const db = await openDb();
  const dir = await setting(db);
  assert.ok(path.isAbsolute(dir), `temp_directory is ${dir}`);
  assert.ok(underTmp(dir), `${dir} is not directly under ${os.tmpdir()}`);
  assert.equal(fs.statSync(dir).mode & 0o077, 0, 'private to the user');
  db.close();
  assert.equal(fs.existsSync(dir), false, 'the folder is removed at close');
});

test('openLockedDb: the locked database spills to that folder too, and the setting cannot be changed after the lock', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-spill-')));
  try {
    const db = await openLockedDb({ sources: {} }, dir);
    const spill = await setting(db);
    assert.ok(underTmp(spill), `${spill} is not directly under ${os.tmpdir()}`);
    await assert.rejects(db.conn.run(`SET temp_directory='${path.join(dir, 'elsewhere')}'`));
    assert.equal(await setting(db), spill);
    db.close();
    assert.equal(fs.existsSync(spill), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a repository that links .tmp elsewhere: the working folder is not where the spill goes', async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-spill-')));
  const was = process.cwd();
  try {
    fs.mkdirSync(path.join(base, 'repo'));
    fs.mkdirSync(path.join(base, 'outside'));
    fs.symlinkSync(path.join(base, 'outside'), path.join(base, 'repo', '.tmp'));
    process.chdir(path.join(base, 'repo'));
    const db = await openDb();
    const spill = await setting(db);
    assert.ok(!spill.startsWith('.tmp') && !fs.realpathSync(spill).startsWith(path.join(base, 'outside')), spill);
    db.close();
  } finally {
    process.chdir(was);
    fs.rmSync(base, { recursive: true, force: true });
  }
});
