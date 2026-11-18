/**
 * The snippet's ffmpeg work (CT1, CT2, CT4): reading an audio file's format,
 * its energy envelopes for the drop and the waveform, the cut with fades and
 * loudness, and the mux of that cut onto the rendered still.
 *
 * The argument builders and parsers are pure and tested. The run functions
 * spawn the ffmpeg-static binary (the route and the render tick carry it in
 * next.config.ts) on files in a temp folder, never on a URL: the audio is
 * always a file the Lab copied from Drive (CT2).
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ffmpegFailure } from "../creative-lab/render-proxy.ts";
import { DROP_RULE } from "./drop.ts";
import { SNIPPET, type ProbedAudio } from "./snippet.ts";

/** The envelopes' sample rate: 8 kHz keeps the low end and a 5-minute track at 4.8 MB. */
export const ENVELOPE_RATE = 8000;

export function probeArgs(input: string): string[] {
  return ["-hide_banner", "-nostats", "-i", input, "-map", "0:a:0", "-t", "0", "-f", "null", "-"];
}

/** ffmpeg's stderr → container, codec, bitrate and duration. */
export function parseProbe(stderr: string): ProbedAudio {
  const container = /Input #0, ([^,]+(?:,[^,\s]+)*), from /.exec(stderr)?.[1]?.trim() ?? null;
  const duration = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  const durationS = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null;
  const stream = /Stream #0:\d+[^:]*: Audio: ([a-z0-9_]+)[^\n]*/i.exec(stderr);
  const codec = stream?.[1]?.toLowerCase() ?? null;
  const streamKbps = stream ? /(\d+) kb\/s/.exec(stream[0])?.[1] : undefined;
  const overallKbps = /Duration: [^\n]*bitrate: (\d+) kb\/s/.exec(stderr)?.[1];
  const kbps = streamKbps ?? overallKbps;
  return { container, codec, bitrateKbps: kbps ? Number(kbps) : null, durationS };
}

/** One pass, two raw mono 8 kHz s16le files: the full band (waveform) and the low end under 150 Hz (the drop). */
export function envelopeArgs(input: string, fullOut: string, lowOut: string): string[] {
  return [
    "-hide_banner", "-nostats", "-y", "-i", input, "-vn",
    "-filter_complex", `[0:a:0]aformat=channel_layouts=mono,aresample=${ENVELOPE_RATE},asplit=2[full][lo];[lo]lowpass=f=${DROP_RULE.lowpassHz}[low]`,
    "-map", "[full]", "-f", "s16le", "-acodec", "pcm_s16le", fullOut,
    "-map", "[low]", "-f", "s16le", "-acodec", "pcm_s16le", lowOut,
  ];
}

export type CutWindow = { startS: number; lengthS: number };

/** The fades (CT1): 0.25 s in, 1.5 s out, ending on the snippet's last sample. */
export function fadeFilter(lengthS: number): string {
  const outStart = Math.max(0, lengthS - SNIPPET.fadeOut);
  return `afade=t=in:st=0:d=${SNIPPET.fadeIn},afade=t=out:st=${outStart}:d=${SNIPPET.fadeOut}`;
}

const LOUDNORM = `loudnorm=I=${SNIPPET.lufs}:TP=${SNIPPET.truePeak}:LRA=11`;

/** Loudness pass 1: measures the faded window. */
export function loudnessMeasureArgs(input: string, win: CutWindow): string[] {
  return ["-hide_banner", "-nostats", "-ss", String(win.startS), "-t", String(win.lengthS), "-i", input, "-vn", "-af", `${fadeFilter(win.lengthS)},${LOUDNORM}:print_format=json`, "-f", "null", "-"];
}

export type LoudnessMeasure = { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string };

/** loudnorm's JSON block from pass 1's stderr. */
export function parseLoudness(stderr: string): LoudnessMeasure | null {
  const start = stderr.lastIndexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    const json = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
    const keys = ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"] as const;
    if (!keys.every((k) => typeof json[k] === "string" && Number.isFinite(Number(json[k])))) return null;
    return { input_i: json.input_i!, input_tp: json.input_tp!, input_lra: json.input_lra!, input_thresh: json.input_thresh!, target_offset: json.target_offset! };
  } catch {
    return null;
  }
}

/**
 * Loudness pass 2: the cut, faded, normalised to −14 LUFS and −1 dBTP from pass 1's measures, AAC 256 kbps (CT1).
 * -vn: an MP3's embedded cover art is a video stream, and without it ffmpeg tries to write that picture into the .m4a.
 */
export function cutArgs(input: string, output: string, win: CutWindow, m: LoudnessMeasure): string[] {
  const loud = `${LOUDNORM}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  return [
    "-hide_banner", "-nostats", "-y", "-ss", String(win.startS), "-t", String(win.lengthS), "-i", input, "-vn",
    "-af", `${fadeFilter(win.lengthS)},${loud}`,
    "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", `${SNIPPET.audioBitrateK}k`, "-movflags", "+faststart", output,
  ];
}

/** The rendered still (silent) and the cut, muxed without re-encoding either, so the snippet runs exactly as previewed. */
export function muxArgs(video: string, audio: string, output: string): string[] {
  return ["-hide_banner", "-nostats", "-y", "-i", video, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "copy", "-shortest", "-movflags", "+faststart", output];
}

// ── Runs ────────────────────────────────────────────────────────────────────

async function ffmpegPath(): Promise<string> {
  const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string;
  const resolved = typeof mod === "string" ? mod : mod.default;
  if (!resolved) throw new Error("ffmpeg-static has no binary for this platform");
  return resolved;
}

/** Runs ffmpeg and returns stderr (where ffmpeg writes its report). A failure throws FfmpegFailed. */
export async function runFfmpegArgs(args: string[]): Promise<string> {
  const bin = await ffmpegPath();
  try {
    const { stderr } = await promisify(execFile)(bin, args, { maxBuffer: 16 * 1024 * 1024 });
    return String(stderr);
  } catch (err) {
    throw ffmpegFailure(err);
  }
}

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function probeAudio(file: string): Promise<ProbedAudio | null> {
  try {
    return parseProbe(await runFfmpegArgs(probeArgs(file)));
  } catch {
    return null;
  }
}

/** Both envelopes as raw PCM bytes. */
export async function readEnvelopes(file: string): Promise<{ full: Uint8Array; low: Uint8Array }> {
  return withTempDir("snippet-env-", async (dir) => {
    const full = path.join(dir, "full.raw");
    const low = path.join(dir, "low.raw");
    await runFfmpegArgs(envelopeArgs(file, full, low));
    return { full: new Uint8Array(await readFile(full)), low: new Uint8Array(await readFile(low)) };
  });
}

/** The two-pass cut, written to `output` (.m4a). */
export async function cutSnippet(file: string, output: string, win: CutWindow): Promise<void> {
  const measured = parseLoudness(await runFfmpegArgs(loudnessMeasureArgs(file, win)));
  if (!measured) throw new Error("ffmpeg: the loudness measure didn't come back");
  await runFfmpegArgs(cutArgs(file, output, win, measured));
}

export async function muxSnippet(video: string, audio: string, output: string): Promise<void> {
  await runFfmpegArgs(muxArgs(video, audio, output));
}
