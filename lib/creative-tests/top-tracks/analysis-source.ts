/**
 * TK18 (docs/design-record/2026-11-18-creative-lab-top-tracks-2.html): where
 * a studio track's analysis comes from. Beat This! and Demucs (the Demucs
 * study's models) need torch, which doesn't run on Vercel.
 *
 *   - `localStudio`: scripts/top-tracks/analyse.py through a local Python
 *     with torch, demucs and beat-this installed. Used by the drafts and
 *     acceptance scripts only.
 *   - In the app there is no source yet (docs/top-tracks-analysis-lambda.md
 *     is what deploying one needs): every file reads TK18's failure line,
 *     "Couldn't read this track's beat — drag the drop marker to it.", and
 *     an operator's drop cuts on seconds.
 *
 * The result is keyed by the Drive file id and Drive's modified time, and
 * runs again when either changes. The bass stem is data only: it is never
 * written as audio, rendered, filed or offered.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runFfmpegArgs } from "../audio-ffmpeg.ts";
import type { StudioAnalysis } from "./studio.ts";

export interface StudioSource {
  readonly name: string;
  analyse(audioFile: string): Promise<StudioAnalysis>;
}

/** TK18's key: one analysis per file version. */
export function analysisKey(driveFileId: string, driveModifiedTime: string | null | undefined): string {
  return `${driveFileId}@${driveModifiedTime ?? "unknown"}`;
}

/** Parses analyse.py's JSON. */
export function parseAnalysis(raw: string): StudioAnalysis {
  const j = JSON.parse(raw) as Partial<StudioAnalysis>;
  const nums = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "number");
  if (typeof j.durationS !== "number" || !nums(j.beats) || !nums(j.downbeats) || !nums(j.bassBeatDb) || j.beats!.length !== j.bassBeatDb!.length) throw new Error("analyse.py: unexpected output");
  return { durationS: j.durationS, beats: j.beats!, downbeats: j.downbeats!, bassBeatDb: j.bassBeatDb! };
}

/** Beat This! and htdemucs through a local Python (scripts only; never loaded by the app). */
export function localStudio(opts: { python: string; script?: string; env?: Record<string, string> }): StudioSource {
  const script = opts.script ?? path.resolve(process.cwd(), "scripts/top-tracks/analyse.py");
  return {
    name: "Beat This! final0 + htdemucs (local)",
    async analyse(audioFile) {
      const dir = await mkdtemp(path.join(tmpdir(), "tt-analyse-"));
      try {
        const wav = path.join(dir, "master.wav");
        await runFfmpegArgs(["-hide_banner", "-nostats", "-y", "-i", audioFile, "-vn", "-ar", "44100", "-ac", "2", wav]);
        const out = path.join(dir, "analysis.json");
        await new Promise<void>((resolve, reject) => {
          const child = spawn(opts.python, ["-I", script, wav, out], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, ...opts.env } });
          let err = "";
          child.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
          child.on("error", reject);
          child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`analyse.py exited ${code}: ${err.trim().split("\n").pop() ?? ""}`))));
        });
        return parseAnalysis(await readFile(out, "utf8"));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}
