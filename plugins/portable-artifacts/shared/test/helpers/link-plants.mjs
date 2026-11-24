// Tests that a page build never writes through a symlink a repository ships. Each skill's test file calls
// `linkTests(...)`; the builds are real (the skill's scripts/build.mjs, no browser). Built-ins only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const canLink = process.platform !== 'win32';
const tmpDir = (prefix) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
const PAGE_MARK = /<html|<!doctype html/i;

// A repository (a bare `.git` folder is all the default-output rule looks for) holding a copy of the skill's examples.
function plantRepo(examples, specName) {
  const repo = tmpDir('pa-link-repo-');
  fs.mkdirSync(path.join(repo, '.git'));
  fs.cpSync(examples, path.join(repo, 'examples'), { recursive: true });
  return { repo, spec: path.join(repo, 'examples', specName) };
}

function run(build, spec, args, cwd) {
  const home = tmpDir('pa-link-home-');
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull };
  delete env.PA_OUTPUT_DIR;
  const r = spawnSync(process.execPath, [build, spec, ...args], { cwd, encoding: 'utf8', env, timeout: 120000 });
  fs.rmSync(home, { recursive: true, force: true });
  return r;
}

const pagesIn = (dir) => fs.readdirSync(dir).filter((f) => /\.html$/.test(f) && !/\.fragment\.html$/.test(f));

/**
 * @param {object} o
 * @param {string} o.skill name used in the test titles
 * @param {string} o.examples the skill's examples folder (copied into a temp repository)
 * @param {string} o.spec a spec file name inside it
 * @param {string} o.build absolute path of the skill's scripts/build.mjs
 * @param {(repo: string, spec: string) => string} o.folder the default output folder for a spec in that repository
 */
export function linkTests({ skill, examples, spec: specName, build, folder }) {
  const skip = !canLink && 'symbolic links need a privilege on Windows';

  test(`${skill}: control: a plain writeFileSync follows a symlink at the default page path`, { skip }, () => {
    const outside = tmpDir('pa-link-out-');
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'precious');
    const link = path.join(outside, 'page.html');
    fs.symlinkSync(victim, link);
    fs.writeFileSync(link, 'PAGE');
    assert.equal(fs.readFileSync(victim, 'utf8'), 'PAGE');
  });

  test(`${skill}: a symlink planted at the default page path is replaced by the page; its target is untouched`, { skip }, () => {
    const { repo, spec } = plantRepo(examples, specName);
    const outside = tmpDir('pa-link-out-');
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'precious');
    const first = run(build, spec, [], repo);
    assert.equal(first.status, 0, first.stderr);
    const dir = folder(repo, spec);
    const [name] = pagesIn(dir);
    const page = path.join(dir, name);
    fs.rmSync(page);
    fs.symlinkSync(victim, page);
    const again = run(build, spec, [], repo);
    assert.equal(again.status, 0, again.stderr);
    assert.ok(fs.readFileSync(victim, 'utf8') === 'precious', 'the link target was overwritten');
    assert.equal(fs.lstatSync(page).isSymbolicLink(), false);
    assert.match(fs.readFileSync(page, 'utf8').slice(0, 200), PAGE_MARK);
  });

  test(`${skill}: a dangling symlink at the default page path is replaced and nothing is made where it pointed`, { skip }, () => {
    const { repo, spec } = plantRepo(examples, specName);
    const outside = tmpDir('pa-link-out-');
    const first = run(build, spec, [], repo);
    assert.equal(first.status, 0, first.stderr);
    const dir = folder(repo, spec);
    const page = path.join(dir, pagesIn(dir)[0]);
    fs.rmSync(page);
    fs.symlinkSync(path.join(outside, 'nowhere.txt'), page);
    const again = run(build, spec, [], repo);
    assert.equal(again.status, 0, again.stderr);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(fs.lstatSync(page).isSymbolicLink(), false);
  });

  test(`${skill}: a symlinked default output folder is refused in one line, and nothing is written through it`, { skip }, () => {
    const { repo, spec } = plantRepo(examples, specName);
    const outside = tmpDir('pa-link-out-');
    const dir = folder(repo, spec);
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.symlinkSync(outside, dir);
    const r = run(build, spec, [], repo);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /is a symlink/);
    assert.match(r.stderr, /remove the link, or pass --out/);
    assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
    assert.deepEqual(fs.readdirSync(outside), [], 'the build wrote through the link');
  });

  test(`${skill}: an explicit --out through a symlinked folder keeps working, and a symlinked file there is replaced`, { skip }, () => {
    const { repo, spec } = plantRepo(examples, specName);
    const real = path.join(repo, 'real');
    fs.mkdirSync(real);
    fs.symlinkSync(real, path.join(repo, 'linked'));
    const first = run(build, spec, ['--out', path.join(repo, 'linked')], repo);
    assert.equal(first.status, 0, first.stderr);
    const name = pagesIn(real)[0];
    assert.ok(name, 'the page landed in the folder the link points to');
    const victim = path.join(repo, 'victim.txt');
    fs.writeFileSync(victim, 'precious');
    fs.rmSync(path.join(real, name));
    fs.symlinkSync(victim, path.join(real, name));
    const again = run(build, spec, ['--out', real], repo);
    assert.equal(again.status, 0, again.stderr);
    assert.ok(fs.readFileSync(victim, 'utf8') === 'precious', 'the link target was overwritten');
    assert.match(fs.readFileSync(path.join(real, name), 'utf8').slice(0, 200), PAGE_MARK);
  });
}
