// Tests that a page build never writes through a symlink a repository ships, and never leaves the repository by one. Each skill's
// test file calls `linkTests(...)`; the builds are real (the skill's scripts/build.mjs, no browser). Built-ins only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const canLink = process.platform !== 'win32';
const PAGE_MARK = /<html|<!doctype html/i;
const BUILD_LIMIT_MS = 120000;

/** A real temp folder (macOS /tmp is /private/tmp) removed when the test ends. */
export function tmpDir(t, prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The spawn environment: a private HOME (no ~/.git, no user config), no PA_OUTPUT_DIR. */
export function cleanEnv(home) {
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull, PA_NO_BROWSER: '1' };
  delete env.PA_OUTPUT_DIR;
  return env;
}

/** `node script ...args` in `cwd` with the clean environment; no shell. */
export function runNode(t, script, args, cwd) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8', env: cleanEnv(tmpDir(t, 'pa-link-home-')), timeout: BUILD_LIMIT_MS });
}

/** Every path under `dir`, sorted: what a refusal must leave exactly as it was. */
export const listing = (dir) => fs.readdirSync(dir, { recursive: true }).sort();

/** A refusal: exit 2, one line on stderr naming `link` and `repo`, the way out in words. `otherLines`: a script that warns first (gather). */
export function assertRefused(r, { link, repo, otherLines = false }) {
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  const lines = r.stderr.trim().split('\n');
  if (!otherLines) assert.equal(lines.length, 1, r.stderr);
  const line = lines.at(-1);
  assert.ok(line.includes(link), `names the link ${link}: ${line}`);
  assert.ok(line.includes(repo), `names the repository ${repo}: ${line}`);
  assert.match(line, /remove the link, or pass the folder's real path/);
}

const pagesIn = (dir) => fs.readdirSync(dir).filter((f) => /\.html$/.test(f) && !/\.fragment\.html$/.test(f));

/**
 * @param {object} o
 * @param {string} o.skill name used in the test titles
 * @param {string} o.examples the skill's examples folder (copied into a temp repository)
 * @param {string} o.spec a spec file name inside it
 * @param {string} o.build absolute path of the skill's scripts/build.mjs
 * @param {(repo: string, spec: string) => string} o.folder the default output folder for a spec in that repository
 * @param {boolean} [o.paOutputDir] whether the skill honours $PA_OUTPUT_DIR (the dashboard does not)
 * @returns {{ plantRepo: Function, run: Function }} helpers for the skill's own extra tests
 */
export function linkTests({ skill, examples, spec: specName, build, folder, paOutputDir = true }) {
  const skip = !canLink && 'symbolic links need a privilege on Windows';

  // A repository (a bare `.git` folder is all the default-output rule looks for) holding a copy of the skill's examples.
  function plantRepo(t, { git = true } = {}) {
    const base = tmpDir(t, 'pa-link-');
    const repo = path.join(base, 'repo');
    const outside = path.join(base, 'outside');
    fs.mkdirSync(repo);
    fs.mkdirSync(outside);
    if (git) fs.mkdirSync(path.join(repo, '.git'));
    fs.cpSync(examples, path.join(repo, 'examples'), { recursive: true });
    return { base, repo, outside, spec: path.join(repo, 'examples', specName) };
  }
  const run = (t, spec, args, cwd) => runNode(t, build, [spec, ...args], cwd);

  test(`${skill}: a symlink planted at the default page path is replaced by the page; its target is untouched`, { skip }, (t) => {
    const { repo, outside, spec } = plantRepo(t);
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'precious');
    const first = run(t, spec, [], repo);
    assert.equal(first.status, 0, first.stderr);
    const dir = folder(repo, spec);
    const page = path.join(dir, pagesIn(dir)[0]);
    fs.rmSync(page);
    fs.symlinkSync(victim, page);
    const again = run(t, spec, [], repo);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'precious', 'the link target was overwritten');
    assert.equal(fs.lstatSync(page).isSymbolicLink(), false);
    assert.match(fs.readFileSync(page, 'utf8').slice(0, 200), PAGE_MARK);
  });

  test(`${skill}: a dangling symlink at the default page path is replaced and nothing is made where it pointed`, { skip }, (t) => {
    const { repo, outside, spec } = plantRepo(t);
    assert.equal(run(t, spec, [], repo).status, 0);
    const dir = folder(repo, spec);
    const page = path.join(dir, pagesIn(dir)[0]);
    fs.rmSync(page);
    fs.symlinkSync(path.join(outside, 'nowhere.txt'), page);
    const again = run(t, spec, [], repo);
    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(fs.lstatSync(page).isSymbolicLink(), false);
  });

  test(`${skill}: a default output folder (or one of its ancestors) that is a symlink out of the repository is refused in one line; nothing is written`, { skip }, (t) => {
    const { repo, outside, spec } = plantRepo(t);
    fs.writeFileSync(path.join(outside, 'holiday.png'), 'precious');
    const dir = folder(repo, spec);
    const linked = dir; // .scratch for the page builders, dist for the dashboard
    fs.mkdirSync(path.dirname(linked), { recursive: true });
    fs.symlinkSync(outside, linked);
    const before = listing(outside);
    const r = run(t, spec, [], repo);
    assertRefused(r, { link: linked, repo });
    assert.deepEqual(listing(outside), before, 'the build wrote through the link');
  });

  test(`${skill}: the spec reached through a linked folder whose target is itself a git repository is still refused (the outer repository counts)`, { skip }, (t) => {
    const { repo, outside } = plantRepo(t);
    fs.mkdirSync(path.join(outside, '.git'));
    fs.cpSync(examples, path.join(outside, 'examples'), { recursive: true });
    fs.symlinkSync(outside, path.join(repo, 'linked'));
    const before = listing(outside);
    const r = run(t, path.join(repo, 'linked', 'examples', specName), [], repo);
    assertRefused(r, { link: path.join(repo, 'linked'), repo });
    assert.deepEqual(listing(outside), before, 'the build wrote through the link');
  });

  test(`${skill}: an explicit --out through a linked ancestor that leaves the repository is refused; the folder's real path is accepted`, { skip }, (t) => {
    const { repo, outside, spec } = plantRepo(t);
    fs.symlinkSync(outside, path.join(repo, 'ext'));
    const r = run(t, spec, ['--out', path.join(repo, 'ext', 'a', 'b')], repo);
    assertRefused(r, { link: path.join(repo, 'ext'), repo });
    assert.deepEqual(listing(outside), [], 'the build wrote through the link');
    const real = run(t, spec, ['--out', path.join(outside, 'a', 'b')], repo);
    assert.equal(real.status, 0, real.stderr);
    assert.ok(pagesIn(path.join(outside, 'a', 'b')).length === 1);
  });

  test(`${skill}: $PA_OUTPUT_DIR is checked like --out`, { skip: skip || !paOutputDir }, (t) => {
    const { repo, outside, spec } = plantRepo(t);
    fs.symlinkSync(outside, path.join(repo, 'ext'));
    const env = { ...cleanEnv(tmpDir(t, 'pa-link-home-')), PA_OUTPUT_DIR: path.join(repo, 'ext', 'x') };
    const r = spawnSync(process.execPath, [build, spec], { cwd: repo, encoding: 'utf8', env, timeout: BUILD_LIMIT_MS });
    assertRefused(r, { link: path.join(repo, 'ext'), repo });
    assert.deepEqual(listing(outside), []);
  });

  test(`${skill}: a link that stays inside the repository is allowed, for the default folder as for --out`, { skip }, (t) => {
    const { repo, spec } = plantRepo(t);
    fs.mkdirSync(path.join(repo, 'build', 'tmp'), { recursive: true });
    const dir = folder(repo, spec);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.symlinkSync(path.join(repo, 'build', 'tmp'), dir);
    const r = run(t, spec, [], repo);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(pagesIn(path.join(repo, 'build', 'tmp')).length, 1);
    fs.symlinkSync(path.join(repo, 'build'), path.join(repo, 'inside'));
    const viaOut = run(t, spec, ['--out', path.join(repo, 'inside', 'o')], repo);
    assert.equal(viaOut.status, 0, viaOut.stderr);
    assert.equal(pagesIn(path.join(repo, 'build', 'o')).length, 1);
  });

  test(`${skill}: control: the same link layout outside any repository (no .git) builds through the link, as before (a stated limit)`, { skip }, (t) => {
    const { repo, outside, spec } = plantRepo(t, { git: false });
    fs.symlinkSync(outside, path.join(repo, 'ext'));
    const r = run(t, spec, ['--out', path.join(repo, 'ext', 'a')], repo);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(pagesIn(path.join(outside, 'a')).length, 1);
  });

  test(`${skill}: an explicit --out file that is a symlink is replaced`, { skip }, (t) => {
    const { repo, spec } = plantRepo(t);
    const real = path.join(repo, 'real');
    fs.mkdirSync(real);
    const first = run(t, spec, ['--out', real], repo);
    assert.equal(first.status, 0, first.stderr);
    const name = pagesIn(real)[0];
    const victim = path.join(repo, 'victim.txt');
    fs.writeFileSync(victim, 'precious');
    fs.rmSync(path.join(real, name));
    fs.symlinkSync(victim, path.join(real, name));
    const again = run(t, spec, ['--out', real], repo);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'precious', 'the link target was overwritten');
    assert.match(fs.readFileSync(path.join(real, name), 'utf8').slice(0, 200), PAGE_MARK);
  });

  return { plantRepo, run };
}
