// Helpers for the arms driver (run-arms.mjs): which case comes next, the ledger of finished cases, what a case is charged,
// what a film contains and why a case failed, then a reader's reply and the pass rule. Pure functions, no I/O. The blind
// packets and the reply files (the folder work) are in arms-packets.mjs.

// A float sum such as 19 + 1 compared with 20 must not drop a case that exactly fits.
const EPSILON = 1e-9;

/** Every (prompt, arm) pair, prompt by prompt; the arm order rotates by one each prompt (A D C, D C A, C A D, ...). */
export function caseOrder(promptIds, arms) {
  return promptIds.flatMap((prompt, i) => arms.map((_, j) => ({ prompt, arm: arms[(i + j) % arms.length] })));
}

/**
 * The finished cases and what they cost, from the text of cases.jsonl. A last line that does not parse is a case the
 * killed driver was writing: dropped. Any other line that is not a case record with a `chargeUsd` throws, naming the line.
 */
export function readLedger(text) {
  const lines = text.split('\n');
  const last = lines.findLastIndex((l) => l.trim() !== '');
  const cases = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      if (i === last) return;
      throw new Error(`cases.jsonl line ${i + 1} is not JSON`);
    }
    const isRecord = rec && typeof rec === 'object' && !Array.isArray(rec) && typeof rec.prompt === 'string' && typeof rec.arm === 'string';
    if (!isRecord) throw new Error(`cases.jsonl line ${i + 1} is not a case record (prompt, arm)`);
    if (!Number.isFinite(rec.chargeUsd)) throw new Error(`cases.jsonl line ${i + 1} has no numeric chargeUsd`);
    cases.push(rec);
  });
  return { cases, spentUsd: cases.reduce((sum, c) => sum + c.chargeUsd, 0) };
}

/** What a finished session cost: the cost its stream reported; a stream with none (a timeout, a crash) is charged the whole budget. */
export function chargeOf(session, budget) {
  const cost = session?.readable ? session.usage?.costUsd : null;
  return Number.isFinite(cost) ? cost : budget;
}

/** A case may start only if the spend so far plus its whole budget still fits under the ceiling. */
export const mayStart = (spentUsd, budget, maxTotal) => spentUsd + budget <= maxTotal + EPSILON;

const isDesignedCut = (cut) => (typeof cut === 'string' ? cut !== 'cut' : typeof cut?.type === 'string' && cut.type !== 'cut');

/**
 * What the author designed into a saved film: `designedCuts` is the shots whose own `cut` is a name other than `cut` or an
 * object whose `type` is not `cut`; `devices` is the `on` events that name a `do`. A look's or the root's cut is not counted.
 * Anything that is not a film counts nothing.
 */
export function filmCounts(spec) {
  const shots = Array.isArray(spec?.shots) ? spec.shots.filter((s) => s && typeof s === 'object') : [];
  const events = shots.flatMap((s) => (Array.isArray(s.on) ? s.on : []));
  return {
    designedCuts: shots.filter((s) => isDesignedCut(s.cut)).length,
    devices: events.filter((e) => typeof e?.do === 'string' && e.do !== '').length,
  };
}

/** Median of numbers (Infinity allowed); an even count is the mean of the two middle values; none is null. */
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Why a case failed, for a reader to print, or null when it did not. A case fails when its budget was reached, it timed out,
 * it wrote no MP4 or the repository's check did not pass (a check that was skipped is not a pass). Computed on read, never stored.
 */
export function failReason(c) {
  if (c.capped) return 'budget reached';
  if (c.timedOut) return 'timed out';
  if (!c.specExists) return 'no spec';
  if (!c.mp4) return 'no MP4';
  if (!c.checkOk) return 'check failed';
  return null;
}

export const isFailed = (c) => failReason(c) !== null;

export const BASELINE = 'A';

// --- A reader's reply -------------------------------------------------------------------------------------------------

const MAX_REPLY_CHARS = 50000;
const MAX_OBJECT_STARTS = 200; // a reply is untrusted: scanning every `{` of a long run of them would be quadratic
const MIN_READERS = 2;

// The index of the `}` that closes the object opened at `start`, or -1. A brace inside a string does not count.
function objectEnd(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}' && (depth -= 1) === 0) {
      return i;
    }
  }
  return -1;
}

// Every JSON object that sits in the text, outermost first, whatever surrounds it (a fence, a sentence, another object).
function* objectsIn(text) {
  let starts = 0;
  for (let i = text.indexOf('{'); i !== -1 && starts < MAX_OBJECT_STARTS; i = text.indexOf('{', i + 1)) {
    starts += 1;
    const end = objectEnd(text, i);
    let parsed;
    try { parsed = end === -1 ? undefined : JSON.parse(text.slice(i, end + 1)); } catch { parsed = undefined; }
    if (parsed !== undefined) yield parsed;
  }
}

// The ranks object when it names exactly `names`, each with a whole rank from 1 to the number of films; else null.
function validRanks(ranks, names) {
  if (!ranks || typeof ranks !== 'object' || Array.isArray(ranks)) return null;
  const keys = Object.keys(ranks);
  if (keys.length !== names.length || !names.every((n) => Object.hasOwn(ranks, n))) return null;
  if (!names.every((n) => Number.isInteger(ranks[n]) && ranks[n] >= 1 && ranks[n] <= names.length)) return null;
  return Object.fromEntries(names.map((n) => [n, ranks[n]]));
}

/**
 * A reader's reply -> `{ ranks: { name: 1..n } }` (1 is best, ties allowed), or null. The reply is the text the reader gave:
 * its JSON may sit in a fenced block or among other words. `names` are the films of that prompt's packet; a name the reply
 * does not cover, or one that is not a film, makes it unusable. Never throws.
 */
export function parseRatings(text, names) {
  if (typeof text !== 'string' || !Array.isArray(names) || names.length === 0) return null;
  for (const object of objectsIn(text.slice(0, MAX_REPLY_CHARS))) {
    const ranks = validRanks(object?.ranks, names);
    if (ranks) return { ranks };
  }
  return null;
}

/**
 * Did the readers rank `name` strictly below A (a larger rank than A's)? true when at least two readers did; null when fewer
 * than two readings cover both films. A tie with A is not worse. `rankings` are parseRatings results (null entries are skipped).
 */
export function worseThanA(rankings, name, aName) {
  const covering = (rankings ?? []).filter((r) => Number.isInteger(r?.ranks?.[name]) && Number.isInteger(r?.ranks?.[aName]));
  if (covering.length < MIN_READERS) return null;
  return covering.filter((r) => r.ranks[name] > r.ranks[aName]).length >= MIN_READERS;
}

// --- The pass rule (spec 5.4), written before the run -----------------------------------------------------------------

const CHALLENGERS = ['D', 'C'];
const MIN_USABLE_PROMPTS = 8;
const MAX_COST_RATIO = 0.8;
const MAX_WORSE_PROMPTS = 2;
const MIN_GAP_TO_D = 0.05;
const NEW_BRIEF = /^film-/;

const nameOf = (names, arm) => Object.keys(names ?? {}).find((n) => names[n] === arm);
const ratio4 = (x) => (Number.isFinite(x) ? String(Number(x.toFixed(4))) : 'unmeasurable (a failed case)');

function ratedWorse(readings, names, arm) {
  const mine = nameOf(names, arm);
  const base = nameOf(names, BASELINE);
  return mine && base ? worseThanA(readings, mine, base) : null;
}

// One challenger's case against A's on one prompt. A failed case is rated worse, with a cost ratio above any limit.
function challengerRow(c, a, readings, names, arm) {
  const reason = failReason(c);
  return {
    costUsd: c.chargeUsd,
    ratio: reason || !(a.chargeUsd > 0) ? Infinity : c.chargeUsd / a.chargeUsd,
    failReason: reason,
    worse: reason ? true : ratedWorse(readings, names, arm),
    designedCuts: c.film?.designedCuts ?? 0,
    devices: c.film?.devices ?? 0,
  };
}

// A prompt is usable when all three arms have a case and A's did not fail; a failed A drops the prompt.
function promptRow(prompt, byArm, readings, names) {
  const a = byArm[BASELINE];
  const missing = [BASELINE, ...CHALLENGERS].filter((arm) => !byArm[arm]);
  const aFailReason = a ? failReason(a) : null;
  const usable = missing.length === 0 && aFailReason === null;
  return {
    prompt, missing, usable, aFailReason, aCostUsd: a?.chargeUsd ?? null,
    a: { designedCuts: a?.film?.designedCuts ?? 0, devices: a?.film?.devices ?? 0 },
    arms: usable ? Object.fromEntries(CHALLENGERS.map((arm) => [arm, challengerRow(byArm[arm], a, readings, names, arm)])) : {},
  };
}

// The four clauses for one arm over the usable prompts. `film` is the medians over the new briefs, null when there is none.
function armSummary(arm, rows) {
  const used = rows.filter((r) => r.usable);
  const mine = used.map((r) => r.arms[arm]);
  const briefs = used.filter((r) => NEW_BRIEF.test(r.prompt));
  const compare = (key) => (briefs.length ? { arm: median(briefs.map((r) => r.arms[arm][key])), a: median(briefs.map((r) => r.a[key])) } : null);
  const ratioMedian = median(mine.map((m) => m.ratio));
  const worseCount = mine.filter((m) => m.worse === true).length;
  const failedCount = mine.filter((m) => m.failReason).length;
  const cuts = compare('designedCuts');
  const devices = compare('devices');
  const checks = {
    ratio: ratioMedian !== null && ratioMedian <= MAX_COST_RATIO + EPSILON,
    worse: worseCount <= MAX_WORSE_PROMPTS,
    noFailed: failedCount === 0,
    film: cuts && devices ? cuts.arm >= cuts.a && devices.arm >= devices.a : null,
  };
  return {
    ratioMedian, worseCount, failedCount, cuts, devices, checks,
    undecided: used.filter((r) => r.arms[arm].worse === null).map((r) => r.prompt),
    pass: checks.ratio && checks.worse && checks.noFailed && checks.film === true,
  };
}

function armReasons(arm, s, rows) {
  const out = [];
  if (!s.checks.ratio) out.push(`${arm}: median cost ratio ${ratio4(s.ratioMedian)} is above ${MAX_COST_RATIO.toFixed(2)}`);
  if (!s.checks.worse) out.push(`${arm}: rated worse than A in ${s.worseCount} prompts, at most ${MAX_WORSE_PROMPTS} allowed`);
  for (const r of rows.filter((x) => x.usable && x.arms[arm].failReason)) out.push(`${arm}: ${r.prompt} failed (${r.arms[arm].failReason}) and A did not`);
  if (s.checks.film === false) {
    if (s.cuts.arm < s.cuts.a) out.push(`${arm}: median designed cuts ${s.cuts.arm} is below A's ${s.cuts.a} over the new briefs`);
    if (s.devices.arm < s.devices.a) out.push(`${arm}: median devices ${s.devices.arm} is below A's ${s.devices.a} over the new briefs`);
  }
  return out;
}

// What stops the verdict from being made at all, as opposed to making it "none".
function blockers(rows, arms, usable) {
  const out = rows.flatMap((r) => r.missing.map((arm) => `${r.prompt} has no case for ${arm}`));
  if (usable < MIN_USABLE_PROMPTS) out.push(`only ${usable} usable prompts, at least ${MIN_USABLE_PROMPTS} are needed`);
  for (const p of new Set(CHALLENGERS.flatMap((arm) => arms[arm].undecided))) out.push(`${p} has no usable rating (fewer than two readers gave a reply that names its films)`);
  if (arms.D.checks.film === null) out.push('no usable new brief (an id starting film-), so the designed cuts and devices cannot be compared');
  return out;
}

// C when it passes and is at least 0.05 below D's median ratio or D fails; D when D passes otherwise; else none.
function choose({ D, C }) {
  if (C.pass && (!D.pass || D.ratioMedian - C.ratioMedian >= MIN_GAP_TO_D - EPSILON)) return 'C';
  return D.pass ? 'D' : 'none';
}

/**
 * The pre-registered pass rule over the finished cases. `ratings` is { prompt: [parseRatings result or null, ...] } (one per reader),
 * `key` is { prompt: { name: arm } }. -> { prompts, usable, arms: { D, C }, decision: 'C'|'D'|'none'|'inconclusive', reasons }.
 * A later record for the same prompt and arm replaces an earlier one. `planned` is the prompt ids the run set out to do: one with
 * no case at all (the ceiling stopped the run before it) is a row with every case missing. Inconclusive: a missing case, fewer than
 * 8 usable prompts, a rating that cannot be decided, or no usable new brief to compare designed cuts on.
 */
export function verdict(cases, ratings = {}, key = {}, { planned = [] } = {}) {
  const byPrompt = new Map(planned.map((p) => [p, {}]));
  for (const c of cases) byPrompt.set(c.prompt, { ...byPrompt.get(c.prompt), [c.arm]: c });
  const own = (table, p) => (Object.hasOwn(table, p) ? table[p] : undefined);
  const prompts = [...byPrompt].map(([p, byArm]) => promptRow(p, byArm, own(ratings, p), own(key, p)));
  const arms = Object.fromEntries(CHALLENGERS.map((arm) => [arm, armSummary(arm, prompts)]));
  const usable = prompts.filter((r) => r.usable).length;
  const why = CHALLENGERS.flatMap((arm) => armReasons(arm, arms[arm], prompts));
  const blocked = blockers(prompts, arms, usable);
  if (blocked.length) return { prompts, usable, arms, decision: 'inconclusive', reasons: [...blocked, ...why] };
  return { prompts, usable, arms, decision: choose(arms), reasons: why };
}

// --- verdict.md -------------------------------------------------------------------------------------------------------

const money = (n) => (Number.isFinite(n) ? n.toFixed(2) : '-');
const worseCell = (w) => (w === true ? 'worse' : w === false ? 'no' : 'undecided');

function challengerCells(x) {
  if (!x) return ['-', '-', '-'];
  return [money(x.costUsd), x.failReason ? `failed: ${x.failReason}` : ratio4(x.ratio), worseCell(x.worse)];
}

function promptLine(r) {
  const note = r.missing.length ? `no case for ${r.missing.join(', ')}` : r.aFailReason ? `A failed: ${r.aFailReason}, prompt dropped` : '';
  return `| ${r.prompt} | ${money(r.aCostUsd)} | ${[...challengerCells(r.arms.D), ...challengerCells(r.arms.C)].join(' | ')} | ${note} |`;
}

const armLine = (arm, s) => `| ${arm} | ${ratio4(s.ratioMedian)} | ${s.worseCount} | ${s.failedCount} | ${s.cuts ? `${s.cuts.arm} (A ${s.cuts.a})` : '-'} | ${s.devices ? `${s.devices.arm} (A ${s.devices.a})` : '-'} | ${s.pass ? 'passes' : 'fails'} |`;

/** The verdict as the markdown that goes in <out>/verdict.md: the decision, every reason, each arm's four numbers, each prompt's numbers. */
export function renderVerdict(v) {
  return [
    `# Verdict: ${v.decision}`,
    '',
    ...(v.reasons.length ? ['Reasons:', '', ...v.reasons.map((r) => `- ${r}`), ''] : []),
    `${v.usable} usable prompts of ${v.prompts.length}. Ten prompts is a small sample: one model, one host, one machine. Costs are USD; a ratio is the arm's cost over A's.`,
    '',
    '| arm | median cost ratio | rated worse | failed | median designed cuts (new briefs) | median devices (new briefs) | rule |',
    '|---|---|---|---|---|---|---|',
    ...CHALLENGERS.map((arm) => armLine(arm, v.arms[arm])),
    '',
    '| prompt | A cost | D cost | D ratio | D vs A | C cost | C ratio | C vs A | note |',
    '|---|---|---|---|---|---|---|---|---|',
    ...v.prompts.map(promptLine),
    '',
  ].join('\n');
}
