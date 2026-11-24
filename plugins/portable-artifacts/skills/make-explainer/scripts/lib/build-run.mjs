// The build itself: validate, render, write. scripts/build.mjs loads this after its dependency preflight, so a
// missing install is one line naming the doctor command instead of an ERR_MODULE_NOT_FOUND stack.
import fs from 'node:fs';
import path from 'node:path';
import { loadSpec, validateSpec } from './spec.mjs';
import { buildPage, BuildError } from './page.mjs';
import { resolveOutput, assetsFolder } from './output.mjs';
import { syncAssets, assetConflicts, specInputs, WriteError } from './assets.mjs';
import { SiblingError } from './siblings.mjs';
import { isSlides } from './slides.mjs';
import { flavorFor, CLASSIC } from './flavor.mjs';
import { specTheme } from './default-theme.mjs';
import { fetchHeroImage, heroPrompt, parseEndpoint, requireKey, ImageHookError, KEY_ENV } from './image-hook.mjs';
import { twinFile, isBuildTwin, hasChecklist } from './checklist-md.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { withGeneratedBy } from '../../shared/provenance.mjs';
import { assertContained, ensureOutputFolder, writeFileReplacing } from '../../shared/write-file.mjs';

const fail = (errors) => ({ ok: false, errors });
const MD_NEEDS_CHECKLIST = '--md writes the markdown twin of a checklist, and this spec has no checklist section; add one or drop --md';

/** The markdown twin sits next to the page: <name>.md for <name>.html. */
export const mdPath = (target) => target.replace(/\.html?$/i, '.md');

/**
 * Build the page for a spec file. Returns { ok: true, out, md, theme, assets, bytes, warnings } after
 * writing it (`theme` is the one drawn: --theme, else spec.theme, else the default; `md` is the twin's path when
 * `md` was asked for, else null), else { ok: false, errors } (nothing is written). `strict` makes the section and page
 * length caps errors.
 */
export async function build(file, { out, theme, model, effort, agent, imageApi, fetchImpl, strict = false, md = false, env = process.env } = {}) {
  const { spec: loaded, dir } = loadSpec(file);
  const themed = theme === undefined ? loaded : { ...loaded, theme };
  const spec = withGeneratedBy(themed, { model, effort, agent });
  const checked = await validateSpec(spec, { dir, strict });
  if (!checked.ok) return fail(checked.errors);
  if (md && !hasChecklist(spec)) return fail([{ path: 'sections', message: MD_NEEDS_CHECKLIST }]);
  const target = resolveOutput({ out, title: spec.title, specPath: file, env });
  assertContained(path.dirname(target)); // before the assets folder is made or tidied, or anything is written: a link that leaves the repository is refused
  const twin = md ? mdPath(target) : null;
  const twinClash = twin === null ? null : twinConflict(twin, spec);
  if (twinClash) return fail([twinClash]);
  if (imageApi !== undefined) checkImageApi(spec, imageApi, env);
  const assetsDir = assetsFolder(target);
  let conflicts = [];
  // The request is the last thing that can fail after local work: buildPage calls this once everything else
  // rendered, and a clash with files this build did not write stops it before anything is sent.
  const heroImage = imageApi === undefined ? undefined : async ({ assets }) => {
    conflicts = assetConflicts(assetsDir, assets);
    if (conflicts.length > 0) return undefined;
    return requestHeroImage(spec, imageApi, { fetchImpl, env });
  };
  let built;
  try {
    built = await buildPage(spec, { dir, out: target, env, heroImage });
  } catch (e) {
    if (e instanceof BuildError) return fail(e.errors);
    if (e instanceof SiblingError) return fail([{ path: 'sections', message: e.message }]);
    throw e;
  }
  // Before anything is written: a file in the folder that no build wrote is never overwritten.
  conflicts = assetConflicts(assetsDir, built.assets);
  if (conflicts.length > 0) return fail(conflicts);
  // Assets and their manifest first, then the twin and the page (each atomically), then the tidy-up of files this
  // build no longer writes (see assets.mjs): a failure anywhere names its path and leaves the previous page in place.
  const publish = () => {
    if (twin) writeAtomic(twin, twinFile(spec));
    writeAtomic(target, built.html);
  };
  syncAssets(assetsDir, built.assets, { protect: specInputs(spec, dir), publish });
  return { ok: true, out: target, md: twin, theme: specTheme(spec), assets: built.assets.map((a) => a.to), bytes: Buffer.byteLength(built.html), warnings: checked.warnings };
}

// Refusals that need no network: a deck, a classic theme, a bad endpoint or a missing key. Throws ImageHookError.
function checkImageApi(spec, imageApi, env) {
  if (isSlides(spec)) throw new ImageHookError('--image-api only applies to explainer pages, not slide decks; drop the flag or build a page');
  const theme = specTheme(spec);
  if (flavorFor(theme) === CLASSIC) throw new ImageHookError(`--image-api needs a dusk, press or poster page (got ${theme}); pass --theme dusk or drop the flag`);
  parseEndpoint(imageApi);
  requireKey(env[KEY_ENV]);
}

// The one network call, announced on stderr before anything leaves the machine. Throws ImageHookError.
async function requestHeroImage(spec, imageApi, { fetchImpl, env }) {
  const host = parseEndpoint(imageApi).host;
  const key = requireKey(env[KEY_ENV]);
  process.stderr.write(`image-api: sending the title and subtitle to ${host} (leaves this machine)\n`);
  return fetchHeroImage({ prompt: heroPrompt(spec), endpoint: imageApi, key, fetchImpl });
}

// The twin is only ever written over a file an earlier --md build wrote (see isBuildTwin): -> an error for the
// caller to return, or null when the path is free or ours.
function twinConflict(twin, spec) {
  let stat;
  try {
    stat = fs.statSync(twin);
  } catch {
    return null; // no twin yet
  }
  const name = path.basename(twin);
  const clash = (message) => ({ path: 'md', message });
  if (!stat.isFile()) return clash(`${name} is not a file; move it, or build to another path`);
  let existing;
  try {
    existing = fs.readFileSync(twin, 'utf8');
  } catch (e) {
    throw new WriteError(twin, e);
  }
  return isBuildTwin(existing, spec)
    ? null
    : clash(`${name} was not written by a make-explainer --md build (or by an older version); delete or rename it to regenerate`);
}

// Temp file + rename, so an interrupted build leaves the old file or the new one. A symlink at the target is replaced
// by the page, never written through (shared/write-file.mjs).
function writeAtomic(target, text) {
  const folder = path.dirname(target);
  try {
    ensureOutputFolder(folder);
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new WriteError(folder, e);
  }
  try {
    writeFileReplacing(target, text);
  } catch (e) {
    throw new WriteError(target, e);
  }
}
