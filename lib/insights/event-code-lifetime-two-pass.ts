/**
 * lib/insights/event-code-lifetime-two-pass.ts
 *
 * Pure aggregation core for `fetchEventLifetimeMetaMetricsWithFetcher`
 * (PR #418, audit Section 5 + Joe's Cat F fix in PR #417).
 *
 * Lifted out of `meta.ts` so it can be unit-tested without resolving
 * the `@/` alias graph that meta.ts imports (Supabase client, server-
 * only auth, classifyCampaignFunnelStage, etc.). The test runner
 * `node --experimental-strip-types --test` doesn't process tsconfig
 * paths; this module imports only from `./meta-event-code-match`
 * (also alias-free).
 *
 * The orchestration (`fetchEventLifetimeMetaMetricsWithFetcher`)
 * lives in `meta.ts`. The arithmetic + filter + ID-collection logic
 * live here and are pinned by
 * `lib/insights/__tests__/fetchEventLifetimeMetaMetrics.test.ts`.
 */

import { campaignMatchesBracketedEventCode } from "./meta-event-code-match.ts";

export interface PerCampaignLifetimeRow {
  campaign_id?: string;
  campaign_name?: string;
  impressions?: string;
  reach?: string;
  inline_link_clicks?: string;
  actions?: ActionRow[];
}

export interface AccountLevelLifetimeRow {
  reach?: string;
  frequency?: string;
}

export interface ActionRow {
  action_type: string;
  value: string;
}

/**
 * Cumulative output of the Pass-1 walk over `level=campaign` rows.
 * Reach is collected ONLY as a fallback for transient Pass-2 failures
 * — see the `combineTwoPassReach` resolver below.
 */
export interface Pass1Totals {
  perCampaignReachSum: number;
  impressions: number;
  linkClicks: number;
  metaRegs: number;
  videoPlays3s: number;
  videoPlays15s: number;
  videoPlaysP100: number;
  engagements: number;
  matchedCampaignIds: string[];
  matchedCampaignNames: string[];
  filteredOutCampaignNames: string[];
}

const REG_ACTION_TYPES = [
  "complete_registration",
  "offsite_conversion.fb_pixel_complete_registration",
];

/**
 * Walk one or more pages of `level=campaign` rows from Meta, applying
 * the case-sensitive bracket post-filter, and accumulate:
 *   1. Matched campaign IDs (drives Pass 2's `IN` filter).
 *   2. Per-campaign reach SUM (Pass-2 fallback only).
 *   3. Additive metrics (impressions, clicks, regs, video, engagements).
 *
 * Pure: no I/O. Caller is responsible for pagination.
 */
export function aggregatePass1Pages(
  pages: ReadonlyArray<{ data: ReadonlyArray<PerCampaignLifetimeRow> }>,
  eventCode: string,
): Pass1Totals {
  let perCampaignReachSum = 0;
  let impressions = 0;
  let linkClicks = 0;
  let metaRegs = 0;
  let videoPlays3s = 0;
  let videoPlays15s = 0;
  let videoPlaysP100 = 0;
  let engagements = 0;
  const matchedIds: string[] = [];
  const matchedNames = new Set<string>();
  const filteredOut = new Set<string>();

  for (const page of pages) {
    for (const row of page.data ?? []) {
      const name = row.campaign_name ?? "";
      const id = row.campaign_id ?? "";
      if (!campaignMatchesBracketedEventCode(name, eventCode)) {
        if (name) filteredOut.add(name);
        continue;
      }
      if (id) matchedIds.push(id);
      matchedNames.add(name);
      perCampaignReachSum += parseNum(row.reach);
      impressions += parseNum(row.impressions);
      linkClicks += parseNum(row.inline_link_clicks);
      metaRegs += sumActions(row.actions, REG_ACTION_TYPES);
      videoPlays3s += sumActions(row.actions, ["video_view"]);
      videoPlays15s += sumActions(row.actions, [
        "video_15_sec_watched_actions",
      ]);
      videoPlaysP100 += sumActions(row.actions, [
        "video_p100_watched_actions",
      ]);
      engagements += sumActions(row.actions, ["post_engagement"]);
    }
  }

  return {
    perCampaignReachSum,
    impressions,
    linkClicks,
    metaRegs,
    videoPlays3s,
    videoPlays15s,
    videoPlaysP100,
    engagements,
    matchedCampaignIds: matchedIds,
    matchedCampaignNames: [...matchedNames].sort(),
    filteredOutCampaignNames: [...filteredOut].sort(),
  };
}

/**
 * Build the `filtering` payload for Pass 2's `level=account` call.
 * Meta's exact shape: `[{ field: "campaign.id", operator: "IN",
 * value: [ids] }]`. Lifted out so the test can assert against the
 * builder rather than scrape the JSON inside meta.ts.
 */
export function buildPass2CampaignIdFilter(
  campaignIds: ReadonlyArray<string>,
): string {
  return JSON.stringify([
    { field: "campaign.id", operator: "IN", value: [...campaignIds] },
  ]);
}

/**
 * Resolve the final `reach` value from Pass 1 (per-campaign sum) +
 * Pass 2 (account-level dedup). The account-level value wins when:
 *   - Pass 2 returned a row, AND
 *   - that row's reach > 0.
 *
 * Otherwise we fall back to the per-campaign sum + emit a `console.warn`.
 * The hard floor protects against writing a 0 to the cache (Meta
 * sometimes returns a zero-row response on transient internal errors;
 * the venue card would then render `—` which is visually worse than
 * the slightly-inflated per-campaign sum).
 *
 * Returns the resolved value AND the source so the caller can log a
 * structured diagnostic line.
 */
export function combineTwoPassReach(args: {
  perCampaignSum: number;
  accountRow: AccountLevelLifetimeRow | undefined;
}): { reach: number; source: "account_dedup" | "campaign_sum_fallback" } {
  if (!args.accountRow) {
    return { reach: args.perCampaignSum, source: "campaign_sum_fallback" };
  }
  const accountReach = parseNum(args.accountRow.reach);
  if (accountReach <= 0) {
    return { reach: args.perCampaignSum, source: "campaign_sum_fallback" };
  }
  return { reach: accountReach, source: "account_dedup" };
}

export function parseNum(raw: string | undefined): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function sumActions(
  actions: ReadonlyArray<ActionRow> | undefined,
  matchTypes: ReadonlyArray<string>,
): number {
  if (!actions?.length) return 0;
  const matchSet = new Set(matchTypes);
  let total = 0;
  for (const row of actions) {
    if (matchSet.has(row.action_type)) {
      const value = Number(row.value);
      if (Number.isFinite(value)) total += value;
    }
  }
  return total;
}
