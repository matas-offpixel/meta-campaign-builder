/**
 * CT4's drop rule on envelopes, the ffmpeg argument builders and parsers,
 * and (where the ffmpeg-static binary is installed) the real pipeline on a
 * synthetic track: the drop, −14 LUFS, peaks no higher than −1 dBTP, AAC at
 * 256 kbps, and the mux that keeps the cut's audio byte for byte.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ENVELOPE_RATE, cutArgs, cutSnippet, envelopeArgs, fadeFilter, loudnessMeasureArgs, muxArgs, muxSnippet, parseLoudness, parseProbe, probeArgs, probeAudio, readEnvelopes, runFfmpegArgs } from "../audio-ffmpeg.ts";
import { DROP_RULE, detectDrop, rmsEnvelope, waveformPeaks } from "../drop.ts";
import { unusableReason, windowForDrop } from "../snippet.ts";

/** A low-end envelope: `quiet` dB before the drop, `loud` after, one value per 50 ms frame. */
function envelope(seconds: number, dropAt: number, quiet = -40, loud = -10): number[] {
  return Array.from({ length: Math.round(seconds / DROP_RULE.frameS) }, (_, i) => 10 ** ((i * DROP_RULE.frameS < dropAt ? quiet : loud) / 20));
}

describe("CT4: the drop", () => {
  it("is the biggest low-end rise after a build", () => {
    assert.deepEqual(detectDrop(envelope(120, 58)), { dropS: 58, riseDb: 30 });
  });

  it("is never looked for in the first 20 seconds", () => {
    const early = envelope(120, 10);
    assert.equal(detectDrop(early), null);
  });

  it("a flat track, or a rise under 6 dB, has no clear drop", () => {
    assert.equal(detectDrop(envelope(120, 200)), null);
    assert.equal(detectDrop(envelope(120, 58, -20, -16)), null);
  });

  it("picks the bigger of two rises", () => {
    const env = envelope(180, 40, -40, -25).map((v, i) => (i * DROP_RULE.frameS >= 90 && i * DROP_RULE.frameS < 100 ? 10 ** (-45 / 20) : i * DROP_RULE.frameS >= 100 ? 10 ** (-8 / 20) : v));
    assert.equal(detectDrop(env)?.dropS, 100);
  });

  it("reads 16-bit PCM into an RMS envelope, and peaks to 0..1", () => {
    const pcm = new Uint8Array(8000 * 2);
    const view = new DataView(pcm.buffer);
    for (let i = 0; i < 8000; i += 1) view.setInt16(i * 2, i < 4000 ? 0 : 16384, true);
    const env = rmsEnvelope(pcm, 8000, 0.5);
    assert.deepEqual(Array.from(env), [0, 0.5]);
    assert.deepEqual(waveformPeaks([0.1, 0.2, 0.4, 0.2], 2), [0.5, 1]);
  });
});

describe("ffmpeg: arguments and parsing", () => {
  it("never takes a URL: every input is a local file", () => {
    for (const args of [probeArgs("/tmp/a.wav"), envelopeArgs("/tmp/a.wav", "/tmp/f", "/tmp/l"), loudnessMeasureArgs("/tmp/a.wav", { startS: 54, lengthS: 16 })]) {
      const input = args[args.indexOf("-i") + 1]!;
      assert.match(input, /^\//);
    }
  });

  it("fades 0.25 s in and 1.5 s out, ending on the last sample", () => {
    assert.equal(fadeFilter(16), "afade=t=in:st=0:d=0.25,afade=t=out:st=14.5:d=1.5");
  });

  it("normalises to −14 LUFS with peaks at −1 dBTP, AAC 256 kbps", () => {
    const m = { input_i: "-20.1", input_tp: "-3.2", input_lra: "6.0", input_thresh: "-30.4", target_offset: "0.2" };
    const args = cutArgs("/tmp/a.wav", "/tmp/o.m4a", { startS: 54, lengthS: 16 }, m).join(" ");
    assert.match(args, /loudnorm=I=-14:TP=-1:LRA=11:measured_I=-20.1:measured_TP=-3.2:measured_LRA=6.0:measured_thresh=-30.4:offset=0.2:linear=true/);
    assert.match(args, /-ss 54 -t 16 -i \/tmp\/a.wav/);
    assert.match(args, /-c:a aac -b:a 256k/);
  });

  it("muxes without re-encoding", () => {
    assert.match(muxArgs("v.mp4", "a.m4a", "o.mp4").join(" "), /-c:v copy -c:a copy/);
  });

  it("parses ffmpeg's report", () => {
    const wav = "Input #0, wav, from '/tmp/a.wav':\n  Duration: 00:03:12.50, bitrate: 1411 kb/s\n  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 44100 Hz, 2 channels, s16, 1411 kb/s\n";
    assert.deepEqual(parseProbe(wav), { container: "wav", codec: "pcm_s16le", bitrateKbps: 1411, durationS: 192.5 });
    const mp3 = "Input #0, mp3, from 'b.mp3':\n  Duration: 00:02:00.00, start: 0.025057, bitrate: 192 kb/s\n  Stream #0:0: Audio: mp3 (mp3float), 44100 Hz, stereo, fltp, 192 kb/s\n";
    assert.equal(unusableReason(parseProbe(mp3), "b.mp3"), "it's an MP3 under 256 kbps");
    const json = '[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-20.10",\n\t"input_tp" : "-3.20",\n\t"input_lra" : "6.00",\n\t"input_thresh" : "-30.40",\n\t"output_i" : "-14.0",\n\t"target_offset" : "0.20"\n}\n';
    assert.equal(parseLoudness(json)?.input_i, "-20.10");
    assert.equal(parseLoudness("no json"), null);
  });
});

const FFMPEG = path.join(process.cwd(), "node_modules/ffmpeg-static/ffmpeg");

describe("ffmpeg: the real pipeline", { skip: existsSync(FFMPEG) ? false : "ffmpeg-static isn't installed here" }, () => {
  it("finds the drop at 0:32, cuts 0:28–0:44 at −14 LUFS, peaks ≤ −1 dBTP, AAC 256 kbps, and the mux keeps the audio", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "snippet-test-"));
    try {
      const track = path.join(dir, "track.wav");
      execFileSync(FFMPEG, [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "anoisesrc=d=60:c=pink:a=0.05:r=44100",
        "-f", "lavfi", "-i", "sine=f=55:d=60:r=44100",
        "-filter_complex", "[0:a]highpass=f=400,volume=0.6[hi];[1:a]volume='if(gte(t,32),0.9*abs(sin(PI*2*t)),0)':eval=frame[bass];[hi][bass]amix=inputs=2:normalize=0,aformat=channel_layouts=stereo",
        "-c:a", "pcm_s16le", track,
      ]);
      const probe = await probeAudio(track);
      assert.equal(unusableReason(probe, "track.wav"), null);
      const env = await readEnvelopes(track);
      const drop = detectDrop(rmsEnvelope(env.low, ENVELOPE_RATE));
      assert.ok(drop && Math.abs(drop.dropS - 32) <= 0.25, `drop ${JSON.stringify(drop)}`);
      const win = windowForDrop(drop!.dropS, probe!.durationS!);
      assert.equal(win.lengthS, 16);
      const cut = path.join(dir, "cut.m4a");
      await cutSnippet(track, cut, win);
      const report = await runFfmpegArgs(["-hide_banner", "-nostats", "-i", cut, "-af", "ebur128=peak=true", "-f", "null", "-"]);
      const summary = report.split("Summary:")[1] ?? "";
      const lufs = Number(/I:\s+(-?\d+(?:\.\d+)?) LUFS/.exec(summary)?.[1]);
      const peak = Number(/Peak:\s+(-?\d+(?:\.\d+)?) dBFS/.exec(summary)?.[1]);
      assert.ok(Math.abs(lufs + 14) <= 0.5, `integrated ${lufs} LUFS`);
      assert.ok(peak <= -1, `true peak ${peak} dBFS`);
      const out = await probeAudio(cut);
      assert.equal(out?.codec, "aac");
      assert.ok(out!.bitrateKbps! >= 250 && out!.bitrateKbps! <= 260, `bitrate ${out?.bitrateKbps}`);
      assert.ok(Math.abs(out!.durationS! - 16) < 0.1);

      const still = path.join(dir, "still.mp4");
      execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=16", "-c:v", "libx264", "-pix_fmt", "yuv420p", still]);
      const snippet = path.join(dir, "snippet.mp4");
      await muxSnippet(still, cut, snippet);
      const a = execFileSync(FFMPEG, ["-loglevel", "error", "-i", cut, "-map", "0:a", "-c", "copy", "-f", "data", "-"]);
      const b = execFileSync(FFMPEG, ["-loglevel", "error", "-i", snippet, "-map", "0:a", "-c", "copy", "-f", "data", "-"]);
      assert.ok(a.equals(b), "the muxed audio differs from the cut");
      const info = await runFfmpegArgs(["-hide_banner", "-i", snippet, "-t", "0", "-f", "null", "-"]);
      assert.match(info, /1080x1920/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
