// scripts/lib/wall.mjs: the wall check, moved out of test/feasibility so shipped code can use it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as wall from '../scripts/lib/wall.mjs';
import * as signals from './feasibility/signals.mjs';

test('signals.mjs re-exports the very functions of wall.mjs', () => {
  assert.equal(signals.wallProbe, wall.wallProbe);
  assert.equal(signals.wallReason, wall.wallReason);
});

test('wallKind drops what the page said: the quoted title, the host and the path', () => {
  assert.equal(wall.wallKind('reads like a bot check or wall: "Maria Ostrowski Verify you are human"'), 'reads like a bot check or wall');
  assert.equal(wall.wallKind('redirected to a sign-in or consent address (/login/83920114)'), 'redirected to a sign-in or consent address');
  assert.equal(wall.wallKind('a challenge frame is on the page (hcaptcha.com)'), 'a challenge frame is on the page');
  assert.equal(wall.wallKind('status 403'), 'status 403');
  assert.equal(wall.wallKind('the page holds no text and no control'), 'the page holds no text and no control');
  assert.equal(wall.wallKind(null), null);
});

test('isConsentNote is true for the half-view consent notice and no other reason', () => {
  const reason = wall.wallReason({ statuses: [200], title: 'Shop', headings: [], probe: { textLength: 5000, sample: '', controls: 9, consentCover: true } });
  assert.equal(wall.isConsentNote(reason), true);
  assert.equal(wall.isConsentNote('status 403'), false);
  assert.equal(wall.isConsentNote(null), false);
});
