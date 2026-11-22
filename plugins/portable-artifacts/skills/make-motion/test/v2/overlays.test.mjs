// The film-level overlays (logo, progress bar): the registry, the look data every look owes for them, the root field's
// validation, the nodes they build and the picture the server lists for the logo. Browser-free: the drawing is
// overlays-browser.test.mjs.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import '../../engine/modes/index.mjs';
import '../../engine/kinds/index.mjs';
import { allLookNames, validateLook } from '../../engine/looks/index.mjs';
import { overlayNodes } from '../../engine/overlays/index.mjs';
import { resolveLook, buildFilm } from '../../engine/graph/film.mjs';
import { measure } from './helpers/kinds.mjs';
import { sampleGraph } from '../../engine/graph/sample.mjs';
import { safeInsets, VIRAL_SAFE_ZONE } from '../../engine/formats.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { unitOf } from '../../engine/units.mjs';
import { compositionRect } from '../../engine/kinds/shared.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { startV2Server } from '../../scripts/v2/server.mjs';
import { pngOf } from './helpers/png.mjs';
import { overlayCoverFindings } from '../../engine/review/overlay.mjs';
import { landedTexts } from '../../engine/review/frame.mjs';
import { dedupeFindings, overlayCoverItems, restingByShot } from '../../scripts/v2/review.mjs';
import { RULES } from '../../engine/review/rules.mjs';
import { CAPPED_HERE } from '../../engine/review/outline.mjs';
import { logoDecodeFinding, logoOnlySrc } from '../../scripts/v2/logo-finding.mjs';

const SHOT ={ id: 'a', show: 'statement', say: 'One short line.' };
const FPS = 30;
const WIDE = { w: 1920, h: 1080 };
const TALL = { w: 1080, h: 1920 };
const LOGO = { width: 200, height: 100 };

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-overlays-'));
  mkdirSync(path.join(specDir, 'assets'));
  writeFileSync(path.join(specDir, 'assets', 'logo.png'), pngOf(4, 2, () => [200, 30, 30]));
});
after(() => rmSync(specDir, { recursive: true, force: true }));

const filmWith = (extra) => ({ version: 2, shots: [SHOT], ...extra });
function argsFor(extra, canvas = WIDE, more = {}) {
  const film = filmWith(extra);
  const timeline = buildTimeline(film, { fps: FPS });
  return { film, look: resolveLook(film), canvas, timeline, assets: new Map([['assets/logo.png', LOGO]]), ...more };
}

test('the two overlays are registered, each with a summary', () => {
  assert.deepEqual(registries.overlays.names(), ['logo', 'progress']);
  for (const name of registries.overlays.names()) assert.equal(typeof registries.overlays.get(name).summary, 'string', name);
});

test('every shipped and experimental look names both overlays, an object or null', () => {
  for (const name of allLookNames()) {
    for (const overlay of registries.overlays.names()) assert.ok(Object.hasOwn(registries.looks.get(name).overlays, overlay), `${name}.${overlay}`);
  }
});

test('marker draws no progress bar: it draws every stroke by hand', () => {
  assert.equal(registries.looks.get('marker').overlays.progress, null);
  assert.notEqual(registries.looks.get('marker').overlays.logo, null);
});

test('a look that leaves an overlay out fails validateLook naming it', () => {
  assert.throws(() => validateLook({ ...registries.looks.get('desk'), overlays: { logo: null } }), /look "desk": overlays\.progress must be an object or null/);
});

test('a look with no overlays field fails validateLook, and a malformed entry names its field', () => {
  const { overlays, ...bare } = registries.looks.get('desk');
  assert.ok(overlays, 'desk has overlays');
  assert.throws(() => validateLook(bare), /look "desk": overlays must be an object/);
  const logo = { ...overlays.logo, corner: 'middle' };
  assert.throws(() => validateLook({ ...registries.looks.get('desk'), overlays: { ...overlays, logo } }), /look "desk": overlays\.logo\.corner/);
  const progress = { ...overlays.progress, bar: 'nope' };
  assert.throws(() => validateLook({ ...registries.looks.get('desk'), overlays: { ...overlays, progress } }), /look "desk": overlays\.progress\.bar/);
});

test('a film asking for an overlay its look refuses is invalid, naming the looks that draw it', () => {
  const { errors } = validateFilm({ version: 2, look: 'marker', overlays: { progress: true }, shots: [SHOT] }, { specDir });
  assert.equal(errors[0].path, 'overlays.progress');
  assert.match(errors[0].message, /look "marker" does not draw the progress overlay; the looks that do: desk, pop, cosmos, ledger, poster, keynote/);
});

test('a logo outside the film folder, and an unknown overlay, are errors with a path', () => {
  assert.equal(validateFilm({ version: 2, overlays: { logo: { src: '../x.png' } }, shots: [SHOT] }, { specDir }).errors[0].path, 'overlays.logo.src');
  assert.match(validateFilm({ version: 2, overlays: { progres: true }, shots: [SHOT] }, { specDir }).errors[0].message, /did you mean "progress"/);
});

test('a logo that is missing, not a picture or has a bad corner is an error at its field', () => {
  const at = (overlays) => validateFilm(filmWith({ overlays }), { specDir }).errors.map((e) => e.path);
  assert.deepEqual(at({ logo: { src: 'assets/none.png' } }), ['overlays.logo.src']);
  assert.deepEqual(at({ logo: {} }), ['overlays.logo.src']);
  assert.deepEqual(at({ logo: { src: 'assets/logo.png', corner: 'middle' } }), ['overlays.logo.corner']);
  assert.deepEqual(at({ logo: { src: 'assets/logo.png', size: 3 } }), ['overlays.logo.size']);
  assert.deepEqual(at({ progress: false }), ['overlays.progress']);
  assert.deepEqual(at('yes'), ['overlays']);
});

test('a good overlays field validates, in every corner', () => {
  for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
    const { errors } = validateFilm(filmWith({ overlays: { logo: { src: 'assets/logo.png', corner }, progress: true } }), { specDir });
    assert.deepEqual(errors, [], corner);
  }
});

test('the overlays root field is on the schema list', async () => {
  const { ROOT_FIELDS } = await import('../../scripts/v2/spec.mjs');
  assert.ok(ROOT_FIELDS.includes('overlays'));
});

test('the bar reveals in step with the film', () => {
  const args = argsFor({ overlays: { progress: true } });
  const bar = sampleGraph(overlayNodes(args), args.timeline.duration / 4).find((n) => n.id === 'overlay.progress.bar');
  assert.ok(Math.abs(bar.reveal - 0.25) < 1e-9, String(bar.reveal));
  assert.equal(bar.props.overlay, 'progress');
  const start = sampleGraph(overlayNodes(args), 0).find((n) => n.id === 'overlay.progress.bar');
  const end = sampleGraph(overlayNodes(args), args.timeline.duration).find((n) => n.id === 'overlay.progress.bar');
  assert.equal(start.reveal, 0);
  assert.equal(end.reveal, 1);
});

test('a film with no overlays builds no nodes', () => {
  assert.deepEqual(overlayNodes(argsFor({})), []);
});

test('each overlay builds the nodes it names, each marked with its overlay', () => {
  const nodes = overlayNodes(argsFor({ overlays: { logo: { src: 'assets/logo.png' }, progress: true } }));
  assert.deepEqual(nodes.map((n) => n.id), ['overlay.logo', 'overlay.progress.track', 'overlay.progress.bar']);
  assert.deepEqual(nodes.map((n) => n.props.overlay), ['logo', 'progress', 'progress']);
  assert.equal(nodes[0].type, 'image');
  assert.equal(nodes[0].props.src, 'assets/logo.png');
});

test('the logo keeps its picture\'s proportions and sits in its corner, inside the margin', () => {
  const look = registries.looks.get('desk').overlays.logo;
  const unit = unitOf(WIDE);
  const [top] = overlayNodes(argsFor({ overlays: { logo: { src: 'assets/logo.png', corner: 'top-left' } } }));
  assert.equal(top.props.h, look.height * unit);
  assert.equal(top.props.w, look.height * unit * (LOGO.width / LOGO.height));
  assert.equal(top.props.x, look.margin * unit);
  assert.equal(top.props.y, look.margin * unit);
  assert.equal(top.props.opacity, look.opacity);
  const [far] = overlayNodes(argsFor({ overlays: { logo: { src: 'assets/logo.png', corner: 'bottom-right' } } }));
  assert.equal(far.props.x + far.props.w, WIDE.w - look.margin * unit);
  assert.equal(far.props.y + far.props.h, WIDE.h - look.margin * unit);
});

test('on a short the overlays stay inside the rectangle the look composes in, which is inside the platform sides', () => {
  const insets = safeInsets([TALL.w, TALL.h], VIRAL_SAFE_ZONE);
  const film = { version: 2, mode: 'viral', overlays: { logo: { src: 'assets/logo.png', corner: 'bottom-left' }, progress: true }, shots: [SHOT] };
  const timeline = buildTimeline(film, { fps: FPS });
  const look = resolveLook(film);
  const rect = compositionRect({ canvas: TALL, look, viralInsets: insets, mode: registries.modes.get('viral') });
  assert.equal(rect.safe, true, 'pop composes in the safe zone on 9:16');
  const nodes = overlayNodes({ film, look, canvas: TALL, timeline, assets: new Map([['assets/logo.png', LOGO]]), viralInsets: insets });
  const logo = nodes.find((n) => n.id === 'overlay.logo');
  assert.ok(logo.props.x >= rect.left && logo.props.x + logo.props.w <= rect.left + rect.w, `x ${logo.props.x}`);
  assert.ok(logo.props.y >= rect.top && logo.props.y + logo.props.h <= rect.top + rect.h, `y ${logo.props.y}`);
  assert.ok(logo.props.x >= insets.left && logo.props.x + logo.props.w <= TALL.w - insets.right, 'inside the platform sides');
  const bar = nodes.find((n) => n.id === 'overlay.progress.bar');
  assert.match(bar.props.d, /^M/);
  const ys = [...bar.props.d.matchAll(/[ML]([\d.]+)[ ,]([\d.]+)/g)].map((m) => Number(m[2]));
  assert.ok(Math.min(...ys) >= rect.top && Math.max(...ys) <= rect.top + rect.h, `bar y ${ys}`);
});

test('called with the five brief arguments and no insets, a short still keeps its overlays inside the safe zone', () => {
  const film = { version: 2, mode: 'viral', overlays: { logo: { src: 'assets/logo.png', corner: 'top-left' } }, shots: [SHOT] };
  const timeline = buildTimeline(film, { fps: FPS });
  const [logo] = overlayNodes({ film, look: resolveLook(film), canvas: TALL, timeline, assets: new Map([['assets/logo.png', LOGO]]) });
  const insets = safeInsets([TALL.w, TALL.h], VIRAL_SAFE_ZONE);
  assert.ok(logo.props.x >= insets.left, `x ${logo.props.x} >= ${insets.left}`);
  assert.ok(logo.props.y >= insets.top, `y ${logo.props.y} >= ${insets.top}`);
});

test('a logo with no loaded picture is an error naming its field', () => {
  assert.throws(() => overlayNodes(argsFor({ overlays: { logo: { src: 'assets/logo.png' } } }, WIDE, { assets: new Map() })), /overlays\.logo\.src.*assets\/logo\.png/);
});

test('on a short every look keeps a bottom logo and a bottom bar above the platform interface, and nothing above its top', () => {
  const insets = safeInsets([TALL.w, TALL.h], VIRAL_SAFE_ZONE);
  const viral = allLookNames().filter((name) => registries.looks.get(name).modes.includes('viral'));
  assert.ok(viral.length >= 3, `viral looks: ${viral.join(', ')}`);
  for (const name of viral) {
    const look = resolveLook({ version: 2, mode: 'viral', look: name, shots: [SHOT] });
    for (const corner of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      const asked = { logo: { src: 'assets/logo.png', corner }, ...(look.overlays.progress ? { progress: true } : {}) };
      const film = { version: 2, mode: 'viral', look: name, overlays: asked, shots: [SHOT] };
      const bottomBar = look.overlays.progress ? { ...look, overlays: { ...look.overlays, progress: { ...look.overlays.progress, edge: 'bottom' } } } : look;
      for (const drawn of [look, bottomBar]) {
        const nodes = overlayNodes({ film, look: drawn, canvas: TALL, timeline: buildTimeline(film, { fps: FPS }), assets: new Map([['assets/logo.png', LOGO]]), viralInsets: insets });
        const logo = nodes.find((n) => n.id === 'overlay.logo').props;
        const at = `${name} ${corner} ${drawn === look ? 'as shipped' : 'bar at the bottom'}`;
        assert.ok(logo.y + logo.h <= TALL.h - insets.bottom, `${at}: logo bottom ${logo.y + logo.h} <= ${TALL.h - insets.bottom}`);
        assert.ok(logo.y >= insets.top && logo.x >= insets.left && logo.x + logo.w <= TALL.w - insets.right, `${at}: logo inside the platform sides and top`);
        for (const bar of nodes.filter((n) => n.id.startsWith('overlay.progress'))) {
          const ys = [...bar.props.d.matchAll(/[ML]([\d.]+)[ ,]([\d.]+)/g)].map((m) => Number(m[2]));
          assert.ok(Math.max(...ys) <= TALL.h - insets.bottom && Math.min(...ys) >= insets.top, `${at}: bar y ${ys}`);
        }
      }
    }
  }
});

test('in pro on a 9:16 canvas there is no platform: overlays keep to the composition rectangle, band foot and margins included', () => {
  const insets = safeInsets([TALL.w, TALL.h], VIRAL_SAFE_ZONE);
  const pro = registries.modes.get('pro');
  const unit = unitOf(TALL);
  for (const name of ['poster', 'pop', 'cosmos', 'desk']) {
    const film = { version: 2, mode: 'pro', look: name, overlays: { logo: { src: 'assets/logo.png', corner: 'top-left' } }, shots: [SHOT] };
    const look = resolveLook(film);
    const rect = compositionRect({ canvas: TALL, look, viralInsets: insets, mode: pro });
    const gap = look.overlays.logo.margin * unit;
    const at = (corner) => overlayNodes({ film: { ...film, overlays: { logo: { src: 'assets/logo.png', corner } } }, look, canvas: TALL, timeline: buildTimeline(film, { fps: FPS }), assets: new Map([['assets/logo.png', LOGO]]) })[0].props;
    const topLeft = at('top-left');
    assert.equal(topLeft.x, rect.left + gap, `${name}: x`);
    assert.equal(topLeft.y, rect.top + gap, `${name}: y`);
    const far = at('bottom-right');
    assert.equal(far.y + far.h, rect.top + rect.h - gap, `${name}: the band foot (${rect.top + rect.h}) is kept`);
    assert.equal(far.x + far.w, rect.left + rect.w - gap, `${name}: right`);
  }
  const poster = resolveLook({ version: 2, mode: 'pro', look: 'poster', shots: [SHOT] });
  assert.equal(compositionRect({ canvas: TALL, look: poster, viralInsets: insets, mode: pro }).left, poster.grid.margin * unit, 'poster composes at its margins in pro');
});

test('a picture with no size is an error naming the logo, not an infinite or NaN width', () => {
  for (const bad of [{ width: 200, height: 0 }, { width: 0, height: 100 }, { width: Number.NaN, height: 100 }]) {
    assert.throws(() => overlayNodes(argsFor({ overlays: { logo: { src: 'assets/logo.png' } } }, WIDE, { assets: new Map([['assets/logo.png', bad]]) })), /overlays\.logo\.src.*assets\/logo\.png.*no size/);
  }
});

test('the hand-drawn test look draws no progress bar, as marker does not', async () => {
  const { handLook } = await import('./helpers/hand-look.mjs');
  const name = handLook();
  assert.equal(registries.looks.get(name).overlays.progress, null);
  assert.notEqual(registries.looks.get(name).overlays.logo, null);
  const { errors } = validateFilm({ version: 2, look: name, overlays: { progress: true }, shots: [SHOT] }, { specDir });
  assert.equal(errors[0].path, 'overlays.progress');
});

test('the looks-that-do hint names only the listed looks: an experimental copy is left out', () => {
  const desk = registries.looks.get('desk');
  const copy = 'overlays-hint-copy';
  if (!registries.looks.has(copy)) registries.looks.add(copy, Object.freeze({ ...desk, name: copy, experimental: true }));
  const { errors } = validateFilm({ version: 2, look: 'marker', overlays: { progress: true }, shots: [SHOT] }, { specDir });
  assert.match(errors[0].message, /the looks that do: desk, pop, cosmos, ledger, poster, keynote$/);
});

test('--list looks says which overlays each look draws', () => {
  const entries = Object.fromEntries(listEntries('looks').map((e) => [e.name, e.overlays]));
  assert.deepEqual(entries.desk, { logo: true, progress: true });
  assert.deepEqual(entries.marker, { logo: true, progress: false });
});

// ---- the film: overlayAt, and no overlay node anywhere a cut can reach ----

const THREE_SHOTS = [
  { id: 'one', show: 'statement', say: 'Your charts lie.' },
  { id: 'two', show: 'statement', say: 'No cloud.', cut: { type: 'slide', smear: true } },
  { id: 'three', show: 'statement', say: 'Plain files.', cut: 'crossfade' },
  { id: 'four', show: 'statement', say: 'One page.', cut: 'ripple' },
];
const buildWith = (overlays) => {
  const film = { version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: THREE_SHOTS, ...(overlays ? { overlays } : {}) };
  const timeline = buildTimeline(film, { fps: FPS });
  return buildFilm({ film, timeline, measure, assets: new Map([['assets/logo.png', LOGO]]), canvas: WIDE });
};
const overlayIdsIn = (frame) => {
  const walk = (nodes) => nodes.flatMap((n) => [n.id, ...walk(n.children)]).filter((id) => id.startsWith('overlay.'));
  const states = [frame.sampled, frame.from?.sampled, frame.smear?.whole, frame.smear?.over, ...(frame.smear?.layers ?? [])].filter(Boolean);
  return states.flatMap(walk);
};
const ON = { logo: { src: 'assets/logo.png' }, progress: true };

test('no frame state holds an overlay node: not the shot, not the outgoing shot, not a smear layer', () => {
  const built = buildWith(ON);
  let smeared = 0, composed = 0;
  for (let i = 0; i <= built.frameCount; i++) {
    const frame = built.frameAt(i / FPS);
    smeared += frame.smear ? 1 : 0;
    composed += frame.from ? 1 : 0;
    assert.deepEqual(overlayIdsIn(frame), [], `frame ${i}`);
  }
  assert.ok(smeared > 0 && composed > 0, `the film exercises a smear (${smeared}) and a two-picture cut (${composed})`);
});

test('overlayAt gives the logo and the bar at every film second, and nothing for a film without overlays', () => {
  const built = buildWith(ON);
  assert.deepEqual(built.overlayAt(1).map((n) => n.id), ['overlay.logo', 'overlay.progress.track', 'overlay.progress.bar']);
  assert.deepEqual(buildWith(undefined).overlayAt(1), []);
  assert.deepEqual([built.hasOverlays, buildWith(undefined).hasOverlays], [true, false]);
});

test('overlayAt is sampled at film time with no camera: the bar reveals with the film, the logo does not move', () => {
  const built = buildWith(ON);
  const at = (t) => Object.fromEntries(built.overlayAt(t).map((n) => [n.id, n]));
  assert.ok(Math.abs(at(built.duration / 2)['overlay.progress.bar'].reveal - 0.5) < 1e-9);
  const [a, b] = [at(0.2)['overlay.logo'], at(built.duration - 0.2)['overlay.logo']];
  assert.deepEqual([a.x, a.y, a.scale, a.rotate], [b.x, b.y, b.scale, b.rotate]);
});

test('the logo is one of the pictures the server lists, once, whoever else names it', async (t) => {
  const file = path.join(specDir, 'film.json');
  const body = { version: 2, overlays: { logo: { src: 'assets/logo.png' } }, shots: [{ id: 'p', show: 'media', src: 'assets/logo.png', hold: 2 }, SHOT] };
  writeFileSync(file, JSON.stringify(body));
  const server = await startV2Server(loadFilm(file));
  t.after(() => server.close());
  const payload = await (await fetch(`${server.url}film.json`)).json();
  assert.deepEqual(payload.assets, ['assets/logo.png']);
  assert.equal((await fetch(`${server.url}asset/0`)).status, 200);
  const only = { version: 2, overlays: { logo: { src: 'assets/logo.png' } }, shots: [SHOT] };
  writeFileSync(file, JSON.stringify(only));
  const second = await startV2Server(loadFilm(file));
  t.after(() => second.close());
  assert.deepEqual((await (await fetch(`${second.url}film.json`)).json()).assets, ['assets/logo.png']);
});

// ---- the review: a text that runs under the logo (engine/review/overlay.mjs) ----

const COVER_CTX = { canvas: WIDE, shotId: 'a', shotIndex: 0, t: 0.5 };
const LOGO_BOX = { id: 'overlay.logo', bbox: [1700, 60, 160, 60], props: { overlay: 'logo' } };
const BAR_BOX = { id: 'overlay.progress.bar', bbox: [0, 1074, 1920, 6], props: { overlay: 'progress' } };

test('a landed text under the logo is one creative finding at overlays.logo', () => {
  const [f, ...rest] = overlayCoverFindings([{ id: 'hero', ink: [1600, 40, 300, 120], role: 'hero' }], [LOGO_BOX], COVER_CTX);
  assert.deepEqual(rest, []);
  assert.deepEqual([f.kind, f.rule, f.node, f.path], ['creative', 'overlay-covers', 'hero|overlay.logo', 'overlays.logo']);
  assert.equal(f.message, 'text "hero" in shot "a" runs under the logo; move the logo to another corner (overlays.logo.corner) or shorten the text');
  assert.equal('role' in f, false, 'no role: the path is the logo, whatever field the text is');
});

test('a text clear of the logo, and a text over the progress bar, are not findings', () => {
  assert.deepEqual(overlayCoverFindings([{ id: 'hero', ink: [200, 400, 600, 120], role: 'hero' }], [LOGO_BOX, BAR_BOX], COVER_CTX), [], 'clear of the logo');
  assert.deepEqual(overlayCoverFindings([{ id: 'low', ink: [200, 1060, 600, 20], role: 'caption' }], [LOGO_BOX, BAR_BOX], COVER_CTX), [], 'over the bar only');
  assert.deepEqual(overlayCoverFindings([{ id: 'hero', ink: [1600, 40, 300, 120], role: 'hero' }], [BAR_BOX], COVER_CTX), [], 'a film with no logo');
});

test('a text meets the logo by more than OVERLAP_UNITS both ways, or it is not covered', () => {
  const at = (ink) => overlayCoverFindings([{ id: 't', ink, role: 'hero' }], [LOGO_BOX], COVER_CTX).length;
  assert.equal(at([1600, 60, 104, 60]), 0, 'across by exactly 4 units');
  assert.equal(at([1600, 60, 105, 60]), 1, 'across by 5');
  assert.equal(at([1700, 0, 160, 64]), 0, 'down by exactly 4 units');
  assert.equal(at([1700, 0, 160, 65]), 1, 'down by 5');
  assert.equal(at([1700, 200, 160, 60]), 0, 'below the logo');
});

test('the unit scales with the canvas: a 4 K frame needs 8 pixels', () => {
  const ctx = { ...COVER_CTX, canvas: { w: 3840, h: 2160 } };
  assert.equal(overlayCoverFindings([{ id: 't', ink: [1700 - 6, 60, 12, 60], role: 'hero' }], [LOGO_BOX], ctx).length, 0, '6 px is 3 units');
  assert.equal(overlayCoverFindings([{ id: 't', ink: [1700 - 6, 60, 20, 60], role: 'hero' }], [LOGO_BOX], ctx).length, 1, '14 px is 7 units');
});

// A text as annotate() reports it (the shape review-settle.test.mjs builds): 96 px words 192 px apart, one line.
function textNode({ id = 't', x = 200, y = 400, words = 1 } = {}) {
  const size = 96, width = words * size * 2, height = size * 1.15;
  const line = { x: 0, y: size * 0.9, width, words: Array.from({ length: words }, (_, k) => ({ text: 'word', index: k, x: k * size * 2, width: size * 2 })) };
  return {
    type: 'text', id, depth: 0, props: {}, x, y, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [],
    words: Array.from({ length: words }, () => ({ opacity: 1, x: 0, y: 0, scale: 1 })),
    layout: { size, width, height, overflow: false, lines: [line] }, bbox: [x, y, width, height], spread: 0,
  };
}
const REVIEW_FILM = { version: 2, mode: 'pro', look: 'desk', format: '16:9', fps: 30, overlays: { logo: { src: 'assets/logo.png' } }, shots: [{ id: 'hero', show: 'free', hold: 1 }] };
const REVIEW_TIMELINE = { fps: 30, frameCount: 30, duration: 1, shots: [{ id: 'hero', index: 0, start: 0, end: 1, duration: 1 }] };
const snapshotsOf = (tree, whole = true) => [0, 7, 15, 22, 29].map((frame) => ({ frame, tree: tree(frame), whole }));
const coverItems = (snapshots) => overlayCoverItems(REVIEW_FILM, REVIEW_TIMELINE, restingByShot(REVIEW_TIMELINE, snapshots), snapshots, [LOGO_BOX], []);

test('landedTexts gives the id, the ink and the role of each text at rest, and nothing for one still arriving', () => {
  const ctx = { canvas: WIDE };
  const [one] = landedTexts([textNode({ id: 'hero' })], ctx);
  assert.equal(one.id, 'hero');
  assert.ok(Array.isArray(one.ink) && one.ink.length === 4 && one.ink.every(Number.isFinite));
  assert.ok('role' in one);
  assert.deepEqual(landedTexts([{ ...textNode(), opacity: 0.5 }], ctx), []);
});

test('the review reads a text under the logo on whole frames: one finding for the shot, at overlays.logo, though many frames show it', () => {
  const snapshots = snapshotsOf(() => [textNode({ id: 'hero', x: 1700, y: 60 })]);
  const found = dedupeFindings(coverItems(snapshots));
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].rule, found[0].path, found[0].shot, found[0].kind, found[0].node], ['overlay-covers', 'overlays.logo', 'hero', 'creative', 'hero|overlay.logo']);
  assert.match(found[0].message, /\(at 0\.00 s\)$/);
});

test('a text clear of the logo, and a frame inside a cut window (audited alone), give no finding', () => {
  assert.deepEqual(coverItems(snapshotsOf(() => [textNode({ x: 200, y: 400 })])), []);
  assert.deepEqual(coverItems(snapshotsOf(() => [textNode({ x: 1700, y: 60 })], false)), []);
});

test('overlay-covers is a registered creative rule of the frame stage, capped to two a film', () => {
  const rule = RULES.find((r) => r.id === 'overlay-covers');
  assert.deepEqual([rule.kinds, rule.stage, rule.capped, rule.suggest, rule.evidence], [['creative'], 'frame', true, null, 'unmeasured']);
  assert.ok(CAPPED_HERE.includes('overlay-covers'));
});

// ---- a logo the browser cannot decode: a finding at overlays.logo.src ----

const decodeError = (src, why = 'The source image could not be decoded.') => new Error(`page.evaluate: Error: image "${src}" could not be loaded: ${why}\n    at eval (<anonymous>:1:1)`);

test('logoOnlySrc is the logo\'s src when no shot names the same file, else null', () => {
  const film = { version: 2, overlays: { logo: { src: 'assets/logo.png' } }, shots: [SHOT] };
  assert.equal(logoOnlySrc(film), 'assets/logo.png');
  assert.equal(logoOnlySrc({ version: 2, shots: [SHOT] }), null);
  assert.equal(logoOnlySrc({ ...film, shots: [{ id: 'p', show: 'media', src: 'assets/logo.png', hold: 2 }] }), null, 'a shot names it too: the page reports the shot\'s picture');
  assert.equal(logoOnlySrc({ ...film, shots: [{ id: 'u', show: 'no-such-kind' }, SHOT] }), 'assets/logo.png', 'an unregistered kind names nothing');
});

test('a logo the browser cannot decode is one mechanical finding at overlays.logo.src, naming the file', () => {
  const found = logoDecodeFinding(decodeError('assets/logo.png'), 'assets/logo.png');
  assert.deepEqual([found.kind, found.shot, found.path], ['mechanical', null, 'overlays.logo.src']);
  assert.equal(found.message, 'the picture "assets/logo.png" could not be loaded (The source image could not be decoded); replace it with a PNG, JPEG or WebP picture');
});

test('any other picture, any other error, or no logo, is not the logo\'s', () => {
  assert.equal(logoDecodeFinding(decodeError('assets/other.png'), 'assets/logo.png'), null);
  assert.equal(logoDecodeFinding(new Error('page.evaluate: Target crashed '), 'assets/logo.png'), null);
  assert.equal(logoDecodeFinding(decodeError('assets/logo.png'), null), null);
});
