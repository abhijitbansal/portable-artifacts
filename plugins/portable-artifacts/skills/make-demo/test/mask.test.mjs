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

test('maskText treats a no-break space and en or em dashes as number separators', () => {
  assert.equal(maskText('4111 1111 1111 1111'), '<number>');
  assert.equal(maskText('4111–1111–1111–1111'), '<number>');
  assert.equal(maskText('4111—1111—1111—1111'), '<number>');
  assert.equal(maskText('Open 12 tasks'), 'Open 12 tasks');
});

test('maskPath masks an email, a session id after ;, a JWT, a card, a long token or "=" key in a segment, per segment', () => {
  assert.equal(maskPath('/users/maria@example.test/inbox'), '/users/<id>/inbox');
  assert.equal(maskPath('/users/maria.ostrowski%40example.test'), '/users/<id>');
  assert.equal(maskPath('/app/home;jsessionid=1A2B3C4D5E6F7A8B9C0D'), '/app/home');
  assert.equal(maskPath('/t/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.s5JXabc123'), '/t/<id>');
  assert.equal(maskPath('/c/4111-1111-1111-1111'), '/c/<id>');
  assert.equal(maskPath('/tel/+447700900123'), '/tel/<id>');
  assert.equal(maskPath('/d/tok_9f8e7d6c5b4a='), '/d/<id>');
  assert.equal(maskPath('/d/abcdefghijklmnopqrst~x'), '/d/<id>');
  assert.equal(maskPath('/x/%E0%A4%A@b.test'), '/x/<id>', 'a malformed escape is left as it is');
});

test('maskPath keeps ordinary words, versions, years and file names', () => {
  assert.equal(maskPath('/docs/v2'), '/docs/v2');
  assert.equal(maskPath('/release-notes-2026'), '/release-notes-2026');
  assert.equal(maskPath('/file.tar.gz'), '/file.tar.gz');
  assert.equal(maskPath('/a/b.c.d'), '/a/b.c.d');
});

test('maskPath masks an id segment', () => {
  assert.equal(maskPath('/u/83920114/reset/7f3a91c2d85e40b6a1f9'), '/u/<id>/reset/<id>');
  assert.equal(maskPath('/docs/v2'), '/docs/v2');
  assert.equal(maskPath('/'), '/');
  assert.equal(maskPath('/year/2026'), '/year/2026');
});
