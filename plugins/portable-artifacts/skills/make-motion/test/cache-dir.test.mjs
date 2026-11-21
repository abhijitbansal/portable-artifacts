// The voice and cutout models live in a stable per-user folder, so a plugin update does not download them again (PA-09, part 1).
// No browser, no model: only where the folders are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { modelsDir, modelDir } from '../scripts/lib/model-cache.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'cd-'));

test('modelsDir: $CLAUDE_PLUGIN_DATA when the host sets it', () => {
  const skillDir = tmp();
  assert.equal(modelsDir(skillDir, { env: { CLAUDE_PLUGIN_DATA: '/data/plugin' }, platform: 'darwin', homedir: '/Users/x' }), path.join('/data/plugin', 'models'));
});

test('modelsDir: else the OS cache folder, outside the versioned skill folder', () => {
  const skillDir = tmp();
  assert.equal(modelsDir(skillDir, { env: {}, platform: 'darwin', homedir: '/Users/x' }), '/Users/x/Library/Caches/portable-artifacts/models');
  assert.equal(modelsDir(skillDir, { env: { XDG_CACHE_HOME: '/xdg' }, platform: 'linux', homedir: '/home/x' }), '/xdg/portable-artifacts/models');
});

test('modelsDir: else <skill>/.cache/models (no home folder, no data folder)', () => {
  const skillDir = tmp();
  assert.equal(modelsDir(skillDir, { env: {}, platform: 'linux', homedir: '' }), path.join(skillDir, '.cache', 'models'));
});

test('modelsDir: the stable folder even when a legacy <skill>/.cache/models exists (per-model lookup is modelDir)', () => {
  const skillDir = tmp();
  const home = tmp();
  const stable = path.join(home, 'Library', 'Caches', 'portable-artifacts', 'models');
  mkdirSync(path.join(skillDir, '.cache', 'models'), { recursive: true });
  assert.equal(modelsDir(skillDir, { env: {}, platform: 'darwin', homedir: home }), stable);
});

test('modelDir: per model, an install that already downloaded it into <skill>/.cache/models keeps using that copy until the stable folder has its own', () => {
  const skillDir = tmp();
  const home = tmp();
  const stableModels = path.join(home, 'Library', 'Caches', 'portable-artifacts', 'models');
  const legacyModels = path.join(skillDir, '.cache', 'models');
  const options = { env: {}, platform: 'darwin', homedir: home };
  assert.equal(modelDir('modnet', skillDir, options), path.join(stableModels, 'modnet'), 'nothing downloaded yet: the stable folder');
  mkdirSync(path.join(legacyModels, 'modnet'), { recursive: true });
  assert.equal(modelDir('modnet', skillDir, options), path.join(legacyModels, 'modnet'), 'a model already in the skill folder is reused, not downloaded again');
  mkdirSync(path.join(stableModels, 'onnx-community'), { recursive: true }); // another model (the voice) arrives in the stable folder
  assert.equal(modelDir('modnet', skillDir, options), path.join(legacyModels, 'modnet'), 'another model in the stable folder does not hide the legacy modnet');
  mkdirSync(path.join(stableModels, 'modnet'), { recursive: true });
  assert.equal(modelDir('modnet', skillDir, options), path.join(stableModels, 'modnet'), 'once the stable copy exists it wins');
});

// The version 2 voice model looks itself up the same way (voiceModelDir, voice-model.test.mjs); the cut-out tool uses modelDir('modnet').
test('cutout.mjs puts its model under that folder', () => {
  const data = tmp();
  mkdirSync(path.join(data, 'models', 'modnet'), { recursive: true }); // an existing stable copy wins over a legacy <skill>/.cache/models/modnet on this machine
  const script = `const c = await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts/lib/cutout.mjs')).href)});
    process.stdout.write(JSON.stringify({ cutout: c.MODEL_DIR }));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: { ...process.env, CLAUDE_PLUGIN_DATA: data } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).cutout, path.join(data, 'models', 'modnet'));
});
