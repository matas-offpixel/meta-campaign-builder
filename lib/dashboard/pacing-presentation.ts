/**
 * lib/dashboard/pacing-presentation.ts
 *
 * Pure presentation helpers shared across the three funnel-pacing
 * surfaces (venue Funnel Pacing tab, Today client alerts, client
 * dashboard 3-state toggle). NO React, NO data access — just the
 * status-tone derivation and the centralised colour system so every
 * surface reads identical colours from one place.
 *
 * Status colour system (locked, issue catalyst PR):
 *   - emerald  → actual ≥ benchmark            ("on/above benchmark")
 *   - amber    → benchmark×0.9 ≤ actual < benchmark   ("within ±10%")
 *   - red      → actual < benchmark×0.9         (">10% below benchmark")
 *   - neutral  → actual unknown (cache miss / no data)
 *
 * Tailwind v4 default palette utility classes are used for JSX; the
 * raw hex equivalents are exported for SVG strokes / gradient stops
 * (SVG cannot consume Tailwind classes). Keep the two in lock-step.
 */

export type PacingTone = "above" | "within" | "below" | "neutral";

/** Within-band fraction: amber when actual ≥ benchmark × this. */
const WITHIN_BAND = 0.9;

/**
 * Classify an actual rate against a benchmark into the 3-state tone.
 * `null`/non-finite inputs → "neutral".
 */
export function pacingTone(
  actual: number | null | undefined,
  benchmark: number | null | undefined,
): PacingTone {
  if (
    actual == null ||
    benchmark == null ||
    !Number.isFinite(actual) ||
    !Number.isFinite(benchmark) ||
    benchmark <= 0
  ) {
    return "neutral";
  }
  const ratio = actual / benchmark;
  if (ratio >= 1) return "above";
  if (ratio >= WITHIN_BAND) return "within";
  return "below";
}

/**
 * Tone for "lower is better" metrics (CPT, CPC, CPM): actual below
 * benchmark is good (emerald). Mirror image of {@link pacingTone}.
 *   - emerald → actual ≤ benchmark
 *   - amber   → benchmark < actual ≤ benchmark × 1.1
 *   - red     → actual > benchmark × 1.1
 */
export function inverseTone(
  actual: number | null | undefined,
  benchmark: number | null | undefined,
): PacingTone {
  if (
    actual == null ||
    benchmark == null ||
    !Number.isFinite(actual) ||
    !Number.isFinite(benchmark) ||
    benchmark <= 0
  ) {
    return "neutral";
  }
  const ratio = actual / benchmark;
  if (ratio <= 1) return "above";
  if (ratio <= 1 / WITHIN_BAND) return "within";
  return "below";
}

/**
 * Signed delta of actual vs benchmark as a fraction
 * (e.g. +0.11 = 11% above). `null` when not computable.
 */
export function deltaFraction(
  actual: number | null | undefined,
  benchmark: number | null | undefined,
): number | null {
  if (
    actual == null ||
    benchmark == null ||
    !Number.isFinite(actual) ||
    !Number.isFinite(benchmark) ||
    benchmark <= 0
  ) {
    return null;
  }
  return actual / benchmark - 1;
}

// ── Colour system ───────────────────────────────────────────────────────

export interface ToneColors {
  /** Solid fill bar / strong accent (e.g. `bg-emerald-500`). */
  bar: string;
  /** Soft chip background (e.g. `bg-emerald-100`). */
  chipBg: string;
  /** Chip / text foreground (e.g. `text-emerald-700`). */
  chipText: string;
  /** Border accent (e.g. `border-emerald-200`). */
  border: string;
  /** Soft surface tint for banners (e.g. `bg-emerald-50`). */
  surface: string;
  /** Raw hex for SVG strokes / gradient stops. */
  hex: string;
}

const TONE_COLORS: Record<PacingTone, ToneColors> = {
  above: {
    bar: "bg-emerald-500",
    chipBg: "bg-emerald-100",
    chipText: "text-emerald-700",
    border: "border-emerald-200",
    surface: "bg-emerald-50",
    hex: "#10b981",
  },
  within: {
    bar: "bg-amber-500",
    chipBg: "bg-amber-100",
    chipText: "text-amber-700",
    border: "border-amber-200",
    surface: "bg-amber-50",
    hex: "#f59e0b",
  },
  below: {
    bar: "bg-red-500",
    chipBg: "bg-red-100",
    chipText: "text-red-700",
    border: "border-red-200",
    surface: "bg-red-50",
    hex: "#ef4444",
  },
  neutral: {
    bar: "bg-muted-foreground/40",
    chipBg: "bg-muted",
    chipText: "text-muted-foreground",
    border: "border-border",
    surface: "bg-muted/40",
    hex: "#a1a1aa",
  },
};

export function toneColors(tone: PacingTone): ToneColors {
  return TONE_COLORS[tone];
}

/** Status emoji used across hero verdict, alert lines, and row pills. */
export function toneEmoji(tone: PacingTone): string {
  if (tone === "above") return "🟢";
  if (tone === "within") return "🟠";
  if (tone === "below") return "🔴";
  return "⚪";
}

// ── Verdict model (hero bar + alert headline + row pill) ──────────────────

export type PacingVerdict =
  | "on_track"
  | "under_pacing"
  | "over_pacing"
  | "sold_out"
  | "event_passed"
  | "no_data";

export interface VerdictPresentation {
  verdict: PacingVerdict;
  tone: PacingTone;
  emoji: string;
  /** 2-3 word status, uppercase. */
  short: string;
}

const VERDICT_PRESENTATION: Record<
  PacingVerdict,
  Omit<VerdictPresentation, "verdict">
> = {
  on_track: { tone: "above", emoji: "🟢", short: "ON TRACK" },
  under_pacing: { tone: "below", emoji: "🔴", short: "UNDER-PACING" },
  over_pacing: { tone: "within", emoji: "🟠", short: "OVER-PACING" },
  sold_out: { tone: "above", emoji: "🎯", short: "SOLD OUT" },
  event_passed: { tone: "neutral", emoji: "⚪", short: "EVENT PASSED" },
  no_data: { tone: "neutral", emoji: "⚪", short: "NO DATA" },
};

export function verdictPresentation(verdict: PacingVerdict): VerdictPresentation {
  return { verdict, ...VERDICT_PRESENTATION[verdict] };
}

/** Format a signed fraction as a delta string e.g. +11% / -18%. */
export function formatDeltaPct(fraction: number | null): string {
  if (fraction == null || !Number.isFinite(fraction)) return "—";
  const pct = Math.round(fraction * 100);
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct}%`;
}
