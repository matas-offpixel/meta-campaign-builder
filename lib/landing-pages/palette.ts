/**
 * lib/landing-pages/palette.ts
 *
 * PURE dominant-color extraction from raw RGBA pixel data. No sharp, no
 * fetch, no node builtins — so node:test exercises the real algorithm on
 * synthetic buffers. The server-only fetch/decode wrapper lives in
 * palette-extract.ts.
 *
 * Algorithm (deliberately simple — "3 plausible brand colors", not
 * perceptual science): quantise each opaque pixel to a 4-bit/channel bin
 * (4096 bins), track per-bin population + mean color, then greedily take
 * the most-populous bins that are at least MIN_DISTINCT apart in RGB
 * space. Order out = primary, secondary, tertiary.
 */

export const PALETTE_SIZE = 3;

/** Minimum RGB Euclidean distance between two returned palette entries. */
const MIN_DISTINCT = 60;

/** Pixels more transparent than this are ignored. */
const MIN_ALPHA = 128;

interface Bin {
  count: number;
  r: number;
  g: number;
  b: number;
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function distance(a: Bin, b: Bin): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Extract up to PALETTE_SIZE dominant colors from an RGBA byte buffer
 * (length must be a multiple of 4). Returns hex strings like "#E27737",
 * most-dominant first; [] when the buffer has no usable pixels.
 */
export function extractPaletteFromPixels(
  rgba: Uint8Array | Uint8ClampedArray,
): string[] {
  const bins = new Map<number, Bin>();

  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const alpha = rgba[i + 3];
    if (alpha < MIN_ALPHA) continue;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key);
    if (bin) {
      // Running mean keeps the representative color inside the bin honest
      // (a 16-step bin midpoint can visibly miss the actual shade).
      bin.r += (r - bin.r) / (bin.count + 1);
      bin.g += (g - bin.g) / (bin.count + 1);
      bin.b += (b - bin.b) / (bin.count + 1);
      bin.count += 1;
    } else {
      bins.set(key, { count: 1, r, g, b });
    }
  }

  const ranked = [...bins.values()].sort((a, b) => b.count - a.count);
  const picked: Bin[] = [];
  for (const bin of ranked) {
    if (picked.length >= PALETTE_SIZE) break;
    if (picked.every((p) => distance(p, bin) >= MIN_DISTINCT)) {
      picked.push(bin);
    }
  }
  // Fewer than 3 sufficiently-distinct colors (flat artwork): pad with the
  // next most-populous bins regardless of distance rather than return < 3.
  if (picked.length < PALETTE_SIZE) {
    for (const bin of ranked) {
      if (picked.length >= PALETTE_SIZE) break;
      if (!picked.includes(bin)) picked.push(bin);
    }
  }

  return picked.map((p) => toHex(p.r, p.g, p.b));
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Strict #RRGGBB validation — palette entries come back from jsonb. */
export function isPaletteHex(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

/** Parse a jsonb artwork_palette value into validated hex strings. */
export function parseStoredPalette(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPaletteHex).map((v) => v.toUpperCase());
}
