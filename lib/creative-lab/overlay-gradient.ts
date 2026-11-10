/**
 * Gradient shadow layers in reference overlays: how they are measured from a
 * PSD, and the layer option the overlay renderer takes.
 *
 * A reference overlay's "gradient shadow" can be built three ways in
 * Photoshop: a gradient fill layer (vectorFill type "gradient"), a pixel layer
 * painted with a gradient, or a solid fill whose layer mask carries the
 * gradient (Junction 2's LEFT DARK LAYER), or a Gradient Overlay effect. The
 * measurement here reads what the file renders: the layer's own alpha × its
 * user mask × opacity × fill opacity, at canvas resolution, then profiles it
 * along rows and columns. Positions are reported as fractions of the canvas
 * (H for vertical, W for horizontal), so they hold at 1080×1920.
 *
 * Pure functions; scripts/overlay-refs.mts does the reading.
 */

import { hex } from "./colour.ts";

export type AlphaMap = { width: number; height: number; alpha: Float32Array };

export type MaskInput = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** One byte per pixel (the mask's grey). */
  data: ArrayLike<number>;
  defaultColor: number;
  disabled?: boolean;
};

/**
 * The effective alpha a layer puts on the canvas (0–1): its own pixel alpha
 * (or full coverage of its bounds when it carries no pixels, as a fill layer
 * can) × its user mask × opacity × fill opacity.
 */
export function effectiveAlpha(input: {
  canvas: { width: number; height: number };
  bounds: { left: number; top: number; right: number; bottom: number };
  pixels?: { width: number; height: number; data: ArrayLike<number> } | null;
  mask?: MaskInput | null;
  opacity?: number;
  fillOpacity?: number;
}): AlphaMap {
  const { width: W, height: H } = input.canvas;
  const alpha = new Float32Array(W * H);
  const k = (input.opacity ?? 1) * (input.fillOpacity ?? 1);
  const b = input.bounds;
  const m = input.mask && !input.mask.disabled ? input.mask : null;
  for (let y = Math.max(0, b.top); y < Math.min(H, b.bottom); y += 1) {
    for (let x = Math.max(0, b.left); x < Math.min(W, b.right); x += 1) {
      let a = 1;
      if (input.pixels) {
        const px = x - b.left;
        const py = y - b.top;
        a = px < input.pixels.width && py < input.pixels.height ? input.pixels.data[(py * input.pixels.width + px) * 4 + 3]! / 255 : 0;
      }
      if (m) {
        const mx = x - m.left;
        const my = y - m.top;
        const v = mx >= 0 && my >= 0 && mx < m.width && my < m.height ? m.data[my * m.width + mx]! : m.defaultColor;
        a *= v / 255;
      }
      alpha[y * W + x] = a * k;
    }
  }
  return { width: W, height: H, alpha };
}

/** Mean alpha per row (vertical profile) and per column (horizontal profile). */
export function profiles(map: AlphaMap): { rows: Float64Array; cols: Float64Array } {
  const { width: W, height: H, alpha } = map;
  const rows = new Float64Array(H);
  const cols = new Float64Array(W);
  for (let y = 0; y < H; y += 1) {
    let s = 0;
    for (let x = 0; x < W; x += 1) {
      const v = alpha[y * W + x]!;
      s += v;
      cols[x]! += v;
    }
    rows[y] = s / W;
  }
  for (let x = 0; x < W; x += 1) cols[x]! /= H;
  return { rows, cols };
}

export type ProfileSummary = {
  /** Fraction of the axis where the layer starts and ends (alpha > 0.5 / 255 of opacity). */
  start: number;
  end: number;
  max: number;
  /** Where the profile is at its max, as a fraction. */
  maxAt: number;
  /** Alpha (0–1) at 0, 10, …, 100 % of the axis. */
  samples: number[];
  /** Where the profile falls through 90 %, 50 % and 10 % of its max, walking away from the max (fractions; null when it never does). */
  fall: { p90: number | null; p50: number | null; p10: number | null };
};

/** Summarise a 1-D alpha profile; positions as fractions of its length. */
export function summarizeProfile(p: ArrayLike<number>): ProfileSummary {
  const n = p.length;
  let max = 0;
  let maxAt = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < n; i += 1) {
    const v = p[i]!;
    if (v > max) {
      max = v;
      maxAt = i;
    }
    if (v > 0.5 / 255) {
      if (start < 0) start = i;
      end = i;
    }
  }
  const samples = Array.from({ length: 11 }, (_, k) => p[Math.min(n - 1, Math.round((k / 10) * (n - 1)))]!);
  // Walk away from the max towards the far end with the most room.
  const dir = maxAt < n / 2 ? 1 : -1;
  const cross = (level: number) => {
    for (let i = maxAt; i >= 0 && i < n; i += dir) if (p[i]! <= level * max) return i / (n - 1);
    return null;
  };
  return {
    start: start < 0 ? 0 : start / (n - 1),
    end: end < 0 ? 0 : end / (n - 1),
    max,
    maxAt: maxAt / Math.max(1, n - 1),
    samples,
    fall: { p90: cross(0.9), p50: cross(0.5), p10: cross(0.1) },
  };
}

/** Which way a layer's alpha varies: the profile with more spread wins. */
export function gradientDirection(pr: { rows: ArrayLike<number>; cols: ArrayLike<number> }): "vertical" | "horizontal" | "flat" {
  const spread = (a: ArrayLike<number>) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < a.length; i += 1) {
      lo = Math.min(lo, a[i]!);
      hi = Math.max(hi, a[i]!);
    }
    return hi - lo;
  };
  const r = spread(pr.rows);
  const c = spread(pr.cols);
  if (Math.max(r, c) < 0.02) return "flat";
  return r >= c ? "vertical" : "horizontal";
}

export type GradientFillStop = { position: number; color: string; opacity: number };

/** A gradient fill layer's or Gradient Overlay effect's own stops (ag-psd's EffectSolidGradient). */
export function gradientStops(g: { colorStops?: { color: { r: number; g: number; b: number }; location: number }[]; opacityStops?: { opacity: number; location: number }[] } | undefined): GradientFillStop[] {
  if (!g?.colorStops?.length) return [];
  const op = g.opacityStops?.length ? g.opacityStops : [{ opacity: 1, location: 0 }];
  const opAt = (loc: number) => {
    const s = [...op].sort((a, b) => a.location - b.location);
    if (loc <= s[0]!.location) return s[0]!.opacity;
    for (let i = 1; i < s.length; i += 1) {
      if (loc <= s[i]!.location) {
        const t = (loc - s[i - 1]!.location) / Math.max(1e-9, s[i]!.location - s[i - 1]!.location);
        return s[i - 1]!.opacity + (s[i]!.opacity - s[i - 1]!.opacity) * t;
      }
    }
    return s[s.length - 1]!.opacity;
  };
  const locs = [...new Set([...g.colorStops.map((c) => c.location), ...op.map((o) => o.location)])].sort((a, b) => a - b);
  const colAt = (loc: number) => {
    const s = [...g.colorStops!].sort((a, b) => a.location - b.location);
    if (loc <= s[0]!.location) return s[0]!.color;
    for (let i = 1; i < s.length; i += 1) {
      if (loc <= s[i]!.location) {
        const t = (loc - s[i - 1]!.location) / Math.max(1e-9, s[i]!.location - s[i - 1]!.location);
        const a = s[i - 1]!.color;
        const b = s[i]!.color;
        return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
      }
    }
    return s[s.length - 1]!.color;
  };
  return locs.map((loc) => {
    const c = colAt(loc);
    return { position: loc, color: hex([c.r, c.g, c.b]), opacity: opAt(loc) };
  });
}

// ─── The layer option ───────────────────────────────────────────────────────

/** A fall shape: (t, alpha fraction) knots over the fall, t 0 → 1, piecewise linear. */
export type Knots = readonly (readonly [number, number])[];

/**
 * Junction 2's measured fall (REF - J2 2026 Launch Ad Overlay 9x16.psd,
 * LEFT DARK LAYER, shown copy): a plateau over the first 0.716 of its run,
 * then 50 % of the maximum at 22 % of the fall, 10 % at 67 %, 0 at the end
 * (90 / 50 / 10 % at 0.521 / 0.567 / 0.659 W, end 0.728 W).
 */
export const J2_FALL: Knots = [
  [0, 1],
  [0.222, 0.5],
  [0.669, 0.1],
  [1, 0],
];

/**
 * One gradient shadow band from a frame edge: full `opacity` from the edge to
 * `plateau` (fraction of H from that edge), then falling along `knots` to 0
 * at `extent`.
 */
export type GradientBand = { edge: "top" | "bottom"; plateau: number; extent: number; opacity: number; color: string; knots: Knots };

export type GradientShadow = { bands: GradientBand[]; blendMode: "normal" };

/**
 * The overlay's gradient shadow (Matas, 10 Nov 2026): a top and a bottom band
 * at about 20 % behind the overlay text, so names hold on bright photos and
 * video. Measured: the shape (J2_FALL), the colour (black) and the blend mode
 * (normal) — J2's scrim, the only gradient in the three references. Chosen
 * (no reference has a top or bottom band): the opacity (Matas's 20 %) and the
 * extents, from the T1 slots. Top: full to 0.44 H (O3's details end at
 * 0.4391 H), gone by 0.53 H (the face band's head-top line). Bottom: full
 * from 0.70 H (above the roll-call block's top, 0.7132 H), gone by 0.64 H
 * (the eyes' lowest line), so neither band darkens the eyes.
 */
export const DEFAULT_GRADIENT_SHADOW: GradientShadow = {
  blendMode: "normal",
  bands: [
    { edge: "top", plateau: 0.44, extent: 0.53, opacity: 0.2, color: "#000000", knots: J2_FALL },
    { edge: "bottom", plateau: 0.3, extent: 0.36, opacity: 0.2, color: "#000000", knots: J2_FALL },
  ],
};

/** Piecewise-linear knots at t. */
export function knotAt(knots: Knots, t: number): number {
  if (t <= knots[0]![0]) return knots[0]![1];
  for (let i = 1; i < knots.length; i += 1) {
    const [x1, y1] = knots[i]!;
    const [x0, y0] = knots[i - 1]!;
    if (t <= x1) return y0 + ((y1 - y0) * (t - x0)) / Math.max(1e-9, x1 - x0);
  }
  return knots[knots.length - 1]![1];
}

/** A band's alpha (0–1) at frame row y. */
export function bandAlphaAt(band: GradientBand, y: number, frameHeight: number): number {
  const d = band.edge === "top" ? (y + 0.5) / frameHeight : (frameHeight - y - 0.5) / frameHeight;
  if (d >= band.extent) return 0;
  if (d <= band.plateau) return band.opacity;
  return band.opacity * knotAt(band.knots, (d - band.plateau) / Math.max(1e-9, band.extent - band.plateau));
}

/** The shadow layer as RGBA (straight alpha) at the frame's size; overlapping bands composite "over" each other. */
export function renderGradientShadow(spec: GradientShadow, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    let a = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const band of spec.bands) {
      const ba = bandAlphaAt(band, y, height);
      if (ba <= 0) continue;
      const c = [parseInt(band.color.slice(1, 3), 16), parseInt(band.color.slice(3, 5), 16), parseInt(band.color.slice(5, 7), 16)];
      const na = ba + a * (1 - ba);
      r = (c[0]! * ba + r * a * (1 - ba)) / na;
      g = (c[1]! * ba + g * a * (1 - ba)) / na;
      b = (c[2]! * ba + b * a * (1 - ba)) / na;
      a = na;
    }
    const row = [Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)];
    for (let x = 0; x < width; x += 1) out.set(row, (y * width + x) * 4);
  }
  return out;
}
