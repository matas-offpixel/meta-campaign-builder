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
 *   4. **Per-event-code, lifetime cache-backed (PR-B of issue #467)**
 *      - landingPageViews (BOFU LPV)
 *      - Lifetime LPV is now populated on `event_code_lifetime_meta_cache`
 *        from migration 099 (`meta_landing_page_views`). The funnel-
 *        pacing surface and the venue Stats Grid both read from this
 *        canonical struct so they cannot disagree on LPV either —
 *        identical input → identical output through this pure helper.
 *      - The legacy `splitEventCodeLpvByClickShare` snapshot-driven
 *        path stays available in `funnel-pacing-payload.ts` for the
 *        client-region scope (which still uses the per-event-code-
 *        union snapshot route); venue-scope reads cache directly.
 */

import {
  buildEventIdToCodeMap,
  dedupVenueRollupsByEventCode,
} from "./venue-rollup-dedup.ts";
import {
  computeAttributionState,
  type AttributionClassification,
} from "./attribution-state.ts";
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
  /**
   * Lifetime Landing Page Views — populated on the cache from
   * migration 099. `null` on cache miss OR when the cache row pre-
   * dates the LPV backfill. Surfaces should treat `null` as "—" the
   * same way they do for `reach` / `linkClicks`.
   *
   * PR-B of issue #467 — see file header §4. Both Stats Grid and
   * Funnel Pacing's BOFU bar consume this single value so they
   * cannot disagree.
   */
  landingPageViews: number | null;
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

  // ── Attribution gap (PR #422) ────────────────────────────────────
  /**
   * `MAX(SUM(tickets_sold_rollup), SUM(tier_channel_sales_sum))` across
   * the venue's events. Multi-link asymmetry handled inside the
   * resolver — the ticketing side is summed across `external_event_id`
   * BEFORE delta calc (per `feedback_multi_link_backfill_scope.md`).
   * Surface layer reads this value directly for the attribution tile.
   *
   * Distinct from the per-event `tickets` field above:
   *   - `tickets` is caller-supplied for a single event in the venue.
   *   - `ticketsTrue` is the venue-wide canonical count, computed
   *     inside the resolver from `dailyRollups` + the per-event
   *     `tier_channel_sales_sum` map.
   *
   * Zero is a meaningful value (`no_data` state when both sides are
   * zero) — never null, even on cache miss.
   */
  ticketsTrue: number;
  /**
   * Three-state attribution classification computed from
   * `metaRegs` (raw, non-deduped lifetime cache value) and
   * `ticketsTrue`. The broken Meta data is exposed deliberately —
   * the tile renders a labelled state rather than papering over
   * the gap.
   *
   * `state` ∈ {no_data, capi_missing, over_attributed, tracked}.
   * `rate` populated only for `tracked`; `band` populated only for
   * `tracked`.
   *
   * See `lib/dashboard/attribution-state.ts` for the cutoffs.
   */
  attribution: AttributionClassification;
  /**
   * Convenience shortcut: `attribution.rate`. `null` outside of the
   * `tracked` state. Surfaced for callers that just want the ratio
   * for sortable columns.
   */
  attributionRate: number | null;

  // ── Real Attribution Reconciliation v2 (PR #423, dark) ───────────
  /**
   * Meta's claim of how many Purchase events fired against this
   * event_code. Sourced from the new `event_daily_rollups.meta_purchases`
   * column (migration 093). `null` BEFORE the Purchase split backfill
   * has run for the event — the surface should treat `null` as
   * "we haven't asked Meta yet" rather than "Meta says zero".
   *
   * Distinct from `metaRegs` which currently pools every conversion
   * event Meta reports (Lead / Registration on 4thefans). The new
   * RealAttributionTile displays this number as the "Meta claims X
   * purchases" headline.
   */
  metaReportedPurchases: number | null;
  /**
   * Real ticket sales matched back to a Meta click via the matcher
   * cron (`/api/internal/match-attribution`). Source:
   * `attribution_order_matches` rows where `match_strategy != 'unmatched'`,
   * scoped to events belonging to this event_code.
   *
   * Always returns a non-null integer — zero is the honest answer
   * before Joe ships the 4thefans webhook payload extension. The
   * RealAttributionTile is gated by feature flag and does not render
   * pre-Joe, so a zero here doesn't reach a client surface.
   */
  offpixelAttributedPurchases: number;
  /**
   * `offpixelAttributedPurchases / metaReportedPurchases`. `null`
   * when the denominator is zero or null (no Meta-claimed purchases
   * to reconcile against). Drives the RealAttributionTile "Trust"
   * badge (green 0.7–1.3, amber outside).
   */
  attributionTrustRatio: number | null;
  /**
   * `offpixelAttributedPurchases / ticketsTrue`. `null` when
   * `ticketsTrue === 0`. Drives the "Coverage" badge — what fraction
   * of real sales we attribute to any paid Meta touchpoint.
   */
  attributionCoverageRatio: number | null;

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
  /**
   * Per-event SUM of `tier_channel_sales.tickets_sold` (PortalEvent.
   * `tier_channel_sales_tickets`). Resolver computes
   * `ticketsTrue = MAX(SUM(rollup.tickets_sold), SUM(this map))`
   * across the venue's events, mirroring the `Math.max` shape from
   * `resolveDisplayTicketCount` (PR #339 / #347 / #368) but at the
   * canonical-event-metrics layer so every consumer reads one
   * number.
   *
   * Multi-link contract: the caller supplies one entry per event_id
   * already containing the SUM across that event's
   * `external_event_id` rows. The asymmetry — tickets summed before
   * delta on multi-link, Meta side per-event_code aggregation — is
   * preserved at the loader / portal layer, not re-implemented
   * here.
   *
   * Empty / undefined falls back to summing only the rollup-side
   * tickets — sensible default for callers that haven't yet wired
   * the tier-channel sum (the `ticketsTrue` value will simply be
   * the rollup figure).
   */
  tierChannelTicketsByEventId?: ReadonlyMap<string, number | null>;
  /**
   * Per-event_id sum of `event_daily_rollups.meta_purchases` over
   * the same window the resolver is running against. Caller
   * supplies an entry per event in `events`; the resolver collapses
   * across events (sibling-deduped via the same dedup pass that
   * handles spend / regs).
   *
   * Pre migration-093 callers pass an empty map → resolver returns
   * `metaReportedPurchases: null` (the lifetime cache row's
   * `meta_purchases` column doesn't exist; we deliberately do NOT
   * read from `cacheRow` for purchases because the cache layer
   * isn't extended in PR #423 — separate PR).
   */
  metaPurchasesByEventId?: ReadonlyMap<string, number | null>;
  /**
   * Per-event_id count of `attribution_order_matches` rows for this
   * event_id where `match_strategy != 'unmatched'`. Always supplied
   * (defaults to empty map → 0 verified). The DB read is a counted
   * GROUP BY on `event_id`; loaders prefer to issue one bulk query
   * per surface, then thread the map through.
   */
  offpixelAttributedPurchasesByEventId?: ReadonlyMap<string, number | null>;
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
  // Sum tickets_sold across the deduped rollup rows. Per the
  // DailyRollupRow JSDoc the field is per-(event, day) so summing is
  // correct (no N-counting concern; tickets are per-event, not
  // venue-wide-broadcast like `meta_reach`).
  let ticketsRollupSum = 0;
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
    ticketsRollupSum += row.tickets_sold ?? 0;
  }

  // Tier-channel side. Sum across the events in scope, ignoring
  // missing entries. Multi-link sum-before-delta is honoured at the
  // caller layer (PortalEvent.tier_channel_sales_tickets is the SUM
  // of every linked external_event_id's tier_channel_sales rows
  // before the resolver sees it).
  let tierChannelTicketsSum = 0;
  if (inputs.tierChannelTicketsByEventId) {
    const seen = new Set<string>();
    for (const ev of inputs.events) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      const v = inputs.tierChannelTicketsByEventId.get(ev.id);
      if (v != null && Number.isFinite(v)) tierChannelTicketsSum += v;
    }
  }

  // ticketsTrue = MAX of the two sides. Both numbers are venue-wide
  // by construction. The classifier handles `0 vs 0` as `no_data`.
  const ticketsTrue = Math.max(ticketsRollupSum, tierChannelTicketsSum, 0);
  const metaRegsForState = cache?.meta_regs ?? null;
  const attribution = computeAttributionState({
    metaRegs: metaRegsForState,
    ticketsTrue,
  });

  // ── PR #423: Real Attribution Reconciliation v2 ──────────────────
  //
  // metaReportedPurchases: sum across the venue's events of the
  // per-event_id Meta purchase column. Caller-supplied so the
  // loader can issue one window-bounded query and thread the map
  // through — keeps this helper pure.
  //
  // We deliberately distinguish "no map supplied" (pre-093 caller
  // → null) from "map supplied with all zeros" (Meta returned
  // zeros; surface it as 0). The presence of the map means the
  // caller went and asked.
  let metaReportedPurchases: number | null = null;
  if (inputs.metaPurchasesByEventId) {
    let sum = 0;
    let any = false;
    const seenForPurchases = new Set<string>();
    for (const ev of inputs.events) {
      if (seenForPurchases.has(ev.id)) continue;
      seenForPurchases.add(ev.id);
      const v = inputs.metaPurchasesByEventId.get(ev.id);
      if (v != null && Number.isFinite(v)) {
        sum += v;
        any = true;
      }
    }
    metaReportedPurchases = any ? sum : 0;
  }

  // offpixelAttributedPurchases: always a number (zero is the
  // honest pre-Joe answer). The loader supplies a map even when
  // the table is empty — `getOffpixelAttributedPurchasesByEventId`
  // returns `Map<event_id, 0>` rather than absent keys.
  let offpixelAttributedPurchases = 0;
  if (inputs.offpixelAttributedPurchasesByEventId) {
    const seenForOpx = new Set<string>();
    for (const ev of inputs.events) {
      if (seenForOpx.has(ev.id)) continue;
      seenForOpx.add(ev.id);
      const v = inputs.offpixelAttributedPurchasesByEventId.get(ev.id);
      if (v != null && Number.isFinite(v)) {
        offpixelAttributedPurchases += v;
      }
    }
  }

  const attributionTrustRatio =
    metaReportedPurchases && metaReportedPurchases > 0
      ? offpixelAttributedPurchases / metaReportedPurchases
      : null;
  const attributionCoverageRatio =
    ticketsTrue > 0
      ? offpixelAttributedPurchases / ticketsTrue
      : null;

  return {
    reach: cache?.meta_reach ?? null,
    impressions: cache?.meta_impressions ?? null,
    linkClicks: cache?.meta_link_clicks ?? null,
    landingPageViews: cache?.meta_landing_page_views ?? null,
    metaRegs: cache?.meta_regs ?? null,
    engagements: cache?.meta_engagements ?? null,
    videoPlays3s: cache?.meta_video_plays_3s ?? null,
    videoPlays15s: cache?.meta_video_plays_15s ?? null,
    videoPlaysP100: cache?.meta_video_plays_p100 ?? null,
    spend,
    linkClicksRollupSum,
    tickets: inputs.tickets ?? 0,
    revenue: inputs.revenue ?? null,
    ticketsTrue,
    attribution,
    attributionRate: attribution.rate,
    metaReportedPurchases,
    offpixelAttributedPurchases,
    attributionTrustRatio,
    attributionCoverageRatio,
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
  /**
   * Per-event_id `tier_channel_sales.tickets_sold` SUM, threaded
   * through to `computeCanonicalEventMetrics` so each event_code's
   * `ticketsTrue` reads from the same canonical input map. Caller
   * builds this once from the portal payload (`PortalEvent.
   * tier_channel_sales_tickets`).
   */
  tierChannelTicketsByEventId?: ReadonlyMap<string, number | null>;
  /** PR #423 — see CanonicalEventMetricsInputs.metaPurchasesByEventId. */
  metaPurchasesByEventId?: ReadonlyMap<string, number | null>;
  /** PR #423 — see CanonicalEventMetricsInputs.offpixelAttributedPurchasesByEventId. */
  offpixelAttributedPurchasesByEventId?: ReadonlyMap<string, number | null>;
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
        tierChannelTicketsByEventId: args.tierChannelTicketsByEventId,
        metaPurchasesByEventId: args.metaPurchasesByEventId,
        offpixelAttributedPurchasesByEventId:
          args.offpixelAttributedPurchasesByEventId,
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
      landingPageViews: null,
      metaRegs: null,
      engagements: null,
      videoPlays3s: null,
      videoPlays15s: null,
      videoPlaysP100: null,
      spend: 0,
      linkClicksRollupSum: 0,
      tickets: 0,
      revenue: null,
      ticketsTrue: 0,
      attribution: { state: "no_data", rate: null, band: null },
      attributionRate: null,
      metaReportedPurchases: null,
      offpixelAttributedPurchases: 0,
      attributionTrustRatio: null,
      attributionCoverageRatio: null,
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
  let ticketsTrueSum = 0;
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
    ticketsTrueSum += m.ticketsTrue;
    if (m.reachSource === "cache_hit") anyHit = true;
    if (m.cacheFetchedAt) {
      if (!earliestFetchedAt || m.cacheFetchedAt < earliestFetchedAt) {
        earliestFetchedAt = m.cacheFetchedAt;
      }
    }
  }
  const totalMetaRegs = sumNullable("metaRegs");
  const totalAttribution = computeAttributionState({
    metaRegs: totalMetaRegs,
    ticketsTrue: ticketsTrueSum,
  });

  // PR #423: aggregate the verified-attribution fields. Same
  // semantics as the per-event resolver — `metaReportedPurchases`
  // stays null only when EVERY input was null (signals "we haven't
  // backfilled this aggregate's dimensions yet"). Coverage / trust
  // ratios are recomputed from the aggregate numerator / denominator
  // so a venue-level ratio aren't a weighted average of per-event
  // ratios — that would skew when one event dominates.
  const totalMetaPurchases = sumNullable("metaReportedPurchases");
  let totalOffpixelAttributed = 0;
  for (const m of metrics) {
    totalOffpixelAttributed += m.offpixelAttributedPurchases;
  }
  const totalTrustRatio =
    totalMetaPurchases && totalMetaPurchases > 0
      ? totalOffpixelAttributed / totalMetaPurchases
      : null;
  const totalCoverageRatio =
    ticketsTrueSum > 0 ? totalOffpixelAttributed / ticketsTrueSum : null;

  return {
    reach: sumNullable("reach"),
    impressions: sumNullable("impressions"),
    linkClicks: sumNullable("linkClicks"),
    landingPageViews: sumNullable("landingPageViews"),
    metaRegs: totalMetaRegs,
    engagements: sumNullable("engagements"),
    videoPlays3s: sumNullable("videoPlays3s"),
    videoPlays15s: sumNullable("videoPlays15s"),
    videoPlaysP100: sumNullable("videoPlaysP100"),
    spend,
    linkClicksRollupSum,
    tickets,
    revenue: revenueAny ? revenueTotal : null,
    ticketsTrue: ticketsTrueSum,
    attribution: totalAttribution,
    attributionRate: totalAttribution.rate,
    metaReportedPurchases: totalMetaPurchases,
    offpixelAttributedPurchases: totalOffpixelAttributed,
    attributionTrustRatio: totalTrustRatio,
    attributionCoverageRatio: totalCoverageRatio,
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
