/**
 * Pure helper — no side effects, no `MetaApiError` / class imports — so it
 * can be unit-tested directly under `node --experimental-strip-types`
 * without pulling in lib/meta/client.ts's parameter-property class syntax
 * (unsupported in strip-only mode; see adset-cascading-status-filter.test.ts).
 *
 * Computes the Meta `effective_status` allow-list for
 * {@link import("./client.ts").fetchAdSetsForCampaign}'s `filter` option.
 *
 * Meta's ad-set `effective_status` is NOT purely the ad set's own toggle —
 * it cascades from the parent campaign. An ad set whose own `status` is
 * "ACTIVE" reports `effective_status: "CAMPAIGN_PAUSED"` (not "ACTIVE")
 * whenever its parent campaign is paused, and similarly "ADSET_PAUSED" /
 * "WITH_ISSUES" can appear for ad sets that are otherwise configured on.
 * Without these three cascading values in the allow-list, "Add to existing
 * ad set(s)" / "attach_all_adsets" silently returned ONLY the ad sets that
 * were paused at their own level, hiding every ad set under a currently-
 * paused campaign — surfaced live as "only paused ad sets show up"
 * (2026-07-15 bug report). Mirrors the same cascading-status allow-list
 * already used for ad-level fetches in
 * lib/reporting/active-creatives-fetch.ts (fetchActiveAdsForEventAccountOnce).
 */

export type AdSetStatusFilter = "relevant" | "active" | "paused" | "all";

/** Effective-status values that can appear on an ad set whose OWN toggle is
 * still on, but whose delivery is suppressed by something above/around it. */
export const CASCADING_PAUSE_STATUSES = [
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "WITH_ISSUES",
] as const;

/**
 * Returns the `effective_status` allow-list to send to Meta for a given
 * picker filter, or `null` when no server-side status filter should be
 * applied (`"all"`).
 */
export function effectiveStatusAllowListFor(
  filter: AdSetStatusFilter,
): string[] | null {
  switch (filter) {
    case "relevant":
      return ["ACTIVE", "PAUSED", ...CASCADING_PAUSE_STATUSES];
    case "active":
      return ["ACTIVE", ...CASCADING_PAUSE_STATUSES];
    case "paused":
      // Literal ad-set-own-PAUSED only — distinct from the cascading
      // statuses above, which represent an ad set whose own toggle is ON.
      return ["PAUSED"];
    case "all":
      return null;
  }
}
