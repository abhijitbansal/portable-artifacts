// What a run of the arms driver set out to do (<out>/plan.json), and what a resume may change of it. A resume that quietly used
// another model, budget, arm or prompt would mix two experiments into one verdict, so it is refused, naming what differs.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const EPSILON = 1e-9;
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** A hash of an arm's SKILL.md and every file under its scripts/ (not node_modules), by path and content. */
export function hashArm(folder) {
  const hash = crypto.createHash('sha256');
  const add = (rel, file) => hash.update(`${rel}\0`).update(fs.readFileSync(file)).update('\0');
  add('SKILL.md', path.join(folder, 'SKILL.md'));
  const scripts = path.join(folder, 'scripts');
  if (fs.existsSync(scripts)) {
    for (const rel of fs.readdirSync(scripts, { recursive: true }).map(String).sort()) {
      const file = path.join(scripts, rel);
      if (!rel.split(path.sep).includes('node_modules') && fs.statSync(file).isFile()) add(`scripts/${rel}`, file);
    }
  }
  return hash.digest('hex');
}

/** The plan as plan.json holds it. `p` is the driver's plan (host, budget, maxTotal, timeoutSec, model, prompts, arms). */
export function planRecord(p, opts) {
  return {
    skill: opts.skill, set: opts.set ?? null, model: p.model ?? null, budget: p.budget, timeoutSec: p.timeoutSec, maxTotal: p.maxTotal,
    host: opts.host, hostHash: sha(JSON.stringify(p.host)),
    arms: [...p.arms.keys()],
    armSources: Object.fromEntries([...p.arms].map(([name, folder]) => [name, { folder, hash: hashArm(folder) }])),
    prompts: p.prompts.map((x) => x.id),
    promptHashes: Object.fromEntries(p.prompts.map((x) => [x.id, sha(JSON.stringify(x))])),
  };
}

const LABELS = { skill: 'skill', set: 'set', model: 'model', budget: 'budget', timeoutSec: 'timeout', host: 'host', hostHash: 'host definition (its hosts.json entry)' };
const show = (v) => (Array.isArray(v) ? v.join(', ') : String(v));

function armChanges(prev, next) {
  if (!Array.isArray(prev.arms)) return [];
  if (show(prev.arms) !== show(next.arms)) return [`arms differ (was ${show(prev.arms)}, now ${show(next.arms)})`];
  return prev.arms.flatMap((name) => {
    const was = prev.armSources?.[name];
    const now = next.armSources[name];
    if (!was) return [];
    if (was.folder !== now.folder) return [`arm ${name} folder differs (was ${was.folder}, now ${now.folder})`];
    return was.hash === now.hash ? [] : [`arm ${name} differs: its SKILL.md or scripts changed since the run began`];
  });
}

// The new list may only extend the old one (a larger --limit); a changed brief or a shorter list is another experiment.
function promptChanges(prev, next) {
  if (!Array.isArray(prev.prompts)) return [];
  if (!prev.prompts.every((id, i) => next.prompts[i] === id)) return [`prompt list differs (was ${show(prev.prompts)}, now ${show(next.prompts)})`];
  const changed = prev.prompts.filter((id) => prev.promptHashes?.[id] !== undefined && prev.promptHashes[id] !== next.promptHashes[id]);
  return changed.length ? [`prompt list differs: the text or expectations of ${changed.join(', ')} changed`] : [];
}

/**
 * What a resume may not change, as messages: an empty list means the resume is the same experiment. `prev` is the plan.json of
 * the run being resumed, `next` the plan of this one. A field `prev` lacks is not checked. A larger --max-total needs
 * `raiseCeiling` (the owner approved a ceiling, and "continue with more" is a new approval); a smaller one is always fine.
 */
export function planChanges(prev, next, { raiseCeiling = false } = {}) {
  const out = Object.keys(LABELS).filter((k) => k in prev && show(prev[k]) !== show(next[k])).map((k) => `${LABELS[k]} differs (was ${show(prev[k])}, now ${show(next[k])})`);
  out.push(...armChanges(prev, next), ...promptChanges(prev, next));
  if (Number.isFinite(prev.maxTotal) && next.maxTotal > prev.maxTotal + EPSILON && !raiseCeiling) {
    out.push(`--max-total ${next.maxTotal} is above the ${prev.maxTotal} this run was planned with: pass --raise-ceiling to allow it`);
  }
  return out;
}
