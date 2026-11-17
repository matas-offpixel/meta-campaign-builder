/**
 * One tick's slice of a face check (17 Nov 2026: Vercel took ~15 s a frame,
 * so a 30 s window's 87 frames can't fit one 600 s run).
 *
 * A check works through one list of source frames, the seeded plan
 * (planFrames over sampleTimes), stored with its progress on the clip, so
 * every tick checks the same frames and the 0.4 s gap bound is the one the
 * one-run check had. A slice:
 *   1. extracts only the next frames it expects to reach (a batch sized from
 *      the seconds a frame has taken so far), and detects them one by one;
 *   2. starts no extract, scan or frame past `sliceEnd`, and stops there;
 *   3. once every planned frame is checked, fills any gap over the limit
 *      exactly as pullFaceFrames does (scan the window's real frames, add a
 *      real frame in each long gap, check those), then finishes.
 * The caller saves `progress` and parks the check, or stores the samples.
 * A stalled ffmpeg run (killed at its timeout) ends the slice like the time
 * running out: what it checked before is kept.
 *
 * No `@/` imports: node --test cannot resolve them.
 */

import type { FaceCheckProgress, StoredFaceRect } from "./caption-placement.ts";
import { fillGaps } from "./face-frames.ts";
import { FACE_MAX_GAP_S, largestGap } from "./face-sampling.ts";

/** pts_time is printed to about 1e-5 s. */
const EPS = 1e-4;
/** At most this many frames in one extract: a batch sized from a fast estimate stays small on /tmp. */
export const FACE_SLICE_MAX_BATCH = 40;

export function newProgress(plan: readonly number[]): FaceCheckProgress {
  return { frames: [...plan], planned: plan.length, done: 0, samples: [], checked: 0, slices: 0, extractS: 0, scanS: 0, detectS: 0 };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Stored progress, or null when it isn't a well-formed one (then the check starts its plan again). */
export function readProgress(value: unknown): FaceCheckProgress | null {
  if (!value || typeof value !== "object") return null;
  const p = value as FaceCheckProgress;
  if (!Array.isArray(p.frames) || !p.frames.every((n) => Number.isInteger(n) && n >= 0)) return null;
  if (!Number.isInteger(p.done) || p.done < 0 || p.done > p.frames.length) return null;
  if (!Number.isInteger(p.planned) || p.planned < 0 || p.planned > p.frames.length) return null;
  if (!Array.isArray(p.samples) || !p.samples.every((s) => s && isNum(s.t) && Array.isArray(s.faces))) return null;
  if (p.scan != null && !(isNum(p.scan.startS) && isNum(p.scan.endS))) return null;
  return {
    frames: p.frames,
    planned: p.planned,
    done: p.done,
    samples: p.samples,
    ...(p.scan ? { scan: { startS: p.scan.startS, endS: p.scan.endS } } : {}),
    checked: isNum(p.checked) ? p.checked : p.samples.length,
    slices: isNum(p.slices) ? p.slices : 0,
    extractS: isNum(p.extractS) ? p.extractS : 0,
    scanS: isNum(p.scanS) ? p.scanS : 0,
    detectS: isNum(p.detectS) ? p.detectS : 0,
  };
}

/** Ascending, one sample per frame time. */
function tidy(samples: readonly FaceCheckProgress["samples"][number][]): FaceCheckProgress["samples"] {
  return [...samples].sort((a, b) => a.t - b.t).filter((s, i, all) => i === 0 || s.t - all[i - 1]!.t > EPS);
}

/** Seconds of this slice, for the log line on success, park and failure alike. */
export type SliceStats = { frames: number; extractS: number; scanS: number; detectS: number; extracts: number; benchS?: number };

/**
 * Timing samples on one frame of the slice (face-detect-bench.ts), after its first real detection. They run
 * only when the time left before `sliceEnd` covers about `frames` detections at the clip's measured seconds a
 * frame plus `overheadS`, so they can't push a slice past its end. Their time counts in the slice's.
 */
export type SliceBench = { run: (file: string, t: number) => Promise<void>; frames: number; overheadS: number };

export type SliceResult = {
  progress: FaceCheckProgress;
  /** done: every frame is checked (and any gap filled); parked: the slice stopped with frames left. */
  status: "done" | "parked";
  /** The slice checked a frame or finished the scan: a parked check that made progress is not a failed try. */
  madeProgress: boolean;
  /** Why a parked slice stopped. */
  stopped?: "time" | "stall";
};

/** The execFile error of a run killed at its timeout. */
export function isStall(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { killed?: boolean }).killed === true);
}

export async function runFaceCheckSlice(args: {
  progress: FaceCheckProgress;
  /** The window's length in seconds. */
  durationS: number;
  /** ms since epoch: no extract, scan or frame is started at or after this. */
  sliceEnd: number;
  /** ms since epoch: each ffmpeg run stops by then. */
  deadline: number;
  /** Seconds a frame, to size the first extract before any frame was timed. */
  estimateS: number;
  /** Frames n (ffmpeg's after the seek), each written with its real time from the seek point. Fewer is fine. */
  extract: (frames: readonly number[], timeoutMs: number) => Promise<{ file: string; t: number }[]>;
  /** Faces in one extracted frame, in output pixels. */
  detect: (file: string) => Promise<StoredFaceRect[]>;
  /** Every real frame in the window, n and time from the seek point. */
  scan: (timeoutMs: number) => Promise<{ n: number; t: number }[]>;
  /** Called after each frame is checked (to free its file). */
  done?: (file: string) => Promise<void>;
  bench?: SliceBench;
  maxGap?: number;
  maxBatch?: number;
  now?: () => number;
  stats?: SliceStats;
}): Promise<SliceResult> {
  const now = args.now ?? Date.now;
  const maxGap = args.maxGap ?? FACE_MAX_GAP_S;
  const maxBatch = Math.max(1, args.maxBatch ?? FACE_SLICE_MAX_BATCH);
  const stats = args.stats ?? { frames: 0, extractS: 0, scanS: 0, detectS: 0, extracts: 0 };
  const p: FaceCheckProgress = structuredClone(args.progress);
  p.slices += 1;
  let madeProgress = false;
  let benched = false;
  const result = (status: SliceResult["status"], stopped?: SliceResult["stopped"]): SliceResult => {
    p.samples = tidy(p.samples);
    return { progress: p, status, madeProgress, ...(stopped ? { stopped } : {}) };
  };

  for (;;) {
    if (p.done < p.frames.length) {
      if (now() >= args.sliceEnd) return result("parked", "time");
      const perFrameS = p.checked > 0 ? p.detectS / p.checked : args.estimateS;
      const left = p.frames.length - p.done;
      const reach = Math.ceil((args.sliceEnd - now()) / 1000 / Math.max(0.01, perFrameS));
      const batch = p.frames.slice(p.done, p.done + Math.max(1, Math.min(left, maxBatch, reach)));
      const t0 = now();
      let got: { file: string; t: number }[];
      try {
        got = await args.extract(batch, args.deadline - now());
      } catch (err) {
        if (isStall(err)) return result("parked", "stall");
        throw err;
      } finally {
        const s = (now() - t0) / 1000;
        p.extractS += s;
        stats.extractS += s;
        stats.extracts += 1;
      }
      let detected = 0;
      for (const frame of got) {
        if (now() >= args.sliceEnd) break;
        const t1 = now();
        const faces = await args.detect(frame.file);
        const s = (now() - t1) / 1000;
        p.detectS += s;
        stats.detectS += s;
        p.checked += 1;
        stats.frames += 1;
        p.samples.push({ t: frame.t, faces });
        detected += 1;
        madeProgress = true;
        if (args.bench && !benched) {
          benched = true;
          const perFrameS = p.detectS / Math.max(1, p.checked);
          if (args.sliceEnd - now() > (args.bench.frames * perFrameS + args.bench.overheadS) * 1000) {
            const t2 = now();
            // A sample never fails the check (face-detect-bench.ts never throws; this is the backstop).
            await args.bench.run(frame.file, frame.t).catch(() => {});
            stats.benchS = (stats.benchS ?? 0) + (now() - t2) / 1000;
          }
        }
        await args.done?.(frame.file);
      }
      // A full return pairs frame for frame with the batch. A short one (frames the source doesn't have) is
      // all tried once every frame that came back is checked; otherwise only the checked count is counted as
      // done, and any frame tried twice is dropped by its time. Either way the gap check below catches a miss.
      p.done += detected === got.length ? batch.length : detected;
      if (got.length === 0) madeProgress = true;
      if (detected < got.length) return result("parked", "time");
      continue;
    }
    if (!p.scan) {
      const times = tidy(p.samples).map((s) => s.t);
      if (largestGap(times, 0, args.durationS) <= maxGap + EPS) return result("done");
      if (now() >= args.sliceEnd) return result("parked", "time");
      // As pullFaceFrames: a short or variable-frame-rate source. Real frames fill each long gap.
      const t0 = now();
      let real: { n: number; t: number }[];
      try {
        real = await args.scan(args.deadline - now());
      } catch (err) {
        if (isStall(err)) return result("parked", "stall");
        throw err;
      } finally {
        const s = (now() - t0) / 1000;
        p.scanS += s;
        stats.scanS += s;
      }
      let startS = 0;
      let endS = args.durationS;
      if (real.length) {
        startS = Math.min(real[0]!.t, times[0] ?? Infinity);
        endS = real[real.length - 1]!.t;
      }
      const add = fillGaps(times, real, startS, endS, maxGap);
      p.scan = { startS, endS };
      p.frames.push(...add.map((r) => r.n));
      madeProgress = true;
      continue;
    }
    return result("done");
  }
}

/** The finished check: samples ascending and the largest gap, against the scan's real ends when it ran. */
export function finishedSamples(progress: FaceCheckProgress, durationS: number, maxGap = FACE_MAX_GAP_S): {
  samples: FaceCheckProgress["samples"];
  largestGapS: number;
  scanned: boolean;
  hole: boolean;
  requested: number;
} {
  const samples = tidy(progress.samples);
  const startS = progress.scan?.startS ?? 0;
  const endS = progress.scan?.endS ?? durationS;
  const largestGapS = largestGap(samples.map((s) => s.t), startS, endS);
  return {
    samples,
    largestGapS,
    scanned: Boolean(progress.scan),
    hole: samples.length > 0 && largestGapS > maxGap + EPS,
    requested: progress.frames.length,
  };
}
