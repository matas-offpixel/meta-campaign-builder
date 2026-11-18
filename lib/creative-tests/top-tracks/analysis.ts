/**
 * Top tracks (docs/design-record/2026-11-18-creative-lab-top-tracks.html, TK3):
 * reading a whole track for its kicks, its drops and its pitch content. Pure:
 * it takes mono PCM at 16 kHz (ffmpeg.ts decodes it) and never runs ffmpeg.
 *
 * Drops are found as VW14 finds them in a clip
 * (docs/design-record/2026-11-18-creative-lab-video-window-4.html), judged
 * against the track's loudest 2 s and merged within 4 s:
 *
 *   - A kick is an onset in the kick band (30–150 Hz log-spectral flux, a
 *     local peak within ±30 ms) at least 2 × the track's median flux, at a
 *     10 ms hop (FFT 2048 at 16 kHz, as VW14's build check measured).
 *   - It lands loud: the bass level (VW12: 150 Hz and below, per 50 ms) over
 *     the 2 s from the kick is within 3 dB of the track's loudest 2 s.
 *   - The build ends there, by the roll stopping (≥ 3 kicks a second in the
 *     2 s before; in the 2 s from it at most 0.6 × as many and at least 1.5 a
 *     second) or by the mids falling (1–4 kHz over the 1 s from the kick at
 *     least 1.5 dB below the 2 s before, with the kick band over the 2 s from
 *     it no quieter than the 2 s before).
 *   - Qualifying kicks within 4 s of each other are one drop, timed at the
 *     first. Each drop keeps which test it passed and its four measures.
 *
 * VW14's thresholds are as ruled and stay that way: a miss is never a reason
 * to re-tune them (TK3). The bar grid (TK3) reads the same kicks.
 *
 * The pitch content for the hook (TK3) is a 12-class chroma in the mids
 * (200 Hz–5 kHz), per 10 ms frame; top-tracks-audio.ts averages it per bar.
 */

/** VW14's numbers, named. Not tuned here (TK3). */
export const VW14 = {
  sampleRate: 16000,
  fftSize: 2048,
  /** 10 ms. */
  hopS: 0.01,
  kickBandHz: [30, 150] as const,
  /** A kick's flux is a local peak within this, seconds. */
  peakS: 0.03,
  /** The kick floor: 2 × the median flux. */
  kickFloor: 2,
  /** Bass level (VW12): 150 Hz and below. */
  bassHz: 150,
  bassFrameS: 0.05,
  /** Lands loud: within 3 dB of the loudest 2 s. */
  loudDb: 3,
  loudWindowS: 2,
  /** The roll test. */
  rollBeforePerS: 3,
  rollRatio: 0.6,
  rollAfterMinPerS: 1.5,
  rollWindowS: 2,
  /** The mids test. */
  midsHz: [1000, 4000] as const,
  midsFallDb: 1.5,
  midsBeforeS: 2,
  midsAfterS: 1,
  /** Qualifying kicks within this are one drop, timed at the first. */
  mergeS: 4,
} as const;

/** TK3's mids band for the hook's pitch content. */
export const HOOK_BAND_HZ = [200, 5000] as const;

const FLOOR_DB = -120;

// ── FFT ─────────────────────────────────────────────────────────────────────

/** In-place radix-2 FFT on (re, im). n must be a power of two. */
function fft(re: Float64Array, im: Float64Array, cos: Float64Array, sin: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k += 1) {
        const wr = cos[k * step]!;
        const wi = -sin[k * step]!;
        const a = i + k;
        const b = a + half;
        const xr = re[b]! * wr - im[b]! * wi;
        const xi = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - xr;
        im[b] = im[a]! - xi;
        re[a] = re[a]! + xr;
        im[a] = im[a]! + xi;
      }
    }
  }
}

// ── Features ────────────────────────────────────────────────────────────────

export type TrackFeatures = {
  /** Seconds per frame (10 ms). Frame t is centred on t × hopS. */
  hopS: number;
  durationS: number;
  /** 30–150 Hz log-spectral flux per frame. */
  kickFlux: Float64Array;
  /** 30–150 Hz power per frame, dB. */
  kickBandDb: Float64Array;
  /** 1–4 kHz power per frame, dB. */
  midsDb: Float64Array;
  /** Power at 150 Hz and below per frame (linear), for the 50 ms bass level. */
  bassPower: Float64Array;
  /** 12 pitch classes per frame (C = 0), linear power, in the hook band. */
  chroma: Float32Array;
};

/** Mono 16-bit little-endian PCM → floats in −1..1. */
export function pcm16ToFloat(pcm: Uint8Array): Float32Array {
  const n = Math.floor(pcm.byteLength / 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

function toDb(power: number): number {
  return power > 0 ? Math.max(FLOOR_DB, 10 * Math.log10(power)) : FLOOR_DB;
}

/** One STFT pass: every per-frame measure TK3 reads. */
export function trackFeatures(samples: Float32Array, sampleRate: number = VW14.sampleRate): TrackFeatures {
  const n = VW14.fftSize;
  const hop = Math.round(VW14.hopS * sampleRate);
  const frames = Math.max(0, Math.floor(samples.length / hop));
  const hann = new Float64Array(n);
  for (let i = 0; i < n; i += 1) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i += 1) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const binHz = sampleRate / n;
  const bin = (hz: number) => Math.round(hz / binHz);
  const [kLo, kHi] = [Math.max(1, bin(VW14.kickBandHz[0])), bin(VW14.kickBandHz[1])];
  const [mLo, mHi] = [bin(VW14.midsHz[0]), bin(VW14.midsHz[1])];
  const bHi = bin(VW14.bassHz);
  const [cLo, cHi] = [bin(HOOK_BAND_HZ[0]), bin(HOOK_BAND_HZ[1])];
  const pitchClass = new Int8Array(n / 2);
  for (let k = cLo; k <= cHi; k += 1) pitchClass[k] = (((Math.round(12 * Math.log2((k * binHz) / 440) + 69) % 12) + 12) % 12) as number;

  const kickFlux = new Float64Array(frames);
  const kickBandDb = new Float64Array(frames);
  const midsDb = new Float64Array(frames);
  const bassPower = new Float64Array(frames);
  const chroma = new Float32Array(frames * 12);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const prevLog = new Float64Array(kHi + 1);
  for (let t = 0; t < frames; t += 1) {
    const centre = t * hop;
    for (let i = 0; i < n; i += 1) {
      const s = centre - n / 2 + i;
      re[i] = s >= 0 && s < samples.length ? samples[s]! * hann[i]! : 0;
      im[i] = 0;
    }
    fft(re, im, cos, sin);
    let flux = 0;
    let kick = 0;
    let mids = 0;
    let bass = 0;
    for (let k = 1; k <= Math.max(kHi, mHi, cHi, bHi); k += 1) {
      const p = re[k]! * re[k]! + im[k]! * im[k]!;
      if (k <= bHi) bass += p;
      if (k >= kLo && k <= kHi) {
        kick += p;
        const lg = Math.log1p(100 * Math.sqrt(p));
        if (t > 0) flux += Math.max(0, lg - prevLog[k]!);
        prevLog[k] = lg;
      }
      if (k >= mLo && k <= mHi) mids += p;
      if (k >= cLo && k <= cHi) chroma[t * 12 + pitchClass[k]!] += p;
    }
    kickFlux[t] = flux;
    kickBandDb[t] = toDb(kick);
    midsDb[t] = toDb(mids);
    bassPower[t] = bass;
  }
  return { hopS: hop / sampleRate, durationS: samples.length / sampleRate, kickFlux, kickBandDb, midsDb, bassPower, chroma };
}

// ── Kicks ───────────────────────────────────────────────────────────────────

function median(values: ArrayLike<number>): number {
  const sorted = Array.from(values).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** VW14's kicks: local flux peaks within ±30 ms, at least 2 × the median flux. Seconds, in order. */
export function findKicks(f: Pick<TrackFeatures, "kickFlux" | "hopS">): number[] {
  const floor = VW14.kickFloor * median(f.kickFlux);
  const reach = Math.round(VW14.peakS / f.hopS);
  const out: number[] = [];
  for (let t = 1; t < f.kickFlux.length; t += 1) {
    const v = f.kickFlux[t]!;
    if (!(v >= floor) || v <= 0) continue;
    let peak = true;
    for (let d = -reach; d <= reach && peak; d += 1) {
      if (d === 0) continue;
      const u = f.kickFlux[t + d];
      if (u === undefined) continue;
      // A plateau counts once, at its first frame.
      if (u > v || (d < 0 && u === v)) peak = false;
    }
    if (peak) out.push(Math.round(t * f.hopS * 1000) / 1000);
  }
  return out;
}

// ── Drops (VW14 on a track) ─────────────────────────────────────────────────

export type DropTest = "roll" | "mids" | "both";

export type FoundDrop = {
  tS: number;
  test: DropTest;
  /** VW14's four measures at the drop's first kick, kept as data. */
  measures: { kicksBeforePerS: number; kicksAfterPerS: number; midsFallDb: number; kickBandChangeDb: number; bassVsLoudestDb: number };
};

function powerMeanDb(values: ArrayLike<number>, from: number, to: number): number {
  const a = Math.max(0, from);
  const b = Math.min(values.length, to);
  if (b <= a) return FLOOR_DB;
  let sum = 0;
  for (let i = a; i < b; i += 1) sum += 10 ** (values[i]! / 10);
  return toDb(sum / (b - a));
}

/** The bass level (VW12) as 50 ms dB frames. */
export function bassLevelDb(f: Pick<TrackFeatures, "bassPower" | "hopS">): Float64Array {
  const per = Math.max(1, Math.round(VW14.bassFrameS / f.hopS));
  const frames = Math.floor(f.bassPower.length / per);
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let j = 0; j < per; j += 1) sum += f.bassPower[i * per + j]!;
    out[i] = toDb(sum / per);
  }
  return out;
}

function countIn(kicks: readonly number[], from: number, to: number): number {
  let c = 0;
  for (const k of kicks) if (k >= from - 1e-9 && k < to - 1e-9) c += 1;
  return c;
}

/**
 * VW14's numbers that a miss report varies (VW14's acceptance asks for the
 * roll ratio at 0.5 / 0.6 / 0.7 and the mids fall at 1 / 1.5 / 2 / 3 dB).
 * The Lab always runs the defaults; only scripts/top-tracks-acceptance.mts
 * passes others, to report, never to choose.
 */
export type Vw14Grid = { rollRatio?: number; midsFallDb?: number };

/** Every drop in the track (TK3), as VW14 finds them in a clip, in time order. */
export function findDrops(f: TrackFeatures, kicks: readonly number[] = findKicks(f), grid: Vw14Grid = {}): FoundDrop[] {
  const rollRatio = grid.rollRatio ?? VW14.rollRatio;
  const midsFallMin = grid.midsFallDb ?? VW14.midsFallDb;
  const bass = bassLevelDb(f);
  const bassPer = VW14.bassFrameS;
  const loudN = Math.round(VW14.loudWindowS / bassPer);
  let loudest = FLOOR_DB;
  for (let i = 0; i + loudN <= bass.length; i += 1) loudest = Math.max(loudest, powerMeanDb(bass, i, i + loudN));
  const frame = (s: number) => Math.round(s / f.hopS);
  const qualifying: FoundDrop[] = [];
  for (const k of kicks) {
    const bi = Math.round(k / bassPer);
    const bassAfter = powerMeanDb(bass, bi, bi + loudN);
    const bassVsLoudestDb = bassAfter - loudest;
    if (bassVsLoudestDb < -VW14.loudDb) continue;
    const before = countIn(kicks, k - VW14.rollWindowS, k) / VW14.rollWindowS;
    const after = countIn(kicks, k, k + VW14.rollWindowS) / VW14.rollWindowS;
    const roll = before >= VW14.rollBeforePerS && after <= rollRatio * before + 1e-9 && after >= VW14.rollAfterMinPerS;
    const t = frame(k);
    const midsFallDb = powerMeanDb(f.midsDb, t - frame(VW14.midsBeforeS), t) - powerMeanDb(f.midsDb, t, t + frame(VW14.midsAfterS));
    const kickBandChangeDb = powerMeanDb(f.kickBandDb, t, t + frame(2)) - powerMeanDb(f.kickBandDb, t - frame(2), t);
    const mids = midsFallDb >= midsFallMin && kickBandChangeDb >= 0;
    if (!roll && !mids) continue;
    const r1 = (x: number) => Math.round(x * 10) / 10;
    qualifying.push({
      tS: k,
      test: roll && mids ? "both" : roll ? "roll" : "mids",
      measures: { kicksBeforePerS: r1(before), kicksAfterPerS: r1(after), midsFallDb: r1(midsFallDb), kickBandChangeDb: r1(kickBandChangeDb), bassVsLoudestDb: r1(bassVsLoudestDb) },
    });
  }
  // One drop, its front: qualifying kicks within 4 s of the one before are the same drop.
  const drops: FoundDrop[] = [];
  let last = -Infinity;
  for (const q of qualifying) {
    if (q.tS - last > VW14.mergeS) drops.push(q);
    last = q.tS;
  }
  return drops;
}

// ── Pitch content per span ──────────────────────────────────────────────────

/** The mean chroma over [fromS, toS), L2-normalised (all zero when silent). */
export function chromaOver(f: Pick<TrackFeatures, "chroma" | "hopS">, fromS: number, toS: number): Float64Array {
  const frames = f.chroma.length / 12;
  const a = Math.max(0, Math.round(fromS / f.hopS));
  const b = Math.min(frames, Math.round(toS / f.hopS));
  const out = new Float64Array(12);
  for (let t = a; t < b; t += 1) for (let c = 0; c < 12; c += 1) out[c] += f.chroma[t * 12 + c]!;
  // Log-compressed so a loud bass note doesn't swamp the rest.
  let norm = 0;
  for (let c = 0; c < 12; c += 1) {
    out[c] = Math.log1p(out[c]! / Math.max(1, b - a));
    norm += out[c]! * out[c]!;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (let c = 0; c < 12; c += 1) out[c] = out[c]! / norm;
  return out;
}
