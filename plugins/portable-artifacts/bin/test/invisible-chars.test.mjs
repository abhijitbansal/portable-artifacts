// Guard: no shipped text file holds an invisible or bidirectional control character as a literal (the "Trojan Source"
// pattern, and what code scanners flag as obfuscation). Write such a character as an escape (\u{200F}, \u{E0041}) in code,
// or name it in prose. Three are allowed because real emoji need them: U+200D (zero width joiner) and the variation
// selectors U+FE0E and U+FE0F (VS15 and VS16).
//
// Scope: every .mjs .js .cjs .json .md .html .css .txt file under skills/*/ and shared/, plus agents/ and bin/, and the
// plugin-root README.md, USAGE.md and CHANGELOG.md. The class is the one shared/agent-text.mjs escapes (Cf, Zl, Zp, the
// default-ignorable set, every variation selector), so a Hangul filler or a variation selector smuggled into a file fails.
// Folders
// named test, node_modules or .scratch are skipped: a test may need a literal to prove a scrubber works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN = fileURLToPath(new URL('../../', import.meta.url));
const ROOTS = ['skills', 'shared', 'agents', 'bin'];
const ROOT_FILES = ['README.md', 'USAGE.md', 'CHANGELOG.md'];
const EXTENSIONS = new Set(['.mjs', '.js', '.cjs', '.json', '.md', '.html', '.css', '.txt']);
const SKIP_DIRS = new Set(['node_modules', 'test', '.scratch']);
const ALLOWED = new Set([0x200d, 0xfe0e, 0xfe0f]);

// Cf covers the bidi controls (U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069), zero width space and non-joiner,
// U+2060, U+FEFF and the Tag block (U+E0000-U+E007F); Zl and Zp are U+2028 and U+2029; U+FFFE and U+FFFF are noncharacters; the whole Tag block is listed because its unassigned code points are not Cf.
const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Variation_Selector}\u{FFFE}\u{FFFF}\u{E0000}-\u{E007F}]/u;

export function findInvisible(text) {
  const hits = [];
  text.split('\n').forEach((line, i) => {
    if (!INVISIBLE.test(line)) return;
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      if (INVISIBLE.test(ch) && !ALLOWED.has(cp)) {
        hits.push({ line: i + 1, cp: 'U+' + cp.toString(16).toUpperCase().padStart(4, '0') });
      }
    }
  });
  return hits;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name));
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      yield path.join(dir, entry.name);
    }
  }
}

function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

export function scan(root = PLUGIN) {
  const found = [];
  for (const r of ROOTS) {
    const dir = path.join(root, r);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const buf = fs.readFileSync(file);
      if (isBinary(buf)) continue;
      for (const h of findInvisible(buf.toString('utf8'))) {
        found.push(`${path.relative(root, file)}:${h.line}:${h.cp}`);
      }
    }
  }
  for (const name of ROOT_FILES) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const h of findInvisible(fs.readFileSync(file, 'utf8'))) found.push(`${name}:${h.line}:${h.cp}`);
  }
  return found;
}

test('findInvisible reports line and code point, and allows ZWJ and variation selectors', () => {
  const text = ['ok', 'a\u{200F}b', 'x\u{E0041}y\u{FEFF}', 'm\u{1F468}\u{200D}\u{1F469}\u{FE0F}', 'z\u{2028}'].join('\n');
  assert.deepEqual(findInvisible(text), [
    { line: 2, cp: 'U+200F' },
    { line: 3, cp: 'U+E0041' },
    { line: 3, cp: 'U+FEFF' },
    { line: 5, cp: 'U+2028' },
  ]);
});

test('findInvisible flags every character the guard names', () => {
  const named = [0x061c, 0x200b, 0x200c, 0x200e, 0x200f, 0x2060, 0xfeff, 0x2028, 0x2029, 0xfffe, 0xffff, 0xe0000, 0xe007f, 0x00ad];
  for (const cp of [...named, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
    assert.equal(findInvisible(`a${String.fromCodePoint(cp)}b`).length, 1, `U+${cp.toString(16)}`);
  }
});

test('findInvisible flags the Hangul fillers and variation selectors VS1-VS14 and VS17-VS256, and allows VS15, VS16 and ZWJ', () => {
  for (const cp of [0x115f, 0x1160, 0x3164, 0xffa0, 0x034f, 0xfe00, 0xfe0d, 0xe0100, 0xe01ef]) {
    assert.equal(findInvisible(`a${String.fromCodePoint(cp)}b`).length, 1, `U+${cp.toString(16)}`);
  }
  for (const cp of [0x200d, 0xfe0e, 0xfe0f]) assert.deepEqual(findInvisible(`a${String.fromCodePoint(cp)}b`), [], `U+${cp.toString(16)}`);
});

test('scan reaches the plugin-root README, USAGE and CHANGELOG, and agents/ (guardrail proof on a temp plugin)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'invisible-scan-'));
  try {
    for (const name of ['README.md', 'USAGE.md', 'CHANGELOG.md']) fs.writeFileSync(path.join(root, name), `# ${name}\nhidden\u{200B}text\n`);
    fs.mkdirSync(path.join(root, 'agents'));
    fs.writeFileSync(path.join(root, 'agents', 'a.md'), 'x\u{3164}y\n');
    assert.deepEqual(scan(root).sort(), ['CHANGELOG.md:2:U+200B', 'README.md:2:U+200B', 'USAGE.md:2:U+200B', 'agents/a.md:1:U+3164']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no shipped text file holds a literal invisible or bidi control character', () => {
  assert.deepEqual(scan(), [], 'write each one as an escape; hits are file:line:codepoint');
});
