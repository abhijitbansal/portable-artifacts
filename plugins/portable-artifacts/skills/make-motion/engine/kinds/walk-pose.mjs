// The poses the walk camera lands on (walk-camera.mjs chains them). A step stop frames a context region, not the bare box:
// the box grown to a share of the picture, centred on the box and clamped inside the picture, at the zoom that fits that
// region inside the look's title-safe pad, capped at the take's native zoom. Once the zoom fills the frame the pan is
// clamped so no ground shows beside the picture. A lift pose is the stop's pose eased down to the zoom at which the lifted
// card can scale within the take's pixels, with the whole card inside the pad. A pose is { x, y, zoom } in camera-layer
// terms (the look's drift layer adds its own pan, so the drift at the landing second is taken off). Pure and DOM-free.
import { driftAt, driftReach } from './camera.mjs';
import { nativeZoom } from './screen-layout.mjs';

const HALF = 2;

/** The camera at rest: the whole picture. */
export const WHOLE = Object.freeze({ x: 0, y: 0, zoom: 1 });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The region a step stop frames: `box` grown to at least `share` of the picture's width (and `heightShare` of its height,
 * `share` too when not given; a box already larger stays as it is), centred on the box and clamped inside `image`
 * ([x, y, w, h]).
 */
export function contextRegion([ix, iy, iw, ih], [bx, by, bw, bh], share, heightShare = share) {
  const w = Math.min(iw, Math.max(bw, share * iw)), h = Math.min(ih, Math.max(bh, heightShare * ih));
  return [clamp(bx + bw / HALF - w / HALF, ix, ix + iw - w), clamp(by + bh / HALF - h / HALF, iy, iy + ih - h), w, h];
}

/** The zoom at which `region` fits the canvas inside `pad` px on every side (not capped). */
export const fitZoom = ([, , w, h], canvas, pad) => Math.min((canvas.w - HALF * pad) / w, (canvas.h - HALF * pad) / h);

// A depth-0 point p lands at c + (p - c) zoom - pan. The pan along one axis that keeps the span [from, from + length] over
// the frame (`margin` past each edge), else (a span smaller than the frame) centres it. A frame edge that would fall within
// `snap` of the span's length of the span's edge is moved onto it: a page holds its own margin there, and an edge in it
// would slice what stands just inside.
function coverAxis(pan, zoom, [from, length], size, margin, snap) {
  const c = size / HALF;
  const least = c + (from - c) * zoom + margin, most = c + (from + length - c) * zoom - size - margin;
  if (least > most) return (from + length / HALF - c) * zoom;
  const kept = clamp(pan, least, most);
  const reach = snap * length * zoom;
  if (kept - least < reach && kept - least <= most - kept) return least;
  return most - kept < reach ? most : kept;
}

/**
 * `pan` ({ x, y }) moved as little as it takes that no ground shows beside `image` ([x, y, w, h]) at `zoom`; `margin` px more
 * across (the resting drift's reach), and a picture that does not fill the frame is centred. An edge within `snap` (a share of
 * the picture, 0 for none) of the picture's own edge snaps onto it.
 */
export const clampPan = (pan, zoom, image, canvas, margin, snap = 0) => ({
  x: coverAxis(pan.x, zoom, [image[0], image[2]], canvas.w, margin, snap),
  y: coverAxis(pan.y, zoom, [image[1], image[3]], canvas.h, 0, snap),
});

// The pan along one axis that leaves the span [near, far] inside the pad (centred when it cannot fit).
function keepAxis(pan, zoom, [near, far], size, pad) {
  const c = size / HALF;
  const most = c + (near - c) * zoom - pad, least = c + (far - c) * zoom - size + pad;
  return least > most ? (least + most) / HALF : clamp(pan, least, most);
}

// The pose that puts the point (cx, cy) of the picture on the frame's centre at `zoom`, with the drift taken off the pan.
function centred(ctx, [cx, cy], zoom, { at, snap }) {
  const { canvas, look, unit, timing } = ctx;
  const pan = clampPan({ x: (cx - canvas.w / HALF) * zoom, y: (cy - canvas.h / HALF) * zoom }, zoom, ctx.image, canvas, HALF * driftReach(look, unit), snap);
  return { pan, drift: driftAt(look, timing, unit, at) };
}

/**
 * The pose of a step stop on `box`: { x, y, zoom, wanted, cap }. `wanted` is the fit of the context region (`share` of the
 * picture's width, `heightShare` of its height) inside `pad` px, `cap` the take's native zoom and `zoom` the one between 1
 * and the cap; an edge within `snap` of the picture's snaps onto it (clampPan). `geo` is { image, picture }.
 */
export function stepPose(ctx, geo, box, { share, heightShare = share, pad, snap = 0, at }) {
  const region = contextRegion(geo.image, box, share, heightShare);
  const cap = nativeZoom(geo.picture, geo.image);
  const wanted = fitZoom(region, ctx.canvas, pad);
  const zoom = clamp(wanted, 1, Math.max(1, cap));
  const { pan, drift } = centred({ ...ctx, image: geo.image }, [region[0] + region[2] / HALF, region[1] + region[3] / HALF], zoom, { at, snap });
  return { x: pan.x - drift, y: pan.y, zoom, wanted, cap };
}

/**
 * The pose a lift on `box` holds, from the pose `was` the camera is at: the zoom eased down to the lesser of its own, the
 * take's native zoom over the card's `scale` (so the card scales within the take's pixels) and the fit of the card scaled
 * and risen by `rise` px inside `pad`; the card centred and kept whole inside the pad. At or under zoom 1 the camera stays.
 */
export function liftPose(ctx, geo, box, was, { scale, pad, rise, snap = 0, at }) {
  const [bx, by, bw, bh] = box;
  const { canvas } = ctx;
  const cap = nativeZoom(geo.picture, geo.image);
  const fit = Math.min((canvas.w - HALF * pad) / (bw * scale), (canvas.h - HALF * pad) / (bh * scale + rise));
  const zoom = Math.max(1, Math.min(was.zoom, cap / scale, fit));
  if (zoom <= 1) return { x: was.x, y: was.y, zoom: was.zoom }; // no room to zoom: the camera stays as it is
  const [cx, cy] = [bx + bw / HALF, by + bh / HALF - rise / HALF];
  const { pan, drift } = centred({ ...ctx, image: geo.image }, [cx, cy], zoom, { at, snap });
  const half = [(bw * scale) / HALF, (bh * scale) / HALF];
  const x = keepAxis(pan.x, zoom, [bx + bw / HALF - half[0], bx + bw / HALF + half[0]], canvas.w, pad);
  const y = keepAxis(pan.y, zoom, [by + bh / HALF - half[1] - rise, by + bh / HALF + half[1]], canvas.h, pad);
  return { x: x - drift, y, zoom };
}
