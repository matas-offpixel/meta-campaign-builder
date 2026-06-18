/**
 * lib/dashboard/glasgow-adset-rollup-fetch.ts
 *
 * Live ad-set-level Meta pull for the ONE mixed Glasgow TRAFFIC campaign
 * (6925933901665, named `[WC26-GLASGOW-O2] TRAFFIC`). That campaign carries
 * 9 ad sets — 5 tagged "- O2 academy" (→ WC26-GLASGOW-O2) and 4 tagged
 * "- SWG3" (→ WC26-GLASGOW-SWG3) — but its CAMPAIGN bracket is `[WC26-GLASGOW-O2]`,
 * so the campaign-level bracket matcher lands the entire campaign's spend +
 * engagement on WC26-GLASGOW-O2. This module re-derives the true per-venue
 * split at the AD-SET level so the rollup writer (and the lifetime cache) can
 * attribute each ad set to the right event_code at WRITE time.
 *
 * Replaces the hard-coded read-time snapshot in the deleted
 * `lib/dashboard/event-code-adset-splits.ts` (PR #493 / #530).
 *
 * SCOPE: Glasgow only. Do NOT generalise to a generic ad-set rollup writer.
 *
 * FAIL LOUD: on a Meta API error this THROWS — it does NOT silently fall back
 * to campaign-level numbers (a campaign-level fallback is exactly the drift
 * this PR removes). An ad set whose name matches neither venue suffix also
 * THROWS — a new ad set with an unexpected name must surface, not silently
 * land on the wrong venue.
 *
 * TESTABILITY: the pure classifier + aggregator + the `*WithFetcher` seams
 * take no `@/`-aliased imports (the `node --test` runner can't resolve `@/`).
 * The production wrappers lazy-import the real Graph client inside the function
 * body so importing this module from a test never triggers `@/` resolution.
 */

import {
  parseNum,
  sumActions,
  type ActionRow,
} from "../insights/event-code-lifetime-two-pass.ts";
import { resolveLpvFromActions } from "../insights/lpv-priority-chain.ts";
import { partitionMetaSpendForCampaign } from "../insights/meta-campaign-phase.ts";
import type { DailyMetaMetricsRow } from "../insights/types.ts";

// ── Constants ───────────────────────────────────────────────────────────────

/** The one mixed-ad-set Glasgow TRAFFIC campaign this module splits. */
export const GLASGOW_TRAFFIC_CAMPAIGN_ID = "6925933901665";

/**
 * Campaign name, used only to run the same regular/presale partition the
 * campaign-level path applies (`partitionMetaSpendForCampaign`). This campaign
 * is plain TRAFFIC → all spend is regular (presale = 0), but we route it
 * through the shared classifier so the rule stays in one place.
 */
export const GLASGOW_TRAFFIC_CAMPAIGN_NAME = "[WC26-GLASGOW-O2] TRAFFIC";

export type GlasgowVenueEventCode = "WC26-GLASGOW-O2" | "WC26-GLASGOW-SWG3";

export const GLASGOW_VENUE_EVENT_CODES: readonly GlasgowVenueEventCode[] = [
  "WC26-GLASGOW-O2",
  "WC26-GLASGOW-SWG3",
];

// Same attribution windows the campaign-level fetches use (meta.ts). Defined
// locally to keep this module free of `@/` imports.
const ATTRIBUTION_WINDOWS = JSON.stringify(["7d_click", "1d_view"]);

const REG_ACTION_TYPES = [
  "complete_registration",
  "offsite_conversion.fb_pixel_complete_registration",
];
const PURCHASE_ACTION_TYPES = [
  "offsite_conversion.fb_pixel_purchase",
  "purchase",
];
const LEAD_ACTION_TYPES = [
  "lead",
  "offsite_conversion.fb_pixel_lead",
  "complete_registration",
];

// ── Types ─────────────────────────────────────────────────────────────────

/** One ad-set-level Meta insights row (level=adset). */
export interface GlasgowAdSetInsightsRow {
  adset_id?: string;
  adset_name?: string;
  spend?: string;
  reach?: string;
  impressions?: string;
  clicks?: string;
  /** Present only with time_increment=1; absent for date_preset=maximum. */
  date_start?: string;
  actions?: ActionRow[];
}

/** Per-venue per-day rollup rows (matches `DailyMetaMetricsRow` shape). */
export interface GlasgowAdSetSplit {
  eventCode: GlasgowVenueEventCode;
  days: DailyMetaMetricsRow[];
}

/** Aggregate engagement totals for a venue (lifetime / maximum window). */
export interface GlasgowAdSetEngagementTotals {
  spend: number;
  presaleSpend: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  landingPageViews: number;
  metaRegs: number;
  metaPurchases: number;
  metaLeads: number;
  videoPlays3s: number;
  videoPlays15s: number;
  videoPlaysP100: number;
  engagements: number;
}

export interface GlasgowAdSetLifetimeSplit {
  eventCode: GlasgowVenueEventCode;
  totals: GlasgowAdSetEngagementTotals;
}

interface GlasgowGraphPaged<T> {
  data?: T[];
  paging?: { next?: string; cursors?: { after?: string } };
}

/** Injected Graph fetcher — the production wrapper supplies `graphGetWithToken`. */
export type GlasgowGraphFetcher = <T>(
  path: string,
  params: Record<string, string>,
  token: string,
) => Promise<GlasgowGraphPaged<T>>;

export interface FetchGlasgowAdSetSplitsArgs {
  token: string;
  /** Numeric or "act_"-prefixed ad account id. */
  adAccountId: string;
  /** YYYY-MM-DD inclusive lower bound. */
  since: string;
  /** YYYY-MM-DD inclusive upper bound. */
  until: string;
}

export interface FetchGlasgowAdSetLifetimeSplitsArgs {
  token: string;
  adAccountId: string;
}

// ── Pure: venue classifier ──────────────────────────────────────────────────

function normalizeDashes(s: string): string {
  // en-dash, em-dash, minus → hyphen, so " – O2 academy" matches " - O2 academy".
  return s.replace(/[–—−]/g, "-");
}

/**
 * Map an ad-set name to its venue event_code by the production naming rule:
 *   - contains " - O2 academy" (en-dash or hyphen, case-insensitive) → O2
 *   - contains " - SWG3"                                             → SWG3
 * THROWS on anything else (fail loud — a new ad set with an unexpected name
 * must not silently land on the wrong venue).
 */
export function classifyGlasgowAdSetVenue(
  adSetName: string,
): GlasgowVenueEventCode {
  const haystack = normalizeDashes(adSetName).toLowerCase();
  const isO2 = haystack.includes(" - o2 academy");
  const isSwg3 = haystack.includes(" - swg3");
  if (isO2 && isSwg3) {
    throw new Error(
      `[glasgow-adset] ad set "${adSetName}" matches BOTH O2 and SWG3 suffixes — ambiguous; fix the ad-set name.`,
    );
  }
  if (isO2) return "WC26-GLASGOW-O2";
  if (isSwg3) return "WC26-GLASGOW-SWG3";
  throw new Error(
    `[glasgow-adset] ad set "${adSetName}" (campaign ${GLASGOW_TRAFFIC_CAMPAIGN_ID}) ` +
      `matches neither " - O2 academy" nor " - SWG3". A new ad set must be classified ` +
      `explicitly — refusing to attribute it silently.`,
  );
}

// ── Pure: row aggregation ────────────────────────────────────────────────────

function emptyTotals(): GlasgowAdSetEngagementTotals {
  return {
    spend: 0,
    presaleSpend: 0,
    impressions: 0,
    reach: 0,
    linkClicks: 0,
    landingPageViews: 0,
    metaRegs: 0,
    metaPurchases: 0,
    metaLeads: 0,
    videoPlays3s: 0,
    videoPlays15s: 0,
    videoPlaysP100: 0,
    engagements: 0,
  };
}

function addRowToTotals(
  totals: GlasgowAdSetEngagementTotals,
  row: GlasgowAdSetInsightsRow,
): void {
  const { regular, presale } = partitionMetaSpendForCampaign(
    GLASGOW_TRAFFIC_CAMPAIGN_NAME,
    parseNum(row.spend),
  );
  totals.spend += regular;
  totals.presaleSpend += presale;
  totals.impressions += parseNum(row.impressions);
  totals.reach += parseNum(row.reach);
  totals.linkClicks += parseNum(row.clicks);
  totals.landingPageViews += resolveLpvFromActions(row.actions);
  totals.metaRegs += sumActions(row.actions, REG_ACTION_TYPES);
  totals.metaPurchases += sumActions(row.actions, PURCHASE_ACTION_TYPES);
  totals.metaLeads += sumActions(row.actions, LEAD_ACTION_TYPES);
  totals.videoPlays3s += sumActions(row.actions, ["video_view"]);
  totals.videoPlays15s += sumActions(row.actions, [
    "video_15_sec_watched_actions",
  ]);
  totals.videoPlaysP100 += sumActions(row.actions, [
    "video_p100_watched_actions",
  ]);
  totals.engagements += sumActions(row.actions, ["post_engagement"]);
}

function totalsToDailyRow(
  day: string,
  t: GlasgowAdSetEngagementTotals,
): DailyMetaMetricsRow {
  return {
    day,
    spend: t.spend,
    presaleSpend: t.presaleSpend,
    linkClicks: t.linkClicks,
    landingPageViews: t.landingPageViews,
    metaRegs: t.metaRegs,
    metaPurchases: t.metaPurchases,
    metaLeads: t.metaLeads,
    impressions: t.impressions,
    reach: t.reach,
    videoPlays3s: t.videoPlays3s,
    videoPlays15s: t.videoPlays15s,
    videoPlaysP100: t.videoPlaysP100,
    engagements: t.engagements,
  };
}

/**
 * Group ad-set rows by (venue, day) and aggregate. Every row's `adset_name`
 * MUST classify to a venue (throws otherwise). Returns one `GlasgowAdSetSplit`
 * per venue (both venues always present, empty `days` when no rows).
 *
 * `requireDay = true` (per-day mode) throws on a row missing `date_start`.
 */
export function aggregateGlasgowAdSetRowsByDay(
  rows: ReadonlyArray<GlasgowAdSetInsightsRow>,
): GlasgowAdSetSplit[] {
  // venue → day → totals
  const byVenue = new Map<
    GlasgowVenueEventCode,
    Map<string, GlasgowAdSetEngagementTotals>
  >([
    ["WC26-GLASGOW-O2", new Map()],
    ["WC26-GLASGOW-SWG3", new Map()],
  ]);

  for (const row of rows) {
    const day = row.date_start;
    if (!day) {
      throw new Error(
        `[glasgow-adset] ad-set row for "${row.adset_name ?? "<no name>"}" is missing date_start ` +
          `(per-day mode requires time_increment=1).`,
      );
    }
    const venue = classifyGlasgowAdSetVenue(row.adset_name ?? "");
    const dayMap = byVenue.get(venue)!;
    const totals = dayMap.get(day) ?? emptyTotals();
    addRowToTotals(totals, row);
    dayMap.set(day, totals);
  }

  return GLASGOW_VENUE_EVENT_CODES.map((eventCode) => {
    const dayMap = byVenue.get(eventCode)!;
    const days = [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, totals]) => totalsToDailyRow(day, totals));
    return { eventCode, days };
  });
}

/**
 * Aggregate ad-set rows into one engagement-totals object per venue (no
 * per-day breakdown). Used for the lifetime-cache re-add (date_preset=maximum).
 */
export function aggregateGlasgowAdSetRowsToTotals(
  rows: ReadonlyArray<GlasgowAdSetInsightsRow>,
): GlasgowAdSetLifetimeSplit[] {
  const byVenue = new Map<GlasgowVenueEventCode, GlasgowAdSetEngagementTotals>([
    ["WC26-GLASGOW-O2", emptyTotals()],
    ["WC26-GLASGOW-SWG3", emptyTotals()],
  ]);
  for (const row of rows) {
    const venue = classifyGlasgowAdSetVenue(row.adset_name ?? "");
    addRowToTotals(byVenue.get(venue)!, row);
  }
  return GLASGOW_VENUE_EVENT_CODES.map((eventCode) => ({
    eventCode,
    totals: byVenue.get(eventCode)!,
  }));
}

// ── Fetcher seams (pure I/O orchestration; inject the Graph client) ───────────

function ensureActPrefix(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

async function fetchAllAdSetRows(
  graphGet: GlasgowGraphFetcher,
  account: string,
  token: string,
  baseParams: Record<string, string>,
): Promise<GlasgowAdSetInsightsRow[]> {
  const rows: GlasgowAdSetInsightsRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const params: Record<string, string> = { ...baseParams, limit: "500" };
    if (after) params.after = after;
    // Throws on Meta error — we want that to propagate (fail loud, no fallback).
    const res = await graphGet<GlasgowAdSetInsightsRow>(
      `/${GLASGOW_TRAFFIC_CAMPAIGN_ID}/insights`,
      params,
      token,
    );
    for (const row of res.data ?? []) rows.push(row);
    after = res.paging?.cursors?.after;
    if (!res.paging?.next || !after) break;
  }
  return rows;
}

/** Test seam: per-day split with an injected fetcher. */
export async function fetchGlasgowAdSetSplitsWithFetcher(
  args: FetchGlasgowAdSetSplitsArgs,
  graphGet: GlasgowGraphFetcher,
): Promise<GlasgowAdSetSplit[]> {
  const account = ensureActPrefix(args.adAccountId);
  const rows = await fetchAllAdSetRows(graphGet, account, args.token, {
    level: "adset",
    fields: "adset_id,adset_name,spend,reach,impressions,clicks,actions",
    time_increment: "1",
    time_range: JSON.stringify({ since: args.since, until: args.until }),
    action_attribution_windows: ATTRIBUTION_WINDOWS,
  });
  return aggregateGlasgowAdSetRowsByDay(rows);
}

/** Test seam: lifetime (date_preset=maximum) totals with an injected fetcher. */
export async function fetchGlasgowAdSetLifetimeSplitsWithFetcher(
  args: FetchGlasgowAdSetLifetimeSplitsArgs,
  graphGet: GlasgowGraphFetcher,
): Promise<GlasgowAdSetLifetimeSplit[]> {
  const account = ensureActPrefix(args.adAccountId);
  const rows = await fetchAllAdSetRows(graphGet, account, args.token, {
    level: "adset",
    fields: "adset_id,adset_name,spend,reach,impressions,clicks,actions",
    date_preset: "maximum",
    action_attribution_windows: ATTRIBUTION_WINDOWS,
  });
  return aggregateGlasgowAdSetRowsToTotals(rows);
}

// ── Production wrappers (lazy-import the `@/` Graph client) ────────────────────

/**
 * Per-day per-venue ad-set split for campaign 6925933901665 over [since, until].
 * Throws on Meta API error (no campaign-level fallback) and on an unknown
 * ad-set name.
 */
export async function fetchGlasgowAdSetSplits(
  args: FetchGlasgowAdSetSplitsArgs,
): Promise<GlasgowAdSetSplit[]> {
  const { graphGetWithToken } = await import("@/lib/meta/client");
  return fetchGlasgowAdSetSplitsWithFetcher(
    args,
    graphGetWithToken as GlasgowGraphFetcher,
  );
}

/**
 * Lifetime (date_preset=maximum) per-venue engagement totals for campaign
 * 6925933901665. Used to re-add this campaign's venue share to the lifetime
 * cache after it is excluded from the bracket-match two-pass.
 */
export async function fetchGlasgowAdSetLifetimeSplits(
  args: FetchGlasgowAdSetLifetimeSplitsArgs,
): Promise<GlasgowAdSetLifetimeSplit[]> {
  const { graphGetWithToken } = await import("@/lib/meta/client");
  return fetchGlasgowAdSetLifetimeSplitsWithFetcher(
    args,
    graphGetWithToken as GlasgowGraphFetcher,
  );
}

/** Type guard: is this one of the two Glasgow split event codes? */
export function isGlasgowSplitEventCode(
  code: string | null | undefined,
): code is GlasgowVenueEventCode {
  return code === "WC26-GLASGOW-O2" || code === "WC26-GLASGOW-SWG3";
}
