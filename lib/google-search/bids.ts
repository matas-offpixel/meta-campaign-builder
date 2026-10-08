/**
 * lib/google-search/bids.ts
 *
 * CPC figures push sends. Client-safe so Review shows the same ceiling
 * push writes.
 *
 *  - Maximise Clicks ceiling (`targetSpend.cpcBidCeilingMicros`) =
 *    `bid_adjustments.max_cpc_cap` × 1e6, else £2.00.
 *  - Ad-group `cpcBidMicros` = `default_cpc` × 1e6, floored at 1p, else
 *    £0.25. A bid is never floored at the £1 daily-budget minimum.
 */

export const DEFAULT_CPC_CEILING_MICROS = 2_000_000;
export const DEFAULT_AD_GROUP_CPC_MICROS = 250_000;
/** Google's smallest GBP bid unit. */
export const MIN_CPC_BID_MICROS = 10_000;

function positiveNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function campaignCpcCap(bidAdjustments: Record<string, unknown> | null | undefined): number | null {
  return positiveNumber(bidAdjustments?.max_cpc_cap);
}

export function resolveCpcCeilingMicros(
  bidAdjustments: Record<string, unknown> | null | undefined,
): { micros: number; fromSheet: boolean } {
  const cap = campaignCpcCap(bidAdjustments);
  if (cap == null) return { micros: DEFAULT_CPC_CEILING_MICROS, fromSheet: false };
  return { micros: Math.max(MIN_CPC_BID_MICROS, Math.round(cap * 1_000_000)), fromSheet: true };
}

/** `default_cpc` is `numeric`; PostgREST may hand it over as a string. */
export function resolveAdGroupCpcMicros(defaultCpc: number | string | null | undefined): number {
  const cpc = positiveNumber(defaultCpc);
  if (cpc == null) return DEFAULT_AD_GROUP_CPC_MICROS;
  return Math.max(MIN_CPC_BID_MICROS, Math.round(cpc * 1_000_000));
}
