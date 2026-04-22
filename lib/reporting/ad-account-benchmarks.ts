import "server-only";

import { graphGetWithToken, MetaApiError } from "@/lib/meta/client";

// Re-export the verdict helper so callers that already import from
// this module don't need a second import — but the *implementation*
// lives in `benchmark-verdict.ts` so client components can import it
// without dragging the `"server-only"` boundary into the browser
// bundle. (Re-exporting from here would still poison; clients must
// import from `benchmark-verdict.ts` directly.)
export type { BenchmarkVerdict } from "@/lib/reporting/benchmark-verdict";

/**
 * lib/reporting/ad-account-benchmarks.ts
 *
 * Compute the rolling-window average CTR / CPM / CPR (cost per result)
 * for an ad account. Used by the event detail Campaigns tab to colour
 * each campaign row green / orange / red against the account-wide
 * baseline so Matas can see at a glance which campaigns are out- or
 * under-performing.
 *
 * Why the route layer doesn't just call Meta directly:
 *   - We need *campaign-level* insights to count "≥5 campaigns"
 *     properly and to sum impressions/spend/results before dividing
 *     (a sum-then-divide weighted average is what Ads Manager calls
 *     the account average; mean-of-means is a different number).
 *   - The benchmarks endpoint can be hit independently of the matched
 *     campaign list (e.g. for tooltips), so it's worth a small lib.
 *
 * Cache: keyed on `${adAccountId}|${since}|${until}`, 60s TTL. Lives
 * on the route module's process so the in-flight tab toggle doesn't
 * fan out three Graph calls in a row when switching time ranges.
 */

export interface AdAccountBenchmarks {
  /** Rolling-window CTR as a percentage (0–100). null if not enough data. */
  ctr: number | null;
  /** Rolling-window CPM in account currency. null if not enough data. */
  cpm: number | null;
  /** Rolling-window cost per result in account currency. null if not enough data. */
  cpr: number | null;
  /** How many campaigns rolled into the average — surfaced for the UI tooltip. */
  campaignsCounted: number;
}

interface BenchmarkInsightsRow {
  campaign_id?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
}

interface BenchmarkInsightsResponse {
  data?: BenchmarkInsightsRow[];
  paging?: { cursors?: { after?: string }; next?: string };
}

const CACHE_TTL_MS = 60_000;
const MAX_PAGES = 20;
const MIN_CAMPAIGNS_FOR_BASELINE = 5;

interface CacheEntry {
  value: AdAccountBenchmarks;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * Result-count action types Meta surfaces on insights — we sum
 * whichever is present so CPR mirrors the Ads Manager "Results" column
 * for objectives we use most (conversions, leads, link clicks, post
 * engagement). Order matters: if a campaign reports both purchases
 * AND link_clicks we want the further-down-funnel one to win, so
 * we pick the *first* matching action_type per row.
 */
const RESULT_ACTION_PRIORITY = [
  "offsite_conversion.fb_pixel_purchase",
  "purchase",
  "lead",
  "complete_registration",
  "onsite_conversion.lead_grouped",
  "landing_page_view",
  "link_click",
  "post_engagement",
];

function pickResults(row: BenchmarkInsightsRow): number {
  const actions = row.actions ?? [];
  for (const type of RESULT_ACTION_PRIORITY) {
    const match = actions.find((a) => a.action_type === type);
    if (match) {
      const v = Number.parseFloat(match.value ?? "");
      if (Number.isFinite(v)) return v;
    }
  }
  return 0;
}

/**
 * Compute account-wide benchmarks across the given window. `since` and
 * `until` are ISO date strings (YYYY-MM-DD); when both are null the
 * function falls back to a 90-day rolling window ending today.
 */
export async function computeBenchmarks(params: {
  adAccountId: string;
  token: string;
  since?: string | null;
  until?: string | null;
}): Promise<AdAccountBenchmarks> {
  const { adAccountId: rawAccount, token } = params;
  const adAccountId = rawAccount.startsWith("act_")
    ? rawAccount
    : `act_${rawAccount}`;

  const { since, until } = resolveWindow(params.since, params.until);
  const cacheKey = `${adAccountId}|${since}|${until}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let totalSpend = 0;
  let totalImpressions = 0;
  let totalClicks = 0;
  let totalResults = 0;
  const campaignIds = new Set<string>();
  let after: string | undefined;
  let pageCount = 0;

  try {
    while (pageCount < MAX_PAGES) {
      const queryParams: Record<string, string> = {
        fields: "campaign_id,spend,impressions,clicks,actions",
        time_range: JSON.stringify({ since, until }),
        level: "campaign",
        limit: "500",
      };
      if (after) queryParams.after = after;

      const res = await graphGetWithToken<BenchmarkInsightsResponse>(
        `/${adAccountId}/insights`,
        queryParams,
        token,
      );

      for (const row of res.data ?? []) {
        if (row.campaign_id) campaignIds.add(row.campaign_id);
        totalSpend += Number.parseFloat(row.spend ?? "") || 0;
        totalImpressions += Number.parseFloat(row.impressions ?? "") || 0;
        totalClicks += Number.parseFloat(row.clicks ?? "") || 0;
        totalResults += pickResults(row);
      }

      pageCount += 1;
      const nextCursor = res.paging?.cursors?.after;
      if (!res.paging?.next || !nextCursor) break;
      after = nextCursor;
    }
  } catch (err) {
    if (err instanceof MetaApiError) {
      // Surface as "no benchmark data" rather than failing the parent
      // request — the campaigns table still renders, just without
      // colour-coding.
      console.warn(
        `[ad-account-benchmarks] insights failed for ${adAccountId}:`,
        err.message,
      );
      return {
        ctr: null,
        cpm: null,
        cpr: null,
        campaignsCounted: 0,
      };
    }
    throw err;
  }

  const enough = campaignIds.size >= MIN_CAMPAIGNS_FOR_BASELINE;
  const ctr =
    enough && totalImpressions > 0
      ? (totalClicks / totalImpressions) * 100
      : null;
  const cpm =
    enough && totalImpressions > 0
      ? (totalSpend / totalImpressions) * 1000
      : null;
  const cpr =
    enough && totalResults > 0 ? totalSpend / totalResults : null;

  const value: AdAccountBenchmarks = {
    ctr,
    cpm,
    cpr,
    campaignsCounted: campaignIds.size,
  };
  cache.set(cacheKey, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function resolveWindow(
  since: string | null | undefined,
  until: string | null | undefined,
): { since: string; until: string } {
  // Both ends provided — trust the caller.
  if (since && until) return { since, until };

  // Default rolling 90-day window ending today (UTC).
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    since: since ?? start,
    until: until ?? end,
  };
}

