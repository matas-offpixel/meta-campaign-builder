export interface FunnelDeriveEvent {
  id: string;
  name: string;
  event_date: string | null;
}

export interface FunnelRollupInput {
  event_id: string;
  ad_spend: number | null;
  ad_spend_allocated?: number | null;
  ad_spend_presale?: number | null;
  link_clicks: number | null;
  tickets_sold: number | null;
  meta_reach?: number | null;
}

export interface DerivedFunnelTargets {
  tofu_target_reach: number;
  tofu_target_cpm: number | null;
  mofu_target_clicks: number;
  mofu_target_cpc: number | null;
  bofu_target_lpv: number;
  bofu_target_cplpv: number | null;
  bofu_target_purchases: number;
  bofu_target_cpa: number | null;
  tofu_to_mofu_rate: number | null;
  mofu_to_bofu_rate: number | null;
  bofu_to_sale_rate: number | null;
  derived_from_event_id: string | null;
  derived_from_event_name: string | null;
}

export const FALLBACK_FUNNEL_TARGETS: DerivedFunnelTargets = {
  tofu_target_reach: 500000,
  tofu_target_cpm: 4,
  mofu_target_clicks: 20000,
  mofu_target_cpc: 0.12,
  bofu_target_lpv: 12000,
  bofu_target_cplpv: 0.2,
  bofu_target_purchases: 1000,
  bofu_target_cpa: 4,
  tofu_to_mofu_rate: 0.04,
  mofu_to_bofu_rate: 0.6,
  bofu_to_sale_rate: 0.08,
  derived_from_event_id: null,
  derived_from_event_name: null,
};

export function deriveFunnelTargetsFromSoldOutEvents(
  events: FunnelDeriveEvent[],
  rollups: FunnelRollupInput[],
): DerivedFunnelTargets | null {
  if (events.length === 0) return null;
  const rollupsByEvent = new Map<string, FunnelRollupInput[]>();
  for (const row of rollups) {
    const list = rollupsByEvent.get(row.event_id) ?? [];
    list.push(row);
    rollupsByEvent.set(row.event_id, list);
  }

  const totals = events.map((event) => {
    const rows = rollupsByEvent.get(event.id) ?? [];
    return {
      event,
      spend: rows.reduce((sum, row) => sum + rollupSpend(row), 0),
      reach: rows.reduce((sum, row) => sum + (row.meta_reach ?? 0), 0),
      clicks: rows.reduce((sum, row) => sum + (row.link_clicks ?? 0), 0),
      // event_daily_rollups does not have a first-class LPV column yet.
      // Use clicks as the conservative LPV proxy until the rollup widens.
      lpv: rows.reduce((sum, row) => sum + (row.link_clicks ?? 0), 0),
      purchases: rows.reduce((sum, row) => sum + (row.tickets_sold ?? 0), 0),
    };
  });
  if (totals.length === 0) return null;

  const avg = {
    spend: average(totals.map((row) => row.spend)),
    reach: average(totals.map((row) => row.reach)),
    clicks: average(totals.map((row) => row.clicks)),
    lpv: average(totals.map((row) => row.lpv)),
    purchases: average(totals.map((row) => row.purchases)),
  };
  const mostRecent = [...events].sort((a, b) =>
    (b.event_date ?? "").localeCompare(a.event_date ?? ""),
  )[0];

  return {
    tofu_target_reach: Math.round(avg.reach),
    tofu_target_cpm: safeRate(avg.spend, avg.reach, 1000),
    mofu_target_clicks: Math.round(avg.clicks),
    mofu_target_cpc: safeRate(avg.spend, avg.clicks),
    bofu_target_lpv: Math.round(avg.lpv),
    bofu_target_cplpv: safeRate(avg.spend, avg.lpv),
    bofu_target_purchases: Math.round(avg.purchases),
    bofu_target_cpa: safeRate(avg.spend, avg.purchases),
    tofu_to_mofu_rate: safeRate(avg.clicks, avg.reach),
    mofu_to_bofu_rate: safeRate(avg.lpv, avg.clicks),
    bofu_to_sale_rate: safeRate(avg.purchases, avg.lpv),
    derived_from_event_id: mostRecent?.id ?? null,
    derived_from_event_name: mostRecent?.name ?? null,
  };
}

export function rollupSpend(row: FunnelRollupInput): number {
  return (
    row.ad_spend_allocated ??
    row.ad_spend ??
    0
  ) + (row.ad_spend_presale ?? 0);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function safeRate(
  numerator: number,
  denominator: number,
  multiplier = 1,
): number | null {
  if (denominator <= 0) return null;
  const value = (numerator / denominator) * multiplier;
  return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
}
