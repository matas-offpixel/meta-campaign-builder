/**
 * lib/dashboard/__tests__/canonical-event-metrics.test.ts
 *
 * Unit tests for the pure canonical-metric composer (PR #418, audit
 * Section 5). The composer is the single seam every dashboard surface
 * routes reach / impressions / spend / link_clicks through. If these
 * tests pass, Cat A (sibling N-counting) and Cat B (daily-summed
 * reach) are mathematically impossible at the read seam.
 *
 * Scope:
 *   1. Cache HIT path — lifetime fields pass through verbatim.
 *   2. Cache MISS path — every cache-backed field is `null`,
 *      `reachSource === "cache_miss"`. Surfaces use this signal to
 *      render `—` rather than fall back to summed-daily-reach.
 *   3. Sibling N-counting dedup (Cat A) — multi-event venue with
 *      identical `meta_reach` / `meta_impressions` per sibling row
 *      gets collapsed via `dedupVenueRollupsByEventCode`. The test
 *      asserts the aggregate doesn't 4× the raw sum.
 *   4. Spend prefers allocator output over raw `ad_spend`, and
 *      always adds `ad_spend_presale` on top.
 *   5. `windowDays` filter narrows rollups to the supplied dates
 *      before dedup + aggregation (Stats Grid timeframe selector).
 *   6. `computeCanonicalEventMetricsByEventCode` walks the union of
 *      cache codes + rollup codes + event codes (so a code with
 *      rollups but no cache still gets a struct with reach=null).
 *   7. `sumCanonicalEventMetrics` preserves `null` when EVERY input
 *      was null for a field, and sums non-null values otherwise.
 *      This keeps the cache-miss signal at aggregate scope.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeCanonicalEventMetrics,
  computeCanonicalEventMetricsByEventCode,
  sumCanonicalEventMetrics,
} from "../canonical-event-metrics.ts";
import type { EventCodeLifetimeMetaCacheRow } from "../../db/event-code-lifetime-meta-cache.ts";
import type { DailyRollupRow } from "../../db/client-portal-server.ts";

const FROZEN_NOW = "2026-05-13T12:00:00.000Z";

const MANCHESTER_CACHE: EventCodeLifetimeMetaCacheRow = {
  client_id: "c-4tf",
  event_code: "WC26-MANCHESTER",
  // PR #418's two-pass design returns 805,264 (account-dedup), NOT
  // the 932,982 per-campaign sum that pre-PR cache populated.
  meta_reach: 805_264,
  meta_impressions: 1_500_000,
  meta_link_clicks: 12_500,
  meta_regs: 311,
  meta_video_plays_3s: 95_000,
  meta_video_plays_15s: 14_000,
  meta_video_plays_p100: 4_200,
  meta_engagements: 23_000,
  campaign_names: ["[WC26-MANCHESTER] Conversion", "[WC26-MANCHESTER] Presale"],
  fetched_at: FROZEN_NOW,
  created_at: FROZEN_NOW,
  updated_at: FROZEN_NOW,
};

function rollup(overrides: Partial<DailyRollupRow>): DailyRollupRow {
  return {
    event_id: overrides.event_id ?? "e1",
    date: overrides.date ?? "2026-05-01",
    tickets_sold: null,
    ad_spend: null,
    tiktok_spend: null,
    google_ads_spend: null,
    revenue: null,
    link_clicks: null,
    meta_regs: null,
    meta_impressions: null,
    meta_reach: null,
    meta_video_plays_3s: null,
    meta_video_plays_15s: null,
    meta_video_plays_p100: null,
    meta_engagements: null,
    tiktok_impressions: null,
    tiktok_video_views: null,
    tiktok_clicks: null,
    google_ads_impressions: null,
    google_ads_clicks: null,
    google_ads_video_views: null,
    ad_spend_allocated: null,
    ad_spend_presale: null,
    ad_spend_specific: null,
    ad_spend_generic_share: null,
    source_meta_at: null,
    source_eventbrite_at: null,
    ...overrides,
  } as DailyRollupRow;
}

describe("computeCanonicalEventMetrics — cache-hit branch", () => {
  it("passes lifetime cache fields through verbatim", () => {
    const result = computeCanonicalEventMetrics({
      cacheRow: MANCHESTER_CACHE,
      dailyRollups: [],
      events: [],
    });
    assert.equal(result.reach, 805_264);
    assert.equal(result.impressions, 1_500_000);
    assert.equal(result.linkClicks, 12_500);
    assert.equal(result.metaRegs, 311);
    assert.equal(result.videoPlays3s, 95_000);
    assert.equal(result.videoPlays15s, 14_000);
    assert.equal(result.videoPlaysP100, 4_200);
    assert.equal(result.engagements, 23_000);
    assert.equal(result.reachSource, "cache_hit");
    assert.equal(result.cacheFetchedAt, FROZEN_NOW);
  });

  it("defaults cumulative fields to 0 when no rollups supplied", () => {
    const result = computeCanonicalEventMetrics({
      cacheRow: MANCHESTER_CACHE,
      dailyRollups: [],
      events: [],
    });
    assert.equal(result.spend, 0);
    assert.equal(result.linkClicksRollupSum, 0);
    assert.equal(result.tickets, 0);
    assert.equal(result.revenue, null);
  });
});

describe("computeCanonicalEventMetrics — cache-miss branch", () => {
  it("returns null for every lifetime field on cache miss", () => {
    // The hard-fail signal. Surfaces (Stats Grid, Funnel Pacing
    // TOFU, etc.) MUST render `—` rather than substitute a summed-
    // daily-reach (the broken Cat B path).
    const result = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [],
      events: [],
    });
    assert.equal(result.reach, null);
    assert.equal(result.impressions, null);
    assert.equal(result.linkClicks, null);
    assert.equal(result.metaRegs, null);
    assert.equal(result.engagements, null);
    assert.equal(result.videoPlays3s, null);
    assert.equal(result.videoPlays15s, null);
    assert.equal(result.videoPlaysP100, null);
    assert.equal(result.reachSource, "cache_miss");
    assert.equal(result.cacheFetchedAt, null);
  });

  it("still computes cumulative fields on cache miss", () => {
    // Cache miss should NOT zero out windowed spend / clicks. Those
    // come from a different source and remain authoritative.
    const result = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [
        rollup({
          event_id: "e1",
          date: "2026-05-01",
          ad_spend_allocated: 100,
          link_clicks: 50,
        }),
      ],
      events: [],
    });
    assert.equal(result.spend, 100);
    assert.equal(result.linkClicksRollupSum, 50);
  });
});

describe("computeCanonicalEventMetrics — sibling-N dedup (Cat A)", () => {
  it("does NOT 4x meta_reach when 4 sibling events share campaign-wide values", () => {
    // The PR #413 scenario. Manchester WC26 has 4 fixtures sharing
    // `event_code = WC26-MANCHESTER`. Meta's per-campaign reach
    // value lands on EVERY sibling's rollup row for the same date —
    // naive SUM would 4×. The dedup must collapse to ONE canonical
    // row per (event_code, date).
    //
    // Note: meta_reach in rollups is per-day-deduplicated. Section
    // 5 says cache-backed reach is the lifetime number; rollup
    // reach is a Cat B trap and we do NOT route it into the
    // canonical struct. This test instead pins that dedup happens
    // for the cumulative fields the rollup IS authoritative on
    // (link_clicks pre-allocator, raw ad_spend pre-allocator).
    const rollups: DailyRollupRow[] = [
      rollup({
        event_id: "e1",
        date: "2026-05-01",
        ad_spend: 400,
        link_clicks: 1000,
        meta_reach: 250_000,
      }),
      rollup({
        event_id: "e2",
        date: "2026-05-01",
        ad_spend: 400,
        link_clicks: 1000,
        meta_reach: 250_000,
      }),
      rollup({
        event_id: "e3",
        date: "2026-05-01",
        ad_spend: 400,
        link_clicks: 1000,
        meta_reach: 250_000,
      }),
      rollup({
        event_id: "e4",
        date: "2026-05-01",
        ad_spend: 400,
        link_clicks: 1000,
        meta_reach: 250_000,
      }),
    ];
    const result = computeCanonicalEventMetrics({
      cacheRow: MANCHESTER_CACHE,
      dailyRollups: rollups,
      events: [
        { id: "e1", event_code: "WC26-MANCHESTER" },
        { id: "e2", event_code: "WC26-MANCHESTER" },
        { id: "e3", event_code: "WC26-MANCHESTER" },
        { id: "e4", event_code: "WC26-MANCHESTER" },
      ],
    });

    // 4 sibling rows × 400 spend each, but the allocator hasn't run
    // (no `ad_spend_allocated`), so the dedup collapses to ONE row
    // holding the MAX (400). spend=400, NOT 1600.
    assert.equal(
      result.spend,
      400,
      "sibling spend dedup must collapse 4×400 to 400 when allocator hasn't run",
    );
    assert.equal(
      result.linkClicksRollupSum,
      1000,
      "sibling link_clicks dedup must collapse 4×1000 to 1000",
    );
    // Cache-backed reach unchanged.
    assert.equal(result.reach, 805_264);
  });

  it("post-allocator dates: spend SUMs across siblings (per-event correct)", () => {
    const rollups: DailyRollupRow[] = [
      rollup({
        event_id: "e1",
        date: "2026-05-01",
        ad_spend: 1600,
        ad_spend_allocated: 400,
        link_clicks: 250,
      }),
      rollup({
        event_id: "e2",
        date: "2026-05-01",
        ad_spend: 1600,
        ad_spend_allocated: 400,
        link_clicks: 250,
      }),
      rollup({
        event_id: "e3",
        date: "2026-05-01",
        ad_spend: 1600,
        ad_spend_allocated: 400,
        link_clicks: 250,
      }),
      rollup({
        event_id: "e4",
        date: "2026-05-01",
        ad_spend: 1600,
        ad_spend_allocated: 400,
        link_clicks: 250,
      }),
    ];
    const result = computeCanonicalEventMetrics({
      cacheRow: MANCHESTER_CACHE,
      dailyRollups: rollups,
      events: [
        { id: "e1", event_code: "WC26-MANCHESTER" },
        { id: "e2", event_code: "WC26-MANCHESTER" },
        { id: "e3", event_code: "WC26-MANCHESTER" },
        { id: "e4", event_code: "WC26-MANCHESTER" },
      ],
    });
    // Allocator-split spend SUMs (per-event correct). 4 × 400 = 1600.
    assert.equal(result.spend, 1600);
    // Allocator's per-event clicks also SUM (per-event correct).
    // 4 × 250 = 1000.
    assert.equal(result.linkClicksRollupSum, 1000);
  });
});

describe("computeCanonicalEventMetrics — spend resolution", () => {
  it("prefers ad_spend_allocated over raw ad_spend", () => {
    const result = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [
        rollup({
          event_id: "e1",
          date: "2026-05-01",
          ad_spend: 9999,
          ad_spend_allocated: 100,
        }),
      ],
      events: [],
    });
    assert.equal(result.spend, 100);
  });

  it("falls back to raw ad_spend when allocator hasn't run", () => {
    const result = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [
        rollup({
          event_id: "e1",
          date: "2026-05-01",
          ad_spend: 50,
          ad_spend_allocated: null,
        }),
      ],
      events: [],
    });
    assert.equal(result.spend, 50);
  });

  it("always adds ad_spend_presale on top of allocated/raw", () => {
    const result = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [
        rollup({
          event_id: "e1",
          date: "2026-05-01",
          ad_spend: 100,
          ad_spend_allocated: 80,
          ad_spend_presale: 20,
        }),
      ],
      events: [],
    });
    // 80 (allocated) + 20 (presale) = 100. The raw 100 is ignored
    // because allocator ran.
    assert.equal(result.spend, 100);
  });

  it("counts standalone ad_spend_presale rows even with no other spend column", () => {
    const result = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [
        rollup({
          event_id: "e1",
          date: "2026-05-01",
          ad_spend_presale: 33,
        }),
      ],
      events: [],
    });
    assert.equal(result.spend, 33);
  });
});

describe("computeCanonicalEventMetrics — windowDays filter", () => {
  it("drops rollup rows whose date is not in the supplied set", () => {
    const result = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [
        rollup({
          event_id: "e1",
          date: "2026-05-01",
          ad_spend_allocated: 100,
        }),
        rollup({
          event_id: "e1",
          date: "2026-05-02",
          ad_spend_allocated: 50,
        }),
        rollup({
          event_id: "e1",
          date: "2026-05-03",
          ad_spend_allocated: 25,
        }),
      ],
      events: [],
      windowDays: new Set(["2026-05-01", "2026-05-02"]),
    });
    // Only the first two days survive the filter.
    assert.equal(result.spend, 150);
  });

  it("treats null/undefined windowDays as lifetime (no filter)", () => {
    const rollups = [
      rollup({
        event_id: "e1",
        date: "2026-05-01",
        ad_spend_allocated: 100,
      }),
      rollup({
        event_id: "e1",
        date: "2026-05-02",
        ad_spend_allocated: 50,
      }),
    ];
    const undef = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: rollups,
      events: [],
    });
    const explicit = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: rollups,
      events: [],
      windowDays: null,
    });
    assert.equal(undef.spend, 150);
    assert.equal(explicit.spend, 150);
  });
});

describe("computeCanonicalEventMetricsByEventCode — scope contract (PR #419)", () => {
  // PR #419 (audit follow-up — Bug 1, +507% Manchester drift):
  // `computeCanonicalEventMetricsByEventCode` UNIONs cache codes
  // with rollup/event codes when building its iteration set. That
  // is the documented behaviour and is preserved (some callers
  // intentionally pass cache rows for codes that have no events
  // / rollups in scope to surface partial-coverage signal).
  //
  // The bug class the regression below pins is *caller-side*:
  // funnel-pacing was passing the client-wide cache (all 18 venues)
  // when its scope was a single venue. Manchester's pacing page
  // showed 4.89M instead of 805k because the helper happily included
  // every cache row's reach in the result map.
  //
  // The helper's job is unchanged. Callers are responsible for
  // filtering `cacheRows` to their intended scope BEFORE invoking
  // the helper. The two tests below pin both halves of this
  // contract.

  it("REGRESSION: when a caller leaks cacheRows for codes outside its scope, the helper unions them in (caller MUST filter first)", () => {
    // Pre-PR-#419 funnel-pacing shape: scope is one venue, cacheRows
    // is client-wide. Helper picks up every cache row.
    const clientWideCache: EventCodeLifetimeMetaCacheRow[] = [
      MANCHESTER_CACHE,
      { ...MANCHESTER_CACHE, event_code: "WC26-BRIGHTON", meta_reach: 175_000 },
      { ...MANCHESTER_CACHE, event_code: "WC26-EDINBURGH", meta_reach: 410_000 },
    ];
    const out = computeCanonicalEventMetricsByEventCode({
      cacheRows: clientWideCache,
      rollupsByEventCode: new Map(),
      // Scope = Manchester only. Pre-PR-#419 funnel-pacing built
      // this map correctly from `liveEvents`, but failed to filter
      // `cacheRows` to match. Brighton + Edinburgh leak in.
      eventsByEventCode: new Map([
        ["WC26-MANCHESTER", [{ id: "m1", event_code: "WC26-MANCHESTER" }]],
      ]),
    });
    assert.equal(
      out.size,
      3,
      "helper unions ALL input cache codes — this is the documented contract; the bug is the caller passing too many rows",
    );
    const summed = sumCanonicalEventMetrics([...out.values()]);
    assert.equal(
      summed.reach,
      805_264 + 175_000 + 410_000,
      "summing the leaked rows gives the +507% Manchester pacing drift Joe reported",
    );
  });

  it("when caller filters cacheRows to its scope first, helper output matches scope exactly", () => {
    // Post-PR-#419 funnel-pacing shape: scope is one venue, cacheRows
    // is filtered to that scope first. Helper output is exactly the
    // scoped venue.
    const clientWideCache: EventCodeLifetimeMetaCacheRow[] = [
      MANCHESTER_CACHE,
      { ...MANCHESTER_CACHE, event_code: "WC26-BRIGHTON", meta_reach: 175_000 },
      { ...MANCHESTER_CACHE, event_code: "WC26-EDINBURGH", meta_reach: 410_000 },
    ];
    const eventsByCode = new Map<
      string,
      Array<{ id: string; event_code: string | null }>
    >([["WC26-MANCHESTER", [{ id: "m1", event_code: "WC26-MANCHESTER" }]]]);

    // The fix: caller filters `cacheRows` to event_codes in scope.
    const inScope = new Set(eventsByCode.keys());
    const scopedCache = clientWideCache.filter((row) =>
      inScope.has(row.event_code),
    );

    const out = computeCanonicalEventMetricsByEventCode({
      cacheRows: scopedCache,
      rollupsByEventCode: new Map(),
      eventsByEventCode: eventsByCode,
    });
    assert.equal(out.size, 1);
    assert.deepEqual([...out.keys()], ["WC26-MANCHESTER"]);
    const summed = sumCanonicalEventMetrics([...out.values()]);
    assert.equal(
      summed.reach,
      805_264,
      "scope-filtered cache yields the in-scope venue's deduped reach — no Cat F leak from siblings",
    );
  });
});

describe("computeCanonicalEventMetricsByEventCode (multi-code variant)", () => {
  it("walks the union of cache codes + rollup codes + event codes", () => {
    const cacheRows: EventCodeLifetimeMetaCacheRow[] = [MANCHESTER_CACHE];
    const rollupsByCode = new Map<string, DailyRollupRow[]>([
      [
        "WC26-MANCHESTER",
        [
          rollup({
            event_id: "m1",
            date: "2026-05-01",
            ad_spend_allocated: 200,
          }),
        ],
      ],
      [
        // Rollup-only — cache miss for this code.
        "WC26-BRIGHTON",
        [
          rollup({
            event_id: "b1",
            date: "2026-05-01",
            ad_spend_allocated: 50,
          }),
        ],
      ],
    ]);
    const eventsByCode = new Map<
      string,
      Array<{ id: string; event_code: string | null }>
    >([
      ["WC26-MANCHESTER", [{ id: "m1", event_code: "WC26-MANCHESTER" }]],
      ["WC26-BRIGHTON", [{ id: "b1", event_code: "WC26-BRIGHTON" }]],
    ]);

    const out = computeCanonicalEventMetricsByEventCode({
      cacheRows,
      rollupsByEventCode: rollupsByCode,
      eventsByEventCode: eventsByCode,
    });

    assert.equal(out.size, 2);
    const manchester = out.get("WC26-MANCHESTER")!;
    assert.equal(manchester.reach, 805_264);
    assert.equal(manchester.spend, 200);
    assert.equal(manchester.reachSource, "cache_hit");
    const brighton = out.get("WC26-BRIGHTON")!;
    assert.equal(brighton.reach, null);
    assert.equal(brighton.spend, 50);
    assert.equal(brighton.reachSource, "cache_miss");
  });
});

describe("sumCanonicalEventMetrics", () => {
  it("preserves null reach when EVERY input was null (full cache miss)", () => {
    const a = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [],
      events: [],
    });
    const b = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [],
      events: [],
    });
    const sum = sumCanonicalEventMetrics([a, b]);
    assert.equal(sum.reach, null);
    assert.equal(sum.reachSource, "cache_miss");
  });

  it("sums non-null reach across cache hits", () => {
    const a = computeCanonicalEventMetrics({
      cacheRow: MANCHESTER_CACHE,
      dailyRollups: [],
      events: [],
    });
    const b = computeCanonicalEventMetrics({
      cacheRow: { ...MANCHESTER_CACHE, event_code: "WC26-BRIGHTON", meta_reach: 200_000 },
      dailyRollups: [],
      events: [],
    });
    const sum = sumCanonicalEventMetrics([a, b]);
    assert.equal(sum.reach, 805_264 + 200_000);
    assert.equal(sum.reachSource, "cache_hit");
  });

  it("partial coverage: hits sum, misses contribute nothing to lifetime fields", () => {
    const hit = computeCanonicalEventMetrics({
      cacheRow: MANCHESTER_CACHE,
      dailyRollups: [],
      events: [],
    });
    const miss = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [],
      events: [],
    });
    const sum = sumCanonicalEventMetrics([hit, miss]);
    assert.equal(sum.reach, 805_264);
    // The aggregate "had at least one hit" — so reachSource is hit.
    // (Surfaces still get the per-code reachSource map if they need
    // to detect partial coverage.)
    assert.equal(sum.reachSource, "cache_hit");
  });

  it("sums spend / link_clicks / tickets across inputs", () => {
    const a = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [
        rollup({ ad_spend_allocated: 100, link_clicks: 10, event_id: "e1" }),
      ],
      events: [],
      tickets: 5,
    });
    const b = computeCanonicalEventMetrics({
      cacheRow: null,
      dailyRollups: [
        rollup({ ad_spend_allocated: 50, link_clicks: 5, event_id: "e2" }),
      ],
      events: [],
      tickets: 7,
    });
    const sum = sumCanonicalEventMetrics([a, b]);
    assert.equal(sum.spend, 150);
    assert.equal(sum.linkClicksRollupSum, 15);
    assert.equal(sum.tickets, 12);
  });

  it("returns the empty-state struct on empty input", () => {
    const sum = sumCanonicalEventMetrics([]);
    assert.equal(sum.reach, null);
    assert.equal(sum.spend, 0);
    assert.equal(sum.tickets, 0);
    assert.equal(sum.reachSource, "cache_miss");
  });
});
