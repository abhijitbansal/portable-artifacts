// How a missing sister skill is installed: the one place the command is spelled. The doctor (`--fix <skill>`),
// make-explainer (siblings.mjs, checks.mjs) and make-scene (siblings.mjs) all print or run it.
// The CLI version is pinned. The repository ref is not: `skills add owner/repo` installs the default branch. Checked
// 2026-11-23: the skills@1.7.2 npm readme shows no `repo#ref` syntax (it only points at docs/commands.md for source
// formats, which the npm package does not carry), and this repository has no release tags or releases to pin to
// (`git tag`, `git ls-remote --tags origin`, `gh release list` all empty). Pin it here, in one place, once both exist.
// Node built-ins only, so the doctor can import it before any node_modules exists.
export const SKILLS_CLI = 'skills@1.7.2';
export const SIBLING_REPO = 'abhijitbansal/portable-artifacts';

/** The shell form, for messages: `npx --yes skills@1.7.2 add <repo> --skill a b -y`. */
export const siblingInstallCommand = (names) => `npx --yes ${SKILLS_CLI} add ${SIBLING_REPO} --skill ${names.join(' ')} -y`;
