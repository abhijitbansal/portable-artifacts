// The one thing a viewer sees of the film's overlays that the frame review can judge: a text that runs under the logo.
// Every other rule reads __snapshot, which holds no overlay (engine/page/stage.mjs), so none of them sees the logo or the bar.
// The progress bar is a thin line on the frame's edge and is not judged. Pure and DOM-free.
import { unitOf } from '../units.mjs';
import { OVERLAP_UNITS, isBox } from './frame.mjs';

const LOGO_PATH = 'overlays.logo';
const LOGO_ID = 'overlay.logo';

// How far two boxes ([x, y, w, h]) meet across and down, as [across, down]; 0 or less where they only touch or do not meet.
function meetsBy(a, b) {
  const across = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
  const down = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  return [across, down];
}

/**
 * One creative finding for each landed text whose ink meets the logo's box by more than OVERLAP_UNITS both ways. The path is
 * the logo (`overlays.logo`), where it is moved, whatever field the text came from, so the finding carries no `role`.
 * @param {{ id: string, ink: number[], role?: string }[]} texts landed texts (frame.mjs landedTexts)
 * @param {{ id: string, bbox: number[], props?: { overlay?: string } }[]} overlays the overlays with their boxes (__snapshotOverlays)
 * @param {{ canvas: { w: number, h: number }, shotId: string }} ctx
 * @returns {{ kind: 'creative', rule: 'overlay-covers', node: string, path: string, message: string }[]}
 */
export function overlayCoverFindings(texts, overlays, ctx) {
  const logo = overlays.find((o) => o.props?.overlay === 'logo' || o.id === LOGO_ID);
  if (!logo || !isBox(logo.bbox)) return [];
  const limit = OVERLAP_UNITS * unitOf(ctx.canvas);
  return texts.filter((t) => isBox(t.ink) && meetsBy(t.ink, logo.bbox).every((by) => by > limit)).map((t) => ({
    kind: 'creative',
    rule: 'overlay-covers',
    node: `${t.id}|${LOGO_ID}`,
    path: LOGO_PATH,
    message: `text "${t.id}" in shot "${ctx.shotId}" runs under the logo; move the logo to another corner (${LOGO_PATH}.corner) or shorten the text`,
  }));
}
