/**
 * Campaign-plan phases. A phase is a span on `campaign_plans`, not
 * `ad_plan_days.phase_marker` (a free-text annotation on a single day).
 *
 * Derivation matches migration 173: start_date against the event's UTC
 * calendar date. Null when the phase cannot be derived — never default
 * to on_sale.
 */

export const CAMPAIGN_PLAN_PHASES = [
  "presale",
  "on_sale",
  "waiting_list",
] as const;

export type CampaignPlanPhase = (typeof CAMPAIGN_PLAN_PHASES)[number];

export function isCampaignPlanPhase(
  value: unknown,
): value is CampaignPlanPhase {
  return (
    typeof value === "string" &&
    (CAMPAIGN_PLAN_PHASES as readonly string[]).includes(value)
  );
}

/** Calendar date of a timestamptz in UTC. Matches `(ts at time zone 'utc')::date`. */
export function utcCalendarDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

export function deriveCampaignPlanPhase(input: {
  startDate: string | null;
  presaleAt: string | null;
  generalSaleAt: string | null;
  soldOutAt: string | null;
}): CampaignPlanPhase | null {
  const start = input.startDate?.slice(0, 10) ?? null;
  if (!start) return null;

  const presale = utcCalendarDate(input.presaleAt);
  const general = utcCalendarDate(input.generalSaleAt);
  const soldOut = utcCalendarDate(input.soldOutAt);

  if (presale && general && start >= presale && start < general) {
    return "presale";
  }
  if (soldOut && start >= soldOut) return "waiting_list";
  if (general && start >= general) return "on_sale";
  return null;
}
