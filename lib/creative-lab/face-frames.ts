/**
 * Pull the face check's frames out of a clip window with ffmpeg, each with
 * its own timestamp.
 *
 * The picks are source frames counted from the window start (ffmpeg's n
 * after the seek), so a pick past the window's last frame never comes back.
 * A variable-frame-rate phone clip can also hold fewer frames than its
 * average rate says. So the frames that come back are kept with the times
 * ffmpeg reports for them (showinfo pts_time), and a short count is not an
 * error. Zero frames is.
 *
 * No `@/` imports: node --test cannot resolve them.
 */

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Each showinfo frame's pts_time, in output order. */
export function showinfoTimes(stderr: string): number[] {
  const out: number[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    if (!/Parsed_showinfo_\d+/.test(line)) continue;
    const m = /\bn:\s*\d+\b.*\bpts_time:\s*(-?[\d.]+(?:e[-+]?\d+)?)/.exec(line);
    if (m) out.push(Number(m[1]));
  }
  return out;
}

/** Pair the written frames with their reported times. Fewer than asked is fine; none, more, or unpaired is not. */
export function pairFrames(files: readonly string[], times: readonly number[], asked: number): { file: string; t: number }[] {
  if (!files.length) throw new Error(`face check: ffmpeg gave 0 of ${asked} frames`);
  if (files.length > asked) throw new Error(`face check: ffmpeg gave ${files.length} frames for ${asked} picks`);
  if (times.length !== files.length) throw new Error(`face check: ffmpeg reported ${times.length} frame times for ${files.length} frames`);
  return files.map((file, i) => ({ file, t: Math.max(0, times[i]!) }));
}

/** Extract the picked frames, scaled to `side` px on the long side, into `dir`. */
export async function extractFaceFrames(args: {
  ffmpeg: string;
  url: string;
  inS: number;
  outS: number;
  frames: readonly number[];
  dir: string;
  side: number;
  timeoutMs: number;
}): Promise<{ file: string; t: number }[]> {
  if (!args.frames.length) return [];
  const select = args.frames.map((n) => `eq(n,${n})`).join("+");
  const { stderr } = await run(args.ffmpeg, [
    "-y", "-hide_banner", "-nostats", "-loglevel", "info",
    "-ss", String(args.inS),
    "-t", String(Math.max(0, args.outS - args.inS)),
    "-i", args.url,
    // showinfo after select: each kept frame's real time from the seek point.
    // Scaled to `side` on the long side: the detector resizes to that anyway, and full-size 4K PNGs
    // cost ~21 s a frame to write, decode and re-encode (review of #1311) against ~3.5 s at 1080.
    "-vf", `select='${select}',showinfo,scale=${args.side}:${args.side}:force_original_aspect_ratio=decrease`,
    "-fps_mode", "passthrough",
    join(args.dir, "s%04d.png"),
  ], { maxBuffer: 16 * 1024 * 1024, timeout: Math.max(1_000, args.timeoutMs) });
  const files = (await readdir(args.dir)).filter((name) => name.endsWith(".png")).sort();
  return pairFrames(files, showinfoTimes(stderr), args.frames.length);
}
