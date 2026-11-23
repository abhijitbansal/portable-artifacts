// The outgoing picture's cache (engine/page/cut-pictures.mjs), with a stub canvas and a counting drawShot: a frozen outgoing
// shot is drawn once, a live one each time its film second moves, and a frame read with the captions left out is not
// served the picture drawn with them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCutPictures } from '../../engine/page/cut-pictures.mjs';

class StubCanvas {
  getContext() { return { stub: true }; }
}
globalThis.OffscreenCanvas ??= StubCanvas;

const stateAt = (t, shot = 0) => ({ background: '#000', sampled: [], cut: { name: 'crossfade' }, from: { shot, background: '#fff', sampled: [], t } });

function pictures() {
  const drawn = [];
  const cut = createCutPictures({ w: 8, h: 8, drawShot: (_ctx, picture) => drawn.push(picture.t) });
  return { cut, drawn };
}

test('a frozen outgoing shot (the same film second) is drawn once; a new second, or a new shot, draws again', () => {
  const { cut, drawn } = pictures();
  cut.outgoing(stateAt(2));
  cut.outgoing(stateAt(2));
  assert.deepEqual(drawn, [2]);
  cut.outgoing(stateAt(2.1));
  cut.outgoing(stateAt(2.1, 1));
  assert.deepEqual(drawn, [2, 2.1, 2.1]);
});

test('the same shot and second read with the captions left out draws again, and reading it back draws again', () => {
  const { cut, drawn } = pictures();
  cut.outgoing(stateAt(2));
  cut.outgoing(stateAt(2), false);
  cut.outgoing(stateAt(2), false);
  cut.outgoing(stateAt(2), true);
  assert.deepEqual(drawn, [2, 2, 2], 'with, without (kept once), with again');
});
