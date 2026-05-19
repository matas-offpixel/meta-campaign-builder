/**
 * lib/dashboard/real-attribution-bands.ts
 *
 * Pure band-classification + visibility helpers extracted from
 * `components/dashboard/event-report/RealAttributionTile.tsx` so the
 * trust-vs-coverage state matrix can be unit-tested with the
 * existing `node --test` setup (no DOM testing framework available
 * in this repo).
 *
 * The tile re-imports these helpers; tests assert the truth-table
 * directly. DOM-only behaviour (the explainer toggle, the focus
 * states) is left to manual smoke testing during the flag-on
 * preview deploy — it doesn't carry the load-bearing logic.
 */

export type AttributionBadgeBand = "green" | "amber" | "red" | "neutral";

/**
 * Trust band thresholds. The "0.7–1.3 sweet spot" lives here so a
 * later tweak doesn't require touching the React component.
 *
 *   - `null` ratio (no Meta-claimed purchases to compare against) →
 *     RED. The honest read is "we have no signal", but for the
 *     demo audience a red badge prompts the conversation about why
 *     Meta is reporting zero — typically a CAPI misconfig.
 *   - In-band → GREEN. Off/Pixel and Meta agree within ±30%.
 *   - Out-of-band → AMBER. The gap is informative ("Meta
 *     over-reports", "Meta under-reports") but the comparison is
 *     working.
 */
export function trustBand(ratio: number | null): AttributionBadgeBand {
  if (ratio == null || !Number.isFinite(ratio)) return "red";
  if (ratio >= 0.7 && ratio <= 1.3) return "green";
  return "amber";
}

/**
 * Coverage band thresholds. Aligned with the Off/Pixel commercial
 * pitch — anything above 50% is the "we beat Meta's reporting"
 * headline; below 20% means most sales are organic or coming from
 * somewhere other than Meta.
 *
 *   - `null` (no real ticket sales yet) → NEUTRAL. The badge still
 *     renders so the demo audience sees the column shape, but the
 *     pill is grey rather than red.
 */
export function coverageBand(ratio: number | null): AttributionBadgeBand {
  if (ratio == null || !Number.isFinite(ratio)) return "neutral";
  if (ratio >= 0.5) return "green";
  if (ratio >= 0.2) return "amber";
  return "red";
}

/**
 * Format a ratio as a percentage string. The tile renders ratios
 * outside [0, 10) as percentages and ≥ 10 as multipliers (e.g. a
 * 14× over-claim from Meta on a venue with one ticket sold and
 * fourteen reported purchases reads better as "14×" than
 * "1400%").
 */
export function formatRatio(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  if (ratio >= 10) return `${ratio.toFixed(1)}×`;
  return `${(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%`;
}
