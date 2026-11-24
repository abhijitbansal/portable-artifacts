// The arms driver as its own process, with a fake `claude` first on PATH: for a test that sends it a real signal.
// argv[2] is JSON: { bin, repo, prompts, argv }.
import path from 'node:path';
import { main } from '../../run-arms.mjs';
import { evalDir } from './arms-drive.mjs';

const { bin, repo, prompts, argv } = JSON.parse(process.argv[2]);
process.env.PATH = `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}`;
process.exitCode = await main(argv, { evalDir, skillsRoot: repo, promptsDir: prompts });
