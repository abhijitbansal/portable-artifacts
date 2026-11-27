// The `walk` kind: a take folder from make-demo played as a film shot. The picture is the take's own frames in the screen
// kind's browser chrome (walk-layout.mjs), retimed so step n plays on sentence n (or its `at`) at real speed with idle
// stretches cut, the last frame holding until the next step starts; an action longer than its words stretches the shot
// (walk-time.mjs). `stops` move the camera to the whole picture or onto a step's box (walk-camera.mjs). The take is read
// in Node (scripts/v2/take.mjs) and arrives as ctx.prepared, so no take path reaches the page. Pure and DOM-free.
// Parked in keynote and desk (look.kinds.walk.experimental) until its look gate passes.
import { registries } from '../registry.mjs';
import { kindData, kindSupportProblems } from '../looks/index.mjs';
import { AnchorError } from '../script/anchors.mjs';
import { FORMATS } from '../formats.mjs';
import { didYouMean } from '../../shared/errors.mjs';
import { fieldNode, onDevices, placeDevices, deviceCamera, NOT_BLANK, assertNoBlanks, unmarked } from './shared.mjs';
import { defaultCamera } from './camera.mjs';
import { STEP_PREFIX } from './walk-camera.mjs';
import { liftsOf, walkSetup, walkLayout } from './walk-layout.mjs';
import { walkReview } from './walk-review.mjs';
import { walkMinSeconds } from './walk-time.mjs';

const KIND = 'walk';
const STEPS_MAX = 40;
const STOPS_MAX = 12;
const LIFTS_MAX = 4;
const TITLE_MAX = 40;
const ID_PATTERN = '^[a-z][a-z0-9-]{0,39}$';
const STOP_PATTERN = `^(whole|${STEP_PREFIX}[a-z][a-z0-9-]{0,39})$`;
const END_FORM = /^end(?:[+-].*)?$/;
const WALK_FRAMES = Object.freeze(['browser', 'window', 'none']);
const WIDE_FRAME = 'walk needs a wide frame (16:9) for now';
const RECORDED = 'walk cannot play in a film narrated by one recording: its shots cannot stretch to their steps; use a made voice, or no voice';

const idOf = (to) => to.slice(STEP_PREFIX.length);

// An anchor of the shot as `at` reads it: its problem at `path`, or none. Without `at` (a voiced film, before its words are
// measured) nothing can be said yet.
function anchorProblem(ref, path, at) {
  if (ref === undefined || typeof at !== 'function') return [];
  try {
    at(ref);
    return [];
  } catch (err) {
    if (!(err instanceof AnchorError)) throw err;
    return [{ path, message: err.message }];
  }
}

// A format whose canvas is not wider than tall (a format the film does not name or the schema refuses is not judged here).
const isNotWide = (format) => {
  const size = FORMATS[format]?.size;
  return size !== undefined && size[0] <= size[1];
};

// The film-level refusals: a canvas that is not wide, and a film narrated by one recording.
const filmProblems = ({ format, recording }) => [
  ...(isNotWide(format) ? [{ path: 'show', message: WIDE_FRAME }] : []),
  ...(recording === true ? [{ path: 'show', message: RECORDED }] : []),
];

// A step's `at` in the `end` form reads the shot's natural length, but the shot stretches to its steps: refused.
const endProblems = (shot) => shot.steps.flatMap((s, i) => (typeof s.at === 'string' && END_FORM.test(s.at)
  ? [{ path: `steps.${i}.at`, message: `"${s.at}" is relative to the shot's end, which stretches to fit the steps; anchor the step to a sentence, a word or a number of seconds` }] : []));

// The steps a stop or a lift may name: the shot's own.
function nameProblems(shot) {
  const ids = shot.steps.map((s) => s.id);
  const unknown = (id, path) => {
    if (ids.includes(id)) return [];
    const hint = didYouMean(id, ids);
    return [{ path, message: `no step "${id}" in this shot${hint ? `; did you mean "${hint}"?` : ''} (steps: ${ids.join(', ')})` }];
  };
  return [
    ...(shot.stops ?? []).flatMap((stop, i) => (stop.to === 'whole' ? [] : unknown(idOf(stop.to), `stops.${i}.to`))),
    ...(shot.lift ?? []).flatMap((l, i) => unknown(l.step, `lift.${i}.step`)),
  ];
}

function anchorProblems(shot, at) {
  return [
    ...shot.steps.flatMap((s, i) => anchorProblem(s.at, `steps.${i}.at`, at)),
    ...(shot.stops ?? []).flatMap((s, i) => anchorProblem(s.at, `stops.${i}.at`, at)),
    ...(shot.lift ?? []).flatMap((l, i) => anchorProblem(l.at, `lift.${i}.at`, at)),
  ];
}

function shotProblems(shot, { look, at, format, recording } = {}) {
  return [...kindSupportProblems(KIND, look), ...filmProblems({ format, recording }), ...endProblems(shot), ...nameProblems(shot), ...anchorProblems(shot, at)];
}

// `walkMinSeconds` with the look's lifts; a shot whose anchors do not parse has no minimum (the validator says so).
function minSeconds(shot, context) {
  try {
    return walkMinSeconds(shot, context, { lifts: liftsOf(shot, context.look) });
  } catch (err) {
    if (err instanceof AnchorError) return undefined;
    throw err;
  }
}

// The expansion: the framed take, the camera stops and the `on` devices on `screen` or `step:<id>`. Cursor and lift nodes
// join `laid.nodes` here.
function expandWalk(shot, ctx) {
  assertNoBlanks(shot, KIND);
  const { look, timing, unit } = ctx;
  const setup = walkSetup(shot, ctx);
  const laid = walkLayout(shot, { ...ctx, data: kindData(look, KIND) }, setup);
  const devices = onDevices(shot, ctx, { boxes: laid.boxes, defaultTarget: 'screen' });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...laid.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...laid.camera, ...deviceCamera(devices)],
    boxes: laid.boxes,
    hero: `${shot.id}.screen`,
    background: look.palette.paper,
  };
}

function walkField(shot, id) {
  if (id === `${shot.id}.title`) return 'title';
  if (id === `${shot.id}.screen.image`) return 'src';
  return undefined;
}

const ANCHOR = {}; // a number or an anchor string: the validator says which forms exist

registries.kinds.add(KIND, {
  summary: 'A take folder from make-demo (the real frames of a scripted walk through a product) played in a browser frame: step n plays on sentence n at real speed, idle stretches cut, the last frame held; stops move the camera onto a step. Experimental.',
  example: {
    // the committed fixture take (references/examples/v2/walk-take): five steps, one sentence each
    id: 'tour', show: KIND, src: 'walk-take', say: 'Open the page. Pick the tab. Type a word. Hover a card. Add it.',
    steps: [{ id: 'open' }, { id: 'tab' }, { id: 'search' }, { id: 'hover' }, { id: 'add' }], stops: [{ to: 'step:search' }, { to: 'whole' }],
  },
  schema: {
    required: ['src', 'steps'],
    properties: {
      src: { type: 'string', minLength: 1 },
      steps: { type: 'array', minItems: 1, maxItems: STEPS_MAX, items: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', pattern: ID_PATTERN }, at: ANCHOR } } },
      frame: { enum: [...WALK_FRAMES] },
      stops: { type: 'array', maxItems: STOPS_MAX, items: { type: 'object', additionalProperties: false, required: ['to'], properties: { to: { type: 'string', pattern: STOP_PATTERN }, at: ANCHOR } } },
      lift: { type: 'array', maxItems: LIFTS_MAX, items: { type: 'object', additionalProperties: false, required: ['step'], properties: { step: { type: 'string', pattern: ID_PATTERN }, at: ANCHOR } } },
      title: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TITLE_MAX },
    },
  },
  srcFields: [], // the take folder is read by scripts/v2/take.mjs, never resolved as a picture
  steeringFields: ['steps', 'frame', 'stops', 'lift'],
  heroTarget: 'screen',
  targets: (shot) => ['screen', ...(shot.steps ?? []).map((s) => `${STEP_PREFIX}${s.id}`)],
  ids: (shot) => [`${shot.id}.screen`],
  nodeField: walkField,
  validate: shotProblems,
  review: walkReview,
  minSeconds,
  expand: (shot, ctx) => expandWalk(unmarked(shot), ctx),
  // a stop's arrival is the `zoom` device event the looks name a sound for; the sound plan does not read the take yet, so no `events`
  eventDevices: Object.freeze(['zoom']),
  lookData: true, // a look ships it only with a kinds.walk entry (engine/looks/index.mjs listedKinds)
  prepared: true,
  numbered: false,
  showsWords: false, // its narration is not its picture: captioned (engine/captions)
});
