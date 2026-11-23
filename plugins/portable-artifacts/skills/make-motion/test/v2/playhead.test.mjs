// The preview's playhead as a URL fragment: written before the page reloads on an edit, read when it starts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePlayhead, decodePlayhead } from '../../engine/page/playhead.mjs';

test('a playhead round-trips', () => {
  assert.deepEqual(decodePlayhead(encodePlayhead({ frame: 40, playing: true }), 60), { frame: 40, playing: true });
});

test('the written form is #f=<frame>&p=<0|1>', () => {
  assert.equal(encodePlayhead({ frame: 7, playing: false }), '#f=7&p=0');
  assert.equal(encodePlayhead({ frame: 7, playing: true }), '#f=7&p=1');
});

test('a frame past the end is the last frame; a negative one is 0', () => {
  assert.equal(decodePlayhead('#f=99&p=0', 30).frame, 29);
  assert.equal(decodePlayhead('#f=-4&p=0', 30).frame, 0);
});

test('no fragment, or one that is not a playhead, is null', () => {
  for (const hash of ['', '#', '#top', '#f=abc&p=1', '#f=1.5&p=0']) assert.equal(decodePlayhead(hash, 30), null, hash);
});

test('a fragment with no play flag, or a flag that is not 0 or 1, is null', () => {
  for (const hash of ['#f=3', '#f=3&p=2', '#p=1']) assert.equal(decodePlayhead(hash, 30), null, hash);
});

test('p=1 reads as playing and p=0 as paused', () => {
  assert.equal(decodePlayhead('#f=3&p=1', 30).playing, true);
  assert.equal(decodePlayhead('#f=3&p=0', 30).playing, false);
});
