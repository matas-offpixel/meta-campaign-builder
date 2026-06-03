/**
 * lib/reporting/group-tiktok-creatives.test.ts
 *
 * node:test suite for the TikTok creative concept grouper.
 * No network, no Supabase — all fixtures are hand-rolled.
 *
 * Run with:
 *   node --test --experimental-strip-types \
 *     lib/reporting/group-tiktok-creatives.test.ts
 *
 * Coverage:
 *   1. extractVideoId — parses VideoID from TikTok CDN URLs
 *   2. normaliseTikTokAdName — strips dates, extensions, hash tokens
 *   3. Tier 1 (video_id) — same VideoID groups into one bucket
 *   4. Tier 2 (thumbnail) — same thumbnail path groups when no VideoID
 *   5. Tier 3 (name) — normalised ad_name groups across ad sets
 *   6. Tier 4 (ad_id fallback) — pure-date names → individual cards
 *   7. Metric summing — spend, impressions, reach, clicks are summed
 *   8. Rate recomputation — CTR/CPM from sums, not averaged
 *   9. Representative thumbnail — highest-spend ad's thumbnail wins
 *  10. Sort order — output sorted by spend DESC
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractVideoId,
  normaliseTikTokAdName,
  groupTikTokCreatives,
  type TikTokCreativeInput,
} from "./group-tiktok-creatives.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────

const BASE_URL =
  "http://p16-common-sign.tiktokcdn.com/tos-alisg-p-0051/thumb.image";

function makeAd(
  overrides: Partial<TikTokCreativeInput> & { ad_id: string },
): TikTokCreativeInput {
  return {
    ad_name: overrides.ad_id,
    campaign_id: null,
    campaign_name: null,
    spend: 100,
    impressions: 10000,
    reach: 9000,
    clicks: 50,
    video_views_2s: 1000,
    video_views_6s: 400,
    video_views_100p: 50,
    thumbnail_url: null,
    deeplink_url: null,
    ...overrides,
  };
}

function withVideoId(videoId: string): Partial<TikTokCreativeInput> {
  return {
    thumbnail_url: `${BASE_URL}?x-expires=99999&VideoID=${videoId}`,
  };
}

// ─── extractVideoId ────────────────────────────────────────────────────────

describe("extractVideoId", () => {
  it("extracts VideoID from TikTok CDN URL", () => {
    const url =
      "http://p16.tiktokcdn.com/thumb.image?dr=18692&x-expires=99&VideoID=v10033g500abc";
    assert.equal(extractVideoId(url), "v10033g500abc");
  });

  it("returns null for URL without VideoID", () => {
    assert.equal(extractVideoId("https://example.com/image.jpg"), null);
  });

  it("returns null for null input", () => {
    assert.equal(extractVideoId(null), null);
  });

  it("is case-insensitive for VideoID parameter name", () => {
    const url = `${BASE_URL}?videoid=vABC`;
    assert.equal(extractVideoId(url), "vABC");
  });
});

// ─── normaliseTikTokAdName ────────────────────────────────────────────────

describe("normaliseTikTokAdName", () => {
  it("strips trailing ISO date stamp", () => {
    assert.equal(
      normaliseTikTokAdName("AMAAD EDIT_2026-05-27"),
      "amaad edit",
    );
  });

  it("strips trailing date with time component", () => {
    assert.equal(
      normaliseTikTokAdName("AMAAD_EDIT 5_VHS_LdEMKpkc.mp4_2026-05-27 19:26:22"),
      "amaad edit 5 vhs",
    );
  });

  it("strips file extension before date", () => {
    assert.equal(normaliseTikTokAdName("VID_FINAL.mp4"), "vid final");
  });

  it("strips trailing hash token (≥6 alphanumeric chars after separator)", () => {
    assert.equal(normaliseTikTokAdName("Creative_abc12345"), "creative");
  });

  it("returns empty string for pure date name", () => {
    assert.equal(normaliseTikTokAdName("2026-05-27 19:26:22"), "");
  });

  it("preserves meaningful short names", () => {
    assert.equal(normaliseTikTokAdName("VID 2"), "vid 2");
  });

  it("returns empty string for null input", () => {
    assert.equal(normaliseTikTokAdName(null), "");
  });

  it("lowercases the result", () => {
    assert.equal(normaliseTikTokAdName("VID 3"), "vid 3");
  });
});

// ─── groupTikTokCreatives — tier 1 (video_id) ────────────────────────────

describe("groupTikTokCreatives — Tier 1: VideoID grouping", () => {
  it("groups 4 ads with same VideoID into 1 card", () => {
    const videoId = "v10033g500abc";
    const rows = [
      makeAd({ ad_id: "a1", ad_name: "VID 1", spend: 50, ...withVideoId(videoId) }),
      makeAd({ ad_id: "a2", ad_name: "VID 1 v2", spend: 40, ...withVideoId(videoId) }),
      makeAd({ ad_id: "a3", ad_name: "VID 1", spend: 30, ...withVideoId(videoId) }),
      makeAd({ ad_id: "a4", ad_name: null, spend: 20, ...withVideoId(videoId) }),
    ];
    const groups = groupTikTokCreatives(rows);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].ad_count, 4);
    assert.equal(groups[0].spend, 140);
    assert.equal(groups[0].group_key, `video:${videoId}`);
  });

  it("ads with different VideoIDs produce separate cards", () => {
    const rows = [
      makeAd({ ad_id: "a1", ...withVideoId("vid_A") }),
      makeAd({ ad_id: "a2", ...withVideoId("vid_B") }),
    ];
    const groups = groupTikTokCreatives(rows);
    assert.equal(groups.length, 2);
  });
});

// ─── groupTikTokCreatives — tier 2 (thumbnail path) ──────────────────────

describe("groupTikTokCreatives — Tier 2: thumbnail path grouping", () => {
  it("groups ads sharing thumbnail path (different query strings)", () => {
    const path = "http://cdn.tiktok.com/thumb/hash_abc.image";
    const rows = [
      makeAd({
        ad_id: "a1",
        ad_name: "unique_name_1234567890",
        thumbnail_url: `${path}?token=AAA&x-expires=111`,
      }),
      makeAd({
        ad_id: "a2",
        ad_name: "different_name_9876543210",
        thumbnail_url: `${path}?token=BBB&x-expires=222`,
      }),
    ];
    const groups = groupTikTokCreatives(rows);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].ad_count, 2);
  });
});

// ─── groupTikTokCreatives — tier 3 (name) ────────────────────────────────

describe("groupTikTokCreatives — Tier 3: ad_name grouping", () => {
  it("groups ads with same ad_name (no thumbnail)", () => {
    const rows = [
      makeAd({ ad_id: "a1", ad_name: "VID 2", thumbnail_url: null }),
      makeAd({ ad_id: "a2", ad_name: "VID 2", thumbnail_url: null }),
    ];
    const groups = groupTikTokCreatives(rows);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].ad_count, 2);
    assert.equal(groups[0].display_name, "VID 2");
  });

  it("different ad names produce separate cards", () => {
    const rows = [
      makeAd({ ad_id: "a1", ad_name: "VID 2", thumbnail_url: null }),
      makeAd({ ad_id: "a2", ad_name: "VID 3", thumbnail_url: null }),
    ];
    const groups = groupTikTokCreatives(rows);
    assert.equal(groups.length, 2);
  });

  it("strips date suffix before name comparison", () => {
    const rows = [
      makeAd({ ad_id: "a1", ad_name: "EDIT_A_2026-05-01", thumbnail_url: null }),
      makeAd({ ad_id: "a2", ad_name: "EDIT_A_2026-06-01", thumbnail_url: null }),
    ];
    const groups = groupTikTokCreatives(rows);
    assert.equal(groups.length, 1);
  });
});

// ─── groupTikTokCreatives — tier 4 (ad_id fallback) ──────────────────────

describe("groupTikTokCreatives — Tier 4: ad_id fallback", () => {
  it("pure date name falls through to ad_id tier (no thumbnail)", () => {
    const rows = [
      makeAd({ ad_id: "x1", ad_name: "2026-05-27 19:26:22", thumbnail_url: null }),
      makeAd({ ad_id: "x2", ad_name: "2026-05-28 10:00:00", thumbnail_url: null }),
    ];
    const groups = groupTikTokCreatives(rows);
    assert.equal(groups.length, 2);
    assert.ok(groups.every((g) => g.group_key.startsWith("id:")));
  });
});

// ─── Metric summing + rate recomputation ──────────────────────────────────

describe("groupTikTokCreatives — metrics", () => {
  it("sums spend, impressions, reach, clicks across group", () => {
    const rows = [
      makeAd({ ad_id: "a1", ad_name: "VID 1", spend: 100, impressions: 10000, reach: 9000, clicks: 50, thumbnail_url: null }),
      makeAd({ ad_id: "a2", ad_name: "VID 1", spend: 200, impressions: 20000, reach: 18000, clicks: 80, thumbnail_url: null }),
    ];
    const [g] = groupTikTokCreatives(rows);
    assert.equal(g.spend, 300);
    assert.equal(g.impressions, 30000);
    assert.equal(g.reach, 27000);
    assert.equal(g.clicks, 130);
  });

  it("recomputes CTR from sums (ratio of sums, not average of rates)", () => {
    // Row A: 100 clicks / 10000 impr
    // Row B: 300 clicks / 90000 impr
    // correct aggregate = 400/100000*100 = 0.4%
    const rows = [
      makeAd({ ad_id: "a1", ad_name: "VID 2", impressions: 10000, clicks: 100, thumbnail_url: null }),
      makeAd({ ad_id: "a2", ad_name: "VID 2", impressions: 90000, clicks: 300, thumbnail_url: null }),
    ];
    const [g] = groupTikTokCreatives(rows);
    const expected = (400 / 100000) * 100;
    assert.ok(Math.abs((g.ctr ?? 0) - expected) < 0.001);
  });

  it("CTR is null when impressions are zero", () => {
    const rows = [makeAd({ ad_id: "z1", ad_name: "VID ZERO", impressions: 0, clicks: 0, thumbnail_url: null })];
    const [g] = groupTikTokCreatives(rows);
    assert.equal(g.ctr, null);
  });

  it("sums video views across group", () => {
    const rows = [
      makeAd({ ad_id: "v1", ad_name: "VID CLIP", video_views_2s: 1000, video_views_6s: 400, video_views_100p: 50, thumbnail_url: null }),
      makeAd({ ad_id: "v2", ad_name: "VID CLIP", video_views_2s: 2000, video_views_6s: 800, video_views_100p: 100, thumbnail_url: null }),
    ];
    const [g] = groupTikTokCreatives(rows);
    assert.equal(g.video_views_2s, 3000);
    assert.equal(g.video_views_6s, 1200);
    assert.equal(g.video_views_100p, 150);
  });

  it("cost_per_video_play = spend / video_views_2s", () => {
    const rows = [
      makeAd({ ad_id: "c1", ad_name: "VID COST", spend: 50, video_views_2s: 1000, thumbnail_url: null }),
      makeAd({ ad_id: "c2", ad_name: "VID COST", spend: 50, video_views_2s: 1000, thumbnail_url: null }),
    ];
    const [g] = groupTikTokCreatives(rows);
    assert.ok(Math.abs((g.cost_per_video_play ?? 0) - 0.05) < 0.001);
  });
});

// ─── Thumbnail representative ─────────────────────────────────────────────

describe("groupTikTokCreatives — representative thumbnail", () => {
  it("picks thumbnail from highest-spend ad in group", () => {
    const highSpendThumb = `${BASE_URL}?VideoID=vid1&high=1`;
    const lowSpendThumb = `${BASE_URL}?VideoID=vid1&low=1`;
    const rows = [
      makeAd({ ad_id: "a1", spend: 200, thumbnail_url: highSpendThumb }),
      makeAd({ ad_id: "a2", spend: 50, thumbnail_url: lowSpendThumb }),
    ];
    const [g] = groupTikTokCreatives(rows);
    // Both have VideoID vid1, so they group. Thumbnail = highest-spend = highSpendThumb
    assert.equal(g.thumbnail_url, highSpendThumb);
  });

  it("uses thumbnail from any ad when highest-spend ad lacks thumbnail", () => {
    const thumb = `${BASE_URL}?VideoID=vid2`;
    const rows = [
      makeAd({ ad_id: "a1", spend: 200, thumbnail_url: null, ...withVideoId("vid2") }),
      makeAd({ ad_id: "a2", spend: 50, thumbnail_url: thumb.replace(/\?.*$/, "?VideoID=vid2") }),
    ];
    const [g] = groupTikTokCreatives(rows);
    assert.notEqual(g.thumbnail_url, null);
  });
});

// ─── Sort order ───────────────────────────────────────────────────────────

describe("groupTikTokCreatives — sort order", () => {
  it("sorts output by spend descending", () => {
    const rows = [
      makeAd({ ad_id: "a1", ad_name: "LOW", spend: 10, thumbnail_url: null }),
      makeAd({ ad_id: "a2", ad_name: "HIGH", spend: 999, thumbnail_url: null }),
      makeAd({ ad_id: "a3", ad_name: "MID", spend: 500, thumbnail_url: null }),
    ];
    const groups = groupTikTokCreatives(rows);
    assert.deepEqual(
      groups.map((g) => g.display_name),
      ["HIGH", "MID", "LOW"],
    );
  });
});

// ─── Campaign count ───────────────────────────────────────────────────────

describe("groupTikTokCreatives — campaign count", () => {
  it("deduplicates campaigns within a group", () => {
    const rows = [
      makeAd({ ad_id: "a1", ad_name: "VID 1", campaign_id: "c1", campaign_name: "Campaign A", thumbnail_url: null }),
      makeAd({ ad_id: "a2", ad_name: "VID 1", campaign_id: "c1", campaign_name: "Campaign A", thumbnail_url: null }),
      makeAd({ ad_id: "a3", ad_name: "VID 1", campaign_id: "c2", campaign_name: "Campaign B", thumbnail_url: null }),
    ];
    const [g] = groupTikTokCreatives(rows);
    assert.equal(g.campaign_count, 2);
    assert.ok(g.campaign_names.includes("Campaign A"));
    assert.ok(g.campaign_names.includes("Campaign B"));
  });
});
