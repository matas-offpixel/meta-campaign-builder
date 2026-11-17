/**
 * When the caption-placement face check samples a clip's window.
 *
 * A fixed 2 fps grid locks onto anything that repeats at 2 Hz (a head-bob at
 * 120 BPM: #1311 review). These schemes break the lock, each seeded per clip
 * (clip id + crop + window), so a re-check picks the same frames and a crop
 * change picks new ones:
 *   - uniform: every 1 / fps.
 *   - jitter: each gap drawn from [minGap, maxGap].
 *   - slot: one sample in each `slot`-long slot, at a random offset inside
 *     [k·slot, k·slot + phase).
 * Stored samples carry each one's real time (`t`), so placement judges runs
 * and shares from the actual gaps.
 *
 * No `@/` imports: node --test cannot resolve them.
 */

export type SamplingScheme =
  | { kind: "uniform"; fps: number }
  | { kind: "jitter"; minGap: number; maxGap: number }
  | { kind: "slot"; slot: number; phase: number };

/** A small, fast seeded generator (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a over the clip id, crop and window: the same clip and crop give the same frames. */
export function faceSampleSeed(clip: { id: string; cropFocusX: number; cropFocusY: number; inS: number | null; outS: number | null }): number {
  const key = `${clip.id}|${clip.cropFocusX.toFixed(4)}|${clip.cropFocusY.toFixed(4)}|${clip.inS ?? ""}|${clip.outS ?? ""}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** Sample times in seconds from the window start, ascending, all inside [0, durationS). */
export function sampleTimes(durationS: number, scheme: SamplingScheme, seed: number): number[] {
  const out: number[] = [];
  if (!(durationS > 0)) return out;
  const rnd = seededRandom(seed);
  if (scheme.kind === "uniform") {
    for (let i = 0; i / scheme.fps < durationS - 1e-9; i += 1) out.push(i / scheme.fps);
    return out;
  }
  if (scheme.kind === "jitter") {
    for (let t = 0; t < durationS - 1e-9; t += scheme.minGap + rnd() * (scheme.maxGap - scheme.minGap)) out.push(t);
    return out;
  }
  for (let k = 0; k * scheme.slot < durationS - 1e-9; k += 1) {
    const t = k * scheme.slot + rnd() * scheme.phase;
    if (t < durationS - 1e-9) out.push(t);
  }
  return out;
}

/**
 * Times snapped to the source's frames (what ffmpeg can pick), duplicates dropped. With the window's length,
 * a time in the final half-frame is clamped to the last frame, ceil(D·fps) − 1: rounding it up asks for a frame
 * that doesn't exist (review of 7d4cca1).
 */
export function snapToFrames(times: readonly number[], sourceFps: number, durationS?: number): { frame: number; t: number }[] {
  const last = durationS != null && durationS > 0 ? Math.max(0, Math.ceil(durationS * sourceFps - 1e-9) - 1) : Number.POSITIVE_INFINITY;
  const seen = new Set<number>();
  const out: { frame: number; t: number }[] = [];
  for (const t of times) {
    const frame = Math.min(last, Math.max(0, Math.round(t * sourceFps)));
    if (seen.has(frame)) continue;
    seen.add(frame);
    out.push({ frame, t: frame / sourceFps });
  }
  return out;
}
