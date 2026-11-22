// The end card's `mark` as a cut origin (motion-steals W2 Task 9, fix round 2). The mark sits on a pinned (fixed) node in a
// desk card, a ledger tag and a product end: the camera's drift and a punch do not move it, so a cut that opens from it
// opens where the node is drawn, not where the camera would carry its box (cuts-origin.test.mjs has the clipping caption).
import test from 'node:test';
import assert from 'node:assert/strict';
import '../../scripts/v2/list.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { buildFilm } from '../../engine/graph/film.mjs';
import { measure, canvasOf, viralOf, IMAGES, FPS, filmOf, expandIn } from './helpers/kinds.mjs';

const centre = ([x, y, w, h]) => [x + w / 2, y + h / 2];
const NEAR = 1e-6;
const close = (got, want, msg) => assert.ok(Math.abs(got[0] - want[0]) < NEAR && Math.abs(got[1] - want[1]) < NEAR, `${msg}: ${got} vs ${want}`);
const END = { id: 'a', show: 'end', say: 'Every number, with its source.', ask: 'Start today', mark: 'make-motion', on: [{ at: 'word:1', do: 'punch', target: 'title' }] };
const NEXT = { id: 'b', show: 'statement', say: 'Next.', cut: { type: 'iris', at: 'mark' } };

// The end shot is the LAST shot of a one-shot film for expandIn, and the first of a two-shot film for the cut; `before`
// are the shots ahead of it (a product end needs a picture shot before it). Returns the origin the cut got and the pinned
// node as laid out and as drawn at the end of the shot.
function markCase(look, before = []) {
  const shots = [...before, END, NEXT];
  const f = filmOf(shots, look, '16:9');
  const timeline = buildTimeline(f, { fps: FPS });
  const canvas = canvasOf('16:9');
  const built = buildFilm({ film: f, timeline, measure, assets: IMAGES, canvas, viralInsets: viralOf(canvas) });
  const endIndex = before.length;
  const origin = built.frameAt(timeline.shots[endIndex + 1].start + 0.05).cut.at;
  const rest = expandIn(filmOf([...before, END], look, '16:9'), endIndex);
  const pinned = rest.nodes.find((n) => n.id === 'a.mark');
  const drawn = built.sampleShot(endIndex, timeline.shots[endIndex].duration).find((n) => n.id === 'a.mark');
  return { origin, rest, pinned, drawn };
}

test('a desk end card: the mark is pinned, and a cut opens from where the card is drawn after the camera has moved', () => {
  const { origin, rest, pinned, drawn } = markCase('desk');
  assert.equal(pinned.props.fixed, true);
  const at = centre(rest.boxes.mark);
  close(origin, [at[0] + drawn.x - pinned.props.x, at[1] + drawn.y - pinned.props.y], 'the mark box moved with its pinned node');
  assert.ok(Math.hypot(origin[0] - at[0], origin[1] - at[1]) < 1, 'a pinned card is not carried by the camera');
});
test('a product end (keynote): the mark is the pinned tag, and a cut opens from where it is drawn', () => {
  const picture = { id: 'p', show: 'screen', src: 'shot.png', say: 'The product, shown once so the end can show it again.' };
  const { origin, rest, pinned, drawn } = markCase('keynote', [picture]);
  assert.equal(pinned.props.fixed, true, 'the product end draws its mark as a pinned tag');
  const at = centre(rest.boxes.mark);
  close(origin, [at[0] + drawn.x - pinned.props.x, at[1] + drawn.y - pinned.props.y], 'the mark box moved with its pinned node');
});
