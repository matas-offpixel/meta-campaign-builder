/**
 * lib/render-templates/beats.ts — the track's beat grid (kick times), for the
 * montage's cut sheet. Pure: it reads the low-passed mono PCM that
 * lib/creative-tests/audio-ffmpeg.ts readEnvelopes() makes (150 Hz low-pass,
 * 8 kHz, s16le) and never runs ffmpeg itself.
 *
 * The rule (builder's numbers, listed in the PR):
 *   - Low-end level per 5 ms hop (RMS in dB over a 20 ms window).
 *   - Onset strength: the rise in that level from one hop to the next,
 *     negatives dropped, as a kick is a sharp rise in the low end.
 *   - The beat period: the lag (0.4–0.6 s, 100–150 BPM, house and techno)
 *     whose onset autocorrelation is highest, refined to a fraction of a hop.
 *   - The grid is anchored on the drop: the strongest onset within 60 ms of
 *     the stored drop is a kick, and every kick is that one plus a whole
 *     number of periods. Each grid time moves to the onset peak within 30 ms
 *     of it when there is one; a kick with no peak keeps its grid time
 *     (detected: false), so a break with no kick still has a grid.
 */

export const BEAT_RULE = {
  sampleRate: 8000,
  hopS: 0.005,
  windowS: 0.02,
  minPeriodS: 0.4,
  maxPeriodS: 0.6,
  anchorSnapS: 0.06,
  kickSnapS: 0.03,
  /** A peak counts when its onset strength is at least this share of the track's 95th percentile. */
  peakShare: 0.25,
  /** …and at least this share of the drop kick's own onset. */
  kickShareOfDrop: 0.35,
  floorDb: -90,
} as const;

export type BeatGrid = {
  bpm: number;
  periodS: number;
  /** The drop kick, track seconds. */
  anchorS: number;
  /** Every kick from the track's start to its end, track seconds, ascending. */
  kicks: number[];
  /** Per kick: moved onto a detected onset peak (true) or kept on the grid (false). */
  detected: boolean[];
};

/** Low-end level in dB per hop from mono s16le PCM. */
export function lowLevelDb(pcm: Uint8Array, sampleRate: number = BEAT_RULE.sampleRate): Float64Array {
  const samples = Math.floor(pcm.byteLength / 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, samples * 2);
  const hop = Math.max(1, Math.round(sampleRate * BEAT_RULE.hopS));
  const win = Math.max(hop, Math.round(sampleRate * BEAT_RULE.windowS));
  const frames = Math.max(0, Math.floor((samples - win) / hop) + 1);
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < win; i += 1) {
      const v = view.getInt16((start + i) * 2, true) / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / win);
    out[f] = rms > 0 ? Math.max(BEAT_RULE.floorDb, 20 * Math.log10(rms)) : BEAT_RULE.floorDb;
  }
  return out;
}

/** Half-wave rectified first difference of the level: a kick is a sharp rise. Index f is the rise into hop f. */
export function onsetStrength(levelDb: ArrayLike<number>): Float64Array {
  const out = new Float64Array(levelDb.length);
  for (let f = 1; f < levelDb.length; f += 1) out[f] = Math.max(0, levelDb[f]! - levelDb[f - 1]!);
  return out;
}

function percentile(values: ArrayLike<number>, p: number): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))]!;
}

/** The onset time of hop f: the rise lands at the window's centre. */
function hopTime(f: number): number {
  return f * BEAT_RULE.hopS + BEAT_RULE.windowS / 2;
}

/** The beat period in seconds from the onset autocorrelation, refined by a parabola through the best lag. */
export function estimatePeriod(onset: ArrayLike<number>): number {
  const minLag = Math.round(BEAT_RULE.minPeriodS / BEAT_RULE.hopS);
  const maxLag = Math.round(BEAT_RULE.maxPeriodS / BEAT_RULE.hopS);
  const ac = (lag: number) => {
    let s = 0;
    for (let i = lag; i < onset.length; i += 1) s += onset[i]! * onset[i - lag]!;
    return s / Math.max(1, onset.length - lag);
  };
  let best = minLag;
  let bestV = -Infinity;
  const values = new Map<number, number>();
  for (let lag = minLag - 1; lag <= maxLag + 1; lag += 1) values.set(lag, ac(lag));
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const v = values.get(lag)!;
    if (v > bestV) {
      bestV = v;
      best = lag;
    }
  }
  const a = values.get(best - 1)!;
  const b = values.get(best)!;
  const c = values.get(best + 1)!;
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  return (best + shift) * BEAT_RULE.hopS;
}

/** The strongest onset peak within `snapS` of `t`, or null when none reaches the peak bar. */
function peakNear(onset: ArrayLike<number>, t: number, snapS: number, bar: number): { t: number; v: number } | null {
  const from = Math.max(1, Math.floor((t - snapS - BEAT_RULE.windowS / 2) / BEAT_RULE.hopS));
  const to = Math.min(onset.length - 2, Math.ceil((t + snapS - BEAT_RULE.windowS / 2) / BEAT_RULE.hopS));
  let best: { t: number; v: number } | null = null;
  for (let f = from; f <= to; f += 1) {
    const v = onset[f]!;
    if (v < bar || v < onset[f - 1]! || v < onset[f + 1]!) continue;
    const at = hopTime(f);
    if (Math.abs(at - t) > snapS) continue;
    if (!best || v > best.v) best = { t: at, v };
  }
  return best;
}

/**
 * The grid for a track whose drop is at `dropS` (creative_lab_audio_files.drop_s).
 * `durationS` bounds the grid; it defaults to the PCM's own length.
 */
export function beatGrid(lowPcm: Uint8Array, dropS: number, opts: { sampleRate?: number; durationS?: number } = {}): BeatGrid {
  const sampleRate = opts.sampleRate ?? BEAT_RULE.sampleRate;
  const level = lowLevelDb(lowPcm, sampleRate);
  const onset = onsetStrength(level);
  return gridFromOnsets(onset, dropS, opts.durationS ?? lowPcm.byteLength / 2 / sampleRate);
}

/** The same, from onset strength already made (tests and the cut sheet's re-reads). */
export function gridFromOnsets(onset: ArrayLike<number>, dropS: number, durationS: number): BeatGrid {
  const floorBar = percentile(onset, 0.95) * BEAT_RULE.peakShare;
  const period = estimatePeriod(onset);
  const anchorPeak = peakNear(onset, dropS, BEAT_RULE.anchorSnapS, floorBar);
  const anchor = anchorPeak?.t ?? dropS;
  // A kick is as hard as the drop's within a factor: weaker rises (a pad, a bass line) aren't kicks.
  const bar = Math.max(floorBar, (anchorPeak?.v ?? 0) * BEAT_RULE.kickShareOfDrop);
  // Track out from the drop, each kick predicted from the last one found, so a
  // tempo a hair off the estimate never drifts off the kicks.
  const walk = (dir: 1 | -1): { t: number; detected: boolean }[] => {
    const out: { t: number; detected: boolean }[] = [];
    let last = anchor;
    for (;;) {
      const pred = last + dir * period;
      if (pred < 0 || pred > durationS) break;
      const peak = peakNear(onset, pred, BEAT_RULE.kickSnapS, bar);
      last = peak?.t ?? pred;
      out.push({ t: last, detected: Boolean(peak) });
    }
    return out;
  };
  const all = [...walk(-1).reverse(), { t: anchor, detected: Boolean(anchorPeak) }, ...walk(1)];
  const kicks = all.map((k) => Math.round(k.t * 10000) / 10000);
  const detected = all.map((k) => k.detected);
  return { bpm: Math.round((60 / period) * 100) / 100, periodS: period, anchorS: Math.round(anchor * 10000) / 10000, kicks, detected };
}
