// The preview's playhead as a URL fragment, `#f=<frame>&p=<0|1>`: the page writes it just before it reloads on an
// edit and reads it when it starts, so the same frame is on screen again. Pure: the caller passes the strings in.
const WHOLE_NUMBER = /^-?\d+$/;

/** The fragment for a frame and a play state. */
export function encodePlayhead({ frame, playing }) {
  return `#f=${frame}&p=${playing ? 1 : 0}`;
}

/** The playhead a fragment holds, its frame held inside the film (0 to frameCount - 1), or null when it holds none. */
export function decodePlayhead(hash, frameCount) {
  const params = new URLSearchParams(String(hash).replace(/^#/, ''));
  const frame = params.get('f');
  const playing = params.get('p');
  if (frame === null || !WHOLE_NUMBER.test(frame)) return null;
  if (playing !== '0' && playing !== '1') return null;
  return { frame: Math.max(0, Math.min(frameCount - 1, Number(frame))), playing: playing === '1' };
}
