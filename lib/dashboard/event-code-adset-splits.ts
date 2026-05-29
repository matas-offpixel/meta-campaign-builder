/**
 * lib/dashboard/event-code-adset-splits.ts
 *
 * Ad-set-level attribution overrides for campaigns whose bracket prefix
 * doesn't fully match all their ad sets' true event_codes.
 *
 * **Why this exists (PR #493):**
 *
 * Meta campaign 6925933901665 is named `[WC26-GLASGOW-O2] TRAFFIC` but
 * contains 9 mixed ad sets:
 *   - 5 tagged "- O2 academy"  →  WC26-GLASGOW-O2
 *   - 4 tagged "- SWG3"        →  WC26-GLASGOW-SWG3
 *
 * The dashboard's bracket matcher reads only the CAMPAIGN name, so the
 * entire campaign's spend, reach, clicks, and LPV land on WC26-GLASGOW-O2.
 * The Excel source of truth (Meta MCP verification, 2026-05-29) confirmed
 * a 74.54 / 25.46 split by ad-set-level spend.
 *
 * **Architecture:**
 *
 * - `CAMPAIGN_SPLITS` is the single place to declare future overrides.
 * - `snapshotTotals` are hardcoded at the time of the last Meta MCP pull
 *   and should be refreshed quarterly (or whenever a campaign fully ends).
 *   They are used ONLY for the engagement split (reach / clicks / LPV).
 *   Spend adjustment is derived from `sharePercent` applied to the snapshot
 *   spend total.
 * - Non-Glasgow event codes are not affected. The helpers short-circuit
 *   immediately when no rule matches.
 *
 * **Surfaces covered:**
 *   1. Lifetime cache (reach / link_clicks / LPV)  — adjusted in the portal
 *      loader (`lib/db/client-portal-server.ts`) so every surface reading
 *      `lifetimeMetaByEventCode` automatically gets the correct numbers.
 *   2. Spend (rollup-backed)  — adjusted via `getSpendAdjustmentGbp()` in
 *      `buildVenueCanonicalFunnel` (Funnel Pacing) and in `VenueSection`
 *      inside `client-portal-venue-table.tsx` (Performance Summary).
 *
 * **Refresh cadence:**  Quarterly, or when campaign 6925933901665 finishes.
 * Run `Meta MCP ads_get_ad_entities` at ad-set level for campaign
 * 6925933901665, recompute sharePercent from ad-set spend totals, update
 * snapshotTotals from the campaign-level lifetime totals.
 */

import type { EventCodeLifetimeMetaCacheRow } from "../db/event-code-lifetime-meta-cache.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CampaignSplitShare {
  eventCode: string;
  /** Fraction of the campaign's totals attributed to this event_code (0–1). */
  sharePercent: number;
  /**
   * Human-readable rationale for the split. Used in PR bodies and
   * quarterly review notes — not surfaced in UI.
   */
  rationale: string;
}

export interface CampaignSplit {
  campaignId: string;
  campaignName: string;
  /**
   * Lifetime totals for this campaign as of the last Meta MCP pull.
   * Used to compute absolute adjustment amounts for reach / clicks / LPV
   * (which are deduplicated totals in the cache — we can't extract
   * per-campaign contributions at query time). Spend uses the same
   * snapshot for consistency.
   *
   * Refresh quarterly via:
   *   Meta MCP ads_get_ad_entities({ campaign_ids: [campaignId], level: "adset" })
   */
  snapshotTotals: {
    spend: number;
    reach: number;
    linkClicks: number;
    landingPageViews: number;
  };
  splits: CampaignSplitShare[];
}

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * All known campaign-level attribution overrides.
 *
 * Currently only WC26-GLASGOW-O2's TRAFFIC campaign has mixed ad sets.
 * Add new entries here as needed; code paths short-circuit when no rule
 * matches, so non-Glasgow venues are unaffected.
 *
 * SNAPSHOT DATE: 2026-05-29 (Meta MCP pull, verified against Excel WC26
 * cross-reference `docs/WC26_funnel_cross_reference.xlsx`).
 */
export const CAMPAIGN_SPLITS: CampaignSplit[] = [
  {
    campaignId: "6925933901665",
    campaignName: "[WC26-GLASGOW-O2] TRAFFIC",
    snapshotTotals: {
      spend: 6562.92,
      reach: 915207,
      linkClicks: 84725,
      landingPageViews: 52839,
    },
    splits: [
      {
        eventCode: "WC26-GLASGOW-O2",
        sharePercent: 0.7454,
        rationale:
          "5 ad sets with '- O2 academy' suffix (BOFU, MOFU, TOFU, Lookalikes, Advantage+). " +
          "Share computed from ad-set-level lifetime spend via Meta MCP 2026-05-29.",
      },
      {
        eventCode: "WC26-GLASGOW-SWG3",
        sharePercent: 0.2546,
        rationale:
          "4 ad sets with '- SWG3' suffix (Football Prospecting, Lookalikes, " +
          "4thefans Fans, Advantage+). Share computed from ad-set-level lifetime spend.",
      },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the GBP spend delta (positive or negative) to apply to an
 * event_code's rollup-backed spend total.
 *
 * For the campaign OWNER (share > 50 %): subtracts the non-owner
 * fraction (i.e. removes the other venue's misattributed spend).
 *
 * For the campaign BORROWER (share < 50 %): adds its share back
 * (i.e. recovers the spend the owner stole).
 *
 * Returns 0 when no rule applies — safe to call for any event_code.
 */
export function getSpendAdjustmentGbp(eventCode: string): number {
  let delta = 0;
  for (const rule of CAMPAIGN_SPLITS) {
    const share = rule.splits.find((s) => s.eventCode === eventCode);
    if (!share) continue;
    const snapshot = rule.snapshotTotals.spend;
    if (share.sharePercent > 0.5) {
      // Owner: subtract the non-owner portion
      delta -= snapshot * (1 - share.sharePercent);
    } else {
      // Borrower: add back its own share
      delta += snapshot * share.sharePercent;
    }
  }
  return delta;
}

/**
 * Returns the engagement metric deltas for a given event_code.
 * Follows the same owner / borrower convention as `getSpendAdjustmentGbp`.
 *
 * Returns zeros when no rule applies.
 */
function getEngagementAdjustments(eventCode: string): {
  reach: number;
  linkClicks: number;
  landingPageViews: number;
} {
  let reach = 0;
  let linkClicks = 0;
  let landingPageViews = 0;
  for (const rule of CAMPAIGN_SPLITS) {
    const share = rule.splits.find((s) => s.eventCode === eventCode);
    if (!share) continue;
    const snap = rule.snapshotTotals;
    const isOwner = share.sharePercent > 0.5;
    const factor = isOwner
      ? -(1 - share.sharePercent) // owner loses non-owner fraction
      : share.sharePercent;       // borrower gains its own fraction
    reach += snap.reach * factor;
    linkClicks += snap.linkClicks * factor;
    landingPageViews += snap.landingPageViews * factor;
  }
  return { reach, linkClicks, landingPageViews };
}

/**
 * Applies ad-set-level split adjustments to an array of lifetime-meta cache
 * rows.  Returns a new array — input is not mutated.
 *
 * Only rows whose `event_code` matches a split rule are modified.  All
 * other rows are returned unchanged (by reference).
 *
 * Called in `lib/db/client-portal-server.ts` after
 * `loadEventCodeLifetimeMetaCacheForClient` so every surface that reads
 * `portal.lifetimeMetaByEventCode` automatically sees the corrected totals.
 */
export function applyAdsetSplitsToLifetimeMeta(
  rows: EventCodeLifetimeMetaCacheRow[],
): EventCodeLifetimeMetaCacheRow[] {
  return rows.map((row) => {
    const adj = getEngagementAdjustments(row.event_code);
    if (adj.reach === 0 && adj.linkClicks === 0 && adj.landingPageViews === 0) {
      return row; // no rule applies — pass-through
    }
    return {
      ...row,
      meta_reach:
        row.meta_reach != null ? row.meta_reach + adj.reach : null,
      meta_link_clicks:
        row.meta_link_clicks != null
          ? row.meta_link_clicks + adj.linkClicks
          : null,
      meta_landing_page_views:
        row.meta_landing_page_views != null
          ? row.meta_landing_page_views + adj.landingPageViews
          : null,
    };
  });
}
