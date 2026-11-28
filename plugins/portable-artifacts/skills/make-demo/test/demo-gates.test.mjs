// The two checks film.mjs and guide.mjs share: where the file may sit (directly in the demo folder) and when the signed-in notice prints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { besideDemo, outPath, Refused } from '../scripts/lib/demo-out.mjs';
import { isSignedIn } from '../scripts/lib/take-plan.mjs';

test('besideDemo accepts a name directly in the demo folder and refuses a subfolder, naming the fix', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'make-demo-gates-'));
  fs.mkdirSync(path.join(dir, 'sub'));
  assert.doesNotThrow(() => besideDemo(dir, path.join(dir, 'film.json')));
  assert.throws(() => besideDemo(dir, path.join(dir, 'sub', 'film.json')), (e) => e instanceof Refused && e.errors[0].path === 'out' && /not directly in the demo folder/.test(e.message) && /pass --out with a name there/.test(e.message));
  assert.equal(outPath(dir, undefined, path.join(dir, 'film.json')), path.join(dir, 'film.json'));
});

test('the signed-in notice prints when take.json says signedIn or demo.json has a session', () => {
  assert.equal(isSignedIn({ spec: {}, take: { signedIn: false } }), false);
  assert.equal(isSignedIn({ spec: {}, take: { signedIn: true } }), true);
  assert.equal(isSignedIn({ spec: { session: 'work' }, take: { signedIn: false } }), true, 'an edited take.json cannot switch the notice off');
});
