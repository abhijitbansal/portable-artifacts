// sayLine: one sentence per step, with nothing from the page that make-motion reads as markup. The parser under test's reader is make-motion's own
// parseSay, imported from the sibling skill, so "one sentence" is what make-motion counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sayLine, sayable } from '../scripts/lib/say-line.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { parseSay } = await import(pathToFileURL(path.join(SKILL, '..', 'make-motion', 'engine', 'script', 'say.mjs')).href);

const HOSTILE = [
  'Save. Now? *all* (5) [x]',
  'Done!!! Really?',
  '_aside_ and *bold* text',
  'Wait... (0.5) then go',
  'Read [word](/ipa/) now',
  '…',
  '*',
  '"quoted." (and) {braces}',
  'a.b.c. d?e!',
  'Line one.\nLine two.',
  '‮RTL​. end',
  'x'.repeat(300),
  '(2.5) (0.1)',
  '**bold** __init__ snake_case',
];

const row = (over) => ({ do: 'click', target: { role: 'button', name: 'Save' }, value: null, intent: null, address: null, ...over });
const sentenceCount = (line) => parseSay(line).tokens.filter((t) => t.sentenceEnd).length;
const endsOnce = (line) => {
  const { tokens } = parseSay(line);
  return sentenceCount(line) === 1 && tokens.at(-1).sentenceEnd;
};

test('a name with sentence marks, emphasis marks and a pause gives the plain words', () => {
  assert.equal(sayLine(row({ target: { role: 'button', name: 'Save. Now? *all* (5) [x]' } })), 'Click Save Now all 5 x.');
});

test('each verb gives its sentence', () => {
  const named = { role: 'textbox', name: 'Search' };
  assert.equal(sayLine(row({ do: 'goto', target: null, address: 'https://a.test/walk/' })), 'Open walk.');
  assert.equal(sayLine(row({ do: 'goto', target: null, address: 'https://a.test/' })), 'Open the start page.');
  assert.equal(sayLine(row({ do: 'hover' })), 'Point at Save.');
  assert.equal(sayLine(row({ do: 'type', target: named, value: '42' })), 'Type 42 into Search.');
  assert.equal(sayLine(row({ do: 'select', target: named, value: 'Blue' })), 'Choose Blue in Search.');
  assert.equal(sayLine(row({ do: 'press', target: named, value: 'Control+a' })), 'Press Control a.');
  assert.equal(sayLine(row({ do: 'scroll' })), 'Scroll to Save.');
  assert.equal(sayLine(row({ do: 'scroll', target: null, value: 400 })), 'Scroll down.');
  assert.equal(sayLine(row({ do: 'wait', target: null, value: 2 })), 'Wait a moment.');
  assert.equal(sayLine(row({ do: 'show' })), 'Here is Save.');
  assert.equal(sayLine(row({ do: 'click', target: null, intent: 'open the (*menu*)' })), 'Open the menu.');
});

test('an empty name or a name of marks only says this step', () => {
  assert.equal(sayLine(row({ target: { role: 'button', name: '' } })), 'Click this step.');
  assert.equal(sayLine(row({ target: { role: 'button', name: '*...*' } })), 'Click this step.');
  assert.equal(sayable(null), 'this step');
});

test('a hostile name gives exactly one sentence with no markup, for every verb that names it', () => {
  for (const name of HOSTILE) {
    for (const verb of ['click', 'hover', 'show', 'scroll']) {
      const line = sayLine(row({ do: verb, target: { role: 'button', name } }));
      assert.ok(endsOnce(line), `${verb} ${JSON.stringify(name)} -> ${JSON.stringify(line)}`);
      assert.doesNotMatch(parseSay(line).plain, /[*_([\]]/, line);
      assert.match(line, /^[\p{Lu}\p{N}]/u, `capitalised: ${line}`);
    }
    const typed = sayLine(row({ do: 'type', value: name, target: { role: 'textbox', name } }));
    assert.ok(endsOnce(typed), `type ${JSON.stringify(name)} -> ${JSON.stringify(typed)}`);
    const opened = sayLine(row({ do: 'goto', target: null, address: `https://a.test/${encodeURIComponent(name)}` }));
    assert.ok(endsOnce(opened), `goto ${JSON.stringify(name)} -> ${JSON.stringify(opened)}`);
  }
});

test('sentences joined by a space stay one per step', () => {
  const lines = HOSTILE.map((name) => sayLine(row({ target: { role: 'button', name } })));
  assert.equal(sentenceCount(lines.join(' ')), lines.length);
});

test('a 300-character typed value cuts to 60 characters', () => {
  const line = sayLine(row({ do: 'type', value: 'a'.repeat(300), target: { role: 'textbox', name: 'Search' } }));
  assert.equal(line, `Type ${'a'.repeat(60)} into Search.`);
  const words = sayable('word '.repeat(40));
  assert.ok(words.length <= 60 && words.endsWith('word'), words);
});
