/**
 * TK3's fallback when VW14 misses: #1295's snippet detector, ranked by the
 * separated bass (the Demucs study's ranking, which had the right drop in
 * its top 2 on 19 of 20 clips). The choice in audio-rules.ts runs on that
 * ranking's top 2: the later one that qualifies, the last third first, and
 * the row adds " · found on the bass stem".
 *
 * Two halves:
 *
 *   - Pure, here: the detector's candidates (CT4's rise curve, every local
 *     peak of at least 6 dB past 20 s, snapped to the steepest step and
 *     merged within 1 s) and the study's compact ranking over them, from the
 *     bass and drums stems' 50 ms levels.
 *   - The stems themselves, behind `StemSource`. Demucs needs torch, which
 *     doesn't run on Vercel. Today the only source is `localDemucs` (a
 *     Python process on the operator's machine, for the drafts script). The
 *     Lambda it would need is written up in docs/top-tracks-bass-stem-lambda.md
 *     and doesn't exist: in the app, `stems` is null and the fallback can't
 *     run, so a track VW14 misses reads "no drop found".
 *
 * The study's compact model (fitted on 20 phone clips, so its weights carry
 * a mild leak; study note, 18 Nov): z-scored per track,
 *   + 1.93 bass_jump  (bass stem, 2 s after vs 2 s before)
 *   + 0.84 stop8      (the deepest 0.5 s of bass + drums in the next 8 s, vs their loudest)
 *   + 0.72 sustain8   (the 10th percentile of bass + drums over the next 8 s, vs their loudest)
 *   − 0.38 collapse8  (the sharpest 0.5 s fall in bass + drums within 8 s)
 *   − 0.25 kicks_after (kicks a second in the 2 s after)
 */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { DROP_RULE, toDb } from "../drop.ts";

export type Stems = {
  /** Seconds per level frame (50 ms). */
  frameS: number;
  /** The bass stem's level per frame, dB. */
  bassDb: Float64Array;
  /** The drums stem's level per frame, dB. */
  drumsDb: Float64Array;
};

/** Where stems come from. null: no source (the app today), so the fallback can't run. */
export interface StemSource {
  readonly name: string;
  stems(audioFile: string): Promise<Stems>;
}

export const BASS_STEM = {
  /** The compact model's weights (study note, 18 Nov). */
  weights: { bassJump: 1.93, stop8: 0.84, sustain8: 0.72, collapse8: -0.38, kicksAfter: -0.25 },
  jumpS: 2,
  aheadS: 8,
  dipS: 0.5,
  /** Detector candidates within this of each other are one. */
  mergeS: 1,
  top: 2,
} as const;

// ── #1295's detector, as candidates ─────────────────────────────────────────

function meanDb(values: ArrayLike<number>, from: number, to: number): number {
  const a = Math.max(0, from);
  const b = Math.min(values.length, to);
  if (b <= a) return DROP_RULE.floorDb;
  let s = 0;
  for (let i = a; i < b; i += 1) s += values[i]!;
  return s / (b - a);
}

/**
 * Every place CT4's detector would call a drop, not just its best: the rise
 * (2 s after minus 4 s before, low end under 150 Hz) at each local peak of at
 * least 6 dB past 20 s, moved to the steepest step within 0.5 s, merged
 * within 1 s (the higher rise kept). Seconds, in time order.
 */
export function detectorCandidates(lowRms: ArrayLike<number>, frameS: number = DROP_RULE.frameS): number[] {
  const db = Array.from(lowRms, toDb);
  const before = Math.round(DROP_RULE.beforeS / frameS);
  const after = Math.round(DROP_RULE.afterS / frameS);
  const from = Math.max(before, Math.round(DROP_RULE.searchFromS / frameS));
  const rise: number[] = [];
  for (let t = 0; t < db.length; t += 1) rise.push(t >= from && t + after <= db.length ? meanDb(db, t, t + after) - meanDb(db, t - before, t) : -Infinity);
  const snap = Math.round(DROP_RULE.snapS / frameS);
  const peaks: { t: number; rise: number }[] = [];
  for (let t = from; t + after <= db.length; t += 1) {
    const r = rise[t]!;
    if (r < DROP_RULE.minRiseDb) continue;
    if (r < (rise[t - 1] ?? -Infinity) || r <= (rise[t + 1] ?? -Infinity)) continue;
    let hit = t;
    let steepest = -Infinity;
    for (let u = Math.max(from, t - snap); u <= Math.min(db.length - 1, t + snap); u += 1) {
      const step = db[u]! - db[u - 1]!;
      if (step > steepest) {
        steepest = step;
        hit = u;
      }
    }
    peaks.push({ t: hit, rise: r });
  }
  const merged: { t: number; rise: number }[] = [];
  for (const p of peaks.sort((a, b) => a.t - b.t)) {
    const last = merged[merged.length - 1];
    if (last && (p.t - last.t) * frameS <= BASS_STEM.mergeS) {
      if (p.rise > last.rise) merged[merged.length - 1] = p;
    } else merged.push(p);
  }
  return merged.map((p) => Math.round(p.t * frameS * 1000) / 1000);
}

// ── The study's ranking ─────────────────────────────────────────────────────

export type RankedCandidate = {
  tS: number;
  score: number;
  features: { bassJump: number; stop8: number; sustain8: number; collapse8: number; kicksAfter: number };
};

function sumDb(a: number, b: number): number {
  return 10 * Math.log10(10 ** (a / 10) + 10 ** (b / 10));
}

/** The study's five features at a time, from the stems and the mix's kicks. */
export function stemFeatures(stems: Stems, tS: number, kicks: readonly number[]): RankedCandidate["features"] {
  const f = stems.frameS;
  const i = Math.round(tS / f);
  const n = Math.round(BASS_STEM.jumpS / f);
  const bassJump = meanDb(stems.bassDb, i, i + n) - meanDb(stems.bassDb, i - n, i);
  const both = Array.from(stems.bassDb, (b, k) => sumDb(b, stems.drumsDb[k] ?? DROP_RULE.floorDb));
  const loudest = Math.max(...both);
  const ahead = both.slice(i, Math.min(both.length, i + Math.round(BASS_STEM.aheadS / f)));
  const dip = Math.max(1, Math.round(BASS_STEM.dipS / f));
  const sorted = [...ahead].sort((a, b) => a - b);
  const sustain8 = (sorted[Math.floor(0.1 * (sorted.length - 1))] ?? DROP_RULE.floorDb) - loudest;
  let stop = Infinity;
  let collapse = 0;
  for (let k = 0; k + dip <= ahead.length; k += 1) {
    const m = meanDb(ahead, k, k + dip);
    stop = Math.min(stop, m);
    if (k >= dip) collapse = Math.max(collapse, meanDb(ahead, k - dip, k) - m);
  }
  const stop8 = (Number.isFinite(stop) ? stop : DROP_RULE.floorDb) - loudest;
  const kicksAfter = kicks.filter((k) => k >= tS && k < tS + BASS_STEM.jumpS).length / BASS_STEM.jumpS;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { bassJump: r1(bassJump), stop8: r1(stop8), sustain8: r1(sustain8), collapse8: r1(collapse), kicksAfter: r1(kicksAfter) };
}

/** The candidates ranked best first by the compact model, z-scored within the track. */
export function rankOnBassStem(candidates: readonly number[], stems: Stems, kicks: readonly number[]): RankedCandidate[] {
  if (!candidates.length) return [];
  const feats = candidates.map((t) => ({ tS: t, features: stemFeatures(stems, t, kicks) }));
  const keys = Object.keys(BASS_STEM.weights) as (keyof typeof BASS_STEM.weights)[];
  const z: Record<string, { mean: number; sd: number }> = {};
  for (const key of keys) {
    const v = feats.map((c) => c.features[key]);
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) || 1;
    z[key] = { mean, sd };
  }
  return feats
    .map((c) => ({ ...c, score: Math.round(keys.reduce((s, key) => s + BASS_STEM.weights[key] * ((c.features[key] - z[key]!.mean) / z[key]!.sd), 0) * 1000) / 1000 }))
    .sort((a, b) => b.score - a.score || a.tS - b.tS);
}

/** The ranking's top 2 times, for chooseDrop. */
export function bassStemTop2(candidates: readonly number[], stems: Stems, kicks: readonly number[]): number[] {
  return rankOnBassStem(candidates, stems, kicks)
    .slice(0, BASS_STEM.top)
    .map((c) => c.tS);
}

// ── A local source: Demucs on this machine ──────────────────────────────────

/** Parses the Python runner's JSON (scripts/top-tracks/bass-stem.py). */
export function parseStemsJson(raw: string): Stems {
  const j = JSON.parse(raw) as { frameS?: unknown; bassDb?: unknown; drumsDb?: unknown };
  if (typeof j.frameS !== "number" || !Array.isArray(j.bassDb) || !Array.isArray(j.drumsDb)) throw new Error("bass-stem: unexpected output");
  return { frameS: j.frameS, bassDb: Float64Array.from(j.bassDb as number[]), drumsDb: Float64Array.from(j.drumsDb as number[]) };
}

/**
 * Demucs (htdemucs) through a local Python with torch and demucs installed.
 * Used by scripts only (the drafts and acceptance scripts); never loaded by
 * the app. `python` is that interpreter; the script writes its JSON to a file
 * beside the input.
 */
export function localDemucs(opts: { python: string; script?: string; env?: Record<string, string> }): StemSource {
  const script = opts.script ?? path.resolve(process.cwd(), "scripts/top-tracks/bass-stem.py");
  return {
    name: "demucs (local)",
    async stems(audioFile) {
      const out = `${audioFile}.stems.json`;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(opts.python, ["-I", script, audioFile, out], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, ...opts.env } });
        let err = "";
        child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
        child.on("error", reject);
        child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`bass-stem.py exited ${code}: ${err.trim().split("\n").pop() ?? ""}`))));
      });
      return parseStemsJson(await readFile(out, "utf8"));
    },
  };
}
