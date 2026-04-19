/**
 * lib/insights/types.ts
 *
 * Shared insights data shapes for the public report (Slice U) and the
 * future internal Reporting tab. Living in lib/insights/* (not lib/meta/*)
 * because the existing Meta routes are review-frozen — we don't want
 * insights work to land under that prefix.
 *
 * The only Meta channel wired in v1 is, well, Meta. The data shape leaves
 * room for TikTok / Google later — `channelBreakdown` always returns the
 * Meta number plus null sentinels for the others, so the UI can flip a
 * single condition (`channelBreakdown.tiktok != null`) to start rendering
 * a multi-channel split without a refactor.
 */

/** Aggregate Meta numbers for an event. All cost values are in GBP. */
export interface MetaTotals {
  spend: number;
  impressions: number;
  /**
   * Sum of per-campaign reach across every matched campaign.
   *
   * NOT deduplicated unique reach across the event — Meta does not
   * expose a true unique-reach across an arbitrary set of campaigns
   * without a Reach & Frequency report. A user reached by N campaigns
   * is counted N times here.
   *
   * UI MUST surface this caveat (label suffix `(sum)` + an aside) so a
   * client doesn't read it as the unique people reached. Future slices
   * that wire R&F should introduce a separate `reachUnique` field
   * rather than mutating this one — keeps the contract honest.
   */
  reachSum: number;
  /** "Clicks (all)" — link clicks across destinations. */
  clicks: number;
  /** Landing page views — derived from `actions[action_type=landing_page_view]`. */
  landingPageViews: number;
  /** Registrations — derived from `actions[action_type=lead]` (Meta lead form + pixel Lead). */
  registrations: number;
  /** Purchases — `actions[action_type=offsite_conversion.fb_pixel_purchase]`. */
  purchases: number;
  /** Purchase value (GBP) — `action_values[…purchase]`. */
  purchaseValue: number;
  /** Return on ad spend — purchaseValue / spend. 0 when spend == 0. */
  roas: number;
  /** Cost per mille — spend / (impressions / 1000). 0 when impressions == 0. */
  cpm: number;
  /**
   * Frequency — impressions / reachSum. 0 when reachSum == 0.
   *
   * Inherits the same caveat as `reachSum`: because the denominator is
   * over-counted, this value is UNDER-stated relative to true unique
   * frequency. Treat as a coarse signal only; defer to per-campaign
   * frequency for accuracy.
   */
  frequency: number;
  /** Cost per registration — spend / registrations. 0 when registrations == 0. */
  cpr: number;
  /** Cost per landing page view — spend / landingPageViews. 0 when LPVs == 0. */
  cplpv: number;
  /** Cost per purchase — spend / purchases. 0 when purchases == 0. */
  cpp: number;
}

/** Per-campaign row for the breakdown table. */
export interface MetaCampaignRow {
  id: string;
  name: string;
  status: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  landingPageViews: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
  roas: number;
  cpr: number;
  cplpv: number;
}

/** Channel split — Meta in v1, others reserved. */
export interface ChannelBreakdown {
  meta: number;
  tiktok: number | null;
  google: number | null;
}

// ─── Timeframe ──────────────────────────────────────────────────────────────

/**
 * Meta `date_preset` values surfaced as the timeframe selector on the
 * report. Order matters — `DATE_PRESETS` is the canonical render order
 * for the segmented control.
 *
 * "maximum" maps to Meta's own `date_preset=maximum` (lifetime). Every
 * event campaign is launched per-event so "lifetime" is effectively
 * "for this event" — that's the safe default and the one wired before
 * this slice.
 *
 * The other seven values pass straight through to Meta as documented at
 * https://developers.facebook.com/docs/marketing-api/insights/parameters/v21.0
 * — no app-side translation. If Meta deprecates one we narrow this
 * union and the route handler `parseDatePreset` falls back to "maximum".
 */
export type DatePreset =
  | "maximum"
  | "last_30d"
  | "last_14d"
  | "last_7d"
  | "last_3d"
  | "yesterday"
  | "today"
  | "this_month";

export const DATE_PRESETS: readonly DatePreset[] = [
  "maximum",
  "last_30d",
  "last_14d",
  "last_7d",
  "last_3d",
  "yesterday",
  "today",
  "this_month",
] as const;

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  maximum: "All time",
  last_30d: "Past 30 days",
  last_14d: "Past 14 days",
  last_7d: "Past 7 days",
  last_3d: "Past 3 days",
  yesterday: "Yesterday",
  today: "Today",
  this_month: "This month",
};

/** Top-level insights payload returned by the share + insights routes. */
export interface EventInsightsPayload {
  /** ISO timestamp the data was fetched. Drives the "Last updated" label. */
  fetchedAt: string;
  /** Date preset that was queried (e.g. "maximum"). */
  datePreset: DatePreset;
  /** Aggregated Meta totals across every campaign matched by event_code. */
  totals: MetaTotals;
  /** Total spend across all wired channels. v1: equals totals.spend. */
  totalSpend: number;
  /** Per-channel spend split. tiktok/google are null until wired. */
  channelBreakdown: ChannelBreakdown;
  /** Per-campaign rows, sorted by spend desc. */
  campaigns: MetaCampaignRow[];
  /** Number of Meta campaigns matched on `[event_code]`. */
  matchedCampaignCount: number;
}

/** Distinct error states surfaced to the public share page. */
export type InsightsErrorReason =
  | "no_event_code"
  | "no_owner_token"
  | "owner_token_expired"
  | "no_ad_account"
  | "meta_api_error"
  | "no_campaigns_matched";

export interface InsightsError {
  reason: InsightsErrorReason;
  message: string;
}

export type InsightsResult =
  | { ok: true; data: EventInsightsPayload }
  | { ok: false; error: InsightsError };

// ─── Creative-performance shapes (lazy-loaded) ─────────────────────────────

export type CreativeSortKey =
  | "lpv"
  | "registrations"
  | "purchases"
  | "spend"
  | "cplpv"
  | "cpr"
  | "cpp";

export const CREATIVE_SORT_KEYS: readonly CreativeSortKey[] = [
  "lpv",
  "registrations",
  "purchases",
  "spend",
  "cplpv",
  "cpr",
  "cpp",
] as const;

/**
 * One creative card on the report.
 *
 * After `groupCreativesByName` runs, a single `CreativeRow` may represent
 * N underlying Meta ads that share an `ad.name` across ad sets /
 * campaigns. Identical-name duplicates are summed so a client doesn't see
 * the same creative card three times. Pre-grouping each row mapped 1:1
 * to a Meta ad — the merge collapses the spam.
 *
 * Numeric metrics (spend / impressions / reach / lpv / regs / purchases /
 * purchaseValue) are SUMS across the merged ads. Cost-per metrics are
 * recomputed from the summed totals (NOT averaged from the per-ad
 * source rows — averaging would double-weight a low-spend dupe).
 */
export interface CreativeRow {
  /**
   * Stable card key. Equals `adIds[0]` — the first ad encountered in the
   * group. Safe as a React `key` because grouping is deterministic and
   * the underlying ad ids don't reshuffle between fetches.
   */
  adId: string;
  /** Shared ad name — the grouping key itself. */
  adName: string;
  /**
   * First campaign in which this ad name appears (encounter order). UI
   * should prefer `campaignNames[0]` and surface a "+N more" affordance
   * when `campaignNames.length > 1`.
   */
  campaignName: string;
  /**
   * Meta `effective_status` of the row. After merging this is "ACTIVE"
   * if ANY underlying ad is ACTIVE, else the first encountered status.
   * Drives the "All active" segmented filter on the creative panel.
   */
  effectiveStatus: string;
  /** Number of underlying Meta ads that were merged into this row. >= 1. */
  mergedCount: number;
  /** Underlying Meta ad ids in encounter order. `length === mergedCount`. */
  adIds: string[];
  /** Unique campaign names this ad name appears in, encounter order. */
  campaignNames: string[];
  /**
   * Iframe HTML strings keyed by Meta ad-format string. After merging
   * each placement is the FIRST non-null preview encountered across the
   * merged ads — same-named creatives are visually identical by
   * convention so picking any one is fine.
   */
  previews: {
    facebookFeed: string | null;
    instagramFeed: string | null;
    instagramStory: string | null;
    instagramReels: string | null;
  };
  spend: number;
  impressions: number;
  reach: number;
  landingPageViews: number;
  registrations: number;
  purchases: number;
  purchaseValue: number;
  cplpv: number;
  cpr: number;
  cpp: number;
}

export interface CreativesPayload {
  fetchedAt: string;
  sortBy: CreativeSortKey;
  rows: CreativeRow[];
}

export type CreativesResult =
  | { ok: true; data: CreativesPayload }
  | { ok: false; error: InsightsError };
