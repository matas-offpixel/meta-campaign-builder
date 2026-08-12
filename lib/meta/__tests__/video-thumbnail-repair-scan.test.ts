/**
 * Tests for lib/meta/video-thumbnail-repair-scan.ts — the Meta-direct
 * detection pipeline behind scripts/repair-video-thumbnails.mjs.
 *
 * Root cause of the fix under test: the first repair attempt scanned
 * campaign_drafts.draft_json for creative.metaCreativeId +
 * asset.thumbnailUrl and found zero broken creatives, because
 * metaCreativeId is never written back to the draft after launch. This
 * module instead queries Meta directly:
 *   GET /{campaignId}/ads?fields=id,name,creative{id,object_story_spec}
 *   GET /{creativeId}?fields=object_story_spec        (fallback only)
 *   GET /{adAccountId}/adimages?hashes=["<hash>"]
 * and flags an ad as broken when the resolved image_hash URL is Meta's
 * placeholder/spinner (isMetaPlaceholderThumbnailUrl).
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import {
  extractVideoCreativeInfoFromSpec,
  fetchCampaignAds,
  fetchCreativeObjectStorySpec,
  resolveImageHashUrl,
  resolveVideoCreativeInfo,
  scanCampaignForBrokenVideoAds,
  findBrokenVideoAds,
  type MetaAdSummary,
  type VideoCreativeInfo,
} from "../video-thumbnail-repair-scan.ts";

// ─── fetch mock helpers ───────────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}

const SPINNER_URL = "https://static.xx.fbcdn.net/rsrc.php/v4/yN/r/AAqMW82PqGg.gif";
const REAL_THUMB_URL = "https://scontent.xx.fbcdn.net/v/t15.5256-10/thumb_real_frame.jpg";

// ─── extractVideoCreativeInfoFromSpec (pure) ─────────────────────────────────

describe("extractVideoCreativeInfoFromSpec", () => {
  it("extracts adId/creativeId/videoId/imageHash from a fully-expanded ad", () => {
    const ad: MetaAdSummary = {
      id: "ad_1",
      name: "Motion 1",
      creative: {
        id: "creative_1",
        object_story_spec: { video_data: { video_id: "vid_1", image_hash: "hash_1" } },
      },
    };
    const info = extractVideoCreativeInfoFromSpec(ad, ad.creative?.object_story_spec);
    assert.deepEqual(info, {
      adId: "ad_1",
      adName: "Motion 1",
      creativeId: "creative_1",
      videoId: "vid_1",
      imageHash: "hash_1",
    });
  });

  it("returns null when the ad has no creative", () => {
    const ad: MetaAdSummary = { id: "ad_2" };
    assert.equal(extractVideoCreativeInfoFromSpec(ad, undefined), null);
  });

  it("returns null for a non-video creative (no video_data)", () => {
    const ad: MetaAdSummary = { id: "ad_3", creative: { id: "creative_3", object_story_spec: {} } };
    assert.equal(extractVideoCreativeInfoFromSpec(ad, ad.creative?.object_story_spec), null);
  });

  it("returns null when video_data is missing image_hash (e.g. image_url-only creative)", () => {
    const ad: MetaAdSummary = {
      id: "ad_4",
      creative: { id: "creative_4", object_story_spec: { video_data: { video_id: "vid_4" } } },
    };
    assert.equal(extractVideoCreativeInfoFromSpec(ad, ad.creative?.object_story_spec), null);
  });
});

// ─── findBrokenVideoAds (pure) ────────────────────────────────────────────────

describe("findBrokenVideoAds", () => {
  it("flags only the info whose resolved URL is a placeholder", () => {
    const infos: VideoCreativeInfo[] = [
      { adId: "ad_1", creativeId: "c_1", videoId: "v_1", imageHash: "h_broken" },
      { adId: "ad_2", creativeId: "c_2", videoId: "v_2", imageHash: "h_ok" },
    ];
    const hashToUrl = new Map([
      ["h_broken", SPINNER_URL],
      ["h_ok", REAL_THUMB_URL],
    ]);
    const broken = findBrokenVideoAds(infos, hashToUrl);
    assert.equal(broken.length, 1);
    assert.equal(broken[0].adId, "ad_1");
    assert.equal(broken[0].placeholderUrl, SPINNER_URL);
  });

  it("skips infos whose hash never resolved to a URL", () => {
    const infos: VideoCreativeInfo[] = [{ adId: "ad_1", creativeId: "c_1", videoId: "v_1", imageHash: "h_unresolved" }];
    assert.deepEqual(findBrokenVideoAds(infos, new Map()), []);
  });
});

// ─── fetchCampaignAds ─────────────────────────────────────────────────────────

describe("fetchCampaignAds", () => {
  it("GETs /{campaignId}/ads with the expected fields + limit + token", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input) => {
      capturedUrl = urlOf(input);
      return jsonResponse({ data: [] });
    };

    await fetchCampaignAds("cmp_123", "tok_secret");
    assert.ok(capturedUrl.includes("/cmp_123/ads"), `expected campaign path — got ${capturedUrl}`);
    assert.ok(capturedUrl.includes("creative%7Bid%2Cobject_story_spec%7D") || capturedUrl.includes("creative{id,object_story_spec}"));
    assert.ok(capturedUrl.includes("limit=100"));
    assert.ok(capturedUrl.includes("tok_secret"));
  });

  it("returns all ads from a single page", async () => {
    globalThis.fetch = async () =>
      jsonResponse({
        data: [
          { id: "ad_1", name: "A", creative: { id: "c_1", object_story_spec: { video_data: { video_id: "v_1", image_hash: "h_1" } } } },
          { id: "ad_2", name: "B", creative: { id: "c_2", object_story_spec: { video_data: { video_id: "v_2", image_hash: "h_2" } } } },
        ],
      });

    const ads = await fetchCampaignAds("cmp_123", "tok");
    assert.equal(ads.length, 2);
    assert.equal(ads[0].id, "ad_1");
    assert.equal(ads[1].id, "ad_2");
  });

  it("follows pagination cursors across multiple pages", async () => {
    let call = 0;
    globalThis.fetch = async (input) => {
      call++;
      const url = urlOf(input);
      if (call === 1) {
        assert.ok(!url.includes("after="), "first call should not have an after cursor");
        return jsonResponse({
          data: [{ id: "ad_1", creative: { id: "c_1", object_story_spec: { video_data: { video_id: "v_1", image_hash: "h_1" } } } }],
          paging: { cursors: { after: "CURSOR_1" }, next: "https://graph.facebook.com/next-page" },
        });
      }
      assert.ok(url.includes("after=CURSOR_1"), `second call should carry the cursor — got ${url}`);
      return jsonResponse({
        data: [{ id: "ad_2", creative: { id: "c_2", object_story_spec: { video_data: { video_id: "v_2", image_hash: "h_2" } } } }],
        paging: { cursors: { after: "CURSOR_2" } },
      });
    };

    const ads = await fetchCampaignAds("cmp_123", "tok");
    assert.equal(call, 2);
    assert.deepEqual(ads.map((a) => a.id), ["ad_1", "ad_2"]);
  });

  it("throws with Meta's error message on a failed request", async () => {
    globalThis.fetch = async () => jsonResponse({ error: { message: "Invalid OAuth token" } }, 401);

    await assert.rejects(
      () => fetchCampaignAds("cmp_bad", "tok"),
      /Invalid OAuth token/,
    );
  });
});

// ─── fetchCreativeObjectStorySpec (fallback) ─────────────────────────────────

describe("fetchCreativeObjectStorySpec", () => {
  it("GETs /{creativeId}?fields=object_story_spec and returns the spec", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input) => {
      capturedUrl = urlOf(input);
      return jsonResponse({ object_story_spec: { video_data: { video_id: "v_1", image_hash: "h_1" } } });
    };

    const spec = await fetchCreativeObjectStorySpec("creative_1", "tok");
    assert.ok(capturedUrl.includes("/creative_1"));
    assert.ok(capturedUrl.includes("fields=object_story_spec"));
    assert.deepEqual(spec, { video_data: { video_id: "v_1", image_hash: "h_1" } });
  });

  it("throws on a Meta error response", async () => {
    globalThis.fetch = async () => jsonResponse({ error: { message: "Unsupported get request" } }, 400);
    await assert.rejects(() => fetchCreativeObjectStorySpec("creative_bad", "tok"), /Unsupported get request/);
  });
});

// ─── resolveImageHashUrl ──────────────────────────────────────────────────────

describe("resolveImageHashUrl", () => {
  it("GETs /{adAccountId}/adimages?hashes=[hash] with the act_ prefix and returns the URL", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input) => {
      capturedUrl = urlOf(input);
      return jsonResponse({ data: [{ hash: "h_1", url: REAL_THUMB_URL }] });
    };

    const url = await resolveImageHashUrl("123456", "h_1", "tok");
    assert.ok(capturedUrl.includes("/act_123456/adimages"), `expected act_ prefix — got ${capturedUrl}`);
    assert.ok(capturedUrl.includes("h_1"));
    assert.equal(url, REAL_THUMB_URL);
  });

  it("does not double-prefix an adAccountId that already has act_", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input) => {
      capturedUrl = urlOf(input);
      return jsonResponse({ data: [{ hash: "h_1", url: REAL_THUMB_URL }] });
    };
    await resolveImageHashUrl("act_123456", "h_1", "tok");
    assert.ok(capturedUrl.includes("/act_123456/adimages"));
    assert.ok(!capturedUrl.includes("act_act_"));
  });

  it("returns undefined when the hash isn't found in the response", async () => {
    globalThis.fetch = async () => jsonResponse({ data: [] });
    const url = await resolveImageHashUrl("123456", "h_missing", "tok");
    assert.equal(url, undefined);
  });

  it("throws on a Meta error response", async () => {
    globalThis.fetch = async () => jsonResponse({ error: { message: "Invalid parameter" } }, 400);
    await assert.rejects(() => resolveImageHashUrl("123456", "h_1", "tok"), /Invalid parameter/);
  });
});

// ─── resolveVideoCreativeInfo (with fallback) ────────────────────────────────

describe("resolveVideoCreativeInfo", () => {
  it("uses the inline object_story_spec when /ads already expanded it (no extra fetch)", async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      throw new Error("should not be called — spec already inline");
    };
    const ad: MetaAdSummary = {
      id: "ad_1",
      creative: { id: "c_1", object_story_spec: { video_data: { video_id: "v_1", image_hash: "h_1" } } },
    };
    const info = await resolveVideoCreativeInfo(ad, "tok");
    assert.equal(calls, 0);
    assert.deepEqual(info, { adId: "ad_1", adName: undefined, creativeId: "c_1", videoId: "v_1", imageHash: "h_1" });
  });

  it("falls back to fetchCreativeObjectStorySpec when the ad's spec wasn't expanded", async () => {
    let calls = 0;
    globalThis.fetch = async (input) => {
      calls++;
      const url = urlOf(input);
      assert.ok(url.includes("/c_1"), `fallback should fetch the creative — got ${url}`);
      return jsonResponse({ object_story_spec: { video_data: { video_id: "v_1", image_hash: "h_1" } } });
    };
    const ad: MetaAdSummary = { id: "ad_1", creative: { id: "c_1" } };
    const info = await resolveVideoCreativeInfo(ad, "tok");
    assert.equal(calls, 1);
    assert.equal(info?.videoId, "v_1");
  });

  it("returns null when the ad has no creative at all", async () => {
    const info = await resolveVideoCreativeInfo({ id: "ad_1" }, "tok");
    assert.equal(info, null);
  });
});

// ─── scanCampaignForBrokenVideoAds (end-to-end) ──────────────────────────────

describe("scanCampaignForBrokenVideoAds", () => {
  it("identifies broken ads across a full mocked GET /ads → GET /adimages pipeline", async () => {
    globalThis.fetch = async (input) => {
      const url = urlOf(input);
      if (url.includes("/cmp_1/ads")) {
        return jsonResponse({
          data: [
            {
              id: "ad_broken",
              name: "Motion 1",
              creative: { id: "creative_broken", object_story_spec: { video_data: { video_id: "vid_broken", image_hash: "hash_broken" } } },
            },
            {
              id: "ad_ok",
              name: "Motion 2",
              creative: { id: "creative_ok", object_story_spec: { video_data: { video_id: "vid_ok", image_hash: "hash_ok" } } },
            },
            {
              id: "ad_non_video",
              name: "Static 1",
              creative: { id: "creative_static", object_story_spec: {} },
            },
          ],
        });
      }
      if (url.includes("/adimages")) {
        if (url.includes("hash_broken")) return jsonResponse({ data: [{ hash: "hash_broken", url: SPINNER_URL }] });
        if (url.includes("hash_ok")) return jsonResponse({ data: [{ hash: "hash_ok", url: REAL_THUMB_URL }] });
        return jsonResponse({ data: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const broken = await scanCampaignForBrokenVideoAds("cmp_1", "999", "tok", { sleepMs: 0 });
    assert.equal(broken.length, 1);
    assert.equal(broken[0].adId, "ad_broken");
    assert.equal(broken[0].creativeId, "creative_broken");
    assert.equal(broken[0].videoId, "vid_broken");
    assert.equal(broken[0].placeholderUrl, SPINNER_URL);
  });

  it("returns an empty array when every video ad's thumbnail resolves to real content", async () => {
    globalThis.fetch = async (input) => {
      const url = urlOf(input);
      if (url.includes("/ads")) {
        return jsonResponse({
          data: [{ id: "ad_1", creative: { id: "c_1", object_story_spec: { video_data: { video_id: "v_1", image_hash: "h_1" } } } }],
        });
      }
      return jsonResponse({ data: [{ hash: "h_1", url: REAL_THUMB_URL }] });
    };

    const broken = await scanCampaignForBrokenVideoAds("cmp_2", "999", "tok", { sleepMs: 0 });
    assert.deepEqual(broken, []);
  });

  it("dedupes hash resolution when multiple ads share the same image_hash", async () => {
    let adimagesCalls = 0;
    globalThis.fetch = async (input) => {
      const url = urlOf(input);
      if (url.includes("/ads")) {
        return jsonResponse({
          data: [
            { id: "ad_1", creative: { id: "c_1", object_story_spec: { video_data: { video_id: "v_1", image_hash: "shared_hash" } } } },
            { id: "ad_2", creative: { id: "c_2", object_story_spec: { video_data: { video_id: "v_2", image_hash: "shared_hash" } } } },
          ],
        });
      }
      adimagesCalls++;
      return jsonResponse({ data: [{ hash: "shared_hash", url: SPINNER_URL }] });
    };

    const broken = await scanCampaignForBrokenVideoAds("cmp_3", "999", "tok", { sleepMs: 0 });
    assert.equal(adimagesCalls, 1, "should resolve the shared hash exactly once");
    assert.equal(broken.length, 2, "both ads sharing the broken hash should be flagged");
  });

  it("does not throw when one ad's creative fetch fails — continues scanning the rest", async () => {
    globalThis.fetch = async (input) => {
      const url = urlOf(input);
      if (url.includes("/ads")) {
        return jsonResponse({
          data: [
            { id: "ad_fail", creative: { id: "c_fail" } }, // needs fallback fetch, which will error
            { id: "ad_ok", creative: { id: "c_ok", object_story_spec: { video_data: { video_id: "v_ok", image_hash: "h_ok" } } } },
          ],
        });
      }
      if (url.includes("/c_fail")) return jsonResponse({ error: { message: "temporary failure" } }, 500);
      if (url.includes("/adimages")) return jsonResponse({ data: [{ hash: "h_ok", url: SPINNER_URL }] });
      throw new Error(`unexpected fetch: ${url}`);
    };

    const broken = await scanCampaignForBrokenVideoAds("cmp_4", "999", "tok", { sleepMs: 0 });
    assert.equal(broken.length, 1);
    assert.equal(broken[0].adId, "ad_ok");
  });
});
