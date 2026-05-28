/**
 * lib/insights/lpv-priority-chain.ts
 *
 * Shared resolver for Meta "Landing Page Views" from an Insights row's
 * `actions[]` array.
 *
 * Meta doesn't expose a top-level `landing_page_views` field — LPVs are
 * decomposed into one or more `action_type` rows that the caller has to
 * pick from. Different ad accounts emit different action_types depending
 * on which pixel events the event owner has wired:
 *
 *   - `omni_landing_page_view` — broader signal (web + app), Meta's
 *     preferred field on the modern API surface. Wins when populated.
 *   - `offsite_conversion.fb_pixel_landing_page_view` — pixel-attributed
 *     specifically. Falls back here when omni isn't emitted by the pixel
 *     config (older event setups).
 *   - `landing_page_view` — raw web LPV. Last resort.
 *
 * Pre-PR this priority chain lived inline in
 * `lib/reporting/active-creatives-fetch.ts` (`ORPHAN_LPV_PRIORITY` and
 * `sumPriorityAction`). The rollup writer convergence (PR-A of issue
 * #467) needs the same chain in two new places — the daily-window
 * helper in `lib/insights/meta.ts` and the lifetime two-pass aggregator
 * in `lib/insights/event-code-lifetime-two-pass.ts`. Extracting to a
 * shared module prevents the three call sites drifting (they used to
 * sum `landing_page_view` directly, which double-counted when a pixel
 * emitted both omni AND raw).
 *
 * The contract: pick the FIRST non-zero priority match. Never sum across
 * the chain — `omni` and `landing_page_view` are typically the same
 * number (Meta emits both for a web-only LPV); summing them would
 * double-count. Confirmed against Meta MCP on Edinburgh's WC26
 * campaigns (issue #467 verification): omni = raw for both campaigns.
 */

/**
 * Priority chain for Landing Page View extraction. First non-zero match
 * wins. Order ratified by the active-creatives panel since PR #56
 * (lib/reporting/active-creatives-fetch.ts:296-300) — kept identical so
 * rollup writes match per-creative views numerically.
 */
export const LPV_ACTION_PRIORITY = [
  "omni_landing_page_view",
  "offsite_conversion.fb_pixel_landing_page_view",
  "landing_page_view",
] as const;

export interface ActionRowLike {
  action_type?: string;
  value?: string | number;
}

/**
 * Resolve a single LPV value from a Meta Insights row's `actions[]`.
 *
 * Returns `0` when:
 *   - `actions` is undefined / null / empty, or
 *   - none of the priority action_types are present, or
 *   - the matched action's value parses to a non-finite number.
 *
 * Returns the parsed value of the FIRST priority match (even if zero
 * — the caller can decide whether a zero-but-present match should
 * preempt a higher-priority absence; the convention used everywhere
 * in this codebase is `find` semantics, not `find non-zero`, matching
 * the pre-extraction inline implementation).
 */
export function resolveLpvFromActions(
  actions: ReadonlyArray<ActionRowLike> | undefined | null,
): number {
  if (!actions || actions.length === 0) return 0;
  for (const type of LPV_ACTION_PRIORITY) {
    const hit = actions.find((a) => a.action_type === type);
    if (hit !== undefined) {
      const raw = hit.value;
      const n = typeof raw === "number" ? raw : Number(raw ?? 0);
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}
