/**
 * Timing samples for the face detector, one frame per slice of a face check
 * (Matas, 17 Nov 2026: time every candidate in one Retry, then rule). The
 * candidates are today's detector (cpu, 640 px: the baseline), the same at
 * 512 and 416 px, the wasm backend (SIMD) and tfjs-node, each at 640 px.
 *
 *   - The samples never change which backend does the real detection. The cpu
 *     sizes run in this process on face-api's bundled cpu tfjs, which is the
 *     real detector's own backend. wasm and tfjs-node run in a child process
 *     (face-bench-child.cjs): tfjs-core keeps one engine on globalThis, so a
 *     second tfjs here would share it with the real detection.
 *   - A candidate that fails to load is logged as not loaded and skipped. A
 *     sample never fails the check.
 *   - The slice counts the samples' time inside its 450 s (face-check-slice.ts).
 *
 * No `@/` imports: node --test cannot resolve them. Temporary: it goes once
 * the backend is ruled on.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

export type BenchBox = { x: number; y: number; width: number; height: number };
export type BenchCandidate = {
  id: string;
  backend: "cpu" | "wasm" | "tfjs-node";
  side: number;
  /** Why it isn't in the function: logged in place of a module-not-found when the load fails that way. */
  notShipped?: string;
};

/**
 * tfjs-node's native libtensorflow 2.9.1 (linux x64) is 401 MB unpacked (libtensorflow.so 361 MB, framework
 * 40 MB), over the 250 MB function cap (CI: 230 MB, scripts/check-function-size.mts). Left out by the
 * coordinator's ruling, 17 Nov 2026; raising the cap is Matas's call. The sample still tries the load.
 */
export const TFJS_NODE_NOT_SHIPPED = "not shipped: 401 MB native library over the 250 MB cap";

/** The first is the baseline: today's real detection. */
export const FACE_BENCH_CANDIDATES: readonly BenchCandidate[] = [
  { id: "cpu-640", backend: "cpu", side: 640 },
  { id: "cpu-512", backend: "cpu", side: 512 },
  { id: "cpu-416", backend: "cpu", side: 416 },
  { id: "wasm-640", backend: "wasm", side: 640 },
  { id: "tfjs-node-640", backend: "tfjs-node", side: 640, notShipped: TFJS_NODE_NOT_SHIPPED },
];

export type BenchResult = {
  id: string;
  backend: BenchCandidate["backend"];
  side: number;
  loaded: boolean;
  /** Seconds for the one frame (a warm run). */
  seconds?: number;
  faces?: number;
  /** Lowest IoU of a baseline face against its best match in this candidate (1 = same boxes); null with no faces. */
  minIou?: number | null;
  /** Child candidates: the load and the first (cold) run, in seconds, and what the backend reported. */
  loadS?: number;
  warmS?: number;
  simd?: boolean;
  threads?: boolean;
  error?: string;
};

/** The child script: the traced copy under the working directory (the Vercel function), else next to this file. */
export function benchChildPath(cwd: string = process.cwd(), exists: (path: string) => boolean = existsSync): string {
  const traced = join(cwd, "lib", "creative-lab", "face-bench-child.cjs");
  if (exists(traced)) return traced;
  return join(dirname(fileURLToPath(import.meta.url)), "face-bench-child.cjs");
}

async function frameWidth(frame: Buffer): Promise<number> {
  const sharp = (await import("sharp")).default;
  return (await sharp(frame).metadata()).width ?? 1;
}

function iou(a: BenchBox, b: BenchBox): number {
  const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = x * y;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/** Each baseline face against its best match; null when the baseline has none. */
export function minIou(baseline: readonly BenchBox[], other: readonly BenchBox[]): number | null {
  if (!baseline.length) return other.length ? 0 : null;
  return Math.min(...baseline.map((a) => Math.max(0, ...other.map((b) => iou(a, b)))));
}

/**
 * Time every candidate on one frame (a PNG from the face check). `detectCpu` is the real detector at a long
 * side. Never throws: a candidate that can't load or run is a result with `loaded: false` or an `error`.
 */
export async function benchFrame(args: {
  frame: Buffer;
  dir: string;
  modelDir: string;
  /** ms since epoch: child runs stop by then. */
  deadline: number;
  detectCpu: (frame: Buffer, longSide: number) => Promise<BenchBox[]>;
  candidates?: readonly BenchCandidate[];
  childPath?: string;
  now?: () => number;
}): Promise<BenchResult[]> {
  const now = args.now ?? (() => performance.now());
  const candidates = args.candidates ?? FACE_BENCH_CANDIDATES;
  const results: BenchResult[] = [];
  let baseline: BenchBox[] | null = null;
  let raw: { path: string; width: number; height: number } | null = null;
  for (const c of candidates) {
    const base = { id: c.id, backend: c.backend, side: c.side };
    try {
      if (c.backend === "cpu") {
        const t0 = now();
        const faces = await args.detectCpu(args.frame, c.side);
        const seconds = (now() - t0) / 1000;
        baseline ??= faces;
        results.push({ ...base, loaded: true, seconds, faces: faces.length, minIou: minIou(baseline, faces) });
        continue;
      }
      if (!raw) {
        const sharp = (await import("sharp")).default;
        const { data, info } = await sharp(args.frame)
          .resize({ width: c.side, height: c.side, fit: "inside", withoutEnlargement: true })
          .removeAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        raw = { path: join(args.dir, `bench-${c.side}.rgb`), width: info.width, height: info.height };
        await writeFile(raw.path, data);
      }
      const timeout = Math.max(1_000, args.deadline - Date.now());
      const { stdout } = await run(process.execPath, [args.childPath ?? benchChildPath(), c.backend, raw.path, String(raw.width), String(raw.height), args.modelDir], {
        timeout,
        maxBuffer: 1024 * 1024,
      }).catch((err: { stdout?: string; killed?: boolean; message?: string }) => {
        if (err.killed) return { stdout: JSON.stringify({ loaded: false, error: `timed out after ${Math.round(timeout / 1000)} s` }) };
        return { stdout: err.stdout ?? JSON.stringify({ loaded: false, error: String(err.message ?? err).split("\n")[0] }) };
      });
      const line = String(stdout).trim().split("\n").filter(Boolean).at(-1) ?? "{}";
      const got = JSON.parse(line) as { loaded?: boolean; detectS?: number; warmS?: number; loadS?: number; simd?: boolean; threads?: boolean; faces?: BenchBox[]; error?: string };
      // Child boxes are in the raw copy's pixels, back to the frame's (the cpu boxes' space).
      const sx = (await frameWidth(args.frame)) / raw.width;
      const faces = (got.faces ?? []).map((f) => ({ x: f.x * sx, y: f.y * sx, width: f.width * sx, height: f.height * sx }));
      results.push({
        ...base,
        loaded: Boolean(got.loaded),
        ...(got.detectS != null ? { seconds: got.detectS } : {}),
        ...(got.loaded && got.detectS != null ? { faces: faces.length, minIou: baseline ? minIou(baseline, faces) : null } : {}),
        ...(got.loadS != null ? { loadS: got.loadS } : {}),
        ...(got.warmS != null ? { warmS: got.warmS } : {}),
        ...(got.simd != null ? { simd: got.simd } : {}),
        ...(got.threads != null ? { threads: got.threads } : {}),
        ...(got.error ? { error: c.notShipped && /cannot find module '(@tensorflow\/tfjs-node|@vladmandic\/face-api\/dist\/face-api\.node\.js)'/i.test(got.error) ? c.notShipped : got.error } : {}),
      });
    } catch (err) {
      results.push({ ...base, loaded: false, error: (err instanceof Error ? err.message : String(err)).split("\n")[0]!.slice(0, 200) });
    }
  }
  return results;
}

/** One log line for a slice's samples: backend, input size, seconds for the frame, loaded or not. */
export function benchLine(results: readonly BenchResult[], ctx: { slice: number; t: number }): string {
  const parts = results.map((r, i) => {
    const head = `${r.backend} ${r.side} px`;
    if (!r.loaded) return `${head}: not loaded (${r.error ?? "no reason given"})`;
    if (r.seconds == null) return `${head}: loaded, no time (${r.error ?? "no reason given"})`;
    const agree = i === 0 ? "baseline" : r.minIou == null ? "no faces in either" : `min IoU ${r.minIou.toFixed(2)} vs baseline`;
    const extra = [
      r.simd != null ? `simd ${r.simd ? "on" : "off"}` : null,
      r.threads != null ? `threads ${r.threads ? "on" : "off"}` : null,
      r.loadS != null ? `load ${r.loadS.toFixed(2)} s` : null,
      r.warmS != null ? `first run ${r.warmS.toFixed(2)} s` : null,
    ].filter(Boolean);
    return `${head}: ${r.seconds.toFixed(2)} s, ${r.faces ?? 0} faces, ${agree}${extra.length ? `, ${extra.join(", ")}` : ""}`;
  });
  return `timing sample, slice ${ctx.slice}, frame at ${ctx.t.toFixed(2)} s: ${parts.join(" · ")}`;
}
