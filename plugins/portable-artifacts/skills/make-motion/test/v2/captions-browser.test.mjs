// Captions in the render page, with the real fonts: an emphasised caption word at the edge of its zone is never clipped
// (the measured ink, frame by frame, through the caption rules), and both gate films with captions on come back from the
// film review with no finding at all. Run with --test-concurrency=1; skips without a browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { listEntries } from '../../scripts/v2/list.mjs';
import { registries } from '../../engine/registry.mjs';
import '../../engine/looks/index.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { canvasSize } from '../../engine/formats.mjs';
import { reviewFilm, safeRectFor } from '../../scripts/v2/review.mjs';
import { sessionOrNull } from './helpers/session.mjs';

const FPS = 30;
const GATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../references/examples/v2');
const CAPTION_RULES = new Set(['caption-zone', 'caption-hero', 'caption-late', 'caption-clipped']);
const gate = (name, extra = {}) => ({ ...JSON.parse(readFileSync(path.join(GATE_DIR, `${name}.json`), 'utf8')), fps: FPS, ...extra });

async function open(t, film) {
  const session = await sessionOrNull(film, { specDir: GATE_DIR });
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  return session;
}

// Every spoken-caption text on screen in a snapshot (its accumulated opacity above 0).
const captionTexts = (nodes, opacity = 1) => nodes.flatMap((n) => {
  const o = opacity * n.opacity;
  return [...(n.type === 'text' && n.props.caption && o > 0 ? [n] : []), ...captionTexts(n.children, o)];
});

const COMBOS = [['pop', '9:16'], ['pop', '16:9'], ['desk', '16:9'], ['desk', '9:16']].flatMap(([look, format]) => [[look, format, undefined], [look, format, 'It shows its work.']]);
for (const [look, format, own] of COMBOS) {
  test(`${look} at ${format}${own ? ' with the clipping\'s own caption' : ''}: with the real fonts an emphasised caption word at the zone's edge is never clipped and no caption rule fires, on any frame`, async (t) => {
    const say = '*Everything* stays on your machine. Nothing leaves it, *ever*.';
    const shot = { id: 'c', show: 'clipping', src: 'clipping.png', say, ...(own ? { caption: own } : {}) };
    const film = { version: 2, mode: look === 'pop' ? 'viral' : 'pro', look, format, fps: FPS, seed: 3, captions: true, shots: [shot] };
    const session = await open(t, film); if (!session) return;
    const [w, h] = canvasSize(film);
    const canvas = { w, h };
    const lookData = registries.looks.get(look);
    const frames = buildTimeline(film, { fps: FPS }).frameCount;
    let edgeSeen = false;
    for (let f = 0; f < frames; f++) {
      const tree = await session.page.evaluate((i) => window.__snapshot(i), f);
      const ctx = { look: lookData, canvas, safe: safeRectFor(canvas, lookData), mode: film.mode, shotId: 'c', shotIndex: 0, t: f / FPS, isFirstShot: true };
      const found = auditFrame(tree, ctx).filter((x) => CAPTION_RULES.has(x.rule));
      assert.deepEqual(found.map((x) => `frame ${f}: ${x.message}`), []);
      for (const n of captionTexts(tree).filter((x) => x.props.caption.emphasis.includes(0))) {
        const first = n.layout.lines[0];
        const ink = n.lineInk?.[0]?.words?.[0];
        if (look === 'pop' && ink) {
          const left = n.x + first.x + first.words[0].x + ink.left; // a pop caption is a top-level text, upright, at scale 1
          assert.ok(Math.abs(left - n.props.caption.zone[0]) <= 1.5, `frame ${f}: the emphasised first word's measured ink starts on the zone edge (${left} vs ${n.props.caption.zone[0]})`);
        }
        edgeSeen = true;
      }
    }
    assert.ok(edgeSeen, 'an emphasised word at the start of a group was on screen');
    assert.deepEqual(session.errors, []);
  });
}

// The kind examples `--list kinds` prints, with captions on (review-browser runs them without), in both looks and both
// formats: no finding at all, the caption rules among them (the clipping example circles or underlines a region).
const EXAMPLE_COMBOS = [['pro', 'desk', '16:9'], ['pro', 'desk', '9:16'], ['viral', 'pop', '16:9'], ['viral', 'pop', '9:16']];
let exampleDir;
before(() => {
  exampleDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-captions-browser-'));
  mkdirSync(path.join(exampleDir, 'assets'));
  copyFileSync(path.join(GATE_DIR, 'clipping.png'), path.join(exampleDir, 'assets', 'screenshot.png'));
});
after(() => rmSync(exampleDir, { recursive: true, force: true }));

// The composition findings (W2 Task 3) an example gets, by "<kind> <look> <format>", as "<kind> <rule>": the same sparse frames
// review-browser.test.mjs names. The caption zone the layout reserves is left out of what is measured (ctx.captionZone), so
// captions on add none: the timeline and the screen that were flagged only with captions on (their layouts clear the zone)
// have no finding here.
const SPARSE = ['creative dead-space'];
const KNOWN = Object.freeze({
  'free desk 16:9': SPARSE, 'number desk 16:9': SPARSE, 'diagram desk 16:9': SPARSE, 'free desk 9:16': SPARSE,
  'number desk 9:16': SPARSE, 'timeline desk 9:16': SPARSE, 'free pop 16:9': SPARSE, 'diagram pop 16:9': SPARSE,
  'free pop 9:16': SPARSE, 'list pop 9:16': SPARSE,
  'statement desk 16:9': SPARSE, 'list desk 16:9': SPARSE, // left-flush: 36% of the width bare on the right, 36% of the height at the top
  'timeline desk 16:9': SPARSE,
});

for (const [mode, look, format] of EXAMPLE_COMBOS) {
  for (const entry of listEntries('kinds')) {
    test(`the ${entry.name} example with captions on in ${look} at ${format} has only its known review findings`, async (t) => {
      const on = entry.example.on?.map((item) => ({ ...item, do: look === 'pop' ? 'underline' : item.do }));
      const film = { version: 2, mode, look, format, fps: FPS, seed: 3, captions: true, shots: [{ ...entry.example, ...(on ? { on } : {}) }] };
      const session = await sessionOrNull(film, { specDir: exampleDir });
      if (!session) { t.skip('no browser'); return; }
      t.after(() => session.close());
      const findings = await reviewFilm({ session });
      assert.deepEqual(findings.map((f) => `${f.kind} ${f.rule}`), KNOWN[`${entry.name} ${look} ${format}`] ?? [], findings.map((f) => f.message).join('\n'));
      assert.deepEqual(session.errors, []);
    });
  }
}

// The composition findings of the gate films, as "<kind> <rule> <shot>" (frames viewed, .scratch/motion-steals-w2/t3/png-gate-*):
// desk `problem`, `how` and `close` are left-flush statements with the right 35 to 36% bare (they read well filled: edge cases
// of the 0.35 band); pop `hook` and `local` are a three-line block with 39% of the height bare below it (top-heavy, they read sparse).
const GATE_KNOWN = Object.freeze({
  'gate-desk': ['creative dead-space problem', 'creative dead-space how', 'creative dead-space close'],
  'gate-pop': ['creative dead-space hook', 'creative dead-space local'],
});

for (const [name, extra] of [['gate-desk', { captions: true }], ['gate-pop', { captions: true }]]) {
  test(`${name} with captions on has only its known review findings`, async (t) => {
    const film = gate(name, extra);
    const session = await open(t, film); if (!session) return;
    const proof = buildTimeline(film, { fps: FPS }).shots.find((s) => s.id === 'proof');
    const snapshot = await session.page.evaluate((i) => window.__snapshot(i), Math.round((proof.start + 0.3) * FPS));
    assert.ok(captionTexts(snapshot).length > 0, 'the clipping is captioned');
    const findings = await reviewFilm({ session });
    assert.deepEqual(findings.map((f) => `${f.kind} ${f.rule} ${f.shot}`), GATE_KNOWN[name], findings.map((f) => f.message).join('\n'));
    assert.deepEqual(session.errors, []);
  });
}
