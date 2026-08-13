/**
 * Regression tests for the video creative thumbnail fix, across four tasks:
 *
 * Task #68 root cause: buildVideoCreative was building video_data without
 * image_url or image_hash, causing Meta to reject every video creative with:
 *   code=100 · subcode=1443226
 *   "Please specify one of image_hash or image_url in the video_data field
 *    of object_story_spec."
 *
 * Task #112: preferred image_hash via POST /adimages to avoid Meta UI
 * Duplicate subcode=1443051 (ObjectStorySpecRedundant when both fields are
 * stored). That write is now App-Review-blocked (task #90, code=3).
 *
 * PR #767 (task #90 follow-up) incorrectly assumed thumb_offset alone lets
 * us omit BOTH image_url and image_hash. Meta's WRITE validator still
 * requires one field at create time — Colyn V2 relaunch 2026-08-12 failed
 * all 9 motion creatives with 1443226.
 *
 * This fix: call fetchVideoThumbnailWithRetry (PR #762 poll — spinner-
 * rejecting, 48s window) at creative-build time, set video_data.image_url
 * to that picture URL, never set image_hash, never call /adimages.
 * Acceptable trade: Meta UI Duplicate may hit 1443051 again.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildCreativePayload } from "../creative.ts";
import type { AdCreativeDraft } from "../../types.ts";
import { DEFAULT_POLL_DELAYS_MS } from "../video-thumbnail-poll.ts";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeVideoCreative(overrides?: {
  thumbnailUrl?: string;
  aspectRatio?: string;
}): AdCreativeDraft {
  const { thumbnailUrl, aspectRatio = "9:16" } = overrides ?? {};
  return {
    id: "cr_test",
    name: "Test Video",
    sourceType: "new",
    mediaType: "video",
    assetMode: "single",
    identity: { pageId: "pg_123", instagramAccountId: "" },
    assetVariations: [
      {
        id: "var_1",
        name: "Variation 1",
        assets: [
          {
            id: "asset_1",
            aspectRatio: aspectRatio as "9:16",
            uploadStatus: "uploaded",
            videoId: "vid_abc123",
            thumbnailUrl,
          },
        ],
      },
    ],
    captions: [{ id: "cap_1", text: "Come see us live" }],
    headline: "Buy tickets now",
    description: "",
    destinationUrl: "https://example.com/tickets",
    cta: "book_now",
    enhancements: {
      enabled: false,
      textOptimizations: false,
      visualEnhancements: false,
      musicEnhancements: false,
      autoVariations: false,
    },
  };
}

const LIVE_PICTURE = "https://scontent.xx.fbcdn.net/v/picture_from_poll.jpg";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("buildVideoCreative — image_url from picture poll (PR #767 regression)", () => {
  it("calls fetchVideoThumbnail, sets image_url, never image_hash", async () => {
    const calls: Array<{ videoId: string; token: string }> = [];
    const creative = makeVideoCreative({
      thumbnailUrl: "https://scontent.xx.fbcdn.net/stale_asset_thumb.jpg",
    });

    const payload = await buildCreativePayload(creative, {
      metaAccessToken: "tok_live",
      fetchVideoThumbnail: async (videoId, token) => {
        calls.push({ videoId, token });
        return LIVE_PICTURE;
      },
    });

    const videoData = payload.object_story_spec?.video_data;
    assert.ok(videoData, "video_data must be present");
    assert.deepEqual(calls, [{ videoId: "vid_abc123", token: "tok_live" }]);
    assert.equal(videoData.image_url, LIVE_PICTURE);
    assert.equal(videoData.image_hash, undefined, "image_hash must never be set — /adimages is App-Review-blocked");
  });

  it("falls back to Asset.thumbnailUrl when the live poll returns empty", async () => {
    const fallback = "https://scontent.xx.fbcdn.net/upload_time_thumb.jpg";
    const creative = makeVideoCreative({ thumbnailUrl: fallback });

    const payload = await buildCreativePayload(creative, {
      metaAccessToken: "tok_live",
      fetchVideoThumbnail: async () => "",
    });

    assert.equal(payload.object_story_spec?.video_data?.image_url, fallback);
    assert.equal(payload.object_story_spec?.video_data?.image_hash, undefined);
  });

  it("falls back to Asset.thumbnailUrl when metaAccessToken is missing", async () => {
    const fallback = "https://scontent.xx.fbcdn.net/upload_time_thumb.jpg";
    const creative = makeVideoCreative({ thumbnailUrl: fallback });

    const payload = await buildCreativePayload(creative);

    assert.equal(payload.object_story_spec?.video_data?.image_url, fallback);
    assert.equal(payload.object_story_spec?.video_data?.image_hash, undefined);
  });

  it("omits both fields (with warning path) when poll empty and no Asset.thumbnailUrl", async () => {
    const creative = makeVideoCreative({ thumbnailUrl: undefined });

    let payload: Awaited<ReturnType<typeof buildCreativePayload>>;
    await assert.doesNotReject(async () => {
      payload = await buildCreativePayload(creative, {
        metaAccessToken: "tok_live",
        fetchVideoThumbnail: async () => "",
      });
    });
    const videoData = payload!.object_story_spec?.video_data;
    assert.ok(videoData);
    assert.equal(videoData.image_url, undefined);
    assert.equal(videoData.image_hash, undefined);
  });

  it("multi-ratio draft: polls the 9:16 videoId and sets its picture as image_url", async () => {
    const creative: AdCreativeDraft = {
      ...makeVideoCreative(),
      assetVariations: [
        {
          id: "var_1",
          name: "Variation 1",
          assets: [
            {
              id: "asset_45",
              aspectRatio: "4:5",
              uploadStatus: "uploaded",
              videoId: "vid_45",
              thumbnailUrl: "https://scontent.xx.fbcdn.net/thumb_45.jpg",
            },
            {
              id: "asset_916",
              aspectRatio: "9:16",
              uploadStatus: "uploaded",
              videoId: "vid_916",
              thumbnailUrl: "https://scontent.xx.fbcdn.net/thumb_916.jpg",
            },
          ],
        },
      ],
    };

    const polled: string[] = [];
    const payload = await buildCreativePayload(creative, {
      metaAccessToken: "tok_live",
      fetchVideoThumbnail: async (videoId) => {
        polled.push(videoId);
        return `https://scontent.xx.fbcdn.net/picture_${videoId}.jpg`;
      },
    });

    const videoData = payload.object_story_spec?.video_data;
    assert.equal(videoData?.video_id, "vid_916", "should pick 9:16 videoId first");
    assert.deepEqual(polled, ["vid_916"]);
    assert.equal(videoData?.image_url, "https://scontent.xx.fbcdn.net/picture_vid_916.jpg");
    assert.equal(videoData?.image_hash, undefined);
  });
});

describe("PR #762 poll fix still on the creative-build path", () => {
  it("creative.ts defaults to fetchVideoThumbnailWithRetry (not a raw picture GET)", () => {
    const src = readFileSync(join(process.cwd(), "lib/meta/creative.ts"), "utf8");
    assert.match(
      src,
      /import\s*\{\s*fetchVideoThumbnailWithRetry\s*\}\s*from\s*["']\.\/video-thumbnail-poll/,
      "build path must import PR #762's spinner-rejecting poller",
    );
    assert.match(
      src,
      /fetchVideoThumbnail\s*\?\?\s*fetchVideoThumbnailWithRetry/,
      "default fetcher must be fetchVideoThumbnailWithRetry",
    );
    assert.doesNotMatch(
      src,
      /uploadImageFromUrl|uploadThumbnailAsImage/,
      "must not reintroduce the App-Review-blocked /adimages path",
    );
  });

  it("DEFAULT_POLL_DELAYS_MS is still the 48s spinner-rejecting schedule", () => {
    assert.deepEqual([...DEFAULT_POLL_DELAYS_MS], [3000, 5000, 8000, 12000, 20000]);
  });
});
