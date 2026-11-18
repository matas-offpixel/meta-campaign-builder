/**
 * Top tracks: the master's pitch content for the hook (TK3, TK16 of
 * docs/design-record/2026-11-18-creative-lab-top-tracks-2.html). Pure: it
 * takes mono PCM at 16 kHz (ffmpeg.ts decodes it) and never runs ffmpeg.
 *
 * A 12-class chroma in the mids (200 Hz–5 kHz) per 10 ms frame, read from
 * the full mix, never from a stem; audio-rules.ts averages it per TK13 bar.
 * The beats, downbeats and drops come from studio.ts (Beat This! and the
 * Demucs bass stem). VW14's kick-based grid and drops are not used on studio
 * tracks any more (HK11); live clips keep VW14–VW17 elsewhere.
 */

export const ANALYSIS = { sampleRate: 16000, fftSize: 2048, hopS: 0.01 } as const;

/** TK3's mids band for the hook's pitch content. */
export const HOOK_BAND_HZ = [200, 5000] as const;


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

/** One STFT pass over the master: the chroma in the mids. */
export function trackFeatures(samples: Float32Array, sampleRate: number = ANALYSIS.sampleRate): TrackFeatures {
  const n = ANALYSIS.fftSize;
  const hop = Math.round(ANALYSIS.hopS * sampleRate);
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
  const [cLo, cHi] = [bin(HOOK_BAND_HZ[0]), bin(HOOK_BAND_HZ[1])];
  const pitchClass = new Int8Array(n / 2);
  for (let k = cLo; k <= cHi; k += 1) pitchClass[k] = (((Math.round(12 * Math.log2((k * binHz) / 440) + 69) % 12) + 12) % 12) as number;
  const chroma = new Float32Array(frames * 12);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let t = 0; t < frames; t += 1) {
    const centre = t * hop;
    for (let i = 0; i < n; i += 1) {
      const s = centre - n / 2 + i;
      re[i] = s >= 0 && s < samples.length ? samples[s]! * hann[i]! : 0;
      im[i] = 0;
    }
    fft(re, im, cos, sin);
    for (let k = cLo; k <= cHi; k += 1) chroma[t * 12 + pitchClass[k]!] += re[k]! * re[k]! + im[k]! * im[k]!;
  }
  return { hopS: hop / sampleRate, durationS: samples.length / sampleRate, chroma };
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
