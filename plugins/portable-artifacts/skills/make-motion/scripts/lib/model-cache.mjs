// Where the on-demand models (the Kokoro voice, about 90 MB; the MODNet matte, 25 MB) are kept. A plugin update puts the skill in
// a new folder and the old one's .cache goes with it, so the models live in a per-user folder that outlives the version:
// $CLAUDE_PLUGIN_DATA, else the OS cache folder, else <skill>/.cache (shared/doctor.mjs stableCacheDir).
// The lookup is per model (modelDir, like the voice's voiceModelDir): an install that already downloaded a model into
// <skill>/.cache/models/<id> keeps using that copy until the stable folder holds its own, so this never causes a second download,
// and another model arriving in the stable folder never hides it.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableCacheDir } from '../../shared/doctor.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The stable `models` folder for a skill at `skillDir`. `options` (env, platform, homedir) are for tests. */
export function modelsDir(skillDir = SKILL_ROOT, options = {}) {
  return path.join(stableCacheDir({ skillDir, ...options }), 'models');
}

/** The folder of model `id`: the stable one if present, else the legacy <skill>/.cache/models/<id> if present, else the stable one. */
export function modelDir(id, skillDir = SKILL_ROOT, options = {}) {
  const stable = path.join(modelsDir(skillDir, options), id);
  const legacy = path.join(skillDir, '.cache', 'models', id);
  return existsSync(stable) || !existsSync(legacy) ? stable : legacy;
}
