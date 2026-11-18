/**
 * Top tracks' ffmpeg work (TK3): decoding a track for analysis, cutting each
 * snippet (CT1's fades, −14 LUFS, through the snippet's own two-pass cut),
 * joining the snippets with each next one starting 0.75 s before the one
 * before it ends, and checking the joined reel's loudness.
 *
 * The argument builders and parsers are pure and tested; the runs spawn the
 * ffmpeg-static binary on files in a temp folder, never on a URL (CT2).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { cutSnippet, parseLoudness, runFfmpegArgs, withTempDir } from "../audio-ffmpeg.ts";
import { SNIPPET } from "../snippet.ts";
import { VW14 } from "./analysis.ts";

/** Mono 16 kHz s16le, the analysis rate (VW14's build check). */
export function decodeArgs(input: string, output: string): string[] {
  return ["-hide_banner", "-nostats", "-y", "-i", input, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", String(VW14.sampleRate), "-f", "s16le", "-acodec", "pcm_s16le", output];
}

export async function decodeForAnalysis(file: string): Promise<Uint8Array> {
  return withTempDir("top-tracks-dec-", async (dir) => {
    const out = path.join(dir, "mono16k.raw");
    await runFfmpegArgs(decodeArgs(file, out));
    return new Uint8Array(await readFile(out));
  });
}

/** TK3: each snippet cut as CT1 cuts one: fades in 0.25 s and out 1.5 s, −14 LUFS, −1 dBTP. */
export async function cutTrackSnippet(file: string, output: string, win: { startS: number; lengthS: number }): Promise<void> {
  await cutSnippet(file, output, win);
}

/**
 * The join (TK3): snippet k starts at `startsS[k]` in the reel (each 0.75 s
 * before the one before ends, halfway through its fade-out), mixed without
 * normalising the sum, so the faded tail and the next fade-in overlap.
 * Encoded AAC 256 kbps (CT1), 48 kHz stereo.
 */
export function joinArgs(inputs: readonly string[], startsS: readonly number[], output: string): string[] {
  if (inputs.length !== startsS.length || !inputs.length) throw new Error("one start per snippet");
  const args = ["-hide_banner", "-nostats", "-y"];
  for (const input of inputs) args.push("-i", input);
  const chains = inputs.map((_, i) => {
    const ms = Math.round(startsS[i]! * 1000);
    return `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[d${i}]`;
  });
  const mix = `${inputs.map((_, i) => `[d${i}]`).join("")}amix=inputs=${inputs.length}:duration=longest:dropout_transition=0:normalize=0[mix]`;
  args.push("-filter_complex", [...chains, mix].join(";"), "-map", "[mix]", "-ar", "48000", "-ac", "2", "-c:a", "aac", "-b:a", `${SNIPPET.audioBitrateK}k`, "-movflags", "+faststart", output);
  return args;
}

/** loudnorm's measure of a finished file: integrated LUFS and true peak. */
export function loudnessCheckArgs(input: string): string[] {
  return ["-hide_banner", "-nostats", "-i", input, "-vn", "-af", `loudnorm=I=${SNIPPET.lufs}:TP=${SNIPPET.truePeak}:LRA=11:print_format=json`, "-f", "null", "-"];
}

export type ReelLoudness = { lufs: number; truePeakDb: number };

/** TK3's check: −14 LUFS ± 1, peaks no higher than −1 dBTP. */
export function loudnessOk(m: ReelLoudness): boolean {
  return Math.abs(m.lufs - SNIPPET.lufs) <= 1 + 1e-9 && m.truePeakDb <= SNIPPET.truePeak + 1e-9;
}

export async function joinSnippets(inputs: readonly string[], startsS: readonly number[], output: string): Promise<void> {
  await runFfmpegArgs(joinArgs(inputs, startsS, output));
}

export async function measureReel(file: string): Promise<ReelLoudness> {
  const m = parseLoudness(await runFfmpegArgs(loudnessCheckArgs(file)));
  if (!m) throw new Error("ffmpeg: the loudness measure didn't come back");
  return { lufs: Number(m.input_i), truePeakDb: Number(m.input_tp) };
}
