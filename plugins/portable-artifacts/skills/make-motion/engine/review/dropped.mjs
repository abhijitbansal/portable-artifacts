// The frame review's "dropped" finding (frame.mjs hierarchyRules): a kind that left a part out says so in props.dropped.
// The kind still gives that part's target a box (the hero's: end-mark.mjs, quote-desk.mjs), so a cut or an `on` event
// aimed at it builds and lands on the hero. The finding says so, naming each spec path that is aimed at a part left out
// and the target it now lands on, so an author who keeps the copy knows what moved. Pure.
import { registries } from '../registry.mjs';

// The target that names a part a kind says it left out, where the two differ.
const TARGET_OF = Object.freeze({ attribution: 'by' });

/**
 * The spec paths aimed at shot `index`'s targets: { fallback, items: [{ target, path }] }. `fallback` is the target the
 * kind's left-out parts land on (its heroTarget), null for a kind with none. The cut of the shot after it, when it opens
 * from a target (`at`), and each of the shot's own `on` events that names one.
 */
export function aimedAtOf(film, index) {
  const shot = film.shots?.[index];
  if (shot === undefined || shot === null) return { fallback: null, items: [] };
  const next = film.shots[index + 1];
  const items = [];
  if (typeof next?.cut?.at === 'string') items.push({ target: next.cut.at, path: `shots[${index + 1}].cut.at` });
  (Array.isArray(shot.on) ? shot.on : []).forEach((event, j) => {
    if (typeof event?.target === 'string') items.push({ target: event.target, path: `shots[${index}].on[${j}].target` });
  });
  return { fallback: registries.kinds.has(shot.show) ? registries.kinds.get(shot.show).heroTarget ?? null : null, items };
}

/** The "dropped" finding's message for a text node whose kind left parts out; `aimed` is aimedAtOf's result (or absent). */
export function droppedMessage(node, minRatio, aimed) {
  const said = `"${node.id}" left out its ${node.props.dropped.join(' and ')}: the frame cannot hold its hero at ${minRatio} times the look's minimum secondary size; shorten the copy to keep it`;
  if (!aimed?.fallback) return said;
  const moved = node.props.dropped.flatMap((part) => {
    const target = TARGET_OF[part] ?? part;
    const paths = aimed.items.filter((item) => item.target === target).map((item) => item.path);
    return paths.length === 0 ? [] : [`${paths.join(' and ')}, aimed at "${target}", ${paths.length === 1 ? 'lands' : 'land'} on "${aimed.fallback}" instead`];
  });
  return moved.length === 0 ? said : `${said}; ${moved.join('; ')}`;
}
