/**
 * lib/dashboard/sales-calc/types.ts
 *
 * What the dashboard v2 server calc (HD3) reads, already fetched. The pure
 * calc (`figures.ts`, `model.ts`) takes this and nothing else, so the
 * internal page, the share route and the parity test run the same code.
 *
 * Every day is an ISO calendar day (yyyy-mm-dd). Every money figure is
 * pounds. Relative imports only: the `node --test` runner can't resolve `@/`.
 */

export type Platform = "meta" | "tiktok" | "google";

export const PLATFORM_LABEL: Record<Platform, string> = {
  meta: "Meta",
  tiktok: "TikTok",
  google: "Google",
};

export type CountSource = "manual" | "internal_counts" | "xlsx_import" | "fourthefans" | "foursomething" | "eventbrite";

/** One ticket count for a show on one day: one source, never blended (D8). */
export interface ShowCount {
  day: string;
  /** Paid tickets only. Comps never count as sold (D8). */
  sold: number;
  /** Comps on the same count, shown only as a context line. Null when the source has no comp figure. */
  comps: number | null;
  source: CountSource;
}

/** A show's final count (HD1 ruling c): the latest written count on or after show day. */
export interface FinalCountInput {
  day: string;
  paid: number;
  comps: number;
  source: CountSource;
  /** internal_count_blocks.id, the library entry's key. */
  blockId: string | null;
}

export interface ShowInput {
  eventId: string;
  code: string;
  name: string;
  /** Show day. */
  showDate: string;
  /** London day presale opened, else general sale. Null when neither is set. */
  presaleDate: string | null;
  /** events.capacity. Null when not set; never defaulted (D9). */
  capacity: number | null;
  /** D9 sellable allocation: paid tiers' allocation, else capacity, else null. */
  allocation: number | null;
  allocationFromTiers: boolean;
  isUmbrella: boolean;
  /** CIRQLIN page link (D9). Null → "No CIRQLIN page". */
  cirqlinPageId: string | null;
  /** events.meta_campaign_id, split. Linked beats tagged (D1). */
  linkedCampaignIds: string[];
  /** The event's own reference set (D9). Empty → the client's library. */
  referenceEventIds: string[];
  /** Every count, collapsed to one source per day, ascending by day. */
  counts: ShowCount[];
  finalCount: FinalCountInput | null;
}

/** One Meta campaign on one day, summed over its ads (ad_daily_insights). */
export interface MetaCampaignDay {
  campaignId: string;
  campaignName: string;
  day: string;
  spend: number;
  linkClicks: number;
  landingPageViews: number;
  initiateCheckouts: number;
  addsToCart: number;
}

/** One Google campaign on one day (google_ads_daily_snapshots), keyed by the [CODE] in its name. */
export interface GoogleCampaignDay {
  eventCode: string;
  day: string;
  spend: number;
}

/** event_daily_rollups, one row per show per day. A null column is "no figure", not £0. */
export interface RollupDay {
  eventId: string;
  day: string;
  meta: number | null;
  tiktok: number | null;
  google: number | null;
  /** True when that platform's leg wrote this row (source_*_at set). */
  metaSynced: boolean;
  tiktokSynced: boolean;
  googleSynced: boolean;
}

/** CIRQLIN signups on the show's linked page, per day. */
export interface SignupDay {
  eventId: string;
  day: string;
  signups: number;
}

/** A stored D10 library entry, with its evidence (migration 238). */
export interface LiftEntry {
  eventId: string;
  code: string;
  name: string;
  showDate: string;
  d21Day: string;
  d21Sold: number;
  d7Day: string;
  d7Sold: number;
  finalDay: string;
  finalPaid: number;
  compsExcluded: number;
  perDayBefore: number;
  perDayFinalWeek: number;
  /** Floored at 1. */
  lift: number;
  finalBlockId: string | null;
  computedAt: string;
}

export interface SalesCalcInput {
  client: { id: string; name: string };
  /** London today. Nothing on or after it is read: spend runs to yesterday. */
  today: string;
  shows: ShowInput[];
  metaCampaignDays: MetaCampaignDay[];
  googleCampaignDays: GoogleCampaignDay[];
  rollups: RollupDay[];
  signups: SignupDay[];
  /** Stored library entries for this client's shows. Missing ones are computed in memory. */
  library: LiftEntry[];
}
