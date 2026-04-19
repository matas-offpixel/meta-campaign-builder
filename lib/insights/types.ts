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

/** Top-level insights payload returned by the share + insights routes. */
export interface EventInsightsPayload {
  /** ISO timestamp the data was fetched. Drives the "Last updated" label. */
  fetchedAt: string;
  /** Date preset that was queried (e.g. "maximum"). */
  datePreset: "maximum" | "last_30d" | "last_7d";
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

/** One ad → its preview iframe + per-ad numbers. */
export interface CreativeRow {
  adId: string;
  adName: string;
  campaignName: string;
  /** Iframe HTML strings keyed by Meta ad-format string. */
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
