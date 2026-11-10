/**
 * The bands on a clip (overlay templates issue 6: O38, O46). The top band is
 * O25's; the bottom band follows the video claim: 0 at 0.55 H, J2's fade to
 * 20 % at 0.60 H, rising evenly to 30 % at 0.68 H and held to the bottom edge.
 * On from frame 0, never moving. Computed at 16 bits and dithered to 8 with a
 * fixed blue-noise pattern (±0.5 level, the same every frame, so it can't
 * crawl), then encoded at H.264 CRF ≤ 18.
 */

import { RECT_45 } from "./artist-card.ts";
import { DEFAULT_GRADIENT_SHADOW, J2_FALL, bandAlphaAt, type GradientShadow } from "./overlay-gradient.ts";

export const VIDEO_GRADIENT_SHADOW: GradientShadow = {
  blendMode: "normal",
  bands: [
    DEFAULT_GRADIENT_SHADOW.bands[0]!,
    // From the bottom edge: zero beyond 0.45 (0.55 H), 20 % at 0.40 (0.60 H), 30 % at 0.32 (0.68 H) and below.
    { edge: "bottom", plateau: 0.4, extent: 0.45, opacity: 0.2, color: "#000000", knots: J2_FALL, ramp: { opacity: 0.3, at: 0.32 } },
  ],
};

/**
 * O38's stops on the 9:16 (fraction of H from the top → alpha %). The top
 * band's are O25's. The bottom band's knee is a pair, as O25 writes its own:
 * J2's fall loses 10 % of its opacity in its first 0.5 %, so 18 % sits just
 * above the 20 % at 0.60 H (0.40 + 0.005 × 0.05 from the bottom = 0.59975 H),
 * and the two share one 3 × 3 reading (O34).
 */
export const VIDEO_STOPS_916: readonly (readonly [number, number])[] = [
  [0.44, 20], [0.4404, 18], [0.4603, 10], [0.5001, 2], [0.53, 0], [0.54, 0], [0.55, 0], [0.59975, 18], [0.6, 20], [0.64, 25], [0.68, 30], [0.8, 30], [0.95, 30],
];

/**
 * The rows where J2's knee drops in under a pixel (the top band at 0.44 H, the
 * bottom band at 0.60 H): a designed cliff, not a fade. O46's 2-level step is
 * checked across the fades either side of them; their own step is reported.
 */
export const BAND_KNEE_ROWS_916: readonly number[] = [845, 1152];

/** The same stops carried into the 4:5 (and the 1:1, which carries the 4:5 at 0.8×): y − 285 over 1350. */
export const VIDEO_STOPS_45: readonly (readonly [number, number])[] = VIDEO_STOPS_916
  .map(([f, a]) => [(f * 1920 - RECT_45.top) / (RECT_45.bottom - RECT_45.top), a] as const)
  .filter(([f]) => f > 0 && f < 1);

/** The CRF ceiling the encode must meet (O46). */
export const BAND_CRF_MAX = 18;
/** O46's acceptance: across each fade, no step between adjacent rows' mean luma larger than this. */
export const MAX_ROW_STEP = 2;

// ─── Blue noise ─────────────────────────────────────────────────────────────

/**
 * A fixed blue-noise threshold map (void-and-cluster, Ulichney 1993), side ×
 * side, values in [0, 1). Deterministic: a seeded start, a toroidal Gaussian
 * energy (sigma 1.5), ties broken by index, so every call gives the same map.
 */
export function blueNoise(side = 32, sigma = 1.5): Float64Array {
  const n = side * side;
  // Toroidal Gaussian kernel.
  const k = new Float64Array(n);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const dx = Math.min(x, side - x);
      const dy = Math.min(y, side - y);
      k[y * side + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
    }
  }
  const energy = new Float64Array(n);
  const on = new Uint8Array(n);
  const add = (i: number, sign: number) => {
    const ix = i % side;
    const iy = (i / side) | 0;
    for (let y = 0; y < side; y += 1) {
      const ky = (y - iy + side) % side;
      for (let x = 0; x < side; x += 1) energy[y * side + x]! += sign * k[ky * side + ((x - ix + side) % side)]!;
    }
  };
  const extreme = (want: number, pick: "max" | "min") => {
    let best = -1;
    let v = pick === "max" ? -Infinity : Infinity;
    for (let i = 0; i < n; i += 1) {
      if (on[i] !== want) continue;
      const e = energy[i]!;
      if (pick === "max" ? e > v : e < v) {
        v = e;
        best = i;
      }
    }
    return best;
  };
  // Seeded initial pattern, ~10 % on.
  let seed = 0x9e3779b9;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x100000000;
  };
  const ones = Math.max(1, Math.round(n * 0.1));
  for (let c = 0; c < ones; ) {
    const i = Math.floor(rand() * n);
    if (on[i]) continue;
    on[i] = 1;
    add(i, 1);
    c += 1;
  }
  // Relax: move the tightest cluster into the largest void until it stops moving.
  for (let guard = 0; guard < n * 4; guard += 1) {
    const cluster = extreme(1, "max");
    on[cluster] = 0;
    add(cluster, -1);
    const voidAt = extreme(0, "min");
    if (voidAt === cluster) {
      on[cluster] = 1;
      add(cluster, 1);
      break;
    }
    on[voidAt] = 1;
    add(voidAt, 1);
  }
  const rank = new Float64Array(n);
  const proto = Uint8Array.from(on);
  const protoEnergy = Float64Array.from(energy);
  // Phase 1: rank the initial ones by removing the tightest cluster.
  for (let r = ones - 1; r >= 0; r -= 1) {
    const i = extreme(1, "max");
    on[i] = 0;
    add(i, -1);
    rank[i] = r;
  }
  on.set(proto);
  energy.set(protoEnergy);
  // Phases 2 and 3: fill the largest void, in order.
  for (let r = ones; r < n; r += 1) {
    const i = extreme(0, "min");
    on[i] = 1;
    add(i, 1);
    rank[i] = r;
  }
  return rank.map((r) => (r + 0.5) / n);
}

let cachedNoise: Float64Array | null = null;
const NOISE_SIDE = 32;
function noiseMap(): Float64Array {
  return (cachedNoise ??= blueNoise(NOISE_SIDE));
}

/**
 * The band layer as 8-bit RGBA (black, straight alpha), from 16-bit alpha
 * dithered with the fixed blue-noise map: alpha8 = floor(alpha16 / 257 +
 * threshold), threshold in [0, 1), so each pixel is off its exact value by
 * less than one level and the error averages to zero (±0.5 level).
 */
export function renderVideoBands(width: number, height: number, spec: GradientShadow = VIDEO_GRADIENT_SHADOW, opts: { dither?: boolean } = {}): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const noise = noiseMap();
  const dither = opts.dither ?? true;
  for (let y = 0; y < height; y += 1) {
    let a = 0;
    for (const band of spec.bands) {
      const ba = bandAlphaAt(band, y, height);
      if (ba > 0) a = ba + a * (1 - ba);
    }
    const a16 = Math.round(a * 65535);
    for (let x = 0; x < width; x += 1) {
      const t = dither ? noise[(y % NOISE_SIDE) * NOISE_SIDE + (x % NOISE_SIDE)]! : 0.5;
      out[(y * width + x) * 4 + 3] = Math.min(255, Math.floor(a16 / 257 + t));
    }
  }
  return out;
}

/** Mean luma (BT.709, 0–255) per row of an RGB(A) frame. */
export function rowMeanLuma(data: Uint8Array | Buffer, width: number, height: number, channels: number): Float64Array {
  const out = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    let s = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * channels;
      s += 0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!;
    }
    out[y] = s / width;
  }
  return out;
}

/** O46: the largest step between adjacent rows' mean luma. */
export function maxRowStep(means: ArrayLike<number>): { step: number; row: number } {
  let step = 0;
  let row = -1;
  for (let y = 1; y < means.length; y += 1) {
    const d = Math.abs(means[y]! - means[y - 1]!);
    if (d > step) {
      step = d;
      row = y;
    }
  }
  return { step, row };
}

/** The band layer composited over a flat grey (straight alpha, black bands), 8-bit RGB. */
export function overFlatGrey(bands: Uint8Array, width: number, height: number, grey = 128): Uint8Array {
  const out = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const a = bands[i * 4 + 3]! / 255;
    const v = Math.round(grey * (1 - a));
    out[i * 3] = v;
    out[i * 3 + 1] = v;
    out[i * 3 + 2] = v;
  }
  return out;
}
