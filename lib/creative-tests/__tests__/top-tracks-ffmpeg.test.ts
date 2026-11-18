/**
 * TK3's joined loudness on real ffmpeg (where the ffmpeg-static binary is
 * installed): two snippets cut as CT1 cuts one (fades, −14 LUFS, −1 dBTP),
 * joined with the second starting 0.75 s before the first ends, and the
 * joined reel checked at −14 LUFS ± 1 with peaks no higher than −1 dBTP.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { probeAudio, runFfmpegArgs } from "../audio-ffmpeg.ts";
import { cutTrackSnippet, joinSnippets, loudnessOk, measureReel } from "../top-tracks/ffmpeg.ts";
import { reelTimeline } from "../top-tracks/reel.ts";

async function hasFfmpeg(): Promise<boolean> {
  try {
    const mod = (await import("ffmpeg-static")) as unknown as { default?: string | null } | string;
    return Boolean(typeof mod === "string" ? mod : mod.default);
  } catch {
    return false;
  }
}

describe("TK3: the joined reel's loudness", async () => {
  const available = await hasFfmpeg();
  it("is −14 LUFS ± 1 with peaks ≤ −1 dBTP, and runs the sum less 0.75 s a join", { skip: !available && "no ffmpeg-static binary" }, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tt-loud-"));
    try {
      const tracks = [path.join(dir, "a.wav"), path.join(dir, "b.wav")];
      // A quiet 110 Hz tone and a loud pink-noise bed: very different levels before normalising.
      await runFfmpegArgs(["-hide_banner", "-nostats", "-y", "-f", "lavfi", "-i", "sine=frequency=110:sample_rate=44100:duration=40", "-af", "volume=0.05", tracks[0]!]);
      await runFfmpegArgs(["-hide_banner", "-nostats", "-y", "-f", "lavfi", "-i", "anoisesrc=color=pink:sample_rate=44100:duration=40:amplitude=0.9", tracks[1]!]);
      const snippets = [
        { file: tracks[0]!, win: { startS: 10, lengthS: 13.5 } },
        { file: tracks[1]!, win: { startS: 12, lengthS: 17.4 } },
      ];
      const cuts: string[] = [];
      for (const [i, s] of snippets.entries()) {
        const out = path.join(dir, `cut${i}.m4a`);
        await cutTrackSnippet(s.file, out, s.win);
        cuts.push(out);
      }
      const tl = reelTimeline(snippets.map((s) => ({ lengthS: s.win.lengthS, dropInS: 5 })), "date");
      const joined = path.join(dir, "reel.m4a");
      await joinSnippets(cuts, tl.startsS, joined);
      const m = await measureReel(joined);
      assert.ok(loudnessOk(m), `measured ${m.lufs} LUFS, ${m.truePeakDb} dBTP`);
      const probe = await probeAudio(joined);
      assert.ok(probe?.durationS != null && Math.abs(probe.durationS - tl.totalS) < 0.1, `duration ${probe?.durationS} vs ${tl.totalS}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
