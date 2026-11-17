/**
 * VW1 (docs/design-record/2026-11-17-creative-lab-video-window.html): the
 * drops in a clip's own sound. Pure: it reads mono 16-bit PCM that ffmpeg
 * decoded (clip-drops-run.ts) and never runs ffmpeg itself.
 *
 * Two measures on a mono mix in 50 ms steps:
 *   - loudness: short-term RMS per step, in dB;
 *   - onset strength: spectral flux, how sharply the spectrum changes from
 *     one step to the next (a kick, a snare or the bass coming in).
 *
 * A candidate is a moment where the 2 s after it are at least 6 dB louder
 * than the 2 s before it, with an onset peak within 0.1 s of it. The drop's
 * time is that onset peak. Candidates closer than 4 s are one, the larger
 * rise kept. The main drop is the largest rise; two within 1 dB, the
 * earlier wins.
 *
 * Every figure is in DROP_RULE. The record lists them as the build's
 * starting values for Matas to tune on real clips. The ones it doesn't name
 * (the onset peak's height, the least of the 2 s a side may be cut by the
 * clip's start or end) are marked "build's own" below.
 */

export const DROP_RULE = {
  /** VW1: the step, seconds. */
  frameS: 0.05,
  /** VW1: the span after and before a moment that is compared, seconds. */
  sideS: 2,
  /** VW1: the least rise, dB, the 2 s after over the 2 s before. */
  minRiseDb: 6,
  /** VW1: an onset peak this close to the moment, seconds. */
  onsetWithinS: 0.1,
  /** VW1: candidates closer than this are one, seconds. */
  mergeS: 4,
  /** VW1: two candidates within this of each other, dB: the earlier is the main drop. */
  tieDb: 1,
  /** VW3: the whole clip under this is no sound, LUFS. */
  silenceLufs: -50,
  /** Build's own: a side cut by the clip's start or end still needs this much sound, seconds. */
  minSideS: 0.5,
  /** Build's own: an onset peak is a local maximum at least this many times the clip's median flux. */
  onsetOverMedian: 2,
  /** Build's own: below this a step is silence, dB. */
  floorDb: -90,
  /** Build's own: FFT size for the flux, samples (64 ms at 16 kHz). */
  fftSize: 1024,
  /** Build's own: the flux's bands, equal width (250 Hz each at 16 kHz). */
  fluxBands: 32,
  /** The decode rate ffmpeg is asked for, Hz. */
  sampleRate: 16000,
  /** The waveform drawn under the picker: this many peaks over the whole clip. */
  peaks: 240,
} as const;

export type DropCandidate = { tS: number; riseDb: number };

export type SoundAnalysis = {
  /** Integrated loudness (BS.1770, gated) of the mono mix, or null when every block is under the absolute gate. */
  lufs: number | null;
  /** False when the clip is under VW3's −50 LUFS. */
  hasSound: boolean;
  /** Every candidate, in time order. */
  candidates: DropCandidate[];
  /** The main drop's time, or null with no candidate. */
  mainS: number | null;
  /** Waveform peaks 0..1 over the whole decoded sound. */
  peaks: number[];
  /** The decoded sound's length, seconds. */
  soundS: number;
};

const round = (n: number, dp: number) => {
  const k = 10 ** dp;
  return Math.round(n * k) / k;
};

/** Little-endian s16 bytes → samples −1..1. */
export function pcmSamples(pcm: Uint8Array): Float32Array {
  const n = Math.floor(pcm.byteLength / 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

function toDb(meanSquare: number): number {
  if (!(meanSquare > 0)) return DROP_RULE.floorDb;
  return Math.max(DROP_RULE.floorDb, 10 * Math.log10(meanSquare));
}

/** VW1's loudness: RMS per 50 ms step, in dB. */
export function loudnessSteps(samples: Float32Array, sampleRate: number): Float64Array {
  const per = Math.max(1, Math.round(sampleRate * DROP_RULE.frameS));
  const frames = Math.floor(samples.length / per);
  const out = new Float64Array(frames);
  for (let f = 0; f < frames; f += 1) {
    let sum = 0;
    const start = f * per;
    for (let i = 0; i < per; i += 1) {
      const v = samples[start + i]!;
      sum += v * v;
    }
    out[f] = toDb(sum / per);
  }
  return out;
}

/** In-place radix-2 FFT. `re` and `im` are the same power-of-two length. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/**
 * VW1's onset strength: spectral flux per 50 ms step. Each step's spectrum
 * is a Hann-windowed FFT centred on the step's start, summed into 32 bands
 * of equal width (a band's log energy is steadier than one bin's, so crowd
 * noise doesn't read as onsets). The flux is the mean, over the bands, of
 * the rise in log energy since the step before; falls count as nothing.
 * Step 0 has no step before it, so its flux is 0.
 */
export function onsetSteps(samples: Float32Array, sampleRate: number, frames: number): Float64Array {
  const size = DROP_RULE.fftSize;
  const half = size / 2;
  const bands = DROP_RULE.fluxBands;
  const perBand = Math.floor(half / bands);
  const per = Math.max(1, Math.round(sampleRate * DROP_RULE.frameS));
  const hann = new Float64Array(size);
  for (let i = 0; i < size; i += 1) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const out = new Float64Array(frames);
  let previous: Float64Array | null = null;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let f = 0; f < frames; f += 1) {
    const centre = f * per;
    for (let i = 0; i < size; i += 1) {
      const at = centre - half + i;
      re[i] = at >= 0 && at < samples.length ? samples[at]! * hann[i]! : 0;
      im[i] = 0;
    }
    fft(re, im);
    const energy = new Float64Array(bands);
    for (let b = 0; b < bands; b += 1) {
      let sum = 0;
      for (let k = b * perBand; k < (b + 1) * perBand; k += 1) sum += re[k]! * re[k]! + im[k]! * im[k]!;
      energy[b] = Math.log(1e-10 + sum);
    }
    if (previous) {
      let sum = 0;
      for (let b = 0; b < bands; b += 1) sum += Math.max(0, energy[b]! - previous[b]!);
      out[f] = sum / bands;
    }
    previous = energy;
  }
  return out;
}

function median(values: ArrayLike<number>): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The steps that are onset peaks: a local maximum within ±0.1 s, at least twice the clip's median flux. */
export function onsetPeaks(flux: ArrayLike<number>): number[] {
  const reach = Math.round(DROP_RULE.onsetWithinS / DROP_RULE.frameS);
  const floor = median(flux) * DROP_RULE.onsetOverMedian;
  const peaks: number[] = [];
  for (let t = 1; t < flux.length; t += 1) {
    const v = flux[t]!;
    if (!(v > 0) || v < floor) continue;
    let top = true;
    for (let k = Math.max(0, t - reach); k <= Math.min(flux.length - 1, t + reach) && top; k += 1) {
      if (k === t) continue;
      // A plateau's first step is its peak.
      if (flux[k]! > v || (flux[k]! === v && k < t)) top = false;
    }
    if (top) peaks.push(t);
  }
  return peaks;
}

/** The mean of steps [from, to), or null when fewer than VW1's minimum side are inside the clip. */
function sideMean(db: ArrayLike<number>, from: number, to: number): number | null {
  const a = Math.max(0, from);
  const b = Math.min(db.length, to);
  if (b - a < Math.round(DROP_RULE.minSideS / DROP_RULE.frameS)) return null;
  let sum = 0;
  for (let i = a; i < b; i += 1) sum += db[i]!;
  return sum / (b - a);
}

/** The rise at each step: the 2 s after over the 2 s before, dB. NaN where a side is too short. */
export function riseSteps(db: ArrayLike<number>): Float64Array {
  const side = Math.round(DROP_RULE.sideS / DROP_RULE.frameS);
  const out = new Float64Array(db.length);
  for (let t = 0; t < db.length; t += 1) {
    const after = sideMean(db, t, t + side);
    const before = sideMean(db, t - side, t);
    out[t] = after == null || before == null ? Number.NaN : after - before;
  }
  return out;
}

/**
 * VW1's candidates from the two measures: each moment rising 6 dB with an
 * onset peak within 0.1 s gives a candidate at that peak with that rise
 * (the largest rise when several moments share a peak), then candidates
 * closer than 4 s are merged, the larger rise kept (the earlier on a tie).
 */
export function dropCandidates(db: ArrayLike<number>, flux: ArrayLike<number>): DropCandidate[] {
  const rise = riseSteps(db);
  const peaks = onsetPeaks(flux);
  const reach = Math.round(DROP_RULE.onsetWithinS / DROP_RULE.frameS);
  const byPeak = new Map<number, number>();
  for (let t = 0; t < rise.length; t += 1) {
    const r = rise[t]!;
    // A hundredth of a dB of slack: frame RMS of an exact 6 dB step must not fail on float rounding.
    if (!(r >= DROP_RULE.minRiseDb - 0.01)) continue;
    let nearest = -1;
    for (const p of peaks) {
      if (Math.abs(p - t) > reach) continue;
      if (nearest < 0 || Math.abs(p - t) < Math.abs(nearest - t)) nearest = p;
    }
    if (nearest < 0) continue;
    byPeak.set(nearest, Math.max(byPeak.get(nearest) ?? -Infinity, r));
  }
  const raw = [...byPeak.entries()].map(([step, r]) => ({ step, riseDb: r }));
  raw.sort((a, b) => b.riseDb - a.riseDb || a.step - b.step);
  const merge = DROP_RULE.mergeS / DROP_RULE.frameS;
  const kept: typeof raw = [];
  for (const c of raw) {
    if (kept.some((k) => Math.abs(k.step - c.step) < merge - 1e-9)) continue;
    kept.push(c);
  }
  return kept
    .sort((a, b) => a.step - b.step)
    .map((c) => ({ tS: round(c.step * DROP_RULE.frameS, 3), riseDb: round(c.riseDb, 1) }));
}

/** VW1's main drop: the largest rise; any within 1 dB of it, the earliest. */
export function mainDrop(candidates: readonly DropCandidate[]): DropCandidate | null {
  if (!candidates.length) return null;
  const top = Math.max(...candidates.map((c) => c.riseDb));
  return [...candidates].filter((c) => c.riseDb >= top - DROP_RULE.tieDb - 1e-9).sort((a, b) => a.tS - b.tS)[0] ?? null;
}

// ─── Loudness for "no sound" (VW3): ITU-R BS.1770 K-weighting, gated ─────────

type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** The two K-weighting stages at any rate (BS.1770's analogue prototypes, bilinear). */
function kWeighting(rate: number): Biquad[] {
  const shelf = (() => {
    const G = 3.999843853973347;
    const Q = 0.7071752369554196;
    const fc = 1681.974450955533;
    const A = 10 ** (G / 40);
    const w0 = (2 * Math.PI * fc) / rate;
    const alpha = Math.sin(w0) / (2 * Q);
    const cos = Math.cos(w0);
    const b0 = A * ((A + 1) + (A - 1) * cos + 2 * Math.sqrt(A) * alpha);
    const b1 = -2 * A * ((A - 1) + (A + 1) * cos);
    const b2 = A * ((A + 1) + (A - 1) * cos - 2 * Math.sqrt(A) * alpha);
    const a0 = (A + 1) - (A - 1) * cos + 2 * Math.sqrt(A) * alpha;
    const a1 = 2 * ((A - 1) - (A + 1) * cos);
    const a2 = (A + 1) - (A - 1) * cos - 2 * Math.sqrt(A) * alpha;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  })();
  const highpass = (() => {
    const Q = 0.5003270373238773;
    const fc = 38.13547087602444;
    const w0 = (2 * Math.PI * fc) / rate;
    const alpha = Math.sin(w0) / (2 * Q);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
  })();
  return [shelf, highpass];
}

function filter(samples: Float32Array, q: Biquad): Float64Array {
  const out = new Float64Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x = samples[i]!;
    const y = q.b0 * x + q.b1 * x1 + q.b2 * x2 - q.a1 * y1 - q.a2 * y2;
    out[i] = y;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
  }
  return out;
}

/** Gated integrated loudness of a mono signal, LUFS, or null when no 400 ms block passes −70 LUFS. */
export function integratedLufs(samples: Float32Array, rate: number): number | null {
  const [shelf, highpass] = kWeighting(rate);
  const weighted = filter(Float32Array.from(filter(samples, shelf!)), highpass!);
  const block = Math.round(0.4 * rate);
  const hop = Math.round(0.1 * rate);
  const powers: number[] = [];
  for (let start = 0; start + block <= weighted.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + block; i += 1) sum += weighted[i]! * weighted[i]!;
    powers.push(sum / block);
  }
  const loud = (z: number) => -0.691 + 10 * Math.log10(z);
  const absolute = powers.filter((z) => z > 0 && loud(z) > -70);
  if (!absolute.length) return null;
  const relative = loud(absolute.reduce((a, b) => a + b, 0) / absolute.length) - 10;
  const gated = absolute.filter((z) => loud(z) > relative);
  if (!gated.length) return null;
  return round(loud(gated.reduce((a, b) => a + b, 0) / gated.length), 1);
}

/** Waveform peaks 0..1 over `buckets` spans of the loudness steps. */
export function waveformPeaks(db: ArrayLike<number>, buckets: number = DROP_RULE.peaks): number[] {
  if (!db.length) return [];
  const n = Math.max(1, Math.min(buckets, db.length));
  const amp = Array.from(db, (v) => (v <= DROP_RULE.floorDb ? 0 : 10 ** (v / 20)));
  const out: number[] = [];
  for (let b = 0; b < n; b += 1) {
    const from = Math.floor((b * amp.length) / n);
    const to = Math.max(from + 1, Math.floor(((b + 1) * amp.length) / n));
    let peak = 0;
    for (let i = from; i < to; i += 1) peak = Math.max(peak, amp[i]!);
    out.push(peak);
  }
  const top = Math.max(...out);
  return top > 0 ? out.map((p) => round(p / top, 2)) : out.map(() => 0);
}

/** VW1 over a decoded clip: loudness, onsets, candidates, the main drop, and the waveform. */
export function analyseClipSound(samples: Float32Array, sampleRate: number = DROP_RULE.sampleRate): SoundAnalysis {
  const db = loudnessSteps(samples, sampleRate);
  const lufs = integratedLufs(samples, sampleRate);
  const hasSound = lufs != null && lufs >= DROP_RULE.silenceLufs;
  const soundS = round(samples.length / sampleRate, 3);
  if (!hasSound) return { lufs, hasSound, candidates: [], mainS: null, peaks: waveformPeaks(db), soundS };
  const flux = onsetSteps(samples, sampleRate, db.length);
  const candidates = dropCandidates(db, flux);
  return { lufs, hasSound, candidates, mainS: mainDrop(candidates)?.tS ?? null, peaks: waveformPeaks(db), soundS };
}
