// The film's `overlays` field: { logo?: { src, corner? }, progress?: true }. Checked by hand, so each error names the field
// to write instead: an unknown overlay gets the registry's did-you-mean, the logo's picture is held to the film folder by
// the rules a shot's picture gets (srcProblem), and an overlay the film's look does not draw is refused naming the looks
// that do. Pure apart from the file system check of the picture.
import path from 'node:path';
import { registries as defaultRegistries } from '../../engine/registry.mjs';
import { CORNERS } from '../../engine/overlays/index.mjs';
import { IMAGE_EXTENSIONS } from '../../engine/assets.mjs';
import { pathJoin } from '../../shared/errors.mjs';
import { isPlainObject, quote, srcProblem } from './spec-common.mjs';

const LOGO_KEYS = Object.freeze(['src', 'corner']);
const OVERLAYS_EXAMPLE = '{ "logo": { "src": "assets/logo.png" }, "progress": true }';
const NAME_SHOWN = 40; // an unknown overlay's name as an error repeats it, cut short

function logoErrors(logo, at, specDir) {
  if (!isPlainObject(logo)) return [{ path: at, message: `must be { "src": "assets/logo.png", "corner": "top-right" } (corner is optional: ${CORNERS.join(', ')}), got ${quote(logo)}` }];
  const unknown = Object.keys(logo).filter((key) => !LOGO_KEYS.includes(key))
    .map((key) => ({ path: pathJoin(at, key), message: `unknown field; accepted: ${LOGO_KEYS.join(', ')}` }));
  const src = pathJoin(at, 'src');
  const corner = logo.corner === undefined || CORNERS.includes(logo.corner) ? []
    : [{ path: pathJoin(at, 'corner'), message: `${quote(logo.corner)} is not a corner; write one of ${CORNERS.join(', ')}` }];
  if (typeof logo.src !== 'string' || logo.src === '') return [{ path: src, message: 'must be the path of a picture in the film\'s folder, such as "assets/logo.png"' }, ...corner, ...unknown];
  if (!IMAGE_EXTENSIONS.has(path.extname(logo.src).toLowerCase())) return [{ path: src, message: `${quote(logo.src)} must be a png, jpg, webp or gif picture` }, ...corner, ...unknown];
  const problem = srcProblem(logo.src, specDir);
  return [...(problem ? [{ path: src, message: problem }] : []), ...corner, ...unknown];
}

// The overlay a film asks for that its look gives null for: one error at the overlay, naming the looks that draw it.
function refusedByLook(name, look, looks) {
  if (!look || look.overlays?.[name] !== null) return [];
  const draw = looks.names().filter((other) => looks.get(other).overlays?.[name] != null);
  return [{ path: pathJoin('overlays', name), message: `look "${look.name}" does not draw the ${name} overlay; the looks that do: ${draw.join(', ') || 'none'}` }];
}

// The registry's own did-you-mean for a name that is not an overlay.
function unknownOverlay(registry, name) {
  try {
    registry.get(name.slice(0, NAME_SHOWN));
  } catch (err) {
    return err.message;
  }
  return `unknown overlay ${quote(name)}`;
}

/**
 * The errors of `spec.overlays` as { path, message }: not an object, an unknown overlay (did-you-mean), a logo without a
 * picture inside the folder or with a bad corner, `progress` that is not true, and an overlay the film's look (`ctx.look`,
 * resolved by the caller, null when it is not known) does not draw. `ctx.regs` are the registries the film is checked against.
 */
export function checkOverlays(spec, ctx) {
  if (spec.overlays === undefined) return [];
  const overlays = spec.overlays;
  if (!isPlainObject(overlays)) return [{ path: 'overlays', message: `must be an object such as ${OVERLAYS_EXAMPLE}, got ${quote(overlays)}` }];
  const known = ctx.regs.overlays ?? defaultRegistries.overlays;
  return Object.keys(overlays).flatMap((name) => {
    const at = pathJoin('overlays', name);
    if (!known.has(name)) return [{ path: at, message: unknownOverlay(known, name) }];
    const own = name === 'logo' ? logoErrors(overlays.logo, at, ctx.specDir)
      : (overlays[name] === true ? [] : [{ path: at, message: `must be true to draw the ${name} overlay (leave it out for none), got ${quote(overlays[name])}` }]);
    return [...own, ...(ctx.regs.looks ? refusedByLook(name, ctx.look, ctx.regs.looks) : [])];
  });
}
