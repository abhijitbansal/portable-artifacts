import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileReplacing } from '../write-file.mjs';

const canLink = process.platform !== 'win32';
const isRoot = process.getuid?.() === 0;
const MODULE = fileURLToPath(new URL('../write-file.mjs', import.meta.url));
const CHILD_LIMIT_MS = 15000;
const tmp = (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-wf-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const names = (dir) => fs.readdirSync(dir).sort();
const modeOf = (file) => fs.statSync(file).mode & 0o7777;

// Run writeFileReplacing in its own process with a time limit: a regression that opens a pipe blocks forever, and a node:test
// timeout cannot interrupt a blocking synchronous open.
function writeInChild(target, data, options = {}) {
  const code = `import { writeFileReplacing } from ${JSON.stringify(MODULE)};
try { writeFileReplacing(process.argv[1], process.argv[2]); } catch (e) { process.stderr.write(String(e.message) + '\\n'); process.exitCode = 3; }`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', code, target, data], { encoding: 'utf8', timeout: CHILD_LIMIT_MS, ...options });
}

test('control: a plain writeFileSync follows a symlink at the target (the bug the helper exists to avoid)', { skip: !canLink }, (t) => {
  const dir = tmp(t);
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  fs.symlinkSync(victim, path.join(dir, 'page.html'));
  fs.writeFileSync(path.join(dir, 'page.html'), 'PAGE');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'PAGE');
});

test('writes a new file with the mode writeFileSync would give, and leaves no temp file', (t) => {
  const dir = tmp(t);
  const plain = path.join(dir, 'plain.txt');
  fs.writeFileSync(plain, 'x');
  writeFileReplacing(path.join(dir, 'new.html'), 'hello');
  assert.equal(fs.readFileSync(path.join(dir, 'new.html'), 'utf8'), 'hello');
  if (canLink) assert.equal(modeOf(path.join(dir, 'new.html')), modeOf(plain));
  assert.deepEqual(names(dir), ['new.html', 'plain.txt']);
});

test('accepts bytes as well as text', (t) => {
  const dir = tmp(t);
  writeFileReplacing(path.join(dir, 'a.png'), Buffer.from([1, 2, 3]));
  assert.deepEqual([...fs.readFileSync(path.join(dir, 'a.png'))], [1, 2, 3]);
});

test('a file name of 80 CJK characters (245 bytes) still writes: the temp name is short and fixed', (t) => {
  const dir = tmp(t);
  const target = path.join(dir, `${'日'.repeat(80)}.html`);
  writeFileReplacing(target, 'x');
  assert.equal(fs.readFileSync(target, 'utf8'), 'x');
  assert.equal(names(dir).length, 1);
});

// ---- the temp file: a short fixed shape, an unpredictable name, no wider than the final file --------------------------------

function spyRename(fn) {
  const seen = [];
  const real = fs.renameSync;
  fs.renameSync = (from, to) => { seen.push({ from, to, name: path.basename(from), mode: fs.statSync(from).mode & 0o7777 }); return real(from, to); };
  try {
    fn();
  } finally {
    fs.renameSync = real;
  }
  return seen;
}

test('the temp name is .pa-<16 hex>.tmp and differs between calls', (t) => {
  const dir = tmp(t);
  const seen = spyRename(() => { for (let i = 0; i < 5; i += 1) writeFileReplacing(path.join(dir, 'page.html'), String(i)); });
  assert.equal(new Set(seen.map((s) => s.name)).size, 5);
  for (const s of seen) assert.match(s.name, /^\.pa-[0-9a-f]{16}\.tmp$/);
});

test('a symlink planted at a guessable temp name is never written through', { skip: !canLink }, (t) => {
  const dir = tmp(t);
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  for (const guess of ['page.html.tmp', '.page.html.tmp', `page.html.${process.pid}.tmp`, `.pa-${process.pid}.tmp`, '.pa-0000000000000000.tmp']) fs.symlinkSync(victim, path.join(dir, guess));
  writeFileReplacing(path.join(dir, 'page.html'), 'PAGE');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'precious');
});

test('the temp of a 0600 target is created no wider than 0600, even with umask 0', { skip: !canLink }, (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'private.txt');
  fs.writeFileSync(file, 'old');
  fs.chmodSync(file, 0o600);
  const umask = process.umask(0);
  const atWrite = [];
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = (target, ...rest) => { if (typeof target === 'number') atWrite.push(fs.fstatSync(target).mode & 0o7777); return realWrite(target, ...rest); }; // the secret is written into the temp: how open is it then?
  let seen;
  try {
    seen = spyRename(() => writeFileReplacing(file, 'secret'));
  } finally {
    fs.writeFileSync = realWrite;
    process.umask(umask);
  }
  assert.deepEqual(atWrite.map((m) => m & 0o077), [0], `the temp held the secret with mode ${atWrite[0]?.toString(8)} while it was written`);
  assert.equal(seen[0].mode & 0o077, 0, `the temp held the secret with mode ${seen[0].mode.toString(8)} before the rename`);
  assert.equal(modeOf(file), 0o600);
});

test('a replaced file keeps its mode: executable, private, read-only group', { skip: !canLink }, (t) => {
  const dir = tmp(t);
  for (const mode of [0o755, 0o600, 0o640, 0o700]) {
    const file = path.join(dir, `f-${mode.toString(8)}`);
    fs.writeFileSync(file, 'old');
    fs.chmodSync(file, mode);
    writeFileReplacing(file, 'new');
    assert.equal(fs.readFileSync(file, 'utf8'), 'new');
    assert.equal(modeOf(file), mode, `mode ${mode.toString(8)}`);
  }
});

test('a replaced file keeps its group, when the caller may give it', { skip: !canLink || process.getgroups === undefined }, (t) => {
  const other = process.getgroups().find((g) => g !== process.getgid());
  if (other === undefined) return t.skip('this account has no second group');
  const dir = tmp(t);
  const file = path.join(dir, 'shared.txt');
  fs.writeFileSync(file, 'old');
  fs.chownSync(file, process.getuid(), other);
  fs.chmodSync(file, 0o660);
  writeFileReplacing(file, 'new');
  assert.equal(fs.statSync(file).gid, other);
  assert.equal(modeOf(file), 0o660);
});

test('when the group cannot be kept, the group bits are dropped rather than handed to another group', { skip: !canLink || process.getgroups === undefined }, (t) => {
  const other = process.getgroups().find((g) => g !== process.getgid());
  if (other === undefined) return t.skip('this account has no second group');
  const dir = tmp(t);
  const file = path.join(dir, 'shared.txt');
  fs.writeFileSync(file, 'old');
  fs.chownSync(file, process.getuid(), other);
  fs.chmodSync(file, 0o664);
  const real = fs.fchownSync;
  fs.fchownSync = () => { throw Object.assign(new Error('not permitted'), { code: 'EPERM' }); };
  try {
    writeFileReplacing(file, 'new');
  } finally {
    fs.fchownSync = real;
  }
  assert.equal(modeOf(file), 0o604);
});

test('a mount that refuses chmod does not fail the write', { skip: !canLink }, (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'f.txt');
  fs.writeFileSync(file, 'old');
  fs.chmodSync(file, 0o644);
  const real = fs.fchmodSync;
  fs.fchmodSync = () => { throw Object.assign(new Error('operation not supported'), { code: 'ENOTSUP' }); };
  try {
    writeFileReplacing(file, 'new');
  } finally {
    fs.fchmodSync = real;
  }
  assert.equal(fs.readFileSync(file, 'utf8'), 'new');
});

test('an existing file that is not writable is EACCES, as a plain write reports it, and keeps its content', { skip: !canLink || isRoot }, (t) => {
  const dir = tmp(t);
  const file = path.join(dir, 'ro.html');
  fs.writeFileSync(file, 'precious');
  fs.chmodSync(file, 0o444);
  assert.throws(() => fs.writeFileSync(file, 'x'), (e) => e.code === 'EACCES');
  assert.throws(() => writeFileReplacing(file, 'x'), (e) => e.code === 'EACCES');
  assert.equal(fs.readFileSync(file, 'utf8'), 'precious');
  assert.deepEqual(names(dir), ['ro.html'], 'no temp file left behind');
});

// ---- what is at the target ---------------------------------------------------------------------------------------------------

test('a symlink at the target is replaced by the page; its old target is untouched', { skip: !canLink }, (t) => {
  const dir = tmp(t);
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  const target = path.join(dir, 'page.html');
  fs.symlinkSync(victim, target);
  writeFileReplacing(target, 'PAGE');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'precious');
  assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'PAGE');
});

test('a symlink to a read-only file is replaced: the link is what is at the target, not the file behind it', { skip: !canLink }, (t) => {
  const dir = tmp(t);
  const victim = path.join(dir, 'victim.txt');
  fs.writeFileSync(victim, 'precious');
  fs.chmodSync(victim, 0o444);
  const target = path.join(dir, 'page.html');
  fs.symlinkSync(victim, target);
  writeFileReplacing(target, 'PAGE');
  assert.equal(fs.readFileSync(target, 'utf8'), 'PAGE');
  assert.equal(fs.readFileSync(victim, 'utf8'), 'precious');
});

test('a dangling symlink at the target is replaced and nothing is created where it pointed', { skip: !canLink }, (t) => {
  const dir = tmp(t);
  const nowhere = path.join(dir, 'nowhere.txt');
  const target = path.join(dir, 'page.html');
  fs.symlinkSync(nowhere, target);
  writeFileReplacing(target, 'PAGE');
  assert.equal(fs.existsSync(nowhere), false);
  assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
});

test('a symlink to a folder is an EISDIR error, as a folder is; the link and the folder are left whole', { skip: !canLink }, (t) => {
  const dir = tmp(t);
  fs.mkdirSync(path.join(dir, 'real'));
  fs.writeFileSync(path.join(dir, 'real', 'keep.txt'), 'k');
  fs.symlinkSync('real', path.join(dir, 'page.html'));
  assert.throws(() => fs.writeFileSync(path.join(dir, 'page.html'), 'x'), (e) => e.code === 'EISDIR');
  assert.throws(() => writeFileReplacing(path.join(dir, 'page.html'), 'PAGE'), (e) => e.code === 'EISDIR');
  assert.equal(fs.lstatSync(path.join(dir, 'page.html')).isSymbolicLink(), true);
  assert.deepEqual(names(path.join(dir, 'real')), ['keep.txt']);
  assert.deepEqual(names(dir), ['page.html', 'real'], 'no temp file left behind');
});

test('a directory at the target is an EISDIR error and is left whole', { skip: !canLink && 'Windows reports EPERM' }, (t) => {
  const dir = tmp(t);
  const target = path.join(dir, 'page.html');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'keep.txt'), 'k');
  assert.throws(() => writeFileReplacing(target, 'PAGE'), (e) => e.code === 'EISDIR');
  assert.deepEqual(names(target), ['keep.txt']);
  assert.deepEqual(names(dir), ['page.html'], 'no temp file left behind');
});

// ---- special files: refused, never replaced, never opened ----------------------------------------------------------------------

test('a FIFO at the target is refused in one line and stays a FIFO; nothing blocks even with no reader', { skip: !canLink }, (t) => {
  const dir = tmp(t);
  const fifo = path.join(dir, 'page.html');
  if (spawnSync('mkfifo', [fifo]).status !== 0) return t.skip('mkfifo is not available');
  const r = writeInChild(fifo, 'PAGE');
  assert.equal(r.status, 3, `status ${r.status} signal ${r.signal}: ${r.stderr}`);
  assert.match(r.stderr, /pipe|socket|device/);
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.equal(fs.lstatSync(fifo).isFIFO(), true);
  assert.deepEqual(names(dir), ['page.html'], 'no temp file left behind');
});

test('a unix socket at the target is refused and left in place', { skip: !canLink }, async (t) => {
  const dir = tmp(t);
  const sock = path.join(dir, 's');
  const server = net.createServer();
  const listening = await new Promise((resolve) => { server.once('error', () => resolve(false)); server.listen(sock, () => resolve(true)); });
  if (!listening) return t.skip('this path cannot hold a unix socket');
  t.after(() => server.close());
  const r = writeInChild(sock, 'PAGE');
  assert.equal(r.status, 3, `status ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /pipe|socket|device/);
  assert.equal(fs.lstatSync(sock).isSocket(), true);
});

test('a path under /dev/ is written in place, as before: /dev/null stays a device', { skip: !canLink || !fs.existsSync('/dev/null') }, () => {
  writeFileReplacing('/dev/null', 'discarded');
  assert.equal(fs.lstatSync('/dev/null').isCharacterDevice(), true);
});

test('--out /dev/stdout reaches the process stdout (a pipe here), and /dev/stdout is not replaced', { skip: !canLink || !fs.existsSync('/dev/stdout') }, () => {
  const r = writeInChild('/dev/stdout', 'to the pipe\n');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'to the pipe\n');
  assert.equal(fs.lstatSync('/dev/stdout').isFile(), false);
});

test('a /dev/fd/N path (process substitution) is written in place', { skip: !canLink || !fs.existsSync('/dev/fd') }, () => {
  const r = writeInChild('/dev/fd/3', 'through fd 3\n', { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(String(r.output[3]), 'through fd 3\n');
});

test('a link named stdout that is not under /dev/ is replaced like any other link', { skip: !canLink || !fs.existsSync('/dev/fd/1') }, (t) => {
  const dir = tmp(t);
  fs.symlinkSync('/dev/fd/1', path.join(dir, 'stdout'));
  writeFileReplacing(path.join(dir, 'stdout'), 'x');
  assert.equal(fs.lstatSync(path.join(dir, 'stdout')).isFile(), true);
});

// ---- failure -----------------------------------------------------------------------------------------------------------------

test('a failed write removes the temp file and keeps the error code', (t) => {
  const dir = tmp(t);
  const target = path.join(dir, 'page.html');
  fs.writeFileSync(target, 'old');
  const realRename = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error('no rename here'), { code: 'EXDEV' }); };
  try {
    assert.throws(() => writeFileReplacing(target, 'new'), (e) => e.code === 'EXDEV');
  } finally {
    fs.renameSync = realRename;
  }
  assert.equal(fs.readFileSync(target, 'utf8'), 'old', 'never a fallback that writes in place');
  assert.deepEqual(names(dir), ['page.html']);
});

test('an unwritable folder reports EACCES, and a missing folder ENOENT', { skip: !canLink || isRoot }, (t) => {
  const dir = tmp(t);
  const locked = path.join(dir, 'locked');
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0o500);
  try {
    assert.throws(() => writeFileReplacing(path.join(locked, 'p.html'), 'x'), (e) => e.code === 'EACCES');
  } finally {
    fs.chmodSync(locked, 0o700);
  }
  assert.throws(() => writeFileReplacing(path.join(dir, 'missing', 'p.html'), 'x'), (e) => e.code === 'ENOENT');
});
