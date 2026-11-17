/**
 * VW1 on generated sound: no real tracks in fixtures. Each clip is seeded
 * noise whose every 50 ms step is scaled to an exact level, so a step from
 * one level to the next is an exact rise in dB with a sharp onset at its
 * start.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DROP_RULE, analyseClipSound, dropCandidates, integratedLufs, loudnessSteps, onsetSteps, pcmSamples } from "../clip-drops.ts";
import { mainDropOf } from "../edit-window.ts";

/** VW7's main drop over a decoded clip, on the sound's own length. */
const mainOf = (sound: ReturnType<typeof analyseClipSound>) => mainDropOf({ candidates: sound.candidates, durationS: sound.soundS })?.tS ?? null;

/** Loudness steps (one per 50 ms) from segments of [seconds, dB], for the pure candidate rules. */
function steps(segments: [number, number][]): number[] {
  return segments.flatMap(([seconds, level]) => Array.from({ length: Math.round(seconds / DROP_RULE.frameS) }, () => level));
}

const RATE = DROP_RULE.sampleRate;
const STEP = Math.round(RATE * DROP_RULE.frameS);

/** Mulberry32: the same noise every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Segments of [seconds, level dBFS RMS, or null for digital silence]. Seconds are whole 50 ms steps. */
function clip(segments: [number, number | null][], seed = 7): Float32Array {
  const random = rng(seed);
  const total = segments.reduce((sum, [s]) => sum + Math.round(s / DROP_RULE.frameS) * STEP, 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const [seconds, level] of segments) {
    const steps = Math.round(seconds / DROP_RULE.frameS);
    for (let f = 0; f < steps; f += 1) {
      if (level == null) {
        at += STEP;
        continue;
      }
      const raw = Array.from({ length: STEP }, () => random() * 2 - 1);
      const rms = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0) / STEP);
      const want = 10 ** (level / 20);
      for (let i = 0; i < STEP; i += 1) out[at + i] = (raw[i]! / rms) * want;
      at += STEP;
    }
  }
  return out;
}

describe("VW1 · finding the drop", () => {
  it("finds a clear drop at its onset, with its rise", () => {
    const sound = analyseClipSound(clip([[10, -32], [20, -22]]));
    assert.equal(sound.hasSound, true);
    assert.equal(sound.candidates.length, 1);
    assert.ok(Math.abs(sound.candidates[0]!.tS - 10) <= 0.1 + 1e-9, `drop at ${sound.candidates[0]!.tS}`);
    assert.ok(Math.abs(sound.candidates[0]!.riseDb - 10) <= 0.1, `rise ${sound.candidates[0]!.riseDb}`);
    // The 2 s after are the loudest 2 s in the clip; the onset is data.
    assert.equal(sound.candidates[0]!.afterDb, 0);
    assert.ok(sound.candidates[0]!.onsetS != null && sound.candidates[0]!.onsetS <= 0.1 + 1e-9);
    assert.equal(mainOf(sound), sound.candidates[0]!.tS);
  });

  it("finds a 6 dB rise, its rise point within 0.1 s of the step", () => {
    const sound = analyseClipSound(clip([[12, -30], [20, -24]]));
    assert.equal(sound.candidates.length, 1);
    assert.ok(Math.abs(sound.candidates[0]!.tS - 12) <= 0.1 + 1e-9);
    assert.ok(sound.candidates[0]!.riseDb >= 5.99);
  });

  it("doesn't take a 5 dB rise", () => {
    const sound = analyseClipSound(clip([[12, -30], [20, -25]]));
    assert.deepEqual(sound.candidates, []);
    assert.equal(mainOf(sound), null);
  });

  it("VW7: two major drops that both fit: the later is the main drop, and both are kept", () => {
    // 8 s rises 10 dB; 22 s rises 10.5 dB after a dip. (#1319's "the earlier wins" is retired.)
    const sound = analyseClipSound(clip([[8, -36], [8, -26], [6, -36], [18, -25.5]]));
    assert.deepEqual(sound.candidates.map((c) => Math.round(c.tS)), [8, 22]);
    assert.equal(Math.round(mainOf(sound)!), 22);
  });

  it("VW7: clip 27's shape: the lead-in kick rises most, the later drop lands loudest and wins", () => {
    // A kick out of near-silence at 8 s (14 dB), then the drop at 18 s (10 dB) to the clip's loudest level.
    const sound = analyseClipSound(clip([[8, -46], [10, -32], [16, -22]]));
    assert.deepEqual(sound.candidates.map((c) => Math.round(c.tS)), [8, 18]);
    const [kick, drop] = sound.candidates;
    assert.ok(kick!.riseDb > drop!.riseDb + 3, "the drop is major by its level, not its rise");
    assert.equal(drop!.afterDb, 0);
    assert.equal(Math.round(mainOf(sound)!), 18);
  });

  it("candidates closer than 4 s are one, the larger rise kept", () => {
    // A 7 dB step at 8 s, then a further 9 dB step at 10 s.
    const sound = analyseClipSound(clip([[8, -40], [2, -33], [20, -24]]));
    assert.equal(sound.candidates.length, 1);
    assert.equal(Math.round(sound.candidates[0]!.tS), 10);
  });

  it("VW7: a 6 dB rise with no onset peak is a candidate (the slow-swell test is retired)", () => {
    // Loudness alone, no flux: a 7 dB step has no onset peak at all, and is still a candidate.
    const candidates = dropCandidates(steps([[10, -34], [10, -27]]));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.tS, 10);
    assert.equal(candidates[0]!.onsetS, null);
    // And from sound: a 17 dB ramp over 2.3 s (clip 30's approved drop is one) is a candidate.
    const ramp: [number, number][] = Array.from({ length: 46 }, (_, i) => [0.05, -34 + (17 * (i + 1)) / 46]);
    const sound = analyseClipSound(clip([[9.2, -34], ...ramp, [16, -17]]));
    assert.equal(sound.candidates.length, 1);
    assert.ok(sound.candidates[0]!.tS > 9 && sound.candidates[0]!.tS < 11.6, `${sound.candidates[0]!.tS}`);
  });

  it("merged within 4 s: 3.95 s apart is one candidate (the larger rise); 4.0 s (not closer than 4 s, VW1) and 4.05 s apart are two", () => {
    assert.deepEqual(dropCandidates(steps([[8, -40], [4, -33], [16, -24]])).map((c) => c.tS), [8, 12]);
    const close = dropCandidates(steps([[8, -40], [3.95, -33], [16, -24]]));
    assert.deepEqual(close.map((c) => [c.tS, c.riseDb]), [[11.95, 9]]);
    const apart = dropCandidates(steps([[8, -40], [4.05, -33], [16, -24]]));
    assert.deepEqual(apart.map((c) => [c.tS, c.riseDb]), [[8, 7], [12.05, 9]]);
  });

  it("finds no drop in steady sound", () => {
    const sound = analyseClipSound(clip([[30, -20]]));
    assert.equal(sound.hasSound, true);
    assert.deepEqual(sound.candidates, []);
  });

  it("finds a drop too near the end and reports it all the same", () => {
    const sound = analyseClipSound(clip([[24.8, -30], [6.2, -20]]));
    assert.equal(sound.candidates.length, 1);
    assert.ok(Math.abs(sound.candidates[0]!.tS - 24.8) <= 0.1 + 1e-9);
    assert.equal(sound.soundS, 31);
    // It can't fit VW2 (6.2 s after), so there's no main drop.
    assert.equal(mainOf(sound), null);
  });

  it("silence and a whisper under −50 LUFS are no sound", () => {
    assert.equal(analyseClipSound(clip([[20, null]])).hasSound, false);
    assert.equal(integratedLufs(clip([[20, null]]), RATE), null);
    const whisper = analyseClipSound(clip([[20, -60]]));
    assert.equal(whisper.hasSound, false);
    assert.deepEqual(whisper.candidates, []);
  });

  it("measures integrated loudness near the signal's level", () => {
    // White noise at −20 dBFS RMS reads about −20 LUFS once K-weighted (the shelf lifts the top).
    const lufs = integratedLufs(clip([[10, -20]]), RATE)!;
    assert.ok(lufs > -21.5 && lufs < -17, `lufs ${lufs}`);
  });

  it("decodes little-endian s16", () => {
    const bytes = new Uint8Array([0x00, 0x40, 0x00, 0xc0]);
    assert.deepEqual(Array.from(pcmSamples(bytes)), [0.5, -0.5]);
  });

  it("the main drop is null with no candidate, and the pieces agree with the whole", () => {
    assert.equal(mainDropOf({ candidates: [], durationS: 30 }), null);
    const samples = clip([[10, -32], [20, -22]]);
    const db = loudnessSteps(samples, RATE);
    assert.deepEqual(dropCandidates(db, onsetSteps(samples, RATE, db.length)), analyseClipSound(samples).candidates);
  });

  it("draws the waveform as peaks 0..1", () => {
    const peaks = analyseClipSound(clip([[10, -32], [20, -22]])).peaks;
    assert.equal(peaks.length, DROP_RULE.peaks);
    assert.equal(Math.max(...peaks), 1);
    assert.ok(peaks[0]! < 0.5);
  });
});
