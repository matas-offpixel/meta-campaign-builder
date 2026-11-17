/**
 * Pull the face check's frames out of a clip window with ffmpeg, each with
 * its own timestamp, so that no gap between checked frames is over
 * FACE_MAX_GAP_S (design, 17 Nov: the 0.5 s run rule must hold).
 *
 *   1. The plan (planFrames) picks source frames counted from the window
 *      start, ffmpeg's n after the seek, with no gap over the limit.
 *   2. The frames that come back keep the times ffmpeg reports for them
 *      (showinfo pts_time). A short return is not an error.
 *   3. If a gap is still over the limit, the source is short or has a
 *      variable frame rate. A scan lists the window's real frame times, a
 *      real frame is added in each such gap, and only those are pulled.
 *   4. Where the source has no frame at all in a stretch over the limit (a
 *      hole), the previous frame is on screen for it. The check finishes and
 *      reports the gap, and the caller logs it.
 *
 * No `@/` imports: node --test cannot resolve them.
 */

import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { FACE_MAX_GAP_S, largestGap, planFrames } from "./face-sampling.ts";

const run = promisify(execFile);
/** pts_time is printed to about 1e-5 s. */
const EPS = 1e-4;

/** Each showinfo frame's n and pts_time, in output order. */
export function showinfoFrames(stderr: string): { n: number; t: number }[] {
  const out: { n: number; t: number }[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    if (!/Parsed_showinfo_\d+/.test(line)) continue;
    const m = /\bn:\s*(\d+)\b.*\bpts_time:\s*(-?[\d.]+(?:e[-+]?\d+)?)/.exec(line);
    if (m) out.push({ n: Number(m[1]), t: Number(m[2]) });
  }
  return out;
}

/** Each showinfo frame's pts_time, in output order. */
export function showinfoTimes(stderr: string): number[] {
  return showinfoFrames(stderr).map((f) => f.t);
}

/** Pair the written frames with their reported times. Fewer than asked (even none) is fine; more, or unpaired, is not. */
export function pairFrames(files: readonly string[], times: readonly number[], asked: number): { file: string; t: number }[] {
  if (files.length > asked) throw new Error(`face check: ffmpeg gave ${files.length} frames for ${asked} picks`);
  if (times.length !== files.length) throw new Error(`face check: ffmpeg reported ${times.length} frame times for ${files.length} frames`);
  return files.map((file, i) => ({ file, t: Math.max(0, times[i]!) }));
}

/**
 * Real frames to add so no gap between `kept` (ascending times), from `startS` and to `endS`, is over `maxGap`.
 * In each long gap, the latest real frame within `maxGap` of the last kept or added one; where there is none
 * (a hole), the first real frame after the hole.
 */
export function fillGaps(
  kept: readonly number[],
  real: readonly { n: number; t: number }[],
  startS: number,
  endS: number,
  maxGap = FACE_MAX_GAP_S,
): { n: number; t: number }[] {
  const add: { n: number; t: number }[] = [];
  let pos = startS;
  for (const next of [...kept, endS]) {
    while (next - pos > maxGap + EPS) {
      const inGap = real.filter((r) => r.t > pos + EPS && r.t < next - EPS);
      if (!inGap.length) break; // a hole up to `next`: nothing to add
      const within = inGap.filter((r) => r.t <= pos + maxGap + EPS);
      const pick = within.length ? within[within.length - 1]! : inGap[0]!;
      add.push(pick);
      pos = pick.t;
    }
    pos = Math.max(pos, next);
  }
  return add;
}

/** Extract frames n ∈ `frames` (after the seek), scaled to `side` px on the long side, as `${prefix}NNNN.png` in `dir`. */
export async function extractFaceFrames(args: {
  ffmpeg: string;
  url: string;
  inS: number;
  outS: number;
  frames: readonly number[];
  dir: string;
  side: number;
  timeoutMs: number;
  prefix?: string;
}): Promise<{ file: string; t: number }[]> {
  if (!args.frames.length) return [];
  const prefix = args.prefix ?? "s";
  const select = args.frames.map((n) => `eq(n,${n})`).join("+");
  const { stderr } = await run(args.ffmpeg, [
    "-y", "-hide_banner", "-nostats", "-loglevel", "info",
    "-ss", String(args.inS),
    "-t", String(Math.max(0, args.outS - args.inS)),
    "-i", args.url,
    "-an",
    // showinfo after select: each kept frame's real time from the seek point.
    // Scaled to `side` on the long side: the detector resizes to that anyway, and full-size 4K PNGs
    // cost ~21 s a frame to write, decode and re-encode (review of #1311) against ~3.5 s at 1080.
    "-vf", `select='${select}',showinfo,scale=${args.side}:${args.side}:force_original_aspect_ratio=decrease`,
    "-fps_mode", "passthrough",
    join(args.dir, `${prefix}%04d.png`),
  ], { maxBuffer: 16 * 1024 * 1024, timeout: Math.max(1_000, args.timeoutMs) });
  const files = (await readdir(args.dir)).filter((name) => name.startsWith(prefix) && name.endsWith(".png")).sort();
  return pairFrames(files, showinfoTimes(stderr), args.frames.length);
}

/** Every decoded frame in the window, n and time from the seek point. Decodes the window; writes nothing. */
export async function scanFrameTimes(args: { ffmpeg: string; url: string; inS: number; outS: number; timeoutMs: number }): Promise<{ n: number; t: number }[]> {
  const { stderr } = await run(args.ffmpeg, [
    "-hide_banner", "-nostats", "-loglevel", "info",
    "-ss", String(args.inS),
    "-t", String(Math.max(0, args.outS - args.inS)),
    "-i", args.url,
    "-an",
    "-vf", "showinfo",
    "-fps_mode", "passthrough",
    "-f", "null", "-",
  ], { maxBuffer: 64 * 1024 * 1024, timeout: Math.max(1_000, args.timeoutMs) });
  return showinfoFrames(stderr);
}

export type FacePull = {
  frames: { file: string; t: number }[];
  /** Frames asked of ffmpeg, the plan and any fill. */
  requested: number;
  /** The largest gap between checked frames, window start and end included (the real last frame after a scan). */
  largestGapS: number;
  /** True when the frame times were scanned: a short or variable-frame-rate return. */
  scanned: boolean;
  /** True when a gap over the limit remains because the source has no frame in it. */
  hole: boolean;
};

/** Plan, pull, and fill any gap over `maxGap` from the window's real frames. */
export async function pullFaceFrames(args: {
  ffmpeg: string;
  url: string;
  inS: number;
  outS: number;
  /** Sample times in seconds from inS (face-sampling.ts). */
  times: readonly number[];
  /** The source's average frame rate, for the plan. */
  sourceFps: number;
  dir: string;
  side: number;
  /** ms since epoch: each ffmpeg run stops by then. */
  deadline: number;
  maxGap?: number;
}): Promise<FacePull> {
  const maxGap = args.maxGap ?? FACE_MAX_GAP_S;
  const durationS = Math.max(0, args.outS - args.inS);
  const plan = planFrames(args.times, args.sourceFps, durationS, maxGap);
  const base = { ffmpeg: args.ffmpeg, url: args.url, inS: args.inS, outS: args.outS };
  let frames = await extractFaceFrames({ ...base, frames: plan.map((p) => p.frame), dir: args.dir, side: args.side, timeoutMs: args.deadline - Date.now(), prefix: "a" });
  let requested = plan.length;
  let startS = 0;
  let endS = durationS;
  const scanned = largestGap(frames.map((f) => f.t), startS, endS) > maxGap + EPS;
  if (scanned) {
    const real = await scanFrameTimes({ ...base, timeoutMs: args.deadline - Date.now() });
    if (real.length) {
      startS = Math.min(real[0]!.t, frames[0]?.t ?? Infinity);
      endS = real[real.length - 1]!.t;
    }
    const add = fillGaps(frames.map((f) => f.t), real, startS, endS, maxGap);
    if (add.length) {
      const more = await extractFaceFrames({ ...base, frames: add.map((r) => r.n), dir: args.dir, side: args.side, timeoutMs: args.deadline - Date.now(), prefix: "b" });
      requested += add.length;
      frames = [...frames, ...more].sort((x, y) => x.t - y.t).filter((f, i, all) => i === 0 || f.t - all[i - 1]!.t > EPS);
    }
  }
  const largestGapS = largestGap(frames.map((f) => f.t), startS, endS);
  return { frames, requested, largestGapS, scanned, hole: frames.length > 0 && largestGapS > maxGap + EPS };
}
