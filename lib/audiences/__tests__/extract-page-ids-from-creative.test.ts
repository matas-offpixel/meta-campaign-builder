import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractPageIdsFromCreative } from "../extract-page-ids-from-creative.ts";

// ──────────────────────────────────────────────────────────────────────
// extract-page-ids-from-creative — covers the three creative shapes
// PR #391 wired up for `walkCampaignAds` in lib/audiences/sources.ts.
// The snapshot writer in lib/reporting/active-creatives-fetch.ts
// MUST resolve the owning Page id from the same shapes, otherwise
// snapshot rows ship missing the `context_page_id` that
// `audience-payload.ts`'s video_views branch needs.
// ──────────────────────────────────────────────────────────────────────

describe("extractPageIdsFromCreative — standard shape", () => {
  it("returns object_story_spec.page_id when present", () => {
    const ids = extractPageIdsFromCreative({
      object_story_spec: { page_id: "111", video_data: { video_id: "v1" } },
    });
    assert.deepEqual(ids, ["111"]);
  });

  it("returns empty when nothing matches", () => {
    assert.deepEqual(extractPageIdsFromCreative({}), []);
    assert.deepEqual(extractPageIdsFromCreative(null), []);
    assert.deepEqual(extractPageIdsFromCreative(undefined), []);
  });

  it("ignores non-string page_id values", () => {
    assert.deepEqual(
      extractPageIdsFromCreative({
        object_story_spec: { page_id: 12345 },
      }),
      [],
    );
  });
});

describe("extractPageIdsFromCreative — platform_customizations (Advantage+)", () => {
  it("collects facebook + instagram page ids", () => {
    const ids = extractPageIdsFromCreative({
      platform_customizations: {
        facebook: { page_id: "222" },
        instagram: { page_id: "333" },
      },
    });
    assert.deepEqual(ids, ["222", "333"]);
  });

  it("skips other platforms entirely", () => {
    // Hypothetical future platform key — we deliberately only walk
    // facebook + instagram, mirroring sources.ts walkCampaignAds.
    const ids = extractPageIdsFromCreative({
      platform_customizations: {
        facebook: { page_id: "fb-page" },
        twitter: { page_id: "should-be-ignored" },
      },
    });
    assert.deepEqual(ids, ["fb-page"]);
  });

  it("ignores non-string page_id inside platform block", () => {
    const ids = extractPageIdsFromCreative({
      platform_customizations: {
        facebook: { page_id: null },
        instagram: { page_id: "ig" },
      },
    });
    assert.deepEqual(ids, ["ig"]);
  });
});

describe("extractPageIdsFromCreative — asset_feed_spec", () => {
  it("collects all string page_ids from array", () => {
    const ids = extractPageIdsFromCreative({
      asset_feed_spec: { page_ids: ["a", "b", "c"] },
    });
    assert.deepEqual(ids, ["a", "b", "c"]);
  });

  it("filters non-string / empty entries", () => {
    const ids = extractPageIdsFromCreative({
      asset_feed_spec: { page_ids: ["valid", "", null, 42, "alsoValid"] },
    });
    assert.deepEqual(ids, ["valid", "alsoValid"]);
  });
});

describe("extractPageIdsFromCreative — combined shapes", () => {
  it("returns OSS first, then platform_customizations, then asset_feed_spec", () => {
    const ids = extractPageIdsFromCreative({
      object_story_spec: { page_id: "oss-page" },
      platform_customizations: {
        facebook: { page_id: "fb-page" },
        instagram: { page_id: "ig-page" },
      },
      asset_feed_spec: { page_ids: ["afs-1", "afs-2"] },
    });
    assert.deepEqual(ids, [
      "oss-page",
      "fb-page",
      "ig-page",
      "afs-1",
      "afs-2",
    ]);
  });

  it("preserves duplicates across shapes (caller dedupes if desired)", () => {
    // Some accounts surface the same page id twice — once on OSS
    // and once on asset_feed_spec. We keep duplicates so callers
    // counting most-common can weight the obviously-correct one.
    const ids = extractPageIdsFromCreative({
      object_story_spec: { page_id: "111" },
      asset_feed_spec: { page_ids: ["111", "222"] },
    });
    assert.deepEqual(ids, ["111", "111", "222"]);
  });
});
