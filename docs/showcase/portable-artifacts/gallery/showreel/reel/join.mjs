#!/usr/bin/env node
// Joins the reel's chapter films (each rendered by make-motion) into one MP4, then cuts the
// site's silent loop and poster from it. Needs ffmpeg and ffprobe on PATH (or FFMPEG_PATH /
// FFPROBE_PATH). Usage:
//   node join.mjs --out reel.mp4 [--loop loop.mp4 --loop-from 0 --loop-seconds 12] [--poster p.jpg --poster-at 1.5] a.mp4 b.mp4 ...
// Every chapter must share size, frame rate and audio layout (make-motion's 16:9 output does).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const SEAM_SECONDS = 0.6; // a dip through black between chapters
const LOUDNESS = 'loudnorm=I=-16:TP=-1.5:LRA=11'; // make-motion's pro target
const CRF = '22';
const LOOP_CRF = '30';
const FLAGS = ['--out', '--loop', '--loop-from', '--loop-seconds', '--poster', '--poster-at'];

function parseArgs(argv) {
  const opts = { inputs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { opts.inputs.push(arg); continue; }
    if (!FLAGS.includes(arg)) throw new Error(`unknown flag ${arg}; accepted: ${FLAGS.join(', ')}`);
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    opts[arg.slice(2)] = value;
    i += 1;
  }
  if (!opts.out) throw new Error('--out <file.mp4> is required');
  if (opts.inputs.length < 2) throw new Error('give at least two chapter files');
  for (const file of opts.inputs) if (!existsSync(file)) throw new Error(`not found: ${file}`);
  return opts;
}

function duration(file) {
  const out = execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const seconds = Number(String(out).trim());
  if (!Number.isFinite(seconds) || seconds <= SEAM_SECONDS * 2) throw new Error(`${file}: bad duration ${out}`);
  return seconds;
}

// Chains xfade (picture) and acrossfade (sound) over every seam, so each seam overlaps by SEAM_SECONDS.
function filterGraph(durations) {
  const parts = [];
  let video = '[0:v]';
  let audio = '[0:a]';
  let offset = 0;
  for (let i = 1; i < durations.length; i += 1) {
    offset += durations[i - 1] - SEAM_SECONDS;
    const v = `[v${i}]`;
    const a = `[a${i}]`;
    parts.push(`${video}[${i}:v]xfade=transition=fadeblack:duration=${SEAM_SECONDS}:offset=${offset.toFixed(3)}${v}`);
    parts.push(`${audio}[${i}:a]acrossfade=d=${SEAM_SECONDS}:c1=tri:c2=tri${a}`);
    video = v;
    audio = a;
  }
  parts.push(`${audio}${LOUDNESS},aresample=48000[aout]`);
  return { graph: parts.join(';'), video, total: offset + durations.at(-1) };
}

function run(args) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const durations = opts.inputs.map(duration);
  const { graph, video, total } = filterGraph(durations);
  run([
    ...opts.inputs.flatMap((file) => ['-i', file]),
    '-filter_complex', graph, '-map', video, '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', opts.out,
  ]);
  console.log(`reel: ${opts.out} (${total.toFixed(2)} s, ${opts.inputs.length} chapters)`);
  if (opts.loop) {
    const from = opts['loop-from'] || '0';
    const seconds = opts['loop-seconds'] || '12';
    run(['-ss', from, '-t', seconds, '-i', opts.out, '-an', '-vf', 'scale=1280:-2',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', LOOP_CRF, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', opts.loop]);
    console.log(`loop: ${opts.loop} (${seconds} s from ${from} s, silent, 1280 wide)`);
  }
  if (opts.poster) {
    run(['-ss', opts['poster-at'] || '1', '-i', opts.out, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', opts.poster]);
    console.log(`poster: ${opts.poster}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`join: ${error.message}`);
  process.exit(1);
}
