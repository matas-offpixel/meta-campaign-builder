// ─────────────────────────────────────────────────────────────────────────────
// Pricing calculator — pure, side-effect-free fee derivation for quotes.
//
// All formulas come from the legacy Off/Pixel pricing sheet:
//   base_fee  = clamp(capacity × per_ticket_rate, MINIMUM_FEE, fee_cap)
//   sell_out_bonus = sold_out_expected ? capacity × £0.10 : 0
//   max_fee   = base_fee + sell_out_bonus
//
// Per-ticket rate depends on the service tier; fee cap depends on capacity
// (large rooms get more headroom). The minimum and the cap both stamp out
// boolean flags so the quote UI can warn the user when their inputs landed
// at a clamp boundary.
//
// Keep this module dependency-free — it's imported by both server routes
// and client components, and unit-tested via __tests__/pricing.test.ts.
// ─────────────────────────────────────────────────────────────────────────────

export type ServiceTier = "ads" | "ads_d2c" | "ads_d2c_creative";

export interface QuoteInputs {
  capacity: number;
  marketing_budget: number;
  service_tier: ServiceTier;
  sold_out_expected: boolean;
}

export interface QuoteOutputs {
  base_fee: number;
  sell_out_bonus: number;
  max_fee: number;
  fee_cap_applied: boolean;
  minimum_fee_applied: boolean;
}

export const MINIMUM_FEE = 750;
export const FEE_CAP_DEFAULT = 4000;
export const FEE_CAP_LARGE = 4500; // capacity > 14,000
export const FEE_CAP_XLARGE = 5000; // capacity > 19,000
export const SELL_OUT_BONUS_PER_TICKET = 0.1;

export const PER_TICKET_RATE: Record<ServiceTier, number> = {
  ads: 0.8,
  ads_d2c: 0.85,
  ads_d2c_creative: 0.9,
};

export const SERVICE_TIER_LABEL: Record<ServiceTier, string> = {
  ads: "Ads only",
  ads_d2c: "Ads + D2C",
  ads_d2c_creative: "Ads + D2C + Creative",
};

export type SettlementTiming =
  | "1_month_before"
  | "2_weeks_before"
  | "on_completion";

export const SETTLEMENT_TIMING_LABEL: Record<SettlementTiming, string> = {
  "1_month_before": "1 month before event",
  "2_weeks_before": "2 weeks before event",
  on_completion: "On completion",
};

/**
 * Round a numeric value to 2 decimal places using banker's-safe rounding.
 *
 * Avoids the classic 0.1 + 0.2 floating-point drift that would otherwise
 * make `1.005 → 1.00` instead of `1.01` on a naive `Math.round`.
 */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Pick the fee cap for a given room capacity.
 *
 * Boundaries are inclusive of the upper bracket (capacity > 14,000 picks
 * £4,500; capacity > 19,000 picks £5,000) — anything at or below 14,000
 * falls back to the default £4,000 ceiling.
 */
export function feeCapForCapacity(capacity: number): number {
  if (capacity > 19_000) return FEE_CAP_XLARGE;
  if (capacity > 14_000) return FEE_CAP_LARGE;
  return FEE_CAP_DEFAULT;
}

/**
 * Per-client overrides that bypass the standard tier table.
 *
 * Both fields default to null = "use the standard pricing rules". Setting
 * customRatePerTicket replaces the tier-derived rate entirely — the chosen
 * service_tier still drives the SERVICE_TIER_LABEL display but the £/ticket
 * comes from this override. Setting customMinimumFee replaces the £750
 * floor with the override (e.g. £500 for clients on a discounted retainer).
 *
 * Fee caps + sell-out bonuses are unaffected by either override.
 */
export interface ClientOverrides {
  customRatePerTicket?: number | null;
  customMinimumFee?: number | null;
}

/**
 * Calculate base fee, sell-out bonus, and max fee for a quote.
 *
 * Pure function — does not touch the database, does not throw on weird
 * inputs (negative capacity is treated as 0 to keep the live preview UI
 * resilient as the user types).
 *
 * Pass `overrides` to substitute the per-ticket rate and/or minimum fee
 * for a specific client; either field can be null to fall back to the
 * standard pricing.
 */
export function calculateQuote(
  inputs: QuoteInputs,
  overrides?: ClientOverrides,
): QuoteOutputs {
  const capacity = Math.max(0, Math.floor(inputs.capacity || 0));
  const tier = inputs.service_tier;

  const customRate = overrides?.customRatePerTicket;
  const perTicket =
    customRate != null && Number.isFinite(customRate) && customRate > 0
      ? customRate
      : PER_TICKET_RATE[tier];

  const customMinimum = overrides?.customMinimumFee;
  const minimumFloor =
    customMinimum != null &&
    Number.isFinite(customMinimum) &&
    customMinimum >= 0
      ? customMinimum
      : MINIMUM_FEE;

  const rawFee = round2(capacity * perTicket);
  const cap = feeCapForCapacity(capacity);

  let baseFee = rawFee;
  let minimumApplied = false;
  let capApplied = false;

  if (baseFee < minimumFloor) {
    baseFee = minimumFloor;
    minimumApplied = true;
  } else if (baseFee > cap) {
    baseFee = cap;
    capApplied = true;
  }

  const sellOutBonus = inputs.sold_out_expected
    ? round2(capacity * SELL_OUT_BONUS_PER_TICKET)
    : 0;

  const maxFee = round2(baseFee + sellOutBonus);

  return {
    base_fee: baseFee,
    sell_out_bonus: sellOutBonus,
    max_fee: maxFee,
    fee_cap_applied: capApplied,
    minimum_fee_applied: minimumApplied,
  };
}

export interface InvoiceSplit {
  upfront: number;
  settlement: number;
}

/**
 * Split a base fee into upfront + settlement amounts.
 *
 * The sell-out bonus is intentionally NOT split — it's billed as a separate
 * third invoice once the show actually sold out, so this helper only deals
 * with the guaranteed base fee.
 */
export function calculateInvoiceAmounts(
  quote: Pick<QuoteOutputs, "base_fee">,
  upfront_pct: number,
): InvoiceSplit {
  const safePct = Math.max(0, Math.min(100, upfront_pct ?? 0));
  const upfront = round2(quote.base_fee * (safePct / 100));
  const settlement = round2(quote.base_fee - upfront);
  return { upfront, settlement };
}

/**
 * Derive a settlement invoice due date from the event date + timing rule.
 *
 * Returns null when no event date is set yet (caller can fall back to the
 * standard "today + 7 days" UI hint) or when timing is "on_completion"
 * (settlement is due on/after the event itself).
 */
export function calculateSettlementDueDate(
  eventDate: Date | null,
  timing: SettlementTiming,
): Date | null {
  if (!eventDate) return null;
  const out = new Date(eventDate);
  out.setUTCHours(0, 0, 0, 0);
  switch (timing) {
    case "1_month_before":
      out.setUTCMonth(out.getUTCMonth() - 1);
      return out;
    case "2_weeks_before":
      out.setUTCDate(out.getUTCDate() - 14);
      return out;
    case "on_completion":
      return out;
    default:
      return out;
  }
}
