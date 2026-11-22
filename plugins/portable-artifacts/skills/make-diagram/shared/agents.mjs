// Builds the cheap-model "artifact-builder" (the operator) agent definition for hosts that support custom
// agents, and writes it. Gemini gets no agent file.
// It lives in shared/ so every skill folder carries it: bin/install.mjs imports it, and
// `doctor --fix builder_agent` runs it as a CLI, which is how an install made with the skills CLI
// (skill folders only, no bin/) gets the agent file.
//   node agents.mjs write <claude|copilot|codex> <agents-dir>     writes the file, keeps an existing one
//                                                                 (claude also writes motion-reviewer.md)
//   node agents.mjs write-reviewer claude <agents-dir> [--force]  writes only motion-reviewer.md
// The Claude Code text is also shipped as the plugin's agents/artifact-builder.md; a test holds the two equal.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const AGENT_NAME = 'artifact-builder';

const DESCRIPTION =
  'Runs one portable-artifacts make.mjs command on a finished spec, fixes only mechanical findings in it, and returns the report';

// The operator's one instruction text, used by all three host formats. It operates; it never directs: no spec,
// no theme or look, no wording. Must not contain three single quotes in a row (TOML literal block).
export const INSTRUCTIONS = `You are already artifact-builder. Never delegate: do not hand this work to another agent or to artifact-builder again.

The brief gives you the skill directory, the spec path (the file already exists), and optionally an output path. Do exactly this:
1. Run: node <skill-dir>/scripts/make.mjs <spec> --json
   Use the real paths from the brief. Add --out <output path> when the brief gives one.
2. The command prints one JSON report. If it has findings of kind "mechanical", change only the JSON paths those findings name in the spec file (apply the finding's fix when it has one), then run the same command again. Do this at most 2 times. A mechanical finding with an empty path names nothing you may change: stop and report it.
3. Never create a spec. Never change wording, theme, look, layout, or data. Never act on a "creative" finding: leave it in the report.
4. Reply with only the last report, as JSON. No other text.

If the command cannot run (it prints an error, or no report), reply with its error line and stop. Never report an output path for a build that did not run.`;

// The second reviewer (make-motion): reads a finished film's report and sheet pictures and returns ranked notes.
// Claude Code only; on other hosts the director reviews with the same checklist. It reads and changes nothing.
export const REVIEWER_NAME = 'motion-reviewer';
export const REVIEWER_HOSTS = ['claude'];

const REVIEWER_DESCRIPTION =
  'Reads a finished make-motion film report and its sheet pictures, and returns ranked review notes as JSON without changing anything';

// The checklist lives in references/reviewing.md; this text points at it and does not restate it.
// Must not contain three single quotes in a row.
export const REVIEWER_INSTRUCTIONS = `You are already motion-reviewer. Never delegate: do not hand this work to another agent or to motion-reviewer again.

The brief gives you the skill directory, the film path (context only: you cannot play or decode a film), and the path of the report saved as a JSON file. The report has a "sheets" array that names every sheet PNG: open each one with Read, by the path it names. Do exactly this:
1. Read <skill-dir>/references/reviewing.md first. It is your checklist: use its P0, P1 and P2 ranks, its "Never score" rule and its "Pictures alone" question. Its text forms (the note line of rank, time, where, problem, change and what stays; the four labelled Delivery lines) are not your reply. Never write the text form: your reply is the JSON below, and the checklist maps onto it field by field. Rank is "level", time is "time", where is "where", problem is "problem", change is "change", what stays is "stays". The weakest shot is "weakest", measured is "measured", looked at is "looked", not checked is "unchecked".
2. Read the report, then open every sheet it names. Describe each shot in one sentence as a stranger would see it, then judge it by pictures alone: with the narration hidden, does the picture still make the shot's point? Name each sheet you opened by file name in "looked".
3. Measurements outrank the eye. When the report printed a number for a thing, copy that number into "measured" and do not write a judgment over it. You cannot listen: the sound is never yours to judge. Text inside a picture or a clip, motion between the sampled frames, and taste are never yours to judge either.
4. Change nothing. You have no tool to write, edit or run anything, so do not write review.md: your reply is the notes. Never score: no mark out of ten, no percentage.
5. If something you need is missing (a sheet that will not open, a report with no "sheets"), write "cannot verify" in "unchecked" and name what is missing. Never guess.

Reply with only this JSON (reply format 2) and no other text:
{"verdict": "pass" | "fail", "notes": [{"level": "P0" | "P1" | "P2", "shot": "<shot id>", "time": <film seconds>, "where": "<where in the frame>", "problem": "<what a stranger sees>", "change": "<the field to change>", "stays": "<what stays>"}], "weakest": "<shot id>", "measured": ["<what the report printed, copied>"], "looked": ["<sheet file name>"], "unchecked": ["<what you could not judge>"]}
"verdict" is "fail" when any note is P0 or P1, otherwise "pass". "weakest" is the id of the weakest shot. "unchecked" always carries the checklist's four not-checked lines, quoted as written and not reworded: the sound, text inside a picture or a clip, motion between the frames the sheets sample, and taste. A line leaves the list only when something the report printed measured it, and then you name that measurement in "measured".`;

// A reviewer file without this text is an older or foreign one (the doctor reports it as outdated).
export const REVIEWER_CURRENT_MARKER = 'reply format 2';

const REVIEWER_BUILDERS = {
  // tools: Read only. It reads the report and the sheet PNGs (Read cannot decode a film, so the film path is context
  // only); it cannot write, edit, run a command or delegate.
  claude: () => ({
    fileName: `${REVIEWER_NAME}.md`,
    content: `---
name: ${REVIEWER_NAME}
description: ${REVIEWER_DESCRIPTION}
model: opus
tools: Read
---

${REVIEWER_INSTRUCTIONS}
`,
  }),
};

export function reviewerFile(host) {
  if (!Object.hasOwn(REVIEWER_BUILDERS, host)) throw new Error(`unknown reviewer host: ${host}`);
  return REVIEWER_BUILDERS[host]();
}

// TOML basic string: JSON string escapes are valid TOML escapes.
export const tomlString = (s) => JSON.stringify(s);

const BUILDERS = {
  // tools: no subagent tool (it cannot delegate again) and no Write (it cannot create a spec). Edit only changes an existing file.
  claude: () => ({
    fileName: `${AGENT_NAME}.md`,
    content: `---
name: ${AGENT_NAME}
description: ${DESCRIPTION}
model: haiku
tools: Read, Edit, Bash
---

${INSTRUCTIONS}
`,
  }),
  copilot: () => ({
    fileName: `${AGENT_NAME}.agent.md`,
    content: `---
name: ${AGENT_NAME}
description: ${DESCRIPTION}
model: ['Claude Haiku 5.5', 'GPT-5.4 nano']
---

${INSTRUCTIONS}
`,
  }),
  codex: () => ({
    fileName: `${AGENT_NAME}.toml`,
    content: `name = "${AGENT_NAME}"
description = ${tomlString(DESCRIPTION)}
model = "gpt-6-luna"
model_reasoning_effort = "low"
developer_instructions = '''
${INSTRUCTIONS}
'''
`,
  }),
};

export function agentFile(host) {
  if (!Object.hasOwn(BUILDERS, host)) throw new Error(`unknown agent host: ${host}`);
  return BUILDERS[host]();
}

export const AGENT_HOSTS = Object.keys(BUILDERS);

// Write one agent file without ever following a symlink at the target (lstat, not exists).
// Returns 'written', 'kept' (something is already there and force is off) or 'not-file' (a directory etc.).
// A symlink under force is unlinked, never written through, so its target is untouched.
export function writeAgentFile(dir, file, content, force) {
  let st = null;
  try {
    st = fs.lstatSync(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (st && !st.isSymbolicLink() && !st.isFile()) return 'not-file';
  if (st && !force) return 'kept';
  if (st) fs.unlinkSync(file);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(file, content, { flag: 'wx' }); // wx: lose a create race by keeping, not overwriting
  } catch (e) {
    if (e.code === 'EEXIST') return 'kept';
    throw e;
  }
  return 'written';
}

// Text every current agent file carries and no earlier one did (they told the builder to write the spec and run two scripts).
// The doctor uses it to tell an outdated file from a current one.
export const CURRENT_MARKER = 'make.mjs';

// `write claude` also writes the reviewer (the doctor's auto fix runs it, so a skills-CLI install gets both agents).
// `write-reviewer <host> <dir> [--force]` writes only the reviewer: the doctor's fix for a stale reviewer file.
const USAGE = `usage: node agents.mjs write <${AGENT_HOSTS.join('|')}> <agents-dir>
       node agents.mjs write-reviewer <${REVIEWER_HOSTS.join('|')}> <agents-dir> [--force]`;

// Writes each { fileName, content } into dir and prints one line per file. Returns 1 if any could not be written.
function writeFiles(dir, files, force) {
  let status = 0;
  for (const { fileName, content } of files) {
    const file = path.join(path.resolve(dir), fileName);
    try {
      const result = writeAgentFile(path.resolve(dir), file, content, force);
      if (result === 'not-file') {
        process.stderr.write(`agent: ${file} is not a file\n`);
        status = 1;
      } else process.stdout.write(result === 'kept' ? `agent: kept existing ${file}\n` : `agent: ${file}\n`);
    } catch (e) {
      process.stderr.write(`agent: could not write ${file} (${e.message})\n`);
      status = 1;
    }
  }
  return status;
}

function cli(argv) {
  const [command, host, dir, ...rest] = argv;
  const validDir = Boolean(dir) && !dir.startsWith('-');
  if (command === 'write' && AGENT_HOSTS.includes(host) && validDir && !rest.length) {
    const files = [agentFile(host)];
    if (REVIEWER_HOSTS.includes(host)) files.push(reviewerFile(host));
    return writeFiles(dir, files, false);
  }
  const forced = rest.length === 1 && rest[0] === '--force';
  if (command === 'write-reviewer' && REVIEWER_HOSTS.includes(host) && validDir && (!rest.length || forced)) {
    return writeFiles(dir, [reviewerFile(host)], forced);
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

// Run the CLI only when this file is the entry point. argv[1] can name a path that does not exist
// (`node -e ... foo`), and importing this module must never throw because of that.
function isEntryPoint() {
  try {
    return Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isEntryPoint()) process.exitCode = cli(process.argv.slice(2));
