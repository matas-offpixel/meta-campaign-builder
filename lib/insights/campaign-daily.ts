/**
 * Campaign-grain daily insights for Armed floor 4.
 *
 * Pure: no Meta/Supabase, no `@/` imports. The Graph shape is the one
 * fetchEventDailyMetaMetrics already uses (level=campaign,
 * time_increment=1). This module keeps the (campaign, day) rows instead
 * of summing them into an event.
 *
 * results is the resolved primary result, not every action type: floor 4
 * is one series, and it has to be the denominator of the Armed chip.
 * Candidate lists must stay in lock-step with live-metric.ts.
 */

import { OBJECTIVE_METRIC_PRIORITY } from "../optimisation-rules.ts";
import type { CampaignObjective } from "../types.ts";

export const CAMPAIGN_DAILY_WINDOW_DAYS = 14;

/** Same attribution windows as lib/insights/meta.ts. */
export const CAMPAIGN_DAILY_ATTRIBUTION_WINDOWS = JSON.stringify([
  "7d_click",
  "1d_view",
]);

export interface CampaignDailyAction {
  action_type: string;
  value: string | number;
}

export interface CampaignDailyGraphRow {
  campaign_id?: string;
  date_start?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: CampaignDailyAction[];
}

export interface CampaignDailyInsightRow {
  meta_campaign_id: string;
  date: string;
  ad_account_id: string | null;
  draft_id: string | null;
  channel: "meta";
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  link_clicks: number | null;
  results: number | null;
  result_action_type: string | null;
  fetched_at: string;
}

export interface ArmedDailyCampaign {
  draftId: string;
  userId: string;
  campaignId: string;
  adAccountId: string;
  objective: CampaignObjective;
}

export interface CampaignDailyFetchArgs {
  adAccountId: string;
  campaignId: string;
  token: string;
  since: string;
  until: string;
}

/**
 * Candidate action_type strings, ordered most-specific-first.
 * Copied from lib/optimisation/live-metric.ts — a test greps both.
 */
const ACTION_TYPE_CANDIDATES: Partial<Record<string, string[]>> = {
  cpr: [
    "offsite_conversion.fb_pixel_complete_registration",
    "onsite_conversion.complete_registration",
    "complete_registration",
  ],
  lpv_cost: ["landing_page_view"],
  cpa: [
    "offsite_conversion.fb_pixel_purchase",
    "onsite_conversion.purchase",
    "purchase",
  ],
};

const ACTION_TYPE_CANDIDATES_BY_OBJECTIVE: Partial<
  Record<CampaignObjective, Partial<Record<string, string[]>>>
> = {
  initiate_checkout: {
    cpic: [
      "offsite_conversion.fb_pixel_initiate_checkout",
      "omni_initiated_checkout",
      "initiate_checkout",
      "initiated_checkout",
    ],
  },
};

const DIRECT_FIELD_METRICS = new Set(["cpc", "cpm", "ctr"]);

export function campaignDailyWindow(now: Date): { since: string; until: string } {
  const untilDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const sinceDate = new Date(untilDate);
  sinceDate.setUTCDate(sinceDate.getUTCDate() - (CAMPAIGN_DAILY_WINDOW_DAYS - 1));
  return { since: isoDate(sinceDate), until: isoDate(untilDate) };
}

export function formatCampaignDailyDryRunRow(row: CampaignDailyInsightRow): string {
  const results =
    row.results == null
      ? "results=—"
      : `results=${row.results}${row.result_action_type ? ` (${row.result_action_type})` : ""}`;
  return [
    row.meta_campaign_id,
    row.date,
    `spend=${row.spend ?? "—"}`,
    `impr=${row.impressions ?? "—"}`,
    `reach=${row.reach ?? "—"}`,
    `clicks=${row.clicks ?? "—"}`,
    `link_clicks=${row.link_clicks ?? "—"}`,
    results,
  ].join(" ");
}

export function resolveDailyPrimaryResult(
  objective: CampaignObjective,
  actions: ReadonlyArray<CampaignDailyAction> | undefined,
): { count: number; actionType: string } | null {
  const metric = OBJECTIVE_METRIC_PRIORITY[objective].primary;
  if (DIRECT_FIELD_METRICS.has(metric)) return null;
  const candidates =
    ACTION_TYPE_CANDIDATES_BY_OBJECTIVE[objective]?.[metric] ??
    ACTION_TYPE_CANDIDATES[metric] ??
    [];
  const byType = actionCountMap(actions);
  for (const actionType of candidates) {
    const count = byType[actionType];
    if (typeof count === "number" && Number.isFinite(count)) {
      return { count, actionType };
    }
  }
  return null;
}

export function rowFromGraphRow(
  raw: CampaignDailyGraphRow,
  ctx: {
    campaignId: string;
    adAccountId: string;
    draftId: string | null;
    objective: CampaignObjective;
    fetchedAt: string;
  },
): CampaignDailyInsightRow | null {
  const date = raw.date_start?.trim();
  const campaignId = raw.campaign_id?.trim() || ctx.campaignId;
  if (!date || !campaignId) return null;
  if (campaignId !== ctx.campaignId) return null;
  const primary = resolveDailyPrimaryResult(ctx.objective, raw.actions);
  return {
    meta_campaign_id: campaignId,
    date,
    ad_account_id: ctx.adAccountId,
    draft_id: ctx.draftId,
    channel: "meta",
    spend: parseFinite(raw.spend),
    impressions: parseFinite(raw.impressions),
    reach: parseFinite(raw.reach),
    clicks: parseFinite(raw.clicks),
    link_clicks: parseFinite(raw.inline_link_clicks),
    results: primary?.count ?? null,
    result_action_type: primary?.actionType ?? null,
    fetched_at: ctx.fetchedAt,
  };
}

export function rowsFromGraphRows(
  raw: ReadonlyArray<CampaignDailyGraphRow>,
  ctx: {
    campaignId: string;
    adAccountId: string;
    draftId: string | null;
    objective: CampaignObjective;
    fetchedAt: string;
  },
): CampaignDailyInsightRow[] {
  const rows: CampaignDailyInsightRow[] = [];
  for (const item of raw) {
    const row = rowFromGraphRow(item, ctx);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Last write wins per (campaign, date). A re-run of 14 days over 14
 * existing rows stays 14.
 */
export function mergeCampaignDailyRows(
  existing: ReadonlyArray<CampaignDailyInsightRow>,
  incoming: ReadonlyArray<CampaignDailyInsightRow>,
): CampaignDailyInsightRow[] {
  const map = new Map<string, CampaignDailyInsightRow>();
  for (const row of existing) map.set(campaignDailyKey(row), row);
  for (const row of incoming) map.set(campaignDailyKey(row), row);
  return [...map.values()].sort((a, b) => {
    if (a.meta_campaign_id !== b.meta_campaign_id) {
      return a.meta_campaign_id < b.meta_campaign_id ? -1 : 1;
    }
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });
}

export function campaignDailyKey(row: Pick<CampaignDailyInsightRow, "meta_campaign_id" | "date">): string {
  return `${row.meta_campaign_id}|${row.date}`;
}

export interface CampaignDailySyncDeps {
  now: Date;
  dryRun: boolean;
  loadCampaigns: () => Promise<ArmedDailyCampaign[]>;
  resolveToken: (userId: string) => Promise<string | null>;
  fetchInsights: (args: CampaignDailyFetchArgs) => Promise<CampaignDailyGraphRow[]>;
  upsert: (rows: CampaignDailyInsightRow[]) => Promise<number>;
}

export interface CampaignDailySyncResult {
  campaigns: number;
  skippedNoToken: number;
  rows: CampaignDailyInsightRow[];
  written: number;
}

export async function runCampaignDailyInsightsSync(
  deps: CampaignDailySyncDeps,
): Promise<CampaignDailySyncResult> {
  const campaigns = await deps.loadCampaigns();
  const { since, until } = campaignDailyWindow(deps.now);
  const fetchedAt = deps.now.toISOString();
  const tokenByUser = new Map<string, string | null>();
  const incoming: CampaignDailyInsightRow[] = [];
  let skippedNoToken = 0;

  for (const campaign of campaigns) {
    let token = tokenByUser.get(campaign.userId);
    if (token === undefined) {
      token = await deps.resolveToken(campaign.userId);
      tokenByUser.set(campaign.userId, token);
    }
    if (!token) {
      skippedNoToken += 1;
      continue;
    }
    const raw = await deps.fetchInsights({
      adAccountId: campaign.adAccountId,
      campaignId: campaign.campaignId,
      token,
      since,
      until,
    });
    incoming.push(
      ...rowsFromGraphRows(raw, {
        campaignId: campaign.campaignId,
        adAccountId: campaign.adAccountId,
        draftId: campaign.draftId,
        objective: campaign.objective,
        fetchedAt,
      }),
    );
  }

  const rows = mergeCampaignDailyRows([], incoming);
  const written = deps.dryRun || rows.length === 0 ? 0 : await deps.upsert(rows);
  return {
    campaigns: campaigns.length,
    skippedNoToken,
    rows,
    written: deps.dryRun ? 0 : written,
  };
}

function actionCountMap(
  actions: ReadonlyArray<CampaignDailyAction> | undefined,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of actions ?? []) {
    const value = Number(row.value);
    if (Number.isFinite(value)) map[row.action_type] = value;
  }
  return map;
}

function parseFinite(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
