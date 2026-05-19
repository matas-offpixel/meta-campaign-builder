/**
 * Resolver-level tests for the four PR #423 fields:
 *   metaReportedPurchases, offpixelAttributedPurchases,
 *   attributionTrustRatio, attributionCoverageRatio.
 *
 * Pinned cases:
 *   1. Pre-Joe (no maps supplied)        ⇒ metaReportedPurchases null,
 *                                         offpixelAttributedPurchases 0,
 *                                         both ratios null.
 *   2. Layer A only (Meta map populated, B empty) ⇒ trust = 0.
 *   3. Layer A + B both populated         ⇒ ratios computed correctly.
 *   4. Sum across event_codes             ⇒ aggregate ratios recomputed
 *      from numerator/denominator (NOT a weighted average of children).
 *   5. Brand campaign event             ⇒ same fields populate; the
 *      tile component handles the eventKind gate, not the resolver.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeCanonicalEventMetrics,
  sumCanonicalEventMetrics,
} from "../canonical-event-metrics.ts";
import type { EventCodeLifetimeMetaCacheRow } from "../../db/event-code-lifetime-meta-cache.ts";
import type { DailyRollupRow } from "../../db/client-portal-server.ts";

const FROZEN_NOW = "2026-05-19T08:00:00.000Z";

function cache(
  overrides: Partial<EventCodeLifetimeMetaCacheRow>,
): EventCodeLifetimeMetaCacheRow {
  return {
    client_id: "c-4tf",
    event_code: "WC26-EXAMPLE",
    meta_reach: null,
    meta_impressions: null,
    meta_link_clicks: null,
    meta_regs: null,
    meta_video_plays_3s: null,
    meta_video_plays_15s: null,
    meta_video_plays_p100: null,
    meta_engagements: null,
    campaign_names: [],
    fetched_at: FROZEN_NOW,
    created_at: FROZEN_NOW,
    updated_at: FROZEN_NOW,
    ...overrides,
  };
}

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

describe("canonical resolver — real attribution v2 fields", () => {
  it("pre-Joe (no maps supplied) returns null + 0 + null + null", () => {
    const m = computeCanonicalEventMetrics({
      cacheRow: cache({ meta_regs: 100 }),
      dailyRollups: [
        rollup({ event_id: "e1", date: "2026-05-01", tickets_sold: 200 }),
      ],
      events: [{ id: "e1", event_code: "WC26-EXAMPLE" }],
    });
    assert.equal(m.metaReportedPurchases, null);
    assert.equal(m.offpixelAttributedPurchases, 0);
    assert.equal(m.attributionTrustRatio, null);
    // Coverage = 0 / 200 = 0 — but ratio is reported as 0 (a number),
    // not null, when ticketsTrue > 0. The component treats 0 ratio
    // as red.
    assert.equal(m.attributionCoverageRatio, 0);
  });

  it("Layer A populated, Layer B empty: metaReported set, verified=0, trust=0, coverage=0", () => {
    const m = computeCanonicalEventMetrics({
      cacheRow: cache({ meta_regs: 100 }),
      dailyRollups: [
        rollup({ event_id: "e1", date: "2026-05-01", tickets_sold: 200 }),
      ],
      events: [{ id: "e1", event_code: "WC26-EXAMPLE" }],
      metaPurchasesByEventId: new Map([["e1", 50]]),
      offpixelAttributedPurchasesByEventId: new Map([["e1", 0]]),
    });
    assert.equal(m.metaReportedPurchases, 50);
    assert.equal(m.offpixelAttributedPurchases, 0);
    assert.equal(m.attributionTrustRatio, 0);
    assert.equal(m.attributionCoverageRatio, 0);
  });

  it("both layers populated: trust + coverage compute from raw counts", () => {
    const m = computeCanonicalEventMetrics({
      cacheRow: cache({ meta_regs: 100 }),
      dailyRollups: [
        rollup({ event_id: "e1", date: "2026-05-01", tickets_sold: 100 }),
      ],
      events: [{ id: "e1", event_code: "WC26-EXAMPLE" }],
      metaPurchasesByEventId: new Map([["e1", 80]]),
      offpixelAttributedPurchasesByEventId: new Map([["e1", 70]]),
    });
    assert.equal(m.metaReportedPurchases, 80);
    assert.equal(m.offpixelAttributedPurchases, 70);
    // 70/80 = 0.875 (in green band)
    assert.equal(m.attributionTrustRatio, 70 / 80);
    // 70/100 = 0.7 (in green band)
    assert.equal(m.attributionCoverageRatio, 0.7);
  });

  it("multi-event_code: Meta purchases sum across the venue's events", () => {
    const m = computeCanonicalEventMetrics({
      cacheRow: cache({ meta_regs: 200 }),
      dailyRollups: [
        rollup({ event_id: "e1", date: "2026-04-01", tickets_sold: 200 }),
        rollup({ event_id: "e2", date: "2026-04-15", tickets_sold: 300 }),
      ],
      events: [
        { id: "e1", event_code: "WC26-LONDON-OUTERNET" },
        { id: "e2", event_code: "WC26-LONDON-OUTERNET" },
      ],
      metaPurchasesByEventId: new Map([
        ["e1", 70],
        ["e2", 90],
      ]),
      offpixelAttributedPurchasesByEventId: new Map([
        ["e1", 60],
        ["e2", 80],
      ]),
    });
    assert.equal(m.metaReportedPurchases, 160);
    assert.equal(m.offpixelAttributedPurchases, 140);
    // ticketsTrue should be 500 (200 + 300 from rollups; no
    // tier_channel map supplied)
    assert.equal(m.ticketsTrue, 500);
    assert.equal(m.attributionTrustRatio, 140 / 160);
    assert.equal(m.attributionCoverageRatio, 140 / 500);
  });

  it("only one event in the venue has metaPurchasesByEventId entry: missing entries treated as 0", () => {
    const m = computeCanonicalEventMetrics({
      cacheRow: cache({ meta_regs: 200 }),
      dailyRollups: [
        rollup({ event_id: "e1", date: "2026-04-01", tickets_sold: 200 }),
        rollup({ event_id: "e2", date: "2026-04-15", tickets_sold: 300 }),
      ],
      events: [
        { id: "e1", event_code: "WC26-EXAMPLE" },
        { id: "e2", event_code: "WC26-EXAMPLE" },
      ],
      metaPurchasesByEventId: new Map([["e1", 70]]), // e2 absent
      offpixelAttributedPurchasesByEventId: new Map([
        ["e1", 50],
        ["e2", 30],
      ]),
    });
    // metaReportedPurchases = sum of present entries; absent
    // entries are skipped, not interpreted as nulls.
    assert.equal(m.metaReportedPurchases, 70);
    assert.equal(m.offpixelAttributedPurchases, 80);
  });
});

describe("sumCanonicalEventMetrics — real attribution aggregates", () => {
  it("recomputes ratios from aggregate numerator/denominator (not weighted avg)", () => {
    // Two children — one with high coverage, one with low.
    // Average of ratios would be misleading; the sum recomputes
    // from raw counts.
    const a = computeCanonicalEventMetrics({
      cacheRow: cache({ meta_regs: 100 }),
      dailyRollups: [
        rollup({ event_id: "e1", date: "2026-04-01", tickets_sold: 100 }),
      ],
      events: [{ id: "e1", event_code: "WC26-A" }],
      metaPurchasesByEventId: new Map([["e1", 90]]),
      offpixelAttributedPurchasesByEventId: new Map([["e1", 80]]),
    });
    const b = computeCanonicalEventMetrics({
      cacheRow: cache({ event_code: "WC26-B", meta_regs: 50 }),
      dailyRollups: [
        rollup({ event_id: "e2", date: "2026-04-01", tickets_sold: 1000 }),
      ],
      events: [{ id: "e2", event_code: "WC26-B" }],
      metaPurchasesByEventId: new Map([["e2", 10]]),
      offpixelAttributedPurchasesByEventId: new Map([["e2", 20]]),
    });
    const total = sumCanonicalEventMetrics([a, b]);

    assert.equal(total.metaReportedPurchases, 100); // 90+10
    assert.equal(total.offpixelAttributedPurchases, 100); // 80+20
    assert.equal(total.ticketsTrue, 1100); // 100+1000

    // Trust: 100/100 = 1.0 (green)
    assert.equal(total.attributionTrustRatio, 1.0);
    // Coverage: 100/1100 ≈ 9% (red)
    assert(total.attributionCoverageRatio != null);
    assert(total.attributionCoverageRatio! < 0.1);
  });

  it("zero-input array returns the dark-build defaults", () => {
    const total = sumCanonicalEventMetrics([]);
    assert.equal(total.metaReportedPurchases, null);
    assert.equal(total.offpixelAttributedPurchases, 0);
    assert.equal(total.attributionTrustRatio, null);
    assert.equal(total.attributionCoverageRatio, null);
  });
});
