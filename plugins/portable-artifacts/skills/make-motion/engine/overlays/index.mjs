// The film-level overlays of the v2 engine: a logo and a progress bar that sit over every cut, unbroken, because they
// belong to the film and not to a shot. Importing this file registers `logo` and `progress` in registries.overlays (once:
// a second evaluation leaves the registry as it is). An overlay is a summary, the check of its look data (look.overlays.<name>:
// an object, or null where the look does not draw it; validateLook asks `problems`) and `build`, which turns the film's
// request and the look's data into nodes. overlayNodes builds every overlay the film asks for, once, at film time. Pure
// and DOM-free: the page draws the nodes over the composed frame (engine/page).
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { unitOf } from '../units.mjs';
import { colourOf, roundedRect } from '../devices/shared.mjs';
import { compositionRect } from '../kinds/shared.mjs';
import { safeInsets, VIRAL_SAFE_ZONE } from '../formats.mjs';

export const CORNERS = Object.freeze(['top-left', 'top-right', 'bottom-left', 'bottom-right']);
export const EDGES = Object.freeze(['top', 'bottom']);
const DEFAULT_MODE = 'pro';

// ---- the look data of each overlay: what a field must be, as { ok(value, palette), need } ----

const isPositive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isNonNegative = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const isPaletteKey = (v, palette) => typeof v === 'string' && Object.hasOwn(palette ?? {}, v);

const LOGO_RULES = Object.freeze({
  corner: { ok: (v) => CORNERS.includes(v), need: `one of ${CORNERS.join(', ')}` },
  height: { ok: isPositive, need: 'a number of units above 0' },
  margin: { ok: isNonNegative, need: 'a number of units, 0 or more' },
  opacity: { ok: (v) => isPositive(v) && v <= 1, need: 'a number above 0 and at most 1' },
});
const PROGRESS_RULES = Object.freeze({
  edge: { ok: (v) => EDGES.includes(v), need: `one of ${EDGES.join(', ')}` },
  height: { ok: isPositive, need: 'a number of units above 0' },
  inset: { ok: isNonNegative, need: 'a number of units, 0 or more' },
  bar: { ok: isPaletteKey, need: 'a palette key' },
  track: { ok: isPaletteKey, need: 'a palette key' },
});

// "<field> must be <need>, got <value>" for each field of `data` that is wrong or missing, and "<field> is not a field" for
// each key that is not one.
function problemsOf(rules, data, palette) {
  const bad = Object.entries(rules).filter(([key, { ok }]) => !ok(data[key], palette))
    .map(([key, { need }]) => `${key} must be ${need}, got ${JSON.stringify(data[key]) ?? 'undefined'}`);
  const unknown = Object.keys(data).filter((key) => !Object.hasOwn(rules, key))
    .map((key) => `${key} is not a field; it takes ${Object.keys(rules).join(', ')}`);
  return [...bad, ...unknown];
}

// ---- the nodes ----

const mark = (props, overlay) => ({ ...props, overlay });

function logoNodes({ film, look, unit, safe, asset }) {
  const data = look.overlays.logo;
  const { src, corner = data.corner } = film.overlays.logo;
  const picture = asset(src);
  const sized = [picture.width, picture.height].every((side) => Number.isFinite(side) && side > 0);
  if (!sized) throw new Error(`overlays.logo.src: the picture "${src}" has no size (${picture.width} by ${picture.height}); it could not be decoded`);
  const h = data.height * unit;
  const w = (h * picture.width) / picture.height;
  const gap = data.margin * unit;
  const x = corner.endsWith('left') ? safe.left + gap : safe.left + safe.w - gap - w;
  const y = corner.startsWith('top') ? safe.top + gap : safe.top + safe.h - gap - h;
  return [node('image', 'overlay.logo', mark({ src, w, h, x, y, opacity: data.opacity }, 'logo'))];
}

function progressNodes({ look, unit, safe, duration }) {
  const data = look.overlays.progress;
  const h = data.height * unit;
  const x = safe.left + data.inset * unit;
  const w = safe.w - 2 * data.inset * unit;
  const y = data.edge === 'top' ? safe.top : safe.top + safe.h - h;
  const d = roundedRect(x, y, w, h, 0);
  return [
    node('path', 'overlay.progress.track', mark({ d, fill: colourOf(look, data.track) }, 'progress')),
    // one path, revealed from its left edge as the film plays: 0 at the first frame, 1 at the film's length
    node('path', 'overlay.progress.bar', mark({ d, fill: colourOf(look, data.bar) }, 'progress'), {
      tracks: { reveal: track([{ t: 0, v: 0 }, { t: duration, v: 1 }]) },
    }),
  ];
}

const OVERLAYS = Object.freeze([
  {
    name: 'logo',
    summary: 'The film\'s logo, a picture from the film folder, kept in one corner of every frame, over every cut.',
    problems: (data, palette) => problemsOf(LOGO_RULES, data, palette),
    build: logoNodes,
  },
  {
    name: 'progress',
    summary: 'A thin bar along one edge that fills from left to right over the film\'s length, over every cut.',
    problems: (data, palette) => problemsOf(PROGRESS_RULES, data, palette),
    build: progressNodes,
  },
].map(Object.freeze));

for (const { name, ...entry } of OVERLAYS) {
  if (!registries.overlays.has(name)) registries.overlays.add(name, Object.freeze(entry));
}

// Where overlays may stand: the rectangle the look composes in, and on a short composed inside the platform safe zone
// (`rect.safe`) also inside the platform's own insets. A banded look's band can reach below the safe zone's bottom (pop to
// 1440 px, cosmos to 1613 px, against 1245 px on 1080x1920): its text keeps to the band, but a corner mark or a bar at
// the foot there would sit under the platform's caption and buttons.
function overlayRect(rect, insets, canvas) {
  if (!rect.safe) return rect;
  const left = Math.max(rect.left, insets.left);
  const top = Math.max(rect.top, insets.top);
  const right = Math.min(rect.left + rect.w, canvas.w - insets.right);
  const bottom = Math.min(rect.top + rect.h, canvas.h - insets.bottom);
  return { ...rect, left, top, w: right - left, h: bottom - top, cx: left + (right - left) / 2, cy: top + (bottom - top) / 2 };
}

/**
 * The nodes of every overlay the film asks for (`film.overlays`), in the registry's order, none for a film that asks for
 * none. They stand inside the rectangle the look composes in (compositionRect, and on a short also inside the platform
 * safe zone, given `viralInsets`, which default to VIRAL_SAFE_ZONE on the canvas: overlayRect), and the bar reveals over
 * `timeline.duration`: they are sampled at film time, never handed to a cut.
 * `assets` maps a src to its picture ({ width, height }); a logo with no loaded picture throws, naming `overlays.logo.src`.
 * @returns {import('../graph/node.mjs').Node[]}
 */
export function overlayNodes({ film, look, canvas, timeline, assets = new Map(), viralInsets = null }) {
  const asked = film.overlays;
  if (asked === undefined || asked === null) return [];
  const mode = registries.modes.get(film.mode ?? DEFAULT_MODE);
  // a short's platform safe zone, as the review reads it (review.mjs): used only where the look composes inside it
  const insets = viralInsets ?? safeInsets([canvas.w, canvas.h], VIRAL_SAFE_ZONE);
  const safe = overlayRect(compositionRect({ canvas, look, viralInsets: insets, mode }), insets, canvas);
  const asset = (src) => {
    const picture = assets.get(src);
    if (!picture) throw new Error(`overlays.logo.src: no loaded picture for "${src}"`);
    return picture;
  };
  const context = { film, look, canvas, unit: unitOf(canvas), safe, duration: timeline.duration, asset };
  return registries.overlays.names().filter((name) => asked[name] !== undefined).flatMap((name) => registries.overlays.get(name).build(context));
}
