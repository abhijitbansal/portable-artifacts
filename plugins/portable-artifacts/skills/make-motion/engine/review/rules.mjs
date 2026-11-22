// The rule registry: every `rule` a review finding carries comes from this list, and nothing else may. Pure and DOM-free
// (the hand rules run in the page). references/rules.md has one row per rule and test/v2/review-rules.test.mjs holds the
// code that emits rules, this list and that page equal.
//
// Fields: `kinds` the finding kinds the rule emits; `stage` where the review runs it; `capped` whether the report keeps
// only the largest few of the rule's findings a film; `suggest` which fix value a finding of it carries (a later task
// reads it); `summary` one sentence for the rules page; `evidence` where the rule's number comes from, `measured` (a
// table of ours that the rules page names), `convention` (a published standard the page names) or `unmeasured` (the
// number is ours or another project's and nobody here has measured it: a rule moves to `measured` only with its table);
// `ask` the one question a creative rule asks of the frame or the film, null for a rule that is only mechanical.
import { didYouMean } from '../../shared/errors.mjs';

const MECHANICAL = 'mechanical';
const CREATIVE = 'creative';
const BOTH = [MECHANICAL, CREATIVE];

/** One rule. `kinds` is a list; the rest of `extra` overrides the defaults (not capped, no suggest, unmeasured, no ask). */
const rule = (id, kinds, stage, summary, extra = {}) => Object.freeze({
  id, kinds: Object.freeze([...kinds]), stage, capped: false, suggest: null, evidence: 'unmeasured', ask: null, summary, ...extra,
});

/** @type {readonly { id: string, kinds: ('mechanical' | 'creative')[], stage: 'frame' | 'film' | 'outline' | 'hand' | 'poster', capped: boolean, suggest: 'color' | 'minSize' | 'cuts' | null, summary: string, evidence: 'measured' | 'convention' | 'unmeasured', ask: string | null }[]} */
export const RULES = Object.freeze([
  // frame: what one frame of one shot shows
  rule('measure', [MECHANICAL], 'frame', 'An element could not be measured, so the frame cannot be checked.'),
  rule('empty-first-frame', [MECHANICAL], 'frame', 'A shot opens on a frame where only the field is on screen.'),
  rule('contrast', [MECHANICAL], 'frame', 'Text is under 3:1 against what is drawn directly under it.',
    { suggest: 'color', evidence: 'convention' }),
  rule('region-off-frame', [MECHANICAL], 'frame', 'A mark on a region runs past the frame edge in the close-up.'),
  rule('frame-edge', [MECHANICAL], 'frame', 'Text is sliced by the frame edge during a close-up.'),
  rule('overflow', [CREATIVE], 'frame', 'Text does not fit even at the smallest size its kind allows.',
    { ask: 'Is a shorter word or fewer words truer to what this shot says?' }),
  rule('min-size', [MECHANICAL], 'frame', 'Text is under 28 units tall.', { suggest: 'minSize' }),
  rule('safe-area', [MECHANICAL], 'frame', 'Text sits outside the safe area.'),
  rule('overlap', [MECHANICAL], 'frame', 'Two texts overlap by more than 4 units.'),
  rule('word-overlap', [MECHANICAL], 'frame', 'A word overlaps its neighbour by more than 1 unit, as an emphasis pulse grows it.'),
  rule('sizes', [CREATIVE], 'frame', 'More than 3 distinct text sizes are on screen.',
    { ask: 'Which of these sizes does the viewer need to tell apart?' }),
  rule('hero', [CREATIVE], 'frame', 'The hero text is under 3 times the smallest text.',
    { ask: 'Does the eye land on one thing first?' }),
  rule('dropped', [CREATIVE], 'frame', 'A kind left a part out so the hero could keep 3 times the smallest text.',
    { ask: 'Is what was left out something the viewer needs, so the copy should shrink instead?' }),
  rule('highlight-lines', [CREATIVE], 'frame', 'One highlight runs across more than one line.',
    { ask: 'Does the highlight mark one idea, or several?' }),
  rule('card-overlap', BOTH, 'frame', 'Text runs over a card, or a caption runs over a card with no clear place in its band.',
    { ask: 'Should the caption give way, or should the card move?' }),
  rule('covered', [MECHANICAL], 'frame', 'Text is drawn under a picture that covers it.'),
  rule('line-words', [CREATIVE], 'frame', 'A line of text holds more words than its kind allows.',
    { ask: 'Can this line be said in fewer words without losing the point?' }),
  rule('hook-words', [CREATIVE], 'frame', 'The opening statement holds more words than the mode\'s hook allows.',
    { ask: 'Does the first line earn a stranger\'s next second?' }),
  rule('caption-zone', [MECHANICAL], 'frame', 'A caption sits outside its caption zone.'),
  rule('caption-hero', [MECHANICAL], 'frame', 'A caption covers the hero or a picture.'),
  rule('caption-late', [MECHANICAL], 'frame', 'A caption stays on screen more than 0.3 s after its last word ends.'),
  rule('caption-clipped', [MECHANICAL], 'frame', 'An emphasised caption word is clipped by its zone at its peak scale.'),
  rule('caption-covers', [CREATIVE], 'frame', 'A caption covers a marked region or arriving text.',
    { ask: 'Is the thing the caption covers more important than the words?' }),
  // frame, from W2: how a shot fills its frame, on its resting frame
  rule('dead-space', [CREATIVE], 'frame', 'The longest empty band of the safe area reaches 35% of its width or height (40% in desk and ledger).',
    { capped: true, evidence: 'measured', ask: 'Is the empty part of this frame doing a job?' }),
  rule('scale-contrast', [CREATIVE], 'frame', 'The hero leads its neighbours but reaches under 50% of the safe area (45% in ledger).',
    { capped: true, evidence: 'measured', ask: 'Should the hero be the thing the viewer sees first, and is it big enough to be?' }),
  // frame, from W4: the film's overlays (a logo, a progress bar), which no snapshot holds
  rule('overlay-covers', [CREATIVE], 'frame', 'A landed text runs under the logo by more than 4 units both ways.',
    { capped: true, ask: 'Is there a corner of the frame where the logo would not sit under the words?' }),
  // film: what the whole film does
  rule('unsettled', [MECHANICAL], 'film', 'Text never lands within its shot: on every sampled frame it is still arriving or moving.'),
  rule('still', [CREATIVE], 'film', 'The picture holds still for longer than the mode allows.',
    { ask: 'Is the film waiting on something, or is there nothing left to show?' }),
  rule('kind', BOTH, 'film', 'A kind gave advice about its own shot.',
    { ask: 'Does this note change what the shot says, or only how it is laid out?' }),
  rule('cut-window', BOTH, 'film', 'A cut is longer than its shot (mechanical), or takes more than half of it (creative).',
    { ask: 'Is the cut the point of this shot?' }),
  rule('match', [CREATIVE], 'film', 'A match cut carries nothing, as the two shots share no node.',
    { ask: 'Does this cut join two ideas, or only change the picture?' }),
  rule('hook', [MECHANICAL], 'film', 'The first shot of a mode that reads from frame 0 does not show all its text on frame 0.'),
  rule('loop', [CREATIVE], 'film', 'The last frame of a looping film does not match the first.',
    { ask: 'Does the end hand the viewer back to the start?' }),
  // hand: the hand-drawn looks
  rule('stroke-edge', [MECHANICAL], 'hand', 'A stroke is drawn past the frame edge.'),
  rule('hand-speed', [CREATIVE], 'hand', 'The hand has too much to draw in one sentence at its top speed.',
    { ask: 'Which element of this sentence can go?' }),
  rule('hand-covered', [MECHANICAL], 'hand', 'The hand rests over finished text for more than 0.3 s.'),
  rule('hand-edge', [MECHANICAL], 'hand', 'The hand crosses the top or left frame edge.'),
  // outline: the spec alone, before anything is drawn
  rule('cut-variety', [CREATIVE], 'outline', 'More than two thirds of a film\'s cuts are one cut type.',
    { capped: true, suggest: 'cuts', evidence: 'measured', ask: 'Does each cut say something different about how the two shots relate?' }),
  rule('sameness', [CREATIVE], 'outline', 'Three or more shots in a row share one kind, one cut or one move.',
    { capped: true, suggest: 'cuts', evidence: 'measured', ask: 'Would a different kind, cut or move show some of these ideas better?' }),
  // poster: the frame --poster writes, judged as a thumbnail
  rule('poster-read', [CREATIVE], 'poster', 'The largest text on the poster is under 14 px tall on a 180 px thumbnail (84 units).',
    { suggest: 'minSize', ask: 'Does the poster\'s biggest line still read when the poster is a thumbnail?' }),
]);

/** Every rule id, in registry order. */
export const RULE_IDS = Object.freeze(RULES.map((r) => r.id));

/** The keys a finding's `suggest` may hold: the value that fixes the finding (a colour, the size floor and the factor that reaches it, cut types). */
export const SUGGEST_KEYS = Object.freeze(['color', 'minSize', 'factor', 'cuts']);

/** The rule with this id. Throws `unknown rule "<id>"` with a did-you-mean, as engine/registry.mjs does for a name. */
export function ruleOf(id) {
  const found = RULES.find((r) => r.id === id);
  if (found) return found;
  const hint = didYouMean(id, RULE_IDS);
  throw new Error(`unknown rule "${id}"${hint ? `; did you mean "${hint}"?` : ''}`);
}
