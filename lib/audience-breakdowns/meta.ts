/**
 * lib/audience-breakdowns/meta.ts
 *
 * Meta audience breakdowns (dashboard v2 HE1, E1): GET /act_{id}/insights
 * at level=campaign, time_increment=1, spend > 0, read twice per span:
 * breakdowns=age,gender and breakdowns=region. Same attribution windows as
 * ad_daily_insights and event_daily_rollups, so a show's breakdown spend
 * ties out with its campaign spend. Pure apart from the injected Graph getter.
 *
 * The read itself is lib/ad-daily-insights/fetch.ts's adaptive span reader
 * (one attempt per call, every call counted, a rate-limited or auth-failed
 * account stops, a code 1/2 span split 7 → 3 → 1 days) with our params.
 *
 * Relative imports only: the `node --test` runner can't resolve `@/`.
 */

import {
  AD_INSIGHTS_ATTRIBUTION_WINDOWS,
  fetchAdAccountInsightsAdaptive,
  type AdaptiveFetchResult,
  type GraphGet,
  type InsightsParamsBuilder,
} from "../ad-daily-insights/fetch.ts";
import {
  PURCHASE_ACTION_TYPES,
  REGISTRATION_ACTION_TYPES,
  firstPresentAction,
  type MetaActionRow,
} from "../ad-daily-insights/derive.ts";

export type MetaBreakdown = "age_gender" | "region";

export const META_BREAKDOWNS: readonly MetaBreakdown[] = ["age_gender", "region"];

/** The Graph `breakdowns` value for each of ours. */
export const META_BREAKDOWN_PARAM: Record<MetaBreakdown, string> = {
  age_gender: "age,gender",
  region: "region",
};

export const META_BREAKDOWN_FIELDS = [
  "campaign_id",
  "campaign_name",
  "spend",
  "impressions",
  "clicks",
  "inline_link_clicks",
  "actions",
  "action_values",
].join(",");

export function metaBreakdownParams(breakdown: MetaBreakdown): InsightsParamsBuilder {
  return (since, until, limit, after) => {
    const params: Record<string, string> = {
      level: "campaign",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      breakdowns: META_BREAKDOWN_PARAM[breakdown],
      fields: META_BREAKDOWN_FIELDS,
      filtering: JSON.stringify([{ field: "spend", operator: "GREATER_THAN", value: 0 }]),
      action_attribution_windows: JSON.stringify(AD_INSIGHTS_ATTRIBUTION_WINDOWS),
      limit: String(limit),
    };
    if (after) params.after = after;
    return params;
  };
}

export type MetaBreakdownInsightRow = {
  date_start?: string;
  campaign_id?: string;
  campaign_name?: string;
  age?: string;
  gender?: string;
  region?: string;
  spend?: string | number;
  impressions?: string | number;
  clicks?: string | number;
  inline_link_clicks?: string | number;
  actions?: MetaActionRow[];
  action_values?: MetaActionRow[];
};

/**
 * One meta_audience_breakdowns row. `campaign_name` and `event_id` are
 * present only when known: an upsert must never send them as NULL over a
 * stored value (the batcher groups rows by their exact key set).
 */
export type MetaBreakdownRow = {
  meta_campaign_id: string;
  date: string;
  breakdown: MetaBreakdown;
  age: string;
  gender: string;
  region: string;
  ad_account_id: string;
  campaign_name?: string;
  event_id?: string;
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  registrations: number;
  purchases: number;
  purchase_value: number;
  fetched_at: string;
};

function num(value: unknown): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : 0;
}

const int = (value: unknown) => Math.round(num(value));
const money = (value: number) => Math.round(value * 100) / 100;

/** Revenue: the value of the first purchase type present, never a sum across types. */
export function purchaseValue(values: MetaActionRow[] | undefined): number {
  for (const type of PURCHASE_ACTION_TYPES) {
    const hits = (values ?? []).filter((v) => v.action_type === type);
    if (hits.length) return money(hits.reduce((total, v) => total + num(v.value), 0));
  }
  return 0;
}

/** A segment value as stored: trimmed, '' only when the breakdown doesn't use it. Meta's own "unknown" stays. */
function segment(value: string | undefined): string {
  const v = (value ?? "").trim();
  return v === "" ? "unknown" : v;
}

export function deriveMetaBreakdownRow(
  adAccountId: string,
  breakdown: MetaBreakdown,
  raw: MetaBreakdownInsightRow,
  fetchedAt: Date,
): MetaBreakdownRow | null {
  const campaignId = raw.campaign_id?.trim();
  const date = raw.date_start?.trim();
  if (!campaignId || !date) return null;
  const registrations = firstPresentAction(raw.actions, REGISTRATION_ACTION_TYPES);
  const purchases = firstPresentAction(raw.actions, PURCHASE_ACTION_TYPES);
  const name = raw.campaign_name?.trim();
  return {
    meta_campaign_id: campaignId,
    date,
    breakdown,
    age: breakdown === "age_gender" ? segment(raw.age) : "",
    gender: breakdown === "age_gender" ? segment(raw.gender) : "",
    region: breakdown === "region" ? segment(raw.region) : "",
    ad_account_id: adAccountId,
    ...(name ? { campaign_name: name } : {}),
    spend: money(num(raw.spend)),
    impressions: int(raw.impressions),
    clicks: int(raw.clicks),
    link_clicks: int(raw.inline_link_clicks),
    registrations: registrations?.value ?? 0,
    purchases: purchases?.value ?? 0,
    purchase_value: purchaseValue(raw.action_values),
    fetched_at: fetchedAt.toISOString(),
  };
}

/** Rows keyed on the table's primary key; the last sighting wins (one upsert can't touch a key twice). */
export function metaRowKey(r: Pick<MetaBreakdownRow, "meta_campaign_id" | "date" | "breakdown" | "age" | "gender" | "region">): string {
  return [r.meta_campaign_id, r.date, r.breakdown, r.age, r.gender, r.region].join("|");
}

export type MetaBreakdownSpan = { breakdown: MetaBreakdown; since: string; until: string; rows: MetaBreakdownRow[] };

/**
 * Both breakdowns for one account over `since..until`. `onSpan` gets each
 * complete span's derived rows (unattributed) and returns a write error or
 * null. The age+gender read runs first; a rate limit or auth failure stops
 * the account before the region read, so it costs no further call.
 */
export async function fetchMetaAccountBreakdowns(input: {
  graphGet: GraphGet;
  adAccountId: string;
  since: string;
  until: string;
  now: Date;
  breakdowns?: readonly MetaBreakdown[];
  onSpan: (span: MetaBreakdownSpan) => Promise<string | null>;
}): Promise<{ results: { breakdown: MetaBreakdown; result: AdaptiveFetchResult }[]; calls: number; stopped: AdaptiveFetchResult | null }> {
  const results: { breakdown: MetaBreakdown; result: AdaptiveFetchResult }[] = [];
  let calls = 0;
  for (const breakdown of input.breakdowns ?? META_BREAKDOWNS) {
    const result = await fetchAdAccountInsightsAdaptive(
      input.graphGet,
      input.adAccountId,
      input.since,
      input.until,
      async (span) => {
        const byKey = new Map<string, MetaBreakdownRow>();
        for (const raw of span.rows as unknown as MetaBreakdownInsightRow[]) {
          const row = deriveMetaBreakdownRow(input.adAccountId, breakdown, raw, input.now);
          if (row) byKey.set(metaRowKey(row), row);
        }
        return input.onSpan({ breakdown, since: span.since, until: span.until, rows: [...byKey.values()] });
      },
      metaBreakdownParams(breakdown),
    );
    calls += result.calls;
    results.push({ breakdown, result });
    // A rate limit or an auth failure stops the account; any other failure costs this breakdown only.
    if (result.status === "rate_limited" || result.status === "auth_error") return { results, calls, stopped: result };
  }
  return { results, calls, stopped: null };
}
