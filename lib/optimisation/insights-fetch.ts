/**
 * lib/optimisation/insights-fetch.ts
 *
 * Batched Meta fetch for task #120 PR A — one Graph call per opted-in
 * campaign per cron tick, returning every ad set's current `daily_budget` +
 * live metrics in a single round trip. This is the #1 quota-safety lever the
 * PR A spec calls for (10 opted-in campaigns × 1 call/tick × 6 ticks/day =
 * 60 calls/day, well under the 200/day target) — same discipline as the
 * thumbnail cache (PR #732) and `refresh-active-creatives`' batched pulls.
 *
 * Deliberately uses the CAMPAIGN's `/adsets` edge with a nested
 * `insights.date_preset(...)` field expansion rather than the two separate
 * endpoints (`/adsets?fields=daily_budget` + `/insights?level=adset`) the
 * original spec sketch described — Meta's Insights API has no
 * `daily_budget` field at all, so getting both in ONE call requires this
 * expansion. Confirmed pattern; see Meta's Marketing API "Field Expansion"
 * docs. This keeps the call budget at exactly 1/campaign/tick while still
 * getting the ad-set roster, budget, status, AND metrics together.
 *
 * Pure once the Graph fetcher is injected — same seam as
 * `lib/dashboard/glasgow-adset-rollup-fetch.ts`'s `GlasgowGraphFetcher`, so
 * this module can be unit-tested with a stub fetcher and never needs `@/`
 * imports (the `node --test` runner can't resolve `@/`).
 */

import type { RuleTimeWindow } from "../types.ts";
import { windowToDatePreset } from "./live-metric.ts";
import type { AdSetInsightMetrics } from "./live-metric.ts";

export interface ActionRow {
  action_type: string;
  value: string;
}

/** One ad set's budget + metrics, as resolved from the `/adsets` field-expansion call. */
export interface AdSetInsightRow extends AdSetInsightMetrics {
  adsetId: string;
  adsetName: string;
  /** Meta's `daily_budget`, already minor units (pence for GBP) as a numeric string — null if the ad set has no daily budget (e.g. CBO/campaign-budget-optimised, or lifetime_budget only). */
  dailyBudgetPence: number | null;
  /** Meta's `lifetime_budget` in minor units — null when the ad set is daily or CBO. */
  lifetimeBudgetPence: number | null;
  effectiveStatus: string | null;
}

/**
 * Campaign-level budget + insights. `costPerActionType` / impressions are
 * Meta's campaign-grain figures (one Insights row for the campaign), not
 * a sum of ad-set rates. Summing ad-set `cost_per_action_type` would be a
 * different, dishonest provenance.
 */
export interface CampaignBudgetInsight extends AdSetInsightMetrics {
  campaignId: string;
  dailyBudgetPence: number | null;
  lifetimeBudgetPence: number | null;
}

interface RawInsightRow {
  impressions?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  actions?: ActionRow[];
  cost_per_action_type?: ActionRow[];
}

interface RawAdSetRow {
  id: string;
  name?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  effective_status?: string;
  insights?: { data?: RawInsightRow[] };
}

interface RawCampaignNode {
  id?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  insights?: { data?: RawInsightRow[] };
}

interface RawPaged<T> {
  data?: T[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/** Injected Graph fetcher — the production wrapper supplies `graphGetWithToken`. */
export type OptimisationGraphFetcher = <T>(
  path: string,
  params: Record<string, string>,
  token: string,
) => Promise<RawPaged<T>>;

/** Single-node Graph GET (campaign object, not a paged edge). */
export type OptimisationNodeFetcher = <T>(
  path: string,
  params: Record<string, string>,
  token: string,
) => Promise<T>;

export function isCboAdSetRoster(rows: AdSetInsightRow[]): boolean {
  return rows.length > 0 && rows.every((row) => row.dailyBudgetPence === null);
}

function metricsFromInsight(insightRow: RawInsightRow | undefined): AdSetInsightMetrics {
  return {
    impressions: parseNum(insightRow?.impressions),
    cpc: parseNumOrNull(insightRow?.cpc),
    cpm: parseNumOrNull(insightRow?.cpm),
    ctr: parseNumOrNull(insightRow?.ctr),
    costPerActionType: costPerActionTypeMap(insightRow?.cost_per_action_type),
    // `actions` holds raw counts; `cost_per_action_type` holds the rate.
    // Both use the same `action_type` keys, so the minimum-evidence check
    // can look up the count by the same candidate action_type string.
    actionCountByType: costPerActionTypeMap(insightRow?.actions),
  };
}

function parseNumOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseNum(raw: string | undefined): number {
  return parseNumOrNull(raw) ?? 0;
}

function costPerActionTypeMap(rows: ActionRow[] | undefined): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows ?? []) {
    const value = Number(row.value);
    if (Number.isFinite(value)) map[row.action_type] = value;
  }
  return map;
}

const AD_SET_PAGE_LIMIT = "500";
/** Guards against an infinite loop if Meta's paging cursor never terminates. */
const MAX_PAGES = 10;

/**
 * Fetch every ad set's current budget + live metrics for one campaign, in a
 * single (paginated) Graph call. `window` selects the `date_preset` used for
 * BOTH the metric AND the dormant-impressions check (see
 * `lib/optimisation/evaluate.ts`'s dormant-filter doc comment for why this
 * intentionally uses one window rather than a separate hard-coded 7d call).
 */
export async function fetchCampaignAdSetInsights(
  fetcher: OptimisationGraphFetcher,
  campaignId: string,
  token: string,
  window: RuleTimeWindow,
): Promise<AdSetInsightRow[]> {
  const datePreset = windowToDatePreset(window);
  const insightsFields = `insights.date_preset(${datePreset}){impressions,cpc,cpm,ctr,actions,cost_per_action_type}`;
  const fields = `id,name,daily_budget,lifetime_budget,effective_status,${insightsFields}`;

  const rows: AdSetInsightRow[] = [];
  let after: string | undefined;
  let page = 0;

  do {
    const params: Record<string, string> = { fields, limit: AD_SET_PAGE_LIMIT };
    if (after) params.after = after;

    const response = await fetcher<RawAdSetRow>(`/${campaignId}/adsets`, params, token);
    for (const raw of response.data ?? []) {
      const insightRow = raw.insights?.data?.[0];
      rows.push({
        adsetId: raw.id,
        adsetName: raw.name ?? raw.id,
        dailyBudgetPence: parseNumOrNull(raw.daily_budget),
        lifetimeBudgetPence: parseNumOrNull(raw.lifetime_budget),
        effectiveStatus: raw.effective_status ?? null,
        ...metricsFromInsight(insightRow),
      });
    }
    after = response.paging?.cursors?.after;
    page += 1;
  } while (after && page < MAX_PAGES);

  return rows;
}

/**
 * Campaign-level `daily_budget` / `lifetime_budget` plus one Insights row.
 * Graph fields: `daily_budget`, `lifetime_budget`, nested
 * `insights.date_preset(...){impressions,cpc,cpm,ctr,actions,cost_per_action_type}`.
 * One extra GET per CBO campaign (not used on the ABO path).
 */
export async function fetchCampaignBudgetInsights(
  fetcher: OptimisationNodeFetcher,
  campaignId: string,
  token: string,
  window: RuleTimeWindow,
): Promise<CampaignBudgetInsight> {
  const datePreset = windowToDatePreset(window);
  const insightsFields = `insights.date_preset(${datePreset}){impressions,cpc,cpm,ctr,actions,cost_per_action_type}`;
  const fields = `id,daily_budget,lifetime_budget,${insightsFields}`;
  const raw = await fetcher<RawCampaignNode>(`/${campaignId}`, { fields }, token);
  const insightRow = raw.insights?.data?.[0];
  return {
    campaignId: raw.id ?? campaignId,
    dailyBudgetPence: parseNumOrNull(raw.daily_budget),
    lifetimeBudgetPence: parseNumOrNull(raw.lifetime_budget),
    ...metricsFromInsight(insightRow),
  };
}
