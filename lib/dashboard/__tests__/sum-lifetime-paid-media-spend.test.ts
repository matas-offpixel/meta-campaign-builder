import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { sumLifetimePaidMediaSpend } from "../sum-lifetime-paid-media-spend.ts";
import type { DailyRollupRow } from "../../db/client-portal-server.ts";

function row(overrides: Partial<DailyRollupRow>): DailyRollupRow {
  return {
    event_id: "evt-1",
    date: "2026-04-01",
    tickets_sold: null,
    ad_spend: null,
    tiktok_spend: null,
    google_ads_spend: null,
    ad_spend_allocated: null,
    revenue: null,
    link_clicks: null,
    meta_regs: null,
    tiktok_clicks: null,
    ad_spend_specific: null,
    ad_spend_generic_share: null,
    ad_spend_presale: null,
    ...overrides,
  };
}

describe("sumLifetimePaidMediaSpend", () => {
  it("sums Meta + TikTok + Google Ads — the BB26-KAYODE regression", () => {
    // BB26-KAYODE: Meta £100, TikTok £160, Google £140 across one day.
    // Old buggy code returned £100; correct answer is £400.
    const rollups = [
      row({
        ad_spend: 100,
        tiktok_spend: 160,
        google_ads_spend: 140,
      }),
    ];
    assert.equal(sumLifetimePaidMediaSpend(rollups, false), 400);
  });

  it("multi-event venue: TikTok + Google still counted when Meta allocator has not run", () => {
    // isMultiEventVenue=true AND ad_spend_allocated/_presale both null:
    // Meta contribution should be null (skipped), but TikTok + Google must
    // still be included in the total.
    const rollups = [
      row({
        ad_spend: 999, // raw venue-wide value — must NOT be counted
        ad_spend_allocated: null,
        ad_spend_presale: null,
        tiktok_spend: 160,
        google_ads_spend: 140,
      }),
    ];
    assert.equal(sumLifetimePaidMediaSpend(rollups, true), 300);
  });

  it("single-platform (Meta only) row sums correctly — single-platform regression", () => {
    const rollups = [row({ ad_spend: 177, tiktok_spend: null, google_ads_spend: null })];
    assert.equal(sumLifetimePaidMediaSpend(rollups, false), 177);
  });

  it("row with google_ads_spend undefined (older event) does not NaN", () => {
    const r = row({ ad_spend: 50, tiktok_spend: 30 });
    // Simulate pre-migration row where the column isn't present
    delete (r as Partial<DailyRollupRow>).google_ads_spend;
    const result = sumLifetimePaidMediaSpend([r as DailyRollupRow], false);
    assert.ok(Number.isFinite(result), `expected finite number, got ${result}`);
    assert.equal(result, 80);
  });

  it("prefers ad_spend_allocated + presale over raw ad_spend when allocator has run", () => {
    const rollups = [
      row({
        ad_spend: 999,
        ad_spend_allocated: 100,
        ad_spend_presale: 20,
        tiktok_spend: 60,
        google_ads_spend: 40,
      }),
    ];
    // Meta = 100 + 20 = 120, TikTok = 60, Google = 40 → 220
    assert.equal(sumLifetimePaidMediaSpend(rollups, true), 220);
  });

  it("returns 0 for empty rollup array", () => {
    assert.equal(sumLifetimePaidMediaSpend([], false), 0);
  });
});
