// Tests for the `usage` record parseSession adds (eval/session.mjs) and its summary cells (eval/session-columns.mjs):
// what a session cost, how many calls it made, how many pictures it looked at, how many renders and drafts it ran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSession } from '../session.mjs';
import { USAGE_HEADERS, usageCells } from '../session-columns.mjs';
import * as F from './helpers/stream-fixtures.mjs';

const parse = (events) => parseSession(F.lines(events), { specName: 'film.json' });
const bash = (id, command) => F.toolUse({ id, name: 'Bash', input: { command } });
const MAKE_SCRIPT = 'node skills/make-motion/scripts/make.mjs';

test('calls counts distinct message ids, not events', () => {
  const events = [
    F.init(),
    F.toolUse({ id: 'a', name: 'Bash', input: { command: 'ls' }, messageId: 'm1' }),
    F.toolUse({ id: 'b', name: 'Bash', input: { command: 'ls' }, messageId: 'm1' }),
    F.toolUse({ id: 'c', name: 'Bash', input: { command: 'ls' }, messageId: 'm2', parent: 'agent-1' }),
    F.result(),
  ];
  const u = parse(events).usage;
  assert.equal(u.calls, 2, 'a subagent message counts too');
  assert.equal(u.toolUses, 3, 'one per tool_use block');
});

test('tokens and cost come from the result event, subagent models included (the real pilot stream)', () => {
  const text = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'helpers', 'real-stream-pilot-2026-11-18.jsonl'), 'utf8');
  const u = parseSession(text, { specName: 'film.json' }).usage;
  assert.deepEqual(u.input, { fresh: 18, write: 43771, read: 234703 });
  assert.equal(u.output, 3377);
  assert.equal(u.costUsd, 0.39786671);
});

test('the result event sums every model in modelUsage', () => {
  const perModel = F.modelUsage({ 'model-a': { fresh: 1, write: 2, read: 3, output: 4 }, 'model-b': { fresh: 10, write: 20, read: 30, output: 40 } });
  const u = parse([F.init(), F.result({ modelUsage: perModel })]).usage;
  assert.deepEqual(u.input, { fresh: 11, write: 22, read: 33 });
  assert.equal(u.output, 44);
});

test('no modelUsage: tokens are summed once per message id', () => {
  const events = [
    F.init(),
    F.toolUse({ id: 'a', name: 'Bash', input: { command: 'ls' }, messageId: 'm1', usage: F.tokens({ fresh: 1, write: 4, read: 8, output: 5 }) }),
    F.toolUse({ id: 'b', name: 'Bash', input: { command: 'ls' }, messageId: 'm1', usage: F.tokens({ fresh: 1, write: 4, read: 8, output: 5 }) }),
    F.toolUse({ id: 'c', name: 'Bash', input: { command: 'ls' }, messageId: 'm2', usage: F.tokens({ fresh: 2, write: 6, read: 12, output: 7 }) }),
    F.result(),
  ];
  const u = parse(events).usage;
  assert.deepEqual(u.input, { fresh: 3, write: 10, read: 20 });
  assert.equal(u.output, 12);
});

test('a killed stream has no cost', () => {
  const u = parse([F.init(), bash('a', 'ls')]).usage;
  assert.equal(u.costUsd, null);
  assert.equal(u.calls, 1, 'the calls it did make are still counted');
});

test('drafts and renders are told apart', () => {
  const events = [
    F.init(),
    bash('r', `${MAKE_SCRIPT} film.json --json`),
    bash('d1', `${MAKE_SCRIPT} film.json --sheets-only --json`),
    bash('d2', `${MAKE_SCRIPT} film.json --no-render`),
    bash('d3', `${MAKE_SCRIPT} film.json --draft --json`),
    bash('d4', 'node skills/make-motion/scripts/draft.mjs film.json'),
    bash('n1', `${MAKE_SCRIPT} --list kinds`),
    bash('n2', `${MAKE_SCRIPT} film.json --outline`),
    bash('n3', `${MAKE_SCRIPT} film.json --poster 1`),
    bash('n4', `${MAKE_SCRIPT} film.json --compare-looks a`),
    bash('n5', `${MAKE_SCRIPT} film.json --preview`),
    bash('n6', `${MAKE_SCRIPT} film.json --inspect`),
    bash('n7', `${MAKE_SCRIPT} film.json --phonemes`),
    bash('n8', 'cat skills/make-motion/scripts/make.mjs'),
  ];
  const u = parse(events).usage;
  assert.deepEqual([u.renders, u.drafts], [1, 4]);
});

test('pictures counts image Reads only, in any folder', () => {
  const read = (id, file) => F.toolUse({ id, name: 'Read', input: { file_path: file } });
  const events = [
    F.init(),
    read('a', '/work/out/film.sheets/hook.png'),
    read('b', '/work/skills/make-motion/references/look.JPG'),
    read('c', '/work/film.json'),
  ];
  assert.equal(parse(events).usage.pictures, 2);
});

test('an unreadable stream has a usage of nulls, and a readable one shows the columns', () => {
  const u = parseSession('not a stream\n').usage;
  assert.equal(u.costUsd, null);
  assert.equal(u.calls, null);
  assert.equal(u.input, null);
  assert.deepEqual(usageCells(parseSession('not a stream\n')), USAGE_HEADERS.map(() => 'unreadable'));
});

test('usageCells: cost, calls, tools, pictures, renders, drafts, input (the sum of its parts), output; - for a missing cost', () => {
  assert.deepEqual(USAGE_HEADERS, ['cost $', 'calls', 'tools', 'pictures', 'renders', 'drafts', 'input', 'output']);
  const perModel = F.modelUsage({ m: { fresh: 1, write: 2, read: 3, output: 4 } });
  const events = [F.init(), bash('r', `${MAKE_SCRIPT} film.json --json`), F.result({ cost: 0.5, modelUsage: perModel })];
  assert.deepEqual(usageCells(parse(events)), ['0.50', '1', '1', '0', '1', '0', '6', '4']);
  assert.equal(usageCells(parse([F.init(), bash('r', 'ls')]))[0], '-');
});
