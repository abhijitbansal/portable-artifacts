import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskText, maskPath } from '../scripts/lib/mask.mjs';

test('maskText masks an email, long numbers and a key', () => {
  assert.equal(maskText('maria.ostrowski@example.test'), '<email>');
  assert.equal(maskText('+44 7700 900123'), '<number>');
  assert.equal(maskText('4111 1111 1111 1111'), '<number>');
  assert.equal(maskText('key_demo_7f3a91c2d85e40b6a1f9'), '<key>');
});

test('maskText masks inside a sentence and leaves short numbers and plain words alone', () => {
  assert.equal(maskText('Mail maria.ostrowski@example.test or call +44 7700 900123'), 'Mail <email> or call <number>');
  assert.equal(maskText('Open 12 tasks in 2026'), 'Open 12 tasks in 2026');
  assert.equal(maskText('Internationalization and localization settings'), 'Internationalization and localization settings');
});

test('maskPath masks id segments and keeps words', () => {
  assert.equal(maskPath('/u/83920114/reset/7f3a91c2d85e40b6a1f9'), '/u/<id>/reset/<id>');
  assert.equal(maskPath('/docs/v2'), '/docs/v2');
  assert.equal(maskPath('/'), '/');
  assert.equal(maskPath('/year/2026'), '/year/2026');
});
