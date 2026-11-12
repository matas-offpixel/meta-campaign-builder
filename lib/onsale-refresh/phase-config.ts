/**
 * The on-sale refresh's one phase config (R8 of
 * docs/design-record/2026-11-12-on-sale-refresh.html). Nothing in the
 * generator assumes weekly: every threshold, window and cadence is read
 * from here, so presale (P6) and the learning job (P5) tune a field, not
 * a rule.
 *
 * The on-sale numbers are the record's (Matas, 12 Nov): significant and
 * bottom third and 7 days and 2× cost per result to pause, at most 3
 * pauses; nothing but supply under 20 results a week; moves capped at
 * 20 % of the remaining budget. The presale config is noted here and
 * not yet switched on.
 */

export type ResultEvent = "initiate_checkout" | "landing_page_view" | "complete_registration";

export type PhaseConfig = {
  phase: "on_sale" | "presale";
  /** R1: the two Mondays of a cycle, or every N days on presale. */
  cadence: { kind: "cycle_mondays" } | { kind: "every_days"; days: number };
  /** R1: the last full Monday–Sunday week, or a rolling window on presale. */
  window: { kind: "last_full_week" } | { kind: "rolling_days"; days: number };
  /** The result the refresh optimises. On sale it is IC where the pixel fires, else LPV (R3). */
  resultEvent: ResultEvent;
  fallbackResultEvent: ResultEvent;
  /** Under this many results in the window, the proposal carries supply only. */
  minResultsPerWeek: number;
  /** A creative or ad set must have run this long before a pause or drop. */
  minDays: number;
  /** Pause: spend at least this × the campaign's cost per result. */
  pauseSpendMultiple: number;
  maxPauses: number;
  /** Adds per campaign per refresh and the 2-in-3 mix. */
  maxAdds: number;
  addMixShare: number;
  /** Bring back: a stopped ad set with ≥ results at ≤ this × the campaign's cost per result. */
  bringBackMinResults: number;
  bringBackMaxCprRatio: number;
  /** Bring back: a client cluster whose live-evidence shrunk index and confidence clear these. */
  bringBackClusterIndexAtLeast: number;
  bringBackClusterConfidenceAtLeast: number;
  /** Drop: ≥ minDays, spend ≥ this × cost per result, running at ≥ this × it. */
  dropSpendMultiple: number;
  dropCprRatio: number;
  /** Watch an ad set at this × the campaign's cost per result. */
  watchCprRatio: number;
  /** R3: IC when the event logged this many in 14 days; else the pixel's 7-day count; else LPV. */
  icMinIn14Days: number;
  icPixelMinIn7Days: number;
  purchaseMinIn14Days: number;
  /** R5: at most this share of the remaining budget moves in one refresh. */
  moveCapShare: number;
  /** R2: a move leaves an ad set at ≥ this × the campaign's cost per result for one at ≤ the second. */
  moveFromCprRatio: number;
  moveToCprRatio: number;
  /** The receiving ad set must have this many results in the window: a cheap cost on two results is not a destination. */
  moveToMinResults: number;
  /** The Drive folders a cycle's adds come from, under {owner} / Videos | Statics. */
  supplyFolders: readonly string[];
  claimsLadder: "on_sale" | "presale";
};

export const ONSALE_PHASE: PhaseConfig = {
  phase: "on_sale",
  cadence: { kind: "cycle_mondays" },
  window: { kind: "last_full_week" },
  resultEvent: "initiate_checkout",
  fallbackResultEvent: "landing_page_view",
  minResultsPerWeek: 20,
  minDays: 7,
  pauseSpendMultiple: 2,
  maxPauses: 3,
  maxAdds: 6,
  addMixShare: 2 / 3,
  bringBackMinResults: 10,
  bringBackMaxCprRatio: 0.6,
  bringBackClusterIndexAtLeast: 1.2,
  bringBackClusterConfidenceAtLeast: 0.5,
  dropSpendMultiple: 3,
  dropCprRatio: 2,
  watchCprRatio: 1.5,
  icMinIn14Days: 10,
  icPixelMinIn7Days: 10,
  purchaseMinIn14Days: 15,
  moveCapShare: 0.2,
  moveFromCprRatio: 1.5,
  moveToCprRatio: 0.75,
  moveToMinResults: 5,
  supplyFolders: ["UGC", "CTA", "No CTA"],
  claimsLadder: "on_sale",
};

/** R8, noted only. Not read by any job yet (P6). */
export const PRESALE_PHASE: PhaseConfig = {
  ...ONSALE_PHASE,
  phase: "presale",
  cadence: { kind: "every_days", days: 2 },
  window: { kind: "rolling_days", days: 7 },
  resultEvent: "complete_registration",
  fallbackResultEvent: "complete_registration",
  minResultsPerWeek: 10,
  minDays: 3,
  supplyFolders: ["Teaser", "Announcement"],
  claimsLadder: "presale",
};

export const RESULT_LABEL: Record<ResultEvent, { short: string; long: string }> = {
  initiate_checkout: { short: "IC", long: "Initiate Checkout" },
  landing_page_view: { short: "LPV", long: "Landing Page View" },
  complete_registration: { short: "reg", long: "Complete Registration" },
};
