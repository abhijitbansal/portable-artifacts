// Reads the reviewer's reply out of a Claude Code session stream and checks it has the shape the agent file promises
// (shared/agents.mjs REVIEWER_INSTRUCTIONS). Pure: no model, no file.
import { REVIEWER_NAME } from '../shared/agents.mjs';

const DELEGATING_TOOLS = new Set(['Agent', 'Task']);
const LEVELS = new Set(['P0', 'P1', 'P2']);

// The agent's own name, or the same name behind a plugin prefix (`plugin:motion-reviewer`).
export const isReviewerAgent = (name) => typeof name === 'string' && (name === REVIEWER_NAME || name.endsWith(`:${REVIEWER_NAME}`));

const textOf =(content) => (Array.isArray(content) ? content.map((c) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n') : String(content ?? ''));

function readEvents(text) {
  const events = [];
  for (const line of String(text).split('\n')) {
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object' && typeof e.type === 'string') events.push(e);
    } catch { /* not an event: the transcript is stdout and stderr together */ }
  }
  return events;
}

/**
 * The text the reviewer answered with: the last result of a call to the reviewer agent (what the director received),
 * else the director's own final answer. -> { text, source } with source 'agent' | 'director', or null.
 */
export function replyText(streamText) {
  const events = readEvents(streamText);
  const calls = new Set();
  for (const e of events) {
    if (e.type !== 'assistant') continue;
    for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (b?.type === 'tool_use' && DELEGATING_TOOLS.has(b.name) && isReviewerAgent(b.input?.subagent_type)) calls.add(b.id);
    }
  }
  let agentText = null;
  let directorText = null;
  for (const e of events) {
    if (e.type === 'user') {
      for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
        if (b?.type === 'tool_result' && calls.has(b.tool_use_id)) agentText = textOf(b.content);
      }
    } else if (e.type === 'result' && typeof e.result === 'string') {
      directorText = e.result;
    }
  }
  if (agentText !== null) return { text: agentText, source: 'agent' };
  if (directorText !== null) return { text: directorText, source: 'director' };
  return null;
}

// The JSON object inside a reply: the whole text, or the span from the first { to the last } (a fenced block, or a
// sentence the reply should not have had).
function jsonIn(text) {
  const tries = [text.trim(), text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const t of tries) {
    try {
      const o = JSON.parse(t);
      if (o && typeof o === 'object' && !Array.isArray(o)) return o;
    } catch { /* next */ }
  }
  return null;
}

/** -> { ok: true, reply } for a reply of the agent's shape, else { ok: false, error }. */
export function parseReply(text) {
  const o = jsonIn(String(text ?? ''));
  if (!o) return { ok: false, error: 'the reply is not a JSON object' };
  if (o.verdict !== 'pass' && o.verdict !== 'fail') return { ok: false, error: 'verdict is neither "pass" nor "fail"' };
  if (!Array.isArray(o.notes)) return { ok: false, error: 'notes is not an array' };
  for (const [i, n] of o.notes.entries()) {
    if (!n || !LEVELS.has(n.level) || typeof n.shot !== 'string') return { ok: false, error: `notes[${i}] has no level P0, P1 or P2 and a shot id` };
  }
  return { ok: true, reply: o };
}
