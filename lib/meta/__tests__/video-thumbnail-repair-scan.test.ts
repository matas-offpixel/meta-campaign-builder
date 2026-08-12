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
 *   GET /{adAccountId}/adimages?hashes=["<hash>"]&fields=hash,url,width,height,name
 * and flags an ad as broken by fingerprinting the RESOLVED IMAGE (dimensions/
 * format/size via isMetaPlaceholderThumbnailImage), not its URL — task #128
 * continued found that isMetaPlaceholderThumbnailUrl (a URL/host classifier)
 * never fires post-upload, because /adimages resolves the spinner to an
 * ad-account-scoped scontent*.fbcdn.net URL indistinguishable by host/path
 * from a real thumbnail. See the module doc comment for the full story.
 */

import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";

import {
  extractVideoCreativeInfoFromSpec,
  fetchCampaignAds,
  fetchCampaignAccountId,
  fetchContentLength,
  fetchCreativeObjectStorySpec,
  filterAdsByCreatedTime,
  resolveImageHashMetadata,
  resolveVideoCreativeInfo,
  scanCampaignForBrokenVideoAds,
  findBrokenVideoAds,
  DEFAULT_BUG_INTRODUCED_AT,
  DEFAULT_MAX_ADS_PER_CAMPAIGN,
  type MetaAdSummary,
  type MetaAdImageFingerprint,
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

function headResponse(contentLength: number | undefined, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-length" && contentLength !== undefined ? String(contentLength) : null),
    },
    json: async () => ({}),
  } as unknown as Response;
}

function urlOf(input: Parameters<typeof fetch>[0]): string {
  return input instanceof Request ? input.url : String(input);
}

function isHead(init: Parameters<typeof fetch>[1] | undefined): boolean {
  return (init as RequestInit | undefined)?.method === "HEAD";
}

// Task #128 continued reproducer: the spinner survives upload as a tiny GIF;
// a real thumbnail is a large JPG at video dimensions. `REAL_IMAGE_METADATA`
// deliberately omits contentLengthBytes (Meta's /adimages response doesn't
// carry it) so tests exercise the fetchContentLength HEAD fallback the same
// way scanCampaignForBrokenVideoAds does in production.
const BROKEN_IMAGE_URL = "https://scontent.xx.fbcdn.net/v/t45.1600-4/ADXYZ_spinner.gif";
const REAL_THUMB_URL = "https://scontent.xx.fbcdn.net/v/t15.5256-10/thumb_real_frame.jpg";
const BROKEN_IMAGE_METADATA: MetaAdImageFingerprint = { url: BROKEN_IMAGE_URL, width: 16, height: 16, name: "AAqMW82PqGg.gif" };
const REAL_IMAGE_METADATA: MetaAdImageFingerprint = { url: REAL_THUMB_URL, width: 1080, height: 1080, name: "real-thumbnail.jpg" };
const REAL_CONTENT_LENGTH = 32000;

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
  it("flags only the info whose resolved image fingerprint is the placeholder (task #128 continued classifier)", () => {
    const infos: VideoCreativeInfo[] = [
      { adId: "ad_1", creativeId: "c_1", videoId: "v_1", imageHash: "h_broken" },
      { adId: "ad_2", creativeId: "c_2", videoId: "v_2", imageHash: "h_ok" },
    ];
    const hashToFingerprint = new Map([
      ["h_broken", BROKEN_IMAGE_METADATA],
      ["h_ok", REAL_IMAGE_METADATA],
    ]);
    const broken = findBrokenVideoAds(infos, hashToFingerprint);
    assert.equal(broken.length, 1);
    assert.equal(broken[0].adId, "ad_1");
    assert.equal(broken[0].placeholderUrl, BROKEN_IMAGE_URL);
    assert.deepEqual(broken[0].fingerprint, BROKEN_IMAGE_METADATA);
  });

  it("skips infos whose hash never resolved to a fingerprint", () => {
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

// ─── filterAdsByCreatedTime (pure — over-scan guard) ─────────────────────────

describe("filterAdsByCreatedTime", () => {
  it("drops ads created before the bug-introduced date and keeps ones on/after it", () => {
    const ads: MetaAdSummary[] = [
      { id: "ad_old", created_time: "2026-07-15T10:00:00+0000" },
      { id: "ad_new", created_time: "2026-08-10T10:00:00+0000" },
      { id: "ad_exact_cutoff", created_time: DEFAULT_BUG_INTRODUCED_AT },
    ];
    const { kept, skippedCount } = filterAdsByCreatedTime(ads);
    assert.equal(skippedCount, 1);
    assert.deepEqual(kept.map((a) => a.id), ["ad_new", "ad_exact_cutoff"]);
  });

  it("uses DEFAULT_BUG_INTRODUCED_AT (2026-08-07) as the default cutoff", () => {
    assert.equal(DEFAULT_BUG_INTRODUCED_AT, "2026-08-07T00:00:00+00:00");
  });

  it("respects a custom bugIntroducedAt cutoff", () => {
    const ads: MetaAdSummary[] = [
      { id: "ad_1", created_time: "2026-01-01T00:00:00+0000" },
      { id: "ad_2", created_time: "2026-06-01T00:00:00+0000" },
    ];
    const { kept, skippedCount } = filterAdsByCreatedTime(ads, "2026-03-01T00:00:00+00:00");
    assert.equal(skippedCount, 1);
    assert.deepEqual(kept.map((a) => a.id), ["ad_2"]);
  });

  it("conservatively keeps ads with a missing created_time (doesn't silently drop them)", () => {
    const ads: MetaAdSummary[] = [{ id: "ad_no_date" }];
    const { kept, skippedCount } = filterAdsByCreatedTime(ads);
    assert.equal(skippedCount, 0);
    assert.deepEqual(kept.map((a) => a.id), ["ad_no_date"]);
  });

  it("returns skippedCount=0 and kept=[] for an empty input", () => {
    assert.deepEqual(filterAdsByCreatedTime([]), { kept: [], skippedCount: 0 });
  });
});

// ─── fetchCampaignAccountId (--campaign-ids targeted mode) ───────────────────

describe("fetchCampaignAccountId", () => {
  it("GETs /{campaignId}?fields=account_id,name and returns both", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input) => {
      capturedUrl = urlOf(input);
      return jsonResponse({ account_id: "999888777", name: "IPC Newcastle v3" });
    };

    const result = await fetchCampaignAccountId("cmp_123", "tok");
    assert.ok(capturedUrl.includes("/cmp_123"));
    assert.ok(capturedUrl.includes("fields=account_id%2Cname") || capturedUrl.includes("fields=account_id,name"));
    assert.deepEqual(result, { adAccountId: "999888777", campaignName: "IPC Newcastle v3" });
  });

  it("throws on a Meta error response", async () => {
    globalThis.fetch = async () => jsonResponse({ error: { message: "Unsupported get request" } }, 400);
    await assert.rejects(() => fetchCampaignAccountId("cmp_bad", "tok"), /Unsupported get request/);
  });

  it("throws when the response has no account_id", async () => {
    globalThis.fetch = async () => jsonResponse({ name: "No account" });
    await assert.rejects(() => fetchCampaignAccountId("cmp_weird", "tok"), /no account_id/);
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

// ─── resolveImageHashMetadata ─────────────────────────────────────────────────

describe("resolveImageHashMetadata", () => {
  it("GETs /{adAccountId}/adimages?hashes=[hash] with the act_ prefix and the expanded fields, returning the full fingerprint", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input) => {
      capturedUrl = urlOf(input);
      return jsonResponse({ data: [{ hash: "h_1", url: REAL_THUMB_URL, width: 1080, height: 1080, name: "real-thumbnail.jpg" }] });
    };

    const metadata = await resolveImageHashMetadata("123456", "h_1", "tok");
    assert.ok(capturedUrl.includes("/act_123456/adimages"), `expected act_ prefix — got ${capturedUrl}`);
    assert.ok(capturedUrl.includes("h_1"));
    assert.ok(
      capturedUrl.includes("fields=hash%2Curl%2Cwidth%2Cheight%2Cname") || capturedUrl.includes("fields=hash,url,width,height,name"),
      `expected the expanded fields list — got ${capturedUrl}`,
    );
    assert.deepEqual(metadata, { url: REAL_THUMB_URL, width: 1080, height: 1080, name: "real-thumbnail.jpg" });
  });

  it("does not double-prefix an adAccountId that already has act_", async () => {
    let capturedUrl = "";
    globalThis.fetch = async (input) => {
      capturedUrl = urlOf(input);
      return jsonResponse({ data: [{ hash: "h_1", url: REAL_THUMB_URL }] });
    };
    await resolveImageHashMetadata("act_123456", "h_1", "tok");
    assert.ok(capturedUrl.includes("/act_123456/adimages"));
    assert.ok(!capturedUrl.includes("act_act_"));
  });

  it("returns undefined when the hash isn't found in the response", async () => {
    globalThis.fetch = async () => jsonResponse({ data: [] });
    const metadata = await resolveImageHashMetadata("123456", "h_missing", "tok");
    assert.equal(metadata, undefined);
  });

  it("throws on a Meta error response", async () => {
    globalThis.fetch = async () => jsonResponse({ error: { message: "Invalid parameter" } }, 400);
    await assert.rejects(() => resolveImageHashMetadata("123456", "h_1", "tok"), /Invalid parameter/);
  });
});

// ─── fetchContentLength (task #128 continued — HEAD fallback signal) ────────

describe("fetchContentLength", () => {
  it("HEADs the url and returns the parsed content-length header", async () => {
    let capturedMethod: string | undefined;
    globalThis.fetch = async (_input, init) => {
      capturedMethod = (init as RequestInit | undefined)?.method;
      return headResponse(32000);
    };

    const length = await fetchContentLength(REAL_THUMB_URL);
    assert.equal(capturedMethod, "HEAD");
    assert.equal(length, 32000);
  });

  it("returns undefined when the content-length header is missing", async () => {
    globalThis.fetch = async () => headResponse(undefined);
    assert.equal(await fetchContentLength(REAL_THUMB_URL), undefined);
  });

  it("returns undefined on a non-ok response rather than throwing", async () => {
    globalThis.fetch = async () => headResponse(1000, 404);
    assert.equal(await fetchContentLength(REAL_THUMB_URL), undefined);
  });

  it("returns undefined (no throw) when fetch itself throws", async () => {
    globalThis.fetch = async () => {
      throw new Error("network error");
    };
    assert.equal(await fetchContentLength(REAL_THUMB_URL), undefined);
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
  it("identifies broken ads across a full mocked GET /ads → GET /adimages pipeline (task #128 continued: image-fingerprint classification, not URL)", async () => {
    globalThis.fetch = async (input, init) => {
      const url = urlOf(input);
      if (isHead(init)) {
        // Only the "fine" hash's URL should ever be HEAD-checked — the broken
        // hash is already conclusively classified by width/height/name.
        assert.equal(url, REAL_THUMB_URL, `unexpected HEAD request to ${url}`);
        return headResponse(REAL_CONTENT_LENGTH);
      }
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
        if (url.includes("hash_broken")) return jsonResponse({ data: [{ hash: "hash_broken", ...BROKEN_IMAGE_METADATA }] });
        if (url.includes("hash_ok")) return jsonResponse({ data: [{ hash: "hash_ok", ...REAL_IMAGE_METADATA }] });
        return jsonResponse({ data: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await scanCampaignForBrokenVideoAds("cmp_1", "999", "tok", { sleepMs: 0 });
    assert.equal(result.broken.length, 1);
    assert.equal(result.broken[0].adId, "ad_broken");
    assert.equal(result.broken[0].creativeId, "creative_broken");
    assert.equal(result.broken[0].videoId, "vid_broken");
    assert.equal(result.broken[0].placeholderUrl, BROKEN_IMAGE_URL);
    assert.equal(result.sizeCapExceeded, false);
    assert.equal(result.totalAdCount, 3);
  });

  it("returns an empty broken list when every video ad's thumbnail resolves to real content (confirmed via the HEAD content-length fallback)", async () => {
    globalThis.fetch = async (input, init) => {
      const url = urlOf(input);
      if (isHead(init)) return headResponse(REAL_CONTENT_LENGTH);
      if (url.includes("/ads")) {
        return jsonResponse({
          data: [{ id: "ad_1", creative: { id: "c_1", object_story_spec: { video_data: { video_id: "v_1", image_hash: "h_1" } } } }],
        });
      }
      return jsonResponse({ data: [{ hash: "h_1", ...REAL_IMAGE_METADATA }] });
    };

    const result = await scanCampaignForBrokenVideoAds("cmp_2", "999", "tok", { sleepMs: 0 });
    assert.deepEqual(result.broken, []);
  });

  it("flags a real-looking image as broken when its HEAD content-length comes back tiny (belt-and-braces signal)", async () => {
    globalThis.fetch = async (input, init) => {
      const url = urlOf(input);
      if (isHead(init)) return headResponse(900); // suspiciously small despite "real" dimensions/name
      if (url.includes("/ads")) {
        return jsonResponse({
          data: [{ id: "ad_1", creative: { id: "c_1", object_story_spec: { video_data: { video_id: "v_1", image_hash: "h_1" } } } }],
        });
      }
      // Metadata alone looks fine (1080x1080 jpg) — only the HEAD check catches this one.
      return jsonResponse({ data: [{ hash: "h_1", ...REAL_IMAGE_METADATA }] });
    };

    const result = await scanCampaignForBrokenVideoAds("cmp_tiny", "999", "tok", { sleepMs: 0 });
    assert.equal(result.broken.length, 1);
    assert.equal(result.broken[0].fingerprint.contentLengthBytes, 900);
  });

  it("dedupes hash resolution when multiple ads share the same image_hash", async () => {
    let adimagesCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = urlOf(input);
      if (isHead(init)) throw new Error("should not HEAD an already-conclusive broken image");
      if (url.includes("/ads")) {
        return jsonResponse({
          data: [
            { id: "ad_1", creative: { id: "c_1", object_story_spec: { video_data: { video_id: "v_1", image_hash: "shared_hash" } } } },
            { id: "ad_2", creative: { id: "c_2", object_story_spec: { video_data: { video_id: "v_2", image_hash: "shared_hash" } } } },
          ],
        });
      }
      adimagesCalls++;
      return jsonResponse({ data: [{ hash: "shared_hash", ...BROKEN_IMAGE_METADATA }] });
    };

    const result = await scanCampaignForBrokenVideoAds("cmp_3", "999", "tok", { sleepMs: 0 });
    assert.equal(adimagesCalls, 1, "should resolve the shared hash exactly once");
    assert.equal(result.broken.length, 2, "both ads sharing the broken hash should be flagged");
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
      if (url.includes("/adimages")) return jsonResponse({ data: [{ hash: "h_ok", ...BROKEN_IMAGE_METADATA }] });
      throw new Error(`unexpected fetch: ${url}`);
    };

    const result = await scanCampaignForBrokenVideoAds("cmp_4", "999", "tok", { sleepMs: 0 });
    assert.equal(result.broken.length, 1);
    assert.equal(result.broken[0].adId, "ad_ok");
  });

  // ── over-scan guard: created_time date filter ──────────────────────────

  it("drops ads created before the bug-introduced date and never resolves their creative/hash", async () => {
    let creativeOrImageCalls = 0;
    globalThis.fetch = async (input) => {
      const url = urlOf(input);
      if (url.includes("/ads")) {
        return jsonResponse({
          data: [
            {
              id: "ad_legacy",
              created_time: "2026-05-01T00:00:00+0000", // predates PR #748
              creative: { id: "c_legacy", object_story_spec: { video_data: { video_id: "v_legacy", image_hash: "h_legacy" } } },
            },
            {
              id: "ad_new",
              created_time: "2026-08-10T00:00:00+0000",
              creative: { id: "c_new", object_story_spec: { video_data: { video_id: "v_new", image_hash: "h_new" } } },
            },
          ],
        });
      }
      creativeOrImageCalls++;
      if (url.includes("h_legacy")) throw new Error("should never resolve a pre-cutoff ad's hash");
      return jsonResponse({ data: [{ hash: "h_new", ...BROKEN_IMAGE_METADATA }] });
    };

    const result = await scanCampaignForBrokenVideoAds("cmp_dates", "999", "tok", { sleepMs: 0 });
    assert.equal(result.totalAdCount, 2);
    assert.equal(result.skippedOldAdCount, 1);
    assert.equal(result.scannedAdCount, 1);
    assert.equal(result.broken.length, 1);
    assert.equal(result.broken[0].adId, "ad_new");
    assert.equal(creativeOrImageCalls, 1, "only the post-cutoff ad's hash should ever be resolved");
  });

  it("logs the skip count via onProgress", async () => {
    globalThis.fetch = async (input) => {
      const url = urlOf(input);
      if (url.includes("/ads")) {
        return jsonResponse({
          data: [
            { id: "ad_old", created_time: "2026-01-01T00:00:00+0000" },
            { id: "ad_old_2", created_time: "2026-02-01T00:00:00+0000" },
          ],
        });
      }
      return jsonResponse({ data: [] });
    };

    const messages: string[] = [];
    await scanCampaignForBrokenVideoAds("cmp_logs", "999", "tok", { sleepMs: 0, onProgress: (m) => messages.push(m) });
    assert.ok(
      messages.some((m) => m.includes("2/2") && m.includes("too old to be affected") && m.includes("skipping")),
      `expected a skip-count log line — got: ${JSON.stringify(messages)}`,
    );
  });

  // ── over-scan guard: per-campaign size cap ─────────────────────────────

  it("refuses to scan (sizeCapExceeded) when the filtered ad count exceeds maxAdsPerCampaign, and makes zero further Meta calls", async () => {
    const manyAds = Array.from({ length: 5 }, (_, i) => ({
      id: `ad_${i}`,
      created_time: "2026-08-10T00:00:00+0000",
      creative: { id: `c_${i}`, object_story_spec: { video_data: { video_id: `v_${i}`, image_hash: `h_${i}` } } },
    }));
    let adsFetchCount = 0;
    let otherCallCount = 0;
    globalThis.fetch = async (input) => {
      const url = urlOf(input);
      if (url.includes("/ads")) {
        adsFetchCount++;
        return jsonResponse({ data: manyAds });
      }
      otherCallCount++;
      throw new Error(`should not call ${url} once the size cap is exceeded`);
    };

    const result = await scanCampaignForBrokenVideoAds("cmp_huge", "999", "tok", { sleepMs: 0, maxAdsPerCampaign: 3 });
    assert.equal(result.sizeCapExceeded, true);
    assert.deepEqual(result.broken, []);
    assert.equal(result.scannedAdCount, 5);
    assert.equal(adsFetchCount, 1, "the /ads listing call itself is cheap and still happens");
    assert.equal(otherCallCount, 0, "no creative/hash resolution calls once the cap is exceeded");
  });

  it("scans anyway when bypassSizeCap is set, even over the cap", async () => {
    const manyAds = Array.from({ length: 5 }, (_, i) => ({
      id: `ad_${i}`,
      created_time: "2026-08-10T00:00:00+0000",
      creative: { id: `c_${i}`, object_story_spec: { video_data: { video_id: `v_${i}`, image_hash: `h_${i}` } } },
    }));
    globalThis.fetch = async (input) => {
      const url = urlOf(input);
      if (url.includes("/ads")) return jsonResponse({ data: manyAds });
      return jsonResponse({ data: [] });
    };

    const result = await scanCampaignForBrokenVideoAds("cmp_huge_bypass", "999", "tok", {
      sleepMs: 0,
      maxAdsPerCampaign: 3,
      bypassSizeCap: true,
    });
    assert.equal(result.sizeCapExceeded, false);
    assert.equal(result.scannedAdCount, 5);
  });

  it("uses DEFAULT_MAX_ADS_PER_CAMPAIGN (200) when maxAdsPerCampaign is not overridden", () => {
    assert.equal(DEFAULT_MAX_ADS_PER_CAMPAIGN, 200);
  });
});
