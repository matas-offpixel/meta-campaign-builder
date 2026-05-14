/**
 * lib/insights/__tests__/decorate-canonical-lifetime-reach.test.ts
 *
 * Pinned regression tests for the venue insights route decorator
 * (PR #419, Bug 2 — Creative Insights +15.9% Manchester drift).
 *
 * Tests target the pure compute layer (`applyCanonicalLifetimeReach`
 * in `decorate-canonical-lifetime-reach-pure.ts`) so we don't have
 * to mock Supabase. The server-only wrapper that does the cache
 * round-trip is exercised in production via the routes; its only
 * job is `loadEventCodeLifetimeMetaCache` then delegate to the pure
 * helper here.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyCanonicalLifetimeReach } from "../decorate-canonical-lifetime-reach-pure.ts";
import type { EventCodeLifetimeMetaCacheRow } from "../../db/event-code-lifetime-meta-cache.ts";
import type {
  EventInsightsPayload,
  InsightsResult,
} from "../types.ts";

const FROZEN_NOW = "2026-05-14T22:00:00.000Z";

const MANCHESTER_CACHE: EventCodeLifetimeMetaCacheRow = {
  client_id: "c-4tf",
  event_code: "WC26-MANCHESTER",
  // PR #418 two-pass design — Joe's Meta UI ground-truth value.
  meta_reach: 805_473,
  meta_impressions: 1_500_000,
  meta_link_clicks: 12_500,
  meta_regs: 311,
  meta_video_plays_3s: 95_000,
  meta_video_plays_15s: 14_000,
  meta_video_plays_p100: 4_200,
  meta_engagements: 23_000,
  campaign_names: ["[WC26-MANCHESTER] BOFU", "[WC26-MANCHESTER] Presale"],
  fetched_at: FROZEN_NOW,
  created_at: FROZEN_NOW,
  updated_at: FROZEN_NOW,
};

function buildOkResult(reachSum: number): InsightsResult {
  // Minimal `EventInsightsPayload` shape — only the fields the
  // decorator reads / writes need to be present. Cast through
  // `unknown` for the rest since the test never inspects them.
  const totals: EventInsightsPayload["totals"] = {
    spend: 100,
    impressions: 500_000,
    reachSum,
    clicks: 1500,
    landingPageViews: 800,
    registrations: 50,
    purchases: 25,
    purchaseValue: 1250,
    roas: 12.5,
    cpm: 0.2,
    frequency: 1.86,
    cpr: 2,
    cplpv: 0.125,
    cpp: 4,
    videoPlays3s: 25_000,
    videoPlays15s: 5_000,
    videoPlaysP100: 1_500,
    engagements: 8_000,
  };
  const data = {
    totals,
    eventCode: "WC26-MANCHESTER",
    totalSpend: totals.spend,
  } as unknown as EventInsightsPayload;
  return { ok: true, data };
}

describe("applyCanonicalLifetimeReach — Bug 2 pin", () => {
  it("lifetime scope + cache hit ⇒ totals.reach set to deduped value (Manchester pin 805,473)", () => {
    const out = applyCanonicalLifetimeReach({
      result: buildOkResult(932_982 /* per-campaign sum, the bug shape */),
      cacheRow: MANCHESTER_CACHE,
      isLifetimeScope: true,
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(
      out.data.totals.reach,
      805_473,
      "decorator must surface the deduped lifetime cache reach as totals.reach",
    );
    assert.equal(
      out.data.totals.reachSource,
      "lifetime_cache_hit",
      "reachSource must signal cache_hit so the UI renders 'Reach' (no '(sum)')",
    );
    // `reachSum` is preserved untouched — other surfaces still need
    // it for the per-campaign tooltip / breakdown row.
    assert.equal(out.data.totals.reachSum, 932_982);
  });

  it("lifetime scope + cache miss ⇒ totals.reach=null, reachSource=lifetime_cache_miss", () => {
    const out = applyCanonicalLifetimeReach({
      result: buildOkResult(932_982),
      cacheRow: null,
      isLifetimeScope: true,
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.data.totals.reach, null);
    assert.equal(
      out.data.totals.reachSource,
      "lifetime_cache_miss",
      "cache miss must propagate so the UI renders '—' with the audit tooltip",
    );
    assert.equal(
      out.data.totals.reachSum,
      932_982,
      "reachSum is preserved on cache miss for the per-campaign breakdown",
    );
  });

  it("lifetime scope + cache row with NULL meta_reach ⇒ treated as cache miss", () => {
    // The cache row exists but the writer flagged reach as unknown
    // (e.g. Pass 2 returned no row and Pass 1 fallback was disabled).
    // The UI should still hard-fail rather than render "0".
    const out = applyCanonicalLifetimeReach({
      result: buildOkResult(932_982),
      cacheRow: { ...MANCHESTER_CACHE, meta_reach: null },
      isLifetimeScope: true,
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.data.totals.reach, null);
    assert.equal(out.data.totals.reachSource, "lifetime_cache_miss");
  });

  it("non-lifetime scope ⇒ reach=undefined, reachSource=non_lifetime_scope (cache row ignored)", () => {
    // `last_30d` etc. are windowed; the lifetime cache row doesn't
    // apply. The UI falls back to `reachSum` ("Reach (sum)") for
    // these windows — same behaviour as pre-PR-#419, scope-honest.
    const out = applyCanonicalLifetimeReach({
      result: buildOkResult(932_982),
      cacheRow: MANCHESTER_CACHE, // present but should be ignored
      isLifetimeScope: false,
    });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.data.totals.reach, undefined);
    assert.equal(out.data.totals.reachSource, "non_lifetime_scope");
    assert.equal(out.data.totals.reachSum, 932_982);
  });

  it("error result is passed through untouched on every branch", () => {
    const errResult: InsightsResult = {
      ok: false,
      error: { reason: "no_campaigns_matched", message: "no campaigns" },
    };
    for (const scope of [true, false]) {
      const out = applyCanonicalLifetimeReach({
        result: errResult,
        cacheRow: MANCHESTER_CACHE,
        isLifetimeScope: scope,
      });
      assert.deepEqual(out, errResult);
    }
  });
});

