/**
 * lib/reporting/active-creatives-dedup.test.ts
 *
 * node:test suite for the cross-campaign ad dedup helper. Pure
 * fixtures — see active-creatives-dedup.ts for the rationale
 * (PR #50: Meta's CONTAIN campaign-filter returns multiple
 * sibling campaigns for the same event_code, and the same ad_id
 * can appear once per matched campaign).
 *
 * Run with:
 *   node --experimental-strip-types --test lib/reporting/active-creatives-dedup.test.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { dedupAdsByAdId } from "./active-creatives-dedup.ts";
import {
  groupAdsByCreative,
  type AdInput,
} from "./active-creatives-group.ts";

function ad(overrides: Partial<AdInput>): AdInput {
  // Mirror of the factory in active-creatives-group.test.ts so
  // each test file can be edited in isolation. Insights default
  // to one purchase (omni_purchase) so the integration assertion
  // below has a clean per-ad number to multiply.
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
      actions: [{ action_type: "omni_purchase", value: 5 }],
    },
  };
  return { ...base, ...overrides };
}

test("dedupAdsByAdId: drops duplicates, first-seen wins, preserves order", () => {
  const a1 = ad({ ad_id: "ad-1", campaign_id: "camp-A" });
  const a2 = ad({ ad_id: "ad-2", campaign_id: "camp-A" });
  const a1Dup = ad({ ad_id: "ad-1", campaign_id: "camp-B" });
  const a3 = ad({ ad_id: "ad-3", campaign_id: "camp-B" });
  const a2Dup = ad({ ad_id: "ad-2", campaign_id: "camp-C" });

  const { kept, dropped } = dedupAdsByAdId([a1, a2, a1Dup, a3, a2Dup]);

  assert.equal(dropped, 2, "two duplicates should be dropped");
  assert.equal(kept.length, 3);
  assert.deepEqual(
    kept.map((a) => a.ad_id),
    ["ad-1", "ad-2", "ad-3"],
    "first-seen ad_id order preserved",
  );
  // First-seen wins → the campaign_id from the first occurrence
  // is retained, not the duplicate's.
  assert.equal(kept[0]?.campaign_id, "camp-A");
  assert.equal(kept[1]?.campaign_id, "camp-A");
  assert.equal(kept[2]?.campaign_id, "camp-B");
});

test("dedupAdsByAdId: no duplicates → identity passthrough", () => {
  const ads = [
    ad({ ad_id: "ad-1" }),
    ad({ ad_id: "ad-2" }),
    ad({ ad_id: "ad-3" }),
  ];
  const { kept, dropped } = dedupAdsByAdId(ads);
  assert.equal(dropped, 0);
  assert.equal(kept.length, 3);
  assert.deepEqual(
    kept.map((a) => a.ad_id),
    ["ad-1", "ad-2", "ad-3"],
  );
});

test("dedupAdsByAdId: empty input → empty output", () => {
  const { kept, dropped } = dedupAdsByAdId([]);
  assert.equal(dropped, 0);
  assert.equal(kept.length, 0);
});

test(
  "regression PR #50: cross-campaign duplicate ad_id does not double purchases " +
    "after groupAdsByCreative",
  () => {
    // Mimics the live failure: two sibling campaigns whose
    // event_code substring matches the same Junction 2 token
    // both return the same ad_id with identical insights
    // (Meta's /insights?level=ad payload is parameter-equivalent
    // across the URLs the ad belongs to). Without the dedup, the
    // grouper would sum 5 + 5 = 10 purchases.
    const adRowFromCampaignA = ad({
      ad_id: "ad-shared",
      campaign_id: "camp-A",
      campaign_name: "Junction 2 - Awareness",
      insights: {
        spend: 200,
        impressions: 5000,
        clicks: 100,
        reach: 4000,
        frequency: 1.25,
        actions: [{ action_type: "omni_purchase", value: 5 }],
      },
    });
    const adRowFromCampaignB = ad({
      ad_id: "ad-shared",
      campaign_id: "camp-B",
      campaign_name: "Junction 2 - Conversion",
      insights: {
        spend: 200,
        impressions: 5000,
        clicks: 100,
        reach: 4000,
        frequency: 1.25,
        actions: [{ action_type: "omni_purchase", value: 5 }],
      },
    });

    // Step 1: dedup → 1 row, 1 dropped
    const { kept, dropped } = dedupAdsByAdId([
      adRowFromCampaignA,
      adRowFromCampaignB,
    ]);
    assert.equal(dropped, 1, "one duplicate row dropped");
    assert.equal(kept.length, 1);

    // Step 2: feed into the existing grouper. Final purchases
    // should be 5 (the per-ad value), NOT 10 (which is what
    // pre-PR-#50 returned by summing both rows).
    const groups = groupAdsByCreative(kept);
    assert.equal(groups.length, 1);
    assert.equal(
      groups[0]?.purchases,
      5,
      "purchases should be 5 (per-ad), not 10 (pre-PR-#50 inflation)",
    );
    assert.equal(groups[0]?.spend, 200, "spend should not double either");
  },
);
