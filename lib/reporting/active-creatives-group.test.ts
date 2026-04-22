/**
 * lib/reporting/active-creatives-group.test.ts
 *
 * node:test suite for the pure grouping helper. No network, no
 * Supabase, no Meta — just hand-rolled fixtures so the math is
 * easy to eyeball when the test fails.
 *
 * Run with:
 *   node --test lib/reporting/active-creatives-group.test.ts
 *
 * The TS source is consumed via the project's existing TS-aware
 * Node loader (node:test picks up .ts via ts-node / tsx if either
 * is wired in package.json, otherwise the runner expects the file
 * to be transpiled separately). The repo already runs node:test
 * suites against .ts files elsewhere — see lib/enrichment/__tests__.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  groupAdsByCreative,
  type AdInput,
} from "./active-creatives-group.ts";

function ad(overrides: Partial<AdInput>): AdInput {
  // Sensible defaults via spread + override pattern. We can't use
  // `overrides.foo ?? default` here because callers need to pass
  // `null` explicitly for fields like `creative_id` and have it
  // survive — `null ?? "x"` would coerce back to "x" and the
  // dropped-creative test would silently misfire.
  const base: AdInput = {
    ad_id: "ad-x",
    ad_name: "Ad X",
    status: "ACTIVE",
    campaign_id: "camp-1",
    campaign_name: "Camp 1",
    adset_id: "adset-1",
    adset_name: "Adset 1",
    creative_id: "creative-A",
    creative_name: "Creative A",
    headline: "Headline",
    body: "Body text",
    thumbnail_url: "https://example.com/t.jpg",
    // PR #40: asset-signal grouping fields. Defaulted null here so
    // dedup/aggregation tests don't have to care about them; the
    // dedicated waterfall coverage lives in group-creatives.test.ts.
    effective_object_story_id: null,
    object_story_id: null,
    primary_asset_signature: null,
    preview: {
      image_url: null,
      video_id: null,
      instagram_permalink_url: null,
      headline: null,
      body: null,
      call_to_action_type: null,
      link_url: null,
    },
    insights: {
      spend: 100,
      impressions: 1000,
      clicks: 25,
      reach: 800,
      frequency: 1.25,
      actions: [],
    },
  };
  return { ...base, ...overrides };
}

test("dedup + aggregation: 3 ads sharing one creative across 2 ad sets", () => {
  // Three ads, all using creative-A. Two ad sets between them. Per-ad:
  //   ad-1 (adset-X): spend 60, impr 1000, clicks 30, reach 800,
  //                   actions [registrations 5, purchase 2]
  //   ad-2 (adset-X): spend 40, impr  500, clicks 10, reach 400,
  //                   actions [registrations 3]
  //   ad-3 (adset-Y): spend 30, impr  300, clicks  6, reach 250,
  //                   actions [purchase 1]
  //
  // Expected one row out:
  //   spend         130
  //   impressions  1800
  //   clicks         46
  //   reach        1450
  //   registrations   8
  //   purchases       3
  //   ctr           clicks/impr * 100  = 46/1800 * 100  = 2.5555…
  //   cpm           spend/impr * 1000  = 130/1800 * 1000 = 72.222…
  //   cpc           spend/clicks       = 130/46         = 2.8260…
  //   cpr           spend/registrations = 130/8         = 16.25
  //   cpp           spend/purchases    = 130/3          = 43.333…
  //   frequency     impr/reach         = 1800/1450      = 1.2413…
  //   ad_count      3
  //   adsets        [adset-X, adset-Y]
  //   representative_ad_id = ad-1 (top spend in the group)

  const ads: AdInput[] = [
    ad({
      ad_id: "ad-1",
      adset_id: "adset-X",
      adset_name: "Adset X",
      insights: {
        spend: 60,
        impressions: 1000,
        clicks: 30,
        reach: 800,
        frequency: 1.25,
        actions: [
          { action_type: "complete_registration", value: 5 },
          { action_type: "purchase", value: 2 },
        ],
      },
    }),
    ad({
      ad_id: "ad-2",
      adset_id: "adset-X",
      adset_name: "Adset X",
      insights: {
        spend: 40,
        impressions: 500,
        clicks: 10,
        reach: 400,
        frequency: 1.25,
        actions: [
          { action_type: "lead", value: 3 },
        ],
      },
    }),
    ad({
      ad_id: "ad-3",
      adset_id: "adset-Y",
      adset_name: "Adset Y",
      insights: {
        spend: 30,
        impressions: 300,
        clicks: 6,
        reach: 250,
        frequency: 1.2,
        actions: [
          { action_type: "omni_purchase", value: 1 },
        ],
      },
    }),
  ];

  const rows = groupAdsByCreative(ads);
  assert.equal(rows.length, 1, "expected one creative bucket");
  const r = rows[0];
  assert.equal(r.creative_id, "creative-A");
  assert.equal(r.ad_count, 3);
  assert.equal(r.spend, 130);
  assert.equal(r.impressions, 1800);
  assert.equal(r.clicks, 46);
  assert.equal(r.reach, 1450);
  assert.equal(r.registrations, 8);
  assert.equal(r.purchases, 3);

  // Rate metrics use weighted (ratio-of-sums) math, not avg-of-rates.
  assert.equal(round(r.ctr, 4), round((46 / 1800) * 100, 4));
  assert.equal(round(r.cpm, 4), round((130 / 1800) * 1000, 4));
  assert.equal(round(r.cpc, 4), round(130 / 46, 4));
  assert.equal(round(r.cpr, 4), round(130 / 8, 4));
  assert.equal(round(r.cpp, 4), round(130 / 3, 4));
  assert.equal(round(r.frequency, 4), round(1800 / 1450, 4));

  // Adset dedup — order preserved by insertion.
  const adsetIds = r.adsets.map((s) => s.id).sort();
  assert.deepEqual(adsetIds, ["adset-X", "adset-Y"]);

  // Representative ad = highest-spend ad (ad-1, £60).
  assert.equal(r.representative_ad_id, "ad-1");
});

test("split creatives: 4 ads across 2 creative_ids → 2 rows, sorted by spend DESC", () => {
  // creative-A: 2 ads, total spend 50
  // creative-B: 2 ads, total spend 200
  // Expect creative-B first (higher spend), then creative-A.

  const ads: AdInput[] = [
    ad({
      ad_id: "a-1",
      creative_id: "creative-A",
      insights: {
        spend: 30, impressions: 100, clicks: 5, reach: 80,
        frequency: 1.25, actions: [],
      },
    }),
    ad({
      ad_id: "a-2",
      creative_id: "creative-A",
      insights: {
        spend: 20, impressions: 80, clicks: 4, reach: 60,
        frequency: 1.33, actions: [],
      },
    }),
    ad({
      ad_id: "b-1",
      creative_id: "creative-B",
      insights: {
        spend: 120, impressions: 2000, clicks: 50, reach: 1500,
        frequency: 1.33, actions: [],
      },
    }),
    ad({
      ad_id: "b-2",
      creative_id: "creative-B",
      insights: {
        spend: 80, impressions: 1500, clicks: 30, reach: 1200,
        frequency: 1.25, actions: [],
      },
    }),
  ];

  const rows = groupAdsByCreative(ads);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].creative_id, "creative-B");
  assert.equal(rows[0].spend, 200);
  assert.equal(rows[0].ad_count, 2);
  assert.equal(rows[0].representative_ad_id, "b-1"); // higher spend in group
  assert.equal(rows[1].creative_id, "creative-A");
  assert.equal(rows[1].spend, 50);
  assert.equal(rows[1].ad_count, 2);
});

test("edge cases: null creative dropped, null insights → 0s, registrations=0 → cpr null", () => {
  const ads: AdInput[] = [
    // Dropped — no creative_id.
    ad({ ad_id: "drop-me", creative_id: null }),
    // Counts as a real ad in the bucket but contributes zero metrics.
    ad({
      ad_id: "null-insights",
      creative_id: "creative-Z",
      insights: null,
    }),
    // Same creative, has spend but zero registrations / purchases.
    ad({
      ad_id: "real",
      creative_id: "creative-Z",
      insights: {
        spend: 50,
        impressions: 1000,
        clicks: 10,
        reach: 800,
        frequency: 1.25,
        actions: [],
      },
    }),
  ];

  const rows = groupAdsByCreative(ads);
  assert.equal(rows.length, 1, "null-creative ad must not create a bucket");
  const r = rows[0];
  assert.equal(r.creative_id, "creative-Z");
  // Both surviving ads share the bucket — null-insights one contributes
  // zero, real one contributes its insights.
  assert.equal(r.ad_count, 2);
  assert.equal(r.spend, 50);
  assert.equal(r.impressions, 1000);
  assert.equal(r.clicks, 10);
  assert.equal(r.reach, 800);
  assert.equal(r.registrations, 0);
  assert.equal(r.purchases, 0);

  // Divide-by-zero guard — registrations=0 must yield null, not Infinity / NaN.
  assert.equal(r.cpr, null, "cpr with zero registrations must be null");
  assert.equal(r.cpp, null, "cpp with zero purchases must be null");

  // Sanity: the populated rate metrics should still be computed.
  assert.equal(round(r.ctr, 4), round((10 / 1000) * 100, 4));
  assert.equal(round(r.cpm, 4), round((50 / 1000) * 1000, 4));
});

function round(v: number | null, digits: number): number | null {
  if (v == null) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
