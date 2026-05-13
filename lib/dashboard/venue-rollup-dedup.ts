/**
 * lib/dashboard/venue-rollup-dedup.ts
 *
 * Memory anchor — campaign-wide-vs-per-event metric duplication.
 *
 * `fetchEventDailyMetaMetrics` substring-matches Meta campaigns by
 * `[event_code]`, so every sibling event under the same code (e.g.
 * the four WC26 fixtures at one venue, all sharing
 * `WC26-LONDON-SHEPHERDS`) ends up storing the SAME campaign-wide
 * Meta values in `event_daily_rollups` for the same calendar day.
 *
 * Some columns are corrected after the fact by the venue spend
 * allocator (`ad_spend_allocated`, `ad_spend_presale`, allocator-
 * overwritten `link_clicks`). The remaining Meta-fetched columns —
 * `meta_impressions`, `meta_reach`, `meta_video_plays_*`,
 * `meta_engagements`, `meta_regs` — are NEVER touched after the Meta
 * leg. Naively summing those columns across the venue's events
 * produces N× the real campaign value.
 *
 * Pattern used here mirrors PR #410's LPV dedup
 * (`splitEventCodeLpvByClickShare` in `lib/reporting/funnel-pacing-
 * payload.ts`): collapse `(event_code, date)` groups to ONE
 * canonical row holding the MAX of each campaign-wide column, zero
 * the same columns on the other rows in the group. The aggregator
 * then sums normally and arrives at the real campaign-wide total
 * for the venue.
 *
 * Why MAX rather than "first row wins":
 *   - Rollup-sync runs per-event and the Meta API returns slightly
 *     different campaign totals if `fetched_at` jitter lands an
 *     event sync mid-impression (a few minutes apart). MAX is
 *     defensive against that — picks the freshest "fullest" view
 *     of the campaign for the day. Same rationale as PR #410.
 *   - Consistent with `resolveLpvByEventIds`, which also picks the
 *     max snapshot LPV per `event_code` group.
 *
 * Why this lives in its own module rather than inside the
 * stats-grid aggregator:
 *   - `mergeVenueTimeline` (the venue trend chart + daily tracker
 *     timeline merger) sums `link_clicks` and `meta_regs` over
 *     `dailyRollups` too. Both consumers need the dedup; sharing
 *     the helper keeps the rule in one place.
 *   - Future Meta metrics added to the venue surface should funnel
 *     through `CAMPAIGN_WIDE_META_COLUMNS` so the bug doesn't
 *     re-emerge silently.
 *
 * What this does NOT touch:
 *   - `ad_spend_allocated`, `ad_spend_specific`,
 *     `ad_spend_generic_share`, `ad_spend_presale` — per-event by
 *     construction (allocator output).
 *   - `tickets_sold`, `revenue` — per-event from the ticketing
 *     provider.
 *   - `tiktok_*`, `google_ads_*` — TikTok / Google Ads insights
 *     also substring-match by event_code at the fetch layer; the
 *     same N-counting risk exists in theory, but those columns are
 *     only meaningful for clients with TikTok / Google Ads linked
 *     AND multi-event venues sharing one bracketed code. None of
 *     the live deployments hit that combination yet, so we hold
 *     off until a real customer signal shows up. (Flag: extend
 *     `CAMPAIGN_WIDE_TIKTOK_COLUMNS` / `_GOOGLE_ADS_COLUMNS` here
 *     when needed.)
 */
import type { DailyRollupRow } from "@/lib/db/client-portal-server";

/**
 * Columns Meta returns at campaign granularity; sibling events
 * sharing one bracketed `[event_code]` carry the IDENTICAL value
 * for each calendar day. Always deduped by `(event_code, date)`.
 */
const ALWAYS_CAMPAIGN_WIDE_META_COLUMNS = [
  "meta_impressions",
  "meta_reach",
  "meta_video_plays_3s",
  "meta_video_plays_15s",
  "meta_video_plays_p100",
  "meta_engagements",
  "meta_regs",
] as const satisfies readonly (keyof DailyRollupRow)[];

/**
 * Columns the spend allocator REWRITES per-event when it runs
 * (`upsertAllocatedSpendRollups` in `lib/db/event-daily-rollups.ts`):
 *
 *   - raw `ad_spend` is left untouched but the topline aggregator
 *     prefers `ad_spend_allocated + ad_spend_presale` whenever
 *     either is non-null, so `ad_spend` never reaches the venue
 *     total in the allocator-ran path.
 *   - `link_clicks` is overwritten with the per-event split (WC26
 *     opponent allocator, equal-split for non-WC26 multi-event
 *     venues, pass-through for solo events).
 *
 * When the allocator HAS run for a (code, date) group, both columns
 * are per-event correct → SUM. When it has NOT run, both columns
 * are campaign-wide and need the MAX-by-key dedup just like the
 * always-campaign-wide Meta columns.
 *
 * Detection: any row in the group with `ad_spend_allocated != null`
 * OR `ad_spend_presale != null` proves the allocator wrote that
 * date. Mirrors how `aggregateStatsForPlatform` already gates
 * preferring allocated spend over raw `ad_spend`.
 */
const POST_ALLOCATOR_PER_EVENT_META_COLUMNS = [
  "ad_spend",
  "link_clicks",
] as const satisfies readonly (keyof DailyRollupRow)[];

type CampaignWideColumn =
  | (typeof ALWAYS_CAMPAIGN_WIDE_META_COLUMNS)[number]
  | (typeof POST_ALLOCATOR_PER_EVENT_META_COLUMNS)[number];

/**
 * Diagnostic info the dedup emits alongside the deduped rows. Used
 * by tests to assert collapse behaviour without rebuilding the
 * grouping logic, and by future logging once we wire it through.
 */
export interface VenueRollupDedupDiagnostics {
  /** Number of `(event_code, date)` groups with > 1 sibling row. */
  groupsCollapsed: number;
  /** Sibling rows whose campaign-wide cols were zeroed. */
  rowsZeroed: number;
  /**
   * Rows that fell through the dedup because `eventIdToCode` had
   * no entry for the row's `event_id` (or mapped to a null code).
   * Surfaced for log assertions, not user-visible.
   */
  rowsUngrouped: number;
}

/**
 * Collapse rows so a venue-scope SUM over the result equals the
 * real campaign-wide total (rather than N× per sibling) for the
 * Meta columns that store campaign-granular data.
 *
 * Returns:
 *   - `rows`: a new array with the same length as `input`. Every
 *     row keeps its original `event_id` / `date` / per-event
 *     columns. For each `(event_code, date)` group, ONE canonical
 *     row holds the MAX of each campaign-wide column; the other
 *     rows have those columns zeroed out (preserving null where
 *     the original was null so empty rows stay empty).
 *   - `diagnostics`: collapse counters for tests / logs.
 *
 * Per-event columns (`ad_spend_allocated`, `ad_spend_presale`,
 * `tickets_sold`, `revenue`, `tiktok_*`, `google_ads_*`) are never
 * mutated.
 *
 * `eventIdToCode` should map every `event_id` in `rows` to its
 * `events.event_code` (or null when the event has no code yet).
 * Rows whose `event_id` resolves to null/undefined fall through
 * untouched — they can't be grouped and almost always mean
 * "single-event venue" or "synthetic event without a code".
 */
export function dedupVenueRollupsByEventCode(
  rows: readonly DailyRollupRow[],
  eventIdToCode: ReadonlyMap<string, string | null>,
): { rows: DailyRollupRow[]; diagnostics: VenueRollupDedupDiagnostics } {
  const out: DailyRollupRow[] = rows.map((r) => ({ ...r }));
  const groups = new Map<string, number[]>();
  let rowsUngrouped = 0;
  for (let i = 0; i < out.length; i++) {
    const code = eventIdToCode.get(out[i]!.event_id) ?? null;
    if (!code) {
      rowsUngrouped += 1;
      continue;
    }
    const key = `${code}\u0000${out[i]!.date}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }

  let groupsCollapsed = 0;
  let rowsZeroed = 0;

  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    groupsCollapsed += 1;
    const allocatorRan = indexes.some(
      (idx) =>
        out[idx]!.ad_spend_allocated != null ||
        out[idx]!.ad_spend_presale != null,
    );
    const colsToDedup: readonly CampaignWideColumn[] = allocatorRan
      ? ALWAYS_CAMPAIGN_WIDE_META_COLUMNS
      : [
          ...ALWAYS_CAMPAIGN_WIDE_META_COLUMNS,
          ...POST_ALLOCATOR_PER_EVENT_META_COLUMNS,
        ];
    for (const col of colsToDedup) {
      let max = 0;
      let hadValue = false;
      for (const idx of indexes) {
        const v = out[idx]![col];
        if (typeof v === "number" && Number.isFinite(v)) {
          hadValue = true;
          if (v > max) max = v;
        }
      }
      const canonical = indexes[0]!;
      // Preserve null when the source had null on every sibling —
      // the stats grid surfaces "—" for null vs 0 explicitly so
      // we mustn't silently coerce to 0.
      out[canonical] = {
        ...out[canonical]!,
        [col]: hadValue ? max : null,
      };
      for (let j = 1; j < indexes.length; j++) {
        const idx = indexes[j]!;
        if (typeof out[idx]![col] === "number") {
          out[idx] = { ...out[idx]!, [col]: 0 };
        }
      }
    }
    rowsZeroed += indexes.length - 1;
  }

  return {
    rows: out,
    diagnostics: { groupsCollapsed, rowsZeroed, rowsUngrouped },
  };
}

/**
 * Build the `eventIdToCode` map from a list of `PortalEvent`-shaped
 * objects (or any subset that exposes `id` + `event_code`). Centralised
 * so the venue stats grid, the trend chart, and tests share one
 * source of truth for the mapping.
 */
export function buildEventIdToCodeMap(
  events: ReadonlyArray<{ id: string; event_code: string | null }>,
): ReadonlyMap<string, string | null> {
  const map = new Map<string, string | null>();
  for (const event of events) {
    map.set(event.id, event.event_code);
  }
  return map;
}

/**
 * Re-export the column lists so call-sites that need to enumerate
 * "what gets deduped" (e.g. logging, test assertions, schema
 * documentation) don't have to duplicate the names.
 */
export const CAMPAIGN_WIDE_META_COLUMNS = ALWAYS_CAMPAIGN_WIDE_META_COLUMNS;
export const POST_ALLOCATOR_META_COLUMNS = POST_ALLOCATOR_PER_EVENT_META_COLUMNS;
