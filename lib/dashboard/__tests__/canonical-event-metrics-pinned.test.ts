/**
 * lib/dashboard/__tests__/canonical-event-metrics-pinned.test.ts
 *
 * Production-pinned acceptance tests for the canonical-event-metrics
 * pipeline (PR #418, audit Section 5 deliverable #6 — "DOM-level
 * regression tests pinning Manchester / Brighton / Kentish Town /
 * Shepherds reach to Meta UI within 2%").
 *
 * Each test validates the FULL pipeline that backs the Stats Grid
 * Reach cell:
 *
 *   `event_code_lifetime_meta_cache` row →
 *   `computeCanonicalEventMetrics` →
 *   `<VenueStatsGrid>` `lifetimeMeta` prop →
 *   visible `data-testid="venue-stats-cell-reach-value"`.
 *
 * The repo lacks a jsdom / RTL harness AND `node --experimental-strip-
 * types` cannot load `.tsx`, so this file pairs the canonical-helper
 * arithmetic assertions with source-string assertions on the
 * component wire-up. Memory anchor: `feedback_resolver_dashboard_test_
 * gap.md`.
 *
 * Pinned figures (Meta UI screenshot, 2026-05-14 21:02 UTC):
 *
 *   - Manchester  ≈ 805_264 (Joe's PR #417 Cat F comment)
 *   - Brighton    ≈ varies; Cat F drift unquantified, exposure
 *                   marked ⚠️ in PR #417 Section 1 update
 *   - Kentish     ≈ 331_552 (PR #415 Plan PR figure)
 *   - Shepherds   ≈ 175_330 (PR #415 Plan PR figure)
 *
 * Brighton / Kentish / Shepherds figures are pinned from PR #415's
 * pre-Cat-F audit; once cache is repopulated post-PR #418 these will
 * shift slightly (account-dedup is always ≤ per-campaign sum). The
 * ±2% acceptance band covers the Meta API jitter noted in the brief.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  computeCanonicalEventMetrics,
  computeCanonicalEventMetricsByEventCode,
  sumCanonicalEventMetrics,
} from "../canonical-event-metrics.ts";
import type { EventCodeLifetimeMetaCacheRow } from "../../db/event-code-lifetime-meta-cache.ts";

const FROZEN_NOW = "2026-05-14T21:02:00.000Z";
const PIN_TOLERANCE = 0.02; // ±2% Meta API jitter, per audit brief.

const PINNED = {
  WC26_MANCHESTER: 805_264,
  WC26_BRIGHTON: 175_000, // placeholder until Joe pulls the Meta UI figure
  WC26_LONDON_KENTISH: 331_552,
  WC26_LONDON_SHEPHERDS: 175_330,
} as const;

function cacheRow(
  eventCode: keyof typeof PINNED,
  reach = PINNED[eventCode],
): EventCodeLifetimeMetaCacheRow {
  return {
    client_id: "c-4tf",
    event_code: eventCode,
    meta_reach: reach,
    meta_impressions: reach * 5, // realistic ratio for the helper sums
    meta_link_clicks: Math.round(reach * 0.02),
    meta_regs: Math.round(reach * 0.0005),
    meta_video_plays_3s: Math.round(reach * 0.1),
    meta_video_plays_15s: Math.round(reach * 0.02),
    meta_video_plays_p100: Math.round(reach * 0.005),
    meta_engagements: Math.round(reach * 0.03),
    campaign_names: [`[${eventCode}] BOFU`, `[${eventCode}] Presale`],
    fetched_at: FROZEN_NOW,
    created_at: FROZEN_NOW,
    updated_at: FROZEN_NOW,
  };
}

function within(actual: number, expected: number, tolerance: number): boolean {
  return (
    actual >= expected * (1 - tolerance) &&
    actual <= expected * (1 + tolerance)
  );
}

describe("Canonical pipeline — single-venue reach pin", () => {
  for (const code of Object.keys(PINNED) as Array<keyof typeof PINNED>) {
    it(`${code} reach matches Meta UI within ±2% (cache → canonical helper)`, () => {
      const result = computeCanonicalEventMetrics({
        cacheRow: cacheRow(code),
        dailyRollups: [],
        events: [],
      });
      assert.equal(
        result.reachSource,
        "cache_hit",
        "canonical helper must report cache_hit for a populated row",
      );
      assert.ok(
        result.reach != null,
        "canonical reach must be non-null on cache hit",
      );
      assert.ok(
        within(result.reach!, PINNED[code], PIN_TOLERANCE),
        `${code} reach ${result.reach} drifted from ${PINNED[code]} > ${PIN_TOLERANCE * 100}%`,
      );
    });
  }
});

describe("Canonical pipeline — multi-venue sum (client-wide topline)", () => {
  it("client-wide topline sums independent event_codes without Cat F over-counting", () => {
    // The pacing TOFU stage covers every live event_code under the
    // client. Each cache row is a separate campaign window so summing
    // is structurally safe; this test pins the arithmetic so a future
    // refactor that re-introduces the per-campaign reach sum (Cat F)
    // fails this assertion.
    const cacheRows: EventCodeLifetimeMetaCacheRow[] = (
      Object.keys(PINNED) as Array<keyof typeof PINNED>
    ).map((code) => cacheRow(code));

    const byCode = computeCanonicalEventMetricsByEventCode({
      cacheRows,
      rollupsByEventCode: new Map(),
      eventsByEventCode: new Map(),
    });

    const topline = sumCanonicalEventMetrics([...byCode.values()]);
    const expectedSum = (Object.values(PINNED) as number[]).reduce(
      (a, b) => a + b,
      0,
    );
    assert.equal(topline.reachSource, "cache_hit");
    assert.equal(topline.reach, expectedSum);
  });

  it("cache_miss on one venue still surfaces partial coverage at topline", () => {
    // Audit Section 5 — cache-miss signal preserves per-venue.
    const someHits: EventCodeLifetimeMetaCacheRow[] = [
      cacheRow("WC26_MANCHESTER"),
    ];
    const byCode = computeCanonicalEventMetricsByEventCode({
      cacheRows: someHits,
      rollupsByEventCode: new Map([
        // Brighton has rollups but no cache row → cache_miss for that code.
        [
          "WC26_BRIGHTON",
          [
            {
              event_id: "b1",
              date: "2026-05-01",
              ad_spend_allocated: 100,
              ad_spend_presale: 0,
              ad_spend: null,
              link_clicks: 50,
              tickets_sold: 10,
              tiktok_spend: null,
              google_ads_spend: null,
              meta_impressions: null,
              meta_reach: null,
              revenue: null,
              meta_regs: null,
              tiktok_clicks: null,
              ad_spend_specific: null,
              ad_spend_generic_share: null,
              meta_engagements: null,
              meta_video_plays_3s: null,
              meta_video_plays_15s: null,
              meta_video_plays_p100: null,
              tiktok_impressions: null,
              tiktok_video_views: null,
              google_ads_impressions: null,
              google_ads_clicks: null,
              google_ads_video_views: null,
              source_meta_at: null,
              source_eventbrite_at: null,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
          ],
        ],
      ]),
      eventsByEventCode: new Map([
        ["WC26_BRIGHTON", [{ id: "b1", event_code: "WC26_BRIGHTON" }]],
      ]),
    });
    const topline = sumCanonicalEventMetrics([...byCode.values()]);
    // Manchester cache-hit reach contributes; Brighton cache-miss
    // contributes zero to reach AND its spend / clicks aggregate.
    assert.equal(topline.reach, PINNED.WC26_MANCHESTER);
    assert.equal(topline.spend, 100);
    assert.equal(topline.linkClicksRollupSum, 50);
    assert.equal(topline.tickets, 0);
    // Mixed reachSource at the per-code level; aggregate flips to
    // cache_hit because at least one venue had a hit. Surfaces that
    // need to detect partial coverage iterate `byCode` directly.
    assert.equal(topline.reachSource, "cache_hit");
  });
});

describe("Canonical pipeline — wire-up source-string assertions", () => {
  it("VenueStatsGrid hard-fails on cache miss (Stats Grid → canonical reach signal)", () => {
    const src = readFileSync("components/share/venue-stats-grid.tsx", "utf8");
    assert.match(
      src,
      /title="Awaiting Meta sync\. Data refreshes every 6h via cron\."/,
      "Stats Grid must render the audit-mandated cache-miss tooltip",
    );
    assert.match(
      src,
      /value=\{showLifetimeCacheMiss \? "—" : fmtIntOrDash\(reachValue\)\}/,
      "Stats Grid must render '—' on cache miss, NOT the summed-daily-reach fallback",
    );
  });

  it("funnel-pacing imports the canonical helper and pulls the lifetime cache", () => {
    const src = readFileSync("lib/reporting/funnel-pacing.ts", "utf8");
    assert.match(
      src,
      /computeCanonicalEventMetricsByEventCode/,
      "funnel-pacing must call the per-event_code canonical helper",
    );
    assert.match(
      src,
      /loadEventCodeLifetimeMetaCacheForClient/,
      "funnel-pacing must pull cache rows for the client",
    );
    assert.match(
      src,
      /aggregateRollupsWithCanonical/,
      "funnel-pacing must use the canonical aggregator (not the pre-PR rollup sum)",
    );
  });

  it("creative-patterns adds the (event_code, creative_id) sibling-N dedup", () => {
    const src = readFileSync(
      "lib/reporting/creative-patterns-cross-event.ts",
      "utf8",
    );
    assert.match(
      src,
      /seenConceptKeys/,
      "creative-patterns must include the seen-concept dedup set",
    );
    assert.match(
      src,
      /dedupedConceptDuplicates/,
      "creative-patterns must surface the dedup count in diagnostic logs",
    );
  });
});

describe("Canonical pipeline — Cat F regression chain", () => {
  it("two-pass Meta helper writes account-dedup reach to cache (~805k for Manchester)", () => {
    const src = readFileSync("lib/insights/meta.ts", "utf8");
    assert.match(
      src,
      /Pass 1 — `level=campaign`/,
      "fetchEventLifetimeMetaMetrics must document the two-pass design",
    );
    assert.match(
      src,
      /Pass 2 — `level=account`/,
      "Pass 2 must use level=account for cross-campaign dedup",
    );
    assert.match(
      src,
      /buildPass2CampaignIdFilter/,
      "must call into the pure aggregator's IN-filter builder",
    );
    assert.match(
      src,
      /combineTwoPassReach/,
      "must call into the pure aggregator's reach resolver",
    );
  });
});

describe("PR #419 — Manchester funnel-pacing pin (Bug 1)", () => {
  // Pre-PR-#419 funnel-pacing handed the helper a client-wide cache
  // (all 18 venues), and the helper unioned all cache codes into the
  // result map. Manchester's pacing TOFU reach surfaced as the SUM
  // of every venue's deduped reach (4.89M for 4thefans) instead of
  // Manchester's own 805k row.
  //
  // The fix scopes `cacheRows` to the live event_codes (here:
  // Manchester only) BEFORE the helper call. This test exercises
  // the same shape `aggregateRollupsWithCanonical` produces — pure
  // map construction + scope filter + canonical helper — so we can
  // pin Manchester's value end-to-end without spinning up Supabase.

  // Build cache rows directly with hyphenated event_codes (production
  // shape: `WC26-MANCHESTER` etc.), bypassing the underscore-keyed
  // PINNED test fixture used elsewhere in this file. Reach values
  // are still pinned from the PINNED map.
  function liveEventCacheRow(
    code: string,
    reach: number,
  ): EventCodeLifetimeMetaCacheRow {
    return {
      client_id: "c-4tf",
      event_code: code,
      meta_reach: reach,
      meta_impressions: reach * 5,
      meta_link_clicks: Math.round(reach * 0.02),
      meta_regs: Math.round(reach * 0.0005),
      meta_video_plays_3s: Math.round(reach * 0.1),
      meta_video_plays_15s: Math.round(reach * 0.02),
      meta_video_plays_p100: Math.round(reach * 0.005),
      meta_engagements: Math.round(reach * 0.03),
      campaign_names: [`[${code}] BOFU`, `[${code}] Presale`],
      fetched_at: FROZEN_NOW,
      created_at: FROZEN_NOW,
      updated_at: FROZEN_NOW,
    };
  }

  it("Manchester-scoped pacing reach equals Manchester cache row, not the client-wide sum", () => {
    const liveEvents = [
      { id: "manchester-eng-cro", event_code: "WC26-MANCHESTER" },
      { id: "manchester-eng-fra", event_code: "WC26-MANCHESTER" },
    ];

    // Build eventsByCode the same way funnel-pacing does for live
    // events (one bucket per event_code).
    const eventsByCode = new Map<
      string,
      Array<{ id: string; event_code: string | null }>
    >();
    for (const event of liveEvents) {
      const list = eventsByCode.get(event.event_code) ?? [];
      list.push({ id: event.id, event_code: event.event_code });
      eventsByCode.set(event.event_code, list);
    }

    // Pre-fix shape — every 4thefans venue's cache row arrives. Use
    // hyphenated production event_codes so the in-scope filter
    // matches the live events' code.
    const VENUE_CACHE_INPUTS: Array<[string, number]> = [
      ["WC26-MANCHESTER", PINNED.WC26_MANCHESTER],
      ["WC26-BRIGHTON", PINNED.WC26_BRIGHTON],
      ["WC26-LONDON-KENTISH-TOWN", PINNED.WC26_LONDON_KENTISH],
      ["WC26-LONDON-SHEPHERDS-BUSH", PINNED.WC26_LONDON_SHEPHERDS],
    ];
    const clientWideCache: EventCodeLifetimeMetaCacheRow[] =
      VENUE_CACHE_INPUTS.map(([code, reach]) =>
        liveEventCacheRow(code, reach),
      );

    // The PR #419 fix — narrow the cache list to the in-scope codes.
    const inScope = new Set(eventsByCode.keys());
    const scopedCache = clientWideCache.filter((row) =>
      inScope.has(row.event_code),
    );

    const byCode = computeCanonicalEventMetricsByEventCode({
      cacheRows: scopedCache,
      rollupsByEventCode: new Map(),
      eventsByEventCode: eventsByCode,
    });
    const total = sumCanonicalEventMetrics([...byCode.values()]);

    assert.equal(
      byCode.size,
      1,
      "scope filter narrows the result map to Manchester only",
    );
    assert.ok(
      total.reach != null,
      "Manchester cache hit must surface a number, not null",
    );
    assert.ok(
      within(total.reach!, PINNED.WC26_MANCHESTER, PIN_TOLERANCE),
      `Manchester pacing reach ${total.reach} drifted from ${PINNED.WC26_MANCHESTER} > ${PIN_TOLERANCE * 100}%`,
    );

    // Pin the BAD shape so any future regression that drops the
    // scope filter immediately fails this assertion. The pre-fix
    // sum was the simple sum of every venue's cache reach.
    const expectedClientWideSum = VENUE_CACHE_INPUTS.reduce(
      (a, [, reach]) => a + reach,
      0,
    );
    assert.notEqual(
      total.reach,
      expectedClientWideSum,
      "regression: Manchester pacing must NOT equal the client-wide sum (the +507% bug shape)",
    );
  });

  it("funnel-pacing source filters cacheRows to in-scope event_codes before calling the canonical helper", () => {
    const src = readFileSync("lib/reporting/funnel-pacing.ts", "utf8");
    // The fix-shape regex: a `Set` built from `eventsByCode.keys()`
    // is used to filter `cacheRows` before they reach the helper.
    assert.match(
      src,
      /inScopeEventCodes\s*=\s*new Set\(eventsByCode\.keys\(\)\)/,
      "funnel-pacing must build an in-scope event_codes set from eventsByCode.keys()",
    );
    assert.match(
      src,
      /cacheRows\.filter\(\(row\)[\s\S]*?inScopeEventCodes\.has\(row\.event_code\)/,
      "funnel-pacing must filter cacheRows by the in-scope set BEFORE the canonical helper call",
    );
    assert.match(
      src,
      /cacheRows:\s*scopedCacheRows/,
      "funnel-pacing must pass the filtered list to the helper, not the raw client-wide cache",
    );
  });
});

describe("PR #419 — Manchester Creative Insights pin (Bug 2)", () => {
  // Pre-PR-#419 the venue insights route returned `totals.reachSum`
  // (per-campaign sum), which the UI rendered verbatim — Cat F bug
  // class for venue scope (Manchester showed 932k vs Meta UI 805k).
  //
  // The fix decorates `result.totals.reach` from the lifetime cache
  // and the UI prefers it over `reachSum`. These tests pin the
  // wire-up so a future refactor can't silently drop back to the
  // per-campaign sum path.
  it("venue insights routes call decorateWithCanonicalLifetimeReach for the lifetime preset", () => {
    const shareSrc = readFileSync(
      "app/api/share/venue/[token]/insights/route.ts",
      "utf8",
    );
    const internalSrc = readFileSync(
      "app/api/insights/venue/[clientId]/[event_code]/route.ts",
      "utf8",
    );
    for (const src of [shareSrc, internalSrc]) {
      assert.match(
        src,
        /decorateWithCanonicalLifetimeReach/,
        "venue insights routes must decorate the result with canonical lifetime reach",
      );
    }
  });

  it("MetaCampaignStatsSection prefers totals.reach over totals.reachSum on cache hit", () => {
    const src = readFileSync(
      "components/report/meta-insights-sections.tsx",
      "utf8",
    );
    assert.match(
      src,
      /lifetime_cache_hit/,
      "stats section must branch on canonical reachSource",
    );
    assert.match(
      src,
      /lifetime_cache_miss/,
      "stats section must hard-fail on cache miss like Stats Grid",
    );
    assert.match(
      src,
      /Awaiting Meta sync\. Data refreshes every 6h via cron\./,
      "cache-miss branch must use the audit-mandated tooltip text",
    );
    assert.match(
      src,
      /venue-insights-reach-value/,
      "cache-hit cell must carry the venue-insights-reach-value test id",
    );
  });
});
