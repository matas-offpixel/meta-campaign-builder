/**
 * lib/reporting/active-creatives-group.ts
 *
 * Pure grouping helper for the per-event "Active Creatives" panel.
 * Takes a flat list of ad-level rows pulled from Meta and collapses
 * them by `creative_id` so the UI shows one card per creative
 * (instead of one card per ad — a single creative is typically
 * deployed across several ad sets, sometimes several campaigns).
 *
 * Why "pure": the route handler is responsible for fetching from
 * Meta, dealing with rate limits, and resolving the user's token.
 * This module knows nothing about HTTP or Supabase, which is what
 * makes it cheap to unit-test in `lib/reporting/active-creatives-
 * group.test.ts` without mocking the Meta client.
 *
 * Aggregation rules:
 * - Spend / impressions / clicks / reach / actions are summed.
 * - Rate metrics (CTR, CPM, CPC, CPR, CPP) are computed AFTER
 *   summation from the summed numerator + denominator. We never
 *   average a rate of rates — that's the canonical "Simpson's
 *   paradox" footgun for ad reporting.
 * - Frequency = sum_impressions / sum_reach. This over-counts
 *   reach when ads share users (Meta's `unique_users` API is the
 *   only authoritative source) but it's the best estimate we
 *   can make from per-ad rows.
 * - Ad sets are deduplicated by id. The first non-null name wins
 *   (Meta returns the same name for the same id, so order doesn't
 *   matter in practice).
 * - The representative ad id used for the Ads Manager deep-link
 *   is the one with the most spend in the group — that's the row
 *   the user is most likely to want to inspect.
 * - Ads with `creative_id == null` are dropped. They surface in
 *   the summary count via `meta.dropped_no_creative` upstream;
 *   the grouping layer doesn't try to be clever about them.
 *
 * Sort order on output: spend DESC. The UI may re-sort client-
 * side (CTR DESC, CPR ASC, etc) — having the default ordering
 * here keeps server response stable for snapshot tests.
 */

export interface AdInsightAction {
  action_type: string;
  /** Coerced to number at fetch time so the helper stays pure. */
  value: number;
}

export interface AdInput {
  ad_id: string;
  ad_name: string | null;
  status: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  creative_id: string | null;
  creative_name: string | null;
  /** Headline (Meta's `creative.title`). */
  headline: string | null;
  /** Body / primary text. */
  body: string | null;
  thumbnail_url: string | null;
  /** Per-ad insights. Null when Meta returned no insight rows for the ad. */
  insights: {
    spend: number;
    impressions: number;
    clicks: number;
    reach: number;
    /**
     * Per-ad frequency from Meta. Captured for parity but not used
     * in the aggregate — we recompute frequency from the summed
     * impressions / reach so the row math is self-consistent.
     */
    frequency: number;
    actions: AdInsightAction[];
  } | null;
}

export interface CreativeRowAdSet {
  id: string;
  name: string | null;
}

export interface CreativeRowCampaign {
  id: string;
  name: string | null;
}

export interface CreativeRow {
  creative_id: string;
  creative_name: string | null;
  headline: string | null;
  body: string | null;
  thumbnail_url: string | null;
  ad_count: number;
  adsets: CreativeRowAdSet[];
  campaigns: CreativeRowCampaign[];
  /** Highest-spend ad in the group — used for the Ads Manager deep link. */
  representative_ad_id: string;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  /** Percent (0-100). null when impressions = 0. */
  ctr: number | null;
  /** Account currency. null when impressions = 0. */
  cpm: number | null;
  /** Account currency. null when clicks = 0. */
  cpc: number | null;
  registrations: number;
  /** Account currency. null when registrations = 0. */
  cpr: number | null;
  purchases: number;
  /** Account currency. null when purchases = 0. */
  cpp: number | null;
  /** sum_impressions / sum_reach. null when reach = 0. */
  frequency: number | null;
}

// ─── Action-type allowlists ──────────────────────────────────────────────────
//
// Different ad accounts surface registrations / purchases under
// different action_type strings depending on whether they're using
// lead-gen forms, server-side conversions API events, or off-Meta
// pixel events. Sum across the whole allowlist so the panel reads
// consistently across Matas's accounts. If a single account starts
// double-counting, tune these lists rather than adding a column to
// the schema.

export const REGISTRATION_ACTION_TYPES: ReadonlySet<string> = new Set([
  "complete_registration",
  "lead",
  "registration",
  "offsite_conversion.fb_pixel_complete_registration",
  "offsite_conversion.fb_pixel_lead",
  "onsite_conversion.lead_grouped",
]);

export const PURCHASE_ACTION_TYPES: ReadonlySet<string> = new Set([
  "purchase",
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase",
]);

function safeRate(num: number, denom: number, scale = 1): number | null {
  // Defensive: denom must be a positive finite number. NaN / Infinity
  // / 0 / negative spend rows (Meta can return -0 on weird credit
  // adjustments) all collapse to null so the UI can render "—" and
  // the response never includes Infinity / NaN tokens that JSON.parse
  // turns into nonsense.
  if (!Number.isFinite(denom) || denom <= 0) return null;
  if (!Number.isFinite(num)) return null;
  return (num / denom) * scale;
}

interface Accumulator {
  creative_id: string;
  creative_name: string | null;
  headline: string | null;
  body: string | null;
  thumbnail_url: string | null;
  ad_ids: string[];
  /** Per-ad spend tracked alongside ad_ids so we can pick the top spender. */
  ad_spends: number[];
  adsets: Map<string, string | null>;
  campaigns: Map<string, string | null>;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  registrations: number;
  purchases: number;
}

/**
 * Group a flat list of ad rows by `creative_id`.
 *
 * Drops ads with `creative_id == null` (Meta surfaces these for
 * dynamic creative experiments and a handful of legacy ad types
 * — they'd just create a noisy "(no creative)" bucket the user
 * can't act on).
 */
export function groupAdsByCreative(ads: readonly AdInput[]): CreativeRow[] {
  const buckets = new Map<string, Accumulator>();

  for (const ad of ads) {
    if (!ad.creative_id) continue;
    const ins = ad.insights;
    const adSpend = ins?.spend ?? 0;
    const adImpressions = ins?.impressions ?? 0;
    const adClicks = ins?.clicks ?? 0;
    const adReach = ins?.reach ?? 0;
    const actions = ins?.actions ?? [];

    let registrations = 0;
    let purchases = 0;
    for (const a of actions) {
      if (REGISTRATION_ACTION_TYPES.has(a.action_type)) {
        registrations += Number.isFinite(a.value) ? a.value : 0;
      }
      if (PURCHASE_ACTION_TYPES.has(a.action_type)) {
        purchases += Number.isFinite(a.value) ? a.value : 0;
      }
    }

    const acc = buckets.get(ad.creative_id) ?? {
      creative_id: ad.creative_id,
      creative_name: ad.creative_name,
      headline: ad.headline,
      body: ad.body,
      thumbnail_url: ad.thumbnail_url,
      ad_ids: [] as string[],
      ad_spends: [] as number[],
      adsets: new Map<string, string | null>(),
      campaigns: new Map<string, string | null>(),
      spend: 0,
      impressions: 0,
      clicks: 0,
      reach: 0,
      registrations: 0,
      purchases: 0,
    };

    // First-seen wins for the descriptive fields. If two ads sharing
    // a creative_id have different names / headlines (rare — usually
    // an admin renamed mid-flight) we keep the first; anything more
    // creative would silently mask the divergence.
    if (!acc.creative_name && ad.creative_name) acc.creative_name = ad.creative_name;
    if (!acc.headline && ad.headline) acc.headline = ad.headline;
    if (!acc.body && ad.body) acc.body = ad.body;
    if (!acc.thumbnail_url && ad.thumbnail_url) acc.thumbnail_url = ad.thumbnail_url;

    acc.ad_ids.push(ad.ad_id);
    acc.ad_spends.push(adSpend);
    if (ad.adset_id) {
      const existing = acc.adsets.get(ad.adset_id);
      if (existing == null && ad.adset_name) {
        acc.adsets.set(ad.adset_id, ad.adset_name);
      } else if (!acc.adsets.has(ad.adset_id)) {
        acc.adsets.set(ad.adset_id, ad.adset_name);
      }
    }
    if (ad.campaign_id) {
      if (!acc.campaigns.has(ad.campaign_id)) {
        acc.campaigns.set(ad.campaign_id, ad.campaign_name);
      }
    }
    acc.spend += adSpend;
    acc.impressions += adImpressions;
    acc.clicks += adClicks;
    acc.reach += adReach;
    acc.registrations += registrations;
    acc.purchases += purchases;

    buckets.set(ad.creative_id, acc);
  }

  const rows: CreativeRow[] = [];
  for (const acc of buckets.values()) {
    let representative = acc.ad_ids[0];
    let topSpend = -Infinity;
    for (let i = 0; i < acc.ad_ids.length; i += 1) {
      if (acc.ad_spends[i] > topSpend) {
        topSpend = acc.ad_spends[i];
        representative = acc.ad_ids[i];
      }
    }

    rows.push({
      creative_id: acc.creative_id,
      creative_name: acc.creative_name,
      headline: acc.headline,
      body: acc.body,
      thumbnail_url: acc.thumbnail_url,
      ad_count: acc.ad_ids.length,
      adsets: [...acc.adsets.entries()].map(([id, name]) => ({ id, name })),
      campaigns: [...acc.campaigns.entries()].map(([id, name]) => ({ id, name })),
      representative_ad_id: representative,
      spend: acc.spend,
      impressions: acc.impressions,
      clicks: acc.clicks,
      reach: acc.reach,
      ctr: safeRate(acc.clicks, acc.impressions, 100),
      cpm: safeRate(acc.spend, acc.impressions, 1000),
      cpc: safeRate(acc.spend, acc.clicks),
      registrations: acc.registrations,
      cpr: safeRate(acc.spend, acc.registrations),
      purchases: acc.purchases,
      cpp: safeRate(acc.spend, acc.purchases),
      frequency: safeRate(acc.impressions, acc.reach),
    });
  }

  // Default ordering: spend DESC. The UI sort dropdown can re-sort
  // client-side for CTR / CPR / Frequency views.
  rows.sort((a, b) => b.spend - a.spend);
  return rows;
}
