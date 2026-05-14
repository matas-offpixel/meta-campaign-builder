/**
 * lib/dashboard/canonical-event-metrics.ts
 *
 * Single source of truth for `(client_id, event_code)`-scoped metrics.
 * The unified-fix landing point for PR #417's audit Sections 4 & 5
 * (Cat A sibling N-counting, Cat B daily-summed reach, Cat F per-
 * campaign reach sum).
 *
 * **Pure compute layer.** No DB / network / `server-only`. Tests run
 * directly on this file; the supabase-backed convenience wrappers
 * live in `canonical-event-metrics-loader.ts`. Splitting along this
 * seam matches the pattern from `event-code-lifetime-two-pass.ts`
 * (PR #418) — the test runner's strip-types loader can't resolve the
 * `@/` alias graph that the loader pulls in.
 *
 * **Structure (audit Section 5):**
 *
 *   1. **Lifetime, cache-backed (Cat B + Cat F killed)**
 *      - reach, impressions, link_clicks, regs, engagements, video plays
 *      - Read directly from `event_code_lifetime_meta_cache` (PR #415,
 *        migration 068).
 *      - Cache is populated by the cron + admin backfill route, both
 *        of which call the two-pass `fetchEventLifetimeMetaMetrics`
 *        (PR #418, audit Section 6 Flag F fix). Cache values are now
 *        cross-campaign deduplicated rather than naively summed.
 *      - On cache MISS: returns `null` for every cache-backed field.
 *        Callers MUST render `—` rather than fall back to summed-
 *        daily-reach (the broken Cat B path). This is the audit's
 *        deliverable #4 ("hard-fail Stats Grid on cache miss").
 *
 *   2. **Cumulative, rollup-backed (Cat A killed)**
 *      - spend (`ad_spend_allocated ?? ad_spend` plus presale)
 *      - link clicks (rollup sum, sibling-deduped)
 *      - Read from `event_daily_rollups` AFTER running
 *        `dedupVenueRollupsByEventCode`. The dedup collapses
 *        `(event_code, date)` groups so siblings under one
 *        bracketed code don't N-count campaign-wide values.
 *      - Genuinely additive across days, so summing post-dedup is
 *        correct (no Cat B exposure).
 *
 *   3. **Per-event delta (already correct)**
 *      - tickets, revenue
 *      - Caller-supplied. The existing tier-channel resolver chain
 *        (PR #357 / #404) is correct; this helper just threads it
 *        through the canonical struct so every surface has one place
 *        to read from.
 *
 *   4. **Per-event-code, rollup-backed (deferred)**
 *      - lpv (BOFU landing page views)
 *      - Currently sourced from `splitEventCodeLpvByClickShare` in
 *        `lib/reporting/funnel-pacing-payload.ts`. Kept out of the
 *        canonical struct for v1 — the per-event split logic is
 *        pacing-specific and surfaces other than funnel-pacing don't
 *        consume LPV. Audit Section 5 row 5.7 flags this as a
 *        follow-up.
 */

import {
  buildEventIdToCodeMap,
  dedupVenueRollupsByEventCode,
} from "./venue-rollup-dedup.ts";
import type { EventCodeLifetimeMetaCacheRow } from "@/lib/db/event-code-lifetime-meta-cache";
import type { DailyRollupRow } from "@/lib/db/client-portal-server";

/**
 * Canonical-shape metric struct returned by `getCanonicalEventMetrics`.
 *
 * Lifetime, cache-backed fields (`reach`, `impressions`, `linkClicks`,
 * `metaRegs`, `engagements`, `videoPlays3s/15s/P100`) are `number |
 * null`. `null` means "cache row missing" — the surface MUST render
 * `—` rather than substitute a summed-daily-reach (the broken Cat B
 * path).
 *
 * Cumulative, rollup-backed fields (`spend`, `linkClicksRollupSum`)
 * are always `number` (default 0). Additive across days is correct.
 *
 * Per-event delta fields (`tickets`, `revenue`) are caller-supplied
 * via `inputs.tickets` / `inputs.revenue`; the helper passes them
 * through unchanged. `revenue` is `number | null` (no revenue data
 * available is distinct from £0 revenue across the venue).
 */
export interface CanonicalEventMetrics {
  // ── Lifetime, cache-backed (cross-campaign deduplicated by Meta) ─
  /** Lifetime cross-campaign deduplicated reach. `null` on cache miss. */
  reach: number | null;
  /** Lifetime impressions across all matched campaigns. `null` on cache miss. */
  impressions: number | null;
  /** Lifetime inline link clicks. `null` on cache miss. */
  linkClicks: number | null;
  /** Lifetime registrations from the standard pixel/CR action types. `null` on cache miss. */
  metaRegs: number | null;
  /** Lifetime post engagements. `null` on cache miss. */
  engagements: number | null;
  /** Lifetime 3-second video plays. `null` on cache miss. */
  videoPlays3s: number | null;
  videoPlays15s: number | null;
  videoPlaysP100: number | null;

  // ── Cumulative, rollup-backed (sibling-deduped) ──────────────────
  /**
   * Sum of paid-media spend across the venue's events × dates,
   * AFTER `dedupVenueRollupsByEventCode`. Allocator output preferred
   * over raw `ad_spend` (matches the rest of the dashboard). Zero
   * when no rollup rows exist.
   */
  spend: number;
  /**
   * Sum of `link_clicks` from rollups, sibling-deduped. Use
   * `linkClicks` (cache-backed) for the lifetime view; this field
   * is exposed for funnel-pacing's MOFU stage which derives
   * conversion rates per windowed scope.
   */
  linkClicksRollupSum: number;

  // ── Per-event delta (caller-supplied) ────────────────────────────
  /** Tickets sold per the tier-channel resolver chain. Zero when no provider data. */
  tickets: number;
  /** Gross revenue. `null` when no provider data is available. */
  revenue: number | null;

  // ── Provenance ───────────────────────────────────────────────────
  /**
   * `cache_hit` when at least the lifetime fields are populated from
   * `event_code_lifetime_meta_cache`. `cache_miss` when the cache row
   * is absent — the surface should render `—` for the lifetime cells
   * and use the cumulative fields for windowed views.
   */
  reachSource: "cache_hit" | "cache_miss";
  /**
   * Pass-through of the cache row's `fetched_at` for staleness
   * indicators. `null` when `reachSource === "cache_miss"`.
   */
  cacheFetchedAt: string | null;
}

export interface CanonicalEventMetricsInputs {
  /**
   * Cache row from `event_code_lifetime_meta_cache` for this
   * `(client_id, event_code)`. `null` triggers the cache-miss
   * branch (surface renders `—`). Loaders that already pulled the
   * client's full cache list MUST narrow to the single matching row
   * before passing in (to keep the helper a pure function).
   */
  cacheRow: EventCodeLifetimeMetaCacheRow | null;
  /**
   * Daily rollup rows scoped to the venue (every event under the
   * `event_code`). The helper runs `dedupVenueRollupsByEventCode`
   * internally so callers don't need to pre-dedup, BUT the rollup
   * set should already be filtered to the venue's events — the
   * dedup is a (`event_code`, `date`) collapse, not a venue
   * extraction.
   *
   * Pass an empty array when no rollup data exists; cumulative
   * fields default to 0.
   */
  dailyRollups: ReadonlyArray<DailyRollupRow>;
  /**
   * `(id, event_code)` pairs for the events whose rollups appear in
   * `dailyRollups`. Drives the dedup grouping. Pass an empty array
   * for single-event venues — the dedup is a no-op when no group
   * has more than one row.
   */
  events: ReadonlyArray<{ id: string; event_code: string | null }>;
  /**
   * Caller-supplied tickets / revenue from the tier-channel
   * resolver chain (PR #357 / #404). Defaults to `0` / `null` when
   * unsupplied.
   */
  tickets?: number;
  revenue?: number | null;
  /**
   * Optional `(date) → keep` filter. When supplied, rollup rows
   * whose `date` is not in the set are dropped before dedup +
   * aggregation. Powers windowed views (Stats Grid timeframe
   * selector). `null` / `undefined` means "lifetime / all-dates".
   */
  windowDays?: ReadonlySet<string> | null;
}

/**
 * Compose the canonical metric struct from already-loaded inputs.
 * Pure — no DB / network. Use `loadCanonicalEventMetrics` for the
 * supabase-backed convenience wrapper.
 *
 * Implementation order:
 *   1. Resolve the lifetime cache fields (cache_hit ⇒ pass-through;
 *      cache_miss ⇒ all nullables stay null + reachSource flips).
 *   2. Run the optional date-window filter on rollups.
 *   3. `dedupVenueRollupsByEventCode` collapses sibling N-counting.
 *   4. Sum the cumulative fields from the deduped rollups.
 *   5. Pass through tickets / revenue.
 */
export function computeCanonicalEventMetrics(
  inputs: CanonicalEventMetricsInputs,
): CanonicalEventMetrics {
  const cache = inputs.cacheRow;
  const reachSource: CanonicalEventMetrics["reachSource"] = cache
    ? "cache_hit"
    : "cache_miss";
  const cacheFetchedAt = cache?.fetched_at ?? null;

  // Window filter (lifetime when null/undefined).
  const filteredRows = inputs.windowDays
    ? inputs.dailyRollups.filter((row) => inputs.windowDays!.has(row.date))
    : inputs.dailyRollups;

  // Sibling dedup. Operates on a fresh array so callers' input is
  // not mutated. `events` may be empty (no dedup needed for single-
  // event venues) — the helper short-circuits to a no-op map.
  const eventIdToCode =
    inputs.events.length > 0
      ? buildEventIdToCodeMap(inputs.events)
      : new Map<string, string | null>();
  const { rows: dedupedRows } = dedupVenueRollupsByEventCode(
    filteredRows,
    eventIdToCode,
  );

  let spend = 0;
  let linkClicksRollupSum = 0;
  for (const row of dedupedRows) {
    // Spend: prefer allocator output. The allocator splits campaign-
    // wide spend per-event so summing across rollup rows is correct.
    // Falls back to raw `ad_spend` for pre-allocator dates and adds
    // `ad_spend_presale` (always per-event) on top.
    const allocated =
      row.ad_spend_allocated != null ? row.ad_spend_allocated : null;
    const presale = row.ad_spend_presale ?? 0;
    if (allocated != null) {
      spend += allocated + presale;
    } else if (row.ad_spend != null) {
      spend += row.ad_spend + presale;
    } else if (presale > 0) {
      spend += presale;
    }
    linkClicksRollupSum += row.link_clicks ?? 0;
  }

  return {
    reach: cache?.meta_reach ?? null,
    impressions: cache?.meta_impressions ?? null,
    linkClicks: cache?.meta_link_clicks ?? null,
    metaRegs: cache?.meta_regs ?? null,
    engagements: cache?.meta_engagements ?? null,
    videoPlays3s: cache?.meta_video_plays_3s ?? null,
    videoPlays15s: cache?.meta_video_plays_15s ?? null,
    videoPlaysP100: cache?.meta_video_plays_p100 ?? null,
    spend,
    linkClicksRollupSum,
    tickets: inputs.tickets ?? 0,
    revenue: inputs.revenue ?? null,
    reachSource,
    cacheFetchedAt,
  };
}

/**
 * Group-by-event_code variant. Useful when a surface (funnel-pacing,
 * client-wide topline) operates over many event_codes in one render
 * pass. Bulk inputs come from caller's already-loaded portal payload
 * + cache rows; the helper produces one canonical struct per
 * event_code.
 *
 * Returns a `Map<event_code, CanonicalEventMetrics>` so callers can
 * sum across event_codes (each event_code is independent — sums are
 * safe, no over-counting risk because each cache row holds one
 * campaign-window deduplicated number).
 */
export function computeCanonicalEventMetricsByEventCode(args: {
  cacheRows: ReadonlyArray<EventCodeLifetimeMetaCacheRow>;
  rollupsByEventCode: ReadonlyMap<string, ReadonlyArray<DailyRollupRow>>;
  eventsByEventCode: ReadonlyMap<
    string,
    ReadonlyArray<{ id: string; event_code: string | null }>
  >;
  /** Optional per-event_code tickets / revenue. */
  ticketsByEventCode?: ReadonlyMap<string, number>;
  revenueByEventCode?: ReadonlyMap<string, number | null>;
  windowDays?: ReadonlySet<string> | null;
}): Map<string, CanonicalEventMetrics> {
  const out = new Map<string, CanonicalEventMetrics>();
  const cacheByCode = new Map<string, EventCodeLifetimeMetaCacheRow>();
  for (const row of args.cacheRows) {
    cacheByCode.set(row.event_code, row);
  }
  // Union of event_codes across all input maps so a code with rollups
  // but no cache (or vice versa) still gets a canonical struct.
  const allCodes = new Set<string>();
  for (const code of cacheByCode.keys()) allCodes.add(code);
  for (const code of args.rollupsByEventCode.keys()) allCodes.add(code);
  for (const code of args.eventsByEventCode.keys()) allCodes.add(code);

  for (const code of allCodes) {
    out.set(
      code,
      computeCanonicalEventMetrics({
        cacheRow: cacheByCode.get(code) ?? null,
        dailyRollups: args.rollupsByEventCode.get(code) ?? [],
        events: args.eventsByEventCode.get(code) ?? [],
        tickets: args.ticketsByEventCode?.get(code),
        revenue: args.revenueByEventCode?.get(code) ?? undefined,
        windowDays: args.windowDays,
      }),
    );
  }
  return out;
}

/**
 * Sum a sequence of canonical structs into one client-wide /
 * region-wide total. Each `event_code` in the input is independent
 * (one cache row each) so sums are safe with no over-counting risk.
 *
 * Lifetime cache fields stay `number | null`: the sum is `null` when
 * EVERY input was `null` for that field, otherwise the sum of the
 * non-null values. This preserves the cache-miss signal at the
 * aggregate scope (every venue's reach unknown ⇒ surface renders
 * `—`) while still surfacing partial coverage (some venues cached,
 * some not).
 */
export function sumCanonicalEventMetrics(
  metrics: ReadonlyArray<CanonicalEventMetrics>,
): CanonicalEventMetrics {
  if (metrics.length === 0) {
    return {
      reach: null,
      impressions: null,
      linkClicks: null,
      metaRegs: null,
      engagements: null,
      videoPlays3s: null,
      videoPlays15s: null,
      videoPlaysP100: null,
      spend: 0,
      linkClicksRollupSum: 0,
      tickets: 0,
      revenue: null,
      reachSource: "cache_miss",
      cacheFetchedAt: null,
    };
  }
  const sumNullable = (key: NullableNumberKey): number | null => {
    let total = 0;
    let any = false;
    for (const m of metrics) {
      const v = m[key];
      if (v != null) {
        total += v;
        any = true;
      }
    }
    return any ? total : null;
  };
  let revenueTotal = 0;
  let revenueAny = false;
  let spend = 0;
  let linkClicksRollupSum = 0;
  let tickets = 0;
  let anyHit = false;
  let earliestFetchedAt: string | null = null;
  for (const m of metrics) {
    if (m.revenue != null) {
      revenueTotal += m.revenue;
      revenueAny = true;
    }
    spend += m.spend;
    linkClicksRollupSum += m.linkClicksRollupSum;
    tickets += m.tickets;
    if (m.reachSource === "cache_hit") anyHit = true;
    if (m.cacheFetchedAt) {
      if (!earliestFetchedAt || m.cacheFetchedAt < earliestFetchedAt) {
        earliestFetchedAt = m.cacheFetchedAt;
      }
    }
  }
  return {
    reach: sumNullable("reach"),
    impressions: sumNullable("impressions"),
    linkClicks: sumNullable("linkClicks"),
    metaRegs: sumNullable("metaRegs"),
    engagements: sumNullable("engagements"),
    videoPlays3s: sumNullable("videoPlays3s"),
    videoPlays15s: sumNullable("videoPlays15s"),
    videoPlaysP100: sumNullable("videoPlaysP100"),
    spend,
    linkClicksRollupSum,
    tickets,
    revenue: revenueAny ? revenueTotal : null,
    reachSource: anyHit ? "cache_hit" : "cache_miss",
    cacheFetchedAt: earliestFetchedAt,
  };
}

type NullableNumberKey = {
  [K in keyof CanonicalEventMetrics]: CanonicalEventMetrics[K] extends
    | number
    | null
    ? K
    : never;
}[keyof CanonicalEventMetrics];
