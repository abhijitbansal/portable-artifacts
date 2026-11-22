// A picture the browser cannot decode. The page loads every picture the film names before it draws a frame, and one it cannot
// decode stops it with `image "<src>" could not be loaded: <why>`. The file is the film's, so the run reports a mechanical
// finding (exit 1) at the path that names it (`shots[i].<field>`, `overlays.logo.src`), as a picture that is missing or outside
// the film folder already is. A load the server failed (`HTTP <n>`) is the machine's: the error stays an exit 2.
// A logo with no size (it decoded to nothing) is the page's own `overlays.logo.src: the picture "<src>" has no size ...`
// throw, put at the same path. The page's other `overlays.logo.src: ...` throw (no loaded picture: the asset list and the film
// disagree) is not the file's fault and is not put there.
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import { fieldAt } from '../../engine/assets.mjs';
import { pathJoin } from '../../shared/errors.mjs';
import { machineMessage } from './session.mjs';

const LOGO_PATH = 'overlays.logo.src';
const LOAD_FAILURE = /^image "(.*)" could not be loaded(?:: (.*))?$/;
const SERVER_FAILURE = /^HTTP \d+/;
const LOGO_THROW = new RegExp(`^${LOGO_PATH.replaceAll('.', '\\.')}: (the picture ".*" has no size.*)$`);

/** A src as one file: `./assets/logo.png` and `assets/logo.png` are the same picture. */
export const normalSrc = (src) => path.posix.normalize(src);

// Where each picture the film names is written, as the server lists them (scripts/v2/server.mjs distinctSrcs): shots in order,
// each kind's srcFields in order, then the logo; the first to name a file owns it. Map: normalSrc -> path.
function ownersOf(film) {
  const owners = new Map();
  const own = (src, at) => { if (typeof src === 'string' && !owners.has(normalSrc(src))) owners.set(normalSrc(src), at); };
  (film.shots ?? []).forEach((shot, index) => {
    if (!registries.kinds.has(shot.show)) return;
    for (const field of registries.kinds.get(shot.show).srcFields ?? []) {
      const at = field.split('.').reduce((acc, key) => pathJoin(acc, /^\d+$/.test(key) ? Number(key) : key), `shots[${index}]`);
      const value = fieldAt(shot, field);
      if (Array.isArray(value)) value.forEach((src, k) => own(src, pathJoin(at, k)));
      else own(value, at);
    }
  });
  own(film.overlays?.logo?.src, LOGO_PATH);
  return owners;
}

const finding = (at, message) => ({ kind: 'mechanical', shot: null, path: at, message });

/**
 * The finding an error from the page is, when it says a picture of `film` could not be decoded: { kind: 'mechanical', shot: null,
 * path, message } at the field that names the picture; null for any other error, a load the server failed, a picture the film
 * does not name, or no film.
 * @param {Error} err as the session raised it @param {object | null} film
 */
export function pictureLoadFinding(err, film) {
  if (!film) return null;
  const failure = LOAD_FAILURE.exec(machineMessage(err));
  if (failure === null) return null;
  const [, src, reason = ''] = failure;
  if (SERVER_FAILURE.test(reason)) return null;
  const at = ownersOf(film).get(normalSrc(src));
  if (at === undefined) return null;
  const why = reason.replace(/\.$/, '');
  return finding(at, `the picture "${src}" could not be loaded${why === '' ? '' : ` (${why})`}; replace it with a PNG, JPEG, WebP or GIF picture`);
}

/** The finding for the page's own `overlays.logo.src: the picture "<src>" has no size ...` throw, at that path; else null. */
export function logoThrowFinding(pageMessage) {
  const match = LOGO_THROW.exec(pageMessage);
  return match === null ? null : finding(LOGO_PATH, match[1]);
}
