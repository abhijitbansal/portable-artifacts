// The film's overlays on the render page (engine/overlays: a logo, a progress bar). They belong to the film, not to a shot,
// so the page draws them last: onto the composed 2D frame (no cut, a node cut, a smear, a layer cut, a shader cut's
// stand-in), or, for a shader cut the post pass runs, on a clear picture of their own that the post pass lays over the
// transition's result, before bloom, halftone and grain. They are never handed to a cut, so a cut cannot move or fade them.
//
// createOverlayLayer({ built, assets, canvas, frames }) -> { has, onto(ctx, t), picture(t), key(t), made }
//   has: whether the film asks for any (built.hasOverlays). made(): how many pictures of their own this layer has made
//   (0 without a shader cut: window.__overlayCanvases, for tests). key(t): a stable key of the overlays at film second t.
//   The overlays with their boxes are the stage's __snapshotOverlays, not this layer's.
import { stateKey } from '../graph/sample.mjs';
import { drawFrame, resetContext } from './draw.mjs';

export function createOverlayLayer({ built, assets, canvas, frames }) {
  const has = built.hasOverlays;
  let clear = null; // the clear picture a shader cut's overlays are drawn on, made on the first frame that needs it
  let made = 0;
  const drawOnto = (ctx, t) => drawFrame(ctx, built.overlayAt(t), { assets, canvas, time: t, frames });
  return {
    has,
    /** The overlays at film second `t` drawn onto `ctx`, over what it holds. */
    onto: drawOnto,
    /** The overlays at film second `t` alone on a cleared canvas of the frame's size (reused from frame to frame). */
    picture(t) {
      if (clear === null) {
        clear = new OffscreenCanvas(canvas.w, canvas.h);
        made += 1;
      }
      const ctx = clear.getContext('2d');
      resetContext(ctx);
      drawOnto(ctx, t);
      return clear;
    },
    key: (t) => stateKey(built.overlayAt(t)),
    made: () => made,
  };
}
