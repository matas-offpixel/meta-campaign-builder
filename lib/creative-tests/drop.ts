/**
 * CT4: finding the drop, and the waveform drawn under the marker. Pure: it
 * reads energy envelopes ffmpeg produced (audio-ffmpeg.ts) and never runs
 * ffmpeg itself.
 *
 * The rule (CT4): "the biggest rise in low-end energy after a build, past
 * the first 20 seconds". In numbers (invented here, listed in the PR):
 *
 *   - The low end is the track low-passed at 150 Hz, as RMS per 50 ms frame,
 *     in dB.
 *   - At each frame t past 20 s, the rise is the mean level over the 2 s
 *     after t minus the mean over the 4 s before it. A build is what comes
 *     before a drop: the bass thins out, so the 4 s before sit low.
 *   - The drop is the frame with the biggest rise, moved to the steepest
 *     single step within half a second of it, so the marker lands on the hit.
 *   - Clear: the rise is at least 6 dB, and the 2 s after reach the track's
 *     own loud low end (at least its 60th percentile). Otherwise there's no
 *     clear drop, and the marker waits for the operator.
 */

export const DROP_RULE = {
  /** Envelope frame, seconds. */
  frameS: 0.05,
  /** Low-pass corner for the low end, Hz. */
  lowpassHz: 150,
  searchFromS: 20,
  beforeS: 4,
  afterS: 2,
  /** The least rise that counts as a drop, dB. */
  minRiseDb: 6,
  /** The 2 s after must reach this percentile of the track's low end. */
  loudPercentile: 0.6,
  /** The marker moves to the steepest step within this of the best frame. */
  snapS: 0.5,
  /** Below this the frame is silence, dB. */
  floorDb: -90,
} as const;

/** RMS → dB, floored. */
export function toDb(rms: number): number {
  if (!(rms > 0)) return DROP_RULE.floorDb;
  return Math.max(DROP_RULE.floorDb, 20 * Math.log10(rms));
}

/** RMS per frame of mono 16-bit PCM (little endian), as linear amplitude 0..1. */
export function rmsEnvelope(pcm: Uint8Array, sampleRate: number, frameS: number = DROP_RULE.frameS): Float64Array {
  const samples = Math.floor(pcm.byteLength / 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, samples * 2);
  const perFrame = Math.max(1, Math.round(sampleRate * frameS));
  const frames = Math.floor(samples / perFrame);
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const start = f * perFrame;
    for (let i = 0; i < perFrame; i += 1) {
      const v = view.getInt16((start + i) * 2, true) / 32768;
      sum += v * v;
    }
    out[f] = Math.sqrt(sum / perFrame);
  }
  return out;
}

function mean(values: ArrayLike<number>, from: number, to: number): number {
  const a = Math.max(0, from);
  const b = Math.min(values.length, to);
  if (b <= a) return DROP_RULE.floorDb;
  let sum = 0;
  for (let i = a; i < b; i += 1) sum += values[i]!;
  return sum / (b - a);
}

function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Array.from(values).sort((x, y) => x - y);
  if (!sorted.length) return DROP_RULE.floorDb;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]!;
}

export type DropResult = { dropS: number; riseDb: number } | null;

/** CT4's drop from the low-end RMS envelope (one value per frame), or null when there's no clear one. */
export function detectDrop(lowRms: ArrayLike<number>, frameS: number = DROP_RULE.frameS): DropResult {
  const db = Array.from(lowRms, toDb);
  const before = Math.round(DROP_RULE.beforeS / frameS);
  const after = Math.round(DROP_RULE.afterS / frameS);
  const from = Math.max(before, Math.round(DROP_RULE.searchFromS / frameS));
  let best = -1;
  let bestRise = -Infinity;
  for (let t = from; t + after <= db.length; t += 1) {
    const rise = mean(db, t, t + after) - mean(db, t - before, t);
    if (rise > bestRise) {
      bestRise = rise;
      best = t;
    }
  }
  if (best < 0 || bestRise < DROP_RULE.minRiseDb) return null;
  // A hundredth of a dB of slack: a run of equal frames must not fail on float rounding.
  if (mean(db, best, best + after) < percentile(db, DROP_RULE.loudPercentile) - 0.01) return null;
  const snap = Math.round(DROP_RULE.snapS / frameS);
  let hit = best;
  let steepest = -Infinity;
  for (let t = Math.max(from, best - snap); t <= Math.min(db.length - 1, best + snap); t += 1) {
    const step = db[t]! - db[t - 1]!;
    if (step > steepest) {
      steepest = step;
      hit = t;
    }
  }
  return { dropS: Math.round(hit * frameS * 1000) / 1000, riseDb: Math.round(bestRise * 10) / 10 };
}

/** The waveform under the marker (CT4): `buckets` peaks 0..1 over the whole track, from a full-band RMS envelope. */
export function waveformPeaks(rms: ArrayLike<number>, buckets = 400): number[] {
  if (!rms.length) return [];
  const n = Math.max(1, Math.min(buckets, rms.length));
  const out: number[] = [];
  let top = 0;
  for (let b = 0; b < n; b += 1) {
    const from = Math.floor((b * rms.length) / n);
    const to = Math.max(from + 1, Math.floor(((b + 1) * rms.length) / n));
    let peak = 0;
    for (let i = from; i < to; i += 1) peak = Math.max(peak, rms[i]!);
    out.push(peak);
    top = Math.max(top, peak);
  }
  return top > 0 ? out.map((p) => Math.round((p / top) * 1000) / 1000) : out;
}
