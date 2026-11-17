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

/** The largest gap the face check allows between checked frames, window start and end included (design, 17 Nov). */
export const FACE_MAX_GAP_S = 0.4;

/**
 * The scheme's times as source frames (ffmpeg's n after the seek), so that no gap between picks, from the
 * window start to the first pick or from the last pick to the window end, is over FACE_MAX_GAP_S.
 *   - Each time rounds to its nearest frame, but never past FACE_MAX_GAP_S after the pick before it: rounding
 *     alone could stretch a 0.4 s gap by up to a frame.
 *   - Nothing is past the window's last frame, ceil(D·fps) − 1 (review of 7d4cca1: rounding up asked ffmpeg
 *     for a frame that doesn't exist). Two picks on one frame keep one; the gap rule still holds because the
 *     next pick is placed from the kept one.
 *   - If the last pick is more than FACE_MAX_GAP_S before the window end, picks are added toward the last frame.
 */
export function planFrames(times: readonly number[], sourceFps: number, durationS: number, maxGap = FACE_MAX_GAP_S): { frame: number; t: number }[] {
  const out: { frame: number; t: number }[] = [];
  if (!(durationS > 0) || !(sourceFps > 0)) return out;
  const lastFrame = Math.max(0, Math.ceil(durationS * sourceFps - 1e-9) - 1);
  const reach = (from: number) => Math.floor((from + maxGap) * sourceFps + 1e-9);
  let prev = -1;
  const push = (frame: number) => {
    if (frame <= prev) return;
    out.push({ frame, t: frame / sourceFps });
    prev = frame;
  };
  for (const t of times) {
    let frame = Math.min(lastFrame, Math.max(0, Math.round(t * sourceFps)));
    frame = Math.min(frame, prev < 0 ? reach(0) : reach(prev / sourceFps));
    push(frame);
  }
  while (prev < lastFrame && durationS - Math.max(0, prev) / sourceFps > maxGap + 1e-9) {
    const next = Math.min(lastFrame, prev < 0 ? reach(0) : reach(prev / sourceFps));
    if (next <= prev) break; // under 1 / maxGap fps: the gap check after the pull reports it
    push(next);
  }
  return out;
}

/** The largest gap between ascending times, counting window start to the first and the last to window end. */
export function largestGap(times: readonly number[], startS: number, endS: number): number {
  if (!times.length) return Math.max(0, endS - startS);
  let gap = Math.max(0, times[0]! - startS, endS - times[times.length - 1]!);
  for (let i = 1; i < times.length; i += 1) gap = Math.max(gap, times[i]! - times[i - 1]!);
  return gap;
}
