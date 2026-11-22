// A logo the browser cannot decode. The page loads every picture the film names before it draws a frame, and a picture it
// cannot decode stops it with `image "<src>" could not be loaded: <why>`. For a shot's picture that is trouble with a file
// (exit 2, with a hint). The logo is the film's own field, so when the logo is the only thing that names the file the run
// reports a mechanical finding at `overlays.logo.src` instead (exit 1), as every other fault of that field is.
import { registries } from '../../engine/registry.mjs';
import { srcsOfShot } from '../../engine/assets.mjs';
import { machineMessage } from './session.mjs';

const LOGO_SRC_PATH = 'overlays.logo.src';
const LOAD_FAILURE = /^image "(.*)" could not be loaded(?:: (.*))?$/;

/** The logo's src when no shot names the same file (a shot's picture is the page's to report first), else null. */
export function logoOnlySrc(film) {
  const logo = film.overlays?.logo?.src;
  if (typeof logo !== 'string') return null;
  const shotNames = (film.shots ?? []).filter((shot) => registries.kinds.has(shot.show))
    .some((shot) => srcsOfShot(shot, registries.kinds.get(shot.show).srcFields).includes(logo));
  return shotNames ? null : logo;
}

/**
 * The finding an error from the page is, when it says the logo's picture could not be loaded: { kind: 'mechanical', shot: null,
 * path: 'overlays.logo.src', message }; null for any other error, any other picture, or a film with no logo of its own.
 * @param {Error} err as the session raised it @param {string | null} logoSrc what logoOnlySrc says of the film
 */
export function logoDecodeFinding(err, logoSrc) {
  if (logoSrc === null) return null;
  const failure = LOAD_FAILURE.exec(machineMessage(err));
  if (failure === null || failure[1] !== logoSrc) return null;
  const why = (failure[2] ?? '').replace(/\.$/, '');
  return {
    kind: 'mechanical',
    shot: null,
    path: LOGO_SRC_PATH,
    message: `the picture "${logoSrc}" could not be loaded${why === '' ? '' : ` (${why})`}; replace it with a PNG, JPEG or WebP picture`,
  };
}
