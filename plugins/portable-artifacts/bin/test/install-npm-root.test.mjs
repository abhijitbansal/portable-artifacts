// `npm ci` for a project install runs in a stage folder inside the target repository. npm looks UP from its folder for a workspace
// root: a repository whose package.json lists the stage in `workspaces` (and whose lock names it) made npm use the REPOSITORY as its
// root, and `npm ci` empties that root's node_modules, a link to some other folder included. The install must never let npm
// leave the stage. Offline: the fixture skill has no dependencies, so nothing is downloaded.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installDeps } from '../install.mjs';

const skip = process.platform === 'win32' && 'symbolic links need a privilege on Windows';
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const STAGE_NAME = '.fx.new-4242';
const OWN = { name: 'fx', version: '1.0.0' };

// A skill with an empty lock, and a repository whose workspaces glob and lock both name the stage, whose node_modules is a link out.
function world({ workspaces }) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-npmroot-')));
  made.push(base);
  const src = path.join(base, 'skill-src');
  const repo = path.join(base, 'repo');
  const outside = path.join(base, 'outside');
  const stage = path.join(repo, '.claude', 'skills', STAGE_NAME);
  for (const d of [src, stage, outside, path.join(repo, '.git'), path.join(outside, 'dir')]) fs.mkdirSync(d, { recursive: true });
  const lockOf = (packages) => JSON.stringify({ name: OWN.name, version: OWN.version, lockfileVersion: 3, requires: true, packages });
  for (const dir of [src, stage]) {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(OWN));
    fs.writeFileSync(path.join(dir, 'package-lock.json'), lockOf({ '': OWN }));
  }
  const root = { name: 'evil', version: '1.0.0', ...(workspaces ? { workspaces: [`.claude/skills/${STAGE_NAME.replace(/\d+$/, '*')}`] } : {}) };
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify(root));
  fs.writeFileSync(path.join(repo, 'package-lock.json'), lockOf({
    '': root,
    [`node_modules/${OWN.name}`]: { resolved: `.claude/skills/${STAGE_NAME}`, link: true },
    [`.claude/skills/${STAGE_NAME}`]: OWN,
  }));
  fs.writeFileSync(path.join(outside, 'precious.txt'), 'precious');
  fs.writeFileSync(path.join(outside, 'dir', 'y'), 'y');
  fs.symlinkSync(outside, path.join(repo, 'node_modules'));
  return { src, repo, outside, stage };
}

// installDeps with npm kept offline and its cache in a private folder.
function install(src, stage) {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-npmcache-'));
  made.push(cache);
  const saved = { ...process.env };
  Object.assign(process.env, { npm_config_offline: 'true', npm_config_cache: cache, npm_config_fetch_retries: '0', npm_config_update_notifier: 'false' });
  try {
    return installDeps(src, stage, false);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

test('control: a repository with no workspaces; npm ci in the stage leaves the node_modules link and its target alone', { skip }, () => {
  const { src, repo, outside, stage } = world({ workspaces: false });
  assert.equal(install(src, stage), null);
  assert.deepEqual(fs.readdirSync(outside).sort(), ['dir', 'precious.txt']);
  assert.equal(fs.lstatSync(path.join(repo, 'node_modules')).isSymbolicLink(), true);
});

test('a repository that lists the stage as a workspace does not make npm use the repository: the folder behind its node_modules link survives', { skip }, () => {
  const { src, repo, outside, stage } = world({ workspaces: true });
  assert.equal(install(src, stage), null, 'the stage installs');
  assert.deepEqual(fs.readdirSync(outside).sort(), ['dir', 'precious.txt'], 'npm emptied the folder behind the repository\'s node_modules');
  assert.equal(fs.lstatSync(path.join(repo, 'node_modules')).isSymbolicLink(), true, 'the link was removed');
});
