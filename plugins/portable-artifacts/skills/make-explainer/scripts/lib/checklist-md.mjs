// The markdown twin of a spec's checklist sections: the same title, groups, items, tags, steps and expected
// results as GitHub task lists, for a repo that keeps its manual-test list as a .md next to the HTML page
// (build --md). Pure: a spec in, a string out. Anything that is not a checklist section is left out.

const DEFAULT_FAIL = 'Leave the box unticked and note the step, what you saw and what you expected.';

const tagWords = (it) => [...(it.tag === undefined ? [] : [it.tag]), ...(it.tags ?? [])].map((t) => `\`${t}\``);

function item(it) {
  const tags = tagWords(it);
  const head = `- [ ] ${it.text}${tags.length > 0 ? ` ${tags.join(' ')}` : ''}${it.note === undefined ? '' : ` — ${it.note}`}`;
  const steps = (it.steps ?? []).map((s, i) => `  ${i + 1}. ${s}`);
  const expect = it.expect === undefined ? [] : [`  - You should see: ${it.expect}`];
  return [head, ...steps, ...expect].join('\n');
}

function group(g) {
  return [`### ${g.title}`, ...(g.intro === undefined ? [] : [g.intro]), g.items.map(item).join('\n')].join('\n\n');
}

function section(s) {
  const lines = [];
  if (s.title !== undefined) lines.push(`## ${s.title}`);
  if (s.intro !== undefined) lines.push(s.intro);
  lines.push(...s.groups.map(group));
  lines.push(`### If something fails\n\n${s.onFail ?? DEFAULT_FAIL}`);
  return lines.join('\n\n');
}

/** True when the spec has at least one checklist section (the only thing a twin can hold). */
export const hasChecklist = (spec) => (spec.sections ?? []).some((s) => s.type === 'checklist');

/** The twin as markdown text ending in one newline. */
export function checklistMarkdown(spec) {
  const head = [`# ${spec.title}`, ...(spec.subtitle === undefined ? [] : [spec.subtitle])];
  const body = spec.sections.filter((s) => s.type === 'checklist').map(section);
  return `${[...head, ...body].join('\n\n')}\n`;
}

// First line of every twin the build writes (an HTML comment, invisible when rendered). A rebuild may replace a
// .md that starts with it; any other .md was written by someone else and is never overwritten.
const TWIN_MARKER_PREFIX = '<!-- written by make-explainer build --md';
const TWIN_MARKER = `${TWIN_MARKER_PREFIX}; rebuilt on every build, so edit the spec, not this file -->`;

/** What `build --md` writes: the marker line, then the twin. */
export const twinFile = (spec) => `${TWIN_MARKER}\n${checklistMarkdown(spec)}`;

/**
 * Did a build write `existing` (the text of the .md already there)? It carries the marker, or it is a twin from
 * before the marker: its first line is "# <spec title>", the shape checklistMarkdown writes, even if the spec's
 * sections have changed since.
 */
export const isBuildTwin = (existing, spec) =>
  existing.startsWith(TWIN_MARKER_PREFIX) || existing.split(/\r?\n/, 1)[0] === `# ${spec.title}`;
