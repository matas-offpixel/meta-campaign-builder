/**
 * Presentation scale for the per-event funnel card.
 * Math (stage values, rates, costs) stays in lib/dashboard/event-funnel.ts.
 *
 * Sqrt so a large reach bar does not flatten clicks/LPV/purchases into
 * slivers. Log1p compresses further and makes mid-funnel stages look
 * almost equal — sqrt keeps the cascade readable.
 */

export const FUNNEL_BAR_SCALE = "sqrt" as const;

/** Placeholder width so a not-instrumented stage stays visible (dashed). */
export const FUNNEL_DASHED_SLOT_PCT = 16;

/** ±pp band that paints as neutral ("at seed"). Matches the old vsSeed copy. */
export const FUNNEL_SEED_BAND_PP = 0.5;

export type FunnelBarWidth = {
  widthPct: number;
  dashed: boolean;
};

export function proportionalBarWidths(
  values: Array<number | null>,
): FunnelBarWidth[] {
  const measured = values.filter((value): value is number => value != null && value > 0);
  const maxSqrt = measured.length > 0 ? Math.max(...measured.map((value) => Math.sqrt(value))) : 0;

  return values.map((value) => {
    if (value == null) {
      return { widthPct: FUNNEL_DASHED_SLOT_PCT, dashed: true };
    }
    if (value <= 0 || maxSqrt === 0) {
      return { widthPct: 0, dashed: false };
    }
    return { widthPct: (Math.sqrt(value) / maxSqrt) * 100, dashed: false };
  });
}

export function platformSharePercents(
  rows: Array<{ platform: string; value: number | null; tracked: boolean; label?: string }>,
): Array<{ platform: string; pct: number; label: string }> {
  const tracked = rows.filter((row) => row.tracked && (row.value ?? 0) > 0);
  const total = tracked.reduce((sum, row) => sum + (row.value ?? 0), 0);
  if (total <= 0) return [];
  return tracked.map((row) => ({
    platform: row.platform,
    pct: ((row.value ?? 0) / total) * 100,
    label: row.label ?? row.platform,
  }));
}

export type FunnelDeltaTone = "above" | "below" | "neutral" | "none";

export function benchmarkDeltaTone(
  observed: number | null,
  seed: number | null,
  bandPp: number = FUNNEL_SEED_BAND_PP,
): FunnelDeltaTone {
  if (observed == null || seed == null || !Number.isFinite(observed) || !Number.isFinite(seed)) {
    return "none";
  }
  const deltaPp = (observed - seed) * 100;
  if (Math.abs(deltaPp) < bandPp) return "neutral";
  return deltaPp > 0 ? "above" : "below";
}

export function formatDeltaPp(
  observed: number | null,
  seed: number | null,
): string | null {
  if (observed == null || seed == null) return null;
  const deltaPp = (observed - seed) * 100;
  if (Math.abs(deltaPp) < FUNNEL_SEED_BAND_PP) return "at seed";
  const abs = Math.abs(deltaPp);
  const pretty = abs < 10 ? abs.toFixed(1) : abs.toFixed(0);
  return deltaPp > 0 ? `${pretty}pp above seed` : `${pretty}pp below seed`;
}
